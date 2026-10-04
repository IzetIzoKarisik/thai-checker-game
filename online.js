/* ==========================================================================
   Mak-hos (หมากฮอส) — playing a friend over the internet.

   The two browsers talk to each other directly (WebRTC, through the PeerJS
   library in vendor/). A free public server only introduces them: the room
   code is the name the host's browser signs in under (makhos-K7M2QX), and the
   friend asks the server to connect them to that name. After that, the moves
   go straight from one browser to the other.

   Both browsers keep the whole game and check every move with rules.js, so a
   move that is not allowed is refused. If the connection drops, both sides
   say what they have and the one that is behind catches up, so nothing is lost.

   Messages (JSON, always { t: "kind", ... }):
     hello     friend -> host   { ver, token }              "let me in" (token: a secret that keeps the seat ours)
     welcome   host -> friend   { hostColor, minutes }      "you are in; this is the game"
     refuse    host -> friend   { why: "full" | "version" | "moved" | "stopped" }   ("moved": the same friend came in from another window)
     state     both             { paths, result }           everything finished so far (sent right after hello / welcome)
     move      both             { n, path, left }           one finished turn: its squares; left = seconds left on the mover's clock
     over      both             { winner, reason }          resigned, or out of time
     offer     both                                         a draw offer;   answer { accept } is the reply
     rematch   both                                         play again with the sides swapped;   rematch-no is the refusal
     leave     both                                         goodbye
     ping      both                                         "still here" every few seconds, so that a friend who vanished is noticed
   ========================================================================== */

const ROOM_PREFIX = "makhos-";                              // every room is called makhos-XXXXXX on the introduction server
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no 0, O, 1 or I: they are easy to mix up
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const TOKEN_PATTERN = /^[A-HJ-NP-Z2-9]{16}$/;
const PROTOCOL_VERSION = 1;
const PEER_OPTIONS = { debug: 0 };                          // the free public PeerJS server (and its relay servers for tricky networks)
const AWAY_SECONDS = 60;                                    // how long a friend may be gone before we offer to claim the win
const DIAL_SECONDS = 15;                                    // how long to wait for a room to answer
const PING_SECONDS = 3;                                     // how often we say "still here" ...
const SILENCE_SECONDS = 15;                                 // ... and how long a quiet friend is believed to be there

const net = {
  peer: null,            // our connection to the introduction server
  link: null,            // the direct connection to the other player
  open: false,           // true while that connection works
  everOpen: false,       // has it worked since this page loaded?
  state: "idle",         // "idle", "hosting" (room open, nobody yet), "joining" (calling a room), "playing", "stopped" (cannot go on)
  role: "",              // "host" (made the room) or "guest"
  code: "",              // the room code
  token: "",             // the secret of the first friend; only they (coming back) may take the seat
  options: null,         // host: what the "Create a room" window chose { side, minutes }
  queue: [],             // what our friend did that we have not shown yet: { path, left } or { result }
  current: null,         // the turn of theirs that is being shown on our board right now
  offerPending: false,   // we offered a draw and wait for the answer
  rematchAsked: false,   // we asked for a rematch and wait for the answer
  stoppedBecause: "",
  heard: 0,              // when the friend last sent anything (a Date.now() time)
  timer: null,           // for "try again in a moment" and for waiting for a room to answer
  awayTimer: null,       // for "the friend has been gone for a minute"
  awayAsking: false,
};

/* ==========================================================================
   1. Small helpers
   ========================================================================== */

function randomText(length) {
  return [...crypto.getRandomValues(new Uint8Array(length))].map((n) => ROOM_ALPHABET[n % ROOM_ALPHABET.length]).join("");
}

// A room code from whatever the player typed or pasted (the code itself, or the whole link).
function cleanCode(text) {
  const fromLink = /[?&]room=([^&#\s]+)/i.exec(text);
  const letters = (fromLink ? fromLink[1] : text).toUpperCase();
  return [...letters].filter((letter) => ROOM_ALPHABET.includes(letter)).join("").slice(0, ROOM_CODE_LENGTH);
}

// The link to give to a friend: this page, with the room in it.
function shareUrl(code) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", code);
  return url.toString();
}

// A link to this computer is no use to a friend somewhere else.
function isLocalAddress() {
  return location.protocol === "file:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
}

// The introduction server to use. To run your own, open the page with ?peerServer=host:port (see RULES.md).
function peerOptions() {
  const server = new URLSearchParams(location.search).get("peerServer");
  if (!server) return PEER_OPTIONS;
  const [host, port] = server.split(":");
  return { ...PEER_OPTIONS, host, port: Number(port) || 443, secure: !port || Number(port) === 443, path: "/" };
}

function isRoomValid(room) {
  return Boolean(room) && ROOM_CODE_PATTERN.test(room.code) && TOKEN_PATTERN.test(room.token) && (room.role === "host" || room.role === "guest");
}

const isSquare = (square) => typeof square === "string" && /^[a-h][1-8]$/.test(square) && isDarkSquare(square);

// One turn as a list of squares ("c3", "e5", ...), or null if it does not look like one.
function validPath(path) {
  return Array.isArray(path) && path.length >= 2 && path.length <= 40 && path.every(isSquare) ? path : null;
}

function validPaths(paths) {
  return Array.isArray(paths) && paths.length <= 1000 && paths.every(validPath) ? paths : null;
}

// The colour that plays the turn with this number (Black first, then they take turns).
const colorOfTurn = (index) => (index % 2 === 0 ? "b" : "w");

/* ==========================================================================
   2. Sending
   ========================================================================== */

function send(message) {
  if (!net.link || !net.open) return;
  try { net.link.send(message); } catch { /* the connection just broke: its close handler deals with it */ }
}

// Called by game.js when we finished a turn.
function sendMove(index, path, left) {
  send({ t: "move", n: index, path, left });
}

const myPaths = () => game.moves.map((move) => move.path);
const myResult = () => (game.winner ? { winner: game.winner, reason: game.reason } : null);

function sendState() {
  send({ t: "state", paths: myPaths(), result: myResult() });
}

// Called by game.js after we resigned or ran out of time.
function sendOver() {
  send({ t: "over", winner: game.winner, reason: game.reason });
}

/* ==========================================================================
   3. Making the connection
   ========================================================================== */

function createRoom(options) {
  leaveRoom();
  if (typeof Peer === "undefined") { roomProblem("Online play is not available: its library did not load."); return; }
  net.role = "host";
  net.options = options;
  net.state = "hosting";
  registerRoom(randomText(ROOM_CODE_LENGTH), 1);
}

// Signs in on the introduction server under the room's name. If that name is taken, a new room code is tried.
function registerRoom(code, attempt) {
  net.code = code;
  const peer = new Peer(ROOM_PREFIX + code, peerOptions());
  net.peer = peer;
  peer.on("open", () => { if (net.peer === peer && net.state === "hosting") showRoomReady(); });
  peer.on("connection", (link) => { if (net.peer === peer) listenTo(link); });
  peer.on("disconnected", () => keepOnline(peer));
  peer.on("error", (error) => {
    if (net.peer !== peer) return;
    if (error.type === "unavailable-id") {
      peer.destroy();
      if (net.state === "hosting" && attempt < 5) registerRoom(randomText(ROOM_CODE_LENGTH), attempt + 1);
      else if (net.state === "playing") retryLater(() => registerRoom(code, attempt));   // our own old name: the server lets go of it after a moment
      else roomProblem("Couldn't open a room. Please try again.");
      return;
    }
    onPeerError(error);
  });
}

// The introduction server dropped us: sign in again (connections that are already up keep working).
function keepOnline(peer) {
  setTimeout(() => {
    if (net.peer === peer && !peer.destroyed && peer.disconnected) peer.reconnect();
  }, 1500);
}

function joinRoom(code) {
  leaveRoom();
  if (typeof Peer === "undefined") { roomProblem("Online play is not available: its library did not load."); return; }
  net.role = "guest";
  net.state = "joining";
  net.code = code;
  net.token = randomText(16);
  dial();
}

// The guest signs in under a random name, then calls the room.
function dial() {
  const peer = new Peer(peerOptions());
  net.peer = peer;
  peer.on("open", () => { if (net.peer === peer) callHost(peer); });
  peer.on("disconnected", () => keepOnline(peer));
  peer.on("error", (error) => { if (net.peer === peer) onPeerError(error); });
}

function callHost(peer) {
  const link = peer.connect(ROOM_PREFIX + net.code, { reliable: true, serialization: "json" });
  if (!link) return;
  net.link = link;
  listenTo(link);
  link.on("open", () => link.send({ t: "hello", ver: PROTOCOL_VERSION, token: net.token }));
  clearTimeout(net.timer);
  net.timer = setTimeout(() => {
    if (net.link === link && !net.open) { net.link = null; link.close(); dialFailed("The room did not answer. Check the code, and that your friend still has the room open."); }
  }, DIAL_SECONDS * 1000);
}

// The first call failed: say so. When we are coming back to a game that is on, keep trying instead.
function dialFailed(message) {
  if (net.state === "joining") roomProblem(message);
  else retryLater(redial);
}

function redial() {
  if (net.role !== "guest" || net.state !== "playing" || net.open) return;
  const old = net.peer;
  net.peer = null;
  net.link = null;
  if (old) old.destroy();
  dial();
}

function retryLater(action) {
  clearTimeout(net.timer);
  net.timer = setTimeout(action, 3000);
}

function onPeerError(error) {
  const messages = {
    "peer-unavailable": "There is no room with this code. Check the code, or ask your friend to create the room again.",
    "browser-incompatible": "This browser can't play online.",
    webrtc: "Couldn't connect to your friend. One of your networks may be blocking the connection.",
  };
  const message = messages[error.type] || "Can't reach the online service. Check your internet connection and try again.";
  if (net.state === "hosting" || net.state === "joining") roomProblem(message);
  else if (net.state === "playing" && net.role === "guest") retryLater(redial);   // (the host just waits to be called)
}

function listenTo(link) {
  link.on("data", (data) => onMessage(link, data));
  link.on("close", () => onLinkClosed(link));
  link.on("error", () => onLinkClosed(link));
}

// Forgets the room. A friend who is still there is told that we left.
function leaveRoom() {
  clearTimeout(net.timer);
  clearTimeout(net.awayTimer);
  if (net.open) send({ t: "leave" });
  const peer = net.peer;
  Object.assign(net, {
    peer: null, link: null, open: false, everOpen: false, state: "idle", role: "", code: "", token: "", options: null,
    queue: [], current: null, offerPending: false, rematchAsked: false, stoppedBecause: "", awayAsking: false,
  });
  if (peer) setTimeout(() => peer.destroy(), 300);          // (a moment, so that the goodbye can leave first)
}

// Called by game.js when an online game starts (also a rematch in the same room).
function newOnlineGame() {
  net.queue = [];
  net.current = null;
  net.offerPending = false;
  net.rematchAsked = false;
}

// After a reload: go back into the room of the game that was restored.
function resumeOnline() {
  const { code, role, token } = game.room;
  Object.assign(net, { role, code, token, state: "playing" });
  if (role === "host") registerRoom(code, 1);
  else dial();
  startAwayTimer();
}

function setOpen(open) {
  if (net.open === open) return;
  net.open = open;
  if (open) {
    net.everOpen = true;
    net.heard = Date.now();
    clearTimeout(net.awayTimer);
    if (net.awayAsking) $("#confirm").cancel?.();           // the question "claim the win?" is not needed any more
  }
  render();
}

/* ==========================================================================
   4. Messages that arrive
   ========================================================================== */

const FRIEND_MESSAGES = { state: onState, move: onMove, over: onOver, offer: onOffer, answer: onAnswer, rematch: onRematch, "rematch-no": onRematchNo, leave: onLeave };

function onMessage(link, message) {
  if (!message || typeof message.t !== "string") return;
  if (link === net.link) net.heard = Date.now();
  try {
    if (message.t === "hello") onHello(link, message);
    else if (link !== net.link) return;
    else if (message.t === "welcome") onWelcome(message);
    else if (message.t === "refuse") onRefuse(message);
    else if (net.open && FRIEND_MESSAGES[message.t]) FRIEND_MESSAGES[message.t](message);
  } catch (error) {
    console.error("online message", message.t, error);
  }
}

function refuse(link, why) {
  try { link.send({ t: "refuse", why }); } catch { /* it is gone already */ }
  setTimeout(() => link.close(), 300);
}

// The host: a friend asks to come in (for the first time, or coming back).
function onHello(link, hello) {
  if (net.role !== "host") return;
  if (hello.ver !== PROTOCOL_VERSION) { refuse(link, "version"); return; }
  if (net.state === "stopped") { refuse(link, "stopped"); return; }
  const first = !net.token;
  const knownFriend = typeof hello.token === "string" && hello.token === net.token;
  if (!TOKEN_PATTERN.test(hello.token) || !(first || knownFriend) || (net.state !== "hosting" && net.state !== "playing")) { refuse(link, "full"); return; }

  const old = net.link;
  net.link = link;                                          // (set first, so that the old link closing is ignored)
  if (old && old !== link) refuse(old, "moved");            // (if it is only the old copy of a page that was reloaded, nobody hears this)
  if (first) {
    net.token = hello.token;
    net.state = "playing";
    const side = net.options.side === "random" ? (Math.random() < 0.5 ? "b" : "w") : net.options.side;
    startGame({ mode: "online", side, level: settings.level, minutes: net.options.minutes, room: { code: net.code, role: "host", token: net.token } });
    closeDialog($("#online"));
    toast("Your friend joined. Good luck!");
  }
  net.open = false;
  setOpen(true);
  send({ t: "welcome", hostColor: game.humanColor, minutes: game.minutes });
  sendState();
}

// The friend: the host let us in.
function onWelcome(welcome) {
  if (net.role !== "guest") return;
  const colorOk = welcome.hostColor === "b" || welcome.hostColor === "w";
  if (!colorOk || ![0, 5, 10, 15].includes(welcome.minutes)) { stopGame("The other game sent something unexpected."); return; }
  clearTimeout(net.timer);
  if (net.state === "joining") {
    net.state = "playing";
    startGame({ mode: "online", side: otherColor(welcome.hostColor), level: settings.level, minutes: welcome.minutes, room: { code: net.code, role: "guest", token: net.token } });
    closeDialog($("#online"));
    toast("Connected! Good luck.");
  } else if (game.humanColor === welcome.hostColor) {
    stopGame("This is not the game that was played in this room.");
    return;
  }
  setOpen(true);
  sendState();
}

function onRefuse({ why }) {
  clearTimeout(net.timer);
  const messages = {
    version: "Your friend has another version of the game. Reload both pages and try again.",
    moved: "This game is open in another window now.",
    stopped: "The online game in this room has stopped.",
    full: "This room already has two players.",
  };
  if (net.state === "playing") stopGame(messages[why] || messages.full);
  else roomProblem(messages[why] || messages.full);
}

// Everything our friend has finished so far: show what we do not have yet.
function onState(their) {
  const paths = validPaths(their.paths);
  if (!paths) { stopGame("The other game sent something unexpected."); return; }
  const known = knownPaths();
  for (let i = 0; i < Math.min(known.length, paths.length); i++) {
    if (known[i].join() !== paths[i].join()) { stopGame("The two boards no longer match."); return; }
  }
  for (const path of paths.slice(known.length)) net.queue.push({ path });
  if (their.result) net.queue.push({ result: their.result });
  pump();
}

// The turns we have: finished ones, the one being shown, and the ones waiting to be shown.
function knownPaths() {
  return myPaths().concat([net.current, ...net.queue].filter((task) => task && task.path).map((task) => task.path));
}

function onMove(message) {
  const path = validPath(message.path);
  if (!path) { stopGame("The other game sent something unexpected."); return; }
  if (game.winner) return;
  const expected = knownPaths().length;
  if (message.n < expected) return;                         // we have this one already
  if (message.n !== expected || colorOfTurn(expected) === game.humanColor) { stopGame("The two boards no longer match."); return; }
  net.queue.push({ path, left: message.left });
  pump();
}

function onOver(message) {
  net.queue.push({ result: { winner: message.winner, reason: message.reason } });
  pump();
}

function onLeave() {
  if (!game.winner) {
    endGame(game.humanColor, `${SIDE[otherColor(game.humanColor)].name} left the game`);
    render();
  } else {
    toast("Your friend left the room.");
  }
  net.state = "stopped";                                    // they are gone for good: no waiting, no reconnecting
  net.stoppedBecause = "Your friend left the room.";
  const link = net.link;
  net.link = null;
  net.open = false;
  link?.close();
}

function onLinkClosed(link) {
  if (link !== net.link) return;
  net.link = null;
  clearTimeout(net.timer);
  if (net.state === "joining") { roomProblem("Couldn't connect to the room. Check the code and try again."); return; }
  if (net.state !== "playing") return;
  net.offerPending = false;
  net.rematchAsked = false;
  const wasOpen = net.open;
  setOpen(false);
  if (game.winner) return;                                  // the game is over: nothing to wait for
  if (wasOpen) toast("The connection to your friend was lost.");
  startAwayTimer();
  if (net.role === "guest") retryLater(redial);
}

// Something is wrong that cannot be repaired (the two games disagree): stop, and say why.
function stopGame(reason) {
  clearTimeout(net.timer);
  clearTimeout(net.awayTimer);
  const link = net.link;
  Object.assign(net, { state: "stopped", stoppedBecause: reason, link: null, open: false, queue: [], current: null });
  link?.close();
  render();
  toast(`The online game stopped. ${reason}`);
}

// The connection can die without anybody telling us (a closed laptop, a lost signal) and the browser
// takes about a minute to notice. So we say "ping" every few seconds, and a friend who has been silent
// for too long is treated as gone.
function heartbeat() {
  if (!net.open || !net.link) return;
  if (Date.now() - net.heard > SILENCE_SECONDS * 1000) {
    const link = net.link;
    try { link.close(); } catch { /* it is gone already */ }
    onLinkClosed(link);
    return;
  }
  send({ t: "ping" });
}
setInterval(heartbeat, PING_SECONDS * 1000);

/* ==========================================================================
   5. Showing our friend's turns on our board
   ========================================================================== */

function pump() {
  if (net.current) return;                                  // one at a time
  const task = net.queue.shift();
  if (!task) return;
  net.current = task;
  const next = () => { net.current = null; pump(); };
  if (task.result) { applyResult(task.result); next(); }
  else playTurn(task, next);
}

// The legal steps of a turn given as squares, or null if it is not allowed right now.
function stepsFor(path) {
  const board = { ...game.board };
  if (!board[path[0]] || colorOf(board[path[0]]) !== game.turn) return null;
  const steps = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const step = getLegalMoves(board, path[i]).find((move) => move.to === path[i + 1]);
    if (!step) return null;
    const crowned = applyMove(board, path[i], step);
    steps.push(step);
    const goesOn = Boolean(step.captured) && !crowned && getJumps(board, step.to).length > 0;   // a capture goes on while the same piece can jump again
    if (goesOn !== (i + 2 < path.length)) return null;
  }
  return steps;
}

// Plays a turn of our friend's one step at a time, like a person clicking through it.
function playTurn({ path, left }, done) {
  const token = thinkToken;
  const mover = game.turn;
  const steps = stepsFor(path);
  if (!steps) { stopGame("A move arrived that is not allowed."); return; }
  const playStep = (index) => {
    if (token !== thinkToken) return;                       // a new game started meanwhile
    makeMove(path[index], steps[index]);
    if (index + 1 < steps.length) { setTimeout(() => playStep(index + 1), 550); return; }
    if (game.clock && Number.isFinite(left)) {              // their own clock is the right one
      game.clock[mover] = Math.max(0, Math.min(left, game.minutes * 60));
      renderClocks();
    }
    done();
  };
  playStep(0);
}

// How the other game ended, if it ended without a move: only a loss of theirs (or a draw we agreed to) counts.
function applyResult(result) {
  if (game.winner || !result) return;
  const youWin = result.winner === game.humanColor;
  const agreedDraw = result.winner === "draw" && net.offerPending;
  if (!youWin && !agreedDraw) return;
  net.offerPending = false;
  endGame(result.winner, agreedDraw ? "Draw by agreement" : String(result.reason || "Your opponent resigned").slice(0, 60));
  render();
}

/* ==========================================================================
   6. Draw offers and rematches
   ========================================================================== */

function canOfferOnlineDraw() {
  return net.open && !net.offerPending;
}

async function askOnlineDraw() {
  const ok = await askConfirm({ title: "Offer a draw?", text: "Your opponent will decide.", yes: "Offer draw" });
  if (!ok || game.winner || !canOfferOnlineDraw()) return;
  net.offerPending = true;
  send({ t: "offer" });
  toast("Draw offered. Waiting for the answer…");
  render();
}

async function onOffer() {
  if (game.winner) return;
  if (net.offerPending) { agreeDraw(); return; }            // we both offered at the same moment
  const accept = await askConfirm({ title: "Your opponent offers a draw", text: "Do you accept?", yes: "Accept", no: "Decline" });
  send({ t: "answer", accept: accept && !game.winner });
  if (accept && !game.winner) endDraw();
}

function agreeDraw() {
  net.offerPending = false;
  send({ t: "answer", accept: true });
  endDraw();
}

function endDraw() {
  endGame("draw", "Draw by agreement");
  render();
}

function onAnswer({ accept }) {
  if (!net.offerPending) return;
  net.offerPending = false;
  if (accept === true && !game.winner) endDraw();
  else toast("Your opponent declined the draw.");
  render();
}

// The "Rematch" button of an online game: the same two players, the sides swapped.
function requestRematch() {
  if (!net.open) { toast("Your opponent is not connected right now."); return; }
  net.rematchAsked = true;
  send({ t: "rematch" });
  toast("Rematch asked. Waiting for your opponent…");
}

async function onRematch() {
  if (!game.winner) return;
  if (net.rematchAsked) { startRematch(); return; }         // we both wanted it
  const yes = await askConfirm({ title: "Play again?", text: "Your opponent wants a rematch, with the sides swapped.", yes: "Play again", no: "No thanks" });
  if (!game.winner || !net.open) return;
  send({ t: yes ? "rematch" : "rematch-no" });
  if (yes) startRematch();
}

function onRematchNo() {
  net.rematchAsked = false;
  toast("Your opponent doesn't want a rematch right now.");
}

function startRematch() {
  net.rematchAsked = false;
  startGame({ mode: "online", side: otherColor(game.humanColor), level: game.level, minutes: game.minutes, room: game.room });
}

/* ==========================================================================
   7. A friend who is gone
   ========================================================================== */

function startAwayTimer() {
  clearTimeout(net.awayTimer);
  net.awayTimer = setTimeout(askToClaimWin, AWAY_SECONDS * 1000);
}

async function askToClaimWin() {
  if (net.open || game.winner || game.mode !== "online" || net.state !== "playing") return;
  net.awayAsking = true;
  const claim = await askConfirm({ title: "Your opponent has not come back", text: "You can claim the win, or keep waiting.", yes: "Claim the win", no: "Keep waiting" });
  net.awayAsking = false;
  if (net.open || game.winner) return;                      // they came back, or the game ended, while we were asking
  if (claim) {
    endGame(game.humanColor, `${SIDE[otherColor(game.humanColor)].name} left the game`);
    render();
  } else {
    startAwayTimer();
  }
}

/* ==========================================================================
   8. The "Play online" window
   ========================================================================== */

const onlineDraft = { side: "b", minutes: 10 };             // what the "Create a room" step shows

function showOnlineStep(name, message = "", isError = false) {
  $$("[data-on-step]").forEach((step) => { step.hidden = step.dataset.onStep !== name; });
  setOnlineStatus(message, isError);
  setOnlineBusy(false);
  $(`[data-on-step="${name}"] [data-autofocus]`)?.focus();
}

function setOnlineStatus(text, isError = false) {
  const status = $("#on-status");
  status.textContent = text;
  status.classList.toggle("is-error", isError);
}

function setOnlineBusy(busy) {
  $("#on-create").disabled = busy;
  $("#on-join").disabled = busy;
}

function renderOnlineDraft() {
  for (const group of $$("[data-on-choice]")) {
    const name = group.dataset.onChoice;
    $$(".swatch", group).forEach((button) => button.classList.toggle("is-active", button.dataset.value === String(onlineDraft[name])));
  }
}

// step: "choose", "create" or "join"; code: a room code to fill in (an invitation link)
function openOnline(step = "choose", code = "") {
  onlineDraft.side = settings.side;
  onlineDraft.minutes = settings.minutes;
  renderOnlineDraft();
  $("#on-note").hidden = !(game.moves.length > 0 && !game.winner && game.mode !== "online");
  $("#on-join-code").value = code;
  openDialog($("#online"));
  showOnlineStep(step, code ? `Press Join to go into room ${code}.` : "");
}

// Something went wrong while making or joining a room: forget it and say why.
function roomProblem(message) {
  leaveRoom();
  const shown = $$("[data-on-step]").find((step) => !step.hidden)?.dataset.onStep;
  showOnlineStep(shown === "join" ? "join" : "create", message, true);   // (back from the share step to the options)
}

function showRoomReady() {
  $("#on-code").textContent = `${net.code.slice(0, 3)} ${net.code.slice(3)}`;
  $("#on-code").setAttribute("aria-label", `Room code ${[...net.code].join(" ")}`);
  $("#on-link").value = shareUrl(net.code);
  $("#on-local-note").hidden = !isLocalAddress();
  showOnlineStep("share", "Waiting for your friend to join…");
}

// Leaving an online game that is still on needs a yes (the friend wins it).
async function confirmLeavingOnlineGame() {
  if (game.mode !== "online" || game.winner) return true;
  return askConfirm({ title: "Leave your online game?", text: "Your opponent will win this game.", yes: "Leave the game", danger: true });
}

async function startCreating() {
  if (!(await confirmLeavingOnlineGame())) return;
  settings.side = onlineDraft.side;
  settings.minutes = onlineDraft.minutes;
  saveSettings();
  setOnlineBusy(true);
  setOnlineStatus("Opening a room…");
  createRoom({ side: onlineDraft.side, minutes: onlineDraft.minutes });
}

async function startJoining() {
  const code = cleanCode($("#on-join-code").value);
  if (code.length !== ROOM_CODE_LENGTH) { setOnlineStatus("Type the 6-letter room code, or paste the link.", true); return; }
  if (!(await confirmLeavingOnlineGame())) return;
  setOnlineBusy(true);
  setOnlineStatus("Looking for the room…");
  joinRoom(code);
}

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {                                                 // pages that are not https have no clipboard: use the old way
    const box = Object.assign(document.createElement("textarea"), { value: text });
    document.body.appendChild(box);
    box.select();
    const copied = document.execCommand("copy");
    box.remove();
    if (!copied) { toast("Select the text and copy it yourself."); return; }
  }
  toast(`${what} copied.`);
}

function bindOnline() {
  const dialog = $("#online");
  dialog.addEventListener("click", (event) => {
    const go = event.target.closest("[data-on-go]");
    if (go) { showOnlineStep(go.dataset.onGo); return; }
    const swatch = event.target.closest("[data-on-choice] .swatch");
    if (!swatch) return;
    const name = swatch.closest("[data-on-choice]").dataset.onChoice;
    onlineDraft[name] = name === "minutes" ? Number(swatch.dataset.value) : swatch.dataset.value;
    renderOnlineDraft();
  });

  const codeBox = $("#on-join-code");
  codeBox.addEventListener("input", () => { codeBox.value = cleanCode(codeBox.value); });   // capital letters; a pasted link becomes its code
  codeBox.addEventListener("keydown", (event) => { if (event.key === "Enter") startJoining(); });
  $("#on-create").addEventListener("click", startCreating);
  $("#on-join").addEventListener("click", startJoining);

  $("#on-link").addEventListener("focus", (event) => event.target.select());
  $("#on-copy-link").addEventListener("click", () => copyText(shareUrl(net.code), "Link"));
  $("#on-copy-code").addEventListener("click", () => copyText(net.code, "Code"));
  $("#on-share").hidden = !navigator.share;
  $("#on-share").addEventListener("click", () => {
    navigator.share({ title: "Mak-hos · Thai checkers", text: `Play Thai checkers with me! Room code: ${net.code}`, url: shareUrl(net.code) }).catch(() => {});
  });
  $("#on-cancel").addEventListener("click", () => closeDialog(dialog));

  // Closing the window before a game has started cancels the room.
  dialog.onclosed = () => { if (net.state === "hosting" || net.state === "joining") leaveRoom(); };
}

function onlineConnected() {
  return net.open;
}

function onlineStopped() {
  return game.mode === "online" && net.state === "stopped";
}

// What the status card says while the friend cannot be reached.
function onlineTroubleStatus(dot) {
  if (net.state === "stopped") return { tone: "warn", dot, title: "Online game stopped", text: net.stoppedBecause };
  if (!net.everOpen) return { tone: "warn", dot, title: "Connecting to your opponent…", text: "One moment." };
  const text = net.role === "host" ? "Waiting for your opponent to come back." : "Trying to reconnect to your opponent.";
  return { tone: "warn", dot, title: "Connection lost", text };
}
