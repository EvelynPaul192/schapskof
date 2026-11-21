// Draws the table and runs the computer players.
import { Game } from './engine.js';
import { LAYOUT, DEFAULT_SETTINGS, SPEED_MS, effectivePartnerMode } from './rules.js';
import {
  isTrump, suitOf, rankOf, shortName, longName, sumPoints, SUIT_SYMBOL, SUIT_NAME, RANK_LABEL, effSuit,
} from './cards.js';
import {
  botWantsPick, chooseCallAndBury, choosePlay, pickAdvice, buryAdvice,
} from './strategy.js';
import { playOdds } from './odds.js';
import { CARD_ART } from './art.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'sheepshead-trainer-settings-v1';
const HUMAN = 0;

let settings = loadSettings();
let game;
let runId = 0;
let busy = false;
const ui = { bury: [], call: null, showTrick: null, bubbles: new Map(), log: [], oddsKey: null, odds: null, error: '' };

// Seat and trick positions (percent), human always at the bottom, play goes clockwise.
const POS = {
  3: { seats: [[50, 93], [20, 13], [80, 13]], trick: [[50, 74], [30, 28], [70, 28]] },
  4: { seats: [[50, 93], [10, 50], [50, 9], [90, 50]], trick: [[50, 76], [20, 50], [50, 24], [80, 50]] },
  5: { seats: [[50, 93], [9, 56], [27, 10], [73, 10], [91, 56]], trick: [[50, 78], [16, 56], [32, 22], [68, 22], [84, 56]] },
};

// ---- Settings ----------------------------------------------------------------

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* private window: fine */ }
}

// ---- Game flow -----------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pace = () => SPEED_MS[settings.botSpeed] || SPEED_MS.normal;
const name = (s) => game.players[s].name;

function newGame() {
  runId++;
  game = new Game(settings);
  ui.log = [];
  dealNext();
}

function dealNext() {
  ui.bury = [];
  ui.call = null;
  ui.showTrick = null;
  ui.error = '';
  ui.bubbles.clear();
  game.newHand();
  takeEvents();
  run();
}

async function run() {
  const id = ++runId;
  render();
  while (id === runId) {
    const g = game;
    if (g.phase === 'picking') {
      const s = g.pickTurn;
      if (g.players[s].human) return render();
      await sleep(pace());
      if (id !== runId) return;
      if (botWantsPick(g.hands[s], g.n, Math.random, g.passes.length === g.n - 1)) g.pick(s); else g.pass(s);
    } else if (g.phase === 'burying') {
      if (g.players[g.picker].human) return render();
      await sleep(pace() * 1.3);
      if (id !== runId) return;
      const { call, bury } = chooseCallAndBury(g.hands[g.picker], g.callOptions(), LAYOUT[g.n].blind, g.n);
      g.bury(bury, call);
    } else if (g.phase === 'playing') {
      const s = g.turn;
      if (g.players[s].human) return render();
      await sleep(pace());
      if (id !== runId) return;
      const r = g.play(s, choosePlay(g, s).card);
      takeEvents();
      if (r.trickDone) await showTrick(r.trick, id);
      if (id !== runId) return;
    } else {
      return render();
    }
    takeEvents();
    render();
  }
}

async function showTrick(trick, id) {
  ui.showTrick = trick;
  render();
  await sleep(Math.max(1100, pace() * 1.8));
  if (id === runId) ui.showTrick = null;
}

async function humanAct(fn) {
  if (busy) return;
  busy = true;
  try {
    ui.error = '';
    const r = fn();
    takeEvents();
    if (r && r.trickDone) {
      const id = ++runId;
      await showTrick(r.trick, id);
    }
  } catch (e) {
    ui.error = e.message;
  } finally {
    busy = false;
  }
  run();
}

// ---- Events: speech bubbles and the hand log ----------------------------------------

function callText(call) {
  if (!call || call.type === 'alone') return 'Going alone';
  if (call.type === 'jd') return 'Partner: J♦';
  return `Calls the A${SUIT_SYMBOL[call.suit]}`;
}

function takeEvents() {
  for (const e of game.drainEvents()) {
    switch (e.type) {
      case 'deal':
        ui.log = [`Hand ${e.handNo}. ${name(e.dealer)} deals.${e.multiplier > 1 ? ` This hand counts ×${e.multiplier}.` : ''}${e.isLastHand ? ' Last hand!' : ''}`];
        ui.bubbles.clear();
        break;
      case 'pick':
        ui.bubbles.set(e.seat, { text: 'Picks!' });
        ui.log.push(`${name(e.seat)} picks.`);
        break;
      case 'pass':
        ui.bubbles.set(e.seat, { text: 'Pass' });
        ui.log.push(`${name(e.seat)} passes.`);
        break;
      case 'noPick':
        ui.log.push(e.mode === 'doubler' ? 'Nobody picked. Doubler!' : 'Nobody picked. Redeal.');
        if (e.mauers.length) {
          for (let s = 0; s < game.n; s++) ui.bubbles.set(s, e.mauers.includes(s) ? { text: 'Mower!', cls: 'mauer' } : { text: 'Booo!', cls: 'boo' });
          ui.log.push(`Booo! ${e.mauers.map(name).join(' and ')} should have picked.`);
        }
        break;
      case 'call':
        ui.bubbles.set(e.seat, { text: callText(e.call) });
        ui.log.push(`${name(e.seat)}: ${callText(e.call).toLowerCase()}.`);
        break;
      case 'play':
        if (game.trick && game.trick.plays.length === 1) ui.bubbles.clear();
        ui.log.push(`${name(e.seat)} plays ${shortName(e.card)}.`);
        break;
      case 'partnerRevealed':
        ui.bubbles.set(e.seat, { text: 'Partner!' });
        ui.log.push(`${name(e.seat)} is the partner.`);
        break;
      case 'trick':
        ui.log.push(`${name(e.winner)} takes the trick (${e.points} points).`);
        break;
      case 'handOver':
        ui.bubbles.clear();
        ui.log.push(e.result.won ? 'The picker wins.' : 'The picker loses.');
        break;
      case 'lastHand':
        ui.log.push('Last hand declared.');
        break;
      default:
    }
  }
}

// ---- Drawing -------------------------------------------------------------------

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid);
  return e;
}

function builtinFace(id, e) {
  const r = rankOf(id);
  const s = SUIT_SYMBOL[suitOf(id)];
  const corner = () => el('span', { class: 'corner' }, RANK_LABEL[r], el('small', { text: s }));
  const br = corner();
  br.classList.add('br');
  const face = ['K', 'Q', 'J'].includes(r);
  e.append(corner(), el('span', { class: `pip${face ? ' face' : ''}`, text: face ? r + s : s }), br);
}

function cardEl(id, { small = false, classes = '' } = {}) {
  const red = suitOf(id) === 'H' || suitOf(id) === 'D';
  const e = el('div', {
    class: `card${small ? ' small' : ''}${red ? ' red' : ''}${isTrump(id) ? ' trump' : ''}${settings.highlightTrump && isTrump(id) ? ' hl' : ''} ${classes}`,
    title: longName(id) + (isTrump(id) ? ' (trump)' : ''),
    'aria-label': longName(id),
  });
  if (CARD_ART.enabled) {
    const img = el('img', { src: `${CARD_ART.folder}${id}${CARD_ART.ext}`, alt: longName(id) });
    img.addEventListener('error', () => { img.remove(); builtinFace(id, e); });
    e.append(img);
  } else {
    builtinFace(id, e);
  }
  return e;
}

function backEl(small = true) {
  const e = el('div', { class: `card back${small ? ' small' : ''}`, 'aria-hidden': 'true' });
  if (CARD_ART.enabled) {
    const img = el('img', { src: `${CARD_ART.folder}${CARD_ART.back}${CARD_ART.ext}`, alt: '' });
    img.addEventListener('error', () => img.remove());
    e.append(img);
  }
  return e;
}

function actor() {
  if (game.phase === 'picking') return game.pickTurn;
  if (game.phase === 'burying') return game.picker;
  if (game.phase === 'playing') return ui.showTrick ? null : game.turn;
  return null;
}

function render() {
  if (!game) return;
  renderScores();
  renderSeats();
  renderTrick();
  renderHand();
  renderPanel();
  $('log').replaceChildren(...ui.log.map((t) => el('li', { text: t })));
}

function renderScores() {
  const g = game;
  const chips = g.players.map((p, s) => {
    const sc = g.scores[s];
    return el('span', { class: `score-chip${sc > 0 ? ' pos' : sc < 0 ? ' neg' : ''}` }, p.name, el('b', { text: (sc > 0 ? '+' : '') + sc }));
  });
  const tags = [el('span', { class: 'score-chip', text: `Hand ${g.handNo}` })];
  const between = g.phase === 'handOver';
  const mult = between ? null : g.multiplier;
  if (mult > 1) tags.push(el('span', { class: 'tag', text: `×${mult} this hand` }));
  if (between && g.pendingDoublers) {
    const m = settings.doublersStack ? 2 ** g.pendingDoublers : 2;
    tags.push(el('span', { class: 'tag', text: `Next hand ×${m}` }));
  }
  if ((!between && g.isLastHand) || (between && g.lastHandDeclared)) tags.push(el('span', { class: 'tag last', text: 'Last hand' }));
  $('scorebar').replaceChildren(...chips, ...tags);
}

function renderSeats() {
  const g = game;
  const pos = POS[g.n].seats;
  const now = actor();
  const showPartner = g.partner != null && (g.partnerRevealed || g.phase === 'handOver' || g.phase === 'gameOver' || g.partner === HUMAN);
  const seats = g.players.map((p, s) => {
    const badges = [];
    if (s === g.dealer) badges.push(el('span', { class: 'badge dealer', text: 'Dealer' }));
    if (s === g.picker) badges.push(el('span', { class: 'badge picker', text: g.call && g.call.type === 'alone' ? 'Picker (alone)' : 'Picker' }));
    if (showPartner && s === g.partner) badges.push(el('span', { class: 'badge partner', text: s === HUMAN && !g.partnerRevealed ? 'Partner (secret)' : 'Partner' }));
    const backs = [];
    if (s !== HUMAN && ['picking', 'burying', 'playing'].includes(g.phase)) {
      for (let i = 0; i < g.hands[s].length; i++) backs.push(backEl());
    }
    const b = ui.bubbles.get(s);
    return el('div', {
      class: `seat${s === now ? ' turn' : ''}`,
      style: `left:${pos[s][0]}%;top:${pos[s][1]}%`,
    },
    b ? el('div', { class: `bubble ${b.cls || ''}`, text: b.text }) : null,
    el('div', { class: 'name', text: s === HUMAN ? `${p.name} (you)` : p.name }),
    el('div', { class: 'badges' }, badges),
    s === HUMAN ? null : el('div', { class: 'backs' }, backs));
  });
  $('seats').replaceChildren(...seats);
}

function renderTrick() {
  const g = game;
  const pos = POS[g.n].trick;
  const t = ui.showTrick || g.trick;
  const kids = [];
  if (g.phase === 'picking' && g.blind.length) {
    g.blind.forEach((_, i) => {
      const b = backEl(true);
      b.style.cssText = `position:absolute;left:${46 + i * 8}%;top:50%;transform:translate(-50%,-50%)`;
      kids.push(b);
    });
  }
  if (t && ['playing', 'handOver', 'gameOver'].includes(g.phase)) {
    for (const p of t.plays) {
      const c = cardEl(p.card, { small: true, classes: ui.showTrick && p.seat === ui.showTrick.winner ? 'winner' : '' });
      c.style.left = `${pos[p.seat][0]}%`;
      c.style.top = `${pos[p.seat][1]}%`;
      kids.push(c);
    }
  }
  $('trick').replaceChildren(...kids);
  let banner = '';
  if (ui.showTrick) {
    const w = ui.showTrick.winner;
    banner = `${w === HUMAN ? 'You take' : `${name(w)} takes`} it: ${ui.showTrick.points} points`;
  } else if (g.phase === 'playing' && g.call) {
    banner = g.call.type === 'ace' ? `Called: ace of ${SUIT_NAME[g.call.suit]}` : g.call.type === 'jd' ? 'Partner: jack of diamonds' : `${name(g.picker)} is alone`;
  }
  $('banner').textContent = banner;
}

function currentHint() {
  if (!settings.hints) return null;
  const g = game;
  if (g.phase === 'picking' && g.pickTurn === HUMAN) return { text: pickAdvice(g.hands[HUMAN], g.n, { lastToAct: g.passes.length === g.n - 1 }).why };
  if (g.phase === 'burying' && g.picker === HUMAN) {
    const a = buryAdvice(g.hands[HUMAN], g.callOptions(), LAYOUT[g.n].blind, g.n);
    return { text: a.why, bury: a.bury, call: a.call };
  }
  if (g.phase === 'playing' && g.turn === HUMAN && !ui.showTrick) {
    const p = choosePlay(g, HUMAN);
    return { text: p.why, card: p.card };
  }
  return null;
}

function renderHand() {
  const g = game;
  const hand = g.hands ? g.hands[HUMAN] : [];
  const hint = currentHint();
  const myTurnToPlay = g.phase === 'playing' && g.turn === HUMAN && !ui.showTrick && !busy;
  const legal = myTurnToPlay ? new Set(g.legalPlays(HUMAN)) : null;
  const burying = g.phase === 'burying' && g.picker === HUMAN;
  const cards = hand.map((c) => {
    let classes = '';
    let onclick = null;
    if (myTurnToPlay) {
      if (legal.has(c)) {
        classes = 'legal';
        onclick = () => humanAct(() => g.play(HUMAN, c));
      } else classes = 'dim';
      if (hint && hint.card === c) classes += ' suggested';
    } else if (burying) {
      classes = 'legal';
      if (ui.bury.includes(c)) classes += ' selected';
      onclick = () => {
        ui.bury = ui.bury.includes(c) ? ui.bury.filter((x) => x !== c) : [...ui.bury, c].slice(-LAYOUT[g.n].blind);
        ui.error = '';
        render();
      };
    }
    const e = cardEl(c, { classes });
    if (onclick) {
      e.tabIndex = 0;
      e.setAttribute('role', 'button');
      e.addEventListener('click', onclick);
      e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onclick(); } });
    }
    return e;
  });
  $('hand').replaceChildren(...cards);
}

function button(text, onclick, { primary = false, disabled = false } = {}) {
  return el('button', { type: 'button', class: primary ? 'primary' : '', disabled, onclick }, text);
}

function renderPanel() {
  const g = game;
  let message = '';
  let controls = [];
  const hint = currentHint();

  if (g.phase === 'picking') {
    if (g.pickTurn === HUMAN) {
      const last = g.passes.length === g.n - 1;
      message = last ? 'Everyone else passed. Pick or pass?' : 'Pick up the blind, or pass?';
      controls = [button('Pick', () => humanAct(() => g.pick(HUMAN)), { primary: true }), button('Pass', () => humanAct(() => g.pass(HUMAN)))];
    } else message = `${name(g.pickTurn)} is deciding…`;
  } else if (g.phase === 'burying') {
    if (g.picker === HUMAN) {
      const need = LAYOUT[g.n].blind;
      const opts = g.callOptions();
      if (!ui.call || !opts.some((o) => o.type === ui.call.type && o.suit === ui.call.suit)) ui.call = opts.length === 1 ? opts[0] : null;
      message = `You picked up ${g.blindCards.map(shortName).join(' ')}. ${opts.length > 1 ? 'Choose your partner, then tap' : 'Tap'} ${need} cards to bury.`;
      const optButtons = opts.length > 1
        ? el('div', { class: 'call-options' }, opts.map((o) => el('button', {
          type: 'button',
          class: ui.call && ui.call.type === o.type && ui.call.suit === o.suit ? 'chosen' : '',
          onclick: () => { ui.call = o; ui.error = ''; render(); },
        }, o.type === 'ace' ? `Call A${SUIT_SYMBOL[o.suit]}` : o.type === 'jd' ? 'Partner: J♦' : 'Go alone')))
        : null;
      const err = ui.call && ui.bury.length === need ? g.checkBury(ui.bury, ui.call) : null;
      controls = [
        optButtons,
        button(`Bury ${ui.bury.map(shortName).join(' ') || '…'}`, () => humanAct(() => g.bury(ui.bury, ui.call)), { primary: true, disabled: !ui.call || ui.bury.length !== need || !!err }),
        hint ? button('Use the hint', () => { ui.call = hint.call; ui.bury = [...hint.bury]; render(); }) : null,
      ];
      if (err) message += ` ${err}`;
    } else message = `${name(g.picker)} picked and is burying…`;
  } else if (g.phase === 'playing') {
    if (ui.showTrick) message = '';
    else if (g.turn === HUMAN) {
      const plays = g.trick.plays;
      if (!plays.length) message = 'Your lead.';
      else {
        const led = effSuit(plays[0].card);
        message = `Your turn. ${led === 'T' ? 'Trump' : SUIT_NAME[led][0].toUpperCase() + SUIT_NAME[led].slice(1)} was led; follow if you can.`;
      }
    } else message = `${name(g.turn)} is playing…`;
  } else if (g.phase === 'handOver' || g.phase === 'gameOver') {
    renderResult();
    return;
  }

  $('message').textContent = ui.error ? `${message} ${ui.error}` : message;
  $('controls').replaceChildren(...controls.filter(Boolean));
  const hintBox = $('hint');
  hintBox.hidden = !hint;
  if (hint) hintBox.replaceChildren(el('b', { text: 'Hint: ' }), hint.text);
  renderOdds();
}

function renderOdds() {
  const box = $('odds');
  const g = game;
  if (!settings.odds || g.phase !== 'playing' || g.turn !== HUMAN || ui.showTrick) { box.hidden = true; return; }
  const key = `${g.handNo}:${g.playedCards().join('')}:${g.hands[HUMAN].join('')}`;
  if (ui.oddsKey !== key) { ui.odds = playOdds(g, HUMAN); ui.oddsKey = key; }
  const o = ui.odds;
  const behind = g.n - g.trick.plays.length - 1;
  const rows = o.rows.map((r) => {
    let text;
    let pct = null;
    if (!r.winsNow) text = 'Won\'t win the trick as it stands.';
    else if (behind === 0) { text = 'You play last: this wins the trick.'; pct = 0; } else if (r.beatPct === 0) { text = 'Nobody on the other side can beat it.'; pct = 0; } else {
      pct = r.beatPct;
      text = `${r.beatPct}% chance someone on the other side, still to play, can beat it.`;
    }
    const bar = pct == null ? null : el('span', { class: `bar${pct === 0 ? ' safe' : ''}`, style: `width:${Math.max(6, pct * 0.8)}px` });
    return el('tr', {}, el('td', {}, cardEl(r.card, { small: true })), el('td', {}, bar, text));
  });
  const facts = [];
  facts.push(`Trump still out: ${o.trumpOut}${o.trumpHigherThanMine != null ? ` (${o.trumpHigherThanMine} higher than your best)` : ''}.`);
  facts.push(`Points still out: ${o.pointsOut}${o.includesBuried ? ', counting the buried cards' : ''}.`);
  for (const v of o.voids) {
    facts.push(`${name(v.seat)} is out of ${v.suits.map((s) => (s === 'T' ? 'trump' : SUIT_NAME[s])).join(' and ')}.`);
  }
  box.hidden = false;
  box.replaceChildren(
    el('b', { text: 'Odds for each card you can play' }),
    el('table', {}, rows),
    el('p', { class: 'facts', text: facts.join(' ') }),
  );
}

function renderResult() {
  const g = game;
  const r = g.result;
  const kids = [];
  if (r.type === 'noPick') {
    kids.push(el('h3', { text: 'Nobody picked.' }));
    if (r.mode === 'doubler') {
      const m = settings.doublersStack ? 2 ** g.pendingDoublers : 2;
      kids.push(el('p', { text: `Doubler! The next hand counts ×${m}${g.lastHandDeclared && settings.lastHandDoubler ? ' (and ×2 more for last hand)' : ''}.` }));
    } else kids.push(el('p', { text: 'Redeal.' }));
    if (settings.booMauers) {
      if (r.mauers.length) {
        for (const s of r.mauers) {
          kids.push(el('p', { class: 'boo-line', text: `Booo! ${s === HUMAN ? 'You' : name(s)} passed this hand. Mower!` }));
          kids.push(el('div', { class: 'cards' }, r.hands[s].map((c) => cardEl(c, { small: true }))));
        }
      } else kids.push(el('p', { text: 'No mowers. Everybody really did have bad cards.' }));
    }
  } else {
    const picker = r.picker === HUMAN ? 'You' : name(r.picker);
    const partner = r.partner == null ? 'alone' : `with ${r.partner === HUMAN ? 'you' : name(r.partner)}`;
    const extra = r.label === 'schneider' ? ' (schneider)' : r.label === 'no-trick' ? ' (no tricks!)' : '';
    kids.push(el('h3', { text: `${picker} ${r.won ? 'won' : 'lost'}${extra}, ${partner}.` }));
    kids.push(el('p', { text: `Picker's side took ${r.pickerPts} points; the other side took ${r.defPts}. Needed 61.${r.multiplier > 1 ? ` This hand counted ×${r.multiplier}.` : ''}` }));
    kids.push(el('div', {}, el('span', { text: 'Blind: ' }), el('span', { class: 'cards' }, r.blind.map((c) => cardEl(c, { small: true }))),
      el('span', { text: ` Buried (${sumPoints(r.buried)} pts): ` }), el('span', { class: 'cards' }, r.buried.map((c) => cardEl(c, { small: true })))));
    kids.push(el('table', {}, g.players.map((p, s) => el('tr', {}, el('td', { text: p.name }), el('td', { text: `${r.deltas[s] > 0 ? '+' : ''}${r.deltas[s]}` })))));
  }
  const controls = [];
  if (g.phase === 'gameOver') {
    const order = g.players.map((p, s) => ({ p, s: g.scores[s] })).sort((a, b) => b.s - a.s);
    kids.push(el('h3', { text: `Game over. ${order[0].p.name} wins with ${order[0].s > 0 ? '+' : ''}${order[0].s}!` }));
    controls.push(button('New game', () => newGame(), { primary: true }));
  } else {
    controls.push(button('Next hand', () => dealNext(), { primary: true }));
    controls.push(button(g.lastHandDeclared ? 'Last hand declared' : 'Declare last hand', () => { g.declareLastHand(); takeEvents(); render(); }, { disabled: g.lastHandDeclared }));
  }
  $('message').replaceChildren();
  $('message').append(el('div', { class: 'result' }, kids));
  $('controls').replaceChildren(...controls);
  $('hint').hidden = true;
  $('odds').hidden = true;
}

// ---- Settings and rules dialogs --------------------------------------------------

/** An in-page yes/no question (browser confirm() boxes are blocked in some places this runs). */
function askConfirm(text, yes = 'Yes') {
  const d = $('confirm-dialog');
  $('confirm-text').textContent = text;
  $('confirm-yes').textContent = yes;
  d.returnValue = '';
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'yes'), { once: true }));
}

const RULE_KEYS = ['numPlayers', 'partnerMode', 'noPick', 'doublersStack', 'booMauers', 'mauerGoodTrump', 'mauerCounters', 'lastHandDoubler'];

function openSettings() {
  const f = $('settings-form');
  for (const [k, v] of Object.entries(settings)) {
    const inputs = f.elements[k];
    if (!inputs) continue;
    if (inputs instanceof RadioNodeList) { for (const i of inputs) i.checked = String(v) === i.value; } else if (inputs.type === 'checkbox') inputs.checked = !!v;
    else inputs.value = v;
  }
  $('settings-dialog').showModal();
}

function readSettings() {
  const f = $('settings-form');
  const next = { ...settings };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    const input = f.elements[k];
    if (!input) continue;
    if (input instanceof RadioNodeList) next[k] = Number(input.value);
    else if (input.type === 'checkbox') next[k] = input.checked;
    else if (input.type === 'number') next[k] = Math.max(1, Math.min(10, Number(input.value) || DEFAULT_SETTINGS[k]));
    else next[k] = input.value;
  }
  next.playerName = (next.playerName || '').trim() || 'You';
  return next;
}

$('settings-dialog').addEventListener('close', async () => {
  if ($('settings-dialog').returnValue !== 'save') return;
  const next = readSettings();
  const rulesChanged = RULE_KEYS.some((k) => next[k] !== settings[k]);
  settings = next;
  saveSettings();
  if (rulesChanged) {
    const midGame = game && (game.handNo > 1 || game.phase === 'playing');
    if (!midGame || await askConfirm('Start a new game with the new rules? Scores go back to zero.', 'New game')) return newGame();
  }
  if (game) game.players[HUMAN].name = settings.playerName;
  render();
});

function rulesHtml() {
  const s = settings;
  const n = s.numPlayers;
  const mode = effectivePartnerMode(s);
  const L = LAYOUT[n];
  const partner = mode === 'calledAce'
    ? '<p>After picking, the picker <b>calls an ace</b> of a fail suit (clubs, spades or hearts) that they don\'t hold, and must keep at least one card of that suit (the "hold"). Whoever has that ace is the secret partner. When that suit is led, the partner must play the ace, and the partner can\'t throw the ace away on another suit. If the picker can\'t call any ace, they go alone.</p>'
    : mode === 'jackOfDiamonds'
      ? '<p>The picker\'s secret partner is whoever holds the <b>jack of diamonds</b>. If the picker has it, they play alone.</p>'
      : '<p>The picker plays <b>alone</b> against everyone else.</p>';
  return `
  <h2>How to play (${n} players)</h2>
  <p>${n === 4 ? '30 cards (the 7♣ and 7♠ are taken out)' : '32 cards'}: ${L.hand} each, ${L.blind} face down in the "blind". Going around from the dealer's left, each player picks up the blind or passes. The picker buries ${L.blind} cards (their points count for the picker) and leads off with the player to the dealer's left.</p>
  ${partner}
  <h3>Trump, best to worst</h3>
  <p>Q♣ Q♠ Q♥ Q♦, J♣ J♠ J♥ J♦, A♦ 10♦ K♦ 9♦ 8♦ 7♦. All queens, jacks and diamonds are trump.</p>
  <p>The other suits ("fail") rank A 10 K 9 8 7. You must follow the suit that was led (trump counts as its own suit). If you can't, play anything.</p>
  <h3>Counting</h3>
  <table><tr><td>Ace</td><td>11</td></tr><tr><td>10</td><td>10</td></tr><tr><td>King</td><td>4</td></tr><tr><td>Queen</td><td>3</td></tr><tr><td>Jack</td><td>2</td></tr><tr><td>9, 8, 7</td><td>0</td></tr></table>
  <p>120 points in all. The picker's side needs 61 to win. Under 31 is "schneider" (counts double); no tricks at all counts triple.</p>
  <h3>Scoring</h3>
  <p>${n === 5 && mode !== 'alone' ? 'With a partner, the picker wins or loses 2 points and the partner 1; each other player loses or wins 1.' : n === 4 && mode !== 'alone' ? 'With a partner, the picker and partner each win or lose 1, and the two others each lose or win 1.' : 'Alone, the picker wins or loses 1 point from each other player.'} Doublers and schneider multiply this.</p>
  <h3>House rules</h3>
  <ul>
    <li>${s.noPick === 'doubler' ? `<b>Nobody picks: doubler.</b> The hand is thrown in and the next hand counts double${s.doublersStack ? ' (they stack: ×4, ×8…)' : ''}.` : '<b>Nobody picks:</b> redeal.'}</li>
    ${s.booMauers ? `<li><b>Booing the mowers.</b> A mower should have picked but got nervous and passed: ${n === 5 ? `${s.mauerGoodTrump} or more good trump (queens, jacks, A♦ or 10♦)` : `${s.mauerCounters} or more counters (aces and 10s)`}. When nobody picks, everyone sees their hand.</li>` : ''}
    <li><b>Last hand.</b> Between hands, anyone can declare the next hand the last one${s.lastHandDoubler ? '. It counts double' : ''}.</li>
  </ul>
  <h3>The trainer</h3>
  <p><b>Hints</b> suggest a play and say why. <b>Odds</b> deal the cards you can't see hundreds of ways that fit what's happened (who has run out of which suit, who must hold the called ace) and show, for each card you could play, how often someone on the other side still to play could beat it. Both can be turned off in Settings.</p>`;
}

$('btn-rules').addEventListener('click', () => {
  $('rules-body').innerHTML = rulesHtml();
  $('rules-dialog').showModal();
});
$('btn-settings').addEventListener('click', openSettings);
$('btn-new').addEventListener('click', async () => {
  if (!game || game.phase === 'gameOver' || await askConfirm('Start a new game? Scores go back to zero.', 'New game')) newGame();
});

newGame();
