/* ==========================================================================
   Mak-hos (หมากฮอส) — what the player does: clicking squares, dragging a
   piece, the keyboard, and stepping through the moves of the game.
   ========================================================================== */

// Can the player move a piece right now?
function canHumanMove() {
  return !game.winner && !isOpponentTurn() && view.review === null;
}

/* ==========================================================================
   Clicking
   ========================================================================== */

function onSquareClick(square) {
  if (!canHumanMove()) return;

  // Clicked a marked square: make that move.
  const move = game.targets.find((m) => m.to === square);
  if (game.selected && move) {
    makeMove(game.selected, move);
    return;
  }

  // In the middle of a capture chain nothing else can be clicked.
  if (game.chain) return;

  // Clicked one of our own pieces: select it. Anything else: deselect.
  const piece = game.board[square];
  const isOwnPiece = piece && colorOf(piece) === game.turn;
  if (isOwnPiece && square !== game.selected) {
    playSound("pick");
    select(square);
    render();
    if (game.targets.length === 0) nudge(square);
    return;
  }
  select(null);
  render();
}

// A piece that cannot move gives a little shake. If the reason is that another
// piece has to capture, those pieces flash to show which ones.
function nudge(square) {
  const capturers = getCapturers(game.board, game.turn);
  $(".piece", $(`[data-sq="${square}"]`))?.classList.add("is-shake");
  if (!capturers.includes(square)) {
    capturers.forEach((other) => $(`[data-sq="${other}"] .piece`)?.classList.add("is-flash"));
  }
  setTimeout(() => $$(".is-shake, .is-flash").forEach((piece) => piece.classList.remove("is-shake", "is-flash")), 700);
}

/* ==========================================================================
   Dragging a piece (mouse, pen and touch). A plain click still works too:
   dragging only starts after the pointer has moved a few pixels.
   ========================================================================== */

let drag = null;         // { from, id, x, y, active, piece } while a piece is being dragged
let lastDragEnd = -Infinity;   // when the last drag ended, so the click that follows it is ignored

function onPointerDown(event) {
  if (event.button !== 0 || !canHumanMove()) return;
  const square = event.target.closest(".sq--dark")?.dataset.sq;
  const piece = square && game.board[square];
  if (!piece || colorOf(piece) !== game.turn) return;
  if (game.chain && game.chain !== square) return;
  if (getLegalMoves(game.board, square).length === 0) return;
  drag = { from: square, id: event.pointerId, x: event.clientX, y: event.clientY, active: false, piece: null };
}

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.id) return;
  if (event.buttons === 0) { endDrag(event, true); return; }   // the button was let go somewhere we did not see: forget the drag
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.active) {
    if (Math.hypot(dx, dy) < 8) return;
    if (!canHumanMove()) { drag = null; return; }              // the game ended while the button was down
    startDrag();
  }
  drag.piece.style.translate = `${dx}px ${dy}px`;
}

function startDrag() {
  drag.active = true;
  if (game.selected !== drag.from) {
    playSound("pick");
    select(drag.from);
  }
  render();                                                  // shows where the piece can go (this rebuilds the board)
  drag.piece = $(`[data-sq="${drag.from}"] .piece`);
  drag.piece.classList.add("is-dragged");
  document.body.classList.add("is-dragging");
  try { $("#board").setPointerCapture(drag.id); } catch { /* the pointer is already gone: nothing to capture */ }
}

function endDrag(event, cancelled) {
  if (!drag || event.pointerId !== drag.id) return;
  const { from, active } = drag;
  drag = null;
  document.body.classList.remove("is-dragging");
  if (!active) return;                                       // it was only a click: onBoardClick handles it

  lastDragEnd = performance.now();
  const target = cancelled ? null : document.elementFromPoint(event.clientX, event.clientY)?.closest(".sq--dark");
  const move = canHumanMove() && target && game.selected === from && game.targets.find((m) => m.to === target.dataset.sq);   // (the game may have ended while the piece was held)
  if (move) makeMove(from, move, { dropped: true });
  else render();                                             // dropped somewhere else: the piece goes back
}

function onBoardClick(event) {
  if (performance.now() - lastDragEnd < 120) return;         // the click that ends a drag
  const square = event.target.closest(".sq--dark");
  if (square) onSquareClick(square.dataset.sq);
}

/* ==========================================================================
   Keyboard: Tab reaches the board once, the arrow keys move between squares,
   Enter or Space picks up and puts down, Esc lets go.
   ========================================================================== */

const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };   // [rows, lanes]

function onBoardKeydown(event) {
  const element = event.target.closest(".sq--dark");
  if (!element) return;

  const arrow = ARROWS[event.key];
  if (!arrow) return;
  event.preventDefault();
  const row = Number(element.dataset.row) + arrow[0];
  const lane = Number(element.dataset.lane) + arrow[1];       // each row has 4 dark squares, "lanes" 0–3
  $(`.sq--dark[data-row="${row}"][data-lane="${lane}"]`)?.focus();
}

// The square with the focus becomes the Tab stop.
function onBoardFocusIn(event) {
  const element = event.target.closest(".sq--dark");
  if (!element) return;
  view.focusSquare = element.dataset.sq;
  $$(".sq--dark").forEach((square) => { square.tabIndex = square === element ? 0 : -1; });
}

// Esc lets go of the selected piece. Outside the board the arrow keys step through the moves of the game.
function onDocumentKeydown(event) {
  if (dialogStack.length > 0 || event.altKey || event.ctrlKey || event.metaKey) return;

  if (event.key === "Escape") {
    if (game.selected && !game.chain && canHumanMove()) { select(null); render(); }
    return;
  }
  if (event.target.closest?.("#board, input, select, textarea") || !canReview()) return;

  // (Home and End keep scrolling the page, unless a review is open)
  if (event.key === "ArrowLeft") stepReview(-1);
  else if (event.key === "ArrowRight") stepReview(1);
  else if (event.key === "Home" && view.review !== null) reviewTo(0);
  else if (event.key === "End" && view.review !== null) reviewTo(game.moves.length);
  else return;
  event.preventDefault();
}

/* ==========================================================================
   Wiring
   ========================================================================== */

function bindInput() {
  const board = $("#board");
  board.addEventListener("click", onBoardClick);
  board.addEventListener("pointerdown", onPointerDown);
  board.addEventListener("pointermove", onPointerMove);
  board.addEventListener("pointerup", (event) => endDrag(event, false));
  board.addEventListener("pointercancel", (event) => endDrag(event, true));
  board.addEventListener("keydown", onBoardKeydown);
  board.addEventListener("focusin", onBoardFocusIn);
  document.addEventListener("keydown", onDocumentKeydown);

  // The move list and the review buttons
  $("#movelist").addEventListener("click", (event) => {
    const button = event.target.closest("[data-move]");
    if (button) reviewTo(Number(button.dataset.move) + 1);   // the position after that move
  });
  const steps = {
    first: () => reviewTo(0),
    prev: () => stepReview(-1),
    next: () => stepReview(1),
    last: () => reviewTo(game.moves.length),
  };
  $$("[data-review]").forEach((button) => button.addEventListener("click", steps[button.dataset.review]));
  $("#review-live").addEventListener("click", steps.last);
}
