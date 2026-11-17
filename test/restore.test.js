const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const { start } = require('../server/index');
const Rooms = require('../server/rooms');

const SECRET = 'test-secret-1';
const next = (c, ev, pred = () => true, ms = 3000) => new Promise((res, rej) => {
  const t = setTimeout(() => { c.off(ev, h); rej(new Error('timeout waiting for ' + ev)); }, ms);
  function h(d) { if (pred(d)) { clearTimeout(t); c.off(ev, h); res(d); } }
  c.on(ev, h);
});
const conn = url => ioc(url, { transports: ['websocket'], forceNew: true, reconnection: false });

// Plays one move, then simulates a server restart: the room map is wiped and a new server starts.
async function gameThenRestart(secretAfter = SECRET) {
  const srv = await start(0, { secret: SECRET });
  const url = `http://localhost:${srv.port}`;
  const a = conn(url), b = conn(url);
  const snaps = new Map();
  for (const c of [a, b]) c.on('snap', s => snaps.set(c, s));
  const ja = next(a, 'joined'); a.emit('create', { name: 'เอ' }); const A = await ja;
  const jb = next(b, 'joined'); b.emit('join', { code: A.code, name: 'บี' }); await jb;
  const sa = next(a, 'state'); a.emit('start'); const v = await sa;
  const tokens = new Map();
  await new Promise(r => setTimeout(r, 100));
  const mover = v.turn === v.you ? a : b;
  const moved = next(a, 'state', x => x.seq === 1);
  const snapAfterMove = next(mover, 'snap', s => s && s.seq === 1);
  mover.emit('action', { type: 'take3', colors: ['white', 'blue', 'green'] });
  const after = await moved;
  await snapAfterMove;
  a.close(); b.close(); srv.close();
  Rooms.rooms.clear();
  const srv2 = await start(0, { secret: secretAfter });
  return { srv2, url2: `http://localhost:${srv2.port}`, code: A.code, tokenA: A.token, snapA: snaps.get(a), after };
}

test('a client gets an opaque snapshot after each move', async () => {
  const { srv2, snapA } = await gameThenRestart();
  assert.ok(snapA && typeof snapA.data === 'string');
  assert.strictEqual(snapA.seq, 1);
  assert.ok(!snapA.data.includes('white'), 'snapshot must not be readable');
  srv2.close();
});

test('after a restart, rejoining with token + snapshot restores the room and seat', async () => {
  const { srv2, url2, code, tokenA, snapA, after } = await gameThenRestart();
  const c = conn(url2);
  const j = next(c, 'joined');
  const st = next(c, 'state');
  c.emit('join', { code, token: tokenA, snap: snapA });
  const jj = await j, v = await st;
  assert.strictEqual(jj.code, code);
  assert.strictEqual(v.seq, after.seq);
  assert.strictEqual(v.players[v.you].name, 'เอ');
  assert.deepStrictEqual(v.bank, after.bank);
  c.close(); srv2.close();
});

test('a tampered snapshot is rejected', async () => {
  const { srv2, url2, code, tokenA, snapA } = await gameThenRestart();
  const bad = { ...snapA, data: snapA.data.slice(0, -4) + (snapA.data.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
  const c = conn(url2);
  const e = next(c, 'err');
  c.emit('join', { code, token: tokenA, snap: bad });
  assert.match((await e).msg, /ไม่พบห้อง/);
  c.close(); srv2.close();
});

test('a snapshot made with a different secret is rejected', async () => {
  const { srv2, url2, code, tokenA, snapA } = await gameThenRestart('another-secret');
  const c = conn(url2);
  const e = next(c, 'err');
  c.emit('join', { code, token: tokenA, snap: snapA });
  assert.match((await e).msg, /ไม่พบห้อง/);
  c.close(); srv2.close();
});

test('a snapshot for another room code is rejected', async () => {
  const { srv2, url2, tokenA, snapA } = await gameThenRestart();
  const c = conn(url2);
  const e = next(c, 'err');
  c.emit('join', { code: 'ZZZZ', token: tokenA, snap: snapA });
  assert.match((await e).msg, /ไม่พบห้อง/);
  c.close(); srv2.close();
});
