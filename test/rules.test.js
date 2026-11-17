const test = require('node:test');
const assert = require('node:assert');
const R = require('../server/rules');
const { COLORS } = require('../server/data');

const mkPlayers = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'ผู้เล่น' + i }));
const seeded = () => { let s = 42; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const newGame = (n = 2) => R.createGame(mkPlayers(n), seeded());
const ok = r => { assert.ok(!r.error, 'unexpected error: ' + r.error); return r.state; };
const zero = () => ({ white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 });
const card = (over = {}) => ({ id: 999, tier: 1, color: 'red', points: 0, cost: { white: 0, blue: 0, green: 0, red: 0, black: 0 }, ...over });

test('setup scales with player count', () => {
  for (const [n, gems, nobles] of [[2, 4, 3], [3, 5, 4], [4, 7, 5], [5, 7, 6]]) {
    const s = newGame(n);
    for (const c of COLORS) assert.strictEqual(s.bank[c], gems, `${n}p ${c}`);
    assert.strictEqual(s.bank.gold, 5);
    assert.strictEqual(s.nobles.length, nobles);
    assert.strictEqual(s.players.length, n);
    assert.strictEqual(s.turn, 0);
    assert.strictEqual(s.phase, 'play');
  }
});

test('setup deals 4 face-up cards per tier and the rest stay in decks', () => {
  const s = newGame(3);
  s.board.forEach((row, t) => {
    assert.strictEqual(row.length, 4);
    row.forEach(c => assert.strictEqual(c.tier, t + 1));
  });
  assert.deepStrictEqual(s.decks.map(d => d.length), [36, 26, 16]);
});

test('createGame rejects fewer than 2 or more than 5 players', () => {
  assert.throws(() => R.createGame(mkPlayers(1)));
  assert.throws(() => R.createGame(mkPlayers(6)));
});

test('acting out of turn is rejected and state is unchanged', () => {
  const s = newGame(2);
  const before = JSON.stringify(s);
  const r = R.applyAction(s, 1, { type: 'take3', colors: ['white', 'blue', 'green'] });
  assert.ok(r.error);
  assert.strictEqual(JSON.stringify(s), before);
});

test('unknown or malformed actions are rejected', () => {
  const s = newGame(2);
  for (const a of [null, {}, { type: 'hack' }, { type: 'take3', colors: 'red' }, { type: 'take3', colors: ['gold', 'red', 'blue'] },
    { type: 'take2', color: 'purple' }, { type: 'buy', source: 'board', tier: 9, slot: 0 }, { type: 'reserve', tier: 1, slot: 7 }]) {
    assert.ok(R.applyAction(s, 0, a).error, JSON.stringify(a));
  }
});

test('take3 takes three different colors and passes the turn', () => {
  const s = ok(R.applyAction(newGame(2), 0, { type: 'take3', colors: ['white', 'blue', 'green'] }));
  assert.strictEqual(s.players[0].gems.white, 1);
  assert.strictEqual(s.bank.white, 3);
  assert.strictEqual(s.turn, 1);
});

test('take3 rejects duplicate colors', () => {
  assert.ok(R.applyAction(newGame(2), 0, { type: 'take3', colors: ['red', 'red', 'blue'] }).error);
});

test('take3 must take as many colors as available, up to 3', () => {
  const s = newGame(2);
  s.bank = { white: 0, blue: 0, green: 0, red: 2, black: 1, gold: 5 };
  assert.ok(R.applyAction(s, 0, { type: 'take3', colors: ['red'] }).error, 'must take both available');
  const s2 = ok(R.applyAction(s, 0, { type: 'take3', colors: ['red', 'black'] }));
  assert.strictEqual(s2.players[0].gems.black, 1);
  assert.ok(R.applyAction(s, 0, { type: 'take3', colors: ['red', 'white'] }).error, 'white is empty');
});

test('take2 needs at least 4 in the pile', () => {
  const s = newGame(3);
  s.bank.red = 3;
  assert.ok(R.applyAction(s, 0, { type: 'take2', color: 'red' }).error);
  const s2 = ok(R.applyAction(s, 0, { type: 'take2', color: 'blue' }));
  assert.strictEqual(s2.players[0].gems.blue, 2);
  assert.strictEqual(s2.bank.blue, 3);
});

test('reserve from board gives gold and refills the slot', () => {
  const s = newGame(2);
  const target = s.board[0][2];
  const s2 = ok(R.applyAction(s, 0, { type: 'reserve', tier: 1, slot: 2 }));
  assert.strictEqual(s2.players[0].reserved[0].id, target.id);
  assert.strictEqual(s2.players[0].reserved[0].fromDeck, false);
  assert.strictEqual(s2.players[0].gems.gold, 1);
  assert.strictEqual(s2.bank.gold, 4);
  assert.notStrictEqual(s2.board[0][2].id, target.id);
  assert.strictEqual(s2.decks[0].length, 35);
});

test('reserve blind from deck marks fromDeck', () => {
  const s = ok(R.applyAction(newGame(2), 0, { type: 'reserve', tier: 3, slot: null }));
  assert.strictEqual(s.players[0].reserved[0].fromDeck, true);
  assert.strictEqual(s.decks[2].length, 15);
});

test('reserve still works with no gold left but gives none', () => {
  const s = newGame(2);
  s.bank.gold = 0;
  const s2 = ok(R.applyAction(s, 0, { type: 'reserve', tier: 1, slot: 0 }));
  assert.strictEqual(s2.players[0].gems.gold, 0);
  assert.strictEqual(s2.players[0].reserved.length, 1);
});

test('reserve from an empty deck is rejected', () => {
  const s = newGame(2);
  s.decks[2] = [];
  assert.ok(R.applyAction(s, 0, { type: 'reserve', tier: 3, slot: null }).error);
});

test('cannot reserve more than 3 cards', () => {
  const s = newGame(2);
  s.players[0].reserved = [card({ id: 1 }), card({ id: 2 }), card({ id: 3 })];
  assert.ok(R.applyAction(s, 0, { type: 'reserve', tier: 1, slot: 0 }).error);
});

test('buy applies bonuses, then gems, then gold for the shortfall', () => {
  const s = newGame(2);
  s.board[0][0] = card({ id: 500, color: 'green', points: 1, cost: { white: 0, blue: 0, green: 0, red: 3, black: 2 } });
  const p = s.players[0];
  p.cards = [card({ id: 501, color: 'red' })]; // red bonus 1 → need red 2
  p.gems = { ...zero(), red: 1, black: 2, gold: 1 };
  const s2 = ok(R.applyAction(s, 0, { type: 'buy', source: 'board', tier: 1, slot: 0 }));
  const q = s2.players[0];
  assert.deepStrictEqual(q.gems, zero());
  assert.strictEqual(q.cards.length, 2);
  assert.strictEqual(s2.bank.red, s.bank.red + 1);
  assert.strictEqual(s2.bank.gold, s.bank.gold + 1);
  assert.strictEqual(R.points(q), 1);
});

test('buy without enough gems is rejected', () => {
  const s = newGame(2);
  s.board[0][0] = card({ id: 500, cost: { white: 0, blue: 0, green: 0, red: 3, black: 0 } });
  s.players[0].gems = { ...zero(), red: 2 };
  assert.ok(R.applyAction(s, 0, { type: 'buy', source: 'board', tier: 1, slot: 0 }).error);
});

test('buy a reserved card removes it from reserved', () => {
  const s = newGame(2);
  s.players[0].reserved = [card({ id: 700 })];
  const s2 = ok(R.applyAction(s, 0, { type: 'buy', source: 'reserved', index: 0 }));
  assert.strictEqual(s2.players[0].reserved.length, 0);
  assert.strictEqual(s2.players[0].cards[0].id, 700);
});

test('going over 10 gems enters discard phase on the same turn', () => {
  const s = newGame(2);
  s.players[0].gems = { ...zero(), white: 3, blue: 3, green: 3 };
  const s2 = ok(R.applyAction(s, 0, { type: 'take3', colors: ['red', 'black', 'white'] }));
  assert.strictEqual(s2.phase, 'discard');
  assert.strictEqual(s2.turn, 0);
  assert.strictEqual(s2.discardCount, 2);
  assert.ok(R.applyAction(s2, 0, { type: 'discard', gems: { white: 1 } }).error, 'wrong amount');
  assert.ok(R.applyAction(s2, 0, { type: 'take3', colors: ['blue'] }).error, 'only discard allowed');
  const s3 = ok(R.applyAction(s2, 0, { type: 'discard', gems: { white: 1, red: 1 } }));
  assert.strictEqual(s3.phase, 'play');
  assert.strictEqual(s3.turn, 1);
  assert.strictEqual(Object.values(s3.players[0].gems).reduce((a, b) => a + b), 10);
});

test('a single eligible noble visits automatically', () => {
  const s = newGame(2);
  s.nobles = [{ id: 1, points: 3, req: { white: 0, blue: 0, green: 0, red: 1, black: 0 } }];
  s.board[0][0] = card({ id: 500, color: 'red' });
  const s2 = ok(R.applyAction(s, 0, { type: 'buy', source: 'board', tier: 1, slot: 0 }));
  assert.strictEqual(s2.players[0].nobles.length, 1);
  assert.strictEqual(s2.nobles.length, 0);
  assert.strictEqual(R.points(s2.players[0]), 3);
  assert.strictEqual(s2.turn, 1);
});

test('several eligible nobles: player chooses one', () => {
  const s = newGame(2);
  s.nobles = [1, 2].map(id => ({ id, points: 3, req: { white: 0, blue: 0, green: 0, red: 1, black: 0 } }));
  s.board[0][0] = card({ id: 500, color: 'red' });
  const s2 = ok(R.applyAction(s, 0, { type: 'buy', source: 'board', tier: 1, slot: 0 }));
  assert.strictEqual(s2.phase, 'noble');
  assert.ok(R.applyAction(s2, 0, { type: 'chooseNoble', nobleId: 99 }).error);
  const s3 = ok(R.applyAction(s2, 0, { type: 'chooseNoble', nobleId: 2 }));
  assert.strictEqual(s3.players[0].nobles[0].id, 2);
  assert.strictEqual(s3.nobles.length, 1);
  assert.strictEqual(s3.turn, 1);
});

test('reaching 15 finishes the round, then highest points wins', () => {
  const s = newGame(3);
  s.players[1].cards = [card({ id: 1, points: 14 })];
  s.board[0][0] = card({ id: 500, points: 1 });
  let t = ok(R.applyAction(s, 0, { type: 'take3', colors: ['white', 'blue', 'green'] }));
  t = ok(R.applyAction(t, 1, { type: 'buy', source: 'board', tier: 1, slot: 0 }));
  assert.strictEqual(t.finalRound, true);
  assert.strictEqual(t.phase, 'play');
  t = ok(R.applyAction(t, 2, { type: 'take3', colors: ['white', 'blue', 'green'] }));
  assert.strictEqual(t.phase, 'over');
  assert.deepStrictEqual(t.winners, [1]);
});

test('tie on points goes to fewer cards; full tie shares the win', () => {
  const s = newGame(2);
  s.players[0].cards = [card({ id: 1, points: 15 })];
  s.players[1].cards = [card({ id: 2, points: 10 }), card({ id: 3, points: 5 })];
  let t = ok(R.applyAction(s, 0, { type: 'take3', colors: ['white', 'blue', 'green'] }));
  t = ok(R.applyAction(t, 1, { type: 'take3', colors: ['white', 'blue', 'green'] }));
  assert.deepStrictEqual(t.winners, [0]);

  const u = newGame(2);
  u.players[0].cards = [card({ id: 1, points: 15 })];
  u.players[1].cards = [card({ id: 2, points: 15 })];
  let v = ok(R.applyAction(u, 0, { type: 'take3', colors: ['white', 'blue', 'green'] }));
  v = ok(R.applyAction(v, 1, { type: 'take3', colors: ['white', 'blue', 'green'] }));
  assert.deepStrictEqual(v.winners, [0, 1]);
});

test('skip passes the turn in any phase', () => {
  const s = newGame(2);
  s.players[0].gems = { ...zero(), white: 4, blue: 4, green: 2 };
  const s2 = ok(R.applyAction(s, 0, { type: 'take3', colors: ['red'] .concat(['black']).concat(['white']) }));
  assert.strictEqual(s2.phase, 'discard');
  const s3 = ok(R.applyAction(s2, 0, { type: 'skip' }));
  assert.strictEqual(s3.turn, 1);
  assert.strictEqual(s3.phase, 'play');
  assert.ok(Object.values(s3.players[0].gems).reduce((a, b) => a + b) <= 10);
});

test('no actions accepted after the game is over', () => {
  const s = newGame(2);
  s.phase = 'over';
  assert.ok(R.applyAction(s, 0, { type: 'take3', colors: ['white', 'blue', 'green'] }).error);
});

test('viewFor hides deck order and other players blind reserves', () => {
  let s = newGame(3);
  s = ok(R.applyAction(s, 0, { type: 'reserve', tier: 2, slot: null }));   // blind
  s = ok(R.applyAction(s, 1, { type: 'reserve', tier: 1, slot: 0 }));      // open
  const v = R.viewFor(s, 2);
  assert.strictEqual(v.decks, undefined);
  assert.deepStrictEqual(v.deckCounts, [s.decks[0].length, s.decks[1].length, s.decks[2].length]);
  assert.deepStrictEqual(v.players[0].reserved[0], { hidden: true, tier: 2 });
  assert.strictEqual(v.players[1].reserved[0].id, s.players[1].reserved[0].id);
  assert.strictEqual(v.you, 2);
  const own = R.viewFor(s, 0);
  assert.strictEqual(own.players[0].reserved[0].id, s.players[0].reserved[0].id);
  assert.strictEqual(JSON.stringify(R.viewFor(s, null)).includes('"decks"'), false);
});

test('viewFor includes derived points and bonuses', () => {
  const s = newGame(2);
  s.players[0].cards = [card({ id: 1, color: 'blue', points: 2 })];
  const v = R.viewFor(s, 0);
  assert.strictEqual(v.players[0].points, 2);
  assert.strictEqual(v.players[0].bonuses.blue, 1);
});

test('discard rejects inherited/prototype keys like constructor', () => {
  const s = newGame(2);
  s.players[0].gems = { ...zero(), white: 4, blue: 4, green: 2 };
  const s2 = ok(R.applyAction(s, 0, { type: 'take3', colors: ['red', 'black', 'white'] }));
  assert.strictEqual(s2.phase, 'discard');
  for (const k of ['constructor', 'toString', '__proto__', 'valueOf']) {
    assert.ok(R.applyAction(s2, 0, { type: 'discard', gems: { [k]: 3 } }).error, k);
  }
  assert.ok(R.applyAction(s2, 0, { type: 'discard', gems: JSON.parse('{"__proto__": 3}') }).error);
});

test('each applied action bumps seq and records what happened as events', () => {
  let s = newGame(2);
  assert.strictEqual(s.seq, 0);
  s = ok(R.applyAction(s, 0, { type: 'take3', colors: ['white', 'blue', 'green'] }));
  assert.strictEqual(s.seq, 1);
  assert.deepStrictEqual(s.events, [{ type: 'take', player: 0 }]);
  s = ok(R.applyAction(s, 1, { type: 'reserve', tier: 1, slot: 0 }));
  assert.deepStrictEqual(s.events, [{ type: 'reserve', player: 1 }]);

  const t = newGame(2);
  t.nobles = [{ id: 1, points: 3, req: { white: 0, blue: 0, green: 0, red: 1, black: 0 } }];
  t.board[0][0] = card({ id: 500, color: 'red' });
  t.players[0].cards = [card({ id: 1, points: 15 })];
  let u = ok(R.applyAction(t, 0, { type: 'buy', source: 'board', tier: 1, slot: 0 }));
  assert.deepStrictEqual(u.events.map(e => e.type), ['buy', 'noble']);
  u = ok(R.applyAction(u, 1, { type: 'take3', colors: ['white', 'blue', 'green'] }));
  assert.deepStrictEqual(u.events.map(e => e.type), ['take', 'over']);
});

test('rejected actions do not bump seq', () => {
  const s = newGame(2);
  R.applyAction(s, 1, { type: 'take3', colors: ['white', 'blue', 'green'] });
  assert.strictEqual(s.seq, 0);
});

test('timeout skip logs that time ran out', () => {
  const s = ok(R.applyAction(newGame(2), 0, { type: 'skip', reason: 'timeout' }));
  assert.match(s.log[s.log.length - 1], /หมดเวลา/);
  assert.strictEqual(s.turn, 1);
});
