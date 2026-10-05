/* ==========================================================================
   Mak-hos (หมากฮอส) — the game: state, turns, clocks, draws, undo, the
   computer's turn and saving. Other files:
     rules.js  what moves are legal           bot.js    the computer's search
     render.js drawing the page               input.js  clicks, dragging, keyboard
     ui.js     dialogs, settings, start-up    sound.js, music.js  audio
     online.js playing a friend over the internet

   How a turn works
   1. Click (or drag) one of your pieces -> its legal squares are shown.
   2. Click a marked square              -> the piece moves there.
   3. If that was a capture and the same piece can jump again, it stays
      selected and you must keep jumping. Otherwise the turn passes.
   ========================================================================== */

const SIDE = {
  w: { name: "White", thai: "ฝ่ายขาว", player: "Player 2" },      // (Black moves first, so Black is Player 1)
  b: { name: "Black", thai: "ฝ่ายดำ", player: "Player 1" },
};
const PIECES_PER_SIDE = 8;
const LEVEL_NAMES = { easy: "Easy", medium: "Medium", hard: "Hard" };   // the levels themselves are in bot.js

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Things that belong to the page, not to the game.
const view = {
  orientation: "b",   // "b" = Black at the bottom (Black moves first), "w" = White at the bottom
  thinking: false,    // true while the computer is searching for its move
  review: null,       // null = the live game; a number = the position after that many moves
  missedMove: false,  // online: our friend moved while we were looking back through the game
  focusSquare: null,  // the board square that the Tab key stops at
};

let game;             // the current game, created by newGame()
let thinkToken = 0;   // bumped whenever a game starts or is undone, so a computer move left over from before is ignored

/* ==========================================================================
   1. Game state
   ========================================================================== */

// mode: "pvp" (two players on this screen), "bot" (you against the computer) or "online" (you against a friend far away)
// humanColor: the side you play against the computer or online; level: "easy" | "medium" | "hard"
// minutes: clock per player, 0 = no clock; room: online games only, see online.js
function newGame({ mode, humanColor, level, minutes, room }) {
  const board = startBoard();
  game = {
    mode, humanColor, botColor: otherColor(humanColor), level, minutes,
    room,             // online games: { code, role: "host" | "guest", token }; otherwise null
    board,
    turn: "b",        // Black moves first
    moves: [],        // finished moves: { path: ["c3", "e5"], capture: true, crowned: false }
    last: null,       // the last move (or the one being played): the same plus manMove (a man moved) and captured: ["d4"]
    selected: null,   // square of the selected piece
    targets: [],      // legal moves of the selected piece: [{ to, captured }]
    chain: null,      // square of the piece that is in the middle of a capture chain
    history: [],      // the position at the start of every turn: used by Undo and the review
    clock: minutes > 0 ? { w: minutes * 60, b: minutes * 60 } : null,   // seconds left when the running turn started
    turnStart: null,  // when the running clock started (a Date.now() time), null if no clock is running
    quiet: 0,         // moves in a row without a capture or a man move (for the draw rule)
    seen: { [positionKey(board, "b")]: 1 },   // how often each position has happened (for the draw rule)
    winner: null,     // "w", "b" or "draw" once the game is over
    reason: "",       // why the game ended
    claimed: null,    // online: "away" or "time" if the game ended because the friend was gone (see online.js), otherwise null
    endedAt: 0,       // when the game ended (a Date.now() time)
  };
}

// Starts a fresh game. side: "b", "w" or "random" (only matters against the computer or online).
// room: only for an online game that goes on in the room we are already in (see online.js).
function startGame({ mode, side, level, minutes, room = null }) {
  const humanColor = side === "random" ? (Math.random() < 0.5 ? "b" : "w") : side;
  if (room) newOnlineGame(); else leaveRoom();   // a new game of another kind ends the online game
  thinkToken++;                       // forget any computer move still pending from the game we are replacing
  view.thinking = false;
  view.review = null;
  gameOverWaiting = false;            // (render.js) a result window that was waiting for another window to close is no longer wanted
  newGame({ mode, humanColor, level, minutes: mode === "bot" ? 0 : minutes, room });
  view.orientation = mode === "pvp" ? "b" : humanColor;   // against the computer or online, your pieces are at the bottom
  clearSavedGame();
  closeDialog($("#gameover"));
  render();
  if (mode === "bot" && side === "random") toast(`You play ${SIDE[humanColor].name}.`);
  if (room) saveGame();               // so that a reload comes back to the room
  maybeBotMove();
}

function select(square) {
  game.selected = square;
  game.targets = square ? getLegalMoves(game.board, square) : [];
}

// True from the moment the human has moved until the computer has finished its whole move.
function isBotTurn() {
  return game.mode === "bot" && game.turn === game.botColor && !game.winner;
}

// Against the computer or online you play one side (humanColor); between two players on one screen both sides are "you".
function hasOwnSide() {
  return game.mode !== "pvp";
}

// True while somebody else has to move: the computer, or the friend online. (An online game that has stopped
// cannot be played on, so nobody may move in it.)
function isOpponentTurn() {
  return hasOwnSide() && (game.turn !== game.humanColor || onlineStopped()) && !game.winner;
}

// "You" and "Computer" / "Opponent", or the colour's name between two players.
function actorName(color) {
  if (!hasOwnSide()) return SIDE[color].name;
  if (color === game.humanColor) return "You";
  return game.mode === "bot" ? "Computer" : "Opponent";
}

// A move in words, for screen readers: "10 to 14", "14 × 21 × 28".
function moveText(move) {
  return move.path.map(squareNumber).join(move.capture ? " × " : " to ");
}

/* ==========================================================================
   2. Turn flow
   ========================================================================== */

// The position at the start of a turn, kept so Undo and the review can come back to it.
function snapshot() {
  return structuredClone({ board: game.board, turn: game.turn, last: game.last, quiet: game.quiet });
}

// Plays one step: a slide or a single jump.  options.dropped: the piece was dragged
// to its square, so it needs no sliding animation.  options.keepReview: a move of our friend's arrives while
// we look back through the game: stay where we are (online.js).
function makeMove(from, move, options = {}) {
  if (!options.keepReview) view.review = null;

  // First step of a new turn.
  if (!game.chain) {
    game.history.push(snapshot());
    game.last = { path: [from], capture: false, crowned: false, manMove: !isKing(game.board[from]), captured: [] };
  }

  const victim = move.captured ? { square: move.captured, piece: game.board[move.captured] } : null;
  const crowned = applyMove(game.board, from, move);
  game.last.path.push(move.to);
  game.last.crowned = crowned;
  if (move.captured) {
    game.last.capture = true;
    game.last.captured.push(move.captured);
  }

  if (!options.dropped) playSound("slide");
  setTimeout(playSound, options.dropped ? 0 : 250, move.captured ? "capture" : "move");   // when the piece lands
  if (crowned) setTimeout(playSound, 450, "crown");

  // A capture chain goes on if the same piece can jump again.
  // (A man that has just been crowned must stop.)
  const mustKeepJumping = move.captured && !crowned && getJumps(game.board, move.to).length > 0;
  if (mustKeepJumping) {
    game.chain = move.to;
    select(move.to);
  } else {
    finishTurn();
  }
  render({ from, to: move.to, captured: victim, skipSlide: options.dropped });
}

function finishTurn() {
  commitClock();
  const move = game.last;
  game.moves.push({ path: move.path, capture: move.capture, crowned: move.crowned });
  announce(`${actorName(game.turn)} played ${moveText(move)}.`);
  if (game.mode === "online" && game.turn === game.humanColor) sendMove(game.moves.length - 1, move.path, game.clock && game.clock[game.turn]);

  game.chain = null;
  select(null);
  game.turn = otherColor(game.turn);
  startClock();

  game.quiet = move.capture || move.manMove ? 0 : game.quiet + 1;
  const key = positionKey(game.board, game.turn);
  game.seen[key] = (game.seen[key] || 0) + 1;

  // The player who cannot move loses (that includes having no pieces left).
  if (!hasLegalMove(game.board, game.turn)) {
    const loser = game.turn;
    const hasNoPieces = countPieces(game.board)[loser] === 0;
    endGame(
      otherColor(loser),
      hasNoPieces ? `All ${SIDE[loser].name} pieces captured` : `${SIDE[loser].name} has no legal moves`
    );
    return;
  }
  const drawReason = automaticDrawReason();
  if (drawReason) {
    endGame("draw", drawReason);
    return;
  }
  saveGame();
  maybeBotMove();
}

// Why the game is a draw right now (without anybody agreeing to it), or null if it is not.
function automaticDrawReason() {
  if (kingVsKing(game.board, game.turn)?.result === "draw") return "One king each: neither side can force a win";
  if (game.seen[positionKey(game.board, game.turn)] >= REPEAT_LIMIT) return "The same position came up three times";
  if (game.quiet >= QUIET_LIMIT) return `No capture or man move in ${QUIET_LIMIT / 2} moves each`;
  return null;
}

function endGame(winner, reason) {
  commitClock();
  game.winner = winner;
  game.reason = reason;
  game.endedAt = Date.now();
  view.thinking = false;
  if (game.mode === "online") {
    onlineGameEnded();               // (online.js) does our friend know?
    saveGame();                      // kept, so that a reload still shows the result and a rematch can be asked for
  } else {
    clearSavedGame();
  }
  setTimeout(playSound, 400, "end");
  showGameOver();
}

/* ----- Undo, draw, resign ----- */

// Against the computer one Undo takes back your last move AND its reply, so it
// is your turn again. Between two players it takes back one move.
function canUndo() {
  if (game.winner || isBotTurn() || view.review !== null || game.mode === "online") return false;   // (online, nobody can take a move back)
  if (game.mode === "bot") return game.history.some((past) => past.turn === game.humanColor);
  return game.history.length > 0;
}

function undo() {
  if (!canUndo()) return;
  commitClock();
  let past;
  do {
    past = game.history.pop();
  } while (game.mode === "bot" && past.turn !== game.humanColor);

  Object.assign(game, past);                 // brings back board, turn, last and quiet
  game.moves.length = game.history.length;   // the moves played before that turn
  game.chain = null;
  recomputeSeen();
  thinkToken++;
  view.thinking = false;
  select(null);
  startClock();
  saveGame();
  render();
}

function canOfferDraw() {
  if (game.winner || isBotTurn() || game.moves.length === 0 || view.review !== null) return false;
  return game.mode !== "online" || canOfferOnlineDraw();
}

async function offerDraw() {
  if (!canOfferDraw()) return;

  if (game.mode === "online") {
    askOnlineDraw();
    return;
  }

  if (game.mode === "bot") {
    const ok = await askConfirm({ title: "Offer a draw?", text: "The computer will decide.", yes: "Offer draw" });
    if (!ok || game.winner || isBotTurn()) return;
    if (botAcceptsDraw(game.board, game.botColor)) {
      endGame("draw", "Draw by agreement");
      render();
    } else {
      toast("The computer declines the draw.");
    }
    return;
  }

  const asker = SIDE[game.turn].name;
  const other = SIDE[otherColor(game.turn)].name;
  const ok = await askConfirm({ title: `${asker} offers a draw`, text: `${other}, do you accept?`, yes: "Accept", no: "Decline" });
  if (!ok || game.winner) return;
  endGame("draw", "Draw by agreement");
  render();
}

async function resign() {
  if (game.winner) { openDialog($("#gameover")); return; }     // (the button says "Result" now: show it again)
  const loser = hasOwnSide() ? game.humanColor : game.turn;
  const ok = await askConfirm({
    title: "Resign?",
    text: hasOwnSide() ? "You will lose this game." : `${SIDE[loser].name}, do you really want to resign?`,
    yes: "Resign",
    danger: true,
  });
  if (!ok || game.winner) return;
  endGame(otherColor(loser), game.mode === "bot" ? "You resigned" : `${SIDE[loser].name} resigned`);
  if (game.mode === "online") sendOver();
  render();
}

function flipBoard() {
  view.orientation = view.orientation === "w" ? "b" : "w";
  saveGame();
  render();
}

/* ==========================================================================
   3. The computer's turn (the search itself is in bot.js)

   The bot always plays a whole turn at once — one slide, or a whole capture
   chain. It is fed back in through makeMove(), one step at a time with a
   short pause between them, so a chain plays out exactly like a human
   clicking through it: same animation, same sounds, same move log.
   ========================================================================== */

function maybeBotMove() {
  if (isBotTurn() && !view.thinking) requestBotMove();
}

function requestBotMove() {
  view.thinking = true;
  render();                             // shows "Computer is thinking…" before the (blocking) search below
  const token = thinkToken;
  setTimeout(() => runBotMove(token), 300);   // let the human's last move finish landing first
}

function runBotMove(token) {
  view.thinking = false;
  if (token !== thinkToken || game.winner) { render(); return; }   // a new game started while we were about to think

  const record = { seen: game.seen, quiet: game.quiet };
  const move = findBestMove(game.board, game.turn, BOT_LEVELS[game.level], record);
  if (token !== thinkToken) return;     // a new game started during the (blocking) search itself
  if (move) playBotMove(move.from, move.steps, 0, token);
  else render();                        // should not happen: finishTurn() already checked for a legal move
}

function playBotMove(square, steps, index, token) {
  if (token !== thinkToken || game.winner) return;
  makeMove(square, steps[index]);
  const to = steps[index].to;
  if (index + 1 < steps.length) setTimeout(() => playBotMove(to, steps, index + 1, token), 550);
}

/* ==========================================================================
   4. Clocks (only between two players; they start after Black's first move)

   The time left is worked out from the real time, so a busy or hidden tab
   does not make a clock run slow.
   ========================================================================== */

function startClock() {
  game.turnStart = game.clock && game.moves.length > 0 && !game.winner ? Date.now() : null;
}

// Takes the time of the running turn off the player's clock.
function commitClock() {
  if (game.clock && game.turnStart) game.clock[game.turn] -= (Date.now() - game.turnStart) / 1000;
  game.turnStart = null;
}

// Seconds left for a player, or null if there is no clock.
function clockLeft(color) {
  if (!game.clock) return null;
  const running = color === game.turn && game.turnStart;
  return Math.max(0, game.clock[color] - (running ? (Date.now() - game.turnStart) / 1000 : 0));
}

function tick() {
  if (game.mode === "online") showAwayCountdown();           // (online.js) "you can claim the win in 1:12"

  if (!game.clock || game.winner || !game.turnStart) return;

  if (clockLeft(game.turn) <= 0) {
    if (game.mode === "online" && game.turn !== game.humanColor) {   // our friend's flag: their own game tells us ...
      if (!claimTimeoutIfAway()) renderClocks();                      // ... unless they are gone (online.js)
      return;
    }
    commitClock();
    game.clock[game.turn] = 0;
    endGame(otherColor(game.turn), `${SIDE[game.turn].name} ran out of time`);
    if (game.mode === "online") sendOver();
    render();
  } else {
    renderClocks();
  }
}

/* ==========================================================================
   5. Reviewing earlier positions

   view.review is null while the live game is shown, otherwise the number of
   moves played in the position being looked at. history[n] is the position
   after n moves, so no extra bookkeeping is needed.
   ========================================================================== */

function canReview() {
  return game.moves.length > 0 && !game.chain && !isBotTurn();
}

function reviewTo(position) {
  if (!canReview()) return;
  view.review = position >= game.moves.length ? null : Math.max(0, position);
  select(null);
  render();
}

function stepReview(delta) {
  reviewTo((view.review === null ? game.moves.length : view.review) + delta);
}

/* ==========================================================================
   6. Saving the game, so a reload does not lose it

   A game against the computer or a friend on this screen is kept for the whole browser (localStorage).
   An online game is kept in two places:
     - in its tab (sessionStorage): a reload of this tab goes straight back into it, and two tabs on one
       computer can still play each other;
     - for the whole browser, under its room (localStorage "makhos.online.<ROOM>.<host|guest>"): so that a
       closed tab, a closed browser or a phone that threw the page away can come back to the game later.
   A tab that has an online game open writes the time into "<that key>.alive" every few seconds, so that
   another tab does not take over a game that is still open somewhere.
   ========================================================================== */

const SAVE_KEY = "makhos.game";
const ONLINE_SAVE_PREFIX = "makhos.online.";
const ONLINE_SAVE_HOURS = 24;          // an online game is not offered again after this long
const ALIVE_SECONDS = 10;              // a game whose tab wrote "alive" more recently than this is still open in that tab

function bumpSeen(key) {
  game.seen[key] = (game.seen[key] || 0) + 1;
}

// Works out how often each position has happened from the history.
function recomputeSeen() {
  game.seen = {};
  for (const past of game.history) bumpSeen(positionKey(past.board, past.turn));
  bumpSeen(positionKey(game.board, game.turn));
}

const onlineSaveKey = (room) => `${ONLINE_SAVE_PREFIX}${room.code}.${room.role}`;

function saveGame() {
  const finishedOnline = Boolean(game.winner) && Boolean(game.room);      // kept for the result and the rematch
  const inProgress = !game.winner && !game.chain && (game.moves.length > 0 || Boolean(game.room));   // (in the middle of a capture the board is not a position to come back to)
  if (!finishedOnline && !inProgress) return;
  try {
    const { mode, humanColor, level, minutes, room, board, turn, moves, last, history, quiet, winner, reason, claimed, endedAt } = game;
    const clock = game.clock && { w: clockLeft("w"), b: clockLeft("b") };
    const saved = { mode, humanColor, level, minutes, room, board, turn, moves, last, history, quiet, clock, winner, reason, claimed, endedAt };
    const text = JSON.stringify({ version: 1, orientation: view.orientation, savedAt: Date.now(), game: saved });
    if (game.room) {
      sessionStorage.setItem(SAVE_KEY, text);
      localStorage.setItem(onlineSaveKey(game.room), text);
      markOnlineGameAlive();                                  // (a game that has just started is open here already, before the first beat)
    } else {
      localStorage.setItem(SAVE_KEY, text);
    }
  } catch { /* private mode or storage full: the game just is not saved */ }
}

// The saved game of this tab (an online game), or null.
function thisTabsSavedGame() {
  try { return sessionStorage.getItem(SAVE_KEY); } catch { return null; }
}

function clearSavedGame() {
  try { localStorage.removeItem(SAVE_KEY); sessionStorage.removeItem(SAVE_KEY); } catch { /* nothing to do */ }
}

// Forgets the saved copies of an online game: it was left, or it can not go on.
function forgetOnlineGame(room) {
  if (!room) return;
  try {
    localStorage.removeItem(onlineSaveKey(room));
    localStorage.removeItem(onlineSaveKey(room) + ".alive");
    const inThisTab = JSON.parse(sessionStorage.getItem(SAVE_KEY))?.game?.room;
    if (inThisTab && inThisTab.code === room.code) sessionStorage.removeItem(SAVE_KEY);
  } catch { /* nothing to do */ }
}

// Called every few seconds: "this tab has the online game open".
function markOnlineGameAlive() {
  if (!game.room || game.winner) return;
  try { localStorage.setItem(onlineSaveKey(game.room) + ".alive", String(Date.now())); } catch { /* not saved */ }
}

function markOnlineGameClosed() {
  if (!game.room) return;
  try { localStorage.removeItem(onlineSaveKey(game.room) + ".alive"); } catch { /* not saved */ }
}

// The unfinished online games saved for the whole browser that no tab has open, newest first: { text, saved }.
// Old and damaged copies are thrown away on the way.
function savedOnlineGames() {
  const found = [];
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(ONLINE_SAVE_PREFIX) || key.endsWith(".alive")) continue;
      const text = localStorage.getItem(key);
      let data = null;
      try { data = JSON.parse(text); } catch { /* damaged: thrown away below */ }
      const saved = data && data.version === 1 && data.game;
      const fresh = saved && Date.now() - data.savedAt < ONLINE_SAVE_HOURS * 3600 * 1000;
      if (!saved || !fresh || !isSavedGameValid(saved)) { localStorage.removeItem(key); localStorage.removeItem(key + ".alive"); continue; }
      const openElsewhere = Date.now() - Number(localStorage.getItem(key + ".alive")) < ALIVE_SECONDS * 1000;
      if (!saved.winner && !openElsewhere) found.push({ text, saved, savedAt: data.savedAt });
    }
  } catch { /* no storage: nothing to find */ }
  return found.sort((a, b) => b.savedAt - a.savedAt);
}

function isBoardValid(board) {
  if (!board || typeof board !== "object") return false;
  const counts = { w: 0, b: 0 };
  for (const square of Object.keys(board)) {
    if (!/^[a-h][1-8]$/.test(square) || !isDarkSquare(square) || !/^[wWbB]$/.test(board[square])) return false;
    counts[colorOf(board[square])]++;
  }
  return counts.w <= PIECES_PER_SIDE && counts.b <= PIECES_PER_SIDE;       // (nobody ever has more than they started with)
}

// The last move of a saved position: nothing yet, or the squares it touched and the pieces it took.
function isLastMoveValid(last) {
  const squares = (list) => Array.isArray(list) && list.every((square) => /^[a-h][1-8]$/.test(square));
  return last === null || (Boolean(last) && squares(last.path) && (last.captured === undefined || squares(last.captured)));
}

function isSavedGameValid(saved) {
  const isColor = (value) => value === "w" || value === "b";
  const isMove = (move) => Boolean(move) && Array.isArray(move.path) && move.path.every((square) => /^[a-h][1-8]$/.test(square));
  const isOnline = saved.mode === "online";
  const finished = saved.winner !== null && saved.winner !== undefined;       // (only an online game is kept after it ended)
  const unfinishedTurns = Array.isArray(saved.history) && Array.isArray(saved.moves) ? saved.history.length - saved.moves.length : NaN;   // 1 if the game ended in the middle of a capture
  return (saved.mode === "pvp" || saved.mode === "bot" || isOnline)
    && isColor(saved.turn) && isColor(saved.humanColor)
    && Boolean(BOT_LEVELS[saved.level])
    && isBoardValid(saved.board)
    && Array.isArray(saved.moves) && saved.moves.every(isMove)
    && isLastMoveValid(saved.last ?? null)
    && Array.isArray(saved.history) && saved.history.every((past) => past && isBoardValid(past.board) && isColor(past.turn) && isLastMoveValid(past.last ?? null))
    && (saved.moves.length > 0 || isOnline) && (unfinishedTurns === 0 || (finished && unfinishedTurns === 1))   // (an online game is saved from the moment it starts)
    && (isOnline ? isRoomValid(saved.room) : !saved.room)
    && (!finished || (isOnline && ["w", "b", "draw"].includes(saved.winner) && typeof saved.reason === "string"))
    && (saved.claimed == null || saved.claimed === "away" || saved.claimed === "time")
    && (saved.clock == null || (typeof saved.clock.w === "number" && typeof saved.clock.b === "number"));
}

// Brings back the game saved by saveGame() (`text`: a saved copy; without it, the one of this tab or of this browser).
// Returns false if there is none, or it looks damaged.
function restoreSavedGame(text) {
  try {
    const data = JSON.parse(text === undefined ? sessionStorage.getItem(SAVE_KEY) || localStorage.getItem(SAVE_KEY) : text);
    const saved = data && data.version === 1 && data.game;
    if (!saved || !isSavedGameValid(saved)) return false;

    thinkToken++;                          // (a computer move still being thought up for the game we replace is forgotten)
    game = {
      ...saved, botColor: otherColor(saved.humanColor), minutes: saved.minutes || 0, clock: saved.clock || null, room: saved.room || null,
      selected: null, targets: [], chain: null, turnStart: null, seen: {},
      winner: saved.winner ?? null, reason: saved.reason || "", claimed: saved.claimed || null, endedAt: saved.endedAt || 0,
      savedAt: Number.isFinite(data.savedAt) ? data.savedAt : 0,      // (online.js uses it after a reload: how long ago we last heard from our friend)
    };
    recomputeSeen();
    startClock();
    // An online game goes on counting while its page is closed: a reload or a closed tab gives no time back.
    if (game.room && game.turnStart && Number.isFinite(data.savedAt)) game.turnStart = Math.min(game.turnStart, data.savedAt);
    view.orientation = data.orientation === "w" ? "w" : "b";
    view.review = null;
    view.thinking = false;
    return true;
  } catch {
    return false;
  }
}
