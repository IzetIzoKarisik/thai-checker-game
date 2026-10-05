# Mak-hos — fix list (audit of 2026-10-05)

For the coding agent that will make these changes. Each item has an ID, a priority, where the code is,
how to see the problem, why it happens, a suggested fix and a "done when" check. Line numbers are from
the files as they are today. Keep the house style: plain JavaScript, small functions, plain names,
comments that explain why (see RULES.md for the code map).

## Status (done 2026-10-05, by Sonnet, tested with real browsers)

Everything below is done except D1 (needs an iPhone). Where the finished work differs from what the item says, the note says why.

| Item | Status | Note |
|---|---|---|
| B1 | done | Not "no new connection for ever after a claim", but **bounded**: a browser that could not tell the friend the result keeps calling (every 10 s, then every 30 s) for at most 10 minutes, then stops; once the friend has the result it stops at once. Reason: the claimer must still be able to deliver the result to a friend who comes back (O2). |
| B2 | done | `openDialog` focuses with `preventScroll` and scrolls the window to its top. |
| B3 | done | `askConfirm` is a queue; `stillNeeded` drops a question that no longer matters (a draw offer after the game ended). |
| U1 | done | Board = `100svh - 452px` (floor 280 px, `vh` fallback for old phones). Also: a card with a clock hides the Thai name on narrow screens, because a smaller board made the cards narrower and the side label wrapped (+16 px per card). |
| U2, U3, U4, U5, U8, U9 | done | As written. U8 is one toast, "Connected to your opponent again.", on both sides. |
| U6 | done | Coarse pointers only: review buttons and tabs 44 px, move rows 40 px, top-bar icons and the mode button get an invisible 44 px tap area. |
| U7 | done | `makeMove(..., { keepReview: true })`; the button reads "Back to game · new move". |
| O1 | done | `makhos.online.<ROOM>.<role>` + `.alive` + `makhos.seat.<ROOM>`. After "No" nothing is offered again. A finished game is not offered. |
| O2 | done | `claimed: "away" \| "time"` travels in the `state` message only, and is believed only if the returning browser can see it is true (`validClaim`). A real round trip (`ping` with a time, `pong` echoing it) dates the start of an outage; messages that wait while a phone sleeps cannot fool it. |
| O3 | done, **different design** | Not "keep the lower clock": that would charge an honest player for the friend's absence. Instead: the saved game continues counting from its save time; a mover's own clock (`left`) replaces our guess but never goes up; after a reconnection `state` carries `elapsed` so a player who was away is charged for the running turn. Checked: both screens agree to the second after 25 s away, after a reload, and after a closed tab. |
| O4 | done | The game ends 10 s after the link was lost (not "at once"): if it was our own page that was asleep, the friend must not lose on time. |
| O5 | done | `AWAY_SECONDS = 120`; countdown in the status card, button, no pop-up. |
| O6 | done | A finished online game is saved (also `claimed`), restored with its result window, and the room is called again so *Rematch* works. |
| D1 | **not done** | Needs a real iPhone or Mac Safari. Nothing was changed. |

Suggested order: O1, O2, B1, B2, O3, O5, O4, U1–U4, then the rest.

How this list was made: all scripts were read, linted together with ESLint (no errors, no unused
names), checked for unused CSS, images and variables (none), and the online mode was played for real
with two Chrome browsers and a local PeerJS server. A phone's Home button was imitated by freezing the
page (Chrome DevTools `Page.setWebLifecycleState`). The test recipe is at the end.

---

## 1. Bugs

### B1. After an online game ends, the guest keeps reconnecting forever — Medium
- **Where:** `online.js` 213–217 `dialFailed`, 219–226 `redial`, 233–242 `onPeerError` (line 241).
- **How to see it:** the host closes their tab for good. After about 75 s the guest gets "Your opponent
  has not come back" and claims the win. The game is over, but the guest's page still opens a new
  connection to the introduction server every ~10 s. Measured: 3 new connections in the 30 s after the
  game ended, with no end. It wastes battery and data, and loads the free public PeerJS server.
- **Why:** `onPeerError` and `dialFailed` call `retryLater(redial)` whenever `net.state === "playing"`,
  without looking at `game.winner`. `net.state` stays `"playing"` after the game ends.
- **Fix:** stop reconnecting when the game is over, but only once the friend can know the result.
  - Keep a flag such as `net.resultDelivered`. Set it when we send `state` on an open link after
    `game.winner` was set.
  - In `redial`, `dialFailed` and `onPeerError`: if `game.winner && (net.resultDelivered || more than
    10 minutes since the game ended)`, stop: no retry, destroy the peer.
  - Do NOT simply stop on `game.winner`. A guest who makes the winning capture while disconnected
    must still reconnect so that the host receives that move (today this works, because the reconnect
    started before the game ended).
- **Done when:** in the scenario above, no new `Peer` is created in the 60 s after claiming the win.
  A guest who wins while the link is down still delivers the winning move once the host is back.

### B2. "How to play" opens scrolled to the bottom on phones — Medium
- **Where:** `ui.js` 20–26 `openDialog` (line 25 focuses the `data-autofocus` button). The tour's
  "Got it" button is `data-autofocus` (`index.html` 407).
- **How to see it:** first visit on a 360×740 phone. The window opens scrolled 386 px down, so the
  title and steps 1–2 are above the screen. A first-time player sees steps 5–7 first. The same was
  seen in screenshots at 390×844 and on a phone held sideways (844×390).
- **Why:** `.focus()` scrolls the scrolling `.modal` so that the focused button at the bottom of a
  tall card is visible.
- **Fix:** in `openDialog`, focus with `{ preventScroll: true }` and then set `element.scrollTop = 0`.
  Check that the other windows still show their focused button: they are short enough.
- **Done when:** at 360×740, 390×844 and 844×390 the tour opens showing its title, and Tab still
  reaches "Got it".

### B3. An incoming draw offer or rematch request is declined automatically if a question is open — Low
- **Where:** `ui.js` 72 (`askConfirm` returns `false` at once if `#confirm` is already open);
  `online.js` 546 (`onOffer`), 583 (`onRematch`).
- **How to see it:** online, open the "Resign?" question and leave it open. Meanwhile the friend
  offers a draw. The friend immediately gets "Your opponent declined the draw", but you never saw the
  offer. The same happens while "Your opponent has not come back" is open.
- **Fix:** when `#confirm` is busy, do not answer "no". Either keep the offer and ask once the
  current question closes (a small queue in `askConfirm`), or show it as a toast with Accept/Decline
  buttons. The simplest is the queue.
- **Done when:** with the "Resign?" window open, an incoming draw offer is shown after you close it,
  and nothing is sent until you answer.

---

## 2. UX / UI improvements

### U1. Tablets held upright: your own player card and clock are hidden behind the button bar — Medium
- **Where:** `style.css` 1015 (`--board` for screens ≤ 980 px: `calc(100svh - 300px)` is not enough
  height for everything else).
- **Measured on load (vs Computer):** 768×1024: 60 px of the bottom card hidden; 600×960: 39 px;
  360×740: 5 px; 810×1080: 4 px. The bottom card is "You", with your clock in a timed game.
- **Fix:** take more height off the board on tall portrait screens, for example
  `calc(100svh - 370px)`. Tune it so the whole bottom card sits above the fixed button bar with an
  8 px gap. Do not make phones like 390×844 smaller than needed.
- **Done when:** at 360×740, 390×844, 600×960, 768×1024 and 810×1080 the bottom of `#player-bottom` is
  at least 8 px above the top of `.controls`, without scrolling.

### U2. Two ways to change the mode on desktop compete with each other — Medium
- **Where:** `index.html` 69–74 (top links "2 Players", "Rules", "vs Computer", "Online") and the gold
  "Game mode" button in the same bar.
- **Problem:** "2 Players" and "vs Computer" do exactly what the gold button does (open New game). The
  user asked for the gold button to be THE place to change the mode, so the duplicate links weaken it.
- **Decided:** remove the "2 Players" and "vs Computer" links. Keep "Rules" and "Online", because a
  direct way into online play is useful. Check `renderModeChip()` (`render.js` 335), which toggles
  `is-active` on `[data-nav]`, and `bindUI` (`ui.js` 230–234). They must keep working with fewer
  links.
- **Done when:** the desktop top bar shows the brand, "Rules", "Online", the gold button and the three
  icons, and every remaining link still works.

### U3. "How to play" still explains the old way to start online play — Medium
- **Where:** `index.html` 403: "Press Online in the top bar (on a phone: New, then Online)".
- **Fix:** something like: "Press the gold **Game mode** button at the top, then **Online**, to make a
  room. Send the link or the code to a friend…". Keep it short.

### U4. In a 2-player game, "Player 1" is the side that moves second — Low
- **Where:** `game.js` 17–18: White is "Player 1" and Black is "Player 2", but Black moves first (and
  sits at the bottom).
- **Fix:** swap the names, so that Black, which moves first, is "Player 1". Check the game-over window
  (`render.js` 421–422) and the move list header still read well.

### U5. The review message is cut off on phones and mentions arrow keys — Low
- **Where:** `render.js` 224: "Use ◀ ▶ or the arrow keys. Press Back to game to carry on." On phones
  the status strip is one line, so it ends in "…Press Back to game to…".
- **Fix:** a shorter text, for example "Use ◀ ▶ to step through. Back to game returns." Mention the
  arrow keys only when the device has a fine pointer (`matchMedia("(pointer: fine)")`).

### U6. Small touch targets on phones — Low
- **Measured at 390×844:** review buttons ◀ ▶ 38×32 px, move-list moves 28 px tall, top-bar icons
  36×36 px. The usual minimum for a finger is 44 px.
- **Fix:** under `@media (pointer: coarse)` make the review buttons and move-list rows at least 40–44 px
  tall, and the top-bar icons 44 px where space allows. Re-check that the top bar still fits at 320 px
  (the gold button must not be cut; there is a small test for that in the recipe).

### U7. Online: the board jumps out of the review when the friend moves — Low
- **Where:** `game.js` 129 (`makeMove` sets `view.review = null`).
- **Problem:** while you look back through the game during the friend's turn, their move arrives and
  the board snaps back to the live position without a word.
- **Fix:** for moves that come from the friend (`playTurn` in `online.js`), stay in the review. Show
  "Back to game · new move" on the `#review-live` button instead, and play the "move" sound. Your own
  moves keep the current behaviour.

### U8. Online: no message when the friend comes back — Low
- **Where:** `online.js` 280–290 `setOpen`.
- **Fix:** when the link opens again after a loss (`net.everOpen` was already true), show the toast
  "Your opponent is back." Show "Reconnected." on the side that came back.

### U9. The game-over window can open on top of another window — Low
- **Where:** `render.js` 430 (`showGameOver` opens `#gameover` after 700 ms whatever else is open).
- **How to see it:** online, open Settings. The friend resigns, and the game-over window opens on top
  of the Settings drawer.
- **Fix:** if another dialog is open, wait until it closes (or until the next `closeDialog`) before
  opening the game-over window. The status card already says "Game over" meanwhile.

---

## 3. Online: leaving and coming back

Checked: the phone's Home button (the page goes to the background and is frozen), going to another
site, closing the tab, and reloading. Each was tested for the guest and for the host, with real
connections through a local PeerJS server.

| What the player did | Result |
|---|---|
| Guest presses Home for 30 s; the host moves meanwhile | OK. Reconnected 1.9 s after coming back; the host's move arrived. |
| Host presses Home for 30 s; the guest moves meanwhile | OK. Reconnected 8.2 s after coming back. |
| Away 100 s; the friend gets "Claim the win?" (~76 s) but does not answer | OK. The question closes by itself when the player comes back; the game goes on. |
| Goes to another website in the same tab, then presses Back | OK. Back in the game after 0.3 s. |
| Reloads the page | OK. |
| **Closes the tab, opens the invitation link again** | **Fails:** "This room already has two players." (O1) |
| **Closes the tab, opens the game's address again** | **Fails:** a new game vs the computer starts; the online game is gone. The friend sees "Trying to reconnect" until they claim the win. (O1) |
| **Host closes the tab and opens the game again** | **Fails:** the online game is gone; the guest is stuck. (O1) |
| **Away while the friend claims the win** | **Fails:** the returning player can keep playing a game that is already over. (O2) |
| **Away (or reloads) during your own turn with a clock** | **Fails:** that time is not taken off your clock. (O3) |

### O1. An online game is lost when its tab is closed — High
- **Where:** `game.js` 416–426 (`saveGame` puts online games in `sessionStorage`, which belongs to one
  tab and is gone in a new tab), 465–484 (`restoreSavedGame`); `ui.js` 316–337 (start-up);
  `online.js` 182–190 (`joinRoom` always makes a new seat token, line 188).
- **Why it fails:** a new tab finds nothing in `sessionStorage`. Coming back through the invitation
  link joins again with a NEW token, and the host refuses it because the seat belongs to the old
  token.
- **Fix (decided):**
  1. Also save every online game to `localStorage` under its room and role, for example
     `makhos.online.<CODE>.<host|guest>` = `{ savedAt, data }` (the same data `saveGame` writes).
     Keep `sessionStorage` as today: it says which game THIS tab plays, so two tabs on one computer
     can still play each other.
  2. Start-up, when this tab has no `sessionStorage` game:
     - The URL has `?room=CODE` and there is a saved **guest** game for CODE that is unfinished and
       less than 24 h old: restore it and call `resumeOnline()` with the saved token. Do not open the
       Join window.
     - No `?room=`, and there is an unfinished online game less than 24 h old: ask with `askConfirm`,
       "Continue your online game? Room K7M 2QX · you play White", Yes / "No, new game". Yes restores
       it and calls `resumeOnline()`. No deletes that saved game.
  3. Do not resume a game that is still open in another tab. Each tab with an online game writes
     `makhos.online.<CODE>.<role>.alive = Date.now()` every 3 s. Skip a saved game whose `alive` time
     is less than 10 s old. Without this, a second host tab would loop on "unavailable-id".
  4. Remember the guest's seat token per room in `localStorage`. Use it again when the same room is
     joined again from the Join window: today a half-finished first join (for example a dropped
     connection right after "hello") makes every later Join fail with "already has two players".
  5. Delete the `localStorage` copy when the game ends and nobody can come back to it any more:
     after `leaveRoom()`, when another game is started, or when `net.state` becomes `"stopped"`.
- **Done when:** with a local PeerJS server, all three failing rows of the table pass:
  - **Guest closes the tab and opens the invitation link again:** the guest is back in the same game
    with the same moves, and the host's status goes back to normal.
  - **Guest closes the tab and opens the plain address:** the "Continue…?" question appears, Yes
    resumes the game, No starts a new one.
  - **Host closes the tab and opens the address:** the host gets the same question, Yes re-opens the
    room, and the waiting guest reconnects by itself.
  - **Two tabs on one computer** (host in one, guest in the other) still work.

### O2. Coming back after the friend claimed the win: the game looks alive but is over — High
- **Where:** `online.js` 516–524 `applyResult` (line 520 ignores any result in which we lose);
  393–402 `onMove` (line 396 ignores moves once our game is over, without telling the friend).
- **How to see it:** the guest is away for ~80 s and the host presses "Claim the win". The guest
  comes back and reconnects: the status says "Your move". The guest plays a move and then waits
  forever for "Opponent's move", while the host's screen says "Game over · You win". The two boards
  now differ. The same happens with the roles swapped.
- **Why:** to stop a friend from simply declaring themselves the winner, only results in OUR favour
  are accepted. A claim after we were away is never accepted, and we are never told about it.
- **Fix:**
  - When a player claims the win (`askToClaimWin`), store and send the result with a marker, for
    example `{ winner, reason, claimed: true }`.
  - In `applyResult`, accept a result against us when `claimed === true`: end the game with the
    reason "Your opponent claimed the win while you were away". That claim is already a one-sided
    decision of the friend, and the returning player cannot change it, so showing it honestly is
    better than a silent dead game.
  - In `onMove`, when our game is already over, answer with `sendState()` so that the other side
    learns the result.
- **Done when:** in the scenario above, the returning player sees the game-over window with "Your
  opponent claimed the win while you were away" within a few seconds of reconnecting, and cannot
  move.

### O3. Time away, and reloading, are not counted on your clock — Medium
- **Where:** `game.js` 465–484 (`restoreSavedGame` starts the running clock from "now"), 416–426
  (`saveGame` stores the clocks without the time); `online.js` 506–509 (`playTurn` trusts the
  `left` value the mover sends).
- **How to see it:**
  - *Reload:* with a 5-minute game, think 10 s on your turn (clock 4:50) and reload. The clock is
    back at 5:00, and the friend's page accepts 5:00 with your next move.
  - *Away:* the guest's phone is in the background for 30 s while the host moves. On the guest's
    own screen the guest's clock only starts when the move arrives after reconnecting, so it shows
    9:58 where the host's screen shows 9:43. The guest's own value then wins.
- **Fix (decided):**
  - Save `savedAt: Date.now()` with the game. When an **online** game is restored, take
    `(now - savedAt)` off the clock of the side to move. (Local 2-player games may keep pausing while
    the page is closed; that is a fair pause for two people at one screen.)
  - Every `move` and `state` message also carries both clocks as the sender sees them:
    `clocks: { w, b }`. The receiver keeps the LOWER value for each side. Allow 2 s for network delay
    on the side that just moved. Then neither a reload nor time away can add time.
- **Done when:** both cases above end with the same clock values on both screens (within 2 s), and
  the 10 s or 30 s are taken off.

### O4. The friend's clock shows 0:00 but you cannot win while they are away — Medium
- **Where:** `game.js` 361–374 `tick` (line 365: "our friend's flag: their own game tells us").
- **How to see it:** the guest's clock runs out while the guest is away. The host sees 0:00 and
  "Connection lost" and has to wait for the claim timer: about 75 s after the friend left (15 s to
  notice the silence, then 60 s).
- **Fix:** when the friend's clock is at 0 and the link is down, end the game at once: "White ran out
  of time". Send it with the `claimed: true` marker from O2, so that the friend's page accepts it when
  they come back. If the link is up, keep today's behaviour: their own page tells us.
- **Done when:** the scenario ends on the host's screen within a second of the friend's clock
  reaching 0:00.

### O5. A player who steps away for one minute can lose the game, with repeated pop-ups — Medium
- **Where:** `online.js` 34 (`AWAY_SECONDS = 60`, plus 15 s before silence counts as gone), 603–620
  (`startAwayTimer`, `askToClaimWin`; "Keep waiting" asks the same question again every 60 s).
- **Problem:** on a phone, answering a message or a call easily takes more than 75 s, and then the
  friend may claim the win. The friend who waits gets a pop-up every minute.
- **Fix (decided):**
  - Raise `AWAY_SECONDS` to 120.
  - Show the wait in the status card instead of a surprise window: "Opponent away · you can claim the
    win in 1:12". When the time is up, show a "Claim the win" button in the status card; no pop-up,
    and nothing that repeats.
  - Keep the toast "The connection to your friend was lost." when the link drops.
- **Done when:** with the friend gone, the status card counts down from 2:00 and then offers the
  button. "Keep waiting" is no longer needed, and nothing pops up by itself.

### O6. After an online game ends, a reload loses the room, so there is no rematch — Low
- **Where:** `game.js` 205–213 (`endGame` calls `clearSavedGame()` for every mode).
- **Fix:** for online games, keep saving the finished game (with `winner` and `reason`) until a new
  game starts or the room is left. After a reload, show the final position and the game-over window,
  with Rematch working. `isSavedGameValid` and `restoreSavedGame` must then accept a saved winner
  for online games.

---

## 4. Needs a check on a real device

### D1. Sounds and music may not play on older iPhones and Macs (Safari)
- **Where:** `sound.js` 84 (knock recordings are `.ogg`), `music.js` 12 (the music is `.ogg`).
- **Not tested:** no Apple device was available. Older Safari versions cannot play Ogg files.
- **What to do:** on an iPhone, run `new Audio().canPlayType("audio/ogg; codecs=vorbis")` in the
  console. If it returns `""`, add `.m4a` (AAC) copies of the files and pick the format with
  `canPlayType` before creating the `Audio` objects. Keep the files small: the music was just
  re-encoded to 1.4 MB for old phones.

---

## 5. Already fine, keep it that way

- ESLint over all scripts glued together: no undefined or unused names. No unused CSS classes, ids,
  keyframes or variables. Every image is used.
- Online: reconnecting after Home, Back or reload (see the table); the "Claim the win?" question
  closing by itself when the friend is back; moves made while one side was away arriving on the other.
- The pieces' moiré fix (gold/lacquer discs are drawn at 256 px; do not go back to 360 px).

## 6. Test recipe (to check the online fixes)

1. In a folder outside the project: `npm i peer@1 puppeteer-core`, then start the introduction server
   with `npx peerjs --port 9000 --path /`.
2. Serve the project with a static server that supports Range requests (VS Code Live Server does;
   Python's `http.server` does not, which only matters for audio).
3. Open each player with `index.html?peerServer=127.0.0.1:9000&tour=0`. Use a separate browser
   profile for each player, so that their storage is separate.
4. Imitate the Home button with a DevTools session:
   `Page.setWebLifecycleState({ state: "frozen" })`, then `{ state: "active" }`.
5. Read the state with `page.evaluate(() => ({ moves: game.moves.length, open: net.open, winner:
   game.winner }))`. Play a turn by calling `makeMove` with the steps of
   `getFullMoves(game.board, game.turn)[0]`.
6. Close a tab with `page.close()` and open a new one in the SAME browser profile to test O1.
7. Headless Chrome needs `--no-sandbox`. Never run a broad `pkill chrome`: the user plays in their own
   Chrome on this machine.
