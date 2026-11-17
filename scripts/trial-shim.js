/* Trial build: replaces the Socket.io connection with a local hot-seat game.
   The rules engine runs in the page; every seat is played on this one screen. */
(() => {
  const handlers = {};
  const fire = (ev, data) => setTimeout(() => (handlers[ev] || []).slice().forEach(f => f(data)), 0);
  let game = null, names = [], theme = 'siam';
  const TURN_MS = 60 * 1000;
  let timer = null, timerKey = null, deadline = null;
  function arm() {
    const key = game.phase !== 'over' ? `${game.round}:${game.turn}` : null;
    if (key === timerKey) return;
    clearTimeout(timer); timerKey = key; deadline = null;
    if (!key) return;
    deadline = Date.now() + TURN_MS;
    timer = setTimeout(() => {
      const res = Rules.applyAction(game, game.turn, { type: 'skip', reason: 'timeout' });
      if (!res.error) { game = res.state; push(); }
    }, TURN_MS);
  }

  function push() {
    arm();
    const seat = game.turn;
    fire('joined', { code: 'ทดลอง', token: 'trial', seat });
    fire('room', { code: 'ทดลอง', theme, hostSeat: seat, started: true, players: names.map(n => ({ name: n, online: true })) });
    const v = Rules.viewFor(game, seat);
    v.turnEndsIn = deadline ? Math.max(0, deadline - Date.now()) : null;
    fire('state', v);
  }

  function newGame() {
    // Random seating, same as the real server
    const order = names.slice().sort(() => Math.random() - 0.5);
    names = order;
    game = Rules.createGame(order.map((n, i) => ({ id: String(i), name: n })));
    timerKey = null;
    push();
  }

  const socket = {
    on(ev, f) { (handlers[ev] = handlers[ev] || []).push(f); return socket; },
    once(ev, f) { const g = d => { socket.off(ev, g); f(d); }; return socket.on(ev, g); },
    off(ev, f) { handlers[ev] = (handlers[ev] || []).filter(x => x !== f); return socket; },
    emit(ev, data) {
      if (ev === 'action') {
        const res = Rules.applyAction(game, game.turn, data);
        if (res.error) return fire('err', { msg: res.error });
        game = res.state;
        push();
      } else if (ev === 'restart' || ev === 'start') newGame();
      else if (ev === 'ping-state' && game) push();
    },
  };
  window.io = () => socket;
  window.Trial = { start(list, t) { names = list; theme = t || 'siam'; newGame(); } };
})();
