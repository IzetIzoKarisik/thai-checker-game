# Mak-hos — UX/UI improvement list

Reviewed 2026-10-04. **Implemented 2026-10-05: every item in sections 1–4**, plus the numbered squares. What changed and where is in `RULES.md` (code map). The details below are kept as the record of what was asked.

**Decisions taken (section 5):**
- D1 Automatic draws: **yes**. Same position 3 times, 25 moves each without a capture or man move, or one king each when nobody can force a win (my own rules, not from an official rulebook). The computer sees draws coming.
- D2 Clock against the computer: **none**. Between two players: Off / 5 / 10 / 15 minutes (default 10).
- D3 First screen: the page opens straight on the board, with the last game restored; first visit shows "How to play" once. First-ever default: you (Black) against the computer, Medium.
- D4 Music: on by default, a bit quieter (0.8 → 0.55), with a volume slider.
- D5 "Online · soon": kept (label made readable).
- D6 "Random" side: **added** (picks Black or White for you when the game starts).
- Square numbers: 1–32 on the dark squares, as in draughts notation; no official Thai scheme was found (see `RULES.md`).

**How to use this file:** pick the items you want, then give this file to the coder and name the IDs (for example: "do B1–B10, then H1"). Each item says what is wrong, what to change, which code to touch, and how to check it is done.
Size: **S** = small change, **M** = medium, **L** = large.

**What was checked:** the game at 1920×1080, 1440×900, 1366×768, a mid-size window (1100×800), tablet (820×1180), phone (390×844) and phone held sideways (844×390), in these states: start, piece selected, forced capture, mid-game with kings, computer thinking, game over, Rules tab, Settings. The vs Computer code paths (Undo, Draw, Resign, clicks during the computer's turn) were checked by reading the code.

---

## Do these first

1. **B1** "Play as" is backwards
2. **B2** Undo gets stuck against the computer
3. **B3** You can click during the computer's turn (can break the board)
4. **B5** Playing White puts your pieces at the top
5. **B6** Square orange box around marble pieces
6. **B7 / B8** Board or player bar cut off on mid-size screens and phones held sideways
7. **H1** A "New game" dialog (opponent, side, difficulty in one place)
8. **H2** Replace the browser pop-ups
9. **H3** Remember settings after a reload
10. **H6** Make the computer's moves easy to follow

---

## 1. Broken now (bugs)

### B1. "Play as" is backwards — S
- **Problem:** Settings → Opponent → Play as: choosing "Black" makes the *computer* play Black, so you get White. The highlighted button also shows the computer's side, not yours.
- **Fix:** The buttons should mean *your* side. Highlight `otherColor(view.botColor)`; on click set `view.botColor = otherColor(value)`. Renaming `data-setting="botSide"` to `humanSide` would make the code clearer.
- **Code:** `game.js` → `syncOpponentUI()`, `chooseBotSide()`; `index.html` → the "Play as" swatches.
- **Done when:** "Play as White" gives you the white pieces, and your card reads "You · White".

### B2. Undo gets stuck against the computer — M
- **Problem:** Undo takes back one turn. After your move and the computer's reply, Undo takes back only the computer's move. Now it is the computer's turn, but it never moves again, and you can select and move the computer's pieces.
- **Fix:** Against the computer, one Undo takes back your last move *and* the computer's reply, so it is always your turn afterwards. `game.history` holds the position at the start of each turn: pop until `game.turn` is your color. If the computer moved first and you have not moved yet, there is nothing to undo.
- **Code:** `game.js` → `undo()`.
- **Done when:** after 3 moves against the computer, pressing Undo twice goes back 2 of your moves, it is your turn each time, and the computer is never stuck.

### B3. You can click during the computer's turn — M
- **Problem:** The board still reacts to clicks while it is the computer's turn.
  - During a computer capture chain there is a 0.55 s pause between jumps. In that pause the computer's piece is shown selected, with red landing rings. Clicking a ring makes the jump for it. The computer's next planned jump then runs from an empty square: `applyMove()` deletes the piece it meant to capture, then throws a JavaScript error. The board is now corrupted.
  - Any time it is the computer's turn and it is not "thinking" (for example after the Undo bug above), you can select and move its pieces.
- **Fix:** Against the computer, ignore board clicks unless it is your turn and no computer move is in progress. Don't draw the selection, landing rings, "must capture" glow or hover-lift on the computer's pieces.
- **Code:** `game.js` → `onSquareClick()` (return early when `view.mode === "bot" && game.turn === view.botColor`), `renderBoard()` (skip the highlight blocks for the computer's side), `playBotMove()`.
- **Done when:** during a computer capture chain, clicks do nothing and no red rings show on its piece.

### B4. Draw and Resign don't make sense against the computer — S
- **Problem:** "Draw" asks "Black offers a draw. White, do you accept?", so you answer for the computer and can always force a draw. "Resign" resigns whoever's turn it is: if you press it during the computer's turn, the *computer* resigns and you win.
- **Fix:** Resign always resigns your side. For Draw, let the computer decide: accept only if it is not ahead (a quick `evaluate()` from its side ≤ 0), then show "Computer accepts the draw" or "Computer declines".
- **Code:** `game.js` → `offerDraw()`, `resign()`; `bot.js` → a small helper such as `botAcceptsDraw(board, color)`.
- **Done when:** a draw offer while the computer is clearly ahead is declined, and Resign during the computer's turn makes *you* lose.

### B5. Playing White against the computer puts you at the top — S
- **Problem:** The board always starts with Black at the bottom. If you play White, your pieces are on the far side and your "You" card is at the top.
- **Fix:** When a game against the computer starts, set `view.orientation` to your color (`"w"` = White at the bottom). Flip still works afterwards. 2-player games keep Black at the bottom.
- **Code:** `game.js` → `resetGame()`, `chooseBotSide()`, `chooseOpponent()`.
- **Done when:** after choosing White, your pieces and your card are at the bottom.

### B6. Square orange box around marble pieces — S
- **Problem:** The pulsing "this piece must capture" ring is drawn with `outline`. Marble pieces are square boxes with the image inside (`border-radius: 0`), so they get a square orange frame. The frame also clashes with the yellow "selected" color. Marble is the default piece set, so most players see this.
- **Fix:** For marble, pulse a glow that follows the piece's shape: `filter: drop-shadow(0 0 calc(var(--lift) * 1.2) rgba(255, 163, 26, .95))`, animated in strength. The marble shadow and the selected-piece lift (`.sq.is-selected .piece`) also use `filter`, so all three must go into one filter list for each case. Classic and bottle caps keep the round outline, which already looks right.
- **Code:** `style.css` → the "Marble" block, `.piece.is-must`, `@keyframes must-pulse`.
- **Done when:** a forced capture with marble pieces shows a round orange glow with no square corners, also while the piece is selected.

### B7. Mid-size screens: the bottom player bar is pushed off screen — S
- **Problem:** Between 981 and 1279 px wide (for example a 1100×800 window), the board size leaves 240 px for everything else. The top bar, both player bars and the gaps need about 330 px. The bottom player bar, often the one whose clock is running, ends up below the bottom of the screen.
- **Fix:** In the default (medium) layout use `--board: min(calc(100vh - 330px), calc(100vw - 500px), 760px)`, or make the 30 px gaps smaller and adjust the number to match.
- **Code:** `style.css` → `:root` `--board`, `.game` and `.board-col` gaps.
- **Done when:** at 1024×768 and 1100×800 the whole board and both player bars are visible without scrolling.

### B8. Phone held sideways: the board is cut off — M
- **Problem:** On phones the board size depends only on screen width (up to 640 px). Sideways (844×390) only 2 rows of the board are visible, and the fixed button bar covers more.
- **Fix:** Also limit the board by height, e.g. `min(calc(100vw - 40px), calc(100svh - 150px), 640px)`. For short landscape screens, use two columns (board left, panel right) with the buttons inside the panel instead of fixed to the bottom.
- **Code:** `style.css` → the `@media (max-width: 980px)` block, plus a new `@media (orientation: landscape) and (max-height: 560px)`.
- **Done when:** at 844×390 the whole board is visible and New/Undo/Flip/Draw/Resign can still be reached.

### B9. Side-panel header text wraps onto two lines — S
- **Problem:** Against the computer, the chip ("You vs Computer · Medium") and the text next to it ("Thai rules · 8 pieces each") each break onto two lines at normal laptop sizes. Your own screenshot showed this.
- **Fix:** Keep the chip on one line (`white-space: nowrap`), shorten it ("vs Computer · Hard", "2 players"), and move "Thai rules · 8 pieces each" under the chip or drop it (the Rules tab already says it).
- **Code:** `index.html` → `.panel__head`; `style.css` → `.panel__head`, `.mode-chip`, `.panel__sub`; `game.js` → `renderModeChip()`.
- **Done when:** the header is one tidy line at 1280–1920 px widths, in both modes.

### B10. Things that look clickable but aren't — S
- **Problem:** Moves in the move list show a hand cursor and a hover color, but clicking does nothing. The game-over button "Review game" only closes the dialog.
- **Fix:** Build review mode (P1). Until then, remove the pointer and hover style, and rename the button "See the board".
- **Code:** `style.css` → `.movelist .mv:hover`; `index.html` → game-over buttons.

---

## 2. Biggest improvements

### H1. A "New game" dialog — L
- **Problem:** Opponent, side and difficulty are hidden in Settings, and changing them restarts the game immediately. You once couldn't find "Hard" at all. The "vs Computer" link starts a game straight away without asking anything. On phones the top links are hidden, so the only way to play the computer is through Settings.
- **Fix:** One dialog (reuse the `.modal` and `.swatches` styles):
  - **Opponent:** Friend (same device) / Computer
  - **Your side** (Computer only): Black (moves first) / White / Random
  - **Difficulty** (Computer only): Easy "relaxed" / Medium "solid" / Hard "strongest, thinks about 3 seconds"
  - **Clock:** Off / 5 / 10 / 15 minutes (see D2)
  - **Start game** button

  Open it from the New button, the "Play" and "vs Computer" links, Rematch (pre-filled with the last choices) and by clicking the mode chip. Then take Opponent / Play as / Difficulty out of Settings, so Settings is only looks, help and sound.
- **Code:** `index.html` (dialog markup), `game.js` (one `startGame(options)` replacing the separate `chooseOpponent` / `chooseBotSide` / `chooseBotLevel` restarts), `style.css`.
- **Done when:** on any screen size, a Hard game as White can be started in 3 clicks or fewer, and the current difficulty is always visible.

### H2. Replace the browser pop-ups — M
- **Problem:** New game, mode change, Draw and Resign use the browser's `confirm()`: a grey system box that freezes the page and doesn't match the design.
- **Fix:** One small reusable confirm dialog with the `.modal` look: title, text, two buttons, Esc = cancel. Have it take a callback or return a Promise.
- **Code:** `game.js` → `confirmReset()`, `offerDraw()`, `resign()`; `index.html`; `style.css`.

### H3. Remember settings — S
- **Problem:** Board, pieces, help toggles, move sounds, opponent, side and difficulty all reset on every reload. Only music on/off is remembered.
- **Fix:** Save them to `localStorage` inside `try/catch` (the way `music.js` already does) and load them at start-up. URL parameters still win.
- **Code:** `game.js` → `setSetting()`, the toggles in `bindUI()`, `syncOpponentUI()`, and the start-up block at the end of the file.

### H4. Against the computer, talk to the player — S
- **Problem:** The texts still name colors ("Black to move", "Black wins!"). "Computer is thinking…" uses the orange warning style that "Capture is compulsory" uses.
- **Fix:**
  - On your turn: "Your move".
  - On the computer's turn: "Computer is thinking…" in a calm, neutral color.
  - At the end: "You win!", "Computer wins" or "Draw". Suggested Thai: คุณชนะ! / คอมพิวเตอร์ชนะ.
  - Show the difficulty in the computer's card, e.g. "Computer · Hard".
- **Code:** `game.js` → `renderStatus()`, `playerLabel()`, `renderPlayers()`, `showGameOver()`.

### H5. A calmer "thinking" state — S
- **Problem:** While the computer thinks, the whole board fades to 72% and loses its color, on every move. It looks broken, and you can't study the position while you wait.
- **Fix:** Keep the board fully visible (still not clickable). Show the thinking on the computer's card instead: three animated dots after its name and a soft pulse on the card, plus the calm status text from H4.
- **Code:** `style.css` → `.board-wrap.is-thinking` (remove `opacity` and `filter`, keep `pointer-events: none`), add `.player.is-thinking`; `game.js` → `render()`.

### H6. Make the computer's moves (and yours) easy to follow — M
- **Problem:** The last move only lights up its start and end squares. After a capture chain you can't see the path or which pieces were taken, and taken pieces vanish instantly. Against the computer, this is where players get lost.
- **Fix:**
  - Mark every landing square of the last move: small dots, or a thin line along `game.last.path`.
  - Mark the captured squares with a faint red × until the next move.
  - Let captured pieces shrink and fade (about 250 ms) instead of disappearing.
- **Code:** `game.js` → `makeMove()` (also store the captured squares in `game.last`), `renderBoard()`, `animatePiece()`. Note: `render()` rebuilds the whole board every time, so a fade-out needs a temporary copy of the piece, added after the render and removed when its animation ends.

### H7. Phones: keep the important message on screen — M
- **Problem:** On phones the status card ("Capture is compulsory", "Keep jumping!", "Computer is thinking…") sits below the board and the bottom player bar, half hidden under the fixed button bar. You have to scroll to see why a piece won't move.
- **Fix:** On screens up to 980 px, show a one-line status strip right under the board (same title text and color), or put the message inside the active player's card.
- **Code:** `index.html`, `style.css` (`max-width: 980px`), `game.js` → `renderStatus()`.

---

## 3. Polish

### P1. Review mode — M
Click a move in the list to see the position after it (read-only), step with ◀ ▶ buttons or the arrow keys, and use "Back to game" to return. Wire the game-over "Review game" button to it. `game.history` already has the position at the start of every turn.

### P2. Move list column headers — S
Add a small header row, "● Black   ○ White", above the list. Black moves first, and right now nothing shows which column belongs to whom.

### P3. Disabled buttons — S
Show buttons as disabled when they can't do anything: Undo with nothing to undo, Undo/Draw/Resign after the game ends, and anything blocked while the computer thinks. Use `disabled` plus a dimmed style.

### P4. Legal-move dots are hard to see — S
On dark teak squares the dot (`--hint-dot: rgba(30, 18, 8, .30)`, 17% of the square) almost disappears. Make it bigger (about 22%) and stronger (darker alpha, or a light dot with a dark ring). Check all three boards.

### P5. Small pieces should match the chosen piece set — S/M
The player-card avatars, captured-piece rows, status dot, board-guide icons and game-over pieces always use ivory/ebony gradients, even with marble or bottle caps chosen. Make them follow `data-pieces` (marble: use the PNGs; caps: red/silver). In `style.css`: `.mini-piece--w/--b`, `.status__dot`, `.lg--must`, `.lg--king`.

### P6. Drag and drop — M
Let players drag a piece to its square (pointer events, so it works on touch too) and keep click-to-move. Players coming from chess sites expect this.

### P7. Keyboard and screen readers — M
- Right now the 32 dark squares are 32 separate Tab stops. Give the board one Tab stop, then move with the arrow keys (a "roving tabindex"); Enter/Space picks up or drops, Esc cancels.
- Give squares fuller labels, like "e3, black man" or "c3, capture landing".
- Announce moves, including the computer's, through the existing `aria-live` status.

### P8. Focus in dialogs — S
When Settings or a dialog opens, move keyboard focus into it, keep Tab inside it, and return focus to the button that opened it when it closes. Clicking the dark background should also close the game-over dialog.

### P9. Accurate clocks — S
`tick()` subtracts 1 second per call. Browsers slow timers down in background tabs, and the computer's search blocks them, so clocks lose time. Store when the turn started and compute the remaining time from the real time instead.

### P10. Better game-over dialog — S
Against the computer, say "You win!" / "Computer wins" and show the difficulty. Offer "Rematch" and "Rematch, swap sides". Let the player see the final position, because the blur hides it.

### P11. "How to play" on the first visit — M
Thai rules differ from other checkers: men capture forward only, and a king must land right behind the piece it captures. Show a short, dismissable "How to play" sheet on the first visit, remembered in `localStorage` and reachable later from Rules. The Board guide only appears on screens at least 1340 px wide and over 700 px tall, so most laptops and all phones never see it.

### P12. Reduced motion for the piece animation — S
`animatePiece()` uses `element.animate()`, which the CSS `prefers-reduced-motion` rule does not stop. Check `matchMedia("(prefers-reduced-motion: reduce)")` there and skip the animation.

### P13. Keep the game after a reload — M
Save the current game (board, turn, moves, clocks, history, mode) to `localStorage` after each move, and offer "Continue last game" on load. A refresh or a phone discarding the tab currently loses the game.

---

## 4. Nice to have

- **N1.** Show the material difference ("+2") next to the captured pieces of the side that is ahead.
- **N2.** Coordinates are about 7 px on phones (17% of a 44 px square). Give them a minimum size.
- **N3.** The move list uses "♛" (a chess queen) for a new king. Use the crown icon from the board instead.
- **N4.** Hard always thinks for the full 3 seconds, even when only one move makes sense. Stop early when the best move stays the same over several depths, or when a forced win is found.
- **N5.** The logo is a link (`href="#"`) that does nothing. Make it open the New game dialog, or make it plain text.
- **N6.** "Online · soon" is grey and its "soon" label is 10 px. Remove it until online play exists, or make the label readable.
- **N7.** On phones and tablets the pieces-left badge touches the player name, and its meaning ("pieces left") is only in a tooltip. Write it as "5 left" or move it.
- **N8.** Add a small picture to the Rules tab showing where a king lands after a capture, since that rule confuses people most.
- **N9.** When the tab is in the background and it is your move against the computer, show "Your move" in the tab title.
- **N10.** Add volume sliders for the music and the move sounds.
- **N11.** On an illegal click (for example a piece that can't move because another one must capture), give the piece a small shake and flash the pieces that must capture.

---

## 5. Decisions only you can make

- **D1. Automatic draws.** Today the only draw is by agreement, so two kings chasing each other can go on forever (also against the computer). Add a rule? For example: draw after 30 moves with no capture, or when the same position appears 3 times. This is a rules question, and the Thai rules were never checked against an official rulebook.
- **D2. Clock against the computer.** Keep 10 minutes each, default to no clock, or offer choices (H1)?
- **D3. First screen.** Should the page open straight into a 2-player game (as now), or show the New game dialog first?
- **D4. Music.** It starts by itself on the first click. Keep it on by default, or start with it off?
- **D5. "Online · soon".** Keep it or remove it?
- **D6. Random side.** Offer "Random" as a side choice in H1?

---

## 6. Notes for whoever codes this

- Plain HTML/CSS/JS with no build step and no frameworks. All functions are globals. The scripts load in this order: `rules.js` → `bot.js` → `game.js` → `music.js`. `rules.js` and `bot.js` have no screen code; keep it that way.
- Keep the code simple and readable, and match the existing comment style (short plain-English comments above functions).
- The game is opened through VS Code Live Server (127.0.0.1:5500) or straight from disk (`file://`), so no Web Workers (Chrome blocks them on `file://`).
- `render()` rebuilds all 64 squares every time (`buildBoard()` sets `innerHTML`). Animations that must survive a render (H6) need a temporary element added after it.
- `game.history` holds a snapshot at the start of every turn. It is the basis for Undo (B2) and review mode (P1).
- Computer opponent: `findBestMove()` is in `bot.js`. The game side is `maybeBotMove` → `requestBotMove` → `runBotMove` → `playBotMove` in `game.js`. `thinkToken` cancels a computer move left over from a previous game.
- **Testing:** use headless Chrome with its own profile (`--user-data-dir=<scratch folder>`). **Never run `pkill chrome`**: the user's real Chrome runs on the same machine. To screenshot a particular state, put a temporary copy of `index.html` with an injected setup script in the project folder (so relative paths work), take the screenshot, then delete the copy. One test that ran the Hard search under `--virtual-time-budget` hung; if a test hangs, suspect that combination.

## What already works well (don't break it)

- The look: the lamp-lit wooden table, framed board, marble pieces and three board themes.
- The status card's guidance ("Capture is compulsory", "Keep jumping!", "That piece cannot capture").
- The capture preview: the faded piece with a red × and the red landing ring.
- The round "must capture" ring on classic and bottle-cap pieces.
- The sounds, the crowning animation and the game-over card design.
- The phone layout in portrait (apart from H7): pinned buttons, 44 px squares, big clocks.
