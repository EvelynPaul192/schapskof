// The rules of play. No drawing code in here, so it can be tested in Node.
import {
  makeDeck, shuffle, sortHand, isTrump, suitOf, effSuit, points, sumPoints,
  trickWinner, FAIL_SUITS,
} from './cards.js';
import { LAYOUT, DEFAULT_SETTINGS, BOT_NAMES, effectivePartnerMode } from './rules.js';
import { isMauerHand } from './strategy.js';

export class Game {
  constructor(settings = {}, rng = Math.random) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.n = this.settings.numPlayers;
    this.rng = rng;
    this.players = [
      { name: this.settings.playerName || 'You', human: true },
      ...BOT_NAMES.slice(0, this.n - 1).map((name) => ({ name, human: false })),
    ];
    this.scores = Array(this.n).fill(0);
    this.dealer = Math.floor(rng() * this.n);
    this.pendingDoublers = 0;
    this.lastHandDeclared = false;
    this.handNo = 0;
    this.history = [];
    this.events = [];
    this.phase = 'idle';
  }

  next(seat) {
    return (seat + 1) % this.n;
  }

  emit(e) {
    this.events.push(e);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  get partnerMode() {
    return effectivePartnerMode(this.settings);
  }

  // ---- Dealing -------------------------------------------------------------

  newHand() {
    if (this.phase === 'gameOver') throw new Error('Game is over');
    this.handNo += 1;
    this.dealer = this.next(this.dealer);
    const { hand, blind } = LAYOUT[this.n];
    const deck = shuffle(makeDeck(this.n), this.rng);
    this.hands = [];
    for (let i = 0; i < this.n; i++) this.hands.push(sortHand(deck.slice(i * hand, (i + 1) * hand)));
    this.blind = deck.slice(this.n * hand, this.n * hand + blind);
    this.dealtHands = this.hands.map((h) => [...h]);
    this.isLastHand = this.lastHandDeclared;
    this.multiplier = this.computeMultiplier();
    this.picker = null;
    this.passes = [];
    this.pickTurn = this.next(this.dealer);
    this.buried = [];
    this.call = null;
    this.partner = null;
    this.partnerRevealed = false;
    this.tricks = [];
    this.trick = null;
    this.lastTrick = null;
    this.turn = null;
    this.result = null;
    this.phase = 'picking';
    this.emit({ type: 'deal', dealer: this.dealer, handNo: this.handNo, multiplier: this.multiplier, isLastHand: this.isLastHand });
  }

  computeMultiplier() {
    const d = this.pendingDoublers;
    let m = this.settings.doublersStack ? 2 ** d : d > 0 ? 2 : 1;
    if (this.isLastHand && this.settings.lastHandDoubler) m *= 2;
    return m;
  }

  /** Can be called between hands (before the next deal). */
  declareLastHand() {
    if (this.phase !== 'handOver' && this.phase !== 'idle') return false;
    this.lastHandDeclared = true;
    this.emit({ type: 'lastHand' });
    return true;
  }

  // ---- Picking -------------------------------------------------------------

  pick(seat) {
    this.assert(this.phase === 'picking' && seat === this.pickTurn, 'Not your turn to pick');
    this.picker = seat;
    this.blindCards = [...this.blind];
    this.hands[seat] = sortHand([...this.hands[seat], ...this.blind]);
    this.blind = [];
    this.phase = 'burying';
    this.turn = seat;
    this.emit({ type: 'pick', seat });
  }

  pass(seat) {
    this.assert(this.phase === 'picking' && seat === this.pickTurn, 'Not your turn to pick');
    this.passes.push(seat);
    this.emit({ type: 'pass', seat });
    if (this.passes.length === this.n) return this.noPick();
    this.pickTurn = this.next(this.pickTurn);
  }

  noPick() {
    const mode = this.settings.noPick;
    const mauers = this.settings.booMauers
      ? this.passes.filter((s) => isMauerHand(this.dealtHands[s], this.n, this.settings))
      : [];
    if (mode === 'doubler') this.pendingDoublers += 1;
    this.result = { type: 'noPick', mode, mauers, hands: this.dealtHands, blind: this.blind };
    this.history.push({ handNo: this.handNo, result: this.result, deltas: Array(this.n).fill(0) });
    this.phase = 'handOver';
    this.emit({ type: 'noPick', mode, mauers });
  }

  // ---- Calling a partner and burying -------------------------------------------

  /** What the picker may call, given their hand after taking the blind. */
  callOptions() {
    const hand = this.hands[this.picker];
    const opts = [];
    const mode = this.partnerMode;
    if (mode === 'calledAce') {
      for (const s of FAIL_SUITS) {
        const hasAce = hand.includes('A' + s);
        const hasSuit = hand.some((c) => !isTrump(c) && suitOf(c) === s);
        if (!hasAce && hasSuit) opts.push({ type: 'ace', suit: s, card: 'A' + s });
      }
    } else if (mode === 'jackOfDiamonds') {
      if (!hand.includes('JD')) opts.push({ type: 'jd', card: 'JD' });
    }
    opts.push({ type: 'alone' });
    return opts;
  }

  /** Check a call + bury choice without changing anything. Returns an error string or null. */
  checkBury(cards, call) {
    const hand = this.hands[this.picker];
    const need = LAYOUT[this.n].blind;
    if (!Array.isArray(cards) || cards.length !== need) return `Pick ${need} cards to bury.`;
    if (new Set(cards).size !== cards.length) return 'Pick two different cards.';
    if (!cards.every((c) => hand.includes(c))) return 'You can only bury cards in your hand.';
    const opt = this.callOptions().find((o) => o.type === call?.type && (o.suit || null) === (call.suit || null));
    if (!opt) return 'That call is not allowed.';
    if (opt.type === 'ace') {
      const left = hand.filter((c) => !cards.includes(c));
      if (!left.some((c) => !isTrump(c) && suitOf(c) === opt.suit)) {
        return `Keep at least one ${opt.suit === 'C' ? 'club' : opt.suit === 'S' ? 'spade' : 'heart'} so you can be called on it.`;
      }
    }
    return null;
  }

  bury(cards, call) {
    this.assert(this.phase === 'burying', 'Not burying now');
    const err = this.checkBury(cards, call);
    this.assert(!err, err);
    const opt = this.callOptions().find((o) => o.type === call.type && (o.suit || null) === (call.suit || null));
    this.hands[this.picker] = this.hands[this.picker].filter((c) => !cards.includes(c));
    this.buried = [...cards];
    this.call = opt;
    this.partner = null;
    if (opt.card) {
      this.partner = this.hands.findIndex((h) => h.includes(opt.card));
      if (this.partner < 0) this.partner = null; // can't happen with a full deal, but be safe
    }
    this.emit({ type: 'call', seat: this.picker, call: opt });
    this.phase = 'playing';
    this.startTrick(this.next(this.dealer));
  }

  get calledCard() {
    return this.call?.card || null;
  }

  get calledSuit() {
    return this.call?.type === 'ace' ? this.call.suit : null;
  }

  // ---- Playing tricks ------------------------------------------------------

  startTrick(leader) {
    this.trick = { leader, plays: [] };
    this.turn = leader;
  }

  legalPlays(seat) {
    const hand = this.hands[seat];
    const plays = this.trick.plays;
    const calledSuit = this.calledSuit;
    const calledCard = this.calledCard;
    const secret = calledSuit && !this.partnerRevealed;
    const lastCard = hand.length === 1;
    let legal;
    if (plays.length === 0) {
      legal = [...hand];
      // The partner may lead the called suit only with the called ace itself.
      if (secret && seat === this.partner) {
        legal = legal.filter((c) => isTrump(c) || suitOf(c) !== calledSuit || c === calledCard);
      }
    } else {
      const led = effSuit(plays[0].card);
      const follow = hand.filter((c) => effSuit(c) === led);
      if (follow.length) {
        legal = follow;
        // When the called suit is led, the partner must play the ace.
        if (secret && seat === this.partner && led === calledSuit) legal = [calledCard];
      } else {
        legal = [...hand];
        if (secret && !lastCard) {
          // The partner can't throw the called ace away on another suit...
          if (seat === this.partner) legal = legal.filter((c) => c !== calledCard);
          // ...and the picker can't throw away their last card of the called suit.
          if (seat === this.picker) {
            const hold = hand.filter((c) => !isTrump(c) && suitOf(c) === calledSuit);
            if (hold.length === 1) legal = legal.filter((c) => c !== hold[0]);
          }
        }
      }
    }
    return legal.length ? legal : [...hand];
  }

  play(seat, card) {
    this.assert(this.phase === 'playing' && seat === this.turn, 'Not your turn');
    this.assert(this.legalPlays(seat).includes(card), 'That card is not allowed right now');
    this.hands[seat] = this.hands[seat].filter((c) => c !== card);
    this.trick.plays.push({ seat, card });
    this.emit({ type: 'play', seat, card });
    if (card === this.calledCard && !this.partnerRevealed) {
      this.partnerRevealed = true;
      this.emit({ type: 'partnerRevealed', seat });
    }
    if (this.trick.plays.length < this.n) {
      this.turn = this.next(seat);
      return { trickDone: false };
    }
    const win = trickWinner(this.trick.plays);
    const done = { leader: this.trick.leader, plays: this.trick.plays, winner: win.seat, points: sumPoints(this.trick.plays.map((p) => p.card)) };
    this.tricks.push(done);
    this.lastTrick = done;
    this.emit({ type: 'trick', winner: win.seat, points: done.points });
    if (this.hands.every((h) => h.length === 0)) {
      this.trick = null;
      this.turn = null;
      this.finishHand();
    } else {
      this.startTrick(win.seat);
    }
    return { trickDone: true, trick: done };
  }

  // ---- Scoring -------------------------------------------------------------

  pickerSide() {
    return this.partner == null ? [this.picker] : [this.picker, this.partner];
  }

  finishHand() {
    const side = this.pickerSide();
    const sideTricks = this.tricks.filter((t) => side.includes(t.winner));
    const pickerPts = sumPoints(sideTricks.flatMap((t) => t.plays.map((p) => p.card))) + sumPoints(this.buried);
    const defPts = 120 - pickerPts;
    const defTricks = this.tricks.length - sideTricks.length;
    const won = pickerPts >= 61;
    let level = 1;
    let label = '';
    if (won) {
      if (defTricks === 0) { level = 3; label = 'no-trick'; } else if (defPts <= 30) { level = 2; label = 'schneider'; }
    } else if (sideTricks.length === 0) { level = 3; label = 'no-trick'; } else if (pickerPts <= 30) { level = 2; label = 'schneider'; }
    const m = level * this.multiplier;
    const defenders = [];
    for (let s = 0; s < this.n; s++) if (!side.includes(s)) defenders.push(s);
    const deltas = Array(this.n).fill(0);
    const sign = won ? 1 : -1;
    for (const d of defenders) deltas[d] = -sign * m;
    const total = defenders.length * m;
    if (this.partner != null) {
      deltas[this.partner] = sign * m;
      deltas[this.picker] = sign * (total - m);
    } else {
      deltas[this.picker] = sign * total;
    }
    for (let s = 0; s < this.n; s++) this.scores[s] += deltas[s];
    this.pendingDoublers = 0;
    this.result = {
      type: 'played', picker: this.picker, partner: this.partner, call: this.call, won, pickerPts, defPts,
      level, label, multiplier: this.multiplier, deltas, buried: this.buried, blind: this.blindCards,
    };
    this.history.push({ handNo: this.handNo, result: this.result, deltas });
    if (this.isLastHand) {
      this.lastHandDeclared = false;
      this.phase = 'gameOver';
    } else {
      this.phase = 'handOver';
    }
    this.emit({ type: 'handOver', result: this.result });
  }

  // ---- What a seat is allowed to know ------------------------------------------

  /**
   * How `seat` sees `other`, using only what `seat` could know at the table:
   * 'team', 'enemy', or 'unknown' (the partner hasn't shown up yet).
   */
  relation(seat, other) {
    if (seat === other) return 'team';
    const p = this.picker;
    const alone = this.partner == null;
    if (seat === p) {
      if (alone) return 'enemy';
      return this.partnerRevealed ? (other === this.partner ? 'team' : 'enemy') : 'unknown';
    }
    if (seat === this.partner) return other === p ? 'team' : 'enemy'; // the partner knows who they are
    if (other === p) return 'enemy';
    if (alone) return 'team';
    if (this.partnerRevealed) return other === this.partner ? 'enemy' : 'team';
    return 'unknown';
  }

  /** Every card that has hit the table this hand. */
  playedCards() {
    const cards = this.tricks.flatMap((t) => t.plays.map((p) => p.card));
    if (this.trick) cards.push(...this.trick.plays.map((p) => p.card));
    return cards;
  }

  assert(ok, msg) {
    if (!ok) throw new Error(msg || 'Illegal move');
  }
}

export { points };
