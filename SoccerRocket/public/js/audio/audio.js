// Runtime audio: buses, stadium convolution reverb, per-car engine / boost /
// skid voices with distance attenuation and Doppler, one-shot effects and a
// reactive crowd. Sounds are synthesised in a worker (see sounds.js).
import { SOUND_LIST } from './sounds.js';

const SPEED_OF_SOUND = 34300; // uu/s
const ENGINE_BASES = [['engine_low', 56], ['engine_mid', 150], ['engine_high', 330]];
const VOICE_SOUNDS = ['engine_low', 'engine_mid', 'engine_high', 'boost_loop', 'skid_loop', 'wind_loop'];

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.buffers = {};
    this.ready = false;
    this.ctx = null;
    this.carVoices = [];
    this.oneShots = new Map();
    this.crowdLevel = 0.35;
    this.duck = 1;
    this.paused = false;
    this.listenerVel = { x: 0, y: 0, z: 0 };
    this.lastListener = { x: 0, y: 0, z: 0, set: false };
    this._w = [0, 0, 0]; // engine crossfade weights (scratch)
  }

  /**
   * Builds the audio graph and starts synthesising every sound in a worker.
   * Resolves as soon as the graph exists: the game never waits for sound.
   * Each buffer becomes playable the moment it arrives.
   */
  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch { this.ctx = new AC(); }
      const ctx = this.ctx;
      // master -> limiter -> out
      this.master = ctx.createGain();
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -10; this.limiter.knee.value = 6; this.limiter.ratio.value = 8;
      this.limiter.attack.value = 0.003; this.limiter.release.value = 0.15;
      this.master.connect(this.limiter).connect(ctx.destination);
      this.bus = {};
      for (const k of ['sfx', 'engine', 'crowd', 'ui']) { this.bus[k] = ctx.createGain(); this.bus[k].connect(this.master); }
      this.reverb = ctx.createConvolver();
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.55;
      this.reverbSend.connect(this.reverb).connect(this.bus.sfx);
      this.applyVolumes();
    } catch (e) {
      console.warn('[audio] disabled:', e);
      this.ctx = null;
      return;
    }
    this.ready = true;
    this.generate().then(() => {
      this.allReady = true;
      const missing = SOUND_LIST.filter(([n]) => !this.buffers[n]).map(([n]) => n);
      if (missing.length) console.warn('[audio] could not synthesise:', missing.join(', '));
    });
  }

  /** Stores a synthesised sound as an AudioBuffer; one bad sound never stops the rest. */
  accept(name, sr, ch) {
    try {
      const buf = this.ctx.createBuffer(ch.length, ch[0].length, sr);
      ch.forEach((c, i) => buf.copyToChannel(c, i));
      this.buffers[name] = buf;
      if (name === 'ir') this.setImpulse(buf);
      if (name === 'crowd_loop' && this.unlocked) this.startAmbience();
    } catch (e) {
      console.warn(`[audio] skipped ${name}:`, e);
    }
  }

  /**
   * A ConvolverNode only takes a buffer at the context's own sample rate
   * (most Windows devices run at 48 kHz, the IR is made at 44.1 kHz).
   */
  setImpulse(buf) {
    try {
      this.reverb.buffer = resample(this.ctx, buf, this.ctx.sampleRate);
    } catch (e) {
      console.warn('[audio] reverb disabled:', e);
      try { this.reverbSend.disconnect(); } catch { /* already */ }
    }
  }

  generate() {
    return new Promise((resolve) => {
      let worker = null, watchdog = 0, finished = false;
      const finish = () => { if (finished) return; finished = true; clearTimeout(watchdog); if (worker) worker.terminate(); resolve(); };
      // A worker that cannot load or dies part way is replaced by main-thread
      // synthesis of whatever is still missing.
      const fallback = (why) => {
        if (finished) return;
        finished = true;
        clearTimeout(watchdog);
        if (worker) worker.terminate();
        console.warn('[audio] worker failed (' + why + '), synthesising on the main thread');
        this.generateMain().then(resolve);
      };
      // reset on every message, so a slow machine is fine as long as sounds keep coming
      const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => fallback('no response'), 30000); };
      try { worker = new Worker(new URL('./gen-worker.js', import.meta.url), { type: 'module' }); } catch (e) { worker = null; }
      if (!worker) { fallback('unsupported'); return; }
      worker.onmessage = (e) => {
        const d = e.data;
        arm();
        if (d.type === 'sound') this.accept(d.name, d.sr, d.ch);
        else if (d.type === 'error') console.warn(`[audio] ${d.name} failed:`, d.message);
        else if (d.type === 'done') finish();
      };
      worker.onerror = (e) => { e.preventDefault && e.preventDefault(); fallback(e.message || 'error'); };
      worker.onmessageerror = () => fallback('message error');
      arm();
      worker.postMessage({ cmd: 'gen' });
    });
  }

  async generateMain() {
    // fallback: synthesise on the main thread, yielding between sounds
    for (const [name, fn] of SOUND_LIST) {
      if (this.buffers[name]) continue;
      try { const r = fn(); this.accept(name, r.sr, r.ch); } catch (e) { console.warn(`[audio] ${name} failed:`, e); }
      await new Promise((res) => setTimeout(res, 0));
    }
  }

  unlock() {
    if (!this.ctx) return;
    if (this.ctx.state !== 'running' && !this.paused) this.ctx.resume().catch(() => {});
    if (!this.unlocked) { this.unlocked = true; if (this.ready) this.startAmbience(); }
  }

  applyVolumes() {
    if (!this.ctx) return;
    const a = this.settings.audio, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(a.master, t, 0.05);
    this.bus.sfx.gain.setTargetAtTime(a.sfx, t, 0.05);
    this.bus.engine.gain.setTargetAtTime(a.engine * this.duck, t, 0.05);
    this.bus.crowd.gain.setTargetAtTime(a.crowd, t, 0.05);
    this.bus.ui.gain.setTargetAtTime(a.ui, t, 0.05);
  }

  pause(v) {
    this.paused = v;
    if (!this.ctx) return;
    if (v) this.ctx.suspend().catch(() => {}); else this.ctx.resume().catch(() => {});
  }

  // ---- ambience ------------------------------------------------------------------
  startAmbience() {
    if (this.crowdSrc || !this.buffers.crowd_loop) return;
    const ctx = this.ctx;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    this.crowdFilter = ctx.createBiquadFilter();
    this.crowdFilter.type = 'lowpass';
    this.crowdFilter.frequency.value = 2500;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers.crowd_loop;
    src.loop = true;
    src.connect(this.crowdFilter).connect(this.crowdGain).connect(this.bus.crowd);
    src.start();
    this.crowdSrc = src;
  }

  // ---- one-shots -----------------------------------------------------------------
  /** opts: { pos (three Vector3), gain, rate, bus, reverb, maxVoices } */
  play(name, opts = {}) {
    if (!this.ready || !this.ctx || this.ctx.state !== 'running') return null;
    const buf = this.buffers[name];
    if (!buf) return null;
    const ctx = this.ctx;
    const list = this.oneShots.get(name) || [];
    const max = opts.maxVoices || 6;
    while (list.length >= max) { const o = list.shift(); try { o.stop(); } catch { /* done */ } }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (opts.rate || 1) * (opts.jitter === false ? 1 : 0.96 + Math.random() * 0.08);
    const g = ctx.createGain();
    g.gain.value = opts.gain ?? 1;
    src.connect(g);
    let out = g;
    if (opts.pos) {
      const p = this.makePanner(opts.ref || 6);
      setPannerPos(p, opts.pos.x, opts.pos.y, opts.pos.z);
      g.connect(p);
      out = p;
    }
    out.connect(this.bus[opts.bus || 'sfx']);
    if (opts.reverb !== 0) {
      const s = ctx.createGain();
      s.gain.value = opts.reverb ?? 0.35;
      out.connect(s).connect(this.reverbSend);
    }
    src.start();
    list.push(src);
    this.oneShots.set(name, list);
    src.onended = () => { const i = list.indexOf(src); if (i >= 0) list.splice(i, 1); };
    return { src, gain: g };
  }

  ui(kind) {
    this.unlock();
    this.play('ui_' + kind, { bus: 'ui', reverb: 0, gain: 0.8, jitter: false });
  }

  makePanner(ref) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1.1;
    p.maxDistance = 200;
    return p;
  }

  // ---- car voices ------------------------------------------------------------------
  setCars(players) {
    for (const v of this.carVoices) this.stopVoice(v);
    this.carVoices = [];
    this.players = players;
    // engine loops are among the first sounds made; until they exist, retry from update()
    if (!this.ready || !this.ctx || !VOICE_SOUNDS.every((n) => this.buffers[n])) { this.pendingPlayers = players; return; }
    this.pendingPlayers = null;
    const ctx = this.ctx;
    players.forEach((p) => {
      const local = p.human;
      const v = { local, f: 56, engines: [], srcs: [] };
      v.out = ctx.createGain();
      v.out.gain.value = local ? 0.9 : 1;
      if (local) v.out.connect(this.bus.engine);
      else { v.panner = this.makePanner(5); v.out.connect(v.panner).connect(this.bus.engine); }
      v.filter = ctx.createBiquadFilter();
      v.filter.type = 'lowpass';
      v.filter.frequency.value = 2500;
      v.filter.connect(v.out);
      for (const [name, base] of ENGINE_BASES) {
        const src = ctx.createBufferSource();
        src.buffer = this.buffers[name];
        src.loop = true;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(g).connect(v.filter);
        src.start(ctx.currentTime + Math.random() * 0.1, Math.random() * 0.5);
        v.engines.push({ src, g, base });
        v.srcs.push(src);
      }
      const loop = (name, bus) => {
        const src = ctx.createBufferSource();
        src.buffer = this.buffers[name];
        src.loop = true;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(g).connect(v.out === undefined ? bus : v.out);
        src.start(ctx.currentTime, Math.random() * 1.5);
        v.srcs.push(src);
        return { src, g };
      };
      v.boost = loop('boost_loop');
      v.skid = loop('skid_loop');
      if (local) {
        v.wind = { src: ctx.createBufferSource(), g: ctx.createGain() };
        v.wind.src.buffer = this.buffers.wind_loop; v.wind.src.loop = true; v.wind.g.gain.value = 0;
        v.wind.src.connect(v.wind.g).connect(this.bus.sfx);
        v.wind.src.start();
        v.srcs.push(v.wind.src);
      }
      this.carVoices.push(v);
    });
  }

  stopVoice(v) { for (const s of v.srcs) { try { s.stop(); } catch { /* ignore */ } } }

  /**
   * Per-frame update. camera: three camera; carStates: render states (uu);
   * match: for throttle input & crowd context.
   */
  update(dt, camera, carStates, match, ballState, playing, replay) {
    if (!this.ctx || !this.ready) return;
    if (this.pendingPlayers) this.setCars(this.pendingPlayers);
    const ctx = this.ctx, t = ctx.currentTime;
    // listener
    const L = ctx.listener;
    const cp = camera.position;
    const fwd = camera.getWorldDirection(this._f || (this._f = cp.clone()));
    const up = (this._u || (this._u = cp.clone())).set(0, 1, 0).applyQuaternion(camera.quaternion);
    const LL = this.lastListener, LV = this.listenerVel;
    if (LL.set) {
      const k = 100 / Math.max(dt, 1e-3);
      LV.x = (cp.x - LL.x) * k; LV.y = -(cp.z - LL.z) * k; LV.z = (cp.y - LL.y) * k;
    }
    LL.x = cp.x; LL.y = cp.y; LL.z = cp.z; LL.set = true;
    if (L.positionX) {
      L.positionX.setTargetAtTime(cp.x, t, 0.02); L.positionY.setTargetAtTime(cp.y, t, 0.02); L.positionZ.setTargetAtTime(cp.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.setTargetAtTime(up.x, t, 0.02); L.upY.setTargetAtTime(up.y, t, 0.02); L.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      L.setPosition(cp.x, cp.y, cp.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
    // ducking during replays
    const duck = replay ? 0.35 : 1;
    if (duck !== this.duck) { this.duck = duck; this.applyVolumes(); }

    // cars
    const players = this.players || [];
    for (let i = 0; i < this.carVoices.length; i++) {
      const v = this.carVoices[i], s = carStates[i], p = players[i];
      if (!s) continue;
      const alive = !s.demoed && (playing || !v.local || replay);
      const ctl = p ? p.car.controls : null;
      const throttle = ctl && !replay ? Math.abs(ctl.throttle) : (s.speed > 50 ? 0.6 : 0);
      // engine "revs": speed on the ground, throttle in the air, boost adds load
      const speedFrac = Math.min(1, s.speed / 2300);
      let target = 52 + 300 * Math.pow(speedFrac, 0.8);
      if (!s.onGround) target = Math.max(target * 0.8, 52 + 200 * throttle);
      if (s.boosting) target *= 1.08;
      v.f += (target - v.f) * Math.min(1, dt * (target > v.f ? 5 : 3));
      // Doppler for remote cars
      let doppler = 1;
      if (!v.local) {
        const px = s.pos.x * 0.01, py = s.pos.z * 0.01, pz = -s.pos.y * 0.01;
        setPannerPos(v.panner, px, py, pz);
        const dx = cp.x - px, dy = cp.y - py, dz = cp.z - pz;
        const d = Math.hypot(dx, dy, dz) || 1;
        // radial speed toward the listener, uu/s (physics axes)
        const vr = (s.vel.x * dx + s.vel.z * dy + -s.vel.y * dz) / d - (this.listenerVel.x * dx + this.listenerVel.z * dy - this.listenerVel.y * dz) / d;
        doppler = Math.min(1.4, Math.max(0.7, SPEED_OF_SOUND / (SPEED_OF_SOUND - vr)));
      }
      // crossfade the three engine loops around the current firing frequency
      let wsum = 0;
      const ws = this._w, E = v.engines;
      for (let k = 0; k < E.length; k++) { ws[k] = Math.max(0, 1 - Math.abs(Math.log2(v.f / E[k].base)) / 1.2); wsum += ws[k]; }
      const vol = alive ? (0.28 + 0.32 * throttle + (s.boosting ? 0.15 : 0)) * (v.local ? 0.75 : 1) : 0;
      for (let k = 0; k < E.length; k++) {
        E[k].g.gain.setTargetAtTime(vol * ws[k] / Math.max(1e-3, wsum), t, 0.05);
        E[k].src.playbackRate.setTargetAtTime(Math.min(4, (v.f / E[k].base) * doppler), t, 0.03);
      }
      v.filter.frequency.setTargetAtTime(900 + 4200 * (0.3 + 0.7 * throttle) * (0.5 + speedFrac * 0.5), t, 0.05);
      v.boost.g.gain.setTargetAtTime(alive && s.boosting ? (v.local ? 0.55 : 0.8) : 0, t, s.boosting ? 0.02 : 0.08);
      v.boost.src.playbackRate.setTargetAtTime((s.supersonic ? 1.06 : 1) * doppler, t, 0.05);
      const skid = alive && s.onGround && s.handbrake > 0.25 ? Math.min(1, s.speed / 900) * s.handbrake : 0;
      v.skid.g.gain.setTargetAtTime(skid * 0.45, t, 0.05);
      if (v.wind) v.wind.g.gain.setTargetAtTime(alive ? Math.max(0, (s.speed - 1300) / 1000) * 0.3 + (s.supersonic ? 0.1 : 0) : 0, t, 0.15);
    }

    // crowd: livelier when the ball is near a goal
    if (this.crowdGain) {
      const by = ballState ? Math.abs(ballState.pos.y) : 0;
      const danger = Math.max(0, (by - 3000) / 2100);
      const target = playing || replay ? 0.32 + danger * 0.35 : 0.22;
      this.crowdLevel += (target - this.crowdLevel) * Math.min(1, dt * 0.8);
      this.crowdGain.gain.setTargetAtTime(this.crowdLevel, t, 0.3);
      this.crowdFilter.frequency.setTargetAtTime(1800 + danger * 2600, t, 0.4);
    }
  }

  // ---- game events --------------------------------------------------------------------
  event(e, pos, isLocal) {
    if (!this.ready || !this.ctx) return;
    switch (e.type) {
      case 'count': this.play('beep', { bus: 'ui', gain: 0.8, reverb: 0.2, jitter: false }); break;
      case 'go': this.play('go', { bus: 'ui', gain: 0.9, reverb: 0.25, jitter: false }); this.play('horn_short', { gain: 0.45, reverb: 0.4, jitter: false }); break;
      case 'ballHit': {
        const dv = e.dv || 0;
        const name = dv < 700 ? 'hit_soft' : dv < 1800 ? 'hit_med' : 'hit_hard';
        this.play(name, { pos, gain: Math.min(1.3, 0.35 + dv / 2600), rate: 1.05 - Math.min(0.12, dv / 30000), ref: 8, reverb: 0.4 });
        break;
      }
      case 'ballBounce': {
        const floor = e.normal && e.normal.z > 0.7;
        this.play(floor ? 'bounce_floor' : 'bounce_wall', { pos, gain: Math.min(1, e.speed / 2200), ref: 8, reverb: 0.45 });
        break;
      }
      case 'jump': this.play('jump', { pos: isLocal ? null : pos, gain: isLocal ? 0.45 : 0.5, ref: 4 }); break;
      case 'doubleJump': this.play('double_jump', { pos: isLocal ? null : pos, gain: isLocal ? 0.4 : 0.45, ref: 4 }); break;
      case 'flip': case 'autoflip': this.play('dodge', { pos: isLocal ? null : pos, gain: isLocal ? 0.55 : 0.6, ref: 4 }); break;
      case 'land': this.play('land', { pos: isLocal ? null : pos, gain: 0.5, ref: 4, reverb: 0.15 }); break;
      case 'pad': this.play(e.pad.big ? 'pad_big' : 'pad_small', { pos: isLocal ? null : pos, gain: isLocal ? 0.6 : 0.5, ref: 4, reverb: 0.2 }); break;
      case 'boostStart': if (isLocal) this.play('boost_start', { gain: 0.45, reverb: 0.1 }); break;
      case 'supersonic': if (isLocal) this.play('supersonic', { gain: 0.5, reverb: 0.2 }); break;
      case 'demo': this.play('demo', { pos, gain: 1.1, ref: 12, reverb: 0.5, maxVoices: 3 }); this.play('ooh', { bus: 'crowd', gain: 0.5, reverb: 0 }); break;
      case 'bump': case 'carCar': this.play('car_bump', { pos, gain: Math.min(1, (e.speed || 600) / 1600), ref: 6, reverb: 0.3 }); break;
      case 'carWorld': this.play('car_wall', { pos: isLocal ? null : pos, gain: Math.min(0.8, e.speed / 2200), ref: 5, reverb: 0.3 }); break;
      case 'goal': {
        this.play('goal_boom', { pos, gain: e.replay ? 0.7 : 1.2, ref: 30, reverb: 0.5, maxVoices: 2 });
        if (!e.replay) {
          this.play('horn', { gain: 0.65, reverb: 0.5, jitter: false, maxVoices: 1 });
          this.play('cheer', { bus: 'crowd', gain: 1.0, reverb: 0, jitter: false, maxVoices: 2 });
          this.crowdLevel = 0.75;
        }
        break;
      }
      case 'overtime': this.play('horn_short', { gain: 0.6, reverb: 0.4, jitter: false }); break;
      case 'matchEnd': this.play('buzzer', { gain: 0.6, reverb: 0.4, jitter: false }); this.play(e.win ? 'cheer' : 'applause', { bus: 'crowd', gain: 0.9, reverb: 0, jitter: false }); break;
      case 'replayStart': case 'replayEnd': default: break;
    }
  }

  /** Crowd reaction for saves / near misses. */
  crowdReact(kind) {
    if (kind === 'save') this.play('ooh', { bus: 'crowd', gain: 0.7, reverb: 0 });
    else if (kind === 'shot') this.play('ooh', { bus: 'crowd', gain: 0.35, reverb: 0 });
  }

  stopAll() { for (const v of this.carVoices) this.stopVoice(v); this.carVoices = []; }
}

function setPannerPos(p, x, y, z) {
  if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
  else p.setPosition(x, y, z);
}

/** Linear resample to the context rate (used for the reverb impulse). */
function resample(ctx, buf, rate) {
  if (buf.sampleRate === rate) return buf;
  const k = buf.sampleRate / rate, n = Math.max(1, Math.floor(buf.length / k));
  const out = ctx.createBuffer(buf.numberOfChannels, n, rate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c), dst = out.getChannelData(c), last = src.length - 1;
    for (let i = 0; i < n; i++) {
      const x = i * k, j = Math.floor(x), f = x - j;
      dst[i] = j >= last ? src[last] : src[j] + (src[j + 1] - src[j]) * f;
    }
  }
  return out;
}
