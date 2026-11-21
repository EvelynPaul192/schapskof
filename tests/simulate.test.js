// Plays thousands of all-computer hands under every rule combination and checks
// that the rules hold. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/engine.js';
import { LAYOUT } from '../js/rules.js';
import { botWantsPick, chooseCallAndBury, choosePlay } from '../js/strategy.js';
import { makeDeck, sumPoints, isTrump, suitOf, trickWinner, beats } from '../js/cards.js';

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playHand(g, rng) {
  g.newHand();
  const deckSize = makeDeck(g.n).length;
  assert.equal(g.hands.flat().length + g.blind.length, deckSize);
  while (g.phase === 'picking') {
    const s = g.pickTurn;
    const last = g.passes.length === g.n - 1;
    if (botWantsPick(g.hands[s], g.n, rng, last)) g.pick(s); else g.pass(s);
  }
  if (g.phase === 'handOver' || g.phase === 'gameOver') return;
  assert.equal(g.phase, 'burying');
  const opts = g.callOptions();
  const { call, bury } = chooseCallAndBury(g.hands[g.picker], opts, LAYOUT[g.n].blind, g.n);
  assert.equal(g.checkBury(bury, call), null, 'bot bury should be legal');
  g.bury(bury, call);
  if (call.type === 'ace') {
    assert.ok(g.partner != null && g.partner !== g.picker);
    assert.ok(g.hands[g.picker].some((c) => !isTrump(c) && suitOf(c) === call.suit), 'picker keeps a hold card');
  }
  let guard = 0;
  while (g.phase === 'playing') {
    const s = g.turn;
    const legal = g.legalPlays(s);
    assert.ok(legal.length > 0);
    for (const c of legal) assert.ok(g.hands[s].includes(c));
    const { card, why } = choosePlay(g, s);
    assert.ok(legal.includes(card), `bot chose an illegal card ${card}`);
    assert.ok(typeof why === 'string' && why.length > 0);
    g.play(s, card);
    if (++guard > 200) throw new Error('hand never ended');
  }
}

const combos = [];
for (const numPlayers of [3, 4, 5]) {
  for (const partnerMode of ['calledAce', 'jackOfDiamonds', 'alone']) {
    for (const noPick of ['doubler', 'redeal']) {
      combos.push({ numPlayers, partnerMode, noPick, doublersStack: noPick === 'doubler', lastHandDoubler: true });
    }
  }
}

for (const settings of combos) {
  test(`plays 400 hands: ${JSON.stringify(settings)}`, () => {
    const rng = seeded(settings.numPlayers * 1000 + settings.partnerMode.length * 7 + settings.noPick.length);
    const g = new Game(settings, rng);
    let played = 0;
    for (let i = 0; i < 400; i++) {
      const before = [...g.scores];
      playHand(g, rng);
      const r = g.result;
      assert.equal(g.scores.reduce((a, b) => a + b, 0), 0, 'scores stay zero-sum');
      if (r.type === 'played') {
        played++;
        assert.equal(r.pickerPts + r.defPts, 120);
        const pts = sumPoints(g.tricks.flatMap((t) => t.plays.map((p) => p.card))) + sumPoints(g.buried);
        assert.equal(pts, 120, 'all 120 points are accounted for');
        assert.equal(g.tricks.length, LAYOUT[g.n].hand);
        for (const t of g.tricks) assert.equal(trickWinner(t.plays).seat, t.winner);
        assert.equal(Math.sign(r.deltas[r.picker]), r.won ? 1 : -1);
        if (r.partner != null) assert.ok(g.partnerRevealed, 'the called card was played by the end');
        if (settings.numPlayers === 3) assert.equal(r.partner, null);
      } else {
        assert.deepEqual(g.scores, before);
      }
    }
    assert.ok(played > 100, `only ${played} hands were picked`);
  });
}

test('doublers stack and the last hand doubles', () => {
  const g = new Game({ numPlayers: 5, noPick: 'doubler', doublersStack: true, lastHandDoubler: true }, seeded(1));
  g.newHand();
  for (let i = 0; i < 5; i++) g.pass(g.pickTurn);
  assert.equal(g.result.type, 'noPick');
  g.newHand();
  assert.equal(g.multiplier, 2);
  for (let i = 0; i < 5; i++) g.pass(g.pickTurn);
  assert.ok(g.declareLastHand());
  g.newHand();
  assert.equal(g.multiplier, 8); // two doublers (x4) and the last hand (x2)
  assert.equal(g.isLastHand, true);
});

test('redeal mode does not double', () => {
  const g = new Game({ numPlayers: 4, noPick: 'redeal' }, seeded(2));
  g.newHand();
  for (let i = 0; i < 4; i++) g.pass(g.pickTurn);
  g.newHand();
  assert.equal(g.multiplier, 1);
});

test('called-ace partner must play the ace when its suit is led', () => {
  // Build a fixed 5-handed deal.
  const g = new Game({ numPlayers: 5, partnerMode: 'calledAce' }, seeded(3));
  g.newHand();
  g.dealer = 4;
  g.hands = [
    ['QC', 'QS', 'JD', 'AD', '7H', '8S'], // seat 0 picks
    ['AH', 'TH', 'KH', '9C', '8C', '7C'], // seat 1 holds the ace of hearts
    ['QH', 'QD', 'JC', 'TD', 'AC', 'TC'],
    ['JS', 'JH', 'KD', '9D', 'AS', 'TS'],
    ['8D', '7D', 'KC', 'KS', '9S', '9H'],
  ];
  g.blind = ['8H', '7S'];
  g.dealtHands = g.hands.map((h) => [...h]);
  g.pickTurn = 0;
  g.pick(0);
  assert.equal(g.checkBury(['7H', '8H'], { type: 'ace', suit: 'H' }) !== null, true, 'cannot bury every heart');
  g.bury(['8S', '7S'], { type: 'ace', suit: 'H' });
  assert.equal(g.partner, 1);
  g.startTrick(0);
  assert.ok(g.legalPlays(0).includes('7H'));
  g.play(0, '7H');
  assert.deepEqual(g.legalPlays(1), ['AH']);
});

test('beats() basics', () => {
  assert.ok(beats('7D', 'AC', 'C'));
  assert.ok(beats('QC', 'QS', 'T'));
  assert.ok(!beats('AH', 'TC', 'C'));
  assert.ok(beats('AC', 'TC', 'C'));
});

test('odds: what each seat "knows" is always true of the real deal, and odds run', async () => {
  const { knowledge, playOdds } = await import('../js/odds.js');
  const { effSuit: es } = await import('../js/cards.js');
  for (const numPlayers of [3, 4, 5]) {
    for (const partnerMode of ['calledAce', 'jackOfDiamonds']) {
      const rng = seeded(numPlayers * 31 + partnerMode.length);
      const g = new Game({ numPlayers, partnerMode, noPick: 'redeal' }, rng);
      for (let h = 0; h < 60; h++) {
        g.newHand();
        while (g.phase === 'picking') { const s = g.pickTurn; if (botWantsPick(g.hands[s], g.n, rng, g.passes.length === g.n - 1)) g.pick(s); else g.pass(s); }
        if (g.phase !== 'burying') continue;
        const { call, bury } = chooseCallAndBury(g.hands[g.picker], g.callOptions(), LAYOUT[g.n].blind, g.n);
        g.bury(bury, call);
        while (g.phase === 'playing') {
          const s = g.turn;
          const k = knowledge(g, s);
          for (let o = 0; o < g.n; o++) for (const v of k.voids[o]) assert.ok(!g.hands[o].some((c) => es(c) === v), 'void is real');
          if (k.mustPlace) {
            assert.ok(!k.notPartner.has(g.partner), 'real partner is never ruled out');
          }
          if (k.pickerHold) assert.ok(g.hands[g.picker].some((c) => !isTrump(c) && suitOf(c) === k.calledSuit));
          if (h % 6 === 0) {
            const o = playOdds(g, s, rng);
            for (const r of o.rows) if (r.beatPct != null) assert.ok(r.beatPct >= 0 && r.beatPct <= 100);
            assert.ok(o.rows.some((r) => r.samples > 0) || o.rows.every((r) => !r.winsNow));
          }
          g.play(s, choosePlay(g, s).card);
        }
      }
    }
  }
});
