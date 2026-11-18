// How the computer players think, and the hints shown to the human player.
// Bots only look at their own cards and what has been played on the table.
import {
  isTrump, suitOf, effSuit, points, power, beats, trickWinner, shortName, sumPoints,
  TRUMP_ORDER, FAIL_SUITS, SUIT_NAME,
} from './cards.js';

// ---- Judging a hand --------------------------------------------------------

const TRUMP_VALUE = {
  QC: 3.5, QS: 3.2, QH: 3, QD: 2.8, JC: 2.4, JS: 2.2, JH: 2, JD: 1.8, AD: 1.5, TD: 1.4, KD: 1.1, '9D': 1, '8D': 1, '7D': 1,
};

/** A rough "how good is this hand for picking" number. */
export function handStrength(cards) {
  let s = 0;
  for (const c of cards) {
    if (isTrump(c)) s += TRUMP_VALUE[c];
    else if (c[0] === 'A') s += 1;
    else if (c[0] === 'T') s += 0.3;
  }
  for (const suit of FAIL_SUITS) if (!cards.some((c) => !isTrump(c) && suitOf(c) === suit)) s += 0.5;
  return s;
}

// About what it takes to pick, by table size. Three-handed you play alone against two,
// so you need more; five-handed you usually get a partner.
const PER_CARD = { 3: 1.2, 4: 1.3, 5: 1.35 };

export function pickThreshold(numPlayers, handSize) {
  return PER_CARD[numPlayers] * handSize;
}

const GOOD_TRUMP = new Set(['QC', 'QS', 'QH', 'QD', 'JC', 'JS', 'JH', 'JD', 'AD', 'TD']);
export const goodTrumpCount = (cards) => cards.filter((c) => GOOD_TRUMP.has(c)).length;
export const counterCount = (cards) => cards.filter((c) => c[0] === 'A' || c[0] === 'T').length;

/**
 * A "mower" (mauer) should have picked but got nervous and passed.
 * Five-handed: four good trump. Three- and four-handed: lots of counters.
 */
export function isMauerHand(cards, numPlayers, settings = {}) {
  if (numPlayers === 5) return goodTrumpCount(cards) >= (settings.mauerGoodTrump ?? 4);
  return counterCount(cards) >= (settings.mauerCounters ?? 4);
}

function trumpList(cards) {
  return cards.filter(isTrump).sort((a, b) => power(b) - power(a));
}

export function pickAdvice(cards, numPlayers, { lastToAct = false } = {}) {
  const s = handStrength(cards);
  const t = pickThreshold(numPlayers, cards.length);
  const trumps = trumpList(cards);
  const aces = cards.filter((c) => c[0] === 'A' && !isTrump(c));
  const desc = `${trumps.length} trump${trumps.length === 1 ? '' : 's'}${trumps.length ? ` (${trumps.slice(0, 3).map(shortName).join(' ')}${trumps.length > 3 ? '…' : ''})` : ''}`
    + (aces.length ? `, ${aces.length} fail ace${aces.length > 1 ? 's' : ''}` : '');
  let pick = s >= t;
  let why;
  if (s >= t + 1.5) why = `Pick. ${desc} is a strong hand. Passing it would make you a mauer.`;
  else if (pick) why = `Pick. ${desc} is enough to take the blind.`;
  else if (lastToAct && s >= t - 1.5) {
    why = `Close call. ${desc} is a little thin, but everyone else passed, so picking avoids a pass-out.`;
  } else why = `Pass. ${desc} is on the weak side to pick.`;
  return { pick, why, strength: s, threshold: t };
}

export function botWantsPick(cards, numPlayers, rng = Math.random, lastToAct = false) {
  const wobble = (rng() - 0.5) * 1.2; // bots aren't all the same
  const s = handStrength(cards) + wobble;
  const t = pickThreshold(numPlayers, cards.length);
  if (s >= t) return true;
  return lastToAct && s >= t - 1 && rng() < 0.35;
}

// ---- Calling and burying ---------------------------------------------------

/**
 * Choose a partner call and the cards to bury.
 * `options` comes from Game.callOptions(); `buryCount` is how many to bury.
 */
export function chooseCallAndBury(hand, options, buryCount, numPlayers) {
  let call = options.find((o) => o.type === 'jd') || null;
  const aceCalls = options.filter((o) => o.type === 'ace');
  if (aceCalls.length) {
    // Call the suit where you hold the fewest cards: one "hold" card is ideal.
    const count = (s) => hand.filter((c) => !isTrump(c) && suitOf(c) === s).length;
    aceCalls.sort((a, b) => count(a.suit) - count(b.suit));
    call = aceCalls[0];
  }
  // A monster hand goes alone.
  const strength = handStrength(hand);
  if (!call || strength >= pickThreshold(numPlayers, hand.length) * 1.8) call = options.find((o) => o.type === 'alone');

  // Keep one card of the called suit (the lowest), then bury fail cards: voids first, then points.
  let hold = null;
  if (call.type === 'ace') {
    hold = hand.filter((c) => !isTrump(c) && suitOf(c) === call.suit).sort((a, b) => power(a) - power(b))[0];
  }
  const suitCount = (s) => hand.filter((c) => !isTrump(c) && suitOf(c) === s).length;
  const score = (c) => {
    if (c === hold) return -1000;
    if (isTrump(c)) return -100 + (20 - TRUMP_ORDER.indexOf(c)) * -1; // bury trump only if forced, and the worst one
    if (c[0] === 'A') return -5; // fail aces win tricks, keep them
    return points(c) + (4 - suitCount(suitOf(c))) * 3;
  };
  const bury = [...hand].sort((a, b) => score(b) - score(a)).slice(0, buryCount);
  return { call, bury };
}

export function buryAdvice(hand, options, buryCount, numPlayers) {
  const { call, bury } = chooseCallAndBury(hand, options, buryCount, numPlayers);
  let callText;
  if (call.type === 'ace') callText = `Call the ace of ${SUIT_NAME[call.suit]}, since you're shortest in ${SUIT_NAME[call.suit]}. Keep one ${SUIT_NAME[call.suit].slice(0, -1)} as your "hold" card.`;
  else if (call.type === 'jd') callText = 'Your partner is whoever has the jack of diamonds.';
  else callText = 'Go alone.';
  const buryText = `Bury ${bury.map(shortName).join(' and ')}. Buried points count for you, and short suits let you trump in later.`;
  return { call, bury, why: `${callText} ${buryText}` };
}

// ---- Playing a card ------------------------------------------------------------

/** Pick a card for `seat` and say why. Uses only what that seat can see. */
export function choosePlay(game, seat) {
  const legal = game.legalPlays(seat);
  const n = game.n;
  const plays = game.trick.plays;
  const isPicker = seat === game.picker;
  const isSecretPartner = seat === game.partner; // a seat always knows if it holds the called card
  const onPickerSide = isPicker || isSecretPartner;
  const byPower = (a, b) => power(a) - power(b);
  const cheapest = (cards) => [...cards].sort((a, b) => points(a) - points(b) || (isTrump(a) - isTrump(b)) || byPower(a, b))[0];
  // Points to give a teammate: fail points first, then A/10/K of diamonds; never waste a queen or jack.
  const richest = (cards) => {
    const fail = cards.filter((c) => !isTrump(c)).sort((a, b) => points(b) - points(a) || byPower(a, b));
    if (fail.length && points(fail[0]) > 0) return fail[0];
    const fat = cards.filter((c) => isTrump(c) && c[1] === 'D' && points(c) >= 4).sort((a, b) => points(b) - points(a));
    if (fat.length) return fat[0];
    return cheapest(cards);
  };

  if (legal.length === 1) return { card: legal[0], why: 'This is the only card you can play.' };

  // Leading
  if (plays.length === 0) {
    const trumps = legal.filter(isTrump).sort(byPower);
    const fails = legal.filter((c) => !isTrump(c));
    if (onPickerSide && trumps.length) {
      const top = trumps[trumps.length - 1];
      return { card: top, why: `Lead ${shortName(top)}. On the picker's side you lead trump to pull it out of the other hands.` };
    }
    if (!onPickerSide) {
      const cs = game.calledSuit;
      if (cs && !game.partnerRevealed) {
        const inSuit = fails.filter((c) => suitOf(c) === cs).sort(byPower);
        if (inSuit.length) {
          return { card: inSuit[0], why: `Lead ${shortName(inSuit[0])}. Leading the called suit forces the partner's ace out, so you know who's who.` };
        }
      }
      const played = new Set(game.playedCards());
      const aces = fails.filter((c) => c[0] === 'A' && !played.has('T' + suitOf(c)));
      if (aces.length) return { card: aces[0], why: `Lead ${shortName(aces[0])}. A fail ace early often takes 11+ points before anyone is out of that suit.` };
      if (fails.length) {
        const low = cheapest(fails);
        return { card: low, why: `Lead ${shortName(low)}. Defenders lead fail and save their trump to beat the picker.` };
      }
    }
    if (fails.length) {
      const low = cheapest(fails);
      return { card: low, why: `Lead ${shortName(low)}, a cheap card.` };
    }
    const low = trumps[0];
    return { card: low, why: `Lead ${shortName(low)}, your lowest trump.` };
  }

  // Following
  const led = effSuit(plays[0].card);
  const win = trickWinner(plays);
  const rel = game.relation(seat, win.seat);
  const after = n - plays.length - 1; // players still to play after this seat
  const trickPts = sumPoints(plays.map((p) => p.card));
  const winners = legal.filter((c) => beats(c, win.card, led));
  const followingSuit = legal.every((c) => effSuit(c) === led);

  // Is the card currently winning safe from everything still unseen?
  const seen = new Set([...game.playedCards(), ...game.hands[seat]]);
  if (seat === game.picker) for (const c of game.buried) seen.add(c);
  const unseenHigher = TRUMP_ORDER.filter((c) => !seen.has(c) && beats(c, win.card, led));
  const laterSeats = [];
  for (let i = 1; i <= after; i++) laterSeats.push((seat + i) % n);
  const restAreFriends = laterSeats.every((s) => game.relation(seat, s) === 'team');
  const safe = after === 0 || restAreFriends || unseenHigher.length === 0;

  if (rel === 'team') {
    if (safe) {
      const card = richest(legal);
      return { card, why: `Your teammate is winning this trick${after ? ' and nobody left can beat it' : ''}, so add points: play ${shortName(card)} ("schmear").` };
    }
    const card = cheapest(legal);
    return { card, why: `Your teammate is winning for now, but someone after you could still take it. Play cheap: ${shortName(card)}.` };
  }

  if (winners.length) {
    const failWinners = winners.filter((c) => !isTrump(c));
    if (failWinners.length) {
      const card = failWinners.sort((a, b) => power(b) - power(a))[0];
      return { card, why: `Take it with ${shortName(card)}. It wins the trick and brings its own points.` };
    }
    const tw = winners.sort(byPower);
    if (after === 0) {
      return { card: tw[0], why: `You play last, so ${shortName(tw[0])} (your lowest winning trump) is enough to take it.` };
    }
    const worth = trickPts >= 10 || (onPickerSide === false && rel !== 'team' && trickPts >= 4);
    if (worth) {
      const card = tw[tw.length - 1];
      return { card, why: `There are ${trickPts} points here and players still to come, so take it with a high trump: ${shortName(card)}.` };
    }
    if (trickPts === 0 && !followingSuit) {
      const card = cheapest(legal);
      return { card, why: `Nothing worth trumping yet. Save your trump and play ${shortName(card)}.` };
    }
    return { card: tw[0], why: `Take it cheaply with ${shortName(tw[0])}.` };
  }

  const card = cheapest(legal);
  return { card, why: `You can't win this trick, so play your cheapest card: ${shortName(card)}.` };
}
