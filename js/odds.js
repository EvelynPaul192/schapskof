// "What happens if I play this?" odds for the trainer.
//
// It deals the cards you can't see at random, many times over, in every way that fits
// what has happened so far: who is out of which suit, who must hold the called card,
// the picker keeping a card of the called suit, and the buried cards. Then for each
// card you could play, it counts how often a player on the other side, still to play
// in this trick, holds a card that beats it.
import { makeDeck, isTrump, suitOf, effSuit, beats, trickWinner, points, power, TRUMP_ORDER } from './cards.js';

const SAMPLES = 400;

/** What `seat` knows about where the unseen cards can be. */
export function knowledge(game, seat) {
  const n = game.n;
  const own = new Set(game.hands[seat]);
  const played = new Set(game.playedCards());
  const knownBuried = seat === game.picker ? new Set(game.buried) : new Set();
  const pool = makeDeck(n).filter((c) => !own.has(c) && !played.has(c) && !knownBuried.has(c));

  const voids = Array.from({ length: n }, () => new Set());
  const notPartner = new Set([game.picker]);
  const calledCard = game.calledCard;
  const calledSuit = game.calledSuit;
  const tricks = [...game.tricks.map((t) => t.plays), ...(game.trick ? [game.trick.plays] : [])];
  let calledShown = false;
  let pickerPlayedCalledSuit = false;
  for (const plays of tricks) {
    if (!plays.length) continue;
    const led = effSuit(plays[0].card);
    for (const p of plays) {
      if (p.card === calledCard) calledShown = true;
      if (p.seat === game.picker && calledSuit && effSuit(p.card) === calledSuit) pickerPlayedCalledSuit = true;
      if (effSuit(p.card) !== led) voids[p.seat].add(led);
      // While the called ace is out, anyone who follows the called suit with another card isn't the partner.
      if (calledSuit && !calledShown && led === calledSuit && effSuit(p.card) === calledSuit && p.card !== calledCard) notPartner.add(p.seat);
    }
  }

  const slots = [];
  for (let s = 0; s < n; s++) if (s !== seat) slots.push({ seat: s, size: game.hands[s].length });
  const buriedUnknown = seat !== game.picker && game.buried.length;
  if (buriedUnknown) slots.push({ seat: 'buried', size: game.buried.length });

  const mustPlace = calledCard && !game.partnerRevealed && seat !== game.partner && pool.includes(calledCard) ? calledCard : null;
  const pickerHold = calledSuit && !game.partnerRevealed && seat !== game.picker && !pickerPlayedCalledSuit;
  return { pool, voids, slots, mustPlace, notPartner, pickerHold, calledSuit };
}

function sampleDeal(game, k, rng) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const left = new Map(k.slots.map((sl) => [sl.seat, sl.size]));
    const deal = new Map(k.slots.map((sl) => [sl.seat, []]));
    const cards = [...k.pool];
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    if (k.mustPlace) {
      cards.splice(cards.indexOf(k.mustPlace), 1);
      cards.unshift(k.mustPlace);
    }
    let ok = true;
    for (const c of cards) {
      const es = effSuit(c);
      const options = [];
      let weight = 0;
      for (const sl of k.slots) {
        const room = left.get(sl.seat);
        if (!room) continue;
        if (sl.seat !== 'buried' && k.voids[sl.seat].has(es)) continue;
        if (c === k.mustPlace && (sl.seat === 'buried' || k.notPartner.has(sl.seat))) continue;
        options.push([sl.seat, room]);
        weight += room;
      }
      if (!options.length) { ok = false; break; }
      let r = rng() * weight;
      let pick = options[0][0];
      for (const [s, w] of options) { if ((r -= w) <= 0) { pick = s; break; } }
      deal.get(pick).push(c);
      left.set(pick, left.get(pick) - 1);
    }
    if (!ok) continue;
    if (k.pickerHold && !deal.get(game.picker).some((c) => !isTrump(c) && suitOf(c) === k.calledSuit)) continue;
    return deal;
  }
  return null;
}

/**
 * For each legal card for `seat`: how often someone on the other side, still to play
 * in this trick, can beat it. Also a few counts of what's still out.
 */
export function playOdds(game, seat, rng = Math.random) {
  const k = knowledge(game, seat);
  const legal = game.legalPlays(seat);
  const plays = game.trick.plays;
  const n = game.n;
  const after = [];
  for (let i = 1; i < n - plays.length; i++) after.push((seat + i) % n);

  const rows = legal.map((card) => {
    const all = [...plays, { seat, card }];
    const winsNow = trickWinner(all).seat === seat;
    return { card, winsNow, beaten: 0, samples: 0 };
  });

  const partnerUnknownToMe = game.partner != null && !game.partnerRevealed && seat !== game.partner;
  for (let i = 0; i < SAMPLES; i++) {
    const deal = sampleDeal(game, k, rng);
    if (!deal) continue;
    // In this imagined deal, who is on my side?
    const holder = partnerUnknownToMe ? [...deal.entries()].find(([, cs]) => cs.includes(game.calledCard))?.[0] : null;
    const isFoe = (s) => {
      const r = game.relation(seat, s);
      if (r !== 'unknown') return r === 'enemy';
      if (seat === game.picker) return s !== holder;
      return s === game.picker || s === holder;
    };
    for (const row of rows) {
      if (!row.winsNow) continue;
      row.samples++;
      const all = [...plays, { seat, card: row.card }];
      const led = effSuit(all[0].card);
      const best = trickWinner(all).card;
      const hit = after.some((s) => {
        if (!isFoe(s)) return false;
        const hand = deal.get(s);
        const follow = hand.filter((c) => effSuit(c) === led);
        const can = follow.length ? follow : hand;
        return can.some((c) => beats(c, best, led));
      });
      if (hit) row.beaten++;
    }
  }

  for (const row of rows) row.beatPct = row.winsNow && row.samples ? Math.round((100 * row.beaten) / row.samples) : null;

  const myBest = game.hands[seat].filter(isTrump).sort((a, b) => power(b) - power(a))[0];
  const trumpOut = k.pool.filter(isTrump);
  const higher = myBest ? trumpOut.filter((c) => power(c) > power(myBest)) : trumpOut;
  return {
    rows,
    trumpOut: trumpOut.length,
    trumpHigherThanMine: myBest ? higher.length : null,
    topTrumpOut: TRUMP_ORDER.find((c) => k.pool.includes(c)) || null,
    pointsOut: k.pool.reduce((s, c) => s + points(c), 0),
    includesBuried: k.slots.some((s) => s.seat === 'buried'),
    voids: k.voids.map((v, s) => ({ seat: s, suits: [...v] })).filter((v) => v.seat !== seat && v.suits.length),
  };
}
