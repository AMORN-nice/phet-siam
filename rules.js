// Game rules engine: pure functions. applyAction never mutates its input.
const { COLORS, CARDS, NOBLES } = require('./data');

const GEM_NAMES = { white: 'เพชร', blue: 'ไพลิน', green: 'มรกต', red: 'ทับทิม', black: 'นิล', gold: 'ทอง' };
const SETUP = { 2: [4, 3], 3: [5, 4], 4: [7, 5], 5: [7, 6] }; // players → [gems per color, nobles]
const WIN_POINTS = 15, MAX_GEMS = 10, MAX_RESERVED = 3, GOLD = 5;

const emptyGems = () => ({ white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 });
const clone = o => JSON.parse(JSON.stringify(o));
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createGame(players, rng = Math.random) {
  const setup = SETUP[players.length];
  if (!setup) throw new Error('ต้องมีผู้เล่น 2-5 คน');
  const [gemCount, nobleCount] = setup;
  const bank = emptyGems();
  for (const c of COLORS) bank[c] = gemCount;
  bank.gold = GOLD;
  const decks = [1, 2, 3].map(t => shuffle(clone(CARDS.filter(c => c.tier === t)), rng));
  const board = decks.map(d => d.splice(0, 4));
  return {
    phase: 'play', turn: 0, round: 1, finalRound: false,
    bank, decks, board,
    nobles: shuffle(clone(NOBLES), rng).slice(0, nobleCount),
    players: players.map(p => ({ id: p.id, name: p.name, gems: emptyGems(), cards: [], reserved: [], nobles: [] })),
    discardCount: 0, nobleChoices: [], winners: [], log: [], seq: 0, events: [],
  };
}

function bonuses(player) {
  const b = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
  for (const c of player.cards) b[c.color]++;
  return b;
}

const points = p => p.cards.reduce((a, c) => a + c.points, 0) + p.nobles.reduce((a, n) => a + n.points, 0);

// Returns the gems to pay for a card, or null if unaffordable.
function payment(player, cardObj) {
  const bonus = bonuses(player);
  const pay = emptyGems();
  for (const c of COLORS) {
    const need = Math.max(0, cardObj.cost[c] - bonus[c]);
    pay[c] = Math.min(need, player.gems[c]);
    pay.gold += need - pay[c];
  }
  return pay.gold <= player.gems.gold ? pay : null;
}

const isColor = c => COLORS.includes(c);
const validTier = t => Number.isInteger(t) && t >= 1 && t <= 3;
const validSlot = s => Number.isInteger(s) && s >= 0 && s <= 3;

// Events tell clients what just happened (for sounds); the acting player is always s.turn here.
function ev(s, type) { s.events.push({ type, player: s.turn }); }

function log(s, text) {
  s.log.push(text);
  if (s.log.length > 40) s.log.shift();
}

function applyAction(state, playerIdx, action) {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return { error: 'คำสั่งไม่ถูกต้อง' };
  if (state.phase === 'over') return { error: 'เกมจบแล้ว' };
  if (playerIdx !== state.turn) return { error: 'ยังไม่ถึงตาคุณ' };
  const s = clone(state);
  const p = s.players[playerIdx];
  s.seq = (s.seq || 0) + 1;
  s.events = [];

  if (action.type === 'skip') return { state: skip(s, p) };

  if (s.phase === 'discard') {
    if (action.type !== 'discard') return { error: 'ต้องคืนอัญมณีให้เหลือ 10 เม็ดก่อน' };
    return discard(s, p, action.gems);
  }
  if (s.phase === 'noble') {
    if (action.type !== 'chooseNoble') return { error: 'ต้องเลือกขุนนางก่อน' };
    const n = s.nobleChoices.find(x => x.id === action.nobleId);
    if (!n) return { error: 'เลือกขุนนางคนนี้ไม่ได้' };
    giveNoble(s, p, n);
    return { state: endTurn(s) };
  }

  let err;
  switch (action.type) {
    case 'take3': err = take3(s, p, action.colors); break;
    case 'take2': err = take2(s, p, action.color); break;
    case 'reserve': err = reserve(s, p, action.tier, action.slot); break;
    case 'buy': err = buy(s, p, action); break;
    default: err = 'คำสั่งไม่ถูกต้อง';
  }
  if (err) return { error: err };
  return { state: afterAction(s, p) };
}

function take3(s, p, colors) {
  if (!Array.isArray(colors) || colors.length > 3 || !colors.every(isColor)) return 'เลือกสีไม่ถูกต้อง';
  if (new Set(colors).size !== colors.length) return 'ต้องเลือกสีไม่ซ้ำกัน';
  if (colors.some(c => s.bank[c] < 1)) return 'สีนั้นหมดแล้ว';
  const available = COLORS.filter(c => s.bank[c] > 0).length;
  if (colors.length !== Math.min(3, available)) return `ต้องหยิบ ${Math.min(3, available)} สี`;
  for (const c of colors) { s.bank[c]--; p.gems[c]++; }
  ev(s, 'take');
  log(s, `${p.name} หยิบ ${colors.map(c => GEM_NAMES[c]).join(' ') || 'ไม่ได้อะไร'}`);
}

function take2(s, p, color) {
  if (!isColor(color)) return 'เลือกสีไม่ถูกต้อง';
  if (s.bank[color] < 4) return 'หยิบ 2 เม็ดได้เมื่อกองมีอย่างน้อย 4 เม็ด';
  s.bank[color] -= 2; p.gems[color] += 2;
  ev(s, 'take');
  log(s, `${p.name} หยิบ ${GEM_NAMES[color]} 2 เม็ด`);
}

function reserve(s, p, tier, slot) {
  if (!validTier(tier) || !(slot === null || validSlot(slot))) return 'เลือกการ์ดไม่ถูกต้อง';
  if (p.reserved.length >= MAX_RESERVED) return 'จองได้สูงสุด 3 ใบ';
  let c;
  if (slot === null) {
    if (!s.decks[tier - 1].length) return 'กองนี้หมดแล้ว';
    c = s.decks[tier - 1].shift();
    c.fromDeck = true;
  } else {
    c = s.board[tier - 1][slot];
    if (!c) return 'ช่องนี้ไม่มีการ์ด';
    c.fromDeck = false;
    s.board[tier - 1][slot] = s.decks[tier - 1].shift() || null;
  }
  p.reserved.push(c);
  ev(s, 'reserve');
  if (s.bank.gold > 0) { s.bank.gold--; p.gems.gold++; }
  log(s, `${p.name} จองการ์ดระดับ ${tier}`);
}

function buy(s, p, a) {
  let c, remove;
  if (a.source === 'board') {
    if (!validTier(a.tier) || !validSlot(a.slot)) return 'เลือกการ์ดไม่ถูกต้อง';
    c = s.board[a.tier - 1][a.slot];
    remove = () => { s.board[a.tier - 1][a.slot] = s.decks[a.tier - 1].shift() || null; };
  } else if (a.source === 'reserved') {
    if (!Number.isInteger(a.index)) return 'เลือกการ์ดไม่ถูกต้อง';
    c = p.reserved[a.index];
    remove = () => { p.reserved.splice(a.index, 1); };
  } else return 'เลือกการ์ดไม่ถูกต้อง';
  if (!c) return 'ไม่มีการ์ดใบนี้';
  const pay = payment(p, c);
  if (!pay) return 'อัญมณีไม่พอ';
  for (const k of Object.keys(pay)) { p.gems[k] -= pay[k]; s.bank[k] += pay[k]; }
  remove();
  delete c.fromDeck;
  p.cards.push(c);
  ev(s, 'buy');
  log(s, `${p.name} ซื้อการ์ด${GEM_NAMES[c.color]} ระดับ ${c.tier}${c.points ? ` (+${c.points} แต้ม)` : ''}`);
}

function afterAction(s, p) {
  const total = sum(p.gems);
  if (total > MAX_GEMS) {
    s.phase = 'discard';
    s.discardCount = total - MAX_GEMS;
    return s;
  }
  return checkNobles(s, p);
}

function discard(s, p, gems) {
  if (!gems || typeof gems !== 'object') return { error: 'คำสั่งไม่ถูกต้อง' };
  const KINDS = [...COLORS, 'gold'];
  let n = 0;
  for (const [k, v] of Object.entries(gems)) {
    if (!KINDS.includes(k) || !Number.isInteger(v) || v < 0 || v > p.gems[k]) return { error: 'คืนอัญมณีไม่ถูกต้อง' };
    n += v;
  }
  if (Object.getPrototypeOf(gems) !== Object.prototype) return { error: 'คืนอัญมณีไม่ถูกต้อง' };
  if (n !== s.discardCount) return { error: `ต้องคืน ${s.discardCount} เม็ด` };
  for (const [k, v] of Object.entries(gems)) { p.gems[k] -= v; s.bank[k] += v; }
  s.discardCount = 0;
  s.phase = 'play';
  ev(s, 'discard');
  log(s, `${p.name} คืนอัญมณี ${n} เม็ด`);
  return { state: checkNobles(s, p) };
}

function checkNobles(s, p) {
  const b = bonuses(p);
  const eligible = s.nobles.filter(n => COLORS.every(c => b[c] >= n.req[c]));
  if (eligible.length === 1) giveNoble(s, p, eligible[0]);
  else if (eligible.length > 1) {
    s.phase = 'noble';
    s.nobleChoices = eligible;
    return s;
  }
  return endTurn(s);
}

function giveNoble(s, p, n) {
  s.nobles = s.nobles.filter(x => x.id !== n.id);
  p.nobles.push(n);
  s.nobleChoices = [];
  ev(s, 'noble');
  log(s, `ขุนนางมาเยือน ${p.name} (+3 แต้ม)`);
}

function skip(s, p) {
  // Auto-resolve whatever the player was in the middle of, then pass.
  if (s.phase === 'discard') {
    let n = s.discardCount;
    while (n > 0) {
      const k = [...COLORS, 'gold'].sort((a, b) => p.gems[b] - p.gems[a])[0];
      p.gems[k]--; s.bank[k]++; n--;
    }
    s.discardCount = 0;
  }
  if (s.phase === 'noble') giveNoble(s, p, s.nobleChoices[0]);
  s.phase = 'play';
  ev(s, 'skip');
  log(s, `ข้ามตา ${p.name}`);
  return endTurn(s);
}

function endTurn(s) {
  const p = s.players[s.turn];
  s.phase = 'play';
  if (points(p) >= WIN_POINTS && !s.finalRound) {
    s.finalRound = true;
    log(s, `${p.name} ถึง ${WIN_POINTS} แต้ม! เล่นต่อให้ครบรอบนี้`);
  }
  s.turn = (s.turn + 1) % s.players.length;
  if (s.turn === 0) {
    if (s.finalRound) return finish(s);
    s.round++;
  }
  return s;
}

function finish(s) {
  s.phase = 'over';
  s.events.push({ type: 'over', player: null });
  const score = s.players.map(p => [points(p), -p.cards.length]);
  const best = score.reduce((m, x) => (x[0] > m[0] || (x[0] === m[0] && x[1] > m[1]) ? x : m));
  s.winners = score.map((x, i) => (x[0] === best[0] && x[1] === best[1] ? i : -1)).filter(i => i >= 0);
  log(s, `จบเกม! ผู้ชนะ: ${s.winners.map(i => s.players[i].name).join(', ')}`);
  return s;
}

// What one seat (or a spectator, viewerIdx = null) is allowed to see.
function viewFor(state, viewerIdx) {
  const { decks, ...rest } = clone(state);
  rest.deckCounts = decks.map(d => d.length);
  rest.you = viewerIdx;
  rest.players = rest.players.map((p, i) => ({
    ...p,
    points: points(p),
    bonuses: bonuses(p),
    reserved: p.reserved.map(c => (i !== viewerIdx && c.fromDeck ? { hidden: true, tier: c.tier } : c)),
  }));
  return rest;
}

module.exports = { createGame, applyAction, viewFor, bonuses, points, payment, GEM_NAMES, SETUP };
