// Table sizes and the house-rule switches.

export const LAYOUT = {
  3: { hand: 10, blind: 2 }, // 32 cards: 3 x 10 + 2
  4: { hand: 7, blind: 2 }, //  30 cards (black sevens out): 4 x 7 + 2
  5: { hand: 6, blind: 2 }, //  32 cards: 5 x 6 + 2
};

export const DEFAULT_SETTINGS = {
  numPlayers: 5,
  // How the picker gets a partner (4 and 5 players; 3 players is always alone).
  //   'calledAce'      - picker calls a fail ace they don't hold (house rule)
  //   'jackOfDiamonds' - whoever holds the jack of diamonds
  //   'alone'          - picker always plays alone
  partnerMode: 'calledAce',
  // If everyone passes:
  //   'doubler' - throw the hand in; the next hand counts double (house rule)
  //   'redeal'  - just deal again, nothing changes
  noPick: 'doubler',
  doublersStack: true, // two pass-outs in a row make the next hand x4, and so on
  booMauers: true, // when everyone passes, show the hands and boo the "mowers" (mauers)
  // A mower is someone who should have picked but got nervous and passed:
  mauerGoodTrump: 4, // 5-handed: this many good trump (queens, jacks, ace or 10 of diamonds)
  mauerCounters: 4, //  3- and 4-handed: this many counters (aces and 10s)
  lastHandDoubler: true, // the declared "last hand" counts double (house rule)
  hints: true, // suggested play with the reason
  odds: true, // odds for each card you could play
  highlightTrump: true,
  botSpeed: 'normal', // 'slow' | 'normal' | 'fast'
  playerName: 'Dad',
};

export const BOT_NAMES = ['Ev', 'Grandma', 'Uncle Joe', 'Auntie M'];

export const SPEED_MS = { slow: 1300, normal: 750, fast: 300 };

export function effectivePartnerMode(settings) {
  return settings.numPlayers === 3 ? 'alone' : settings.partnerMode;
}
