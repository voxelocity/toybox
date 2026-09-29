// Road, edge kits, tunnels, elevated decks and start gantry, emitted into
// per-chunk geometry so the scenery can be frustum-culled in pieces.
import { Geo } from '../geo/builder.js';

export const CHUNK = 110; // metres of track per chunk

const hexToRgb = (h) => {
  const n = parseInt(String(h).replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
export const rgb = (c) => (Array.isArray(c) ? c : hexToRgb(c));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const EDGE_DEFAULTS = {
  sidewalk: { width: 4.5, surface: 'pave', lift: 0.18 },
  shoulder: { width: 2.5, surface: 'asphalt', lift: 0 },
  barrier: { width: 2.0, surface: 'asphalt', lift: 0 },
  guardrail: { width: 2.8, surface: 'gravel', lift: 0 },
  rock: { width: 2.2, surface: 'gravel', lift: 0 },
  neon: { width: 1.5, surface: 'asphalt', lift: 0 },
  fence: { width: 3, surface: 'concrete', lift: 0 },
  grass: { width: 5, surface: 'grass', lift: 0 },
  open: { width: 12, surface: 'pave', lift: 0.02 },
  quay: { width: 3, surface: 'concrete', lift: 0.1 },
  none: { width: 1, surface: 'asphalt', lift: 0 },
};

/** Chunked geometry sink. */
export class Chunks {
  constructor(path) {
    this.path = path;
    this.n = Math.max(1, Math.round(path.length / CHUNK));
    this.len = path.length / this.n;
    this.world = Array.from({ length: this.n }, () => new Geo());
    this.signs = Array.from({ length: this.n }, () => new Geo());
    this.glow = Array.from({ length: this.n }, () => new Geo());
  }
  idx(s) { return Math.min(this.n - 1, Math.floor(this.path.wrapS(s) / this.len)); }
  W(s) { return this.world[this.idx(s)]; }
  S(s) { return this.signs[this.idx(s)]; }
  L(s) { return this.glow[this.idx(s)]; }
}

/** Resolve per-sample edge specs from the track definition. */
export function resolveEdges(path, def) {
  const N = path.N;
  const L = new Array(N), R = new Array(N);
  const base = { kind: 'barrier' };
  for (let i = 0; i < N; i++) { L[i] = base; R[i] = base; }
  for (const e of def.edges || []) {
    const i0 = Math.floor(e.from * N), i1 = Math.ceil(e.to * N);
    for (let k = i0; k < i1; k++) {
      const i = ((k % N) + N) % N;
      if (e.both) { L[i] = e.both; R[i] = e.both; }
      if (e.left) L[i] = e.left;
      if (e.right) R[i] = e.right;
    }
  }
  const norm = (e) => ({ ...EDGE_DEFAULTS[e.kind], ...e });
  const cache = new Map();
  const nm = (e) => { if (!cache.has(e)) cache.set(e, norm(e)); return cache.get(e); };
  for (let i = 0; i < N; i++) { L[i] = nm(L[i]); R[i] = nm(R[i]); }
  const tunnel = new Uint8Array(N);
  for (const [a, b] of def.tunnels || []) {
    for (let k = Math.floor(a * N); k < Math.ceil(b * N); k++) tunnel[((k % N) + N) % N] = 1;
  }
  return { L, R, tunnel };
}

function stripQuad(g, a0, a1, b0, b1) { g.quad(a0, b0, b1, a1); }

/**
 * Build road + edges into chunks.
 * theme: { road, roadEdge, line, center, sidewalk, curb, rail, barrier, gravel, grass, rock, neonA, neonB, tunnel, pillar, groundY }
 */
export function buildRoad(track, chunks) {
  const { path, edges, theme } = track;
  const N = path.N;
  const step = 2;
  const groundY = theme.groundY ?? 0;
  const col = (k, d) => rgb(theme[k] ?? d);
  const road = col('road', '#2a2a3a'), roadB = mix(road, [0, 0, 0], 0.035);
  const line = col('line', '#f2f2ff'), center = col('center', '#ffd23f');
  const P = (i, lat, dy = 0) => {
    const ii = ((i % N) + N) % N;
    return [path.px[ii] + path.rx[ii] * lat, path.py[ii] + Math.tan(path.bank[ii]) * lat + dy, path.pz[ii] + path.rz[ii] * lat];
  };
  const S = (i) => i * path.step;
  const lanes = (i) => Math.max(2, Math.round(path.w[i] / 5.5));

  for (let i = 0; i < N; i += step) {
    const j = i + step;
    const g = chunks.W(S(i));
    const hw0 = path.w[i % N] / 2, hw1 = path.w[j % N] / 2;
    const tun = edges.tunnel[i % N];
    // ---- asphalt (subtle alternating band for speed read)
    g.set(((i / step) % 16) < 8 ? road : roadB, 0, 0);
    g.quad(P(i, -hw0), P(i, hw0), P(j, hw1), P(j, -hw1));
    // ---- markings
    const dash = ((i / step) % 6) < 3;
    g.set(line, 0, 0.35);
    // edge lines
    for (const sgn of [-1, 1]) {
      const a = sgn * (hw0 - 0.55), b = sgn * (hw0 - 0.35), a1 = sgn * (hw1 - 0.55), b1 = sgn * (hw1 - 0.35);
      const q = [P(i, Math.min(a, b), 0.012), P(i, Math.max(a, b), 0.012), P(j, Math.max(a1, b1), 0.012), P(j, Math.min(a1, b1), 0.012)];
      g.quad(q[0], q[1], q[2], q[3]);
    }
    if (dash) {
      const nl = lanes(i % N);
      for (let l = 1; l < nl; l++) {
        const t = -1 + (2 * l) / nl;
        const lat0 = t * (hw0 - 0.5), lat1 = t * (hw1 - 0.5);
        const isCenter = nl % 2 === 0 && l === nl / 2 && theme.centerLine;
        g.set(isCenter ? center : line, 0, 0.35);
        g.quad(P(i, lat0 - 0.12, 0.012), P(i, lat0 + 0.12, 0.012), P(j, lat1 + 0.12, 0.012), P(j, lat1 - 0.12, 0.012));
      }
    }
    // ---- edges
    for (const sgn of [-1, 1]) {
      const e = (sgn < 0 ? edges.L : edges.R)[i % N];
      buildEdge(g, chunks, track, e, sgn, i, j, hw0, hw1, P, col, tun);
    }
    // ---- tunnel shell
    if (tun) buildTunnel(g, chunks, track, i, j, hw0, hw1, P, col);
    // ---- elevated deck + pillars
    const y = path.py[i % N];
    if (!tun && theme.decks !== false && y - groundY > 1.2) {
      const eL = edges.L[i % N], eR = edges.R[i % N];
      const l0 = -(hw0 + eL.width), r0 = hw0 + eR.width, l1 = -(hw1 + eL.width), r1 = hw1 + eR.width;
      g.set(col('deck', '#4a4660'), 0, 0);
      const d = 1.3;
      g.quad(P(j, l1, -d), P(j, r1, -d), P(i, r0, -d), P(i, l0, -d));
      g.set(col('deckSide', '#6a6480'), 0, 0);
      g.quad(P(i, l0, -d), P(i, l0 + 0.01, 0.0), P(j, l1 + 0.01, 0.0), P(j, l1, -d));
      g.quad(P(j, r1, -d), P(j, r1 - 0.01, 0.0), P(i, r0 - 0.01, 0.0), P(i, r0, -d));
      if ((i / step) % 12 === 0 && !track.def.noPillars) {
        const c = P(i, 0, -d);
        const pw = Math.min(3.2, hw0 * 0.35);
        g.set(col('pillar', '#8a84a0'), 0, 0);
        g.cbox(c[0], (groundY + c[1]) / 2, c[2], pw, c[1] - groundY, pw, 0.4, { top: true });
        g.set(col('deck', '#4a4660'), 0, 0);
        const ang = Math.atan2(path.tz[i % N], path.tx[i % N]);
        g.at([c[0], c[1] - 0.6, c[2]], [0, -ang, 0], 1, (gg) => gg.box(0, 0, 0, 2.5, 1.2, (hw0 + 2) * 2, [1, 1]));
      }
    }
  }
  buildStartGantry(track, chunks, P, col);
}

function buildEdge(g, chunks, track, e, sgn, i, j, hw0, hw1, P, col, tun) {
  const { path } = track;
  const N = path.N;
  const w = e.width;
  const in0 = sgn * hw0, in1 = sgn * hw1;
  const out0 = sgn * (hw0 + w), out1 = sgn * (hw1 + w);
  const q = (a0, a1, b0, b1) => (sgn > 0 ? stripQuad(g, a0, a1, b0, b1) : stripQuad(g, b0, b1, a0, a1));
  const surf = { pave: col('sidewalk', '#8c86a6'), asphalt: col('shoulder', '#34344a'), gravel: col('gravel', '#7a6e66'), grass: col('grass', '#3f8f4f'), concrete: col('concrete', '#8a8a96') }[e.surface] || col('shoulder', '#34344a');
  const lift = e.lift || 0;
  const ii = i % N;
  // curb face / rumble
  if (e.kind === 'sidewalk' || e.kind === 'quay') {
    g.set(col('curb', '#c9c4dc'), 0, 0);
    q(P(i, in0, 0), P(j, in1, 0), P(i, in0, lift), P(j, in1, lift));
    g.set(((i / 2) % 2) ? surf : mix(surf, [1, 1, 1], 0.08), 0, 0);
    q(P(i, in0, lift), P(j, in1, lift), P(i, out0, lift), P(j, out1, lift));
  } else if (e.kind === 'open') {
    g.set(surf, 0, 0);
    q(P(i, in0, lift), P(j, in1, lift), P(i, out0, lift), P(j, out1, lift));
  } else {
    // rumble strip then shoulder
    const rum = e.rumble !== false && track.theme.rumble !== false;
    const r = rum ? 0.9 : 0;
    if (rum) {
      const red = ((i / 2) % 2) === 0;
      g.set(red ? col('rumbleA', '#ff2d6f') : col('rumbleB', '#f4f4ff'), 0, e.kind === 'neon' ? 0.6 : 0);
      q(P(i, in0, 0.03), P(j, in1, 0.03), P(i, in0 + sgn * r, 0.03), P(j, in1 + sgn * r, 0.03));
    }
    g.set(surf, 0, 0);
    q(P(i, in0 + sgn * r, lift), P(j, in1 + sgn * r, lift), P(i, out0, lift), P(j, out1, lift));
  }
  if (tun) {
    // tunnel wall replaces the edge kit
    return;
  }
  const o0 = P(i, out0, lift), o1 = P(j, out1, lift);
  switch (e.kind) {
    case 'sidewalk': {
      // pedestrian guard rail near the outer edge
      if (e.rail === false) break;
      const rl0 = sgn * (hw0 + w - 0.35), rl1 = sgn * (hw1 + w - 0.35);
      g.set(col('rail', '#f2f2f6'), 0, 0);
      for (const h of [0.55, 0.95]) {
        const a = P(i, rl0, lift + h), b = P(j, rl1, lift + h);
        g.cyl(a, b, 0.045, 0.045, 4, false);
      }
      if ((i / 2) % 2 === 0) { const a = P(i, rl0, lift); g.cyl(a, [a[0], a[1] + 1.0, a[2]], 0.05, 0.05, 4, false); }
      break;
    }
    case 'barrier':
    case 'shoulder': {
      const bh = e.height ?? 1.0;
      const b0 = sgn * (hw0 + w), b1 = sgn * (hw1 + w);
      const c = col('barrier', '#d8d4e6');
      g.set(c, 0, 0);
      // jersey profile: inner sloped face, top, outer face
      q(P(i, b0 - sgn * 0.35, lift), P(j, b1 - sgn * 0.35, lift), P(i, b0 - sgn * 0.12, lift + bh), P(j, b1 - sgn * 0.12, lift + bh));
      q(P(i, b0 - sgn * 0.12, lift + bh), P(j, b1 - sgn * 0.12, lift + bh), P(i, b0 + sgn * 0.12, lift + bh), P(j, b1 + sgn * 0.12, lift + bh));
      q(P(i, b0 + sgn * 0.12, lift + bh), P(j, b1 + sgn * 0.12, lift + bh), P(i, b0 + sgn * 0.3, lift - 1.4), P(j, b1 + sgn * 0.3, lift - 1.4));
      // reflective stripe
      if (e.stripe !== false) {
        g.set(col('barrierStripe', '#ffb21e'), 0, 0.5);
        q(P(i, b0 - sgn * 0.22, lift + 0.55), P(j, b1 - sgn * 0.22, lift + 0.55), P(i, b0 - sgn * 0.19, lift + 0.7), P(j, b1 - sgn * 0.19, lift + 0.7));
      }
      break;
    }
    case 'guardrail': {
      const gl0 = sgn * (hw0 + w - 0.2), gl1 = sgn * (hw1 + w - 0.2);
      g.set(col('guardrail', '#e8ecf2'), 0, 0);
      q(P(i, gl0, 0.5), P(j, gl1, 0.5), P(i, gl0, 0.85), P(j, gl1, 0.85));
      q(P(j, gl1 + sgn * 0.02, 0.5), P(i, gl0 + sgn * 0.02, 0.5), P(j, gl1 + sgn * 0.02, 0.85), P(i, gl0 + sgn * 0.02, 0.85));
      if ((i / 2) % 2 === 0) {
        g.set(col('post', '#9a9aa8'), 0, 0);
        const a = P(i, gl0 + sgn * 0.12, 0);
        g.box(a[0], a[1] + 0.45, a[2], 0.12, 0.9, 0.12);
      }
      // delineator reflectors
      if ((i / 2) % 10 === 0) { g.set(col('reflector', '#ffb21e'), 0, 1); const a = P(i, gl0 - sgn * 0.02, 0.92); g.box(a[0], a[1] + 0.08, a[2], 0.08, 0.16, 0.08); }
      // outer slope down (drop-off) or up (cut)
      if (e.drop) { g.set(col('slope', '#3b5a3f'), 0, 0); q(P(i, out0, 0), P(j, out1, 0), P(i, out0 + sgn * 6, -e.drop), P(j, out1 + sgn * 6, -e.drop)); }
      break;
    }
    case 'rock': {
      const h = e.height ?? 7;
      const rk = col('rock', '#6f5f73');
      const ii2 = (i * 7919) % 13;
      g.set(mix(rk, [0, 0, 0], (ii2 % 3) * 0.06), 0, 0);
      const jag = (k) => 0.4 + ((k * 7919) % 11) / 11 * 1.2;
      q(P(i, out0, 0), P(j, out1, 0), P(i, out0 + sgn * jag(i), h * 0.55), P(j, out1 + sgn * jag(j), h * 0.55));
      q(P(i, out0 + sgn * jag(i), h * 0.55), P(j, out1 + sgn * jag(j), h * 0.55), P(i, out0 + sgn * (jag(i) + 2.5), h), P(j, out1 + sgn * (jag(j) + 2.5), h));
      g.set(col('grass', '#3f8f4f'), 0, 0);
      q(P(i, out0 + sgn * (jag(i) + 2.5), h), P(j, out1 + sgn * (jag(j) + 2.5), h), P(i, out0 + sgn * 18, h + 4), P(j, out1 + sgn * 18, h + 4));
      break;
    }
    case 'neon': {
      const b0 = sgn * (hw0 + w), b1 = sgn * (hw1 + w);
      g.set(col('neonBase', '#1c1830'), 0, 0);
      q(P(i, b0 - sgn * 0.2, 0), P(j, b1 - sgn * 0.2, 0), P(i, b0 - sgn * 0.2, 0.8), P(j, b1 - sgn * 0.2, 0.8));
      q(P(i, b0 - sgn * 0.2, 0.8), P(j, b1 - sgn * 0.2, 0.8), P(i, b0 + sgn * 0.2, 0.8), P(j, b1 + sgn * 0.2, 0.8));
      const nc = (Math.floor(i / 16) % 2) ? col('neonA', '#20d8ff') : col('neonB', '#ff2d6f');
      g.set(nc, 0, 1);
      q(P(i, b0 - sgn * 0.21, 0.6), P(j, b1 - sgn * 0.21, 0.6), P(i, b0 - sgn * 0.21, 0.75), P(j, b1 - sgn * 0.21, 0.75));
      break;
    }
    case 'fence': {
      const b0 = sgn * (hw0 + w - 0.1), b1 = sgn * (hw1 + w - 0.1);
      g.set(col('fence', '#b8c0cc'), 0, 0);
      if ((i / 2) % 3 === 0) { const a = P(i, b0, 0); g.cyl(a, [a[0], a[1] + 2.4, a[2]], 0.05, 0.05, 4, false); }
      g.cyl(P(i, b0, 2.4), P(j, b1, 2.4), 0.04, 0.04, 4, false);
      g.set(col('fenceMesh', '#6a7282'), 0, 0);
      q(P(i, b0, 0.1), P(j, b1, 0.1), P(i, b0, 2.35), P(j, b1, 2.35));
      q(P(j, b1 + sgn * 0.01, 0.1), P(i, b0 + sgn * 0.01, 0.1), P(j, b1 + sgn * 0.01, 2.35), P(i, b0 + sgn * 0.01, 2.35));
      break;
    }
    case 'quay': {
      g.set(col('quayEdge', '#ffd23f'), 0, 0.2);
      q(P(i, out0 - sgn * 0.3, lift + 0.01), P(j, out1 - sgn * 0.3, lift + 0.01), P(i, out0, lift + 0.01), P(j, out1, lift + 0.01));
      g.set(col('quayWall', '#5a5a68'), 0, 0);
      q(o0, o1, P(i, out0, -4), P(j, out1, -4));
      if ((i / 2) % 8 === 0) { g.set(col('bollard', '#2a2a36'), 0, 0); const a = P(i, out0 - sgn * 0.6, lift); g.cyl(a, [a[0], a[1] + 0.7, a[2]], 0.22, 0.26, 8, true); }
      break;
    }
    default: break;
  }
  void ii; void chunks;
}

function buildTunnel(g, chunks, track, i, j, hw0, hw1, P, col) {
  const { edges } = track;
  const N = track.path.N;
  const wl0 = hw0 + edges.L[i % N].width, wr0 = hw0 + edges.R[i % N].width;
  const wl1 = hw1 + edges.L[j % N].width, wr1 = hw1 + edges.R[j % N].width;
  const H = track.theme.tunnelHeight ?? 7.5;
  const wall = col('tunnel', '#5d5872'), roof = col('tunnelRoof', '#3a3650');
  // walls (face inward)
  g.set(wall, 0, 0);
  g.quad(P(i, -wl0, 0), P(j, -wl1, 0), P(j, -wl1 + 0.8, H), P(i, -wl0 + 0.8, H));
  g.quad(P(j, wr1, 0), P(i, wr0, 0), P(i, wr0 - 0.8, H), P(j, wr1 - 0.8, H));
  // outer skin (seen from outside)
  g.set(mix(wall, [0, 0, 0], 0.2), 0, 0);
  g.quad(P(j, -wl1 - 0.6, -0.5), P(i, -wl0 - 0.6, -0.5), P(i, -wl0 - 0.2, H + 0.6), P(j, -wl1 - 0.2, H + 0.6));
  g.quad(P(i, wr0 + 0.6, -0.5), P(j, wr1 + 0.6, -0.5), P(j, wr1 + 0.2, H + 0.6), P(i, wr0 + 0.2, H + 0.6));
  g.quad(P(i, -wl0 - 0.2, H + 0.6), P(i, wr0 + 0.2, H + 0.6), P(j, wr1 + 0.2, H + 0.6), P(j, -wl1 - 0.2, H + 0.6));
  // ceiling (faces down)
  g.set(roof, 0, 0);
  g.quad(P(j, -wl1 + 0.8, H), P(j, wr1 - 0.8, H), P(i, wr0 - 0.8, H), P(i, -wl0 + 0.8, H));
  // light strips along the ceiling edges, alternating
  if ((i / 2) % 4 < 2) {
    g.set(col('tunnelLight', '#ffb65c'), 0, 1);
    for (const sg of [-1, 1]) {
      const a = sg < 0 ? -wl0 + 1.6 : wr0 - 1.6, b = sg < 0 ? -wl1 + 1.6 : wr1 - 1.6;
      g.quad(P(j, b - 0.3, H - 0.05), P(j, b + 0.3, H - 0.05), P(i, a + 0.3, H - 0.05), P(i, a - 0.3, H - 0.05));
    }
  }
  // wall stripe
  g.set(col('tunnelStripe', '#20d8ff'), 0, 0.8);
  g.quad(P(i, -wl0 + 0.02, 1.0), P(j, -wl1 + 0.02, 1.0), P(j, -wl1 + 0.05, 1.25), P(i, -wl0 + 0.05, 1.25));
  g.quad(P(j, wr1 - 0.02, 1.0), P(i, wr0 - 0.02, 1.0), P(i, wr0 - 0.05, 1.25), P(j, wr1 - 0.05, 1.25));
  void chunks;
}

function buildStartGantry(track, chunks, P, col) {
  const { path, edges } = track;
  const N = path.N;
  const i = 0;
  const g = chunks.W(0);
  const hw = path.w[0] / 2;
  const wl = hw + edges.L[0].width, wr = hw + edges.R[0].width;
  // checkered start line
  for (let k = 0; k < 2; k++) for (let c = 0; c < Math.ceil(path.w[0] / 1.2); c++) {
    const lat = -hw + c * 1.2;
    g.set(((c + k) % 2) ? [0.95, 0.95, 1] : [0.08, 0.06, 0.12], 0, 0.1);
    const a = P(i + k, lat, 0.02), b = P(i + k, lat + 1.2, 0.02), cc = P(i + k + 1, lat + 1.2, 0.02), d = P(i + k + 1, lat, 0.02);
    g.quad(a, b, cc, d);
  }
  // gantry legs + beam
  const H = 8.5;
  const L0 = P(1, -wl + 0.5, 0), R0 = P(1, wr - 0.5, 0);
  g.set(col('gantry', '#2b2640'), 0, 0);
  g.cbox(L0[0], L0[1] + H / 2, L0[2], 1.1, H, 1.1, 0.25);
  g.cbox(R0[0], R0[1] + H / 2, R0[2], 1.1, H, 1.1, 0.25);
  const ang = Math.atan2(path.tz[1], path.tx[1]);
  const mid = P(1, (wr - wl) / 2, H);
  g.at(mid, [0, -ang, 0], 1, (gg) => { gg.box(0, 0, 0, 1.4, 1.8, wl + wr, [1, 1]); });
  // lights row
  const gl = chunks.W(0);
  for (let k = 0; k < 5; k++) {
    gl.set(k < 2 ? [1, 0.15, 0.25] : [0.2, 1, 0.5], 0, 1);
    const p = P(1, -2.4 + k * 1.2, H - 1.2);
    gl.at([p[0], p[1], p[2]], [0, -ang, 0], 1, (gg) => gg.box(-0.72, 0, 0, 0.1, 0.5, 0.5));
  }
  track.gantry = { s: path.step, H, mid, ang, width: wl + wr };
  void N;
}
