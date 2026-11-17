// HTTP + Socket.io server. The server is the only authority on game state.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const R = require('./rules');
const Rooms = require('./rooms');

function start(port = process.env.PORT || 3000) {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('/health', (_, res) => res.send('ok'));
  const server = http.createServer(app);
  const io = new Server(server);

  const sendRoom = room => {
    for (const s of room.seats) if (s.socketId) io.to(s.socketId).emit('room', Rooms.publicRoom(room));
  };
  const sendState = room => {
    if (!room.game) return;
    room.seats.forEach((s, i) => { if (s.socketId) io.to(s.socketId).emit('state', R.viewFor(room.game, i)); });
  };
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
      if (r.game) socket.emit('state', R.viewFor(r.game, i));
    };
    const mySeat = () => (room ? room.seats.findIndex(s => s.socketId === socket.id) : -1);

    socket.on('create', d => {
      const name = Rooms.cleanName(d && d.name);
      if (!name) return err('กรุณาใส่ชื่อ');
      if (mySeat() >= 0) return err('คุณอยู่ในห้องแล้ว');
      const r = Rooms.createRoom();
      attach(r, Rooms.addSeat(r, name, null));
    });

    socket.on('join', d => {
      d = d || {};
      const r = Rooms.getRoom(d.code);
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
      sendRoom(room);
      sendState(room);
    };
    socket.on('start', startGame);
    socket.on('restart', startGame);

    socket.on('action', a => {
      const seat = mySeat();
      if (seat < 0 || !room.game) return err('ยังไม่ได้เริ่มเกม');
      const res = R.applyAction(room.game, seat, a);
      if (res.error) return err(res.error);
      room.game = res.state;
      room.lastActive = Date.now();
      sendState(room);
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
      sendState(room);
    });

    socket.on('ping-state', () => {
      const seat = mySeat();
      if (seat >= 0 && room.game) socket.emit('state', R.viewFor(room.game, seat));
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
        close: () => { clearInterval(sweeper); io.close(); server.close(); },
      });
    });
  });
}

if (require.main === module) {
  start().then(s => console.log(`เพชรสยาม พร้อมแล้วที่ http://localhost:${s.port}`));
}

module.exports = { start };
