// Cards, trump order and points for Sheepshead.
// A card is a two-character id: rank + suit, e.g. "QC" (queen of clubs), "TD" (ten of diamonds).

export const SUITS = ['C', 'S', 'H', 'D'];
export const FAIL_SUITS = ['C', 'S', 'H'];
export const SUIT_SYMBOL = { C: '♣', S: '♠', H: '♥', D: '♦' };
export const SUIT_NAME = { C: 'clubs', S: 'spades', H: 'hearts', D: 'diamonds' };
export const RANKS = ['A', 'T', 'K', 'Q', 'J', '9', '8', '7'];
export const RANK_LABEL = { A: 'A', T: '10', K: 'K', Q: 'Q', J: 'J', 9: '9', 8: '8', 7: '7' };
export const RANK_NAME = { A: 'ace', T: '10', K: 'king', Q: 'queen', J: 'jack', 9: '9', 8: '8', 7: '7' };
export const POINTS = { A: 11, T: 10, K: 4, Q: 3, J: 2, 9: 0, 8: 0, 7: 0 };

// Highest first. All queens, all jacks, then the rest of the diamonds.
export const TRUMP_ORDER = ['QC', 'QS', 'QH', 'QD', 'JC', 'JS', 'JH', 'JD', 'AD', 'TD', 'KD', '9D', '8D', '7D'];
const FAIL_ORDER = ['A', 'T', 'K', '9', '8', '7'];

export const rankOf = (id) => id[0];
export const suitOf = (id) => id[1];

export function isTrump(id) {
  const r = id[0];
  return r === 'Q' || r === 'J' || id[1] === 'D';
}

/** The suit a card "belongs to" for following suit: 'T' for any trump. */
export function effSuit(id) {
  return isTrump(id) ? 'T' : id[1];
}

export function points(id) {
  return POINTS[id[0]];
}

export function sumPoints(cards) {
  return cards.reduce((s, c) => s + points(c), 0);
}

/** Bigger beats smaller. Trump always outranks fail; fail only compares within the led suit. */
export function power(id) {
  if (isTrump(id)) return 100 - TRUMP_ORDER.indexOf(id);
  return 10 - FAIL_ORDER.indexOf(id[0]);
}

export function shortName(id) {
  return RANK_LABEL[id[0]] + SUIT_SYMBOL[id[1]];
}

export function longName(id) {
  return `${RANK_NAME[id[0]]} of ${SUIT_NAME[id[1]]}`;
}

export function makeDeck(numPlayers) {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  // Four-handed: take out the black sevens so 7 cards each plus a 2-card blind works out.
  if (numPlayers === 4) return deck.filter((c) => c !== '7C' && c !== '7S');
  return deck;
}

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Trump first (best to worst), then clubs, spades, hearts. */
export function sortHand(cards) {
  const group = (c) => (isTrump(c) ? 0 : 1 + FAIL_SUITS.indexOf(c[1]));
  return [...cards].sort((a, b) => group(a) - group(b) || power(b) - power(a));
}

/** Does card `c` beat the card currently winning a trick whose led suit is `led`? */
export function beats(c, winning, led) {
  const ct = isTrump(c);
  const wt = isTrump(winning);
  if (ct && !wt) return true;
  if (ct && wt) return power(c) > power(winning);
  if (wt) return false;
  return effSuit(c) === led && effSuit(winning) === led && power(c) > power(winning);
}

/** plays: [{seat, card}], in play order. Returns the winning entry. */
export function trickWinner(plays) {
  const led = effSuit(plays[0].card);
  let best = plays[0];
  for (const p of plays.slice(1)) if (beats(p.card, best.card, led)) best = p;
  return best;
}
