// Room bookkeeping: seats, host, tokens. No socket code here.
const crypto = require('crypto');
const R = require('./rules');

const MAX_SEATS = 5;
const THEMES = ['siam', 'fantasy', 'scifi'];
const cleanTheme = t => (THEMES.includes(t) ? t : 'siam');
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

function createRoom(theme) {
  const room = { code: newCode(), theme: cleanTheme(theme), seats: [], hostSeat: 0, game: null, lastActive: Date.now() };
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
    theme: room.theme,
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

// Removes a seat (lobby only). Returns false if the room is now empty and was deleted.
function removeSeat(room, i) {
  room.seats.splice(i, 1);
  if (!room.seats.length) { rooms.delete(room.code); return false; }
  if (i < room.hostSeat) room.hostSeat--;
  else if (i === room.hostSeat) room.hostSeat = Math.min(i, room.seats.length - 1);
  fixHost(room);
  return true;
}

// Rebuild a room from an opened snapshot (after a server restart). Nobody is online yet.
function restoreRoom(p) {
  const room = {
    code: p.code,
    theme: cleanTheme(p.theme),
    seats: p.seats.map(s => ({ name: s.name, token: s.token, socketId: null })),
    hostSeat: Math.max(0, p.seats.findIndex(s => s.token === p.hostToken)),
    game: p.game,
    restored: true,
    lastActive: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function sweep(now = Date.now()) {
  for (const [code, room] of rooms) {
    if (!room.seats.some(s => s.socketId) && now - room.lastActive > IDLE_MS) rooms.delete(code);
  }
}

module.exports = { rooms, MAX_SEATS, THEMES, createRoom, getRoom, restoreRoom, removeSeat, addSeat, cleanName, offlineSeats, fixHost, publicRoom, startGame, sweep, token };
