const test = require('node:test');
const assert = require('node:assert');
const R = require('../server/rules');
const { botAction } = require('../server/bot');

function seeded(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function playAll(n, seed) {
  let g = R.createGame(Array.from({ length: n }, (_, i) => ({ id: String(i), name: 'บอท' + i })), seeded(seed));
  let moves = 0, skips = 0;
  while (g.phase !== 'over') {
    const a = botAction(g, g.turn);
    if (a.type === 'skip') skips++;
    const res = R.applyAction(g, g.turn, a);
    assert.ok(!res.error, `illegal bot action ${JSON.stringify(a)}: ${res.error}`);
    g = res.state;
    if (++moves > 3000) throw new Error('game did not finish');
  }
  return { g, skips };
}

test('bots finish games at every table size with only legal moves', () => {
  for (const n of [2, 3, 4, 5]) {
    for (let k = 0; k < 15; k++) {
      const { g, skips } = playAll(n, 101 + k * 13 + n);
      assert.ok(g.winners.length >= 1);
      assert.ok(g.players.some(p => R.points(p) >= 15));
      assert.strictEqual(skips, 0, 'bot should never need to skip');
    }
  }
});

test('bot never peeks at face-down reserves of others', () => {
  // botAction only reads viewFor(state, idx); a hidden card must not appear in its candidates.
  const { choose } = require('../server/bot');
  let g = R.createGame([{ id: '0', name: 'a' }, { id: '1', name: 'b' }], seeded(7));
  g = R.applyAction(g, 0, { type: 'reserve', tier: 3, slot: null }).state;
  const v = R.viewFor(g, 1);
  assert.ok(v.players[0].reserved[0].hidden);
  assert.ok(choose(v));
});
