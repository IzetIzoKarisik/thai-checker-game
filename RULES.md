# Mak-hos (หมากฮอส): Thai Checkers

Open `index.html` in a browser (or use Live Server). Play a friend on the same screen, play the computer (Easy, Medium or Hard), or play a friend on another device over the internet. Games and settings are remembered between visits.

## Rules implemented

| Topic | Rule |
|---|---|
| Board | 8×8. Only the dark squares are used. The lower-left square is dark (a1 for White, h8 for Black). |
| Pieces | 8 per side on the first 2 rows. White: `a1 c1 e1 g1 b2 d2 f2 h2`. Black: `a7 c7 e7 g7 b8 d8 f8 h8`. |
| Square numbers | The 32 dark squares are numbered **1–32**, row by row, starting at Black's lower-left corner (h8 = 1 ... a1 = 32). Black's men start on 1–8, White's on 25–32. Moves are written with these numbers (`10-14`, `22×15×8`). The numbering is `squareNumber()` in `rules.js`; the numbers stay on their squares when the board is flipped. |
| First move | Black. |
| Man (เบี้ย) | Moves 1 square diagonally **forward**. Captures **forward only**. |
| Compulsory capture | If any capture exists you must capture. Free choice between captures (no "take the most" rule). |
| Multi-jump | After a jump, if the same piece can jump again it **must** keep jumping. |
| Removal | A captured piece is removed as soon as it is jumped. |
| Promotion | A man ending on the far row becomes a king (ฮอส). The move ends there, even in the middle of a chain. |
| King move | Any distance along a diagonal, forward or backward. |
| **King capture** | Can capture from a distance (empty squares in between), but **must land on the square directly behind** the captured piece, never further. May continue jumping in any direction. |
| Win | The opponent has no pieces or no legal move. Also: resignation, or the opponent's clock reaching 0. |
| Draw | By agreement (against the computer it accepts unless it is clearly ahead; online, your friend decides). **Automatic:** the same position (same side to move) three times; 25 moves each (50 plies) without a capture or a man move; or **one king each** when nobody can force a win. One king against one king is solved exactly (`kingVsKing()` in `rules.js`): it is a draw except in a few trapped-king positions in the corners, where someone can force a win, so the game goes on there. |
| Clock | Only in a game between two players, on one screen or online: Off, 5, 10 or 15 minutes each (default 10). Starts after Black's first move. No clock against the computer. |

### Not implemented (decide before adding)
- The traditional **เป่า** ("huff") penalty for ignoring a capture. Here capture is simply enforced.
- Rule choices still unverified against an official rulebook: who moves first, removal timing, a king reversing direction mid-chain, the **automatic draw rules** (my own choice; I could not find the official Thai counting rules; the one-king-each rule is a proven draw under this game's capture rule), and the **square numbering** (the usual 1–32 draughts convention; I found no official Thai scheme).

## Playing the computer

New game window (button **New**, the top-bar links, or the label above the move list): opponent, your side (Black, White or Random), difficulty. Against the computer your pieces are at the bottom, there is no clock, and **Undo** takes back your move *and* its reply. Draw offers are answered by the computer; **Resign** always resigns you.

## Playing online

**Button:** *Online* in the top bar, or *New* → *Online* (that is the way on a phone). One player picks *Create a room* (own side Black, White or Random; clock Off, 5, 10 or 15 minutes) and gets a **6-letter code** and a **link**. The other opens the link (it opens the Join window with the code filled in) or types the code under *Join a room*, then presses *Join*. The host's choices decide the game; the friend gets the other side.

In an online game:
- You cannot move on your opponent's turn. **Undo is not offered.** *Draw* sends an offer that the other player accepts or declines. *Resign* ends the game. *Rematch* asks for another game with the sides swapped.
- Each browser keeps the whole game and checks every move the other one sends with `rules.js`. A move that is not allowed stops the game ("The two boards no longer match").
- **The clock:** each browser runs its own clock authoritatively; the opponent's clock follows what they report with each move. A player whose time runs out says so; the other browser never ends the game by itself on the opponent's flag.
- **If the connection drops:** the status card says "Connection lost" and both browsers keep trying to find each other. When they do, both say which moves they have and the one that is behind catches up. After a minute the player who is still here is offered *Claim the win* (or *Keep waiting*).
- **A reload comes back into the game.** An online game is saved in the tab (`sessionStorage`, so two tabs on one computer can play each other), together with the room and a secret token that proves it is the same friend. Closing the tab ends that game for good. A friend who starts another game, or presses *Leave the game*, loses the online game.
- Strangers cannot take a seat: once a friend has joined, only they (same token) can come back; others hear "This room already has two players".

**How it works.** The two browsers are connected directly (WebRTC) with the [PeerJS](https://peerjs.com) library (`vendor/peerjs.min.js`, MIT). The free public PeerJS server only introduces them: the host's browser signs in as `makhos-<code>`, the friend asks for that name. Google's STUN server and PeerJS's relay (TURN) servers help when a network is awkward. Moves go straight from browser to browser, nothing is stored anywhere. As with any direct connection, the other player's browser can see your network (IP) address. To use your own introduction server, run PeerJS's `peerjs --port 9000` and open the game with `?peerServer=your-computer:9000`.

**Putting the game on the internet** (a link only works for other people if the game itself is online; the code works from any copy of the game):
- Easiest: <https://app.netlify.com/drop>: drag this whole folder onto the page. You get a link like `https://something.netlify.app`.
- Or GitHub Pages / Cloudflare Pages: upload the folder to a repository and switch the Pages feature on.
- On the same Wi-Fi, the phone can open the computer's address instead (for example `http://192.168.1.20:5500` from Live Server).

The messages between the browsers are listed at the top of `online.js`.

## Code map

Scripts load in this order (all plain files, no build step, no Web Workers so it also works from `file://`):

| File | What it does |
|---|---|
| `rules.js` | The rules only, no screen code. Board = `{ c3: "w", e5: "B" }` (`w`/`b` = man, `W`/`B` = king). Key functions: `getJumps`, `getSlides`, `getLegalMoves`, `applyMove`, `hasLegalMove`, `squareNumber`, `positionKey`, `kingVsKing`; draw limits `REPEAT_LIMIT`, `QUIET_LIMIT`. |
| `bot.js` | The computer opponent: `findBestMove(board, color, level, record)`, an iterative-deepening alpha-beta search (negamax) with a transposition table, searching whole turns (`getFullMoves`) at a time. `BOT_LEVELS` (`easy`/`medium`/`hard`) sets each one's thinking time and depth. `record` (positions seen, quiet plies) lets it see draws coming. `botAcceptsDraw()` answers draw offers. No screen code. |
| `sound.js` | Sound effects (wood-knock recordings in `sounds/` plus a few made with the browser's audio engine). `setSoundOn`, `setSoundVolume`, `playSound`. |
| `music.js` | Background music: loops `sounds/bach-prelude-c-major.ogg` (Bach's Prelude in C major, solo piano by Kimiko Ishizaka, CC0, 2:43). `musicVolume` (default 0.55) and `setMusicVolume`. Starts on the first click, fades in and out, remembers on/off in `localStorage`. |
| `game.js` | Game state (`game`), `startGame`, turn flow (`makeMove` → `finishTurn`), automatic draws, undo, draw offers and resigning, clocks (worked out from real time), the computer's turn (`maybeBotMove` → `requestBotMove` → `runBotMove` → `playBotMove`, which feeds the move back through `makeMove` one step at a time), reviewing earlier positions, saving the game (`saveGame`/`restoreSavedGame`). `hasOwnSide()` and `isOpponentTurn()` cover both the computer and an online friend. |
| `online.js` | Playing a friend over the internet: rooms, the connection and its messages, catching up after a drop, the friend's moves shown on our board (`playTurn`), draw offers, rematches, and the "Play online" window. `vendor/peerjs.min.js` is the library it uses. |
| `render.js` | Drawing the page from `game` and `view`: board (with square numbers, last-move path, × marks, fading captured pieces), status card and phone strip, player cards, clocks, move list, game-over window. Nothing here changes the game. |
| `input.js` | Clicking, drag and drop (mouse, pen, touch), the keyboard (Tab to the board, arrow keys, Esc), stepping through the moves. |
| `ui.js` | Dialogs (focus handling, `askConfirm`, `toast`), settings (saved in `localStorage`), the New game window, the buttons, URL parameters, and start-up. Loads last. |
| `img/` | `piece-white.png` and `piece-black.png`: photos of marble discs seen from above, cut out as round 360×360 PNGs. `piece-gold.png` and `piece-lacquer.png`: the "Black & gold" set, a gold disc and a black lacquer disc with gold inlay (drawn by `tools/render_discs.py`, not photos). `marble-cream/brown/white/black/green/ivory.jpg`: the marble pictures for the three marble boards (made by `tools/make_marble.py`), and `board-marble.jpg` / `board-onyx.jpg` / `board-emerald.jpg`: the little previews in Settings. |
| `tools/` | Two small Python scripts (numpy + Pillow) that made the pictures above. Not used by the game; run them only to change the colours. |
| `index.html` | Page structure. The board squares are created by `buildBoard()` in `render.js`. |
| `style.css` | All visuals. Themes: `<html data-board="green\|brown\|teak\|marble\|onyx\|emerald" data-pieces="classic\|caps\|marble\|gold">`. The `marble` (cream and brown), `onyx` (black and white) and `emerald` (green and ivory) boards cut every square from one big marble picture, so the veins run across the board. The `marble` and `gold` piece sets share one block of rules (written with CSS nesting) and differ only in their pictures (`--disc-w`, `--disc-b`). White's side is the marble or gold disc, Black's side the black one. |

Saved in `localStorage`: `makhos.settings` (looks, volumes, last New-game choices), `makhos.game` (the game in progress against the computer or on one screen), `music` (on/off). An online game is saved in `sessionStorage` under the same name `makhos.game`, so it belongs to its tab.

Handy URLs for screenshots and tests: `index.html?vs=computer&botSide=b&level=easy&board=green&pieces=classic&flip=1`
(`botSide` is the side the *computer* plays, `vs=friend&clock=5` for two players with a 5-minute clock, `new=1` ignores a saved game, `tour=0` hides "How to play", `room=K7M2QX` is a friend's invitation, `peerServer=host:port` uses another introduction server).

## CSS state classes (set by `renderBoard()` in `render.js`)

| Class | Meaning |
|---|---|
| `.sq.is-last` | Every square the last move touched |
| `.x-mark` | A dashed ghost outline with a thin cross where a piece was taken in the last move |
| `.sq.is-selected` | Selected piece |
| `.sq.is-target` | Plain move destination (a gold bead, the `.hint-dot` element) |
| `.sq.is-capture-target` | Capture landing square (a ruby ring with a bead, the `.hint-ring` element) |
| `.piece.is-ghost`, `.sq.is-victim` | Piece that would be captured by the selected move: the piece is dimmed, and its square gets a ruby target mark |
| `.piece.is-must` | Piece that must capture (orange ring, or a round glow for marble) |
| `.piece--movable` | Piece with a legal move (lifts on hover, can be dragged) |
| `.piece.is-promoted` | Just crowned (one-shot animation) |
| `.piece.is-captured` | A taken piece fading away |
| `.piece.is-dragged` | The piece being dragged |
| `.player.is-turn` | Player whose turn it is (lights up the clock) |
| `.player.is-thinking` | The computer is searching (its card pulses, three dots) |
| `.board-wrap.is-reviewing` | Looking at an earlier position (blue frame) |
