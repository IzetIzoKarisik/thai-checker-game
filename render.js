/* ==========================================================================
   Mak-hos (หมากฮอส) — drawing the page.
   Nothing here changes the game: it only shows `game` and `view` (and, while
   reviewing, an earlier position).
   ========================================================================== */

const BASE_TITLE = document.title;
const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function render(step) {
  if (view.review !== null && view.review >= game.moves.length) view.review = null;
  const focusedSquare = document.activeElement?.dataset?.sq;   // keep keyboard focus on the board
  if (focusedSquare) view.focusSquare = focusedSquare;

  renderBoard();
  renderStatus();
  renderPlayers();
  renderMoveList();
  renderControls();
  renderModeChip();
  updateTitle();

  if (focusedSquare) $(`[data-sq="${focusedSquare}"]`)?.focus();
  if (step && view.review === null) {                          // (a move that arrives while we look back is not animated on the old position)
    if (!step.skipSlide) animatePiece(step.from, step.to);
    fadeCaptured(step.captured);
  }
}

// The board is shown by screen readers one message at a time: messages sent in
// the same moment are joined, so none of them is lost.
let pendingAnnouncements = [];
function announce(text) {
  if (pendingAnnouncements.length === 0) {
    setTimeout(() => {
      $("#announcer").textContent = pendingAnnouncements.join(" ");
      pendingAnnouncements = [];
    }, 60);
  }
  pendingAnnouncements.push(text);
}

/* ==========================================================================
   Board
   ========================================================================== */

// What the board shows: the live game, or an earlier position while reviewing.
function shownPosition() {
  if (view.review === null) return { board: game.board, last: game.last, live: true };
  const past = game.history[view.review];
  return { board: past.board, last: past.last, live: false };
}

// Creates the 64 empty squares in the current orientation.
function buildBoard() {
  const board = $("#board");
  board.innerHTML = "";

  const blackAtBottom = view.orientation === "b";
  const ranks = blackAtBottom ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const files = blackAtBottom ? [...FILES].reverse() : [...FILES];

  ranks.forEach((rank, row) => {
    const rowElement = document.createElement("div");
    rowElement.className = "board-row";
    rowElement.setAttribute("role", "row");

    files.forEach((file, column) => {
      const square = file + rank;
      const dark = isDarkSquare(square);

      // Dark squares are buttons (clickable and reachable with the keyboard).
      const element = document.createElement(dark ? "button" : "div");
      element.className = `sq ${dark ? "sq--dark" : "sq--light"}`;
      element.style.setProperty("--c", column);               // where the square is (for the marble boards)
      element.style.setProperty("--r", row);
      if (dark) {
        element.type = "button";
        element.dataset.sq = square;
        element.dataset.row = row;                          // for the arrow keys
        element.dataset.lane = Math.floor(column / 2);
        element.tabIndex = -1;                              // only one square is a Tab stop (see updateTabStop)
        element.setAttribute("role", "gridcell");
        element.insertAdjacentHTML("beforeend", `<span class="sq-num" aria-hidden="true">${squareNumber(square)}</span>`);
      } else {
        element.setAttribute("aria-hidden", "true");
      }
      rowElement.appendChild(element);
    });
    board.appendChild(rowElement);
  });
}

function pieceName(piece) {
  return `${SIDE[colorOf(piece)].name} ${isKing(piece) ? "king" : "man"}`;
}

function pieceHTML(piece) {
  const color = colorOf(piece);
  const king = isKing(piece);
  const crown = king ? `<svg class="crown" aria-hidden="true"><use href="#i-crown"/></svg>` : "";
  return `<div class="piece piece--${color}${king ? " piece--king" : ""}" aria-hidden="true">${crown}</div>`;
}

function renderBoard() {
  buildBoard();
  const { board, last, live } = shownPosition();
  const humanMoves = live && !game.winner && !isOpponentTurn();    // only then are moves offered

  for (const [square, piece] of Object.entries(board)) {
    $(`[data-sq="${square}"]`).insertAdjacentHTML("beforeend", pieceHTML(piece));
  }

  const squareElement = (square) => $(`[data-sq="${square}"]`);
  const markSquare = (square, className) => squareElement(square).classList.add(className);
  const markPiece = (square, className) => $(".piece", squareElement(square))?.classList.add(className);

  // The last move: every square it touched, and a faint × where a piece was taken
  if (last) {
    last.path.forEach((square) => markSquare(square, "is-last"));
    (last.captured || []).forEach((square) => {
      squareElement(square).insertAdjacentHTML("beforeend", `<span class="x-mark" aria-hidden="true"></span>`);
    });
  }

  if (humanMoves) {
    // Selected piece, where it can go, and which pieces it would capture
    if (game.selected) markSquare(game.selected, "is-selected");
    for (const move of game.targets) {
      markSquare(move.to, move.captured ? "is-capture-target" : "is-target");
      squareElement(move.to).insertAdjacentHTML("beforeend", `<span class="${move.captured ? "hint-ring" : "hint-dot"}" aria-hidden="true"></span>`);
      if (move.captured) {                                   // the piece that would be taken
        markPiece(move.captured, "is-ghost");
        markSquare(move.captured, "is-victim");
      }
    }

    // Pieces that must capture glow; pieces that can move lift when hovered.
    const capturers = game.chain ? [game.chain] : getCapturers(game.board, game.turn);
    capturers.forEach((square) => markPiece(square, "is-must"));

    const mine = Object.keys(game.board).filter((square) => colorOf(game.board[square]) === game.turn);
    const movable = game.chain ? [game.chain] : mine.filter((square) => getLegalMoves(game.board, square).length > 0);
    movable.forEach((square) => markPiece(square, "piece--movable"));
  }

  // Names for screen readers: "Square 14, Black man, selected"
  for (const element of $$(".sq--dark")) {
    const piece = board[element.dataset.sq];
    let label = `Square ${squareNumber(element.dataset.sq)}, ${piece ? pieceName(piece) : "empty"}`;
    if (element.classList.contains("is-selected")) label += ", selected";
    if (element.classList.contains("is-capture-target")) label += ", capture landing square";
    else if (element.classList.contains("is-target")) label += ", move here";
    element.setAttribute("aria-label", label);
  }
  updateTabStop();
}

// Only one square is reached by the Tab key (then the arrow keys move around).
function updateTabStop() {
  const stop = (view.focusSquare && $(`[data-sq="${view.focusSquare}"]`))
    || (game.selected && $(`[data-sq="${game.selected}"]`))
    || $(".piece--movable")?.closest(".sq")
    || $(".sq--dark");
  stop.tabIndex = 0;
}

// Picks the piece up, carries it to its new square and puts it down.
function animatePiece(from, to) {
  const piece = $(`[data-sq="${to}"] .piece`);
  if (!piece || prefersReducedMotion()) return;

  const a = $(`[data-sq="${from}"]`).getBoundingClientRect();
  const b = $(`[data-sq="${to}"]`).getBoundingClientRect();
  const dx = a.left - b.left;
  const dy = a.top - b.top;
  piece.style.zIndex = 4;                                    // stay on top while moving
  piece.animate(
    [
      { translate: `${dx}px ${dy}px`, scale: 1 },
      { translate: `${dx / 2}px ${dy / 2}px`, scale: 1.14, offset: 0.5 },   // lifted in the middle
      { translate: "0 0", scale: 1 },
    ],
    { duration: 260, easing: "ease-in-out" }
  ).onfinish = () => { piece.style.zIndex = ""; };

  if (game.last.crowned) piece.classList.add("is-promoted");
}

// A captured piece shrinks and fades away on its square, instead of vanishing.
function fadeCaptured(captured) {
  if (!captured || prefersReducedMotion()) return;
  const square = $(`[data-sq="${captured.square}"]`);
  square.insertAdjacentHTML("beforeend", pieceHTML(captured.piece));
  const ghost = square.lastElementChild;
  ghost.classList.add("is-captured");
  ghost.addEventListener("animationend", () => ghost.remove());
}

/* ==========================================================================
   Status (the card in the side panel, and the strip under the board on phones)
   ========================================================================== */

// How the game ended, in words.
function resultInfo() {
  const winner = game.winner;
  if (winner === "draw") return { title: "Draw!", short: "Draw", thai: "เสมอ" };
  if (hasOwnSide()) {
    const opponent = game.mode === "bot" ? "Computer" : "Opponent";
    return winner === game.humanColor
      ? { title: "You win!", short: "You win", thai: "คุณชนะ!" }
      : { title: `${opponent} wins`, short: `${opponent} wins`, thai: game.mode === "bot" ? "คอมพิวเตอร์ชนะ" : "คู่ต่อสู้ชนะ" };
  }
  return { title: `${SIDE[winner].name} wins!`, short: `${SIDE[winner].name} wins`, thai: `${SIDE[winner].thai}ชนะ` };
}

function currentStatus() {
  const dot = game.turn;

  if (view.review !== null) {
    return {
      tone: "calm", dot,
      title: `Reviewing move ${view.review} of ${game.moves.length}`,
      text: matchMedia("(pointer: fine)").matches ? "Step with ◀ ▶ or the arrow keys. Back to game returns." : "Step with ◀ ▶. Back to game returns.",
    };
  }
  if (game.winner) {
    return { tone: "done", title: `Game over · ${resultInfo().short}`, text: game.reason, dot: game.winner === "draw" ? dot : game.winner };
  }
  if (game.mode === "online" && !onlineConnected()) return onlineTroubleStatus(dot);
  if (isBotTurn()) {
    return { tone: "calm", dot, title: view.thinking ? "Computer is thinking…" : "Computer is moving…", text: "Please wait for its move." };
  }
  if (isOpponentTurn()) {                                    // online: our friend is moving
    return { tone: "calm", dot, title: "Opponent's move", text: "Waiting for your opponent to move." };
  }
  if (game.chain) {
    return { tone: "warn", dot, title: "Keep jumping!", text: `The piece on ${squareNumber(game.chain)} must continue capturing.` };
  }

  const title = hasOwnSide() ? "Your move" : `${SIDE[game.turn].name} to move`;
  if (getCapturers(game.board, game.turn).length > 0) {
    let text;
    if (!game.selected) text = "Select a glowing piece and jump over an enemy piece.";
    else if (game.targets.length === 0) text = "That piece cannot capture. Select a glowing piece.";
    else text = `${squareNumber(game.selected)} selected · jump to a marked square.`;
    return { tone: "warn", dot, title: "Capture is compulsory", text };
  }
  if (game.selected) {
    const count = game.targets.length;
    const text = count === 0 ? "That piece cannot move." : `${squareNumber(game.selected)} selected · ${count} move${count > 1 ? "s" : ""} available.`;
    return { tone: "", dot, title, text };
  }
  return { tone: "", dot, title, text: "Select a piece to see its moves." };
}

let lastAnnouncedStatus = "";

function renderStatus() {
  const { tone, title, text, dot, claim } = currentStatus();
  for (const id of ["status", "statusbar"]) {
    const box = $(`#${id}`);
    box.className = `${id}${tone ? " is-" + tone : ""}`;
    $("[data-turn-dot]", box).dataset.color = dot;
    $(".js-title", box).textContent = title;
    $(".js-text", box).textContent = text;
    $(".js-claim", box).hidden = !claim;                       // online: the friend has been gone long enough to take the win
  }
  if (title !== lastAnnouncedStatus) {                       // tell screen readers when the situation changes
    lastAnnouncedStatus = title;
    announce(`${title}. ${text}`);
  }
}

/* ==========================================================================
   Player cards, clocks, controls
   ========================================================================== */

// Against the computer your side is "You" and the other is "Computer · Hard".
function playerLabel(color) {
  if (!hasOwnSide()) return SIDE[color].player;
  if (color === game.humanColor) return "You";
  return game.mode === "bot" ? `Computer · ${LEVEL_NAMES[game.level]}` : "Opponent";
}

function renderPlayers() {
  const counts = countPieces(game.board);
  const [topColor, bottomColor] = view.orientation === "b" ? ["w", "b"] : ["b", "w"];

  for (const [selector, color] of [["#player-top", topColor], ["#player-bottom", bottomColor]]) {
    const bar = $(selector);
    const enemy = otherColor(color);
    const thinking = view.thinking && game.turn === color;
    const lead = counts[color] - counts[enemy];

    bar.dataset.color = color;
    $(".mini-piece", bar).className = `mini-piece mini-piece--${color}`;
    $(".player__who", bar).textContent = playerLabel(color);
    $(".player__side", bar).innerHTML = `${SIDE[color].name}<span class="player__thai" lang="th"> · ${SIDE[color].thai}</span>`;   // (fixed texts, no user input)
    $("[data-count]", bar).textContent = `${counts[color]} left`;
    $("[data-captured]", bar).innerHTML =
      `<span class="mini-piece mini-piece--${enemy}"></span>`.repeat(Math.max(0, PIECES_PER_SIDE - counts[enemy]))
      + (lead > 0 ? `<b class="player__lead" title="Ahead by ${lead}">+${lead}</b>` : "");
    $(".thinking-dots", bar).hidden = !thinking;
    bar.classList.toggle("is-thinking", thinking);
    bar.classList.toggle("is-turn", game.turn === color && !game.winner);
  }
  renderClocks();
}

function formatTime(seconds) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderClocks() {
  for (const color of ["w", "b"]) {
    const bar = $(`.player[data-color="${color}"]`);
    const clock = $("[data-clock]", bar);
    clock.hidden = !game.clock;                               // no clock against the computer
    if (!game.clock) continue;

    const left = clockLeft(color);
    $("span", clock).textContent = formatTime(Math.ceil(left));
    clock.classList.toggle("is-low", left <= 30);
  }
}

function renderModeChip() {
  const clock = game.minutes ? ` · ${game.minutes} min` : "";
  const text = game.mode === "bot" ? `vs Computer · ${LEVEL_NAMES[game.level]}`
    : game.mode === "online" ? `Online · ${game.room.code}${clock}`
    : `2 players${clock}`;
  $(".mode-chip__label").textContent = text;
  $(".mode-chip").setAttribute("aria-label", `Change game mode. Now: ${text}`);
  $$("[data-nav]").forEach((link) => link.classList.toggle("is-active", link.dataset.nav === game.mode));
}

// Buttons that cannot do anything right now are dimmed.
function renderControls() {
  $('[data-action="undo"]').disabled = !canUndo();
  $('[data-action="draw"]').disabled = !canOfferDraw();
  // After the game the Resign button becomes "Result": it brings back the game-over window (Rematch, Review), which
  // is the only place for them, in case it was closed.
  const over = Boolean(game.winner);
  const resignButton = $('[data-action="resign"]');
  $("span", resignButton).textContent = over ? "Result" : "Resign";
  resignButton.title = over ? "Show the result" : "Resign";
  resignButton.classList.toggle("ctrl--danger", !over);

  const moves = game.moves.length;
  const position = view.review === null ? moves : view.review;
  const reviewable = canReview();
  $('[data-review="first"]').disabled = !reviewable || position === 0;
  $('[data-review="prev"]').disabled = !reviewable || position === 0;
  $('[data-review="next"]').disabled = !reviewable || position >= moves;
  $('[data-review="last"]').disabled = !reviewable || position >= moves;
  if (view.review === null) view.missedMove = false;
  $("#review-live").hidden = view.review === null;
  $("#review-live").textContent = view.missedMove ? "Back to game · new move" : "Back to game";
  $(".board-wrap").classList.toggle("is-reviewing", view.review !== null);
}

// While the tab is in the background, the title says when it is your move.
function updateTitle() {
  const yourMove = document.hidden && hasOwnSide() && !game.winner && !isOpponentTurn();
  document.title = (yourMove ? "● Your move · " : "") + BASE_TITLE;
}

/* ==========================================================================
   Move list (two columns: Black, White) — click a move to review it
   ========================================================================== */

// A move as HTML: "10-14", "14×21×28", with a crown after a promotion.
function moveHTML(move) {
  const separator = move.capture ? '<span class="x">×</span>' : "-";
  const crown = move.crowned ? `<svg class="k" aria-label="becomes a king"><use href="#i-crown"/></svg>` : "";
  return move.path.map(squareNumber).join(separator) + crown;
}

function renderMoveList() {
  const list = $("#movelist");
  const count = game.moves.length;
  if (count === 0) {
    const opponent = game.mode === "bot" ? "Computer" : "Your opponent";
    const starter = hasOwnSide() ? (game.humanColor === "b" ? "You start." : `${opponent} starts.`) : "Black starts.";
    list.innerHTML = `<li><span class="empty">No moves yet. ${starter}</span></li>`;
    return;
  }

  const current = view.review === null ? count - 1 : view.review - 1;   // the move shown on the board (-1 = the start)
  const cell = (index) => {
    if (index >= count) return "<span></span>";
    const classes = `mv${index === current ? " is-current" : ""}`;
    return `<button type="button" class="${classes}" data-move="${index}" aria-label="Move ${index + 1}: ${moveText(game.moves[index])}">${moveHTML(game.moves[index])}</button>`;
  };

  let html = "";
  for (let i = 0; i < count; i += 2) {
    html += `<li><span class="num">${i / 2 + 1}.</span>${cell(i)}${cell(i + 1)}</li>`;
  }
  const focusedMove = list.contains(document.activeElement) ? document.activeElement.dataset.move : null;
  list.innerHTML = html;
  if (focusedMove) $(`[data-move="${focusedMove}"]`, list)?.focus();     // the list was redrawn: keep the keyboard focus

  // Show the newest move, or the one being reviewed.
  const scroller = list.parentElement;
  if (view.review === null) scroller.scrollTop = scroller.scrollHeight;
  else $(".mv.is-current", list)?.scrollIntoView({ block: "nearest" });
}

/* ==========================================================================
   Game-over window
   ========================================================================== */

function showGameOver() {
  const counts = countPieces(game.board);
  const result = resultInfo();

  $("#go-title").textContent = result.title;
  $("#go-reason").textContent = game.reason;
  $("#go-thai").textContent = result.thai;
  $("#go-score").textContent = game.winner === "draw" ? "½ – ½" : game.winner === "w" ? "1 – 0" : "0 – 1";
  $("#go-name-w").textContent = playerLabel("w");
  $("#go-name-b").textContent = playerLabel("b");
  $("#go-left-w").textContent = `${counts.w} left`;
  $("#go-left-b").textContent = `${counts.b} left`;
  $('[data-action="rematch"]').textContent = game.mode === "online" ? "Rematch (sides swap)" : "Rematch";
  $("#go-swap").hidden = game.mode !== "bot";
  $("#go-swap-side").textContent = SIDE[otherColor(game.humanColor)].name;

  // Wait a moment, so the last move can be seen before the window covers the board.
  // If another window is open (Settings, a question), the result waits until it is closed.
  setTimeout(() => {
    if (!game.winner) return;
    if (dialogStack.length > 0) gameOverWaiting = true;
    else openGameOverWindow();
  }, 700);
}

let gameOverWaiting = false;          // the result window wants to open, but another window is in the way (see closeDialog)

function openGameOverWindow() {
  gameOverWaiting = false;
  if (game.winner) openDialog($("#gameover"));
}
