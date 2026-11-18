// Card artwork.
//
// By default the cards are drawn in the browser with plain text and suit symbols.
// To use hand-drawn cards instead, put one image per card in art/cards/ and set
// `enabled: true` below. Name each file after the card id: rank + suit, e.g.
//   QC.png  (queen of clubs)     TD.png (ten of diamonds)     7H.png (seven of hearts)
// Ranks: A T K Q J 9 8 7   Suits: C S H D   Card back: back.png
// Any card whose image is missing falls back to the built-in drawing.
export const CARD_ART = {
  enabled: false,
  folder: 'art/cards/',
  ext: '.png',
  back: 'back',
};
