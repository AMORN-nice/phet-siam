const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { CARDS, NOBLES, COLORS } = require('../server/data');

test('colors are the five gem colors', () => {
  assert.deepStrictEqual(COLORS, ['white', 'blue', 'green', 'red', 'black']);
});

test('90 cards split 40/30/20 by tier, 18 per color', () => {
  assert.strictEqual(CARDS.length, 90);
  for (const [t, n] of [[1, 40], [2, 30], [3, 20]]) {
    assert.strictEqual(CARDS.filter(c => c.tier === t).length, n);
  }
  for (const c of COLORS) assert.strictEqual(CARDS.filter(k => k.color === c).length, 18);
  assert.strictEqual(new Set(CARDS.map(c => c.id)).size, 90);
});

test('cards match the independent csv source exactly (as a multiset)', () => {
  const rows = fs.readFileSync(path.join(__dirname, 'fixture-cards.csv'), 'utf8').trim().split('\n').slice(1);
  const key = (cost, pts, color) => COLORS.map(c => cost[c] || 0).join(',') + `|${pts}|${color}`;
  const fromCsv = rows.map(r => {
    const [w, u, g, rd, k, pt, bonus] = r.trim().split(',');
    return key({ white: +w, blue: +u, green: +g, red: +rd, black: +k }, +pt, bonus.toLowerCase());
  }).sort();
  const fromData = CARDS.map(c => key(c.cost, c.points, c.color)).sort();
  assert.deepStrictEqual(fromData, fromCsv);
});

test('10 nobles worth 3 points each: five 4+4, five 3+3+3', () => {
  assert.strictEqual(NOBLES.length, 10);
  for (const n of NOBLES) assert.strictEqual(n.points, 3);
  const shapes = NOBLES.map(n => Object.values(n.req).filter(v => v > 0).sort().join(''));
  assert.strictEqual(shapes.filter(s => s === '44').length, 5);
  assert.strictEqual(shapes.filter(s => s === '333').length, 5);
});
