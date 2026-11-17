const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const { start } = require('../server/index');

let srv, url;
test.before(async () => { srv = await start(0); url = `http://localhost:${srv.port}`; });
test.after(() => srv.close());

const clients = [];
function client() {
  const c = ioc(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  clients.push(c);
  return c;
}
test.afterEach(() => { while (clients.length) clients.pop().close(); });

const next = (c, ev, pred = () => true, ms = 2000) => new Promise((res, rej) => {
  const t = setTimeout(() => { c.off(ev, h); rej(new Error('timeout waiting for ' + ev)); }, ms);
  function h(d) { if (pred(d)) { clearTimeout(t); c.off(ev, h); res(d); } }
  c.on(ev, h);
});

async function makeRoom(n) {
  const host = client();
  const j = next(host, 'joined');
  host.emit('create', { name: 'หัวห้อง' });
  const hj = await j;
  const others = [];
  for (let i = 1; i < n; i++) {
    const c = client();
    const p = next(c, 'joined');
    c.emit('join', { code: hj.code, name: 'เพื่อน' + i });
    others.push({ c, j: await p });
  }
  return { host, hj, others, all: [{ c: host, j: hj }, ...others] };
}

test('create and join a room; room broadcast lists players', async () => {
  const { host, hj } = await makeRoom(1);
  assert.match(hj.code, /^[A-Z]{4}$/);
  const roomP = next(host, 'room', r => r.players.length === 2);
  const c = client();
  c.emit('join', { code: hj.code, name: 'บี' });
  const r = await roomP;
  assert.deepStrictEqual(r.players.map(p => p.name), ['หัวห้อง', 'บี']);
  assert.strictEqual(r.hostSeat, 0);
});

test('joining a missing room or with an empty name errors', async () => {
  const c = client();
  const e1 = next(c, 'err');
  c.emit('join', { code: 'ZZZZ', name: 'x' });
  assert.ok((await e1).msg);
  const e2 = next(c, 'err');
  c.emit('create', { name: '   ' });
  assert.ok((await e2).msg);
});

test('a sixth player is rejected', async () => {
  const { hj } = await makeRoom(5);
  const c = client();
  const e = next(c, 'err');
  c.emit('join', { code: hj.code, name: 'หก' });
  assert.match((await e).msg, /เต็ม/);
});

test('only the host can start, and needs 2+ players', async () => {
  const solo = await makeRoom(1);
  const e = next(solo.host, 'err');
  solo.host.emit('start');
  assert.ok((await e).msg);

  const { host, others } = await makeRoom(2);
  const e2 = next(others[0].c, 'err');
  others[0].c.emit('start');
  assert.ok((await e2).msg);
  const st = next(host, 'state');
  host.emit('start');
  const v = await st;
  assert.strictEqual(v.players.length, 2);
  assert.strictEqual(v.phase, 'play');
});

test('actions go through the rules; bad or out-of-turn actions get err', async () => {
  const { all, host } = await makeRoom(2);
  const states = all.map(a => next(a.c, 'state'));
  host.emit('start');
  const views = await Promise.all(states);
  const turnIdx = views[0].turn;
  const mover = all.find((a, i) => views[i].you === turnIdx);
  const waiter = all.find((a, i) => views[i].you !== turnIdx);
  const e = next(waiter.c, 'err');
  waiter.c.emit('action', { type: 'take3', colors: ['white', 'blue', 'green'] });
  assert.ok((await e).msg);
  const e2 = next(mover.c, 'err');
  mover.c.emit('action', { type: 'nonsense' });
  assert.ok((await e2).msg);
  const s = next(waiter.c, 'state', v => v.turn !== turnIdx);
  mover.c.emit('action', { type: 'take3', colors: ['white', 'blue', 'green'] });
  const v = await s;
  assert.strictEqual(v.players[turnIdx].gems.white, 1);
});

test('reconnecting with the token returns the same seat (no duplicate)', async () => {
  const { others, hj, host } = await makeRoom(2);
  const friend = others[0];
  friend.c.close();
  await next(host, 'room', r => r.players[1] && r.players[1].online === false);
  const back = client();
  const j = next(back, 'joined');
  back.emit('join', { code: hj.code, name: 'ชื่อใหม่', token: friend.j.token });
  const jj = await j;
  assert.strictEqual(jj.seat, friend.j.seat);
  const r = await next(host, 'room', r => r.players.every(p => p.online));
  assert.strictEqual(r.players.length, 2);
});

test('host leaving passes host to the next online player', async () => {
  const { host, others } = await makeRoom(3);
  const r = next(others[0].c, 'room', r => r.hostSeat !== 0);
  host.close();
  assert.strictEqual((await r).hostSeat, 1);
});

test('host can skip the turn of a disconnected player', async () => {
  const { all, host } = await makeRoom(3);
  const states = all.map(a => next(a.c, 'state'));
  host.emit('start');
  const views = await Promise.all(states);
  const turn = views[0].turn;
  const hostView = views[0];
  if (turn === hostView.you) {
    // make it a guest's turn first
    const s = next(host, 'state', v => v.turn !== turn);
    host.emit('action', { type: 'take3', colors: ['white', 'blue', 'green'] });
    await s;
  }
  const cur = (await new Promise(r => { host.once('state', r); host.emit('ping-state'); })).turn;
  const victim = all.find((a, i) => views[i].you === cur);
  victim.c.close();
  await next(host, 'room', r => r.players[cur].online === false);
  const s = next(host, 'state', v => v.turn !== cur);
  host.emit('skipTurn');
  assert.notStrictEqual((await s).turn, cur);
});

test('after start, a newcomer can claim an offline seat', async () => {
  const { all, host, hj } = await makeRoom(2);
  const states = all.map(a => next(a.c, 'state'));
  host.emit('start');
  const views = await Promise.all(states);
  const gone = all[1];
  const goneSeat = views[1].you;
  gone.c.close();
  await next(host, 'room', r => r.players[goneSeat].online === false);
  const c = client();
  const e = next(c, 'err');
  c.emit('join', { code: hj.code, name: 'คนใหม่' });
  const err = await e;
  assert.deepStrictEqual(err.offlineSeats, [goneSeat]);
  const j = next(c, 'joined');
  const st = next(c, 'state');
  c.emit('claimSeat', { code: hj.code, seat: goneSeat });
  assert.strictEqual((await j).seat, goneSeat);
  assert.strictEqual((await st).you, goneSeat);
});

test('players who left the lobby are dropped when the game starts', async () => {
  const { host, others } = await makeRoom(3);
  others[1].c.close();
  await next(host, 'room', r => r.players[2] && r.players[2].online === false);
  const st = next(host, 'state');
  host.emit('start');
  const v = await st;
  assert.strictEqual(v.players.length, 2);
  assert.ok(!v.players.some(p => p.name === 'เพื่อน2'));
});

test('cannot start when fewer than 2 players are online', async () => {
  const { host, others } = await makeRoom(2);
  others[0].c.close();
  await next(host, 'room', r => r.players[1].online === false);
  const e = next(host, 'err');
  host.emit('start');
  assert.ok((await e).msg);
});
