# Card art

The game draws its own plain cards. To use hand-drawn ones:

1. Draw one image per card, all the same shape (about 2 wide by 3 tall works well, for example 400 × 580 pixels).
2. Save them in `art/cards/`, named after the card: rank, then suit.
   - Ranks: `A` `T` (ten) `K` `Q` `J` `9` `8` `7`
   - Suits: `C` clubs, `S` spades, `H` hearts, `D` diamonds
   - Examples: `QC.png` is the queen of clubs, `TD.png` the ten of diamonds, `7H.png` the seven of hearts.
   - The back of the cards is `back.png`.
3. In `js/art.js`, change `enabled: false` to `enabled: true`. If the files are `.jpg` or `.svg`, change `ext` to match.

That's 32 faces plus a back. Any card without an image yet falls back to the plain drawing, so they can be added a few at a time.
