import React, { useState, useEffect } from 'react';

// ============================================================================
// 1. ADVANCED ENGINE: CARD VALIDATION & COMBINATIONS RULES
// ============================================================================

// Evaluates if a single group of cards is a valid Run (Sera - consecutive same suit)
// or a valid Set (Tris - same rank, different suits)
function validateSingleGroup(cards, roundJokerRank) {
  if (cards.length < 3) return { valid: false, reason: "A group must have at least 3 cards." };

  // Separate regular cards from Wild Jokers
  const jokers = cards.filter(c => c.rank === roundJokerRank || c.rank === "JOKER");
  const regulars = cards.filter(c => c.rank !== roundJokerRank && c.rank !== "JOKER");

  if (regulars.length === 0) return { valid: true, type: "SET", score: 0 }; // All jokers proxy

  // Test Case A: Is it a SET (Tris)?
  const firstRank = regulars[0].rank;
  const isSet = regulars.every(c => c.rank === firstRank);
  if (isSet) {
    // Ensure no duplicate suits in a basic Set
    const suits = regulars.map(c => c.suit);
    const uniqueSuits = new Set(suits);
    if (suits.length !== uniqueSuits.size) {
      return { valid: false, reason: "Duplicate suits are not allowed in a Set (Tris)." };
    }
    // Score calculation for Set
    const score = cards.reduce((sum, c) => sum + (c.rank === roundJokerRank || c.rank === "JOKER" ? regulars[0].value : c.value), 0);
    return { valid: true, type: "SET", score };
  }

  // Test Case B: Is it a RUN (Sera)?
  const firstSuit = regulars[0].suit;
  const isSameSuit = regulars.every(c => c.suit === firstSuit);
  if (!isSameSuit) return { valid: false, reason: "Cards must share the same rank or the same suit." };

  // Map ranks to numeric indices for sorting runs
  const rankOrder = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  
  // Sort regular cards by order index
  const sortedIndices = regulars.map(c => rankOrder.indexOf(c.rank)).sort((a, b) => a - b);
  
  // Check gaps to see if available jokers can fill them
  let gapsNeeded = 0;
  for (let i = 0; i < sortedIndices.length - 1; i++) {
    const diff = sortedIndices[i+1] - sortedIndices[i] - 1;
    if (diff < 0) return { valid: false, reason: "Duplicate ranks in a Run are invalid." };
    gapsNeeded += diff;
  }

  if (gapsNeeded <= jokers.length) {
    // Calculated Score based on sequence positions
    const score = cards.reduce((sum, c) => sum + c.value, 0);
    return { valid: true, type: "RUN", score };
  }

  return { valid: false, reason: "Invalid sequence combinations." };
}

// Validates a full standard 41 down attempt across multiple melds
export function validateStandard41Down(melds, roundJokerRank) {
  let totalScore = 0;
  for (let m of melds) {
    const res = validateSingleGroup(m, roundJokerRank);
    if (!res.valid) return { valid: false, reason: res.reason };
    totalScore += res.score;
  }
  if (totalScore < 41) return { valid: false, reason: `စုစုပေါင်း ነጥብ ${totalScore} ነው። 41 መሙላት አለበት!` };
  return { valid: true, totalScore };
}

// ============================================================================
// 2. MAIN APPLICATION CORE UI & STATE MACHINE
// ============================================================================
const SUITS = ["HEARTS", "DIAMONDS", "CLUBS", "SPADES"];
const RANKS = [
  { rank: "A", value: 11 }, { rank: "2", value: 2 }, { rank: "3", value: 3 },
  { rank: "4", value: 4 }, { rank: "5", value: 5 }, { rank: "6", value: 6 },
  { rank: "7", value: 7 }, { rank: "8", value: 8 }, { rank: "9", value: 9 },
  { rank: "10", value: 10 }, { rank: "J", value: 10 }, { rank: "Q", value: 10 },
  { rank: "K", value: 10 }
];

function generateDeck() {
  let deck = [];
  for (let pack = 1; pack <= 2; pack++) {
    SUITS.forEach(suit => {
      RANKS.forEach(info => {
        deck.push({ id: `${suit}_${info.rank}_p${pack}`, suit, rank: info.rank, value: info.value });
      });
    });
  }
  for (let i = 1; i <= 4; i++) {
    deck.push({ id: `P_JOKER_${i}`, suit: "WILD", rank: "JOKER", value: 0 });
  }
  return deck;
}

export default function App() {
  const [gameState, setGameState] = useState(null);
  const [selectedCards, setSelectedCards] = useState([]);
  const [pendingMelds, setPendingMelds] = useState([]);

  const startRound = () => {
    let raw = generateDeck();
    // Fisher-Yates shuffle
    for (let i = raw.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [raw[i], raw[j]] = [raw[j], raw[i]];
    }

    const cutCard = raw[raw.length - 1];
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
