# schapskof

A single-player Sheepshead trainer that runs in the browser. You play against computer players at a 3-, 4- or 5-handed table, with hints and odds that explain each play.

Made by Ev for Dad.

## Playing it

It's a plain static site: no build step and nothing to install.

- **Online:** turn on GitHub Pages for this repo (Settings → Pages → deploy from the `main` branch, root folder). The game is then at `https://<username>.github.io/schapskof/`.
- **On your computer:** the page uses JavaScript modules, which browsers won't load straight from a file. From this folder run `npm start` (needs Node) or `python3 -m http.server 8000`, then open http://localhost:8000.

## What's in it

- **3, 4 or 5 players.** Five-handed deals 6 cards each, four-handed takes out the black sevens and deals 7, three-handed deals 10. All have a 2-card blind.
- **House rules, each one a switch in Settings:**
  - Picker's partner: call an ace (default), jack of diamonds, or always alone. Three-handed is always alone.
  - Nobody picks: doubler (default; the next hand counts double, and doublers can stack) or redeal.
  - Booing the mowers: when nobody picks, anyone who should have picked gets booed and their hand is shown. A mower is five-handed with 4+ good trump (queens, jacks, A♦, 10♦), or three- or four-handed with 4+ counters (aces and 10s). Both numbers are adjustable.
  - Last hand: declare it between hands; it counts double.
- **Trainer:**
  - Hints for picking, calling and burying, and every card you play, each with the reason.
  - Odds: for each card you could play, the chance that someone on the other side who still has to play can beat it. It works by dealing the unseen cards hundreds of ways that fit everything that has happened so far (who is out of which suit, who must hold the called ace, the buried cards).
  - Hints and odds can each be turned off.
- Scores are kept per player, zero-sum, with schneider (×2) and no-trick (×3).

## Card art

The cards are drawn with text and suit symbols. To swap in hand-drawn cards, see [art/README.md](art/README.md).

## Code

| File | What it does |
| --- | --- |
| `js/cards.js` | Deck, trump order, points, who wins a trick |
| `js/rules.js` | Table sizes and the house-rule settings |
| `js/engine.js` | The rules of play: picking, burying, legal cards, scoring |
| `js/strategy.js` | How the computer players decide, and the hint text |
| `js/odds.js` | The odds shown for each card |
| `js/ui.js` | Draws the table and runs the game in the browser |
| `tests/` | Plays thousands of computer-only hands under every rule setting and checks the rules hold (`npm test`) |

Built with help from Claude.
