// Offline DSP toolkit for synthesising the game's sound effects from simple
// physical models (combustion pulses through resonant pipes, modal impact
// synthesis, turbulent noise, formant voices, granular applause).
// Pure JS: runs in a Web Worker in the browser and in Node for previews.

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ biquad. type: lp | hp | bp | peak | notch | ls | hs */
export class Biquad {
  constructor(sr, type, freq, q = 0.707, gainDb = 0) { this.sr = sr; this.type = type; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(freq, q, gainDb); }
  set(freq, q = this.q, gainDb = this.g) {
    this.f = freq; this.q = q; this.g = gainDb;
    const w = 2 * Math.PI * Math.min(freq, this.sr * 0.49) / this.sr, cw = Math.cos(w), sw = Math.sin(w);
    const alpha = sw / (2 * q), A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (this.type) {
      case 'lp': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'hp': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'bp': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'peak': b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
      case 'ls': { const s = 2 * Math.sqrt(A) * alpha; b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s); a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break; }
      default: { const s = 2 * Math.sqrt(A) * alpha; b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s); a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; }
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  p(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export class OnePole {
  constructor(sr, freq) { this.sr = sr; this.y = 0; this.set(freq); }
  set(freq) { this.a = 1 - Math.exp(-2 * Math.PI * freq / this.sr); return this; }
  p(x) { this.y += this.a * (x - this.y); return this.y; }
}

/** Pink noise (Paul Kellet's refined filter). */
export function pinkGen(r) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
    const o = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    return o * 0.11;
  };
}
export function brownGen(r) { let y = 0; return () => { y = (y + 0.02 * (r() * 2 - 1)) / 1.02; return y * 3.5; }; }

/** Smooth random value (interpolated) for slow modulations. */
export function smoothRand(r, sr, rateHz) {
  let a = r() * 2 - 1, b = r() * 2 - 1, t = 0;
  const step = rateHz / sr;
  return () => { t += step; if (t >= 1) { t -= 1; a = b; b = r() * 2 - 1; } const s = t * t * (3 - 2 * t); return a + (b - a) * s; };
}

export const tanh = Math.tanh;
export function softclip(x, drive = 1) { return Math.tanh(x * drive) / Math.tanh(drive); }

export function normalize(chs, peak = 0.89) {
  let m = 1e-9;
  for (const c of chs) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > m) m = a; }
  const k = peak / m;
  for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k;
  return chs;
}

/** Equal-power crossfade of the tail into the head so a buffer loops seamlessly. */
export function makeLoop(ch, sr, fadeSec) {
  const f = Math.floor(fadeSec * sr), n = ch.length - f;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ch[i];
  for (let i = 0; i < f; i++) {
    const t = i / f;
    out[i] = ch[i] * Math.sin(t * Math.PI / 2) + ch[n + i] * Math.cos(t * Math.PI / 2);
  }
  return out;
}

export function fadeEdges(ch, sr, inSec = 0.002, outSec = 0.02) {
  const a = Math.floor(inSec * sr), b = Math.floor(outSec * sr), n = ch.length;
  for (let i = 0; i < a && i < n; i++) ch[i] *= i / a;
  for (let i = 0; i < b && i < n; i++) ch[n - 1 - i] *= i / b;
  return ch;
}

/** Decaying sinusoid bank (modal synthesis). modes: [[freq, amp, decaySec], ...] */
export function addModes(out, sr, start, modes, r, pitchBend = 0, bendTime = 0.05) {
  for (const [f, amp, decay] of modes) {
    const ph0 = r() * Math.PI * 2;
    let ph = ph0;
    const n = Math.min(out.length - start, Math.floor(decay * 7 * sr));
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const fr = f * (1 + pitchBend * Math.exp(-t / bendTime));
      ph += 2 * Math.PI * fr / sr;
      out[start + i] += Math.sin(ph) * amp * Math.exp(-t / decay);
    }
  }
}

/** Simple stereo Schroeder/Moorer reverb for baking room tone into one-shots. */
export function bakeReverb(chs, sr, mix = 0.2, size = 1, damp = 0.4, seed = 3) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map((d) => Math.floor(d * size * sr / 44100));
  const aps = [556, 441, 341, 225].map((d) => Math.floor(d * sr / 44100));
  const out = chs.map((c) => new Float32Array(c.length));
  chs.forEach((input, ci) => {
    const spread = ci * 23;
    const cb = combs.map((d) => ({ buf: new Float32Array(d + spread), i: 0, store: 0 }));
    const ab = aps.map((d) => ({ buf: new Float32Array(d + spread), i: 0 }));
    const fb = 0.84, d1 = damp, d2 = 1 - damp;
    for (let n = 0; n < input.length; n++) {
      const x = input[n] * 0.015;
      let s = 0;
      for (const c of cb) {
        const y = c.buf[c.i];
        c.store = y * d2 + c.store * d1;
        c.buf[c.i] = x + c.store * fb;
        c.i = (c.i + 1) % c.buf.length;
        s += y;
      }
      for (const a of ab) {
        const b = a.buf[a.i];
        a.buf[a.i] = s + b * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        s = b - s;
      }
      out[ci][n] = input[n] * (1 - mix) + s * mix * 3;
    }
  });
  return out;
}

export function buf(sr, sec) { return new Float32Array(Math.max(1, Math.floor(sr * sec))); }
