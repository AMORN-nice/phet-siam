// Plays full games with N bots over real sockets to prove games always reach the end.
// Usage: node scripts/bot-playtest.js [players=2..5] [games=1]
const { io } = require('socket.io-client');
const { start } = require('../server/index');
const COLORS = ['white', 'blue', 'green', 'red', 'black'];

function payment(p, card) {
  const pay = { gold: 0 };
  for (const c of COLORS) {
    const need = Math.max(0, card.cost[c] - p.bonuses[c]);
    pay[c] = Math.min(need, p.gems[c]);
    pay.gold += need - pay[c];
  }
  return pay.gold <= p.gems.gold ? pay : null;
}

function choose(v, rng) {
  const p = v.players[v.you];
  if (v.phase === 'discard') {
    const g = {}; let n = v.discardCount;
    const keys = [...COLORS, 'gold'];
    while (n > 0) { const k = keys.sort((a, b) => (p.gems[b] - (g[b] || 0)) - (p.gems[a] - (g[a] || 0)))[0]; g[k] = (g[k] || 0) + 1; n--; }
    return { type: 'discard', gems: g };
  }
  if (v.phase === 'noble') return { type: 'chooseNoble', nobleId: v.nobleChoices[0].id };
  const buys = [];
  v.board.forEach((row, t) => row.forEach((c, slot) => { if (c && payment(p, c)) buys.push({ c, a: { type: 'buy', source: 'board', tier: t + 1, slot } }); }));
  p.reserved.forEach((c, index) => { if (!c.hidden && payment(p, c)) buys.push({ c, a: { type: 'buy', source: 'reserved', index } }); });
  if (buys.length) { buys.sort((x, y) => y.c.points - x.c.points); return buys[0].a; }
  const avail = COLORS.filter(c => v.bank[c] > 0);
  if (rng() < 0.12 && p.reserved.length < 3) {
    const t = Math.floor(rng() * 3);
    const slot = v.board[t].findIndex(Boolean);
    if (slot >= 0) return { type: 'reserve', tier: t + 1, slot };
  }
  if (avail.length >= 3 || avail.length === 0 || rng() < 0.5) {
    return { type: 'take3', colors: avail.sort(() => rng() - 0.5).slice(0, 3) };
  }
  const two = COLORS.find(c => v.bank[c] >= 4);
  if (two) return { type: 'take2', color: two };
  return { type: 'take3', colors: avail.slice(0, 3) };
}

async function playOne(url, n, seed) {
  let s = seed;
  const rng = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const bots = Array.from({ length: n }, () => io(url, { transports: ['websocket'], forceNew: true }));
  const once = (c, ev) => new Promise(r => c.once(ev, r));
  const j0 = once(bots[0], 'joined');
  bots[0].emit('create', { name: 'บอท0' });
  const { code } = await j0;
  for (let i = 1; i < n; i++) { const j = once(bots[i], 'joined'); bots[i].emit('join', { code, name: 'บอท' + i }); await j; }
  let moves = 0, errors = 0;
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`stuck after ${moves} moves`)), 60000);
    bots.forEach(b => {
      b.on('err', e => { errors++; if (errors > 20) reject(new Error('too many errors: ' + e.msg)); });
      b.on('state', v => {
        if (v.phase === 'over') { clearTimeout(timer); resolve(v); return; }
        if (v.turn !== v.you) return;
        moves++;
        if (moves > 2000) { reject(new Error('too many moves')); return; }
        setImmediate(() => b.emit('action', choose(v, rng)));
      });
    });
  });
  bots[0].emit('start');
  const v = await done;
  bots.forEach(b => b.close());
  return { moves, errors, rounds: v.round, winners: v.winners.map(i => v.players[i].name), scores: v.players.map(p => p.points) };
}

(async () => {
  const srv = await start(0);
  const url = `http://localhost:${srv.port}`;
  const sizes = process.argv[2] ? [+process.argv[2]] : [2, 3, 4, 5];
  const games = +(process.argv[3] || 3);
  let failed = 0;
  for (const n of sizes) {
    for (let g = 0; g < games; g++) {
      try {
        const r = await playOne(url, n, 1000 + g * 7 + n);
        console.log(`${n}p game ${g + 1}: rounds=${r.rounds} moves=${r.moves} rejected=${r.errors} scores=${r.scores.join('/')} winner=${r.winners.join('+')}`);
      } catch (e) { failed++; console.log(`${n}p game ${g + 1}: FAIL ${e.message}`); }
    }
  }
  srv.close();
  console.log(failed ? `FAILED ${failed}` : 'ALL GAMES FINISHED');
  process.exit(failed ? 1 : 0);
})();
