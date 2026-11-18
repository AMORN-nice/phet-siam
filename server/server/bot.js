// Solo-mode bot: picks one legal action from what its own seat can see (no peeking at decks
// or other players' face-down reserves). One level, aims to be a fair opponent:
// buys the best card it can, otherwise works toward one target card, reserving when it helps.
const R = require('./rules');
const { COLORS } = require('./data');

const KINDS = [...COLORS, 'gold'];
const P = { pts: 1, engine: 1.2, late: 0.4, exp: 1.5, noble: 9, resPts: 3, resShort: 2 }; // tuned by self-play
const total = g => KINDS.reduce((a, k) => a + g[k], 0);

// Gems still missing to buy a card (after bonuses and gold).
function missing(p, card) {
  const need = {};
  let short = 0;
  for (const c of COLORS) {
    need[c] = Math.max(0, card.cost[c] - p.bonuses[c] - p.gems[c]);
    short += need[c];
  }
  short = Math.max(0, short - p.gems.gold);
  return { need, short };
}

// How much a card's bonus color helps toward the nobles still on the table.
function nobleHelp(v, p, color) {
  let s = 0;
  for (const n of v.nobles) {
    const gap = COLORS.reduce((a, c) => a + Math.max(0, n.req[c] - p.bonuses[c]), 0);
    if (n.req[color] > p.bonuses[color]) s += P.noble / Math.max(1, gap);
  }
  return s;
}

function cardValue(v, p, card) {
  const cards = p.cards.length;
  // Early on, cheap bonus cards matter; later, points matter more.
  const engine = cards < 8 ? P.engine : P.late;
  return card.points * P.pts + nobleHelp(v, p, card.color) + engine;
}

function candidates(v, p) {
  const list = [];
  v.board.forEach((row, t) => row.forEach((c, slot) => { if (c) list.push({ c, where: { source: 'board', tier: t + 1, slot } }); }));
  p.reserved.forEach((c, index) => { if (!c.hidden) list.push({ c, where: { source: 'reserved', index } }); });
  return list;
}

function chooseTarget(v, p) {
  let best = null;
  for (const x of candidates(v, p)) {
    const { short } = missing(p, x.c);
    const score = cardValue(v, p, x.c) / Math.pow(short + 1, P.exp);
    if (!best || score > best.score) best = { ...x, score, short };
  }
  return best;
}

function pickGems(v, p, target) {
  const avail = COLORS.filter(c => v.bank[c] > 0);
  const want = target ? missing(p, target.c).need : {};
  // Rank colors: what the target needs first, then what the board generally costs.
  const demand = {};
  for (const c of COLORS) demand[c] = 0;
  for (const { c: card } of candidates(v, p)) for (const c of COLORS) demand[c] += Math.max(0, card.cost[c] - p.bonuses[c]);
  const rank = c => (want[c] || 0) * 10 + demand[c] * 0.1 - p.gems[c] * 0.5;
  const two = COLORS.find(c => (want[c] || 0) >= 2 && v.bank[c] >= 4);
  const needColors = COLORS.filter(c => (want[c] || 0) > 0 && v.bank[c] > 0);
  if (two && needColors.length <= 1) return { type: 'take2', color: two };
  const colors = avail.sort((a, b) => rank(b) - rank(a)).slice(0, 3);
  return { type: 'take3', colors };
}

function chooseDiscard(v, p) {
  const target = chooseTarget(v, p);
  const want = target ? missing(p, target.c).need : {};
  const left = { ...p.gems };
  const out = {};
  for (let n = v.discardCount; n > 0; n--) {
    // Give back what the target needs least; keep gold.
    const k = KINDS.filter(x => left[x] > 0)
      .sort((a, b) => (a === 'gold') - (b === 'gold') || (want[a] || 0) - (want[b] || 0) || left[b] - left[a])[0];
    left[k]--; out[k] = (out[k] || 0) + 1;
  }
  return { type: 'discard', gems: out };
}

function choose(v) {
  const p = v.players[v.you];
  if (v.phase === 'discard') return chooseDiscard(v, p);
  if (v.phase === 'noble') return { type: 'chooseNoble', nobleId: v.nobleChoices[0].id };

  // 1. Buy the best affordable card, unless it's a pointless card late in the game.
  let buy = null;
  for (const x of candidates(v, p)) {
    if (!R.payment(p, x.c)) continue;
    const val = cardValue(v, p, x.c) + (x.where.source === 'reserved' ? 0.5 : 0);
    if (!buy || val > buy.val) buy = { ...x, val };
  }
  if (buy && (buy.c.points > 0 || p.cards.length < 10 || total(p.gems) >= 8)) return { type: 'buy', ...buy.where };

  const target = chooseTarget(v, p);
  const gemsHeld = total(p.gems);
  const avail = COLORS.filter(c => v.bank[c] > 0).length;

  // 2. Reserve a strong card that's close, or when taking gems would be wasted.
  if (p.reserved.length < 3 && target && target.where.source === 'board') {
    const closeAndGood = target.c.points >= P.resPts && target.short <= P.resShort && v.bank.gold > 0;
    const stuck = gemsHeld >= 9 || avail === 0;
    if (closeAndGood || stuck) return { type: 'reserve', tier: target.where.tier, slot: target.where.slot };
  }

  // 3. Take gems toward the target.
  if (avail > 0 || gemsHeld < 10) return pickGems(v, p, target);
  return { type: 'take3', colors: [] };
}

// Returns a legal action for seat idx in the full game state, or a skip if nothing works.
function botAction(state, idx) {
  const v = R.viewFor(state, idx);
  const tries = [choose(v)];
  const p = v.players[idx];
  // Fallbacks, in case the main pick is illegal in some corner case.
  const avail = COLORS.filter(c => v.bank[c] > 0);
  tries.push({ type: 'take3', colors: avail.slice(0, 3) });
  const two = COLORS.find(c => v.bank[c] >= 4);
  if (two) tries.push({ type: 'take2', color: two });
  for (const x of candidates(v, p)) tries.push({ type: 'buy', ...x.where });
  if (p.reserved.length < 3) for (let t = 1; t <= 3; t++) tries.push({ type: 'reserve', tier: t, slot: null });
  for (const a of tries) if (!R.applyAction(state, idx, a).error) return a;
  return { type: 'skip' };
}

module.exports = { botAction, choose, P };
