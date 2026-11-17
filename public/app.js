/* เพชรสยาม — browser client. Renders the view the server sends; sends intents. */
(() => {
  const COLORS = ['white', 'blue', 'green', 'red', 'black'];
  const GEM = { white: 'เพชร', blue: 'ไพลิน', green: 'มรกต', red: 'ทับทิม', black: 'นิล', gold: 'ทอง' };
  // Each theme: its art folder, display name, card and noble names. Gem names stay the same everywhere.
  const THEMES = {
    siam: {
      name: 'สยามโบราณ',
      cards: {
        1: { white: 'ช่างเจียระไน', blue: 'โรงย้อมคราม', green: 'นาข้าว', red: 'ตลาดน้ำ', black: 'โรงตีเหล็ก' },
        2: { white: 'ท่าเรือสินค้า', blue: 'เรือพระที่นั่ง', green: 'โรงทอผ้าไหม', red: 'โรงเครื่องเขิน', black: 'คาราวานช้าง' },
        3: { white: 'ขบวนช้างเผือก', blue: 'พระราชวัง', green: 'วัดหลวง', red: 'ท้องพระโรง', black: 'ปรางค์ราตรี' },
      },
      nobles: ['', 'พระเจ้าแผ่นดิน', 'คุณหญิงมรกต', 'เจ้าพระยามหาเสนา', 'พระราชธิดา', 'พระยาพิชัย',
        'พระราชโอรส', 'พระมเหสี', 'ขุนคลัง', 'นางสนองพระโอษฐ์', 'โหรหลวง'],
    },
    fantasy: {
      name: 'แฟนตาซียุคกลาง',
      cards: {
        1: { white: 'เหมืองคนแคระ', blue: 'หมู่บ้านชาวประมง', green: 'สวนสมุนไพรเอลฟ์', red: 'ตลาดกลางเมือง', black: 'โรงตีเหล็กคนแคระ' },
        2: { white: 'กองคาราวานภูเขาหิมะ', blue: 'ท่าเรือใบ', green: 'ตลาดบนต้นไม้', red: 'โรงเตี๊ยมสมาคม', black: 'สมาคมโจร' },
        3: { white: 'มหาวิหารหินอ่อน', blue: 'หอคอยพ่อมด', green: 'นครเอลฟ์', red: 'ท้องพระโรงปราสาท', black: 'ป้อมปราการนิล' },
      },
      nobles: ['', 'ราชา', 'ราชินี', 'จอมเวทย์', 'อัศวินผู้บัญชาการ', 'สตรีเอลฟ์',
        'เจ้าคนแคระ', 'เจ้าหญิง', 'ท่านดยุก', 'แม่มดหลวง', 'อัครมหาเสนาบดี'],
    },
    scifi: {
      name: 'ไซไฟขุดแร่อวกาศ',
      cards: {
        1: { white: 'เหมืองดาวเคราะห์น้อย', blue: 'โรงกลั่นน้ำแข็ง', green: 'โดมไฮโดรโปนิกส์', red: 'แท่นขุดดาวอังคาร', black: 'อุโมงค์โดรน' },
        2: { white: 'ยานขนส่งสินค้า', blue: 'สถานีโคจร', green: 'ฐานวิจัยป่าต่างดาว', red: 'โรงหลอมพลาสมา', black: 'ยานลักลอบในเนบิวลา' },
        3: { white: 'ยานธงสีขาว', blue: 'ลิฟต์อวกาศ', green: 'นครดาวสีเขียว', red: 'สภาดาราจักร', black: 'สถานีหลุมดำ' },
      },
      nobles: ['', 'พลเรือเอก', 'จักรพรรดินี', 'แอนดรอยด์', 'ทูตต่างดาว', 'นายพลไซบอร์ก',
        'นักวิทยาศาสตร์', 'นักบินฝีมือเยี่ยม', 'บารอนเนสพ่อค้า', 'หุ่นยนต์ผู้ช่วย', 'ผู้นำกาแล็กซี'],
    },
  };
  let theme = 'siam';
  const T = () => THEMES[theme] || THEMES.siam;
  const A = () => `assets/${theme}`;
  function setTheme(t) {
    theme = THEMES[t] ? t : 'siam';
    document.body.dataset.theme = theme;
  }

  const $ = id => document.getElementById(id);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
    return el;
  };
  const gemImg = (c, size) => h('img', { src: `${A()}/gem-${c}.png`, alt: GEM[c], width: size, height: size });

  // ---------- state ----------
  const socket = io({ transports: ['websocket', 'polling'] });
  let me = { code: null, token: null, seat: null };
  let room = null, view = null, picks = [];
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  // Sealed snapshot of the game (unreadable here) — lets a restarted server restore the room.
  const snaps = {};
  const getSnap = code => {
    if (snaps[code]) return snaps[code];
    try { return JSON.parse(store.get('ps-snap-' + code)) || undefined; } catch { return undefined; }
  };
  const params = new URLSearchParams(location.search);
  $('nameInput').value = store.get('ps-name') || '';
  if (params.get('room')) $('codeInput').value = params.get('room').toUpperCase();

  function show(screen) {
    for (const s of ['home', 'lobby', 'game']) $(s).hidden = s !== screen;
  }
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function errHere(msg) {
    if (!$('home').hidden) $('homeErr').textContent = msg;
    else if (!$('lobby').hidden) $('lobbyErr').textContent = msg;
    else toast(msg);
  }

  // ---------- home ----------
  const myName = () => {
    const n = $('nameInput').value.trim();
    if (!n) { $('homeErr').textContent = 'ใส่ชื่อก่อนนะ'; $('nameInput').focus(); return null; }
    store.set('ps-name', n);
    return n;
  };
  const pickedTheme = () => { const r = document.querySelector('input[name="theme"]:checked'); return r ? r.value : 'siam'; };
  for (const r of document.querySelectorAll('input[name="theme"]')) r.addEventListener('change', () => setTheme(pickedTheme()));
  setTheme(pickedTheme());
  $('createBtn').onclick = () => { const name = myName(); if (name) socket.emit('create', { name, theme: pickedTheme() }); };
  const doJoin = () => {
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 4) { $('homeErr').textContent = 'รหัสห้องมี 4 ตัวอักษร'; return; }
    const token = store.get('ps-token-' + code);
    const name = $('nameInput').value.trim();
    if (!token && !myName()) return;
    socket.emit('join', { code, name, token, snap: token ? getSnap(code) : undefined });
  };
  $('joinBtn').onclick = doJoin;
  $('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
  $('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') ($('codeInput').value ? doJoin() : $('createBtn').click()); });

  // Auto-rejoin when opened from a room link we already hold a seat in.
  socket.on('connect', () => {
    const code = me.code || (params.get('room') || '').toUpperCase();
    const token = code && store.get('ps-token-' + code);
    if (code && token) socket.emit('join', { code, token, snap: getSnap(code) });
  });

  // ---------- socket events ----------
  socket.on('joined', d => {
    me = d;
    store.set('ps-token-' + d.code, d.token);
    try {
      const url = new URL(location.href);
      url.searchParams.set('room', d.code);
      history.replaceState(null, '', url);
    } catch { /* sandboxed frame */ }
    $('homeErr').textContent = '';
    $('claimBox').hidden = true;
  });

  socket.on('snap', s => {
    if (!s || !s.code) return;
    snaps[s.code] = s;
    store.set('ps-snap-' + s.code, JSON.stringify(s));
  });

  socket.on('room', r => {
    room = r;
    setTheme(r.theme);
    if (!r.started) { view = null; lastSeq = null; renderLobby(); show('lobby'); }
    else if (view) renderGame();
  });

  let lastSeq = null, deadline = null, lastTick = null;
  // Turn countdown: redraws only the clock elements, every 250 ms.
  setInterval(() => {
    const left = deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null;
    for (const el of document.querySelectorAll('.clock')) {
      el.textContent = left == null ? '' : `${left} วิ`;
      el.classList.toggle('low', left != null && left <= 10);
    }
    if (view && view.turn === view.you && view.phase !== 'over' && left != null && left <= 5 && left > 0 && left !== lastTick) {
      lastTick = left;
      SFX.play('tick');
    }
  }, 250);
  socket.on('state', v => {
    const prevTurn = view && view.turn;
    if (lastSeq !== null && v.seq !== lastSeq) {
      const types = new Set((v.events || []).map(e => e.type));
      const order = ['over', 'noble', 'buy', 'reserve', 'discard', 'take', 'skip'];
      const main = order.find(t => types.has(t));
      if (main) SFX.play(main);
      if (main !== 'over' && v.phase !== 'over' && v.turn === v.you && prevTurn !== v.turn) setTimeout(() => SFX.play('turn'), 450);
    }
    lastSeq = v.seq;
    deadline = v.turnEndsIn != null ? Date.now() + v.turnEndsIn : null;
    view = v;
    picks = [];
    show('game');
    renderGame();
    if (v.phase !== 'over' && v.turn === v.you && prevTurn !== v.turn) flash('ถึงตาคุณแล้ว');
  });

  socket.on('err', e => {
    if (e.kicked) { show('home'); $('homeErr').textContent = e.msg; return; }
    if (e.offlineSeats) return renderClaim(e);
    SFX.play('error');
    errHere(e.msg);
  });

  socket.on('disconnect', () => toast('การเชื่อมต่อหลุด กำลังต่อใหม่…'));

  // Back to the home screen after leaving or deleting a lobby, or when the host deleted it.
  function backHome(msg) {
    if (me.code) {
      try { localStorage.removeItem('ps-token-' + me.code); localStorage.removeItem('ps-snap-' + me.code); } catch { /* ignore */ }
    }
    me = { code: null, token: null, seat: null };
    room = null; view = null;
    try {
      const url = new URL(location.href);
      url.searchParams.delete('room');
      history.replaceState(null, '', url);
    } catch { /* sandboxed frame */ }
    $('codeInput').value = '';
    $('homeErr').textContent = msg || '';
    $('lobbyErr').textContent = '';
    setTheme(pickedTheme());
    show('home');
  }
  socket.on('left', () => backHome());
  socket.on('roomClosed', d => backHome(d && d.msg));

  function renderClaim(e) {
    const box = $('claimBox');
    box.replaceChildren(h('p', { class: 'sub', text: e.msg }));
    if (!e.offlineSeats.length) box.append(h('p', { class: 'err', text: 'ตอนนี้ไม่มีที่นั่งว่าง' }));
    for (const i of e.offlineSeats) {
      box.append(h('button', { class: 'btn', onclick: () => socket.emit('claimSeat', { code: e.room.code, seat: i }) },
        `เข้าแทน ${e.room.players[i].name}`));
    }
    box.hidden = false;
  }

  // ---------- lobby ----------
  function renderLobby() {
    $('lobbyCode').textContent = room.code;
    const link = `${location.origin}${location.pathname}?room=${room.code}`;
    $('linkBox').value = link;
    $('lobbyPlayers').replaceChildren(...room.players.map((p, i) =>
      h('li', { class: p.online ? '' : 'offline' }, h('span', {}, p.name, i === me.seat ? ' (คุณ)' : ''),
        h('span', { class: 'tag' }, i === room.hostSeat ? 'หัวห้อง' : (p.online ? '' : 'หลุด')))));
    const isHost = me.seat === room.hostSeat;
    $('lobbyTheme').textContent = `ธีม: ${T().name}`;
    $('deleteBtn').hidden = !isHost;
    $('leaveBtn').hidden = isHost;
    $('startBtn').hidden = !isHost;
    $('startBtn').disabled = room.players.length < 2;
    $('lobbyWait').textContent = isHost
      ? (room.players.length < 2 ? 'รอเพื่อนอีกอย่างน้อย 1 คน' : `${room.players.length} คนพร้อมแล้ว`)
      : 'รอหัวห้องกดเริ่มเกม';
  }
  $('copyBtn').onclick = async () => {
    try { await navigator.clipboard.writeText($('linkBox').value); toast('คัดลอกลิงก์แล้ว'); }
    catch { $('linkBox').select(); }
  };
  $('startBtn').onclick = () => socket.emit('start');
  $('leaveBtn').onclick = () => socket.emit('leaveRoom');
  $('deleteBtn').onclick = () => openModal('confirm',
    h('h3', {}, 'ลบห้องนี้?'),
    h('p', {}, 'ทุกคนในห้องจะกลับไปหน้าแรก และรหัสห้องนี้จะใช้ไม่ได้อีก'),
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', onclick: () => { closeModal(); socket.emit('deleteRoom'); } }, 'ลบห้อง'),
      h('button', { class: 'btn ghost', onclick: closeModal }, 'ยกเลิก')));
  const muteLabel = () => {
    $('muteBtn').textContent = SFX.muted ? 'เสียง: ปิด' : 'เสียง: เปิด';
    $('muteBtn').setAttribute('aria-pressed', String(SFX.muted));
  };
  $('muteBtn').onclick = () => { SFX.setMuted(!SFX.muted); muteLabel(); if (!SFX.muted) SFX.play('click'); };
  muteLabel();

  // ---------- game helpers ----------
  const myTurn = () => view && view.phase === 'play' && view.turn === view.you;
  const mine = () => view.players[view.you];
  function payment(p, card) {
    const pay = { gold: 0 };
    for (const c of COLORS) {
      const need = Math.max(0, card.cost[c] - p.bonuses[c]);
      pay[c] = Math.min(need, p.gems[c]);
      pay.gold += need - pay[c];
    }
    return pay.gold <= p.gems.gold ? pay : null;
  }
  const send = a => socket.emit('action', a);
  function flash(msg) {
    const b = $('banner');
    b.textContent = msg;
    b.classList.add('show');
    clearTimeout(flash.t);
    flash.t = setTimeout(() => b.classList.remove('show'), 1800);
  }

  function cardEl(card, opts = {}) {
    if (!card) return h('div', { class: 'card empty' });
    if (card.hidden) return h('div', { class: 'card hidden-card', title: `การ์ดระดับ ${card.tier} (คว่ำ)` },
      h('img', { src: `${A()}/back-${card.tier}.png`, alt: `หลังการ์ดระดับ ${card.tier}` }));
    const name = T().cards[card.tier][card.color];
    const costs = COLORS.filter(c => card.cost[c] > 0).map(c => h('span', { class: `pip ${c}`, title: GEM[c] }, card.cost[c]));
    const el = h(opts.onclick ? 'button' : 'div', {
      class: 'card' + (opts.affordable ? ' affordable' : ''),
      title: `${name} · โบนัส${GEM[card.color]}${card.points ? ` · ${card.points} แต้ม` : ''}`,
      'aria-label': `${name} ${card.points} แต้ม โบนัส${GEM[card.color]} ราคา ${COLORS.filter(c => card.cost[c]).map(c => GEM[c] + ' ' + card.cost[c]).join(' ')}`,
      onclick: opts.onclick,
    },
    h('img', { class: 'art', src: `${A()}/card-${card.tier}-${card.color}.png`, alt: '' }),
    h('div', { class: 'cost' }, costs),
    card.points ? h('span', { class: 'pts' }, card.points) : null,
    h('img', { class: 'bonus', src: `${A()}/gem-${card.color}.png`, alt: '' }));
    return el;
  }

  function nobleEl(n, onclick) {
    return h(onclick ? 'button' : 'div', { class: 'noble', title: T().nobles[n.id], onclick },
      h('span', { class: 'pts' }, n.points),
      h('img', { src: `${A()}/noble-${n.id}.png`, alt: T().nobles[n.id] }),
      h('div', { class: 'req' }, COLORS.filter(c => n.req[c]).map(c => h('span', { class: `pip ${c}`, title: `การ์ด${GEM[c]}` }, n.req[c]))));
  }

  function chips(p) {
    const gems = [...COLORS, 'gold'].filter(c => p.gems[c]).map(c => h('span', { class: 'chip', title: GEM[c] }, gemImg(c, 18), p.gems[c]));
    const bon = COLORS.filter(c => p.bonuses[c]).map(c => h('span', { class: `chip bonus`, title: `โบนัส${GEM[c]}` }, h('span', { class: `pip ${c}` }, p.bonuses[c])));
    return { gems, bon };
  }

  // ---------- game render ----------
  function renderGame() {
    if (!view) return;
    const v = view;
    const online = i => !room || !room.players[i] || room.players[i].online;

    // Opponents
    $('opponents').replaceChildren(...v.players.map((p, i) => {
      if (i === v.you) return null;
      const { gems, bon } = chips(p);
      return h('div', { class: 'opp' + (v.turn === i && v.phase !== 'over' ? ' turn' : '') + (online(i) ? '' : ' offline') },
        h('div', { class: 'opp-head' }, h('span', {}, p.name, online(i) ? '' : ' (หลุด)'),
          v.turn === i && v.phase !== 'over' ? h('span', { class: 'clock', 'aria-label': 'เวลาที่เหลือ' }) : null,
          h('span', { class: 'score' }, p.points)),
        h('div', { class: 'chips' }, bon.length ? bon : h('span', { class: 'minor', text: 'ยังไม่มีการ์ด' })),
        h('div', { class: 'chips' }, gems),
        h('div', { class: 'minor' }, `จอง ${p.reserved.length}/3 · ขุนนาง ${p.nobles.length}`),
        p.reserved.length ? h('div', { class: 'opp-res' }, p.reserved.map(c =>
          cardEl(c, c.hidden ? {} : { onclick: () => openCard(c, null) }))) : null);
    }).filter(Boolean));

    // Nobles
    $('nobles').replaceChildren(...v.nobles.map(n => nobleEl(n)));

    // Rows: tier 3 at top
    const meP = mine();
    $('rows').replaceChildren(...[3, 2, 1].map(t => h('div', { class: 'row' },
      h('button', {
        class: 'deck', disabled: !myTurn() || !v.deckCounts[t - 1] || meP.reserved.length >= 3,
        title: `จองจากกองระดับ ${t}`, 'aria-label': `กองระดับ ${t} เหลือ ${v.deckCounts[t - 1]} ใบ`,
        onclick: () => confirmBlindReserve(t),
      }, h('img', { src: `${A()}/back-${t}.png`, alt: '' }), h('span', { class: 'count' }, v.deckCounts[t - 1])),
      v.board[t - 1].map((c, slot) => cardEl(c, {
        affordable: c && myTurn() && payment(meP, c),
        onclick: c ? () => openCard(c, { source: 'board', tier: t, slot }) : null,
      })))));

    // Bank
    renderBank();

    // Log
    $('log').replaceChildren(...v.log.slice(-14).map(t => h('li', { text: t })));
    $('log').scrollTop = 1e6;

    // Me
    renderMe();

    // Phase modals
    if (v.phase === 'discard' && v.turn === v.you) openDiscard();
    else if (v.phase === 'noble' && v.turn === v.you) openNoble();
    else if (v.phase === 'over') openResults();
    else if ($('modal').dataset.kind) closeModal();
  }

  function renderBank() {
    const v = view;
    const can = myTurn();
    $('bank').replaceChildren(...[...COLORS, 'gold'].map(c => {
      const n = picks.filter(x => x === c).length;
      return h('button', {
        class: 'gem-btn' + (n ? ' sel' : ''),
        disabled: c === 'gold' || !can || !v.bank[c],
        title: c === 'gold' ? 'ทองได้จากการจองการ์ดเท่านั้น' : `หยิบ${GEM[c]}`,
        'aria-label': `${GEM[c]} เหลือ ${v.bank[c]}`,
        onclick: () => pickGem(c),
      }, gemImg(c, 48), h('span', { class: 'n' }, v.bank[c]), n ? h('span', { class: 'picked' }, `+${n}`) : null);
    }));
    // Fixed-size take area: buttons keep their place; guidance goes in the hint line below.
    const avail = COLORS.filter(x => v.bank[x] > 0).length;
    const isTwo = picks.length === 2 && picks[0] === picks[1];
    const need = Math.min(3, avail);
    const ready = picks.length > 0 ? (isTwo || picks.length === need) : need === 0;
    $('takeBar').classList.toggle('idle', !can);
    $('takeBtn').disabled = !can || !ready;
    $('clearBtn').disabled = !can || !picks.length;
    if (!can) hint('');
    else if (!picks.length) hint(need ? `เลือกอัญมณี ${need} สีไม่ซ้ำกัน หรือกดสีเดียวกัน 2 ครั้ง` : 'กองอัญมณีหมดแล้ว');
    else if (isTwo) hint(`หยิบ${GEM[picks[0]]} 2 เม็ด`);
    else if (picks.length < need) hint(`เลือกแล้ว: ${picks.map(c => GEM[c]).join(' ')} · เลือกอีก ${need - picks.length} สี หรือกดสีเดิมซ้ำเพื่อหยิบ 2 เม็ด`);
    else hint(`หยิบ ${picks.map(c => GEM[c]).join(' ')}`);
  }
  function hint(text, warn = false) {
    $('takeHint').textContent = text;
    $('takeHint').classList.toggle('warn', warn);
  }

  function pickGem(c) {
    const v = view;
    const same = picks.filter(x => x === c).length;
    if (same === 1 && picks.length === 1) {
      if (v.bank[c] < 4) return hint('หยิบ 2 เม็ดสีเดียวได้เมื่อกองมีอย่างน้อย 4 เม็ด', true);
      picks.push(c);
    } else if (same >= 1) {
      picks = picks.filter(x => x !== c);
    } else {
      if (picks.length === 2 && picks[0] === picks[1]) picks = [];
      if (picks.length >= 3) return hint('หยิบได้สูงสุด 3 สี กด "ล้าง" ถ้าจะเลือกใหม่', true);
      picks.push(c);
    }
    renderBank();
    SFX.play('click');
  }
  $('takeBtn').onclick = () => {
    if (picks.length === 2 && picks[0] === picks[1]) send({ type: 'take2', color: picks[0] });
    else send({ type: 'take3', colors: picks });
  };
  $('clearBtn').onclick = () => { picks = []; renderBank(); };

  function renderMe() {
    const v = view, p = mine();
    const { gems, bon } = chips(p);
    const isHost = room && me.seat === room.hostSeat;
    const turnP = v.players[v.turn];
    const turnOffline = room && room.players[v.turn] && !room.players[v.turn].online;
    const status = v.phase === 'over' ? 'จบเกม'
      : v.turn === v.you ? 'ตาของคุณ' : `ตาของ ${turnP.name}${turnOffline ? ' (หลุด)' : ''}`;
    $('me').className = 'me lacquer' + (v.turn === v.you && v.phase !== 'over' ? ' turn' : '');
    $('me').replaceChildren(
      h('div', { class: 'who' }, h('span', { class: 'score' }, p.points), p.name,
        h('div', { class: 'minor' }, `รอบที่ ${v.round}${v.finalRound ? ' · รอบสุดท้าย!' : ''}`)),
      h('div', { class: 'holdings' },
        h('div', { class: 'chips' }, h('span', { class: 'row-label' }, `อัญมณี ${Object.values(p.gems).reduce((a, b) => a + b, 0)}/10`), gems),
        h('div', { class: 'chips' }, h('span', { class: 'row-label' }, 'โบนัส'), bon.length ? bon : h('span', { class: 'minor', text: '–' }),
          p.nobles.length ? h('span', { class: 'row-label' }, ` ขุนนาง ${p.nobles.length}`) : null),
        p.reserved.length ? h('div', { class: 'reserved' }, h('span', { class: 'row-label' }, 'ที่จองไว้'),
          p.reserved.map((c, i) => cardEl(c, { affordable: myTurn() && payment(p, c), onclick: () => openCard(c, { source: 'reserved', index: i }) }))) : null),
      h('div', { class: 'actions' },
        h('strong', {}, status),
        v.phase !== 'over' ? h('span', { class: 'clock big', 'aria-label': 'เวลาที่เหลือในตานี้' }) : null,
        isHost && turnOffline && v.phase !== 'over' && v.turn !== v.you
          ? h('button', { class: 'btn', onclick: () => socket.emit('skipTurn') }, `ข้ามตา ${turnP.name}`) : null));
  }

  // ---------- modals ----------
  function openModal(kind, ...content) {
    $('modal').dataset.kind = kind;
    $('modalBody').replaceChildren(...content.filter(Boolean));
    $('modal').hidden = false;
    const f = $('modalBody').querySelector('button:not([disabled])');
    if (f) f.focus();
  }
  function closeModal() { $('modal').hidden = true; delete $('modal').dataset.kind; }
  $('modal').addEventListener('click', e => {
    if (e.target === $('modal') && ['card', 'blind', 'confirm'].includes($('modal').dataset.kind)) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && ['card', 'blind', 'confirm'].includes($('modal').dataset.kind)) closeModal();
  });

  function openCard(card, where) {
    const p = mine();
    const pay = payment(p, card);
    const canAct = myTurn() && where !== null;
    const payText = pay ? [...COLORS, 'gold'].filter(c => pay[c]).map(c => `${GEM[c]} ${pay[c]}`).join(', ') || 'ฟรี (โบนัสครอบคลุมทั้งหมด)' : 'อัญมณียังไม่พอ';
    openModal('card',
      h('h3', {}, `${T().cards[card.tier][card.color]} · ระดับ ${card.tier}`),
      h('div', { class: 'bigcard' }, cardEl(card),
        h('div', {},
          h('p', {}, `ให้โบนัส${GEM[card.color]} 1 ถาวร${card.points ? ` และ ${card.points} แต้ม` : ''}`),
          where === null ? null : h('p', { class: 'pay-line' }, `ต้องจ่าย: ${payText}`))),
      h('div', { class: 'btns' },
        where === null ? null : h('button', { class: 'btn primary', disabled: !canAct || !pay, onclick: () => { send({ type: 'buy', ...where }); closeModal(); } }, 'ซื้อ'),
        where && where.source === 'board' ? h('button', {
          class: 'btn', disabled: !canAct || p.reserved.length >= 3,
          onclick: () => { send({ type: 'reserve', tier: where.tier, slot: where.slot }); closeModal(); },
        }, view.bank.gold ? 'จอง (+ทอง 1)' : 'จอง') : null,
        h('button', { class: 'btn ghost', onclick: closeModal }, 'ปิด')),
      where === null ? h('p', { class: 'minor', text: 'การ์ดที่ผู้เล่นคนอื่นจองไว้ เขาเป็นคนเดียวที่ซื้อใบนี้ได้' })
        : !canAct ? h('p', { class: 'minor', text: 'ยังไม่ถึงตาคุณ' }) : null);
  }

  function confirmBlindReserve(t) {
    openModal('blind', h('h3', {}, `จองการ์ดคว่ำจากกองระดับ ${t}?`),
      h('p', {}, `คุณจะได้การ์ดใบบนสุดโดยไม่รู้ล่วงหน้า${view.bank.gold ? ' และได้ทอง 1 เม็ด' : ''} คนอื่นจะไม่เห็นว่าเป็นใบอะไร`),
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', onclick: () => { send({ type: 'reserve', tier: t, slot: null }); closeModal(); } }, 'จอง'),
        h('button', { class: 'btn ghost', onclick: closeModal }, 'ยกเลิก')));
  }

  function openDiscard() {
    const p = mine();
    const need = view.discardCount;
    const back = Object.fromEntries([...COLORS, 'gold'].map(c => [c, 0]));
    const total = () => Object.values(back).reduce((a, b) => a + b, 0);
    const draw = () => {
      openModal('discard', h('h3', {}, `อัญมณีเกิน 10 เม็ด คืน ${need} เม็ด`),
        h('div', { class: 'discard-grid' }, [...COLORS, 'gold'].filter(c => p.gems[c]).map(c => h('div', { class: 'discard-cell' },
          gemImg(c, 36), h('span', {}, `มี ${p.gems[c]}`),
          h('div', { class: 'stepper' },
            h('button', { class: 'btn', 'aria-label': `คืน${GEM[c]}น้อยลง`, disabled: !back[c], onclick: () => { back[c]--; draw(); } }, '−'),
            h('strong', {}, back[c]),
            h('button', { class: 'btn', 'aria-label': `คืน${GEM[c]}เพิ่ม`, disabled: back[c] >= p.gems[c] || total() >= need, onclick: () => { back[c]++; draw(); } }, '+'))))),
        h('div', { class: 'btns' },
          h('button', { class: 'btn primary', disabled: total() !== need, onclick: () => send({ type: 'discard', gems: back }) }, `คืน ${total()}/${need} เม็ด`)));
    };
    draw();
  }

  function openNoble() {
    openModal('noble', h('h3', {}, 'ขุนนางหลายท่านอยากมาเยือน เลือก 1 ท่าน'),
      h('div', { class: 'noble-pick' }, view.nobleChoices.map(n => nobleEl(n, () => send({ type: 'chooseNoble', nobleId: n.id })))));
  }

  function openResults() {
    const v = view;
    const order = v.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.points - a.p.points || a.p.cards.length - b.p.cards.length);
    const names = v.winners.map(i => v.players[i].name).join(' และ ');
    const isHost = room && me.seat === room.hostSeat;
    openModal('over', h('h3', {}, v.winners.length > 1 ? `เสมอ! ${names} ชนะร่วมกัน` : `${names} ชนะ!`),
      h('ol', { class: 'results' }, order.map(({ p, i }) => h('li', { class: v.winners.includes(i) ? 'win' : '' },
        h('span', {}, p.name, i === v.you ? ' (คุณ)' : ''), h('span', {}, `${p.points} แต้ม · การ์ด ${p.cards.length} ใบ`)))),
      h('div', { class: 'btns' },
        isHost ? h('button', { class: 'btn primary', onclick: () => socket.emit('restart') }, 'เล่นอีกครั้ง')
          : h('p', { class: 'minor', text: 'รอหัวห้องเริ่มเกมใหม่' })));
  }
})();
