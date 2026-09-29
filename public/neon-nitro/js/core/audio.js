// All audio is synthesised: engine (gears, turbo whine, tyre screech, wind),
// comic SFX and a lookahead music sequencer with per-track styles.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const CH = {
  // chord name -> midi notes (root position around C4=60)
  C: [60, 64, 67], Cmaj7: [60, 64, 67, 71], Cm: [60, 63, 67], Cm7: [60, 63, 67, 70], D: [62, 66, 69], Dm: [62, 65, 69], Dm7: [62, 65, 69, 72], Dm9: [62, 65, 69, 72, 76],
  E: [64, 68, 71], Em: [64, 67, 71], Em7: [64, 67, 71, 74], F: [65, 69, 72], Fmaj7: [65, 69, 72, 76], G: [67, 71, 74], G7: [67, 71, 74, 77], G13: [67, 71, 77, 81],
  Am: [69, 72, 76], Am7: [69, 72, 76, 79], Am9: [69, 72, 76, 79, 83], Bb: [70, 74, 77], Bm: [71, 74, 78], Eb: [63, 67, 70], Ab: [68, 72, 75], Bbmaj7: [70, 74, 77, 81],
};

const STYLES = {
  menu: { bpm: 94, swing: 0.12, chords: ['Fmaj7', 'Em7', 'Dm7', 'Cmaj7'], kick: 'x...x.....x.x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', bass: 'r..r..r.r...r.r.', bassOct: -2, keys: '..x...x...x..x..', keysSound: 'epiano', arp: null, lead: 'soft', pad: true, vol: 0.8 },
  citypop: { bpm: 116, swing: 0.08, chords: ['Am9', 'Dm9', 'G13', 'Cmaj7'], kick: 'x..x..x...x..x..', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', bass: 'r.rr..r.r.r..rr.', bassOct: -2, keys: '..x..x....x..x..', keysSound: 'epiano', arp: 'x.x.x.x.x.x.x.x.', arpSound: 'pluck', lead: 'bright', pad: true, vol: 0.85 },
  synthwave: { bpm: 122, swing: 0, chords: ['Am', 'F', 'C', 'G'], kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', bass: 'rrrrrrrrrrrrrrrr', bassOct: -2, keys: null, arp: 'xxxxxxxxxxxxxxxx', arpSound: 'square', lead: 'saw', pad: true, gated: true, vol: 0.8 },
  eurobeat: { bpm: 156, swing: 0, chords: ['Dm', 'Bb', 'C', 'Am'], kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', bass: 'rRrRrRrRrRrRrRrR', bassOct: -2, keys: 'x..x..x...x..x..', keysSound: 'stab', arp: null, lead: 'euro', pad: false, vol: 0.8 },
  dnb: { bpm: 172, swing: 0, chords: ['Em', 'C', 'D', 'Bm'], kick: 'x.........x.....', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx', bass: 'r.......r..r....', bassOct: -3, bassSound: 'reese', keys: null, arp: '..x...x...x...x.', arpSound: 'pluck', lead: 'saw', pad: true, vol: 0.8 },
  chip: { bpm: 142, swing: 0, chords: ['C', 'Am', 'F', 'G'], kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', bass: 'r.r.r.r.r.r.r.r.', bassOct: -2, bassSound: 'tri', keys: null, arp: 'xxxxxxxxxxxxxxxx', arpSound: 'chip', lead: 'chip', pad: false, vol: 0.75 },
  boss: { bpm: 150, swing: 0, chords: ['Em', 'C', 'G', 'D'], kick: 'x.x.x.x.x.x.x.x.', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', bass: 'rrrrrrrrrrrrrrrr', bassOct: -2, keys: 'x.....x.....x...', keysSound: 'stab', arp: 'xxxxxxxxxxxxxxxx', arpSound: 'square', lead: 'saw', pad: true, gated: true, vol: 0.8 },
};

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export class Audio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.vol = { master: 0.8, music: 0.6, sfx: 0.85 };
    this.style = null;
    this.intensity = 0;
    this.pending = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this._init();
      if (this.pending) { const p = this.pending; this.pending = null; this.music(p); }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  suspend() { this.ctx?.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _init() {
    const c = this.ctx;
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(c.destination);
    this.musicBus = c.createGain(); this.musicBus.connect(this.master);
    this.sfxBus = c.createGain(); this.sfxBus.connect(this.master);
    this.engBus = c.createGain(); this.engBus.connect(this.sfxBus);
    // noise buffer
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // music delay send
    this.delay = c.createDelay(1); this.delay.delayTime.value = 0.28;
    const fb = c.createGain(); fb.gain.value = 0.28;
    const dl = c.createGain(); dl.gain.value = 0.22;
    this.delay.connect(fb); fb.connect(this.delay); this.delay.connect(dl); dl.connect(this.musicBus);
    this.setVolumes(this.game.save?.d.settings || this.vol);
    this._engineInit();
  }

  setVolumes(s) {
    this.vol = { master: s.master ?? 0.8, music: s.music ?? 0.6, sfx: s.sfx ?? 0.85 };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
  }

  // ---------------------------------------------------------------- primitives
  _env(g, t, a, peak, dur, rel = 0.05) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + Math.max(a, dur - rel));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  tone(f, dur, { type = 'square', vol = 0.3, slide = null, t = 0, a = 0.005, bus = null, detune = 0, filter = null } = {}) {
    const c = this.ctx; if (!c) return;
    const t0 = c.currentTime + t;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t0); o.detune.value = detune;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
    const g = c.createGain(); this._env(g, t0, a, vol, dur);
    let n = o;
    if (filter) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = filter; o.connect(fl); n = fl; }
    n.connect(g); g.connect(bus || this.sfxBus);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  noise(dur, { type = 'bandpass', f = 1000, q = 1, vol = 0.3, sweep = null, t = 0, a = 0.003, bus = null } = {}) {
    const c = this.ctx; if (!c) return;
    const t0 = c.currentTime + t;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t0); fl.Q.value = q;
    if (sweep) fl.frequency.exponentialRampToValueAtTime(sweep, t0 + dur);
    const g = c.createGain(); this._env(g, t0, a, vol, dur);
    s.connect(fl); fl.connect(g); g.connect(bus || this.sfxBus);
    s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.02);
  }

  // ---------------------------------------------------------------- sfx
  sfx(name, o = {}) {
    if (!this.ctx) return;
    const v = o.vol ?? 1;
    const T = (f, d, x = {}) => this.tone(f, d, { ...x, vol: (x.vol ?? 0.3) * v });
    const N = (d, x = {}) => this.noise(d, { ...x, vol: (x.vol ?? 0.3) * v });
    switch (name) {
      case 'count': T(520, 0.22, { type: 'square', vol: 0.22 }); T(1040, 0.12, { type: 'triangle', vol: 0.12 }); break;
      case 'go': T(1046, 0.6, { type: 'square', vol: 0.22 }); T(1318, 0.6, { type: 'square', vol: 0.14 }); T(1568, 0.6, { type: 'triangle', vol: 0.14 }); break;
      case 'itembox': [1047, 1319, 1568, 2093].forEach((f, i) => T(f, 0.1, { type: 'triangle', vol: 0.18, t: i * 0.04 })); N(0.15, { type: 'highpass', f: 5000, vol: 0.12 }); break;
      case 'itemgot': T(1568, 0.1, { type: 'square', vol: 0.12 }); T(2093, 0.25, { type: 'square', vol: 0.12, t: 0.08 }); break;
      case 'tick': T(2200 + Math.random() * 400, 0.02, { type: 'square', vol: 0.06 }); break;
      case 'boost': case 'item_nitro': case 'item_nitro3':
        N(0.7, { type: 'bandpass', f: 400, sweep: 3200, q: 1.5, vol: 0.35 }); T(160, 0.55, { type: 'sawtooth', slide: 520, vol: 0.12, filter: 1800 }); break;
      case 'pad': N(0.5, { type: 'bandpass', f: 600, sweep: 4000, q: 2, vol: 0.25 }); [1318, 1760].forEach((f, i) => T(f, 0.15, { type: 'triangle', vol: 0.12, t: i * 0.05 })); break;
      case 'hit': T(700, 0.4, { type: 'square', slide: 110, vol: 0.2 }); N(0.3, { type: 'lowpass', f: 1500, vol: 0.3 }); T(90, 0.3, { type: 'sine', slide: 40, vol: 0.4 }); break;
      case 'hitOther': T(420, 0.18, { type: 'triangle', slide: 160, vol: 0.2 }); N(0.12, { type: 'bandpass', f: 2000, vol: 0.12 }); break;
      case 'explosion': N(1.1, { type: 'lowpass', f: 1600, sweep: 90, q: 0.8, vol: 0.6 }); T(95, 0.7, { type: 'sine', slide: 32, vol: 0.55 }); N(0.2, { type: 'highpass', f: 3000, vol: 0.2 }); break;
      case 'wall': N(0.14, { type: 'bandpass', f: 2600, q: 6, vol: 0.28 }); T(190, 0.12, { type: 'square', slide: 120, vol: 0.12 }); break;
      case 'bump': T(130, 0.16, { type: 'sine', slide: 55, vol: 0.4 }); N(0.1, { type: 'lowpass', f: 900, vol: 0.2 }); break;
      case 'lap': [784, 988, 1175].forEach((f, i) => T(f, 0.18, { type: 'square', vol: 0.14, t: i * 0.09 })); break;
      case 'finallap': [659, 784, 988, 1319, 1568].forEach((f, i) => T(f, 0.22, { type: 'square', vol: 0.15, t: i * 0.08 })); break;
      case 'win': [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => T(f, i === 6 ? 0.9 : 0.16, { type: 'square', vol: 0.15, t: i * 0.11 })); [523, 659, 784].forEach((f) => T(f, 1.2, { type: 'triangle', vol: 0.12, t: 0.66 })); break;
      case 'finish': [659, 523, 659, 784].forEach((f, i) => T(f, 0.2, { type: 'square', vol: 0.14, t: i * 0.12 })); break;
      case 'hop': T(260, 0.08, { type: 'sine', slide: 520, vol: 0.18 }); break;
      case 'spark1': case 'spark2': case 'spark3': {
        const base = name === 'spark1' ? 1400 : name === 'spark2' ? 1760 : 2200;
        [0, 1, 2].forEach((i) => T(base * (1 + i * 0.25), 0.06, { type: 'triangle', vol: 0.12, t: i * 0.035 }));
        N(0.12, { type: 'highpass', f: 6000, vol: 0.12 });
        break;
      }
      case 'land': T(110, 0.14, { type: 'sine', slide: 50, vol: 0.35 }); N(0.08, { type: 'lowpass', f: 700, vol: 0.2 }); break;
      case 'trick': N(0.35, { type: 'bandpass', f: 800, sweep: 3000, q: 2, vol: 0.2 }); T(1568, 0.2, { type: 'triangle', vol: 0.14, t: 0.2 }); break;
      case 'respawn': [392, 523, 659, 784].forEach((f, i) => T(f, 0.12, { type: 'triangle', vol: 0.14, t: i * 0.07 })); break;
      case 'smash': N(0.25, { type: 'bandpass', f: 1600, q: 1.2, vol: 0.35 }); for (let i = 0; i < 3; i++) T(600 + Math.random() * 1600, 0.05, { type: 'square', vol: 0.07, t: 0.03 + i * 0.05 }); break;
      case 'smashBig': N(0.5, { type: 'lowpass', f: 2500, sweep: 300, vol: 0.45 }); T(140, 0.25, { type: 'sine', slide: 60, vol: 0.35 }); for (let i = 0; i < 6; i++) T(500 + Math.random() * 2400, 0.05, { type: 'square', vol: 0.06, t: 0.05 + i * 0.05 }); break;
      case 'item_shuriken': N(0.25, { type: 'bandpass', f: 3000, sweep: 800, q: 3, vol: 0.2 }); T(2800, 0.15, { type: 'triangle', vol: 0.1 }); break;
      case 'item_missile': N(0.8, { type: 'bandpass', f: 300, sweep: 2400, q: 1, vol: 0.35 }); T(200, 0.4, { type: 'sawtooth', slide: 800, vol: 0.1, filter: 1500 }); break;
      case 'item_oil': N(0.25, { type: 'lowpass', f: 600, sweep: 200, vol: 0.35 }); T(180, 0.2, { type: 'sine', slide: 90, vol: 0.25 }); break;
      case 'item_daruma': T(220, 0.3, { type: 'sine', slide: 560, vol: 0.28 }); T(330, 0.18, { type: 'triangle', vol: 0.12, t: 0.1 }); break;
      case 'item_shield': T(220, 0.6, { type: 'sawtooth', slide: 880, vol: 0.12, filter: 2500 }); T(660, 0.6, { type: 'sine', vol: 0.12, t: 0.1 }); break;
      case 'item_emp': T(1200, 0.5, { type: 'sawtooth', slide: 60, vol: 0.2 }); N(0.5, { type: 'highpass', f: 2500, vol: 0.25 }); break;
      case 'item_ryu': N(1.2, { type: 'lowpass', f: 500, sweep: 1400, q: 5, vol: 0.45 }); T(90, 1.1, { type: 'sawtooth', slide: 160, vol: 0.25, filter: 700 }); [523, 784, 1047].forEach((f, i) => T(f, 0.3, { type: 'square', vol: 0.1, t: 0.4 + i * 0.12 })); break;
      case 'item_glitch': for (let i = 0; i < 10; i++) T(200 + Math.random() * 3000, 0.04, { type: 'square', vol: 0.12, t: i * 0.035 }); N(0.4, { type: 'highpass', f: 4000, vol: 0.2 }); break;
      case 'ui': T(880, 0.06, { type: 'square', vol: 0.1 }); break;
      case 'uiBack': T(440, 0.08, { type: 'square', vol: 0.1, slide: 300 }); break;
      case 'buy': [784, 1047, 1319, 1568].forEach((f, i) => T(f, 0.12, { type: 'square', vol: 0.14, t: i * 0.06 })); N(0.3, { type: 'highpass', f: 6000, vol: 0.1, t: 0.2 }); break;
      case 'deny': T(200, 0.25, { type: 'square', vol: 0.15, slide: 140 }); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- engine
  _engineInit() {
    const c = this.ctx;
    const mk = (type, det = 0) => { const o = c.createOscillator(); o.type = type; o.detune.value = det; o.start(); return o; };
    this.eng = { o1: mk('sawtooth'), o2: mk('square'), o3: mk('sawtooth', 9) };
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 255) * 2 - 1; curve[i] = Math.tanh(x * 2.2); }
    shaper.curve = curve;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800; f.Q.value = 3;
    const g = c.createGain(); g.gain.value = 0;
    const g2 = c.createGain(); g2.gain.value = 0.5;
    this.eng.o1.connect(shaper); this.eng.o3.connect(shaper); this.eng.o2.connect(g2); g2.connect(shaper);
    shaper.connect(f); f.connect(g); g.connect(this.engBus);
    this.eng.filter = f; this.eng.gain = g;
    // turbo whine
    const tw = mk('sine'); const twg = c.createGain(); twg.gain.value = 0; tw.connect(twg); twg.connect(this.engBus);
    this.eng.tw = tw; this.eng.twg = twg;
    // tyre screech: noise -> bandpass w/ LFO
    const ns = c.createBufferSource(); ns.buffer = this.noiseBuf; ns.loop = true; ns.start();
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 7;
    const lfo = mk('sine'); lfo.frequency.value = 7; const lg = c.createGain(); lg.gain.value = 250; lfo.connect(lg); lg.connect(bp.frequency);
    const sg = c.createGain(); sg.gain.value = 0;
    ns.connect(bp); bp.connect(sg); sg.connect(this.engBus);
    this.eng.screech = sg;
    // wind / road noise
    const wn = c.createBufferSource(); wn.buffer = this.noiseBuf; wn.loop = true; wn.start(0, 0.7);
    const wl = c.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 400;
    const wg = c.createGain(); wg.gain.value = 0;
    wn.connect(wl); wl.connect(wg); wg.connect(this.engBus);
    this.eng.wind = wg; this.eng.windF = wl;
    this.engOn = false;
  }

  engine(speedFrac, throttle, boost, drift, grounded, offroad) {
    if (!this.ctx) return;
    const e = this.eng, t = this.ctx.currentTime;
    const s = Math.max(0, speedFrac);
    const gears = [0, 0.16, 0.33, 0.52, 0.74, 1.0, 1.6];
    let g = 0; while (g < gears.length - 2 && s > gears[g + 1]) g++;
    const inGear = (s - gears[g]) / (gears[g + 1] - gears[g]);
    let rpm = 0.28 + 0.72 * Math.min(1, inGear);
    if (!grounded) rpm = Math.min(1, rpm + 0.2);
    if (s < 0.02) rpm = 0.22 + throttle * 0.25;
    const f = 38 + rpm * 125 + (boost ? 18 : 0);
    e.o1.frequency.setTargetAtTime(f, t, 0.03);
    e.o3.frequency.setTargetAtTime(f * 1.005, t, 0.03);
    e.o2.frequency.setTargetAtTime(f / 2, t, 0.03);
    e.filter.frequency.setTargetAtTime(350 + throttle * 1400 + rpm * 900 + (boost ? 900 : 0), t, 0.05);
    e.gain.gain.setTargetAtTime(0.06 + throttle * 0.08 + (boost ? 0.05 : 0), t, 0.08);
    e.tw.frequency.setTargetAtTime(1400 + s * 1600, t, 0.1);
    e.twg.gain.setTargetAtTime(boost ? 0.03 : s * 0.008 * throttle, t, 0.1);
    e.screech.gain.setTargetAtTime(drift && grounded ? 0.05 : 0, t, 0.05);
    e.wind.gain.setTargetAtTime(Math.min(0.12, s * 0.09) + (offroad ? 0.06 : 0), t, 0.2);
    e.windF.frequency.setTargetAtTime(300 + s * 1500 + (offroad ? 600 : 0), t, 0.2);
    this.engOn = true;
  }
  engineOff() {
    if (!this.ctx || !this.engOn) return;
    const e = this.eng, t = this.ctx.currentTime;
    for (const g of [e.gain, e.twg, e.screech, e.wind]) g.gain.setTargetAtTime(0, t, 0.1);
    this.engOn = false;
  }

  // ---------------------------------------------------------------- music
  music(style) {
    if (!this.ctx) { this.pending = style; return; }
    if (this.style === style && this.timer) return;
    this.stopMusic();
    const S = STYLES[style] || STYLES.menu;
    this.style = style;
    this.S = S;
    this.step = 0;
    this.intensity = 0;
    this.nextT = this.ctx.currentTime + 0.1;
    this.r = rng(style.length * 977 + 13);
    this.melody = this._makeMelody(S);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = S.vol;
    this.musicGain.connect(this.musicBus);
    this.paused = false;
    this.timer = setInterval(() => this._schedule(), 25);
    if (style !== 'menu') this.engineOff();
  }
  stopMusic() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.musicGain) { const g = this.musicGain; g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); setTimeout(() => g.disconnect(), 600); }
    this.style = null;
  }
  pauseMusic(p) {
    this.paused = p;
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(p ? 0.15 * this.S.vol : this.S.vol, this.ctx.currentTime, 0.1);
    if (p) this.engineOff();
  }
  musicIntensity(i) { this.intensity = i; }

  _makeMelody(S) {
    // a 4-bar, 16-step-per-bar phrase using chord tones and passing notes
    const r = this.r;
    const out = [];
    for (let bar = 0; bar < 4; bar++) {
      const ch = CH[S.chords[bar % S.chords.length]];
      for (let s = 0; s < 16; s++) {
        const onBeat = s % 4 === 0;
        const play = onBeat ? r() < 0.8 : (s % 2 === 0 ? r() < 0.45 : r() < 0.18);
        if (!play) { out.push(null); continue; }
        const n = ch[Math.floor(r() * ch.length)] + 12 + (r() < 0.2 ? 12 : 0);
        const len = onBeat && r() < 0.5 ? 3 : 1;
        out.push({ n, len });
      }
    }
    return out;
  }

  _schedule() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const S = this.S;
    const bpm = S.bpm * (this.intensity > 0 ? 1.04 : 1);
    const stepDur = 60 / bpm / 4;
    while (this.nextT < c.currentTime + 0.14) {
      const st = this.step % 16;
      const bar = Math.floor(this.step / 16) % 4;
      let t = this.nextT + (st % 2 === 1 ? S.swing * stepDur : 0);
      if (!this.paused) this._playStep(S, st, bar, t, stepDur);
      this.nextT += stepDur;
      this.step++;
    }
  }

  _playStep(S, st, bar, t, sd) {
    const c = this.ctx, bus = this.musicGain;
    const chord = CH[S.chords[bar % S.chords.length]];
    const hit = (pat) => pat && pat[st] !== '.';
    const I = this.intensity;
    // drums
    if (hit(S.kick) || (I && st % 4 === 0)) this._kick(t);
    if (hit(S.snare)) this._snare(t, S.gated);
    if (hit(S.hat) || (I && st % 2 === 1)) this._hat(t, st % 4 === 2 ? 0.07 : 0.045);
    // bass
    if (hit(S.bass)) {
      const up = S.bass[st] === 'R';
      const n = chord[0] + 12 * (S.bassOct ?? -2) + (up ? 12 : 0);
      this._bass(t, NOTE(n), sd * (S.bass[st + 1] === '.' ? 1.8 : 0.9), S.bassSound);
    }
    // keys / stabs
    if (hit(S.keys)) for (const n of chord) this._keys(t, NOTE(n), sd * 2, S.keysSound);
    // arp
    if (hit(S.arp) && (S.style !== 'menu')) {
      const n = chord[(st + (st >> 2)) % chord.length] + 12;
      this._arp(t, NOTE(n), sd * 0.9, S.arpSound);
    }
    // pad on bar starts
    if (S.pad && st === 0) for (const n of chord.slice(0, 3)) this._pad(t, NOTE(n), sd * 16);
    // lead (from the 2nd pass on, or always when intense)
    const passes = Math.floor(this.step / 64);
    if (S.lead && (passes % 2 === 1 || I)) {
      const m = this.melody[bar * 16 + st];
      if (m) this._lead(t, NOTE(m.n), sd * m.len * 0.95, S.lead);
    }
    void c; void bus;
  }

  _out(node, t, dur) { node.connect(this.musicGain); setTimeout(() => node.disconnect(), (t - this.ctx.currentTime + dur + 0.3) * 1000); }
  _kick(t) {
    const c = this.ctx; const o = c.createOscillator(); const g = c.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g); this._out(g, t, 0.3); o.start(t); o.stop(t + 0.3);
  }
  _snare(t, gated) {
    const c = this.ctx; const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
    const g = c.createGain(); const d = gated ? 0.22 : 0.14;
    g.gain.setValueAtTime(0.5, t); if (gated) g.gain.setValueAtTime(0.35, t + d * 0.8); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    s.connect(f); f.connect(g); this._out(g, t, d); s.start(t, Math.random()); s.stop(t + d + 0.02);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g2 = c.createGain(); g2.gain.setValueAtTime(0.3, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g2); this._out(g2, t, 0.12); o.start(t); o.stop(t + 0.12);
    if (gated) { g.connect(this.delay); }
  }
  _hat(t, d) {
    const c = this.ctx; const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = c.createGain(); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    s.connect(f); f.connect(g); this._out(g, t, d); s.start(t, Math.random()); s.stop(t + d + 0.02);
  }
  _bass(t, f, d, sound) {
    const c = this.ctx;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.32, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(sound === 'tri' ? 3000 : 1600, t); lp.frequency.exponentialRampToValueAtTime(260, t + d);
    const types = sound === 'tri' ? ['triangle'] : sound === 'reese' ? ['sawtooth', 'sawtooth'] : ['sawtooth', 'square'];
    types.forEach((ty, i) => { const o = c.createOscillator(); o.type = ty; o.frequency.value = f * (i && ty === 'square' ? 0.5 : 1); o.detune.value = sound === 'reese' ? (i ? 18 : -18) : 0; o.connect(lp); o.start(t); o.stop(t + d + 0.05); });
    lp.connect(g); this._out(g, t, d);
  }
  _keys(t, f, d, sound) {
    const c = this.ctx;
    const g = c.createGain();
    const dur = sound === 'stab' ? 0.16 : d * 1.6;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(sound === 'stab' ? 0.09 : 0.07, t + 0.006); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const o = c.createOscillator(); o.type = sound === 'stab' ? 'sawtooth' : 'sine'; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = sound === 'stab' ? 'square' : 'triangle'; o2.frequency.value = f * 2; o2.detune.value = 4;
    const g2 = c.createGain(); g2.gain.value = 0.35;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = sound === 'stab' ? 2600 : 3200;
    o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g);
    this._out(g, t, dur); g.connect(this.delay);
    o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }
  _arp(t, f, d, sound) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    const o = c.createOscillator(); o.type = sound === 'pluck' ? 'triangle' : 'square'; o.frequency.value = f * (sound === 'chip' ? 2 : 1);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = sound === 'chip' ? 8000 : 2400;
    o.connect(lp); lp.connect(g); this._out(g, t, d); if (sound !== 'chip') g.connect(this.delay);
    o.start(t); o.stop(t + d + 0.02);
  }
  _pad(t, f, d) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.028, t + d * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + d);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    for (const det of [-10, 0, 11]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + d + 0.05); }
    lp.connect(g); this._out(g, t, d);
  }
  _lead(t, f, d, sound) {
    const c = this.ctx;
    const g = c.createGain();
    const v = sound === 'soft' ? 0.04 : 0.055;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.setValueAtTime(v, t + Math.max(0.01, d - 0.05)); g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.05);
    const o = c.createOscillator();
    o.type = sound === 'chip' ? 'square' : sound === 'soft' || sound === 'bright' ? 'triangle' : 'sawtooth';
    o.frequency.value = f;
    const vib = c.createOscillator(); vib.frequency.value = 5.5; const vg = c.createGain(); vg.gain.value = sound === 'euro' ? 6 : 3; vib.connect(vg); vg.connect(o.detune);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = sound === 'euro' ? 3600 : 2600;
    o.connect(lp); lp.connect(g); this._out(g, t, d + 0.05); g.connect(this.delay);
    o.start(t); vib.start(t); o.stop(t + d + 0.1); vib.stop(t + d + 0.1);
  }
}
