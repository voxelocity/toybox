// Sound effect generators. Every sound is built from a physical-ish model
// (no recorded samples): engines from combustion pulses through exhaust
// resonators, impacts from modal synthesis, explosions from layered noise
// shaped like a blast, crowds from many formant-filtered voices and
// granular hand claps. Each generator returns { sr, ch: [Float32Array..], loop }.
import {
  rng, Biquad, OnePole, pinkGen, brownGen, smoothRand, softclip, normalize, makeLoop, fadeEdges,
  addModes, bakeReverb, buf,
} from './dsp.js';

const SR = 44100;
const CROWD_SR = 24000;

// ---------------------------------------------------------------------------
// Engine: combustion pulses -> exhaust pipe comb + body resonances -> drive
// ---------------------------------------------------------------------------
function engineLoop(f0, seed, whine) {
  const sr = SR, r = rng(seed * 977);
  const cyl = 8;
  const firings = Math.max(cyl * 4, Math.round(f0 * 1.4 / cyl) * cyl);
  const dur = firings / f0, fade = 0.12;
  const n = Math.floor((dur + fade) * sr);
  const x = new Float32Array(n);
  const cylAmp = Array.from({ length: cyl }, () => 0.75 + r() * 0.5);
  const cylTau = Array.from({ length: cyl }, () => 0.8 + r() * 0.4);
  const total = Math.ceil((dur + fade) * f0) + 1;
  const tauBase = 0.0022 * Math.pow(60 / f0, 0.35);
  for (let k = 0; k < total; k++) {
    const t0 = k / f0 + (r() - 0.5) * 0.05 / f0;
    const s0 = Math.floor(t0 * sr);
    const A = cylAmp[k % cyl] * (0.88 + r() * 0.24);
    const tau = tauBase * cylTau[k % cyl];
    const len = Math.floor(tau * 8 * sr);
    for (let i = 0; i < len && s0 + i < n; i++) {
      if (s0 + i < 0) continue;
      const t = i / sr;
      const p = Math.exp(-t / tau) - Math.exp(-t / 0.00022);
      x[s0 + i] += A * (p + 0.18 * (r() * 2 - 1) * Math.exp(-t / (tau * 0.4)));
    }
  }
  // exhaust: feedback comb (pipe) + resonant body + muffling
  const D = Math.floor(sr / 173), comb = new Float32Array(D);
  let ci = 0;
  const res = [new Biquad(sr, 'bp', 105, 1.1), new Biquad(sr, 'bp', 240, 1.8), new Biquad(sr, 'bp', 520, 2.6), new Biquad(sr, 'bp', 1180, 2.2), new Biquad(sr, 'bp', 2300, 2.0)];
  const resG = [1.0, 0.85, 0.55, 0.35, 0.15];
  const lp = new Biquad(sr, 'lp', 2600, 0.6), lp2 = new Biquad(sr, 'lp', 4200, 0.6), hp = new Biquad(sr, 'hp', 32, 0.7);
  const out = new Float32Array(n);
  const intake = new Biquad(sr, 'bp', 3200, 1.2);
  let wph = 0;
  for (let i = 0; i < n; i++) {
    const c = x[i] + comb[ci] * 0.52;
    comb[ci] = c; ci = (ci + 1) % D;
    let y = c * 0.35;
    for (let k = 0; k < res.length; k++) y += res[k].p(c) * resG[k];
    y = lp2.p(lp.p(y));
    y += intake.p((r() * 2 - 1) * Math.abs(x[i])) * 0.05;
    if (whine) { wph += 2 * Math.PI * f0 * 3.02 / sr; y += Math.sin(wph) * whine * 0.06 + Math.sin(wph * 2.003) * whine * 0.025; }
    out[i] = hp.p(softclip(y * 1.6, 2.2));
  }
  const loop = makeLoop(out, sr, fade);
  normalize([loop], 0.8);
  return { sr, ch: [loop], loop: true, meta: { f0 } };
}

// ---------------------------------------------------------------------------
// Boost: turbulent rocket roar, hiss, crackle and a faint jet whine
// ---------------------------------------------------------------------------
function boostLoop() {
  const sr = SR, dur = 2.6, fade = 0.3, r = rng(4242);
  const ch = [];
  for (let c = 0; c < 2; c++) {
    const n = Math.floor((dur + fade) * sr);
    const o = new Float32Array(n);
    const br = brownGen(r), pk = pinkGen(r);
    const lp1 = new Biquad(sr, 'lp', 900, 0.7), bp1 = new Biquad(sr, 'bp', 320, 0.8);
    const hiss = new Biquad(sr, 'hp', 2600, 0.7), hiss2 = new Biquad(sr, 'lp', 9500, 0.7);
    const whine = new Biquad(sr, 'bp', 1150 + c * 40, 22);
    const crk = new Biquad(sr, 'bp', 3200, 1.2);
    const m1 = smoothRand(r, sr, 24), m2 = smoothRand(r, sr, 7), m3 = smoothRand(r, sr, 40);
    let crackEnv = 0;
    for (let i = 0; i < n; i++) {
      const mod = 1 + 0.32 * m1() + 0.18 * m2();
      let y = lp1.p(br()) * 1.4 * mod + bp1.p(pk()) * 1.1 * mod;
      y += hiss2.p(hiss.p(r() * 2 - 1)) * 0.22 * (1 + 0.3 * m3());
      if (r() < 95 / sr) crackEnv = 0.6 + r() * 0.8;
      crackEnv *= 0.9965;
      y += crk.p((r() * 2 - 1) * crackEnv) * 0.5;
      y += whine.p(r() * 2 - 1) * 0.35;
      o[i] = softclip(y * 0.9, 1.6);
    }
    ch.push(makeLoop(o, sr, fade));
  }
  normalize(ch, 0.75);
  return { sr, ch, loop: true };
}

function boostStart() {
  const sr = SR, r = rng(77), n = Math.floor(0.55 * sr);
  const ch = [];
  for (let c = 0; c < 2; c++) {
    const o = new Float32Array(n);
    const bp = new Biquad(sr, 'bp', 200, 0.9), pk = pinkGen(r);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      bp.set(200 + 3200 * Math.min(1, t / 0.22), 0.9);
      const env = Math.min(1, t / 0.015) * Math.exp(-t / 0.18);
      o[i] = bp.p(pk() * 3) * env;
    }
    addModes(o, sr, 0, [[58, 0.9, 0.12], [92, 0.4, 0.08]], r, 0.6, 0.04);
    for (let i = 0; i < n; i++) o[i] = softclip(o[i], 1.8);
    ch.push(fadeEdges(o, sr, 0.001, 0.05));
  }
  normalize(ch, 0.85);
  return { sr, ch };
}

// ---------------------------------------------------------------------------
// Impacts (modal synthesis)
// ---------------------------------------------------------------------------
function ballHit(strength, seed) {
  const sr = SR, r = rng(seed), n = Math.floor(1.3 * sr);
  const o = new Float32Array(n);
  // contact smack: short broadband burst, brighter for hard hits
  const hp = new Biquad(sr, 'hp', 900 + strength * 1500, 0.7);
  const clickLen = Math.floor((0.003 + strength * 0.003) * sr);
  for (let i = 0; i < clickLen; i++) o[i] += hp.p((r() * 2 - 1)) * Math.exp(-i / (0.0009 * sr)) * (0.25 + 0.9 * strength);
  // low boom of the air inside the ball, pitch drops as it settles
  addModes(o, sr, 0, [[88 + strength * 10, 1.0, 0.09 + 0.09 * strength], [176, 0.25, 0.05]], r, 0.85, 0.025);
  // hollow shell modes
  const base = 196 + r() * 18;
  const k = 0.45 + 0.55 * strength;
  addModes(o, sr, 0, [
    [base, 0.55 * k, 0.24], [base * 1.51, 0.42 * k, 0.18], [base * 2.07, 0.33 * k, 0.13], [base * 2.76, 0.24 * k, 0.09],
    [base * 3.58, 0.17 * k * k, 0.06], [base * 4.63, 0.12 * k * k, 0.045], [base * 6.05, 0.08 * k * k, 0.03],
  ], r, 0.05, 0.02);
  // rubbery thud
  const lp = new Biquad(sr, 'lp', 500, 0.8);
  for (let i = 0; i < Math.floor(0.03 * sr); i++) o[i] += lp.p(r() * 2 - 1) * Math.exp(-i / (0.008 * sr)) * 0.6;
  for (let i = 0; i < n; i++) o[i] = softclip(o[i] * (1.2 + strength), 1.5 + strength);
  fadeEdges(o, sr, 0.0005, 0.2);
  normalize([o], 0.92);
  return { sr, ch: [o] };
}

function bounceFloor(seed) {
  const sr = SR, r = rng(seed), n = Math.floor(0.45 * sr);
  const o = new Float32Array(n);
  addModes(o, sr, 0, [[78, 1.0, 0.075], [142, 0.4, 0.05], [205, 0.2, 0.04]], r, 0.5, 0.02);
  const lp = new Biquad(sr, 'lp', 700, 0.7), bp = new Biquad(sr, 'bp', 1900, 1.1);
  for (let i = 0; i < Math.floor(0.05 * sr); i++) {
    const w = r() * 2 - 1;
    o[i] += lp.p(w) * Math.exp(-i / (0.01 * sr)) * 0.8 + bp.p(w) * Math.exp(-i / (0.004 * sr)) * 0.5;
  }
  for (let i = 0; i < n; i++) o[i] = softclip(o[i] * 1.4, 1.6);
  fadeEdges(o, sr, 0.0005, 0.1);
  normalize([o], 0.9);
  return { sr, ch: [o] };
}

function bounceWall(seed) {
  // the ball slapping the arena's glass/steel panels: a ringing plate
  const sr = SR, r = rng(seed), n = Math.floor(1.1 * sr);
  const o = new Float32Array(n);
  const plate = [132, 251, 389, 612, 877, 1243, 1790, 2560, 3420].map((f, i) => [f * (0.97 + r() * 0.06), 0.6 / (1 + i * 0.5), 0.32 / (1 + i * 0.35)]);
  addModes(o, sr, 0, plate, r, 0.02, 0.01);
  addModes(o, sr, 0, [[92, 0.9, 0.08]], r, 0.7, 0.02);
  const hp = new Biquad(sr, 'hp', 1500, 0.7);
  for (let i = 0; i < Math.floor(0.004 * sr); i++) o[i] += hp.p(r() * 2 - 1) * 0.7;
  for (let i = 0; i < n; i++) o[i] = softclip(o[i] * 1.3, 1.4);
  fadeEdges(o, sr, 0.0005, 0.25);
  normalize([o], 0.9);
  return { sr, ch: [o] };
}

function metalHit(seed, heavy) {
  // car body against wall / another car: sheet-metal clang + crunch + thud
  const sr = SR, r = rng(seed), n = Math.floor((heavy ? 1.0 : 0.7) * sr);
  const o = new Float32Array(n);
  const freqs = [210, 347, 489, 702, 951, 1308, 1777, 2410, 3120, 4280];
  addModes(o, sr, 0, freqs.map((f, i) => [f * (0.9 + r() * 0.2), (0.5 + r() * 0.5) / (1 + i * 0.4), (0.07 + r() * 0.2) / (1 + i * 0.15)]), r, 0.01, 0.01);
  addModes(o, sr, 0, [[62, heavy ? 1.2 : 0.7, 0.09]], r, 0.5, 0.02);
  const bp = new Biquad(sr, 'bp', 1600, 0.7);
  const crunchLen = Math.floor((heavy ? 0.09 : 0.05) * sr);
  let burst = 0;
  for (let i = 0; i < crunchLen; i++) {
    if (r() < 0.004) burst = 0.6 + r() * 0.6;
    burst *= 0.993;
    o[i] += bp.p((r() * 2 - 1) * burst) * 0.9;
  }
  for (let i = 0; i < n; i++) o[i] = softclip(o[i] * 1.5, 2);
  fadeEdges(o, sr, 0.0005, 0.15);
  normalize([o], 0.9);
  return { sr, ch: [o] };
}

// ---------------------------------------------------------------------------
// Movement: jump puff, dodge whoosh, landing
// ---------------------------------------------------------------------------
function jumpPuff(seed) {
  const sr = SR, r = rng(seed), n = Math.floor(0.3 * sr);
  const o = new Float32Array(n);
  const bp = new Biquad(sr, 'bp', 1500, 1.4), pk = pinkGen(r);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    bp.set(1600 - 900 * Math.min(1, t / 0.18), 1.4);
    o[i] = bp.p(pk() * 4) * Math.min(1, t / 0.006) * Math.exp(-t / 0.07);
  }
  addModes(o, sr, 0, [[84, 0.6, 0.045], [160, 0.2, 0.03]], r, 0.4, 0.02);
  fadeEdges(o, sr, 0.0005, 0.05);
  normalize([o], 0.85);
  return { sr, ch: [o] };
}

function whoosh(seed, dur = 0.45, f0 = 350, f1 = 2000) {
  const sr = SR, r = rng(seed), n = Math.floor(dur * sr);
  const ch = [];
  for (let c = 0; c < 2; c++) {
    const o = new Float32Array(n);
    const bp = new Biquad(sr, 'bp', f0, 1.6), bp2 = new Biquad(sr, 'bp', f0 * 2, 2.5);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const bell = Math.sin(Math.PI * Math.pow(t, 0.7));
      const f = f0 + (f1 - f0) * Math.sin(Math.PI * Math.min(1, t * 1.15)) ;
      bp.set(f * (c ? 1.04 : 0.97), 1.6); bp2.set(f * 2.1, 2.5);
      const w = r() * 2 - 1;
      o[i] = (bp.p(w) * 1.6 + bp2.p(w) * 0.6) * bell * bell;
    }
    ch.push(fadeEdges(o, sr, 0.002, 0.05));
  }
  normalize(ch, 0.8);
  return { sr, ch };
}

function landThud(seed) {
  const sr = SR, r = rng(seed), n = Math.floor(0.35 * sr);
  const o = new Float32Array(n);
  addModes(o, sr, 0, [[66, 1, 0.07], [118, 0.35, 0.05]], r, 0.35, 0.02);
  const lp = new Biquad(sr, 'lp', 450, 0.8), creak = new Biquad(sr, 'bp', 2400, 9);
  for (let i = 0; i < Math.floor(0.06 * sr); i++) {
    const w = r() * 2 - 1, t = i / sr;
    o[i] += lp.p(w) * Math.exp(-t / 0.012) * 0.9 + creak.p(w) * Math.exp(-t / 0.03) * 0.35;
  }
  for (let i = 0; i < n; i++) o[i] = softclip(o[i] * 1.3, 1.5);
  fadeEdges(o, sr, 0.0005, 0.08);
  normalize([o], 0.85);
  return { sr, ch: [o] };
}

// ---------------------------------------------------------------------------
// Boost pickups
// ---------------------------------------------------------------------------
function bell(o, sr, start, f, amp, decay, r) {
  addModes(o, sr, start, [[f, amp, decay], [f * 2.0, amp * 0.45, decay * 0.6], [f * 2.76, amp * 0.35, decay * 0.45], [f * 5.4, amp * 0.15, decay * 0.25], [f * 8.93, amp * 0.06, decay * 0.15]], r);
}

function padSmall() {
  const sr = SR, r = rng(91), n = Math.floor(0.6 * sr);
  const o = new Float32Array(n);
  const bp = new Biquad(sr, 'bp', 1200, 2);
  for (let i = 0; i < Math.floor(0.09 * sr); i++) {
    const t = i / sr;
    bp.set(1200 + 4500 * (t / 0.09), 2);
    o[i] += bp.p(r() * 2 - 1) * Math.sin(Math.PI * t / 0.09) * 0.9;
  }
  bell(o, sr, Math.floor(0.035 * sr), 1567.98, 0.32, 0.22, r);
  fadeEdges(o, sr, 0.001, 0.1);
  normalize([o], 0.7);
  return { sr, ch: [o] };
}

function padBig() {
  const sr = SR, r = rng(92), n = Math.floor(1.3 * sr);
  const ch = [];
  for (let c = 0; c < 2; c++) {
    const o = new Float32Array(n);
    const bp = new Biquad(sr, 'bp', 300, 1.2), pk = pinkGen(r);
    for (let i = 0; i < Math.floor(0.4 * sr); i++) {
      const t = i / sr;
      bp.set(300 + 3500 * Math.pow(t / 0.4, 1.4), 1.2);
      o[i] += bp.p(pk() * 4) * Math.sin(Math.PI * Math.min(1, t / 0.4)) * 0.8;
    }
    addModes(o, sr, 0, [[55, 0.8, 0.18]], r, 0.5, 0.05);
    for (const [f, d] of [[523.25, 0.12], [659.25, 0.16], [783.99, 0.2], [1046.5, 0.26]]) bell(o, sr, Math.floor(d * sr), f * (c ? 1.002 : 1), 0.22, 0.55, r);
    ch.push(fadeEdges(o, sr, 0.001, 0.2));
  }
  normalize(ch, 0.75);
  return { sr, ch };
}

// ---------------------------------------------------------------------------
// Supersonic / wind / powerslide
// ---------------------------------------------------------------------------
function supersonicRush() {
  const sr = SR, r = rng(55), n = Math.floor(1.4 * sr);
  const ch = [];
  for (let c = 0; c < 2; c++) {
    const o = new Float32Array(n);
    const bp = new Biquad(sr, 'bp', 400, 0.9), pk = pinkGen(r);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      bp.set(400 + 1400 * Math.min(1, t / 0.45), 0.9);
      const env = Math.min(1, t / 0.35) * Math.exp(-Math.max(0, t - 0.35) / 0.35);
      o[i] = bp.p(pk() * 4) * env;
    }
    addModes(o, sr, Math.floor(0.3 * sr), [[48, 0.7, 0.2]], r, 0.3, 0.05);
    ch.push(fadeEdges(o, sr, 0.005, 0.2));
  }
  normalize(ch, 0.7);
  return { sr, ch };
}

function windLoop() {
  const sr = SR, r = rng(66), dur = 3, fade = 0.4;
  const ch = [];
  for (let c = 0; c < 2; c++) {
    const n = Math.floor((dur + fade) * sr), o = new Float32Array(n);
    const bp = new Biquad(sr, 'bp', 850, 0.6), hp = new Biquad(sr, 'hp', 3000, 0.7), pk = pinkGen(r);
    const m = smoothRand(r, sr, 3), m2 = smoothRand(r, sr, 11);
    for (let i = 0; i < n; i++) {
      bp.set(850 * (1 + 0.25 * m()), 0.6);
      o[i] = bp.p(pk() * 3) * (1 + 0.25 * m2()) + hp.p(r() * 2 - 1) * 0.12;
    }
    ch.push(makeLoop(o, sr, fade));
  }
  normalize(ch, 0.7);
  return { sr, ch, loop: true };
}

function skidLoop() {
  const sr = SR, r = rng(31), dur = 2.2, fade = 0.3;
  const ch = [];
  for (let c = 0; c < 2; c++) {
    const n = Math.floor((dur + fade) * sr), o = new Float32Array(n);
    const sq1 = new Biquad(sr, 'bp', 1050, 28), sq2 = new Biquad(sr, 'bp', 2150, 26);
    const turf = new Biquad(sr, 'bp', 900, 0.8), turf2 = new Biquad(sr, 'hp', 2500, 0.7);
    const wander = smoothRand(r, sr, 2.2), slip = smoothRand(r, sr, 38);
    let grain = 0;
    for (let i = 0; i < n; i++) {
      const f = 1050 * (1 + 0.06 * wander());
      sq1.set(f, 28); sq2.set(f * 2.05, 26);
      const w = r() * 2 - 1;
      const stick = 0.55 + 0.45 * slip();
      if (r() < 70 / sr) grain = 0.5 + r();
      grain *= 0.9975;
      o[i] = (sq1.p(w) * 3.0 + sq2.p(w) * 1.2) * stick * 0.45 + turf.p(w) * grain * 1.2 + turf2.p(w) * grain * 0.25;
      o[i] = softclip(o[i], 1.3);
    }
    ch.push(makeLoop(o, sr, fade));
  }
  normalize(ch, 0.7);
  return { sr, ch, loop: true };
}

// ---------------------------------------------------------------------------
// Explosions
// ---------------------------------------------------------------------------
function explosion(seed, size, dur, fireworks) {
  const sr = SR, r = rng(seed), n = Math.floor(dur * sr);
  const ch = [];
  for (let c = 0; c < 2; c++) {
    const o = new Float32Array(n);
    const br = brownGen(r), pk = pinkGen(r), br2 = brownGen(r);
    const lpBoom = new Biquad(sr, 'lp', 140, 0.7), lpBoom2 = new Biquad(sr, 'lp', 140, 0.7);
    const body = new Biquad(sr, 'lp', 4000, 0.7), rum = new Biquad(sr, 'lp', 75, 0.7);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const crack = t < 0.008 ? (r() * 2 - 1) * Math.exp(-t / 0.0025) * 1.2 : 0;
      const boom = lpBoom2.p(lpBoom.p(br())) * 4.5 * Math.min(1, t / 0.004) * Math.exp(-t / (0.45 * size));
      body.set(250 + 3800 * Math.exp(-t / (0.35 * size)), 0.7);
      const mid = body.p(pk() * 3) * Math.min(1, t / 0.003) * Math.exp(-t / (0.32 * size));
      const rumble = rum.p(br2()) * 3.5 * Math.exp(-t / (1.1 * size)) * Math.min(1, t / 0.05);
      o[i] = crack + boom + mid + rumble;
    }
    addModes(o, sr, 0, [[58, 1.2 * size, 0.38 * size]], r, 0.9, 0.08);
    // debris pings and crackle
    const pings = Math.floor(30 * size);
    for (let k = 0; k < pings; k++) {
      const t = 0.05 + Math.pow(r(), 1.8) * (dur * 0.6);
      addModes(o, sr, Math.floor(t * sr), [[1800 + r() * 4200, 0.05 + r() * 0.1, 0.015 + r() * 0.05]], r);
    }
    if (fireworks) {
      const hp = new Biquad(sr, 'bp', 3200, 0.9);
      let e = 0;
      for (let i = Math.floor(0.6 * sr); i < n; i++) {
        const t = i / sr;
        const dens = Math.max(0, Math.sin(Math.PI * (t - 0.6) / (dur - 0.8))) * 400;
        if (r() < dens / sr) e = 0.4 + r();
        e *= 0.985;
        o[i] += hp.p((r() * 2 - 1) * e) * 0.35;
      }
    }
    for (let i = 0; i < n; i++) o[i] = softclip(o[i] * 0.9, 2.4);
    ch.push(fadeEdges(o, sr, 0.0003, 0.4));
  }
  const rev = bakeReverb(ch, sr, 0.3, 1.3, 0.45);
  normalize(rev, 0.95);
  return { sr, ch: rev };
}

// ---------------------------------------------------------------------------
// Stadium horn / buzzer / beeps / UI
// ---------------------------------------------------------------------------
function horn(dur = 2.7, notes = [233.08, 293.66, 349.23]) {
  const sr = SR, r = rng(13), n = Math.floor((dur + 0.6) * sr);
  // one band-limited brassy cycle (harmonics 1..24, ~1/h^0.85)
  const TL = 4096, table = new Float32Array(TL + 1);
  for (let i = 0; i <= TL; i++) {
    let v = 0;
    for (let h = 1; h <= 24; h++) v += Math.sin(2 * Math.PI * h * i / TL) / Math.pow(h, 0.85);
    table[i] = v;
  }
  const ch = [];
  for (let c = 0; c < 2; c++) {
    const o = new Float32Array(n);
    for (const [vi, f] of notes.entries()) {
      const det = Math.pow(2, ((r() - 0.5) * 8) / 1200);
      const vib = 4.8 + r();
      let ph = r();
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const scoop = 1 - 0.05 * Math.exp(-t / 0.06);
        const ff = f * det * scoop * (1 + 0.0035 * Math.sin(2 * Math.PI * vib * t + vi + c));
        ph += ff / sr; ph -= Math.floor(ph);
        const x = ph * TL, k = x | 0, fr = x - k;
        const s = table[k] + (table[k + 1] - table[k]) * fr;
        const env = Math.min(1, t / 0.06) * (t > dur ? Math.exp(-(t - dur) / 0.12) : 1);
        o[i] += s * env * 0.3;
      }
    }
    const f1 = new Biquad(sr, 'peak', 640, 2, 9), f2 = new Biquad(sr, 'peak', 1250, 3, 7), f3 = new Biquad(sr, 'peak', 2700, 4, 4), lp = new Biquad(sr, 'lp', 6000, 0.7);
    for (let i = 0; i < n; i++) o[i] = softclip(lp.p(f3.p(f2.p(f1.p(o[i])))) * 0.6, 2.2);
    ch.push(fadeEdges(o, sr, 0.002, 0.3));
  }
  const rev = bakeReverb(ch, sr, 0.35, 1.5, 0.35);
  normalize(rev, 0.9);
  return { sr, ch: rev };
}

function tone(freq, dur, bright, seed) {
  const sr = SR, r = rng(seed), n = Math.floor((dur + 0.4) * sr);
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.008) * (t < dur ? 1 : Math.exp(-(t - dur) / 0.06)) * Math.exp(-t / (dur * 2));
    o[i] = (Math.sin(2 * Math.PI * freq * t) + 0.35 * bright * Math.sin(4 * Math.PI * freq * t) + 0.15 * bright * Math.sin(6 * Math.PI * freq * t)) * env;
  }
  const rev = bakeReverb([o, o.slice()], sr, 0.25, 1.2, 0.3);
  normalize(rev, 0.6);
  return { sr, ch: rev };
}

function uiClick(kind) {
  const sr = SR, r = rng(kind.length * 7), n = Math.floor(0.35 * sr);
  const o = new Float32Array(n);
  const hp = new Biquad(sr, 'hp', 3000, 0.7);
  for (let i = 0; i < Math.floor(0.002 * sr); i++) o[i] += hp.p(r() * 2 - 1) * 0.4;
  if (kind === 'move') addModes(o, sr, 0, [[1760, 0.25, 0.025], [3520, 0.08, 0.015]], r);
  else if (kind === 'select') { bell(o, sr, 0, 1318.5, 0.25, 0.12, r); bell(o, sr, Math.floor(0.06 * sr), 1975.5, 0.22, 0.16, r); }
  else { bell(o, sr, 0, 987.8, 0.22, 0.08, r); bell(o, sr, Math.floor(0.06 * sr), 784, 0.2, 0.1, r); }
  fadeEdges(o, sr, 0.0005, 0.05);
  normalize([o], 0.5);
  return { sr, ch: [o] };
}

function buzzer() {
  const sr = SR, n = Math.floor(1.6 * sr), r = rng(5);
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let s = 0;
    for (let h = 1; h < 30; h += 1) s += Math.sin(2 * Math.PI * 118 * h * t + h) / h * (h % 2 ? 1 : 0.6);
    o[i] = s * Math.min(1, t / 0.02) * (t > 1.2 ? Math.exp(-(t - 1.2) / 0.08) : 1);
  }
  const f = new Biquad(sr, 'peak', 900, 2, 8), lp = new Biquad(sr, 'lp', 4500, 0.7);
  for (let i = 0; i < n; i++) o[i] = softclip(lp.p(f.p(o[i])) * 0.5, 2);
  const rev = bakeReverb([o, o.slice()], sr, 0.35, 1.5, 0.3);
  normalize(rev, 0.75);
  return { sr, ch: rev };
}

// ---------------------------------------------------------------------------
// Crowd: formant voices, claps, whistles
// ---------------------------------------------------------------------------
const VOWELS = {
  a: [730, 1090, 2440], e: [530, 1840, 2480], i: [270, 2290, 3010], o: [570, 840, 2410], u: [300, 870, 2240], ae: [660, 1720, 2410], er: [490, 1350, 1690], uh: [640, 1190, 2390],
};
const VK = Object.keys(VOWELS);

/**
 * One synthetic voice. mode: 'chatter' (speech-like syllables), 'shout'
 * (sustained excited vowels), 'ooh' (falling 'ooh'). Returns mono buffer.
 */
function voice(sr, n, r, mode, f0base, female) {
  const o = new Float32Array(n);
  const fs = female ? 1.17 : 1;
  const b1 = new Biquad(sr, 'bp', 500, 7), b2 = new Biquad(sr, 'bp', 1500, 9), b3 = new Biquad(sr, 'bp', 2500, 10);
  const lp = new OnePole(sr, 3200);
  const pitchWander = smoothRand(r, sr, 1.5 + r() * 2);
  let phase = r(), cur = VOWELS[VK[Math.floor(r() * VK.length)]].map((f) => f * fs), target = cur.slice();
  let sylT = 0, sylLen = 0, gap = 0, amp = 0, ampT = 0, contour = 0;
  const pickSyl = () => {
    if (mode === 'chatter') { sylLen = 0.09 + r() * 0.25; gap = r() < 0.25 ? 0.15 + r() * 0.5 : 0.02 + r() * 0.08; ampT = 0.3 + r() * 0.7; }
    else if (mode === 'shout') { sylLen = 0.35 + r() * 1.1; gap = 0.05 + r() * 0.3; ampT = 0.6 + r() * 0.4; }
    else { sylLen = 1.2 + r() * 0.6; gap = 2; ampT = 0.7 + r() * 0.3; }
    const v = mode === 'ooh' ? (r() < 0.6 ? 'u' : 'o') : mode === 'shout' ? ['a', 'ae', 'o', 'e', 'uh'][Math.floor(r() * 5)] : VK[Math.floor(r() * VK.length)];
    target = VOWELS[v].map((f) => f * fs * (0.95 + r() * 0.1));
    contour = mode === 'shout' ? 0.15 + r() * 0.25 : mode === 'ooh' ? -0.35 : (r() - 0.5) * 0.3;
    sylT = 0;
  };
  pickSyl();
  sylT = -r() * 0.5; // stagger starts
  for (let i = 0; i < n; i++) {
    sylT += 1 / sr;
    if (sylT > sylLen + gap) pickSyl();
    const inSyl = sylT >= 0 && sylT < sylLen;
    const st = Math.max(0, sylT) / sylLen;
    const a = inSyl ? Math.min(1, sylT / 0.025) * Math.min(1, (sylLen - sylT) / 0.06) * ampT : 0;
    amp += (a - amp) * 0.003;
    if ((i & 31) === 0) {
      for (let k = 0; k < 3; k++) cur[k] += (target[k] - cur[k]) * 0.08;
      b1.set(cur[0], 6); b2.set(cur[1], 9); b3.set(cur[2], 11);
    }
    const f0 = f0base * (1 + 0.06 * pitchWander() + contour * (inSyl ? st : 0)) * (1 + (r() - 0.5) * 0.01);
    phase += f0 / sr;
    if (phase >= 1) phase -= 1;
    // glottal pulse: smooth opening, sharp closure, plus breath noise
    const g = (phase < 0.65 ? 0.5 - 0.5 * Math.cos(Math.PI * phase / 0.65) : Math.cos(0.5 * Math.PI * (phase - 0.65) / 0.35)) - 0.45;
    const src = lp.p(g) + (r() * 2 - 1) * 0.06;
    o[i] = (b1.p(src) * 1.0 + b2.p(src) * 0.6 + b3.p(src) * 0.35) * amp;
  }
  return o;
}

function claps(sr, n, r, count, envFn, out) {
  // granular applause: each clapper claps at their own tempo with jitter
  for (let k = 0; k < count; k++) {
    const pan = r(), gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    const rate = 3.2 + r() * 3;
    const res = 900 + r() * 1700, q = 1.2 + r() * 2;
    const bp = new Biquad(sr, 'bp', res, q);
    const dist = 0.3 + r() * 0.7;
    let t = r() / rate;
    const T = n / sr;
    while (t < T) {
      const e = envFn(t);
      if (r() < e) {
        const s0 = Math.floor(t * sr), len = Math.floor((0.006 + r() * 0.01) * sr), amp = (0.4 + r() * 0.6) * dist;
        bp.x1 = bp.x2 = bp.y1 = bp.y2 = 0;
        for (let i = 0; i < len && s0 + i < n; i++) {
          const v = bp.p((r() * 2 - 1)) * amp * Math.exp(-i / (0.0018 * sr));
          out[0][s0 + i] += v * gl; out[1][s0 + i] += v * gr;
        }
      }
      t += (1 / rate) * (0.85 + r() * 0.3);
    }
  }
}

function crowdMix(sr, dur, voices, mode, f0range, envFn, seed, opts = {}) {
  const r = rng(seed), n = Math.floor(dur * sr);
  const out = [new Float32Array(n), new Float32Array(n)];
  for (let v = 0; v < voices; v++) {
    const female = r() < 0.45;
    const f0 = (f0range[0] + r() * (f0range[1] - f0range[0])) * (female ? 1.6 : 1);
    const vb = voice(sr, n, r, mode, f0, female);
    const pan = r(), gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    const g = 0.4 + r() * 0.6;
    for (let i = 0; i < n; i++) { const e = envFn(i / sr) * g; out[0][i] += vb[i] * gl * e; out[1][i] += vb[i] * gr * e; }
  }
  // dense bed: thousands of distant voices smeared into noise
  for (let c = 0; c < 2; c++) {
    const pk = pinkGen(r), bp = new Biquad(sr, 'bp', 650, 0.6), bp2 = new Biquad(sr, 'bp', 1600, 1.2);
    const m = smoothRand(r, sr, 1.3), m2 = smoothRand(r, sr, 6);
    for (let i = 0; i < n; i++) {
      const w = pk();
      out[c][i] += (bp.p(w) * 1.6 + bp2.p(w) * 0.6) * (opts.bed ?? 0.5) * (1 + 0.25 * m() + 0.1 * m2()) * envFn(i / sr);
    }
  }
  if (opts.claps) claps(sr, n, r, opts.claps, opts.clapEnv || envFn, out);
  if (opts.whistles) {
    for (let w = 0; w < opts.whistles; w++) {
      const t0 = r() * dur * 0.5, len = 0.4 + r() * 0.9, f = 1900 + r() * 1400, s0 = Math.floor(t0 * sr), m = Math.floor(len * sr);
      const pan = r();
      let ph = 0;
      for (let i = 0; i < m && s0 + i < n; i++) {
        const t = i / sr;
        const glide = 1 + 0.12 * Math.sin(Math.PI * t / len) * (w % 2 ? 1 : -1);
        ph += 2 * Math.PI * f * glide * (1 + 0.01 * Math.sin(2 * Math.PI * 6 * t)) / sr;
        const e = Math.min(1, t / 0.03) * Math.min(1, (len - t) / 0.08) * 0.12 * envFn(t0 + t);
        const v = (Math.sin(ph) + 0.15 * Math.sin(2 * ph) + (r() - 0.5) * 0.08) * e;
        out[0][s0 + i] += v * (1 - pan); out[1][s0 + i] += v * pan;
      }
    }
  }
  const lp0 = new Biquad(sr, 'lp', opts.lp || 5200, 0.7), lp1 = new Biquad(sr, 'lp', opts.lp || 5200, 0.7);
  for (let i = 0; i < n; i++) { out[0][i] = lp0.p(out[0][i]); out[1][i] = lp1.p(out[1][i]); }
  return bakeReverb(out, sr, opts.reverb ?? 0.4, 1.6, 0.5);
}

function crowdLoop() {
  const sr = CROWD_SR, dur = 11, fade = 1.0;
  const mix = crowdMix(sr, dur + fade, 26, 'chatter', [95, 165], () => 1, 2024, { bed: 0.65, lp: 4200 });
  const ch = mix.map((c) => makeLoop(c, sr, fade));
  normalize(ch, 0.7);
  return { sr, ch, loop: true };
}

function cheer() {
  const sr = CROWD_SR, dur = 6;
  const env = (t) => Math.min(1, t / 0.35) * (t < 2.4 ? 1 : Math.exp(-(t - 2.4) / 1.3));
  const mix = crowdMix(sr, dur, 30, 'shout', [140, 260], env, 777, { bed: 1.0, claps: 160, whistles: 6, clapEnv: (t) => (t < 0.4 ? t / 0.4 : t < 3 ? 1 : Math.exp(-(t - 3) / 1.1)), reverb: 0.45 });
  normalize(mix, 0.9);
  return { sr, ch: mix.map((c) => fadeEdges(c, sr, 0.01, 0.6)) };
}

function ooh() {
  const sr = CROWD_SR, dur = 2.6;
  const env = (t) => Math.min(1, t / 0.25) * (t < 1.0 ? 1 : Math.exp(-(t - 1.0) / 0.6));
  const mix = crowdMix(sr, dur, 26, 'ooh', [120, 210], env, 4242, { bed: 0.6, reverb: 0.45 });
  normalize(mix, 0.85);
  return { sr, ch: mix.map((c) => fadeEdges(c, sr, 0.01, 0.4)) };
}

function applause() {
  const sr = CROWD_SR, dur = 5, r = rng(31337), n = Math.floor(dur * sr);
  const out = [new Float32Array(n), new Float32Array(n)];
  claps(sr, n, r, 260, (t) => (t < 0.25 ? t / 0.25 : t < 2.5 ? 1 : Math.exp(-(t - 2.5) / 1)), out);
  const rev = bakeReverb(out, sr, 0.4, 1.6, 0.5);
  normalize(rev, 0.8);
  return { sr, ch: rev.map((c) => fadeEdges(c, sr, 0.01, 0.4)) };
}

// ---------------------------------------------------------------------------
// Stadium impulse response for the runtime convolution reverb
// ---------------------------------------------------------------------------
function stadiumIR() {
  const sr = SR, dur = 3.0, n = Math.floor(dur * sr), r = rng(8080);
  const ch = [];
  for (let c = 0; c < 2; c++) {
    const o = new Float32Array(n);
    const lp = new OnePole(sr, 9000);
    const pre = Math.floor(0.014 * sr);
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      lp.set(9000 * Math.exp(-t / 0.9) + 900);
      o[i] = lp.p(r() * 2 - 1) * Math.exp(-t / 0.42) * Math.min(1, t / 0.02);
    }
    // early reflections off stands / roof
    for (let k = 0; k < 10; k++) {
      const t = 0.018 + r() * 0.11, i = Math.floor(t * sr);
      o[i] += (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.5) * Math.exp(-t / 0.15);
    }
    ch.push(o);
  }
  normalize(ch, 0.6);
  return { sr, ch };
}

// Ordered so the most important sounds are ready first.
export const SOUND_LIST = [
  ['ui_move', () => uiClick('move')], ['ui_select', () => uiClick('select')], ['ui_back', () => uiClick('back')],
  ['ir', stadiumIR],
  ['engine_low', () => engineLoop(56, 1, 0)], ['engine_mid', () => engineLoop(150, 2, 0.4)], ['engine_high', () => engineLoop(330, 3, 1)],
  ['boost_loop', boostLoop], ['boost_start', boostStart],
  ['hit_soft', () => ballHit(0.2, 11)], ['hit_med', () => ballHit(0.55, 12)], ['hit_hard', () => ballHit(1.0, 13)],
  ['bounce_floor', () => bounceFloor(21)], ['bounce_wall', () => bounceWall(22)],
  ['car_wall', () => metalHit(31, false)], ['car_bump', () => metalHit(32, true)],
  ['jump', () => jumpPuff(41)], ['dodge', () => whoosh(42, 0.45, 320, 1900)], ['double_jump', () => whoosh(43, 0.3, 500, 1500)], ['land', () => landThud(44)],
  ['pad_small', padSmall], ['pad_big', padBig],
  ['supersonic', supersonicRush], ['wind_loop', windLoop], ['skid_loop', skidLoop],
  ['beep', () => tone(880, 0.16, 0.6, 1)], ['go', () => tone(1318.5, 0.5, 1, 2)],
  ['demo', () => explosion(51, 1.0, 2.6, false)], ['goal_boom', () => explosion(52, 1.7, 4.5, true)],
  ['horn', () => horn(2.7)], ['horn_short', () => horn(0.9, [261.63, 329.63, 392.0])], ['buzzer', buzzer],
  ['crowd_loop', crowdLoop], ['cheer', cheer], ['ooh', ooh], ['applause', applause],
];
