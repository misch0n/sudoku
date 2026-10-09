# Sudoku: product and UX notes

What this app is for, where other Sudoku apps create friction, and what we
build next. The first version in `public/` covers the core and some of the
optional features. This doc explains why each one works the way it does.

## The core loop

1. **Pick a difficulty → get a fresh puzzle right away.** No accounts, no
   loading spinner, no puzzle packs. A puzzle generates in under 100 ms in
   the browser.
2. **Select a cell, enter a digit.** Givens are dark and bold. Your entries
   are blue. Cells you can't edit don't react.
3. **Board full → a clear verdict.** "Solved!" with time, hints and
   mistakes, or "Not quite: 2 digits don't fit yet" with a *Show me* button.
   It never just sits there with a full board and no answer.

## Friction in other apps, and our answer

| Friction | What we do |
| --- | --- |
| **Difficulty labels don't mean much.** Many apps grade by how many givens there are, so an "Easy" puzzle can need a hard technique and an "Expert" can be all singles. | Difficulty is the **hardest technique you need**. A built-in logical solver tries techniques from easiest to hardest. Easy = hidden singles only. Medium = adds naked singles. Hard = locked candidates, pairs and triples. Expert = X-Wing, Swordfish and Y-Wing. The new-game screen says this in plain words. |
| **"Expert" puzzles that need guessing.** | Every generated puzzle can be solved by the techniques its label promises. No trial and error. |
| **Hints that just fill in a cell.** You learn nothing, and it feels like cheating. | **Hints come in steps.** (1) A nudge: "Look at box 4: where can 7 go?" with the box highlighted. (2) The explanation and the cell. (3) Only then does it fill the cell in. If one of your digits is already wrong, the hint says so first. Otherwise it would build on a broken board. |
| **Mistake punishment** ("3 mistakes and you lose", red flashes on every wrong guess). | You choose how much help you get: *show rule breaks* (default: flags digits that clash with a row, column or box, without revealing the answer), *show wrong digits* (checks against the solution), or *check at the end*. Mistakes are counted quietly for your own stats. They never end the game. |
| **Losing your game** when you refresh, close a tab or your phone kills the browser. | Everything autosaves on every move. Opening the page puts you back where you were, with a short "Welcome back" message. There's no "Resume?" screen to click through. |
| **Timer runs while you're away.** | It pauses on its own when the tab is hidden and restarts when you come back. Pausing by hand hides the board so the timer stays fair. You can also hide the timer completely. |
| **Notes are tedious.** | Placing a digit clears it from notes in the same row, column and box (you can turn this off). Notes matching the selected digit are highlighted. Shift+digit adds a note without switching modes. |
| **No easy way to fix a mis-tap.** | Unlimited undo and redo. Tapping the same digit again on a cell takes it back out. Erase clears the digit first, then the notes. |
| **Number pad hides useful info.** | Each digit shows how many are left to place and fades out once all nine are on the board. |
| **Puzzles from a book or newspaper can't be played in the app.** | Paste any 81-character puzzle. We check it has exactly one solution and grade it with the same scale. |
| **Sharing a puzzle with a friend.** | After solving, *Share puzzle* gives you a link (`#p=<81 chars>`). Whoever opens it gets that exact puzzle. |

## Optional features: what we did and what's next

### Resume a game ✅
Your game is autosaved to `localStorage` after every move and every few
seconds while the timer runs. When you open the page, your game comes back.
If you start a new game partway through, the old one is saved in History as
*abandoned*. It's never silently thrown away.

*Next:* support several games in progress at once, one per difficulty.

### Notes ✅
Covered above. *Next:* an "auto-fill notes" option for Hard and Expert, a
long-press on a digit to enter notes on touch screens, and coloured notes for
people who use colouring strategies.

### History ✅ (first version)
Solved and abandoned games with time, hints and mistakes. Per-difficulty
totals: solved count, best time (only games with no hints count) and average.
Any past puzzle can be replayed.

*Next:* streaks, a chart of times per difficulty, and export/import so
history can move between devices without an account.

### Pulling from reputable sources: recommendation
Before building this, consider:

- **Licensing.** Most big sources (NYT, newspapers, Sudoku.com, commercial
  puzzle setters) don't allow puzzles to be copied into another app.
  Scraping them is a legal and ethical problem, and a brittle one too.
- **Better options:**
  1. **Generate and grade ourselves** (what the app does now). Puzzles are
     endless, need no network, and difficulty means the same thing every
     time. Grading by technique is what serious sources do anyway.
  2. **Let people bring their own** (done: paste a puzzle or open a link).
     Any source becomes playable, and we don't redistribute anything.
  3. **Openly licensed collections** for curated sets, such as Gordon Royle's
     17-clue puzzles and public benchmark sets like the tdoku collections.
     Check each set's licence first. A good fit for a "Daily puzzle" or
     "Classic" mode.
- **Daily puzzle without a server:** derive the seed from the date. Everyone
  gets the same generated puzzle that day, which makes it easy to share and
  compare times.

## Ideas we haven't explored yet

- **Daily puzzle** from a date seed (see above). It's cheap and gives people
  a reason to come back.
- **Teach mode:** the hint engine already explains each step in words. A
  lesson could start with a puzzle that needs exactly one new technique.
- **Digit-first input** (pick a digit, then tap cells) as an option. Some
  players find it faster, especially on phones.
- **Show which technique was hardest** after a solve ("This one needed an
  X-Wing").
- **Accessibility:** cells already have screen-reader labels and full keyboard
  play. Next: announce the row, column and box contents on demand, and add a
  high-contrast theme.
- **Installable PWA** with offline play. The app is already fully
  client-side, so this only needs a manifest and a service worker.

## Architecture

- `public/js/sudoku.js`: the engine. Pure functions with no DOM, tested
  under Node. It has a bitmask backtracking solver for uniqueness checks, a
  logical solver with 11 human techniques for grading and hints, and a
  seeded generator. The generator removes cells in symmetric pairs and only
  removes a pair if the puzzle stays unique and solvable within the target
  technique level.
- `public/js/app.js`: UI state, rendering, input, saving, history.
- No build step and no dependencies. GitHub Pages serves `public/` as-is.
