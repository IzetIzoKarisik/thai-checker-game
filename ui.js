/* ==========================================================================
   Mak-hos (หมากฮอส) — the parts around the board: dialogs, settings, the
   New game window, saved settings and start-up. This file loads last.
   ========================================================================== */

/* ==========================================================================
   1. Dialogs (Settings, New game, Game over, Confirm, How to play)
   Focus moves into a dialog when it opens, stays inside it, and goes back
   to where it came from when it closes. Esc and a click on the dark
   background close it.
   ========================================================================== */

const dialogStack = [];        // the open dialogs, the top one last
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function focusableIn(element) {
  return $$(FOCUSABLE, element).filter((item) => !item.closest("[hidden]"));
}

function openDialog(element) {
  if (!element.hidden) return;
  element.hidden = false;
  element.opener = document.activeElement;
  dialogStack.push(element);
  ($("[data-autofocus]", element) || focusableIn(element)[0])?.focus();
}

function closeDialog(element) {
  if (element.hidden) return;
  element.hidden = true;
  const position = dialogStack.indexOf(element);
  if (position >= 0) dialogStack.splice(position, 1);
  if (element.opener?.isConnected) element.opener.focus();
  element.opener = null;
  element.onclosed?.();
}

// Esc or a click outside: a dialog may have its own way to say "no" (the confirm one).
function cancelDialog(element) {
  if (element.cancel) element.cancel();
  else closeDialog(element);
}

function onDialogKeydown(event) {
  const top = dialogStack.at(-1);
  if (!top) return;

  if (event.key === "Escape") {
    event.preventDefault();
    cancelDialog(top);
  } else if (event.key === "Tab") {                          // keep Tab inside the dialog
    const items = focusableIn(top);
    if (items.length === 0) { event.preventDefault(); return; }
    const outside = !top.contains(document.activeElement);
    if (outside) {
      event.preventDefault();
      (event.shiftKey ? items.at(-1) : items[0]).focus();
    } else if (event.shiftKey && document.activeElement === items[0]) {
      event.preventDefault();
      items.at(-1).focus();
    } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
      event.preventDefault();
      items[0].focus();
    }
  }
}

// Asks a question in a window of our own (the browser's confirm() box does not fit the design).
// Resolves to true for the yes button, false for the no button, Esc or a click outside.
function askConfirm({ title, text, yes = "OK", no = "Cancel", danger = false }) {
  const dialog = $("#confirm");
  if (!dialog.hidden) return Promise.resolve(false);
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  $("#confirm-yes").textContent = yes;
  $("#confirm-no").textContent = no;
  $("#confirm-yes").classList.toggle("btn--danger", danger);

  return new Promise((resolve) => {
    const answer = (value) => { dialog.cancel = null; closeDialog(dialog); resolve(value); };
    $("#confirm-yes").onclick = () => answer(true);
    $("#confirm-no").onclick = () => answer(false);
    dialog.cancel = () => answer(false);
    openDialog(dialog);
    (danger ? $("#confirm-no") : $("#confirm-yes")).focus();   // a risky question starts on "no"
  });
}

// A short message at the bottom of the screen.
let toastTimer = null;
function toast(text) {
  const element = $("#toast");
  element.textContent = text;
  element.classList.add("is-shown");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("is-shown"), 3500);
}

/* ==========================================================================
   2. Settings (remembered between visits)
   ========================================================================== */

const SETTINGS_KEY = "makhos.settings";
const DEFAULT_SETTINGS = {
  board: "teak", pieces: "marble",
  hints: true, numbers: true, must: true,                    // help on the board
  sound: true, soundVolume: 0.8, musicVolume: 0.55,
  mode: "bot", side: "b", level: "medium", minutes: 10,      // what the New game window starts with
  tourSeen: false,                                           // has "How to play" been shown?
};
const settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {});
  } catch { /* no saved settings: use the defaults */ }
}

// Anything odd (an old, edited or mistyped value) goes back to the default.
function sanitizeSettings() {
  const oneOf = (name, allowed) => { if (!allowed.includes(settings[name])) settings[name] = DEFAULT_SETTINGS[name]; };
  const volume = (name) => { if (!(settings[name] >= 0 && settings[name] <= 1)) settings[name] = DEFAULT_SETTINGS[name]; };
  oneOf("board", ["teak", "green", "brown", "marble", "onyx", "emerald"]);
  oneOf("pieces", ["marble", "gold", "classic", "caps"]);
  oneOf("mode", ["bot", "pvp"]);
  oneOf("side", ["b", "w", "random"]);
  oneOf("level", Object.keys(BOT_LEVELS));
  oneOf("minutes", [0, 5, 10, 15]);
  volume("soundVolume");
  volume("musicVolume");
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* just not remembered */ }
}

// Shows the settings on the page: board and piece style, switches, sliders.
function applyAppearance() {
  document.documentElement.dataset.board = settings.board;
  document.documentElement.dataset.pieces = settings.pieces;
  for (const name of ["board", "pieces"]) {
    $$(`[data-setting="${name}"] .swatch`).forEach((button) => button.classList.toggle("is-active", button.dataset.value === settings[name]));
  }

  const board = $(".board-wrap");
  board.classList.toggle("hide-hints", !settings.hints);
  board.classList.toggle("hide-numbers", !settings.numbers);
  board.classList.toggle("hide-must", !settings.must);
  for (const name of ["hints", "numbers", "must", "sound"]) $(`[data-toggle="${name}"]`).checked = settings[name];

  setSoundOn(settings.sound);
  setSoundVolume(settings.soundVolume);
  setMusicVolume(settings.musicVolume);
  $('[data-slider="sound"]').value = Math.round(settings.soundVolume * 100);
  $('[data-slider="music"]').value = Math.round(settings.musicVolume * 100);
}

function showTab(name) {                                     // name: "moves" or "rules"
  $$(".tab").forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active);
  });
  $$("[data-tabpanel]").forEach((panel) => { panel.hidden = panel.dataset.tabpanel !== name; });
}

/* ==========================================================================
   3. The New game window
   ========================================================================== */

const LEVEL_HINTS = {
  easy: "Plays fast and sometimes makes mistakes.",
  medium: "A solid opponent. Thinks for about a second.",
  hard: "The strongest setting. Thinks for up to 3 seconds per move.",
};

let draft = null;       // what the window currently shows, applied only when "Start game" is pressed

function openNewGame(mode) {
  draft = { mode: mode || settings.mode, side: settings.side, level: settings.level, minutes: settings.minutes };
  renderDraft();
  $("#ng-note").hidden = !(game.moves.length > 0 && !game.winner);   // a game in progress would be lost
  openDialog($("#newgame"));
}

function renderDraft() {
  const dialog = $("#newgame");
  for (const group of $$("[data-choice]", dialog)) {
    const name = group.dataset.choice;
    $$(".swatch", group).forEach((button) => button.classList.toggle("is-active", button.dataset.value === String(draft[name])));
  }
  $$("[data-only]", dialog).forEach((section) => { section.hidden = section.dataset.only !== draft.mode; });
  $("#ng-level-hint").textContent = LEVEL_HINTS[draft.level];
}

function startFromDialog() {
  Object.assign(settings, draft);
  saveSettings();
  closeDialog($("#newgame"));
  startGame(settings);
}

// Play the same game again, or with the sides swapped (against the computer).
function rematch(swapSides) {
  if (game.mode === "online") { requestRematch(); return; }
  const side = swapSides ? otherColor(game.humanColor) : game.humanColor;
  startGame({ mode: game.mode, side, level: game.level, minutes: game.minutes });
}

/* ==========================================================================
   4. Wiring the buttons
   ========================================================================== */

function bindUI() {
  // The buttons under the move list, and in the game-over window
  const actions = {
    new: () => openNewGame(),
    undo,
    flip: flipBoard,
    draw: offerDraw,
    resign,
    rematch: () => rematch(false),
    "rematch-swap": () => rematch(true),
    "review-game": () => { closeDialog($("#gameover")); reviewTo(0); },
  };
  $$("[data-action]").forEach((button) => button.addEventListener("click", () => actions[button.dataset.action]()));

  // Top bar and the mode label open the New game window
  $$("[data-nav]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    if (link.dataset.nav === "online") openOnline();
    else openNewGame(link.dataset.nav);
  }));
  $(".mode-chip").addEventListener("click", () => openNewGame());
  $$("[data-open]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    const target = link.dataset.open;
    if (target === "rules") showTab("rules");
    else openDialog($(`#${target}`));
  }));

  // Dialogs: close buttons, a click on the dark background, Esc and Tab
  $$("[data-close]").forEach((button) => button.addEventListener("click", () => cancelDialog(button.closest(".drawer, .modal"))));
  $$(".modal").forEach((modal) => modal.addEventListener("click", (event) => { if (event.target === modal) cancelDialog(modal); }));
  document.addEventListener("keydown", onDialogKeydown);
  $("#tour").onclosed = () => { settings.tourSeen = true; saveSettings(); };

  // New game window
  $("#newgame").addEventListener("click", (event) => {
    const button = event.target.closest(".swatch");
    if (!button) return;
    if (button.dataset.value === "online") { closeDialog($("#newgame")); openOnline(); return; }   // (it has a window of its own)
    const name = button.closest("[data-choice]").dataset.choice;
    draft[name] = name === "minutes" ? Number(button.dataset.value) : button.dataset.value;
    renderDraft();
  });
  $("#ng-start").addEventListener("click", startFromDialog);

  // Settings
  $$('[data-setting="board"] .swatch, [data-setting="pieces"] .swatch').forEach((button) => {
    button.addEventListener("click", () => {
      settings[button.closest("[data-setting]").dataset.setting] = button.dataset.value;
      saveSettings();
      applyAppearance();
    });
  });
  $$("[data-toggle]").forEach((input) => {
    if (input.dataset.toggle === "music") return;            // the music switch belongs to music.js
    input.addEventListener("change", () => { settings[input.dataset.toggle] = input.checked; saveSettings(); applyAppearance(); });
  });
  $$("[data-slider]").forEach((slider) => {
    slider.addEventListener("input", () => {
      settings[slider.dataset.slider === "sound" ? "soundVolume" : "musicVolume"] = Number(slider.value) / 100;
      saveSettings();
      applyAppearance();
    });
  });
  $('[data-slider="sound"]').addEventListener("change", () => playSound("move"));   // let the player hear the new volume

  bindOnline();

  // Tabs
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));

  document.addEventListener("visibilitychange", updateTitle);
}

/* ==========================================================================
   5. Start-up
   ========================================================================== */

// Handy for screenshots and sharing, for example:
//   index.html?vs=computer&botSide=b&level=hard&board=green&pieces=classic&flip=1
//   (botSide is the side the computer plays; clock=5 sets minutes for a two-player game;
//    new=1 ignores a saved game; tour=0 hides "How to play"; room=K7M2QX is a friend's invitation;
//    peerServer=host:port uses another introduction server for online games, see online.js)
function applyUrlParams(params) {
  if (params.get("board")) settings.board = params.get("board");
  if (params.get("pieces")) settings.pieces = params.get("pieces");
  if (params.has("vs")) settings.mode = params.get("vs") === "computer" ? "bot" : "pvp";
  if (params.get("botSide")) settings.side = params.get("botSide") === "b" ? "w" : "b";
  if (params.get("level")) settings.level = params.get("level");
  if (params.has("clock")) settings.minutes = Number(params.get("clock")) || 0;
}

loadSettings();
const params = new URLSearchParams(location.search);
applyUrlParams(params);
sanitizeSettings();

bindUI();
bindInput();
applyAppearance();

const resumed = !params.has("vs") && !params.has("new") && restoreSavedGame();
if (resumed) {
  const drawReason = automaticDrawReason();       // a game saved before a draw rule existed may already be drawn
  if (drawReason) endGame("draw", drawReason);
  else toast(game.room ? "Welcome back! Going back into your online game…" : "Welcome back! Your game was restored. Press New to start another.");
  render();
  maybeBotMove();
  if (game.room && !game.winner) resumeOnline();
} else {
  startGame(settings);
}
if (params.get("flip")) flipBoard();

// A link from a friend (?room=K7M2QX) opens the Join window, unless we are already in that room.
const invitation = cleanCode(params.get("room") || "");
if (invitation && !(resumed && game.room?.code === invitation)) openOnline("join", invitation);
if (!settings.tourSeen && params.get("tour") !== "0" && !resumed && !invitation) openDialog($("#tour"));

setInterval(tick, 250);
