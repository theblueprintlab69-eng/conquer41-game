import React, { useReducer, useEffect, useRef } from 'react';

/* ============================================================================
   1. RULE ENGINE — pure functions, no React, fully unit-testable in isolation
   ============================================================================
   Game: "Conquer 41" — a two-deck Ethiopian rummy variant.
   - 4 players, 2 standard decks + 4 jokers, dealer gets 14 cards.
   - A cut card sets the "round joker" rank (wild for that round only).
   - To "go down" a player must lay melds (sets or runs) worth >= 41 points.
   - After going down, a player may also draw from the discard pile.
   - A player wins the round by emptying their hand — but only after
     going down (you cannot end the round without ever reaching 41).
============================================================================ */

const SUITS = ['HEARTS', 'DIAMONDS', 'CLUBS', 'SPADES'];
const RANK_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_VALUES = { A: 11, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 10, Q: 10, K: 10 };
const TARGET_SCORE = 41;
const JOKER_PENALTY = 20;
const NO_DOWN_PENALTY = 100;

const PLAYER_SEED = [
  { name: 'አንተ (ሮቤል)', isBot: false },
  { name: 'ንጉስ', isBot: true },
  { name: 'አስቴር', isBot: true },
  { name: 'ጫላ', isBot: true },
];

function isJokerCard(card, roundJokerRank) {
  return card.rank === 'JOKER' || card.rank === roundJokerRank;
}

function getSuitSymbol(suit) {
  switch (suit) {
    case 'HEARTS': return '♥';
    case 'DIAMONDS': return '♦';
    case 'CLUBS': return '♣';
    case 'SPADES': return '♠';
    default: return '★';
  }
}

function getSuitColorClass(suit) {
  return suit === 'HEARTS' || suit === 'DIAMONDS' ? 'text-rose-700' : 'text-stone-900';
}

function buildDoubleDeck() {
  const deck = [];
  for (let pack = 1; pack <= 2; pack++) {
    SUITS.forEach((suit) => {
      RANK_ORDER.forEach((rank) => {
        deck.push({ id: `${suit}_${rank}_p${pack}`, suit, rank, value: RANK_VALUES[rank] });
      });
    });
  }
  for (let i = 1; i <= 4; i++) {
    deck.push({ id: `JOKER_${i}`, suit: 'WILD', rank: 'JOKER', value: 0 });
  }
  return deck;
}

function shuffle(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sortHand(hand) {
  return [...hand].sort(
    (a, b) => a.suit.localeCompare(b.suit) || RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank)
  );
}

/** Validates a single meld (set or run), honoring the round's wild joker. */
function validateGroup(cards, roundJokerRank) {
  if (cards.length < 3) return { valid: false, reason: 'ስብስብ ቢያንስ 3 ካርታ ሊኖረው ይገባል።' };

  const jokers = cards.filter((c) => isJokerCard(c, roundJokerRank));
  const regulars = cards.filter((c) => !isJokerCard(c, roundJokerRank));

  if (regulars.length === 0) {
    const score = cards.length * JOKER_PENALTY;
    return { valid: true, type: 'SET', score };
  }

  const isSet = regulars.every((c) => c.rank === regulars[0].rank);
  if (isSet) {
    const suits = regulars.map((c) => c.suit);
    if (new Set(suits).size !== suits.length) {
      return { valid: false, reason: 'በአንድ ስብስብ ውስጥ ተመሳሳይ ካርድ (suit) መደጋገም የለበትም።' };
    }
    const score = cards.reduce((sum, c) => sum + (isJokerCard(c, roundJokerRank) ? regulars[0].value : c.value), 0);
    return { valid: true, type: 'SET', score };
  }

  const isSameSuit = regulars.every((c) => c.suit === regulars[0].suit);
  if (!isSameSuit) return { valid: false, reason: 'ካርዶቹ ተመሳሳይ ደረጃ ወይም ተመሳሳይ ዓይነት (suit) መሆን አለባቸው።' };

  const sortedIdx = regulars.map((c) => RANK_ORDER.indexOf(c.rank)).sort((a, b) => a - b);
  let gapsNeeded = 0;
  for (let i = 0; i < sortedIdx.length - 1; i++) {
    const diff = sortedIdx[i + 1] - sortedIdx[i] - 1;
    if (diff < 0) return { valid: false, reason: 'ተመሳሳይ ደረጃ ያለው ካርድ በቅደም ተከተል (Run) ውስጥ መደጋገም የለበትም።' };
    gapsNeeded += diff;
  }

  if (gapsNeeded <= jokers.length) {
    const score = cards.reduce((sum, c) => sum + c.value, 0);
    return { valid: true, type: 'RUN', score };
  }
  return { valid: false, reason: 'ትክክለኛ ተከታታይ ቅደም ተከተል አይደለም።' };
}

/** Validates an entire "go down" attempt: every group must be legal and total >= 41. */
function validateDownAttempt(melds, roundJokerRank) {
  let total = 0;
  for (const meld of melds) {
    const res = validateGroup(meld, roundJokerRank);
    if (!res.valid) return { valid: false, reason: res.reason };
    total += res.score;
  }
  if (total < TARGET_SCORE) {
    return { valid: false, reason: `ጠቅላላ ነጥብህ ${total} ብቻ ነው። ለመውረድ ${TARGET_SCORE} ወይም ከዚያ በላይ ያስፈልጋል!` };
  }
  return { valid: true, totalScore: total };
}

/**
 * Heuristic meld detector used by the bots (and available for a future
 * "suggest a meld" hint feature). Greedily finds complete sets first,
 * then complete runs from the remaining cards, and reports what's left over.
 */
function detectMelds(hand, roundJokerRank) {
  const jokers = hand.filter((c) => isJokerCard(c, roundJokerRank));
  const regulars = hand.filter((c) => !isJokerCard(c, roundJokerRank));
  const used = new Set();
  const melds = [];

  const byRank = {};
  regulars.forEach((c) => {
    if (!byRank[c.rank]) byRank[c.rank] = [];
    byRank[c.rank].push(c);
  });
  Object.values(byRank).forEach((group) => {
    const bySuit = {};
    group.forEach((c) => { if (!bySuit[c.suit]) bySuit[c.suit] = c; });
    const uniqueCards = Object.values(bySuit);
    if (uniqueCards.length >= 3) {
      uniqueCards.forEach((c) => used.add(c.id));
      melds.push({ type: 'SET', cards: uniqueCards });
    }
  });

  let sparejokers = jokers.length;
  SUITS.forEach((suit) => {
    const suitCards = regulars
      .filter((c) => c.suit === suit && !used.has(c.id))
      .sort((a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank));
    let run = [];
    const flush = () => {
      if (run.length >= 3) {
        run.forEach((c) => used.add(c.id));
        melds.push({ type: 'RUN', cards: [...run] });
      }
      run = [];
    };
    for (const card of suitCards) {
      if (run.length === 0) { run.push(card); continue; }
      const gap = RANK_ORDER.indexOf(card.rank) - RANK_ORDER.indexOf(run[run.length - 1].rank) - 1;
      if (gap === 0) run.push(card);
      else if (gap > 0 && gap <= sparejokers) { sparejokers -= gap; run.push(card); }
      else { flush(); run.push(card); }
    }
    flush();
  });

  const usedJokers = jokers.length - sparejokers;
  const deadCards = [...regulars.filter((c) => !used.has(c.id)), ...jokers.slice(usedJokers)];
  const score = hand.filter((c) => used.has(c.id)).reduce((s, c) => s + c.value, 0);
  return { melds, deadCards, score };
}

function scoreDeadHand(hand, roundJokerRank) {
  return hand.reduce((sum, c) => sum + (isJokerCard(c, roundJokerRank) ? JOKER_PENALTY : c.value), 0);
}

/* ============================================================================
   2. GAME STATE — a single reducer is the source of truth for the whole table
============================================================================ */

function dealNewRound(previousPlayers) {
  const shoe = shuffle(buildDoubleDeck());
  const cutCard = shoe[shoe.length - 1];
  const hands = [shoe.splice(0, 14), shoe.splice(0, 13), shoe.splice(0, 13), shoe.splice(0, 13)];

  return {
    deck: shoe,
    discardPile: [],
    roundJoker: cutCard,
    players: PLAYER_SEED.map((seed, i) => ({
      id: i,
      name: seed.name,
      isBot: seed.isBot,
      hand: i === 0 ? sortHand(hands[i]) : hands[i],
      hasDowned: false,
      score: previousPlayers ? previousPlayers[i].score : 0,
    })),
    currentTurn: 0,
    gamePhase: 'DRAW',
    selectedCardIds: [],
    pendingMelds: [],
    winnerId: null,
    toast: null,
    confirm: null,
  };
}

function refillDeckIfEmpty(deck, discardPile) {
  if (deck.length > 0) return { deck, discardPile };
  if (discardPile.length <= 1) return { deck, discardPile };
  const top = discardPile[discardPile.length - 1];
  const reshuffled = shuffle(discardPile.slice(0, -1));
  return { deck: reshuffled, discardPile: [top] };
}

function applyRoundEnd(state, winnerId) {
  const players = state.players.map((p) => {
    if (p.id === winnerId) return p;
    const penalty = !p.hasDowned ? NO_DOWN_PENALTY : scoreDeadHand(p.hand, state.roundJoker.rank);
    return { ...p, score: p.score + penalty };
  });
  return { ...state, players, winnerId, gamePhase: 'ROUND_OVER' };
}

function runBotTurn(state) {
  const bot = state.players[state.currentTurn];
  let { deck, discardPile } = refillDeckIfEmpty(state.deck, state.discardPile);
  const topDiscard = discardPile[discardPile.length - 1];

  // A bot may only fish the discard pile once it has already gone down,
  // and only when it visibly completes a set (heuristic: 2+ matching ranks in hand).
  const discardCompletesSet = bot.hasDowned && topDiscard &&
    bot.hand.filter((c) => c.rank === topDiscard.rank).length >= 2;

  let drawnCard;
  if (discardCompletesSet) {
    drawnCard = discardPile[discardPile.length - 1];
    discardPile = discardPile.slice(0, -1);
  } else if (deck.length > 0) {
    drawnCard = deck[0];
    deck = deck.slice(1);
  } else {
    drawnCard = discardPile[discardPile.length - 1];
    discardPile = discardPile.slice(0, -1);
  }

  let hand = [...bot.hand, drawnCard];
  let hasDowned = bot.hasDowned;

  if (!hasDowned) {
    const { deadCards, score } = detectMelds(hand, state.roundJoker.rank);
    if (score >= TARGET_SCORE) {
      hasDowned = true;
      hand = deadCards;
    }
  }

  if (hand.length === 0) {
    const players = state.players.map((p) => (p.id === bot.id ? { ...p, hand, hasDowned } : p));
    return applyRoundEnd({ ...state, deck, discardPile, players }, bot.id);
  }

  // Choose a discard: prefer a card outside any detected meld; never break a real meld if avoidable.
  const { deadCards } = detectMelds(hand, state.roundJoker.rank);
  const nonJokerDead = deadCards.filter((c) => !isJokerCard(c, state.roundJoker.rank));
  const pool = nonJokerDead.length > 0 ? nonJokerDead : hand.filter((c) => !isJokerCard(c, state.roundJoker.rank));
  const discardTarget = (pool.length > 0 ? pool : hand).reduce((worst, c) => (c.value > worst.value ? c : worst));
  hand = hand.filter((c) => c.id !== discardTarget.id);

  const players = state.players.map((p) => (p.id === bot.id ? { ...p, hand, hasDowned } : p));

  if (hand.length === 0 && hasDowned) {
    return applyRoundEnd({ ...state, deck, discardPile: [...discardPile, discardTarget], players }, bot.id);
  }

  return {
    ...state,
    deck,
    discardPile: [...discardPile, discardTarget],
    players,
    currentTurn: (state.currentTurn + 1) % 4,
    gamePhase: 'DRAW',
  };
}

function gameReducer(state, action) {
  switch (action.type) {
    case 'START_ROUND':
      return dealNewRound(state?.players ?? null);

    case 'DISMISS_TOAST':
      return { ...state, toast: null };

    case 'REQUEST_DRAW': {
      if (state.gamePhase !== 'DRAW' || state.currentTurn !== 0) return state;
      const user = state.players[0];
      if (action.source === 'DISCARD') {
        if (state.discardPile.length === 0) return state;
        if (!user.hasDowned) {
          return {
            ...state,
            confirm: {
              title: 'ማሳሰቢያ',
              message: `መሬት ላይ ያለውን ካርታ ለመውሰድ በዚህ ተራ ${TARGET_SCORE} መሙላት (መውረድ) ይጠበቅብሃል። ማንሳት ይቀጥል?`,
              onConfirmType: 'DRAW',
              source: 'DISCARD',
            },
          };
        }
      }
      return gameReducer(state, { type: 'DRAW', source: action.source });
    }

    case 'CONFIRM_MODAL': {
      if (!state.confirm) return state;
      const { onConfirmType, source } = state.confirm;
      const cleared = { ...state, confirm: null };
      if (onConfirmType === 'DRAW') return gameReducer(cleared, { type: 'DRAW', source });
      return cleared;
    }

    case 'CANCEL_MODAL':
      return { ...state, confirm: null };

    case 'DRAW': {
      if (state.gamePhase !== 'DRAW' || state.currentTurn !== 0) return state;
      let { deck, discardPile } = refillDeckIfEmpty(state.deck, state.discardPile);
      let drawnCard;
      if (action.source === 'DISCARD') {
        if (discardPile.length === 0) return state;
        drawnCard = discardPile[discardPile.length - 1];
        discardPile = discardPile.slice(0, -1);
      } else {
        if (deck.length === 0) return state;
        drawnCard = deck[0];
        deck = deck.slice(1);
      }
      const players = state.players.map((p) => (p.id === 0 ? { ...p, hand: sortHand([...p.hand, drawnCard]) } : p));
      return { ...state, deck, discardPile, players, gamePhase: 'PLAY' };
    }

    case 'TOGGLE_SELECT_CARD': {
      if (state.gamePhase !== 'PLAY' || state.currentTurn !== 0) return state;
      const { cardId } = action;
      const selected = state.selectedCardIds.includes(cardId)
        ? state.selectedCardIds.filter((id) => id !== cardId)
        : [...state.selectedCardIds, cardId];
      return { ...state, selectedCardIds: selected };
    }

    case 'CLEAR_SELECTION':
      return { ...state, selectedCardIds: [] };

    case 'CREATE_MELD_GROUP': {
      if (state.selectedCardIds.length < 3) {
        return { ...state, toast: { tone: 'warn', message: 'ስብስብ ለመፍጠር ቢያንስ 3 ካርታ ምረጥ።' } };
      }
      const user = state.players[0];
      const groupCards = user.hand.filter((c) => state.selectedCardIds.includes(c.id));
      return { ...state, pendingMelds: [...state.pendingMelds, groupCards], selectedCardIds: [] };
    }

    case 'REMOVE_PENDING_MELD': {
      const pendingMelds = state.pendingMelds.filter((_, i) => i !== action.index);
      return { ...state, pendingMelds };
    }

    case 'SUBMIT_DOWN': {
      const result = validateDownAttempt(state.pendingMelds, state.roundJoker.rank);
      if (!result.valid) {
        return { ...state, toast: { tone: 'error', message: `ውድቅ ተደርጓል፦ ${result.reason}` } };
      }
      const meldedIds = new Set(state.pendingMelds.flat().map((c) => c.id));
      const players = state.players.map((p) =>
        p.id === 0 ? { ...p, hand: p.hand.filter((c) => !meldedIds.has(c.id)), hasDowned: true } : p
      );
      return {
        ...state,
        players,
        pendingMelds: [],
        toast: { tone: 'success', message: `🎉 እንኳን ደስ አለህ! በ${result.totalScore} ነጥብ ወርደሃል!` },
      };
    }

    case 'DISCARD': {
      if (state.gamePhase !== 'PLAY' || state.currentTurn !== 0) return state;
      const user = state.players[0];
      const cardToDrop = user.hand.find((c) => c.id === action.cardId);
      if (!cardToDrop) return state;
      const updatedHand = user.hand.filter((c) => c.id !== action.cardId);

      if (updatedHand.length === 0 && !user.hasDowned) {
        return { ...state, toast: { tone: 'error', message: `ካርታህን ከመጨረስህ በፊት መጀመሪያ ${TARGET_SCORE} መሙላት (መውረድ) አለብህ!` } };
      }

      const players = state.players.map((p) => (p.id === 0 ? { ...p, hand: updatedHand } : p));
      const nextState = {
        ...state,
        discardPile: [...state.discardPile, cardToDrop],
        players,
        selectedCardIds: [],
      };

      if (updatedHand.length === 0) return applyRoundEnd(nextState, 0);

      return { ...nextState, currentTurn: 1, gamePhase: 'DRAW' };
    }

    case 'BOT_TURN': {
      if (state.gamePhase === 'ROUND_OVER' || state.currentTurn === 0) return state;
      return runBotTurn(state);
    }

    default:
      return state;
  }
}

/* ============================================================================
   3. PRESENTATION COMPONENTS
============================================================================ */

function PlayingCard({ card, roundJokerRank, selected, onClick, size = 'md' }) {
  const isJoker = isJokerCard(card, roundJokerRank);
  const dims = size === 'lg' ? 'w-16 h-24' : 'w-14 h-20';
  return (
    <button
      onClick={onClick}
      className={`card-face relative ${dims} rounded-lg shadow-md flex flex-col justify-between px-1.5 py-1 font-bold transform transition-all duration-150 border-2
        ${selected ? '-translate-y-4 border-amber-500 ring-2 ring-amber-400' : 'border-stone-300 hover:-translate-y-1.5'}`}
    >
      <span className={`text-xs leading-none text-left ${getSuitColorClass(card.suit)}`}>{card.rank}</span>
      <span className={`text-xl leading-none self-center ${getSuitColorClass(card.suit)}`}>{getSuitSymbol(card.suit)}</span>
      {isJoker && (
        <span className="text-[8px] bg-amber-500 text-white w-full text-center rounded-sm py-0.5 font-bold tracking-wide">
          ጆከር
        </span>
      )}
    </button>
  );
}

function ConfirmModal({ confirm, dispatch }) {
  if (!confirm) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div className="bg-stone-50 text-stone-900 rounded-2xl border-2 border-amber-500 shadow-2xl max-w-sm w-full p-5">
        <h3 className="font-black text-amber-700 mb-2" style={{ fontFamily: 'var(--font-display)' }}>{confirm.title}</h3>
        <p className="text-sm leading-relaxed mb-5">{confirm.message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => dispatch({ type: 'CANCEL_MODAL' })}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-stone-200 hover:bg-stone-300"
          >
            ተወው
          </button>
          <button
            onClick={() => dispatch({ type: 'CONFIRM_MODAL' })}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-amber-600 hover:bg-amber-500 text-white"
          >
            እርግጠኛ ነኝ
          </button>
        </div>
      </div>
    </div>
  );
}

function Toast({ toast, dispatch }) {
  const timerRef = useRef(null);
  useEffect(() => {
    if (!toast) return undefined;
    timerRef.current = setTimeout(() => dispatch({ type: 'DISMISS_TOAST' }), 3200);
    return () => clearTimeout(timerRef.current);
  }, [toast, dispatch]);

  if (!toast) return null;
  const tones = {
    success: 'bg-emerald-600 border-emerald-300',
    error: 'bg-rose-700 border-rose-300',
    warn: 'bg-amber-600 border-amber-300',
  };
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[90%]">
      <div className={`${tones[toast.tone] || tones.warn} text-white border rounded-xl shadow-2xl px-4 py-3 text-sm font-bold text-center`}>
        {toast.message}
      </div>
    </div>
  );
}

/* ============================================================================
   4. ROOT APPLICATION
============================================================================ */

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, null, () => dealNewRound(null));

  useEffect(() => {
    if (state.gamePhase === 'ROUND_OVER' || state.currentTurn === 0) return undefined;
    const timer = setTimeout(() => dispatch({ type: 'BOT_TURN' }), 950);
    return () => clearTimeout(timer);
  }, [state.gamePhase, state.currentTurn, state.players, state.deck.length]);

  const user = state.players[0];
  const bots = state.players.slice(1);
  const topDiscard = state.discardPile[state.discardPile.length - 1];
  const canAct = state.currentTurn === 0 && state.gamePhase !== 'ROUND_OVER';

  return (
    <div className="min-h-screen felt-table text-stone-100 flex flex-col font-sans" style={{ fontFamily: 'var(--font-body)' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+Ethiopic:wght@600;800&family=Noto+Sans+Ethiopic:wght@400;500;600;700&display=swap');
        :root { --font-display: 'Noto Serif Ethiopic', serif; --font-body: 'Noto Sans Ethiopic', sans-serif; }
        .felt-table {
          background:
            radial-gradient(ellipse at 50% 0%, rgba(212,175,90,0.10), transparent 60%),
            radial-gradient(circle at 50% 50%, #0e4d38 0%, #0a3a2a 55%, #062017 100%);
        }
        .card-face { background: linear-gradient(180deg, #fbf8f0 0%, #f2ecdb 100%); }
        .wax-medallion {
          background: radial-gradient(circle at 35% 30%, #e7c777, #b8912f 65%, #8a6a1f 100%);
          box-shadow: inset 0 0 0 2px rgba(255,255,255,0.25), 0 4px 10px rgba(0,0,0,0.45);
        }
        .card-back {
          background-image:
            repeating-linear-gradient(45deg, rgba(212,175,90,0.18) 0 6px, transparent 6px 12px),
            linear-gradient(160deg, #2c1f4a, #1a1330);
        }
      `}</style>

      <ConfirmModal confirm={state.confirm} dispatch={dispatch} />
      <Toast toast={state.toast} dispatch={dispatch} />

      <header className="bg-stone-950/70 backdrop-blur px-4 py-3 flex justify-between items-center border-b border-amber-900/40 shadow-lg">
        <span className="text-amber-400 font-black tracking-widest text-lg" style={{ fontFamily: 'var(--font-display)' }}>
          ድል 41
        </span>
        <button
          onClick={() => dispatch({ type: 'START_ROUND' })}
          className="bg-amber-600 hover:bg-amber-500 text-stone-950 px-4 py-1.5 rounded-lg text-xs font-bold transition shadow"
        >
          አዲስ ዙር ጀምር
        </button>
      </header>

      <div className="flex-1 max-w-4xl w-full mx-auto p-4 flex flex-col justify-between items-center gap-4">

        {/* Opponents */}
        <div className="grid grid-cols-3 w-full gap-3 text-center">
          {bots.map((bot) => (
            <div
              key={bot.id}
              className={`p-2.5 rounded-xl bg-stone-950/50 border ${
                state.currentTurn === bot.id ? 'border-amber-400 shadow-lg shadow-amber-500/10' : 'border-stone-800'
              }`}
            >
              <div className="text-xs font-bold">
                {bot.name} {bot.hasDowned && <span className="text-emerald-400">✓ ወርዷል</span>}
              </div>
              <div className="text-[10px] text-stone-400 mt-0.5">ካርታ፦ {bot.hand.length} | እዳ፦ {bot.score}</div>
            </div>
          ))}
        </div>

        {/* Bank / joker / discard */}
        <div className="flex items-center gap-5 bg-stone-950/40 p-5 rounded-2xl border border-amber-900/30 w-full max-w-md justify-center shadow-inner">
          <button
            onClick={() => dispatch({ type: 'REQUEST_DRAW', source: 'BANK' })}
            disabled={!canAct || state.gamePhase !== 'DRAW'}
            className={`card-back w-16 h-24 rounded-xl flex flex-col justify-between p-1.5 font-bold shadow-xl transition active:scale-95 disabled:opacity-40 border-2 ${
              canAct && state.gamePhase === 'DRAW' ? 'border-amber-400 animate-pulse' : 'border-amber-900/50'
            }`}
          >
            <span className="text-[9px] text-amber-200">ባንክ</span>
            <span className="text-lg self-center">🂠</span>
            <span className="text-[10px] text-amber-200 self-end">{state.deck.length}</span>
          </button>

          <div className="wax-medallion w-16 h-16 rounded-full flex flex-col items-center justify-center text-stone-950">
            <span className="text-[8px] font-bold tracking-wide">የዙር ጆከር</span>
            <span className="text-sm font-black">
              {state.roundJoker.rank}{getSuitSymbol(state.roundJoker.suit)}
            </span>
          </div>

          <button
            onClick={() => dispatch({ type: 'REQUEST_DRAW', source: 'DISCARD' })}
            disabled={!canAct || state.gamePhase !== 'DRAW' || state.discardPile.length === 0}
            className={`w-16 h-24 rounded-xl flex flex-col justify-between p-1.5 font-bold border-2 transition active:scale-95 disabled:opacity-40 ${
              state.discardPile.length === 0 ? 'border-dashed border-stone-700 text-stone-500' : 'card-face border-emerald-500'
            }`}
          >
            {topDiscard ? (
              <>
                <span className="text-[9px] text-stone-500">መሬት</span>
                <span className={`text-base font-black text-center ${getSuitColorClass(topDiscard.suit)}`}>
                  {topDiscard.rank}
                  <span className="text-sm block leading-none">{getSuitSymbol(topDiscard.suit)}</span>
                </span>
                <span className="text-[9px] text-stone-500 self-end">#{state.discardPile.length}</span>
              </>
            ) : (
              <span className="m-auto text-[9px] text-stone-500">ባዶ መሬት</span>
            )}
          </button>
        </div>

        {state.gamePhase === 'ROUND_OVER' && (
          <div className="bg-amber-400 text-stone-950 p-3 rounded-xl w-full text-center font-black text-sm border-2 border-white shadow-lg">
            🏆 ዙሩ ተጠናቀቀ! አሸናፊ፦ {state.players[state.winnerId].name}!
          </div>
        )}

        {/* Player dock */}
        <div className="w-full bg-stone-950/70 backdrop-blur p-3.5 rounded-2xl border border-amber-900/30 shadow-2xl">

          {state.pendingMelds.length > 0 && (
            <div className="mb-3 p-2 bg-stone-900/70 rounded-lg border border-stone-800 flex gap-2 overflow-x-auto items-center">
              <span className="text-[10px] font-bold text-amber-400 whitespace-nowrap">የተዘጋጁ ስብስቦች፦</span>
              {state.pendingMelds.map((meld, i) => (
                <button
                  key={i}
                  onClick={() => dispatch({ type: 'REMOVE_PENDING_MELD', index: i })}
                  title="ለማንሳት ይጫኑ"
                  className="bg-stone-800 px-2 py-1 rounded text-[10px] border border-emerald-500/40 flex gap-1 font-bold hover:bg-stone-700"
                >
                  {meld.map((c) => `${c.rank}${getSuitSymbol(c.suit)}`).join(' ')}
                </button>
              ))}
              <button
                onClick={() => dispatch({ type: 'SUBMIT_DOWN' })}
                className="ml-auto bg-emerald-600 text-white font-bold text-[10px] px-2.5 py-1.5 rounded hover:bg-emerald-500"
              >
                አሁን ውረድ
              </button>
            </div>
          )}

          <div className="flex justify-between items-center text-[11px] mb-2 text-stone-400 px-1">
            <span className={state.currentTurn === 0 ? 'text-emerald-400 font-bold' : 'text-stone-400'}>
              {state.currentTurn === 0
                ? `🟢 ያንተ ተራ (${state.gamePhase === 'DRAW' ? 'ካርታ ማንሳት' : 'ካርታ መጣል'})`
                : '🔴 የኮምፒውተር ተራ...'}
            </span>
            <span className="text-amber-400 font-semibold">የአንተ እዳ፦ {user.score} ነጥብ</span>
          </div>

          <div className="flex gap-2 overflow-x-auto py-4 px-1 min-h-32 border-b border-stone-800 items-end">
            {user.hand.map((card) => (
              <div key={card.id} className="relative flex-shrink-0">
                <PlayingCard
                  card={card}
                  roundJokerRank={state.roundJoker.rank}
                  selected={state.selectedCardIds.includes(card.id)}
                  onClick={() => dispatch({ type: 'TOGGLE_SELECT_CARD', cardId: card.id })}
                />
                {state.gamePhase === 'PLAY' && state.currentTurn === 0 && (
                  <button
                    onClick={() => dispatch({ type: 'DISCARD', cardId: card.id })}
                    className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 bg-rose-700 text-white text-[9px] w-4 h-4 rounded-full font-bold flex items-center justify-center shadow border border-white"
                    title="ይህን ካርታ ጣል"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-between items-center mt-3">
            <span className="text-[10px] text-stone-500">
              {state.selectedCardIds.length > 0 ? `${state.selectedCardIds.length} ካርታ መርጠሃል` : 'ለመጣል ካርታው ስር ✕ ተጫን'}
            </span>
            <div className="flex gap-2">
              {state.selectedCardIds.length > 0 && (
                <button
                  onClick={() => dispatch({ type: 'CLEAR_SELECTION' })}
                  className="bg-stone-800 text-stone-400 text-[10px] px-2.5 py-1.5 rounded"
                >
                  አጽዳ
                </button>
              )}
              <button
                onClick={() => dispatch({ type: 'CREATE_MELD_GROUP' })}
                disabled={state.selectedCardIds.length < 3}
                className="bg-indigo-700 hover:bg-indigo-600 disabled:opacity-30 text-white font-bold text-[10px] px-3 py-1.5 rounded-lg transition"
              >
                ቡድን ስራ (Meld)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

    const jokerRank = cutCard.rank;

    const hands = [raw.splice(0, 14), raw.splice(0, 13), raw.splice(0, 13), raw.splice(0, 13)];

    setGameState({
      deck: raw,
      discardPile: [],
      roundJoker: cutCard,
      players: [
        { id: 0, name: "You (Robel)", hand: sortHand(hands[0]), hasDowned: false, score: gameState?.players[0]?.score || 0 },
        { id: 1, name: "Negus (Bot)", hand: hands[1], hasDowned: false, score: gameState?.players[1]?.score || 0 },
        { id: 2, name: "Aster (Bot)", hand: hands[2], hasDowned: false, score: gameState?.players[2]?.score || 0 },
        { id: 3, name: "Chala (Bot)", hand: hands[3], hasDowned: false, score: gameState?.players[3]?.score || 0 }
      ],
      currentTurn: 0,
      gamePhase: "PLAY", // Player with 14 cards skips initial draw and plays first
      winner: null
    });
    setSelectedCards([]);
    setPendingMelds([]);
  };

  useEffect(() => { startRound(); }, []);

  // Helper utility to sort user hands organically by rank and suit
  function sortHand(hand) {
    const rankOrder = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    return [...hand].sort((a, b) => a.suit.localeCompare(b.suit) || rankOrder.indexOf(a.rank) - rankOrder.indexOf(b.rank));
  }

  // Automated smart Bot Engine routine execution hook
  useEffect(() => {
    if (!gameState || gameState.winner || gameState.currentTurn === 0) return;

    const botTimer = setTimeout(() => {
      executeIntelligentBotTurn();
    }, 1200);
    return () => clearTimeout(botTimer);
  }, [gameState]);

  const executeIntelligentBotTurn = () => {
    let { deck, discardPile, players, currentTurn, roundJoker } = gameState;
    let bot = players[currentTurn];
    let botHand = [...bot.hand];

    // 1. Logic Draw Step
    let topDiscard = discardPile[discardPile.length - 1];
    let pulledCard;
    
    // Smart drawing choice: if down, check discard relevance, else draw standard bank
    if (bot.hasDowned && topDiscard && botHand.some(c => c.rank === topDiscard.rank)) {
      pulledCard = discardPile.pop();
    } else {
      pulledCard = deck.shift();
    }
    botHand.push(pulledCard);

    // 2. Simple Bot Discard Decision Strategy: Find single non-pair card
    let discardTarget = botHand[0];
    let remainingHand = botHand.filter(c => c.id !== discardTarget.id);

    let updatedPlayers = players.map((p, idx) => {
      if (idx === currentTurn) return { ...p, hand: remainingHand };
      return p;
    });

    if (remainingHand.length === 0) {
      handleWinTrigger(currentTurn);
      return;
    }

    setGameState({
      ...gameState,
      deck,
      discardPile: [...discardPile, discardTarget],
      players: updatedPlayers,
      currentTurn: (currentTurn + 1) % 4,
      gamePhase: "DRAW"
    });
  };

  const drawAction = (src) => {
    if (gameState.gamePhase !== "DRAW" || gameState.currentTurn !== 0) return;
    let { deck, discardPile, players } = gameState;
    let userHand = [...players[0].hand];
    let drawnCard;

    if (src === "DISCARD") {
      if (discardPile.length === 0) return;
      if (!players[0].hasDowned) {
        const confirmPick = window.confirm("ማሳሰቢያ፦ መሬት ላይ ያለውን ካርታ ለመውሰድ በዚህ ተራ መውረድ (41 መሙላት) አለብህ። እርግጠኛ ነህ?");
        if (!confirmPick) return;
      }
      drawnCard = discardPile.pop();
    } else {
      drawnCard = deck.shift();
    }

    userHand.push(drawnCard);
    let updatedPlayers = players.map((p, i) => i === 0 ? { ...p, hand: sortHand(userHand) } : p);

    setGameState({
      ...gameState,
      deck,
      discardPile,
      players: updatedPlayers,
      gamePhase: "PLAY"
    });
  };

  const discardAction = (cardId) => {
    if (gameState.gamePhase !== "PLAY" || gameState.currentTurn !== 0) return;
    let { discardPile, players } = gameState;
    let user = players[0];
    let cardToDrop = user.hand.find(c => c.id === cardId);
    let updatedHand = user.hand.filter(c => c.id !== cardId);

    let updatedPlayers = players.map((p, i) => i === 0 ? { ...p, hand: updatedHand } : p);

    if (updatedHand.length === 0) {
      handleWinTrigger(0);
      return;
    }

    setGameState({
      ...gameState,
      discardPile: [...discardPile, cardToDrop],
      players: updatedPlayers,
      currentTurn: 1,
      gamePhase: "DRAW"
    });
    setSelectedCards([]);
    setPendingMelds([]);
  };

  const handleWinTrigger = (winnerIdx) => {
    let updatedPlayers = gameState.players.map((p, idx) => {
      if (idx === winnerIdx) return p;
      let penalty = !p.hasDowned ? 100 : p.hand.reduce((s, c) => s + (c.rank === gameState.roundJoker.rank || c.rank === "JOKER" ? 20 : c.value), 0);
      return { ...p, score: p.score + penalty };
    });
    setGameState({ ...gameState, players: updatedPlayers, winner: gameState.players[winnerIdx].name });
  };

  const makeMeldGroup = () => {
    if (selectedCards.length < 3) {
      alert("አንድ ስብስብ ለመስራት ቢያንስ 3 ካርታ መምረጥ አለብህ!");
      return;
    }
    setPendingMelds([...pendingMelds, selectedCards]);
    setSelectedCards([]);
  };

  const submitExecution41Down = () => {
    const result = validateStandard41Down(pendingMelds, gameState.roundJoker.rank);
    if (result.valid) {
      alert(`🎉 እንኳን ደስ አለህ! በ${result.totalScore} ነጥብ ወርደሃል!`);
      let updatedPlayers = gameState.players.map((p, i) => {
        if (i === 0) {
          // Remove downed cards from hand permanently
          const flattenedDownedIds = pendingMelds.flat().map(c => c.id);
          const cleanHand = p.hand.filter(c => !flattenedDownedIds.includes(c.id));
          return { ...p, hand: cleanHand, hasDowned: true };
        }
        return p;
      });
      setGameState({ ...gameState, players: updatedPlayers });
      setPendingMelds([]);
    } else {
      alert(`⚠️ ውድቅ ተደርጓል፡ ${result.reason}`);
    }
  };

  function getSuitColor(suit) {
    return suit === "HEARTS" || suit === "DIAMONDS" ? "text-red-500" : "text-slate-200";
  }

  if (!gameState) return <div className="p-8 text-center text-amber-400 font-bold">የካርታ ጨዋታው ሞተር እየተነሳ ነው...</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-between font-sans selection:bg-transparent">
      {/* Dashboard Topbar */}
      <header className="bg-slate-950 p-4 flex justify-between items-center border-b border-slate-800 shadow-xl">
        <span className="text-emerald-400 font-black tracking-widest text-lg">CONQUER 41 🇪🇹</span>
        <button onClick={startRound} className="bg-emerald-600 hover:bg-emerald-500 px-4 py-1.5 rounded-lg text-xs font-bold transition">
          አዲስ ዙር ጀምር
        </button>
      </header>

      {/* Central Table Surface */}
      <div className="flex-1 max-w-4xl w-full mx-auto p-4 flex flex-col justify-between items-center my-2 gap-4">
        
        {/* Opponent Bots Stats */}
        <div className="grid grid-cols-3 w-full gap-3 text-center">
          {gameState.players.slice(1).map(bot => (
            <div key={bot.id} className={`p-2 rounded-xl bg-slate-950/60 border ${gameState.currentTurn === bot.id ? 'border-amber-400 shadow-lg shadow-amber-500/10' : 'border-slate-800'}`}>
              <div className="text-xs font-bold">{bot.name} {bot.hasDowned && '✅'}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">ካርታ: {bot.hand.length} | እዳ: {bot.score}</div>
            </div>
          ))}
        </div>

        {/* Center Deck Piles Arena */}
        <div className="flex items-center gap-6 bg-slate-950/40 p-6 rounded-2xl border border-slate-800/60 w-full max-w-md justify-center shadow-inner">
          {/* Deck Pile Bank Button */}
          <button 
            onClick={() => drawAction("BANK")} 
            disabled={gameState.gamePhase !== "DRAW" || gameState.currentTurn !== 0}
            className={`w-16 h-24 bg-gradient-to-b from-indigo-700 to-indigo-900 border-2 rounded-xl flex flex-col justify-between p-1.5 font-bold shadow-xl transition active:scale-95 disabled:opacity-40 ${gameState.gamePhase === "DRAW" && gameState.currentTurn === 0 ? 'border-amber-400 animate-pulse' : 'border-indigo-500'}`}
          >
            <span className="text-[10px] text-indigo-200">ባንክ</span>
            <span className="text-xl self-center">🎴</span>
            <span className="text-[10px] text-indigo-300 self-end">{gameState.deck.length}</span>
          </button>

          {/* Indicator Dynamic Cut Card */}
          <div className="w-14 h-22 bg-slate-800 rounded-xl border border-slate-700 flex flex-col justify-between p-1.5 text-[10px] items-center">
            <span className="text-slate-400">ጆከር</span>
            <span className={`text-sm font-black ${getSuitColor(gameState.roundJoker.suit)}`}>
              {gameState.roundJoker.rank}{getSuitSymbol(gameState.roundJoker.suit)}
            </span>
            <span className="bg-amber-500/20 text-amber-400 text-[8px] px-1 rounded">RULE</span>
          </div>

          {/* Discard Card Pile Container */}
          <button 
            onClick={() => drawAction("DISCARD")}
            disabled={gameState.gamePhase !== "DRAW" || gameState.currentTurn !== 0 || gameState.discardPile.length === 0}
            className={`w-16 h-24 rounded-xl flex flex-col justify-between p-1.5 bg-slate-950 font-bold border-2 transition active:scale-95 disabled:opacity-40 ${gameState.discardPile.length === 0 ? 'border-dashed border-slate-700 text-slate-600' : 'border-emerald-500 bg-white text-slate-950'}`}
          >
            {gameState.discardPile.length > 0 ? (
              <>
                <span className="text-[9px] text-slate-400">መሬት</span>
                <span className={`text-base font-black text-center block ${getSuitColor(gameState.discardPile[gameState.discardPile.length - 1].suit)}`}>
                  {gameState.discardPile[gameState.discardPile.length - 1].rank}
                  <span className="text-sm block">{getSuitSymbol(gameState.discardPile[gameState.discardPile.length - 1].suit)}</span>
                </span>
                <span className="text-[9px] text-slate-400 self-end">#{gameState.discardPile.length}</span>
              </>
            ) : <span className="m-auto text-[9px]">ባዶ መሬት</span>}
          </button>
        </div>

        {/* Win Screen Toast Overlay Notification */}
        {gameState.winner && (
          <div className="bg-amber-400 text-slate-950 p-3 rounded-xl w-full text-center font-black text-sm border shadow-lg border-white">
            🏆 ዙሩ ተጠናቀቀ! አሸናፊ፦ {gameState.winner}!
          </div>
        )}

        {/* User Workspace Panel Deck Console */}
        <div className="w-full bg-slate-950 p-3.5 rounded-2xl border border-slate-800 shadow-2xl">
          
          {/* Active Builder Workspace Indicator */}
          {pendingMelds.length > 0 && (
            <div className="mb-3 p-2 bg-slate-900 rounded-lg border border-slate-800 flex gap-2 overflow-x-auto items-center">
              <span className="text-[10px] font-bold text-amber-400 whitespace-nowrap">የተዘጋጁ ስብስቦች:</span>
              {pendingMelds.map((meld, i) => (
                <div key={i} className="bg-slate-800 px-2 py-1 rounded text-[10px] border border-emerald-500/30 flex gap-1 font-bold">
                  {meld.map(c => `${c.rank}${getSuitSymbol(c.suit)}`).join(' ')}
                </div>
              ))}
              <button onClick={submitExecution41Down} className="ml-auto bg-emerald-600 text-white font-bold text-[10px] px-2.5 py-1 rounded hover:bg-emerald-500">
                አሁን ውረድ
              </button>
            </div>
          )}

          {/* User Status Bar Meta Information */}
          <div className="flex justify-between items-center text-[11px] mb-2 text-slate-400 px-1">
            <span className={gameState.currentTurn === 0 ? "text-emerald-400 font-bold" : "text-slate-400"}>
              {gameState.currentTurn === 0 ? `🟢 ያንተ ተራ (${gameState.gamePhase} ደረጃ)` : '🔴 የኮምፒውተር ተራ...'}
            </span>
            <span className="text-amber-400 font-semibold">የአንተ እዳ: {gameState.players[0].score} ነጥብ</span>
          </div>

          {/* User Playing Hand Scroll Row Track */}
          <div className="flex gap-2 overflow-x-auto py-4 px-1 min-h-[125px] border-b border-slate-900 items-end">
            {gameState.players[0].hand.map((card) => {
              const selected = selectedCards.find(c => c.id === card.id);
              const isJoker = card.rank === gameState.roundJoker.rank || card.rank === "JOKER";
              return (
                <div key={card.id} className="relative flex-shrink-0">
                  <button
                    onClick={() => toggleSelectCard(card)}
                    className={`w-12 h-18 bg-white rounded-lg shadow-md flex flex-col justify-between p-1 font-black transform transition-all border text-slate-950
                      ${selected ? '-translate-y-4 border-amber-400 ring-2 ring-amber-400' : 'hover:-translate-y-1 border-transparent'} 
                      ${getSuitColor(card.suit)}`}
                  >
                    <span className="text-xs leading-none">{card.rank}</span>
                    <span className="text-lg self-center leading-none">{getSuitSymbol(card.suit)}</span>
                    {isJoker && <span className="text-[7px] bg-amber-500 text-white w-full text-center rounded-[2px] block py-0.5 font-bold scale-90">JOKER</span>}
                  </button>

                  {/* Immediate Discard action dot marker option */}
                  {gameState.gamePhase === "PLAY" && gameState.currentTurn === 0 && (
                    <button 
                      onClick={() => discardAction(card.id)}
                      className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[9px] w-4 h-4 rounded-full font-bold flex items-center justify-center shadow border border-white"
                    >
                      X
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom Controls Actions Panel Toolbar Wrapper */}
          <div className="flex justify-between items-center mt-3">
            <span className="text-[10px] text-slate-500">
              {selectedCards.length > 0 ? `${selectedCards.length} ካርታ መርጠሃል` : 'ለመጣል ከካርታው ስር X ተጫን'}
            </span>
            <div className="flex gap-2">
              {selectedCards.length > 0 && (
                <button onClick={() => setSelectedCards([])} className="bg-slate-800 text-slate-400 text-[10px] px-2 py-1 rounded">
                  አጽዳ
                </button>
              )}
              <button 
                onClick={makeMeldGroup} 
                disabled={selectedCards.length < 3}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 text-white font-bold text-[10px] px-3 py-1.5 rounded-lg transition"
              >
                ቡድን ስራ (Meld)
              </button>
            </div>
          </div>

        </div> {/* Closes inner container panel */}

      </div> {/* FIXED: Replaced </main> with </div> to match the original opening wrapper */}
    </div> {/* Closes main app background div */}
  );
}

export default App;
