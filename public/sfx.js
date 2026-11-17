/* เพชรสยาม — sound effects synthesized with Web Audio (no audio files).
   Timbre: short xylophone-like plucks on a Thai pentatonic scale, like a ranat. */
window.SFX = (() => {
  let ctx = null, master = null;
  let muted = false;
  try { muted = localStorage.getItem('ps-muted') === '1'; } catch { /* private mode */ }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // Browsers only allow audio after a user gesture: unlock on the first one.
  const unlock = () => { ensure(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  // One plucked note. f = Hz, t = start offset (s), d = decay (s)
  function note(f, t = 0, d = 0.25, type = 'triangle', vol = 0.6) {
    const c = ensure();
    if (!c || muted) return;
    const t0 = c.currentTime + t;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + d + 0.05);
  }
  // Bell/gong: a few partials with a long tail.
  function bell(f, t = 0, d = 1.4, vol = 0.35) {
    note(f, t, d, 'sine', vol);
    note(f * 2.01, t, d * 0.6, 'sine', vol * 0.5);
    note(f * 3.02, t, d * 0.35, 'sine', vol * 0.25);
  }

  // Thai-flavoured pentatonic (C D E G A) across octaves
  const P = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5, 1568.0];

  const sounds = {
    take() { [8, 7, 8].forEach((i, k) => note(P[i], k * 0.06, 0.12, 'triangle', 0.35)); },
    buy() { [0, 2, 3, 5].forEach((i, k) => note(P[i], k * 0.08, 0.3)); },
    reserve() { note(P[3], 0, 0.18); note(P[1], 0.1, 0.3); },
    discard() { [6, 4, 2].forEach((i, k) => note(P[i], k * 0.07, 0.12, 'triangle', 0.3)); },
    noble() { [0, 2, 3, 5, 7].forEach((i, k) => note(P[i], k * 0.1, 0.4)); bell(261.63, 0.55, 1.8, 0.3); },
    skip() { note(220, 0, 0.25, 'sine', 0.4); },
    turn() { bell(392, 0, 1.2, 0.3); },
    over() {
      const m = [0, 2, 3, 4, 3, 2, 3, 5];
      m.forEach((i, k) => note(P[i], k * 0.16, 0.35));
      bell(130.81, m.length * 0.16, 2.4, 0.35);
    },
    error() { note(140, 0, 0.18, 'square', 0.15); },
    click() { note(P[5], 0, 0.06, 'triangle', 0.2); },
    tick() { note(1046.5, 0, 0.05, 'square', 0.08); },
  };

  return {
    play(name) { if (sounds[name]) sounds[name](); },
    get muted() { return muted; },
    setMuted(m) {
      muted = !!m;
      try { localStorage.setItem('ps-muted', muted ? '1' : '0'); } catch { /* private mode */ }
    },
  };
})();
