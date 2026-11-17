const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const { start } = require('../server/index');

const next = (c, ev, pred = () => true, ms = 3000) => new Promise((res, rej) => {
  const t = setTimeout(() => { c.off(ev, h); rej(new Error('timeout waiting for ' + ev)); }, ms);
  function h(d) { if (pred(d)) { clearTimeout(t); c.off(ev, h); res(d); } }
  c.on(ev, h);
});

async function twoPlayerGame(url) {
  const a = ioc(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  const b = ioc(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  const ja = next(a, 'joined'); a.emit('create', { name: 'เอ' }); const { code } = await ja;
  const jb = next(b, 'joined'); b.emit('join', { code, name: 'บี' }); await jb;
  const sa = next(a, 'state'); a.emit('start'); const v = await sa;
  return { a, b, code, v };
}

test('state carries the time left in the turn', async () => {
  const srv = await start(0, { turnMs: 60000 });
  const { a, b, v } = await twoPlayerGame(`http://localhost:${srv.port}`);
  assert.ok(v.turnEndsIn > 55000 && v.turnEndsIn <= 60000, String(v.turnEndsIn));
  a.close(); b.close(); srv.close();
});

test('when the turn timer runs out the turn passes to the next player', async () => {
  const srv = await start(0, { turnMs: 300 });
  const { a, b, v } = await twoPlayerGame(`http://localhost:${srv.port}`);
  const t0 = v.turn;
  const s = await next(a, 'state', x => x.turn !== t0, 2000);
  assert.match(s.log[s.log.length - 1], /หมดเวลา/);
  assert.ok(s.turnEndsIn > 0);
  a.close(); b.close(); srv.close();
});

test('the timer restarts for each new turn, not on a discard within the turn', async () => {
  const srv = await start(0, { turnMs: 60000 });
  const { a, b, v } = await twoPlayerGame(`http://localhost:${srv.port}`);
  const mover = v.turn === v.you ? a : b;
  const other = mover === a ? b : a;
  await new Promise(r => setTimeout(r, 300));
  const s = next(other, 'state', x => x.turn !== v.turn);
  mover.emit('action', { type: 'take3', colors: ['white', 'blue', 'green'] });
  const after = await s;
  assert.ok(after.turnEndsIn > 59000, 'fresh 60s for the new turn: ' + after.turnEndsIn);
  a.close(); b.close(); srv.close();
});
