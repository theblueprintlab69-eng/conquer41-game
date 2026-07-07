import React, { useState, useEffect } from 'react';

// ==========================================
// 1. GAME ENGINE CONSTANTS & UTILITIES
// ==========================================
const SUITS = ["HEARTS", "DIAMONDS", "CLUBS", "SPADES"];
const RANKS = [
  { rank: "A", value: 11 }, { rank: "2", value: 2 }, { rank: "3", value: 3 },
  { rank: "4", value: 4 }, { rank: "5", value: 5 }, { rank: "6", value: 6 },
  { rank: "7", value: 7 }, { rank: "8", value: 8 }, { rank: "9", value: 9 },
  { rank: "10", value: 10 }, { rank: "J", value: 10 }, { rank: "Q", value: 10 },
  { rank: "K", value: 10 }
];

function getSuitSymbol(suit) {
  if (suit === "HEARTS") return "❤️";
  if (suit === "DIAMONDS") return "♦️";
  if (suit === "CLUBS") return "♣️";
  if (suit === "SPADES") return "♠️";
  return "🃏";
}

// Generates 108 cards (2 decks + 4 Printed Jokers)
function generateConquerDeck() {
  let deck = [];
  for (let pack = 1; pack <= 2; pack++) {
    SUITS.forEach(suit => {
      RANKS.forEach(cardInfo => {
        deck.push({
          id: `${suit}_${cardInfo.rank}_pack${pack}`,
          suit: suit,
          rank: cardInfo.rank,
          value: cardInfo.value,
          isWildJoker: false
        });
      });
    });
  }
  for (let i = 1; i <= 4; i++) {
    deck.push({ id: `PRINTED_JOKER_${i}`, suit: "WILD", rank: "JOKER", value: 0, isWildJoker: true });
  }
  return deck;
}

function shuffleDeck(deck) {
  let shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ==========================================
// 2. MAIN COMPONENT
// ==========================================
export default function App() {
  const [gameState, setGameState] = useState(null);
  const [selectedCards, setSelectedCards] = useState([]);
  const [builtMelds, setBuiltMelds] = useState([]); // Temporary holder for cards layout down

  // Initialize a new round
  const startNewGame = () => {
    const rawDeck = generateConquerDeck();
    const shuffled = shuffleDeck(rawDeck);
    
    // Cut for designated round joker
    const cutCard = shuffled[shuffled.length - 1];
    const roundJokerRank = cutCard.rank;

    // Map all cards to track custom dynamic jokers
    const preparedDeck = shuffled.map(card => {
      if (card.rank === roundJokerRank || card.rank === "JOKER") {
        return { ...card, isWildJoker: true };
      }
      return card;
    });

    // Deal: Player 1 (User) gets 14 cards, Bots get 13
    const hands = [
      preparedDeck.splice(0, 14), // User
      preparedDeck.splice(0, 13), // Bot A
      preparedDeck.splice(0, 13), // Bot B
      preparedDeck.splice(0, 13)  // Bot C
    ];

    setGameState({
      deck: preparedDeck,
      discardPile: [],
      roundJoker: cutCard,
      players: [
        { id: 1, name: "You (Robel)", hand: hands[0], hasDowned: false, score: gameState?.players[0]?.score || 0, isBot: false },
        { id: 2, name: "AI Bot Negus", hand: hands[1], hasDowned: false, score: gameState?.players[1]?.score || 0, isBot: true },
        { id: 3, name: "AI Bot Aster", hand: hands[2], hasDowned: false, score: gameState?.players[2]?.score || 0, isBot: true },
        { id: 4, name: "AI Bot Chala", hand: hands[3], hasDowned: false, score: gameState?.players[3]?.score || 0, isBot: true }
      ],
      currentTurn: 0, // Player 1 starts because they have 14 cards
      gamePhase: "PLAY", // Starting player with 14 bypasses DRAW and must drop 1 card
      winner: null
    });
    setSelectedCards([]);
    setBuiltMelds([]);
  };

  useEffect(() => {
    startNewGame();
  }, []);

  // Handle Turn loop for Computer Bots automatically
  useEffect(() => {
    if (!gameState || gameState.winner) return;

    const activePlayer = gameState.players[gameState.currentTurn];
    if (activePlayer.isBot) {
      const timer = setTimeout(() => {
        executeBotTurn(activePlayer);
      }, 1500); // 1.5 seconds delay for realistic "thinking" pacing
      return () => clearTimeout(timer);
    }
  }, [gameState]);

  // ==========================================
  // 3. ACTION HANDLERS
  // ==========================================

  const handlePlayerDraw = (source) => {
    if (gameState.gamePhase !== "DRAW") return;
    
    let drawnCard;
    let updatedDeck = [...gameState.deck];
    let updatedDiscard = [...gameState.discardPile];

    if (source === "BANK") {
      drawnCard = updatedDeck.shift();
    } else {
      // Pick from top of discard pile
      if (updatedDiscard.length === 0) return;
      
      // Verification shortcut: If user has not downed, warn them
      if (!gameState.players[0].hasDowned) {
        alert("መሬት ላይ የተጣለውን ማንሳት የምትችለው አሁን ወዲያውኑ መውረድ (41/Dobio) የምትችል ከሆነ ብቻ ነው!");
      }
      drawnCard = updatedDiscard.pop();
    }

    const updatedPlayers = gameState.players.map((p, idx) => {
      if (idx === 0) return { ...p, hand: [...p.hand, drawnCard] };
      return p;
    });

    setGameState({
      ...gameState,
      deck: updatedDeck,
      discardPile: updatedDiscard,
      players: updatedPlayers,
      gamePhase: "PLAY"
    });
  };

  const handlePlayerDiscard = (cardId) => {
    if (gameState.gamePhase !== "PLAY" || gameState.currentTurn !== 0) return;

    const user = gameState.players[0];
    const cardToDrop = user.hand.find(c => c.id === cardId);
    const remainingHand = user.hand.filter(c => c.id !== cardId);

    const updatedDiscard = [...gameState.discardPile, cardToDrop];

    // Win condition check
    if (remainingHand.length === 0) {
      endRound(0); // User wins
      return;
    }

    const updatedPlayers = gameState.players.map((p, idx) => {
      if (idx === 0) return { ...p, hand: remainingHand };
      return p;
    });

    setGameState({
      ...gameState,
      discardPile: updatedDiscard,
      players: updatedPlayers,
      currentTurn: 1, // Pass turn to Bot A
      gamePhase: "DRAW"
    });
    setSelectedCards([]);
  };

  // Basic Computer Bot AI Routine
  const executeBotTurn = (bot) => {
    let updatedDeck = [...gameState.deck];
    let updatedDiscard = [...gameState.discardPile];
    let botHand = [...bot.hand];

    // 1. Draw Step
    let drawnCard = updatedDeck.shift();
    botHand.push(drawnCard);

    // 2. Play/Simulate logic step (Simplified bot: just throws away an unwanted card)
    const discardCard = botHand.shift();
    updatedDiscard.push(discardCard);

    // Check if bot emptied its hand
    if (botHand.length === 0) {
      endRound(gameState.currentTurn);
      return;
    }

    const updatedPlayers = gameState.players.map((p, idx) => {
      if (idx === gameState.currentTurn) return { ...p, hand: botHand };
      return p;
    });

    const nextTurn = (gameState.currentTurn + 1) % 4;

    setGameState({
      ...gameState,
      deck: updatedDeck,
      discardPile: updatedDiscard,
      players: updatedPlayers,
      currentTurn: nextTurn,
      gamePhase: "DRAW"
    });
  };

  const endRound = (winnerIdx) => {
    const winner = gameState.players[winnerIdx];
    
    const updatedPlayers = gameState.players.map((p, idx) => {
      if (idx === winnerIdx) return p;

      let scoreDelta = 0;
      if (!p.hasDowned) {
        scoreDelta = 100; // "በእጅ የተበላ" Penalty
      } else {
        scoreDelta = p.hand.reduce((acc, c) => acc + (c.isWildJoker ? 20 : c.value), 0);
      }

      return { ...p, score: p.score + scoreDelta };
    });

    setGameState({
      ...gameState,
      players: updatedPlayers,
      winner: winner.name
    });
  };

  const toggleSelectCard = (card) => {
    if (gameState.gamePhase !== "PLAY" || gameState.currentTurn !== 0) return;
    if (selectedCards.find(c => c.id === card.id)) {
      setSelectedCards(selectedCards.filter(c => c.id !== card.id));
    } else {
      setSelectedCards([...selectedCards, card]);
    }
  };

  // ==========================================
  // 4. RENDERING ENGINE UI
  // ==========================================
  if (!gameState) return <div className="text-center text-white mt-10">Loading Card Assets...</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-white font-sans flex flex-col justify-between select-none">
      {/* Top Header Panel */}
      <header className="bg-slate-950 p-4 flex justify-between items-center border-b border-slate-800">
        <h1 className="text-xl font-bold tracking-wider text-emerald-400">CONQUER 41</h1>
        <button onClick={startNewGame} className="bg-emerald-600 hover:bg-emerald-500 font-bold px-4 py-2 rounded text-sm transition">
          ዳግም ጀምር (Reset)
        </button>
      </header>

      {/* Main Board Table Canvas */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 flex flex-col justify-between items-center gap-6">
        
        {/* Opponent Bots Row */}
        <div className="grid grid-cols-3 w-full text-center gap-4">
          {gameState.players.filter(p => p.isBot).map((bot) => (
            <div key={bot.id} className={`p-3 rounded-lg border bg-slate-950/50 ${gameState.players[gameState.currentTurn].id === bot.id ? 'border-amber-400 animate-pulse' : 'border-slate-800'}`}>
              <div className="font-semibold text-sm">{bot.name}</div>
              <div className="text-xs text-slate-400 mt-1">🎴 {bot.hand.length} ካርታ | እዳ: {bot.score}</div>
            </div>
          ))}
        </div>

        {/* Center Shared Playing Pile Zone */}
        <div className="flex gap-8 items-center bg-slate-950/30 p-6 rounded-2xl border border-slate-800/40 w-full justify-center max-w-md">
          {/* Deck Bank */}
          <button 
            onClick={() => handlePlayerDraw("BANK")}
            disabled={gameState.gamePhase !== "DRAW" || gameState.currentTurn !== 0}
            className={`w-20 h-28 bg-gradient-to-br from-indigo-800 to-blue-900 rounded-xl shadow-2xl flex flex-col justify-between p-2 font-bold border-2 transition transform hover:scale-105 active:scale-95 disabled:opacity-50 ${gameState.gamePhase === "DRAW" && gameState.currentTurn === 0 ? 'border-amber-400 shadow-amber-500/20' : 'border-indigo-600'}`}
          >
            <div className="text-xs text-indigo-300">ባንክ</div>
            <div className="text-xl self-center">🔄</div>
            <div className="text-xs text-indigo-300 self-end">{gameState.deck.length}</div>
          </button>

          {/* Cut Card (Designated Round Joker indicator) */}
          <div className="w-16 h-24 bg-slate-800 rounded-lg border border-slate-700 flex flex-col justify-between p-1.5 opacity-80 text-xs">
            <span className="text-slate-400">ጆከር የቆረጠው</span>
            <span className={`text-base font-bold text-center ${gameState.roundJoker.suit === 'HEARTS' || gameState.roundJoker.suit === 'DIAMONDS' ? 'text-red-500' : 'text-slate-200'}`}>
              {gameState.roundJoker.rank}{getSuitSymbol(gameState.roundJoker.suit)}
            </span>
            <div className="w-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] text-center rounded">JOKER</div>
          </div>

          {/* Discard Pile */}
          <button 
            onClick={() => handlePlayerDraw("DISCARD")}
            disabled={gameState.gamePhase !== "DRAW" || gameState.currentTurn !== 0 || gameState.discardPile.length === 0}
            className={`w-20 h-28 bg-white rounded-xl shadow-2xl flex flex-col justify-between p-2 font-bold border-2 text-black transition transform hover:scale-105 active:scale-95 disabled:opacity-50 ${gameState.discardPile.length === 0 ? 'border-dashed border-slate-700 bg-transparent text-slate-600' : 'border-emerald-600'}`}
          >
            {gameState.discardPile.length > 0 ? (
              <>
                <div className="text-xs text-slate-400">መሬት</div>
                <div className={`text-2xl self-center ${gameState.discardPile[gameState.discardPile.length - 1].suit === 'HEARTS' || gameState.discardPile[gameState.discardPile.length - 1].suit === 'DIAMONDS' ? 'text-red-600' : 'text-black'}`}>
                  {gameState.discardPile[gameState.discardPile.length - 1].rank}
                  <span className="text-lg block text-center">{getSuitSymbol(gameState.discardPile[gameState.discardPile.length - 1].suit)}</span>
                </div>
                <div className="text-xs text-slate-400 self-end">#{gameState.discardPile.length}</div>
              </>
            ) : (
              <div className="m-auto text-xs font-normal">ባዶ መሬት</div>
            )}
          </button>
        </div>

        {/* Win Screen Overlay Banner */}
        {gameState.winner && (
          <div className="bg-amber-500 text-black font-extrabold w-full p-4 rounded-xl text-center text-lg shadow-lg border-2 border-white animate-bounce">
            🎉 ጨዋታው ተጠናቋል! አሸናፊ፦ {gameState.winner}! 
            <button onClick={startNewGame} className="block mx-auto mt-2 text-xs bg-slate-900 text-white px-3 py-1.5 rounded-md font-bold">ቀጣይ ዙር</button>
          </div>
        )}

        {/* User Active Control Console Area */}
        <div className="w-full bg-slate-950 p-4 rounded-2xl border border-slate-800">
          <div className="flex justify-between items-center text-xs text-slate-400 mb-3 px-1">
            <span>ያንተ ተራ፡ {gameState.currentTurn === 0 ? '🟢 ያንተ ተራ ነው' : '🔴 የኮምፒውተር ተራ'} ({gameState.gamePhase} ደረጃ)</span>
            <span className="font-bold text-amber-400">ጠቅላላ እዳህ፡ {gameState.players[0].score} ነጥብ</span>
          </div>

          {/* User Cards Row */}
          <div className="flex gap-1.5 overflow-x-auto py-3 px-1 justify-start border-b border-slate-900 min-h-[140px]">
            {gameState.players[0].hand.map((card) => {
              const isSelected = selectedCards.find(c => c.id === card.id);
              const isCardRed = card.suit === 'HEARTS' || card.suit === 'DIAMONDS';
              return (
                <div key={card.id} className="relative flex-shrink-0">
                  <button
                    onClick={() => toggleSelectCard(card)}
                    className={`w-14 h-22 bg-white text-black font-extrabold rounded-lg shadow-md flex flex-col justify-between p-1.5 transform transition-all border-2 
                      ${isSelected ? '-translate-y-5 border-amber-400 shadow-amber-400/30 ring-2 ring-amber-400' : 'hover:-translate-y-2 border-transparent'} 
                      ${isCardRed ? 'text-red-600' : 'text-slate-950'}`}
                  >
                    <div className="text-sm leading-none">{card.rank}</div>
                    <div className="text-xl self-center">{getSuitSymbol(card.suit)}</div>
                    {card.isWildJoker && <div className="text-[9px] w-full bg-amber-500 text-white py-0.5 text-center font-bold rounded-sm leading-none">JOKER</div>}
                  </button>
                  
                  {/* Quick Discard trigger action button visible during play configuration phase */}
                  {gameState.gamePhase === "PLAY" && gameState.currentTurn === 0 && (
                    <button 
                      onClick={() => handlePlayerDiscard(card.id)}
                      className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-black border border-white hover:bg-red-500 shadow-md"
                      title="ይህንን ካርታ መሬት ላይ ጣል"
                    >
                      X
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Active Control Actions Strip */}
          <div className="flex gap-2 justify-between items-center mt-4">
            <div className="text-xs text-slate-500">
              {selectedCards.length > 0 ? `${selectedCards.length} ካርታ መርጠሃል` : 'ለመጣል ከስር ያለውን X ተጫን'}
            </div>
            
            {/* Quick action buttons can be expanded here for 41 or Dobio validations */}
            <div className="flex gap-2">
              <button 
                onClick={() => {
                  if (selectedCards.length === 0) return;
                  alert("በ 41 ወይም ዶቢዮ ለመውረድ የተሟላ ስብስብ መስራት አለብህ (ይህ ህግ በቀጣይ ይዘመናል)።");
                }}
                disabled={selectedCards.length === 0} 
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black text-xs px-4 py-2 rounded-lg font-bold transition"
              >
                መሬት ላይ ዘርጋ (ውረድ)
              </button>
            </div>
          </div>

        </div>

      </main>
    </div>
  );
}
