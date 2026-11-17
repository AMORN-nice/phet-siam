// Room bookkeeping: seats, host, tokens. No socket code here.
const crypto = require('crypto');
const R = require('./rules');

const MAX_SEATS = 5;
const IDLE_MS = 30 * 60 * 1000;
const rooms = new Map();

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do code = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join('');
  while (rooms.has(code));
  return code;
}

const token = () => crypto.randomBytes(16).toString('hex');

function cleanName(n) {
  if (typeof n !== 'string') return null;
  const s = n.trim().slice(0, 16);
  return s || null;
}

function createRoom() {
  const room = { code: newCode(), seats: [], hostSeat: 0, game: null, lastActive: Date.now() };
  rooms.set(room.code, room);
  return room;
}

const getRoom = code => rooms.get(String(code || '').toUpperCase());

function addSeat(room, name, socketId) {
  const seat = { name, token: token(), socketId };
  room.seats.push(seat);
  return room.seats.length - 1;
}

const offlineSeats = room => room.seats.map((s, i) => (s.socketId ? -1 : i)).filter(i => i >= 0);

function fixHost(room) {
  if (room.seats[room.hostSeat] && room.seats[room.hostSeat].socketId) return;
  const n = room.seats.length;
  for (let k = 1; k <= n; k++) {
    const i = (room.hostSeat + k) % n;
    if (room.seats[i].socketId) { room.hostSeat = i; return; }
  }
}

function publicRoom(room) {
  return {
    code: room.code,
    hostSeat: room.hostSeat,
    started: !!room.game,
    players: room.seats.map(s => ({ name: s.name, online: !!s.socketId })),
  };
}

function startGame(room, rng = Math.random) {
  // Random seat order; seat index == player index from here on.
  const hostToken = room.seats[room.hostSeat].token;
  for (let i = room.seats.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [room.seats[i], room.seats[j]] = [room.seats[j], room.seats[i]];
  }
  room.hostSeat = room.seats.findIndex(s => s.token === hostToken);
  room.game = R.createGame(room.seats.map((s, i) => ({ id: String(i), name: s.name })), rng);
}

function sweep(now = Date.now()) {
  for (const [code, room] of rooms) {
    if (!room.seats.some(s => s.socketId) && now - room.lastActive > IDLE_MS) rooms.delete(code);
  }
}

module.exports = { rooms, MAX_SEATS, createRoom, getRoom, addSeat, cleanName, offlineSeats, fixHost, publicRoom, startGame, sweep, token };
