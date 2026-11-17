// HTTP + Socket.io server. The server is the only authority on game state.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const R = require('./rules');
const Rooms = require('./rooms');
const Snap = require('./snapshot');

function start(port = process.env.PORT || 3000, opts = {}) {
  const TURN_MS = opts.turnMs || Number(process.env.TURN_MS) || 60 * 1000;
  // Must stay the same across restarts for snapshots to open (Render: SNAPSHOT_SECRET env var).
  const SECRET = opts.secret || process.env.SNAPSHOT_SECRET || require('crypto').randomBytes(32).toString('hex');
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('/health', (_, res) => res.send('ok'));
  const server = http.createServer(app);
  const io = new Server(server);

  const sendRoom = room => {
    for (const s of room.seats) if (s.socketId) io.to(s.socketId).emit('room', Rooms.publicRoom(room));
  };
  const viewWithTimer = (room, i) => {
    const v = R.viewFor(room.game, i);
    v.turnEndsIn = room.deadline ? Math.max(0, room.deadline - Date.now()) : null;
    v.turnMs = TURN_MS;
    return v;
  };
  const sendState = room => {
    if (!room.game) return;
    room.seats.forEach((s, i) => { if (s.socketId) io.to(s.socketId).emit('state', viewWithTimer(room, i)); });
  };
  // One clock per turn: restarts when the turn moves on, not on discard/noble steps within it.
  const armTimer = room => {
    const g = room.game;
    const key = g && g.phase !== 'over' ? `${g.round}:${g.turn}` : null;
    if (key === room.timerKey) return;
    clearTimeout(room.timer);
    room.timerKey = key;
    room.deadline = null;
    if (!key) return;
    room.deadline = Date.now() + TURN_MS;
    room.timer = setTimeout(() => {
      if (!room.game || room.timerKey !== key) return;
      const res = R.applyAction(room.game, room.game.turn, { type: 'skip', reason: 'timeout' });
      if (!res.error) { room.game = res.state; commit(room); }
    }, TURN_MS);
    if (room.timer.unref) room.timer.unref();
  };
  const snapFor = room => ({
    code: room.code,
    seq: room.game.seq,
    data: Snap.seal({
      v: 1, code: room.code, theme: room.theme,
      hostToken: room.seats[room.hostSeat] && room.seats[room.hostSeat].token,
      seats: room.seats.map(s => ({ name: s.name, token: s.token })),
      game: room.game,
    }, SECRET),
  });
  const sendSnap = room => {
    if (!room.game) return;
    const snap = snapFor(room);
    for (const s of room.seats) if (s.socketId) io.to(s.socketId).emit('snap', snap);
  };
  // Opens a client's snapshot for this room code; null unless genuine and well-formed.
  const openSnap = (snap, code) => {
    if (!snap || typeof snap !== 'object') return null;
    const p = Snap.open(snap.data, SECRET);
    if (!p || p.v !== 1 || p.code !== code || !Array.isArray(p.seats) || !p.game) return null;
    return p;
  };
  const commit = room => { armTimer(room); sendState(room); sendSnap(room); };
  const sendJoined = (room, i) => {
    const s = room.seats[i];
    if (s.socketId) io.to(s.socketId).emit('joined', { code: room.code, token: s.token, seat: i });
  };

  io.on('connection', socket => {
    let room = null;
    const err = (msg, extra) => socket.emit('err', { msg, ...extra });
    const attach = (r, i) => {
      room = r;
      r.seats[i].socketId = socket.id;
      r.lastActive = Date.now();
      Rooms.fixHost(r);
      sendJoined(r, i);
      sendRoom(r);
      if (r.game) {
        armTimer(r);
        socket.emit('state', viewWithTimer(r, i));
        socket.emit('snap', snapFor(r));
      }
    };
    const mySeat = () => (room && !room.closed ? room.seats.findIndex(s => s.socketId === socket.id) : -1);

    socket.on('create', d => {
      const name = Rooms.cleanName(d && d.name);
      if (!name) return err('กรุณาใส่ชื่อ');
      if (mySeat() >= 0) return err('คุณอยู่ในห้องแล้ว');
      const r = Rooms.createRoom(d && d.theme);
      attach(r, Rooms.addSeat(r, name, null));
    });

    socket.on('join', d => {
      d = d || {};
      const code = String(d.code || '').toUpperCase();
      let r = Rooms.getRoom(code);
      // Server restarted: rebuild the room from a sealed snapshot. While nobody has moved since,
      // a newer snapshot from another player may replace it.
      if (d.snap && d.token && (!r || r.restored)) {
        const p = openSnap(d.snap, code);
        if (p && p.seats.some(s => s.token === d.token)) {
          if (!r) r = Rooms.restoreRoom(p);
          else if ((p.game.seq || 0) > (r.game.seq || 0)) { r.game = p.game; r.timerKey = undefined; commit(r); }
        }
      }
      if (!r) return err('ไม่พบห้องนี้');
      if (mySeat() >= 0) return err('คุณอยู่ในห้องแล้ว');
      const byToken = r.seats.findIndex(s => d.token && s.token === d.token);
      if (byToken >= 0) {
        const old = r.seats[byToken].socketId;
        if (old && old !== socket.id) io.to(old).emit('err', { msg: 'คุณเปิดเกมจากที่อื่นแล้ว', kicked: true });
        return attach(r, byToken);
      }
      const name = Rooms.cleanName(d.name);
      if (!name) return err('กรุณาใส่ชื่อ');
      if (r.game) return err('เกมเริ่มไปแล้ว เลือกเข้าแทนที่นั่งของคนที่หลุดได้', { offlineSeats: Rooms.offlineSeats(r), room: Rooms.publicRoom(r) });
      if (r.seats.length >= Rooms.MAX_SEATS) return err('ห้องเต็มแล้ว (สูงสุด 5 คน)');
      attach(r, Rooms.addSeat(r, name, null));
    });

    socket.on('claimSeat', d => {
      d = d || {};
      const r = Rooms.getRoom(d.code);
      if (!r || !r.game) return err('ไม่พบห้องนี้');
      if (mySeat() >= 0) return err('คุณอยู่ในห้องแล้ว');
      const i = d.seat;
      if (!Number.isInteger(i) || !r.seats[i] || r.seats[i].socketId) return err('ที่นั่งนี้ไม่ว่าง');
      r.seats[i].token = Rooms.token();
      attach(r, i);
    });

    const startGame = () => {
      const seat = mySeat();
      if (seat < 0) return err('ยังไม่ได้เข้าห้อง');
      if (seat !== room.hostSeat) return err('เฉพาะหัวห้องเท่านั้นที่เริ่มเกมได้');
      if (room.game && room.game.phase !== 'over') return err('เกมเริ่มไปแล้ว');
      if (room.seats.filter(s => s.socketId).length < 2) return err('ต้องมีผู้เล่นออนไลน์อย่างน้อย 2 คน');
      if (!room.game) room.seats = room.seats.filter(s => s.socketId); // drop people who left the lobby
      Rooms.startGame(room);
      room.seats.forEach((s, i) => sendJoined(room, i));
      room.timerKey = undefined;
      sendRoom(room);
      commit(room);
    };
    socket.on('start', startGame);
    socket.on('restart', startGame);

    socket.on('action', a => {
      const seat = mySeat();
      if (seat < 0 || !room.game) return err('ยังไม่ได้เริ่มเกม');
      const res = R.applyAction(room.game, seat, a);
      if (res.error) return err(res.error);
      room.game = res.state;
      room.restored = false;
      room.lastActive = Date.now();
      commit(room);
    });

    socket.on('skipTurn', () => {
      const seat = mySeat();
      if (seat < 0 || !room.game) return err('ยังไม่ได้เริ่มเกม');
      if (seat !== room.hostSeat) return err('เฉพาะหัวห้องเท่านั้นที่ข้ามตาได้');
      const t = room.game.turn;
      if (room.seats[t].socketId) return err('ผู้เล่นคนนี้ยังออนไลน์อยู่');
      const res = R.applyAction(room.game, t, { type: 'skip' });
      if (res.error) return err(res.error);
      room.game = res.state;
      room.lastActive = Date.now();
      commit(room);
    });

    socket.on('leaveRoom', () => {
      const seat = mySeat();
      if (seat < 0) return err('ยังไม่ได้เข้าห้อง');
      if (room.game) return err('ออกจากห้องได้เฉพาะตอนรอเริ่มเกม');
      const r = room;
      room = null;
      socket.emit('left');
      if (Rooms.removeSeat(r, seat)) {
        r.seats.forEach((s, i) => sendJoined(r, i));
        sendRoom(r);
      }
    });

    socket.on('deleteRoom', () => {
      const seat = mySeat();
      if (seat < 0) return err('ยังไม่ได้เข้าห้อง');
      if (seat !== room.hostSeat) return err('เฉพาะหัวห้องเท่านั้นที่ลบห้องได้');
      if (room.game) return err('ลบห้องได้เฉพาะตอนรอเริ่มเกม');
      const r = room;
      room = null;
      for (const s of r.seats) if (s.socketId && s.socketId !== socket.id) io.to(s.socketId).emit('roomClosed', { msg: 'หัวห้องลบห้องนี้แล้ว' });
      r.closed = true; // other sockets still reference it; mySeat() ignores closed rooms
      Rooms.rooms.delete(r.code);
      socket.emit('left');
    });

    socket.on('ping-state', () => {
      const seat = mySeat();
      if (seat >= 0 && room.game) socket.emit('state', viewWithTimer(room, seat));
    });

    socket.on('disconnect', () => {
      const seat = mySeat();
      if (seat < 0) return;
      room.seats[seat].socketId = null;
      room.lastActive = Date.now();
      Rooms.fixHost(room);
      sendRoom(room);
    });
  });

  const sweeper = setInterval(() => Rooms.sweep(), 5 * 60 * 1000);
  sweeper.unref();

  return new Promise(resolve => {
    server.listen(port, () => {
      resolve({
        port: server.address().port,
        io,
        close: () => {
          clearInterval(sweeper);
          for (const r of Rooms.rooms.values()) clearTimeout(r.timer);
          io.close(); server.close();
        },
      });
    });
  });
}

if (require.main === module) {
  start().then(s => console.log(`เพชรย้อม พร้อมแล้วที่ http://localhost:${s.port}`));
}

module.exports = { start };
