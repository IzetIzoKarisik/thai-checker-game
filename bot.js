/* ==========================================================================
   Mak-hos (หมากฮอส) — the computer opponent.
   Uses rules.js only; knows nothing about the screen.

   The search works in whole turns ("full moves"): either one slide, or one
   complete capture chain from first jump to last (matching how a human
   plays a chain — see game.js's makeMove). That way the search never has to
   "discover" that a capture must be followed up; the forced continuation is
   already baked into every move it considers.

   It picks a move with iterative-deepening alpha-beta search (negamax form):
   try depth 1, then 2, then 3..., each one a full search of the position,
   until a time limit is hit — then it plays the best move the deepest
   *completed* depth found. A transposition table (a cache of positions seen
   before, keyed by a Zobrist hash) lets later, deeper searches skip or
   shortcut work the earlier ones already did.

   Everything runs on the main thread: this project has no server or build
   step and is opened straight from disk, where browsers refuse to start a
   Web Worker. A move is time-boxed (see BOT_LEVELS below) so the page only
   ever freezes briefly, not indefinitely.
   ========================================================================== */

const BOT_LEVELS = {
  easy:   { timeLimit: 250,  maxDepth: 4,  noise: 70 },   // shallow and a little careless
  medium: { timeLimit: 1000, maxDepth: 18, noise: 10 },
  hard:   { timeLimit: 3000, maxDepth: 60, noise: 0  },   // the strongest setting
};

/* ---------- Whole-turn move generation ---------- */

// Every full turn `color` may play right now: every maximal capture chain if
// any piece can capture (compulsory, as in rules.js), otherwise every slide.
function getFullMoves(board, color) {
  const capturers = getCapturers(board, color);
  if (capturers.length === 0) {
    const moves = [];
    for (const square of Object.keys(board)) {
      if (colorOf(board[square]) !== color) continue;
      for (const slide of getSlides(board, square)) moves.push({ from: square, steps: [slide] });
    }
    return moves;
  }

  const chains = [];
  for (const square of capturers) extendChain(board, square, square, [], chains);
  return chains;
}

// Depth-first walk of one piece's capture chain. Pushes every line that
// cannot (or, once crowned, must not) jump again into `out`.
function extendChain(board, from, startSquare, stepsSoFar, out) {
  for (const jump of getJumps(board, from)) {
    const next = { ...board };
    const crowned = applyMove(next, from, jump);
    const steps = [...stepsSoFar, jump];
    if (crowned || getJumps(next, jump.to).length === 0) out.push({ from: startSquare, steps });
    else extendChain(next, jump.to, startSquare, steps, out);
  }
}

// Plays every step of a full move and returns the resulting board.
function applyFullMove(board, move) {
  const next = { ...board };
  let square = move.from;
  for (const step of move.steps) {
    applyMove(next, square, step);
    square = step.to;
  }
  return next;
}

// A cheap, good-enough label for a move, used only to find "the same move
// again" across sibling positions (move ordering) — not shown to the player.
function moveKey(move) {
  return move.from + move.steps.map((step) => step.to).join("");
}

// Tries the transposition table's suggestion first, then longer capture
// chains before shorter ones and slides (usually the more forcing choice).
function orderMoves(moves, bestKey) {
  moves.sort((a, b) => b.steps.length - a.steps.length);
  if (!bestKey) return;
  const index = moves.findIndex((move) => moveKey(move) === bestKey);
  if (index > 0) moves.unshift(moves.splice(index, 1)[0]);
}

/* ---------- Position hashing, for the transposition table ---------- */

// Two independent Zobrist tables, combined into one key. One table alone
// gives only a 32-bit hash, and this search can visit enough positions in a
// few seconds that two different positions could land on the same number;
// combining two tables makes that practically impossible.
function buildZobristTable() {
  const table = {};
  for (let file = 0; file < 8; file++) {
    for (let rank = 0; rank < 8; rank++) {
      const square = makeSquare(file, rank);
      table[square] = {};
      for (const piece of ["w", "W", "b", "B"]) table[square][piece] = Math.floor(Math.random() * 2 ** 32);
    }
  }
  return table;
}
const ZOBRIST_A = buildZobristTable();
const ZOBRIST_B = buildZobristTable();
const ZOBRIST_TURN_A = Math.floor(Math.random() * 2 ** 32);
const ZOBRIST_TURN_B = Math.floor(Math.random() * 2 ** 32);

function hashKey(board, color) {
  let a = color === "b" ? ZOBRIST_TURN_A : 0;
  let b = color === "b" ? ZOBRIST_TURN_B : 0;
  for (const square in board) {
    a ^= ZOBRIST_A[square][board[square]];
    b ^= ZOBRIST_B[square][board[square]];
  }
  return a + "_" + b;
}

/* ---------- Evaluation: how good is this position for White? ---------- */

const MAN_VALUE = 100;
const KING_VALUE = 280;              // a flying king (this game's king) is worth a lot more than a man
const CENTER_BONUS = [0, 1, 2, 3, 3, 2, 1, 0];   // by file — edge files have fewer diagonals to use

let evalNoise = 0;                   // set per search; only Easy uses this, to make it beatable

// How many squares a side could move to right now (its captures if it has
// any forced ones, otherwise its slides). A rough stand-in for "freedom".
function mobility(board, color) {
  const capturers = getCapturers(board, color);
  const forced = capturers.length > 0;
  let total = 0;
  for (const square of Object.keys(board)) {
    if (colorOf(board[square]) !== color) continue;
    if (forced) { if (capturers.includes(square)) total += getJumps(board, square).length; }
    else total += getSlides(board, square).length;
  }
  return total;
}

function evaluate(board) {
  let score = 0;
  for (const square in board) {
    const piece = board[square];
    const color = colorOf(piece);
    const king = isKing(piece);
    const sign = color === "w" ? 1 : -1;
    const { file, rank } = parseSquare(square);

    let value = king ? KING_VALUE : MAN_VALUE;
    value += CENTER_BONUS[file] * 2;
    if (!king) {
      const progress = color === "w" ? rank : 7 - rank;        // 0 at home, 7 about to crown
      value += progress * 3;
      if (rank === (color === "w" ? 0 : 7)) value += 10;        // a guard still on the home row
    }
    score += sign * value;
  }
  score += (mobility(board, "w") - mobility(board, "b")) * 2;
  if (evalNoise) score += (Math.random() * 2 - 1) * evalNoise;
  return score;
}

/* ---------- Alpha-beta search (negamax form), with a transposition table ---------- */

const WIN_SCORE = 100000;
const DECIDED = WIN_SCORE - 1000;           // a score this big means the game is won (or lost) by force
const EXACT = 0, LOWER = 1, UPPER = 2;
const TIMED_OUT = Symbol("bot search timed out");

const transpositionTable = new Map();

function negamax(board, color, depth, alpha, beta, deadline, nodeCounter) {
  if (++nodeCounter.count % 2048 === 0 && performance.now() > deadline) throw TIMED_OUT;

  // One king each is solved exactly (see rules.js): a draw, or a win or loss in so many plies.
  const kings = kingVsKing(board, color);
  if (kings) return kings.result === "draw" ? 0 : kings.result === "win" ? WIN_SCORE - kings.plies : kings.plies - WIN_SCORE;

  const alphaAtStart = alpha;
  const key = hashKey(board, color);
  const entry = transpositionTable.get(key);
  if (entry && entry.depth >= depth) {
    if (entry.flag === EXACT) return entry.value;
    if (entry.flag === LOWER) alpha = Math.max(alpha, entry.value);
    else beta = Math.min(beta, entry.value);
    if (alpha >= beta) return entry.value;
  }

  const moves = getFullMoves(board, color);
  if (moves.length === 0) return -WIN_SCORE;             // no legal move: this side has lost
  if (depth === 0) {
    const value = evaluate(board) * (color === "w" ? 1 : -1);
    transpositionTable.set(key, { depth, value, flag: EXACT });
    return value;
  }

  orderMoves(moves, entry && entry.bestKey);

  let best = -Infinity;
  let bestKey = moveKey(moves[0]);
  for (const move of moves) {
    const value = -negamax(applyFullMove(board, move), otherColor(color), depth - 1, -beta, -alpha, deadline, nodeCounter);
    if (value > best) { best = value; bestKey = moveKey(move); }
    alpha = Math.max(alpha, best);
    if (alpha >= beta) break;
  }

  const flag = best <= alphaAtStart ? UPPER : best >= beta ? LOWER : EXACT;
  transpositionTable.set(key, { depth, value: best, flag, bestKey });
  return best;
}

// Would playing `move` end the game in a draw by the repetition or the
// quiet-move rule (see rules.js)? A move that wins outright is not a draw.
function endsInDraw(board, child, color, move, record) {
  if (!hasLegalMove(child, otherColor(color))) return false;
  if ((record.seen[positionKey(child, otherColor(color))] || 0) + 1 >= REPEAT_LIMIT) return true;
  const resetsCount = move.steps[0].captured || !isKing(board[move.from]);
  return !resetsCount && record.quiet + 1 >= QUIET_LIMIT;
}

// Picks the best full move for `color`. Searches a little deeper each pass
// (iterative deepening) until `level.timeLimit` runs out, and always has an
// answer ready: the best move found by the deepest pass that finished.
//
// `record` is optional: { seen, quiet } from the game (how often each position
// has happened, and how many quiet plies have passed). With it the bot knows
// when a move would give a draw and counts that move as 0 — so it avoids it
// when it is ahead, and gladly takes it when it is behind.
function findBestMove(board, color, level, record) {
  if (transpositionTable.size > 400000) transpositionTable.clear();   // keep memory bounded over a long session
  if ((level.noise || 0) !== evalNoise) transpositionTable.clear();   // values found with another amount of noise (another level) must not be reused
  evalNoise = level.noise || 0;

  const rootMoves = getFullMoves(board, color);
  if (rootMoves.length === 0) return null;
  if (rootMoves.length === 1) return rootMoves[0];        // forced: no need to think

  const started = performance.now();
  const deadline = started + level.timeLimit;
  const nodeCounter = { count: 0 };
  let best = rootMoves[0];
  let settledFor = 0;                                      // how many passes in a row chose the same move

  for (let depth = 1; depth <= level.maxDepth; depth++) {
    orderMoves(rootMoves, moveKey(best));
    let depthBest = best;
    let alpha = -Infinity;
    try {
      for (const move of rootMoves) {
        const child = applyFullMove(board, move);
        const value = record && endsInDraw(board, child, color, move, record)
          ? 0
          : -negamax(child, otherColor(color), depth - 1, -Infinity, -alpha, deadline, nodeCounter);
        if (value > alpha) { alpha = value; depthBest = move; }
      }
    } catch (signal) {
      if (signal !== TIMED_OUT) throw signal;
      break;                                               // out of time: keep the previous depth's answer
    }
    settledFor = moveKey(depthBest) === moveKey(best) ? settledFor + 1 : 0;
    best = depthBest;

    if (Math.abs(alpha) >= DECIDED) break;                 // a forced win (or loss) is found: looking deeper changes nothing
    if (depth >= 8 && settledFor >= 4 && performance.now() - started > level.timeLimit * 0.4) break;   // the choice has settled
    if (performance.now() > deadline) break;
  }
  return best;
}

// Would the computer accept a draw offered right now? Only if it is not clearly ahead.
function botAcceptsDraw(board, color) {
  evalNoise = 0;
  return evaluate(board) * (color === "w" ? 1 : -1) <= 20;
}
