const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const { start } = require('../server/index');
const R = require('../server/rules');
const { choose } = require('../server/bot');

let srv, url;
test.before(async () => { srv = await start(0, { botMs: 20 }); url = `http://localhost:${srv.port}`; });
test.after(() => srv.close());
const clients = [];
const client = () => { const c = ioc(url, { transports: ['websocket'], forceNew: true, reconnection: false }); clients.push(c); return c; };
test.afterEach(() => { while (clients.length) clients.pop().close(); });
const next = (c, ev, pred = () => true, ms = 3000) => new Promise((res, rej) => {
  const t = setTimeout(() => { c.off(ev, h); rej(new Error('timeout waiting for ' + ev)); }, ms);
  function h(d) { if (pred(d)) { clearTimeout(t); c.off(ev, h); res(d); } }
  c.on(ev, h);
});

test('solo: game starts at once with bots, and bots take their turns', async () => {
  const c = client();
  const room = next(c, 'room');
  const st = next(c, 'state', v => v.turn === v.you && v.phase === 'play');
  c.emit('solo', { name: 'ฉัน', theme: 'fantasy', bots: 3 });
  const r = await room;
  assert.strictEqual(r.solo, true);
  assert.strictEqual(r.theme, 'fantasy');
  assert.strictEqual(r.players.length, 4);
  assert.strictEqual(r.players.filter(p => p.bot).length, 3);
  assert.ok(r.players.every(p => p.online));
  const v = await st; // whatever seat we got, bots before us have moved and it's our turn
  assert.strictEqual(v.players[v.you].name, 'ฉัน');
});

test('solo: a human can play a full game against bots', async () => {
  const c = client();
  let moves = 0;
  const over = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('game stuck')), 20000);
    c.on('err', e => reject(new Error(e.msg)));
    c.on('state', v => {
      if (v.phase === 'over') { clearTimeout(t); resolve(v); return; }
      if (v.turn !== v.you) return;
      moves++;
      c.emit('action', choose(v)); // play with the bot brain as a stand-in human
    });
  });
  c.emit('solo', { name: 'ฉัน', bots: 1 });
  const v = await over;
  assert.ok(v.winners.length >= 1);
  assert.ok(moves > 5);
});

test('solo: others cannot join or claim a seat by room code', async () => {
  const c = client();
  const j = next(c, 'joined');
  c.emit('solo', { name: 'ฉัน', bots: 2 });
  const { code } = await j;
  const o = client();
  const e = next(o, 'err');
  o.emit('join', { code, name: 'แขก' });
  assert.match((await e).msg, /คนเดียว/);
  const e2 = next(o, 'err');
  o.emit('claimSeat', { code, seat: 1 });
  assert.match((await e2).msg, /คนเดียว/);
});

test('solo: bots wait while the player is away, then carry on after rejoin', async () => {
  const c = client();
  const j = next(c, 'joined');
  const first = next(c, 'state', v => v.turn === v.you && v.phase === 'play');
  c.emit('solo', { name: 'ฉัน', bots: 4 });
  const me = await j;
  const v0 = await first;
  // Make our move, then drop before the bots finish their round.
  c.emit('action', choose(v0));
  await next(c, 'state', v => v.seq > v0.seq);
  c.close();
  await new Promise(r => setTimeout(r, 30));
  const { rooms } = require('../server/rooms');
  const room = rooms.get(me.code);
  const seqAway = room.game.seq;
  await new Promise(r => setTimeout(r, 300));
  assert.ok(room.game.seq - seqAway <= 1, 'bots should pause while the player is away');
  assert.strictEqual(room.deadline, null, 'turn clock should stop while paused');
  const c2 = client();
  const back = next(c2, 'state', v => v.turn === v.you && v.round > v0.round);
  c2.emit('join', { code: me.code, token: me.token });
  await back;
});

test('solo: leaving ends the game so a new one can be started', async () => {
  const c = client();
  const j = next(c, 'joined');
  c.emit('solo', { name: 'ฉัน', bots: 1 });
  const { code } = await j;
  const left = next(c, 'left');
  c.emit('leaveRoom');
  await left;
  const { rooms } = require('../server/rooms');
  assert.ok(!rooms.has(code));
  const j2 = next(c, 'joined');
  c.emit('solo', { name: 'ฉัน', bots: 2 });
  assert.notStrictEqual((await j2).code, code);
});

test('solo: snapshot restore keeps bot seats and solo mode', () => {
  const Rooms = require('../server/rooms');
  const g = R.createGame([{ id: '0', name: 'ฉัน' }, { id: '1', name: 'บอทแก้ว' }]);
  const r = Rooms.restoreRoom({ code: 'ZZZZ', theme: 'siam', solo: true, hostToken: 't0',
    seats: [{ name: 'ฉัน', token: 't0' }, { name: 'บอทแก้ว', token: 't1', bot: true }], game: g });
  assert.strictEqual(r.solo, true);
  assert.strictEqual(r.seats[1].bot, true);
  assert.deepStrictEqual(Rooms.offlineSeats(r), [0]);
  Rooms.rooms.delete('ZZZZ');
});
