/* ==========================================================================
   Mak-hos (หมากฮอส) — the rules.  No screen code in this file.

   The board is an object that maps a square name to a piece:
       { a1: "w", c3: "W", e5: "b" }
   "w" = white man, "W" = white king, "b" = black man, "B" = black king.
   Empty squares are simply missing from the object.

   Squares are named like chess: files a–h (left to right), ranks 1–8.
   White starts at the bottom (ranks 1–2) and moves UP.
   Black starts at the top (ranks 7–8) and moves DOWN.
   ========================================================================== */

const FILES = "abcdefgh";

// The four diagonals, as [file step, rank step].
const DIRECTIONS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];

/* ---------- Small helpers ---------- */

// "c3" -> { file: 2, rank: 2 }   (both counted from 0)
function parseSquare(square) {
  return { file: FILES.indexOf(square[0]), rank: Number(square[1]) - 1 };
}

// (2, 2) -> "c3"
function makeSquare(file, rank) {
  return FILES[file] + (rank + 1);
}

function isOnBoard(file, rank) {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

// Only the dark squares are used. a1 is dark.
function isDarkSquare(square) {
  const { file, rank } = parseSquare(square);
  return (file + rank) % 2 === 0;
}

function colorOf(piece) {
  return piece.toLowerCase();          // "W" -> "w"
}

function isKing(piece) {
  return piece === piece.toUpperCase();
}

function otherColor(color) {
  return color === "w" ? "b" : "w";
}

function forwardDirection(color) {
  return color === "w" ? 1 : -1;       // which way a man's rank changes
}

function crownRank(color) {
  return color === "w" ? 7 : 0;        // the far row, where a man becomes a king
}

/* ---------- Starting position ---------- */

function startBoard() {
  return {
    a1: "w", c1: "w", e1: "w", g1: "w", b2: "w", d2: "w", f2: "w", h2: "w",
    b8: "b", d8: "b", f8: "b", h8: "b", a7: "b", c7: "b", e7: "b", g7: "b",
  };
}

/* ---------- Finding moves ---------- */

// Every capture the piece on `from` can make right now (one jump each).
// Returns a list of { to, captured }.
//
//   man  : jumps an enemy on the next square, FORWARD only.
//   king : looks along the whole diagonal for the first piece. If it is an
//          enemy, the king jumps it and MUST land on the square directly
//          behind it (never further away).
function getJumps(board, from) {
  const piece = board[from];
  const color = colorOf(piece);
  const king = isKing(piece);
  const start = parseSquare(from);
  const jumps = [];

  for (const [df, dr] of DIRECTIONS) {
    if (!king && dr !== forwardDirection(color)) continue;   // men never capture backwards

    // Find the first thing in this direction. A man only looks at the next square.
    let file = start.file + df;
    let rank = start.rank + dr;
    while (king && isOnBoard(file, rank) && !board[makeSquare(file, rank)]) {
      file += df;
      rank += dr;
    }
    if (!isOnBoard(file, rank)) continue;

    const victim = board[makeSquare(file, rank)];
    if (!victim || colorOf(victim) === color) continue;      // nothing there, or our own piece

    // The landing square is directly behind the victim and must be empty.
    const landFile = file + df;
    const landRank = rank + dr;
    if (isOnBoard(landFile, landRank) && !board[makeSquare(landFile, landRank)]) {
      jumps.push({ to: makeSquare(landFile, landRank), captured: makeSquare(file, rank) });
    }
  }
  return jumps;
}

// Every plain (non-capturing) move of the piece on `from`.
//   man  : one square diagonally forward.
//   king : any distance along any diagonal, until something is in the way.
function getSlides(board, from) {
  const piece = board[from];
  const color = colorOf(piece);
  const king = isKing(piece);
  const start = parseSquare(from);
  const slides = [];

  for (const [df, dr] of DIRECTIONS) {
    if (!king && dr !== forwardDirection(color)) continue;

    let file = start.file + df;
    let rank = start.rank + dr;
    while (isOnBoard(file, rank) && !board[makeSquare(file, rank)]) {
      slides.push({ to: makeSquare(file, rank), captured: null });
      if (!king) break;                                      // a man moves one square only
      file += df;
      rank += dr;
    }
  }
  return slides;
}

// Squares of the pieces of `color` that are able to capture something.
function getCapturers(board, color) {
  return Object.keys(board).filter(
    (square) => colorOf(board[square]) === color && getJumps(board, square).length > 0
  );
}

// The moves the player is really allowed to make with the piece on `from`.
// Capturing is compulsory, so if any piece can capture, nothing else may move.
function getLegalMoves(board, from) {
  const jumps = getJumps(board, from);
  if (jumps.length > 0) return jumps;

  const mustCaptureWithAnotherPiece = getCapturers(board, colorOf(board[from])).length > 0;
  if (mustCaptureWithAnotherPiece) return [];

  return getSlides(board, from);
}

// Can this player move at all? If not, they lose.
function hasLegalMove(board, color) {
  return Object.keys(board).some(
    (square) => colorOf(board[square]) === color && getLegalMoves(board, square).length > 0
  );
}

/* ---------- Playing a move ---------- */

// Plays one step (a slide or a single jump) on the board.
// The captured piece is removed straight away.
// A man that lands on the far row is crowned. Returns true when that happens.
function applyMove(board, from, move) {
  const piece = board[from];
  delete board[from];
  if (move.captured) delete board[move.captured];

  const crowned = !isKing(piece) && parseSquare(move.to).rank === crownRank(colorOf(piece));
  board[move.to] = crowned ? piece.toUpperCase() : piece;
  return crowned;
}

// Number of pieces each side has: { w: 8, b: 8 }
function countPieces(board) {
  const counts = { w: 0, b: 0 };
  for (const piece of Object.values(board)) counts[colorOf(piece)]++;
  return counts;
}

/* ---------- Square numbers, positions and draws ---------- */

// The 32 dark squares are numbered 1–32, row by row, starting in the lower-left
// corner as Black sees the board (h8 = 1, f8 = 2, ... g1 = 29, ... a1 = 32).
// Black's men start on 1–8 and White's on 25–32. The numbers belong to the
// squares, so they stay put when the board is flipped.
function squareNumber(square) {
  const { file, rank } = parseSquare(square);
  const row = 7 - rank;                 // 0 = Black's back row
  const column = 7 - file;              // 0 = the left side, as Black sees it
  return row * 4 + Math.floor(column / 2) + 1;
}

// The other way round: 5 -> "g7"
function squareFromNumber(number) {
  const row = Math.floor((number - 1) / 4);
  const column = ((number - 1) % 4) * 2 + (row % 2);
  return makeSquare(7 - column, 7 - row);
}

// A text that is the same for equal positions with the same side to move.
function positionKey(board, color) {
  return color + Object.keys(board).sort().map((square) => square + board[square]).join("");
}

// Automatic draws (not from an official rulebook — see RULES.md):
const REPEAT_LIMIT = 3;                 // the same position this many times
const QUIET_LIMIT = 50;                 // this many moves (plies) in a row without a capture or a man move

/* ---------- One king against one king ---------- */

// With one king each, can anybody force a win? There are only 1984 such positions,
// so they are all solved once (when first needed) by working backwards from the
// positions where the side to move can capture. Almost all of them are draws; the
// few exceptions are a king trapped in a corner, where the side to move runs out
// of safe moves.
//
// Result: { "<white square><black square><side to move>": { result: "win" | "loss", plies } }
// (for the side to move; "plies" is how many half-moves the win or loss takes). A position that
// is missing from the table is a draw.
let kingEndgameTable = null;

function solveKingEndgame() {
  const squares = [];
  for (let number = 1; number <= 32; number++) squares.push(squareFromNumber(number));

  // The positions each move leads to, or null if the side to move can capture (and so wins at once).
  const next = {};
  for (const white of squares) {
    for (const black of squares) {
      if (white === black) continue;
      for (const turn of ["w", "b"]) {
        const board = { [white]: "W", [black]: "B" };
        const from = turn === "w" ? white : black;
        const key = white + black + turn;
        next[key] = getJumps(board, from).length > 0
          ? null
          : getSlides(board, from).map((slide) => (turn === "w" ? slide.to + black : white + slide.to) + otherColor(turn));
      }
    }
  }

  const table = {};
  for (const key in next) if (next[key] === null) table[key] = { result: "win", plies: 1 };

  let changed = true;
  while (changed) {
    changed = false;
    for (const key in next) {
      if (table[key]) continue;
      const moves = next[key];
      let fastestWin = Infinity;                 // a move that leaves the opponent lost
      let slowestLoss = 0;                       // if every move leaves the opponent winning
      let everyMoveLoses = true;
      for (const after of moves) {
        const outcome = table[after];
        if (outcome && outcome.result === "loss") fastestWin = Math.min(fastestWin, outcome.plies + 1);
        if (outcome && outcome.result === "win") slowestLoss = Math.max(slowestLoss, outcome.plies + 1);
        else everyMoveLoses = false;
      }
      if (fastestWin < Infinity) { table[key] = { result: "win", plies: fastestWin }; changed = true; }
      else if (everyMoveLoses) { table[key] = { result: "loss", plies: slowestLoss }; changed = true; }   // (also: no move at all = lost)
    }
  }
  return table;
}

// null if the board is not "one king each", otherwise { result: "win" | "loss" | "draw", plies } for `color`, the side to move.
function kingVsKing(board, color) {
  let white = null;
  let black = null;
  let count = 0;
  for (const square in board) {
    if (++count > 2) return null;
    if (board[square] === "W") white = square;
    else if (board[square] === "B") black = square;
  }
  if (!white || !black) return null;
  if (!kingEndgameTable) kingEndgameTable = solveKingEndgame();
  return kingEndgameTable[white + black + color] || { result: "draw", plies: 0 };
}
