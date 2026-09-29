// The three bodies and their front / rear styles. Each style reshapes the hull
// (nose length, hood and face height, tail height, ducktails) and adds its own
// lamps, grilles and hardware, so swapping a front or rear changes the car's face.
import { Hull, buildBed, buildCabin, MAT, C } from './hull.js';
import {
  shape, panel, frontPanel, rearPanel, topPanel, sidePanel, tube, roundLamp, splitter, canards, oilCooler, deppa,
  towHook, licensePlate, grille, exhaustTip, takeyari, diffuser,
} from './parts.js';

const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ shared face kits
// Each receives (g, ctx) where ctx has: hull, dims, f (front params) or r (rear params)

function headStrip(g, x, y, z, w, h, color = C.head, skew = 0) {
  g.set(C.black, MAT.TRIM);
  frontPanel(g, x, y, z, shape.trap(w + 0.03, w + 0.03 - skew, h + 0.03, 0), 0.012, 0.03);
  g.set(color, MAT.LIGHT);
  frontPanel(g, x + 0.012, y, z, shape.trap(w, w - skew, h, 0), 0.012, 0.005);
}

function tailStrip(g, x, y, z, w, h, color = C.red) {
  g.set(C.black, MAT.TRIM);
  rearPanel(g, x, y, z, shape.round(w + 0.03, h + 0.03, 0.02), 0.012, 0.03);
  g.set(color, MAT.LIGHT);
  rearPanel(g, x - 0.012, y, z, shape.round(w, h, 0.015), 0.012, 0.005);
}

function roundTail(g, x, y, z, r, color = C.red) {
  g.set(C.black, MAT.TRIM);
  rearPanel(g, x, y, z, shape.circle(r * 1.2, 14), 0.014, 0.03);
  g.set(color, MAT.LIGHT);
  rearPanel(g, x - 0.014, y, z, shape.circle(r, 14), 0.01, 0.005);
  g.set([1, 0.7, 0.7], MAT.LIGHT);
  rearPanel(g, x - 0.025, y, z, shape.circle(r * 0.35, 10), 0.004, 0.0);
}

function roundHead(g, x, y, z, r, color = C.head) {
  g.set(C.chrome, MAT.CHROME);
  frontPanel(g, x, y, z, shape.circle(r * 1.22, 14), 0.016, 0.03);
  g.set(color, MAT.LIGHT);
  frontPanel(g, x + 0.016, y, z, shape.circle(r, 14), 0.012, 0.005);
}

/** Lamp lying on the sloped nose: points given as (x, z) on the top surface. */
function noseLamp(g, hull, pts, color = C.head, lift = 0.012) {
  const P = pts.map(([x, z]) => [x, hull.topY(x, z), z]);
  // estimate normal from the triangle fan
  const a = P[0], b = P[1], c = P[2];
  const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
  const L = Math.hypot(...n) || 1;
  let N = n.map((v) => v / L);
  if (N[1] < 0) N = N.map((v) => -v);
  const up = (p, d) => [p[0] + N[0] * d, p[1] + N[1] * d, p[2] + N[2] * d];
  const base = P.map((p) => up(p, -0.02)), top = P.map((p) => up(p, lift));
  // orientation: ensure CCW seen from N
  const cross = ((top[1][0] - top[0][0]) * (top[2][2] - top[0][2]) - (top[1][2] - top[0][2]) * (top[2][0] - top[0][0]));
  const ord = cross > 0 ? [...top.keys()].reverse() : [...top.keys()];
  g.set(color, MAT.LIGHT);
  g.poly(ord.map((i) => top[i]));
  g.set(C.black, MAT.TRIM);
  for (let k = 0; k < ord.length; k++) {
    const i = ord[k], j = ord[(k + 1) % ord.length];
    g.quad(base[i], base[j], top[j], top[i]);
  }
}

/** Tessellated patch that follows the top surface (hood decals, primer panels). */
function hoodPatch(g, hull, x0, x1, zw, color, mat, lift = 0.006, nx = 6, nz = 6) {
  g.set(color, mat);
  const P = (i, j) => { const x = lerp(x0, x1, i / nx), z = lerp(-zw, zw, j / nz); return [x, hull.topY(x, z) + lift, z]; };
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) g.quad(P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j));
}

function hoodLouvres(g, hull, x0, n = 5, w = 0.34) {
  g.set(C.black, MAT.TRIM);
  for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
    const x = x0 - i * 0.07;
    const z = s * 0.34;
    const y = hull.topY(x, z);
    topPanel(g, x, y, z, shape.rect(0.035, w), 0.012, 0.02);
  }
}

function hoodScoop(g, hull, x, w = 0.4, h = 0.08, len = 0.5, mat = MAT.PAINT) {
  const y = hull.topY(x, 0);
  g.set(C.white, mat);
  g.box(x, y + h / 2 - 0.01, 0, len, h, w, [0.85, 0.9, -0.03]);
  g.set(C.black, MAT.TRIM);
  frontPanel(g, x + len / 2 - 0.02, y + h * 0.55, 0, shape.rect(w * 0.8, h * 0.6), 0.01, 0.02);
}

// ------------------------------------------------------------------ front kits shared by bodies
const FRONT_KITS = {
  kaido(g, ctx) {
    const { hull, f } = ctx;
    const x = f.noseX;
    const s = hull.at(x);
    // round yellow fog-covered lamps high on the face
    for (const zs of [-1, 1]) roundHead(g, x + 0.005, s.top - s.sh - 0.1, zs * s.hw * 0.62, 0.085, C.yellow);
    grille(g, x + 0.005, s.top - s.sh - 0.1, 0, s.hw * 0.62, 0.12, { slats: 3, frame: C.black, frameMat: MAT.TRIM });
    oilCooler(g, ctx, { x: x + 0.12, y: s.bot + 0.2, w: s.hw * 0.9, h: 0.18 });
    deppa(g, ctx, { x: x, y: s.bot - 0.02, w: s.hw * 0.95, reach: 0.5 });
    towHook(g, x + 0.02, s.bot + 0.08, -s.hw * 0.55);
  },
  attack(g, ctx) {
    const { hull, f } = ctx;
    const x = f.noseX;
    const s = hull.at(x);
    // slim LED eyes along the nose shoulder
    for (const zs of [-1, 1]) {
      noseLamp(g, hull, [[x - 0.05, zs * s.hw * 0.4], [x - 0.02, zs * s.hw * 0.88], [x - 0.13, zs * s.hw * 0.9], [x - 0.16, zs * s.hw * 0.45]], C.cyan);
    }
    grille(g, x + 0.005, s.bot + 0.16, 0, s.hw * 1.3, 0.2, { slats: 3, frame: null, color: C.black });
    for (const zs of [-1, 1]) grille(g, x + 0.005, s.bot + 0.14, zs * s.hw * 0.82, 0.14, 0.14, { slats: 2, frame: null, color: C.black });
    splitter(g, ctx, { x: x - 0.05, y: s.bot - 0.02, w: s.hw + 0.06, depth: 0.32 });
    canards(g, ctx, { x: x - 0.02, y: s.bot + 0.12, z: s.hw * 0.95 });
    hoodLouvres(g, hull, f.noseX - 0.42, 5, 0.3);
    towHook(g, x + 0.02, s.bot + 0.07, s.hw * 0.5, C.yellow);
  },
};

// ------------------------------------------------------------------ KAZE (sedan)
const KAZE = {
  dims: { wb: 2.64, track: 1.5, R: 0.35, W: 0.235, archR: 0.415, hw: 0.9, rocker: 0.26, sh: 0.085, belt: 0.94, roof: 1.41 },
  fronts: {
    stock: { noseX: 2.2, hoodFront: 0.84, faceTop: 0.74, faceBot: 0.22, noseHW: 0.8, sh: 0.06 },
    gtr: { noseX: 2.24, hoodFront: 0.9, faceTop: 0.84, faceBot: 0.19, noseHW: 0.87, sh: 0.045 },
    euro: { noseX: 2.2, hoodFront: 0.83, faceTop: 0.75, faceBot: 0.21, noseHW: 0.8, sh: 0.06 },
    kaido: { noseX: 2.22, hoodFront: 0.87, faceTop: 0.8, faceBot: 0.27, noseHW: 0.85, sh: 0.05 },
    attack: { noseX: 2.28, hoodFront: 0.81, faceTop: 0.69, faceBot: 0.17, noseHW: 0.86, sh: 0.05 },
    missile: { noseX: 1.98, hoodFront: 0.84, faceTop: 0.77, faceBot: 0.41, noseHW: 0.84, sh: 0.05 },
  },
  rears: {
    stock: { tailX: -2.18, deckEnd: 0.97, tailTop: 0.87, tailBot: 0.26, tailHW: 0.83, sh: 0.06 },
    quad: { tailX: -2.2, deckEnd: 0.97, tailTop: 0.89, tailBot: 0.24, tailHW: 0.85, sh: 0.05 },
    ducktail: { tailX: -2.22, deckEnd: 1.07, tailTop: 0.95, tailBot: 0.24, tailHW: 0.85, sh: 0.05, duck: true },
    takeyari: { tailX: -2.24, deckEnd: 0.97, tailTop: 0.85, tailBot: 0.23, tailHW: 0.85, sh: 0.05 },
    diffuser: { tailX: -2.2, deckEnd: 1.0, tailTop: 0.89, tailBot: 0.31, tailHW: 0.86, sh: 0.05 },
    missile: { tailX: -1.96, deckEnd: 0.97, tailTop: 0.89, tailBot: 0.43, tailHW: 0.85, sh: 0.05 },
  },
  keys(f, r) {
    const d = this.dims;
    return [
      ...rearKeys(d, r, -1.6, 0.99),
      { x: -1.6, top: 0.99, bot: d.rocker, hw: d.hw, sh: d.sh },
      { x: 0.85, top: 0.95, bot: d.rocker, hw: d.hw, sh: d.sh },
      ...frontKeys(d, f, 0.85, 0.95),
    ];
  },
  cabin(g, ctx) {
    const d = this.dims;
    return buildCabin(g, {
      profile: [[0.85, 0.95], [0.0, d.roof], [-0.92, d.roof - 0.015], [-1.6, 0.99]],
      roles: ['glass', 'paint', 'glass'], belt: 0.95, roof: d.roof, bw: 0.845, rw: 0.66, pillar: 0.065, bPillar: -0.58, windowFloor: 0.035,
    });
  },
  mount(ctx) { return { x: ctx.r.tailX + 0.25, y: ctx.r.deckEnd, hw: 0.84, roofX: -0.92, roofY: this.dims.roof, roofHW: 0.62 }; },
  frontParts: {
    stock(g, ctx) {
      const { hull, f } = ctx; const x = f.noseX; const s = hull.at(x);
      for (const zs of [-1, 1]) {
        noseLamp(g, hull, [[x - 0.03, zs * s.hw * 0.45], [x - 0.02, zs * s.hw * 0.86], [x - 0.24, zs * s.hw * 0.97], [x - 0.3, zs * s.hw * 0.62]], C.head);
        g.set(C.amber, MAT.LIGHT); frontPanel(g, x, s.bot + 0.15, zs * s.hw * 0.78, shape.round(0.12, 0.05, 0.02), 0.01, 0.02);
      }
      grille(g, x + 0.004, s.top - s.sh - 0.04, 0, 0.36, 0.05, { slats: 1, frame: null });
      grille(g, x + 0.004, s.bot + 0.15, 0, 0.9, 0.13, { slats: 2, frame: null, color: C.black });
      licensePlate(g, x + 0.02, s.bot + 0.3, true);
    },
    gtr(g, ctx) {
      const { hull, f } = ctx; const x = f.noseX; const s = hull.at(x);
      const y = s.top - s.sh - 0.08;
      for (const zs of [-1, 1]) {
        g.set(C.black, MAT.TRIM); frontPanel(g, x, y, zs * s.hw * 0.66, shape.round(0.38, 0.13, 0.02), 0.014, 0.03);
        roundHead(g, x + 0.012, y, zs * s.hw * 0.52, 0.045);
        roundHead(g, x + 0.012, y, zs * s.hw * 0.8, 0.05);
      }
      grille(g, x + 0.004, y, 0, 0.42, 0.11, { slats: 3, frame: C.chrome });
      g.set(C.red, MAT.LIGHT); frontPanel(g, x + 0.03, y, 0, shape.circle(0.035, 8), 0.01, 0.02);
      grille(g, x + 0.004, s.bot + 0.17, 0, 0.8, 0.2, { slats: 2, frame: null, color: C.black });
      for (const zs of [-1, 1]) grille(g, x + 0.004, s.bot + 0.15, zs * s.hw * 0.78, 0.14, 0.16, { slats: 3, frame: null, color: C.black, vertical: true });
      g.set(C.dark, MAT.CARBON); g.box(x + 0.02, s.bot - 0.0, 0, 0.12, 0.03, s.hw * 1.8);
    },
    euro(g, ctx) {
      const { hull, f } = ctx; const x = f.noseX; const s = hull.at(x);
      const y = s.top - s.sh - 0.07;
      for (const zs of [-1, 1]) {
        g.set(C.black, MAT.TRIM); frontPanel(g, x, y, zs * s.hw * 0.66, shape.round(0.36, 0.14, 0.05), 0.012, 0.03);
        for (const k of [0.5, 0.8]) {
          g.set(C.head, MAT.LIGHT);
          g.at([x + 0.015, y, zs * s.hw * k], [0, 0, 0], 1, (gg) => gg.torus(0, 0.052, 0.01, 14, 4));
          g.set([0.7, 0.8, 1.0], MAT.LIGHT); frontPanel(g, x + 0.012, y, zs * s.hw * k, shape.circle(0.03, 10), 0.01, 0.0);
        }
        // kidney
        g.set(C.chrome, MAT.CHROME); frontPanel(g, x + 0.004, y - 0.02, zs * 0.1, shape.round(0.13, 0.15, 0.045), 0.02, 0.03);
        g.set(C.black, MAT.TRIM); frontPanel(g, x + 0.018, y - 0.02, zs * 0.1, shape.round(0.1, 0.12, 0.035), 0.012, 0.0);
      }
      grille(g, x + 0.004, s.bot + 0.13, 0, 0.44, 0.14, { slats: 2, frame: null, color: C.black });
      for (const zs of [-1, 1]) grille(g, x + 0.004, s.bot + 0.13, zs * s.hw * 0.7, 0.22, 0.12, { slats: 2, frame: null, color: C.black });
    },
    kaido(g, ctx) { FRONT_KITS.kaido(g, ctx); },
    attack(g, ctx) { FRONT_KITS.attack(g, ctx); },
    missile(g, ctx) {
      const { hull, f } = ctx; const x = f.noseX; const s = hull.at(x);
      const y = s.top - s.sh - 0.08;
      // radiator exposed
      g.set(C.metal, MAT.CHROME); frontPanel(g, x, y - 0.1, 0, shape.rect(0.9, 0.24), 0.03, 0.03);
      g.set(C.dark, MAT.TRIM); for (let i = 0; i < 6; i++) frontPanel(g, x + 0.031, y - 0.2 + i * 0.04, 0, shape.rect(0.86, 0.01), 0.005, 0);
      // one lamp alive, one socket empty
      roundHead(g, x + 0.005, y, s.hw * 0.66, 0.07);
      g.set(C.black, MAT.TRIM); frontPanel(g, x + 0.005, y, -s.hw * 0.66, shape.circle(0.08, 10), 0.01, 0.02);
      // crash bar
      g.set(C.grey, MAT.CHROME);
      tube(g, [[x - 0.2, s.bot - 0.02, -s.hw * 0.7], [x + 0.08, s.bot - 0.02, -s.hw * 0.6], [x + 0.08, s.bot - 0.02, s.hw * 0.6], [x - 0.2, s.bot - 0.02, s.hw * 0.7]], 0.028, 8);
      // primer hood
      hoodPatch(g, hull, 0.95, x - 0.12, s.hw * 0.8, C.primer, MAT.TRIM, 0.006);
      // zip ties
      g.set(C.white, MAT.TRIM); for (const zs of [-1, 1]) g.box(x + 0.02, y + 0.13, zs * 0.3, 0.03, 0.02, 0.012);
      towHook(g, x + 0.08, s.bot + 0.02, 0.2, C.orange);
    },
  },
  rearParts: {
    stock(g, ctx) {
      const { hull, r } = ctx; const x = r.tailX; const s = hull.at(x);
      for (const zs of [-1, 1]) {
        tailStrip(g, x, s.top - s.sh - 0.06, zs * s.hw * 0.72, 0.3, 0.1);
        g.set(C.amber, MAT.LIGHT); rearPanel(g, x - 0.013, s.top - s.sh - 0.06, zs * s.hw * 0.62, shape.rect(0.08, 0.06), 0.006, 0.0);
      }
      licensePlate(g, x - 0.01, s.top - s.sh - 0.12, false);
      g.set(C.black, MAT.TRIM); g.box(x + 0.05, s.bot + 0.05, 0, 0.12, 0.08, s.hw * 1.6);
      exhaustTip(g, ctx, [x - 0.04, s.bot + 0.03, s.hw * 0.55], [-1, 0, 0], 0.04, 0.2);
    },
    quad(g, ctx) {
      const { hull, r } = ctx; const x = r.tailX; const s = hull.at(x);
      const y = s.top - s.sh - 0.08;
      for (const zs of [-1, 1]) { roundTail(g, x, y, zs * s.hw * 0.5, 0.07); roundTail(g, x, y, zs * s.hw * 0.78, 0.07); }
      g.set(C.black, MAT.TRIM); rearPanel(g, x, y, 0, shape.rect(0.4, 0.08), 0.01, 0.03);
      licensePlate(g, x - 0.01, s.bot + 0.26, false);
      for (const zs of [-1, 1]) exhaustTip(g, ctx, [x - 0.05, s.bot + 0.05, zs * s.hw * 0.62], [-1, 0, 0], 0.05, 0.2);
      g.set(C.dark, MAT.CARBON); g.box(x + 0.02, s.bot - 0.01, 0, 0.14, 0.03, s.hw * 1.5);
    },
    ducktail(g, ctx) {
      const { hull, r } = ctx; const x = r.tailX; const s = hull.at(x);
      const y = s.top - s.sh - 0.07;
      tailStrip(g, x, y, 0, s.hw * 1.7, 0.06);
      g.set(C.white, MAT.LIGHT); rearPanel(g, x - 0.014, y, 0, shape.rect(0.2, 0.03), 0.004, 0.0);
      licensePlate(g, x - 0.01, s.bot + 0.28, false);
      diffuser(g, ctx, { x: x + 0.02, y: s.bot - 0.05, w: s.hw * 0.8, len: 0.25, fins: 6 });
      for (const zs of [-1, 1]) exhaustTip(g, ctx, [x - 0.06, s.bot + 0.06, zs * 0.12], [-1, 0, 0], 0.045, 0.2);
    },
    takeyari(g, ctx) {
      const { hull, r } = ctx; const x = r.tailX; const s = hull.at(x);
      const y = s.top - s.sh - 0.08;
      for (const zs of [-1, 1]) roundTail(g, x, y, zs * s.hw * 0.62, 0.085);
      licensePlate(g, x - 0.01, y - 0.04, false);
      g.set(C.white, MAT.ACCENT); g.box(x + 0.0, s.bot + 0.05, 0, 0.1, 0.1, s.hw * 1.75);
      takeyari(g, ctx, { x: x + 0.1, y: s.bot + 0.12, z: s.hw * 0.7, height: 1.45, lean: 0.6, count: 2 });
    },
    diffuser(g, ctx) {
      const { hull, r } = ctx; const x = r.tailX; const s = hull.at(x);
      const y = s.top - s.sh - 0.07;
      for (const zs of [-1, 1]) {
        g.set(C.black, MAT.TRIM); rearPanel(g, x, y, zs * s.hw * 0.7, shape.trap(0.3, 0.2, 0.1, zs * 0.03), 0.012, 0.03);
        g.set(C.red, MAT.LIGHT); rearPanel(g, x - 0.012, y, zs * s.hw * 0.7, shape.trap(0.26, 0.16, 0.07, zs * 0.03), 0.008, 0.0);
      }
      diffuser(g, ctx, { x: x + 0.05, y: s.bot - 0.12, w: s.hw * 0.95, len: 0.45, fins: 7 });
      g.set(C.red, MAT.LIGHT); rearPanel(g, x - 0.02, s.bot + 0.18, 0, [[-0.05, -0.04], [0.05, -0.04], [0, 0.05]], 0.02, 0.02);
      ctx.rainLight = [x - 0.04, s.bot + 0.18, 0];
      exhaustTip(g, ctx, [x - 0.1, s.bot + 0.08, 0.0], [-1, 0.1, 0], 0.07, 0.25, { color: [0.5, 0.35, 0.8] });
      licensePlate(g, x - 0.01, y - 0.14, false);
    },
    missile(g, ctx) {
      const { hull, r } = ctx; const x = r.tailX; const s = hull.at(x);
      const y = s.top - s.sh - 0.06;
      tailStrip(g, x, y, s.hw * 0.7, 0.26, 0.09);
      tailStrip(g, x, y, -s.hw * 0.7, 0.26, 0.09, C.amber);
      g.set(C.white, MAT.TRIM); rearPanel(g, x - 0.03, y, -s.hw * 0.7, shape.rect(0.3, 0.02), 0.004, 0.0);
      g.set(C.grey, MAT.CHROME);
      tube(g, [[x + 0.2, s.bot - 0.04, -s.hw * 0.7], [x - 0.08, s.bot - 0.04, -s.hw * 0.6], [x - 0.08, s.bot - 0.04, s.hw * 0.6], [x + 0.2, s.bot - 0.04, s.hw * 0.7]], 0.026, 8);
      exhaustTip(g, ctx, [x - 0.12, s.bot - 0.08, 0.25], [-1, 0, 0], 0.06, 0.3, { color: C.rust, mat: MAT.TRIM });
      towHook(g, x - 0.12, s.bot + 0.06, -0.3, C.red);
    },
  },
};

// ------------------------------------------------------------------ ONI (truck)
const ONI = {
  dims: { wb: 2.84, track: 1.58, R: 0.4, W: 0.27, archR: 0.47, hw: 0.93, rocker: 0.4, sh: 0.06, belt: 1.2, roof: 1.8 },
  fronts: {
    stock: { noseX: 2.33, hoodFront: 1.12, faceTop: 1.06, faceBot: 0.44, noseHW: 0.9, sh: 0.04 },
    deko: { noseX: 2.36, hoodFront: 1.14, faceTop: 1.1, faceBot: 0.4, noseHW: 0.91, sh: 0.04 },
    baja: { noseX: 2.3, hoodFront: 1.12, faceTop: 1.06, faceBot: 0.48, noseHW: 0.9, sh: 0.04 },
    lowrider: { noseX: 2.36, hoodFront: 1.06, faceTop: 0.96, faceBot: 0.36, noseHW: 0.86, sh: 0.06 },
    blower: { noseX: 2.33, hoodFront: 1.12, faceTop: 1.06, faceBot: 0.44, noseHW: 0.9, sh: 0.04 },
    kaido: { noseX: 2.33, hoodFront: 1.12, faceTop: 1.04, faceBot: 0.46, noseHW: 0.9, sh: 0.04 },
  },
  rears: {
    stock: { tailX: -2.42, railY: 1.22, tailBot: 0.46 },
    deko: { tailX: -2.46, railY: 1.22, tailBot: 0.44, shell: true },
    baja: { tailX: -2.42, railY: 1.22, tailBot: 0.48 },
    stacks: { tailX: -2.42, railY: 1.22, tailBot: 0.46 },
    tonneau: { tailX: -2.42, railY: 1.22, tailBot: 0.4, cover: true },
    takeyari: { tailX: -2.46, railY: 1.22, tailBot: 0.44 },
  },
  keys(f) {
    const d = this.dims;
    return [
      { x: -0.5, top: 1.21, bot: d.rocker, hw: d.hw, sh: d.sh },
      { x: 0.72, top: 1.2, bot: d.rocker, hw: d.hw, sh: d.sh },
      ...frontKeys(d, f, 0.72, 1.2),
    ];
  },
  bedKeys(r) {
    const d = this.dims;
    return [
      { x: r.tailX, top: r.railY, bot: r.tailBot, hw: d.hw - 0.01, sh: 0.04 },
      { x: r.tailX + 0.25, top: r.railY, bot: d.rocker + 0.02, hw: d.hw, sh: 0.04 },
      { x: -0.45, top: r.railY, bot: d.rocker, hw: d.hw, sh: 0.04 },
    ];
  },
  cabin(g, ctx) {
    const d = this.dims;
    return buildCabin(g, {
      profile: [[0.72, 1.2], [0.14, d.roof], [-0.38, d.roof], [-0.46, 1.21]],
      roles: ['glass', 'paint', 'glass'], belt: 1.2, roof: d.roof, bw: 0.9, rw: 0.84, pillar: 0.07, windowFloor: 0.04,
    });
  },
  mount(ctx) { return { x: ctx.r.tailX + 0.2, y: ctx.r.cover ? ctx.r.railY + 0.02 : ctx.r.railY, hw: 0.9, roofX: -0.38, roofY: this.dims.roof, roofHW: 0.78 }; },
  frontParts: {
    stock(g, ctx) {
      const { hull, f } = ctx; const x = f.noseX; const s = hull.at(x);
      const y = s.top - s.sh - 0.14;
      grille(g, x + 0.004, y, 0, 0.8, 0.2, { slats: 4 });
      for (const zs of [-1, 1]) {
        g.set(C.chrome, MAT.CHROME); frontPanel(g, x, y, zs * s.hw * 0.72, shape.rect(0.22, 0.17), 0.012, 0.03);
        g.set(C.head, MAT.LIGHT); frontPanel(g, x + 0.012, y, zs * s.hw * 0.72, shape.rect(0.18, 0.13), 0.012, 0.0);
        g.set(C.amber, MAT.LIGHT); frontPanel(g, x + 0.005, y - 0.15, zs * s.hw * 0.72, shape.rect(0.16, 0.05), 0.01, 0.02);
      }
      g.set(C.chrome, MAT.CHROME); g.box(x + 0.06, s.bot + 0.1, 0, 0.14, 0.14, s.hw * 1.96);
      licensePlate(g, x + 0.14, s.bot + 0.1, true);
    },
    deko(g, ctx) {
      const { hull, f } = ctx; const x = f.noseX; const s = hull.at(x);
      const y = s.top - s.sh - 0.14;
      grille(g, x + 0.004, y, 0, 0.84, 0.24, { slats: 9, vertical: true });
      for (const zs of [-1, 1]) {
        for (const k of [0.62, 0.84]) roundHead(g, x + 0.004, y + 0.02, zs * s.hw * k, 0.06);
      }
      // fortress bumper
      g.set(C.chrome, MAT.CHROME);
      g.box(x + 0.2, s.bot + 0.12, 0, 0.42, 0.26, s.hw * 2.1);
      g.box(x + 0.44, s.bot + 0.05, 0, 0.08, 0.14, s.hw * 1.8);
      const cols = [C.amber, C.red, C.cyan, [0.3, 1, 0.3], C.pink];
      for (let i = 0; i < 14; i++) {
        const z = -s.hw * 0.95 + i * (s.hw * 1.9) / 13;
        g.set(cols[i % cols.length], MAT.LIGHT);
        frontPanel(g, x + 0.41, s.bot + 0.18, z, shape.circle(0.03, 8), 0.012, 0.01);
        frontPanel(g, x + 0.48, s.bot + 0.05, z * 0.9, shape.circle(0.022, 8), 0.01, 0.01);
      }
      // visor over the windshield with lamps
      g.set(C.chrome, MAT.CHROME);
      g.box(0.3, ONI.dims.roof + 0.02, 0, 0.5, 0.04, 1.72, [1, 1]);
      for (let i = 0; i < 9; i++) {
        g.set(cols[(i + 2) % cols.length], MAT.LIGHT);
        frontPanel(g, 0.555, ONI.dims.roof + 0.02, -0.76 + i * 0.19, shape.circle(0.022, 8), 0.01, 0.01);
      }
      // andon roof sign
      g.set(C.white, MAT.LIGHT);
      g.box(0.05, ONI.dims.roof + 0.12, 0, 0.2, 0.16, 0.9);
      g.set(C.red, MAT.LIGHT); frontPanel(g, 0.151, ONI.dims.roof + 0.12, 0, shape.rect(0.8, 0.04), 0.004, 0.0);
    },
    baja(g, ctx) {
      const { hull, f } = ctx; const x = f.noseX; const s = hull.at(x);
      const y = s.top - s.sh - 0.14;
      grille(g, x + 0.004, y, 0, 0.8, 0.2, { slats: 2, frame: C.black, frameMat: MAT.TRIM, color: C.black });
      for (const zs of [-1, 1]) roundHead(g, x + 0.004, y, zs * s.hw * 0.72, 0.08);
      g.set(C.black, MAT.TRIM);
      tube(g, [[x + 0.02, s.bot + 0.05, -0.6], [x + 0.18, s.bot + 0.1, -0.5], [x + 0.18, s.bot + 0.5, -0.4], [x + 0.18, s.bot + 0.5, 0.4], [x + 0.18, s.bot + 0.1, 0.5], [x + 0.02, s.bot + 0.05, 0.6]], 0.03, 8);
      tube(g, [[x + 0.18, s.bot + 0.1, -0.5], [x + 0.18, s.bot + 0.1, 0.5]], 0.03, 8, false);
      for (const zs of [-1, 1]) roundLamp(g, [x + 0.22, s.bot + 0.58, zs * 0.25], [1, 0, 0], 0.07, C.yellow);
      g.set(C.grey, MAT.CHROME); g.box(x + 0.05, s.bot - 0.08, 0, 0.45, 0.02, s.hw * 1.3);
      // roof light bar
      g.set(C.black, MAT.TRIM); g.box(0.22, ONI.dims.roof + 0.05, 0, 0.1, 0.08, 1.4);
      for (let i = 0; i < 6; i++) { g.set(C.head, MAT.LIGHT); frontPanel(g, 0.275, ONI.dims.roof + 0.05, -0.6 + i * 0.24, shape.rect(0.16, 0.05), 0.01, 0.0); }
    },
    lowrider(g, ctx) {
      const { hull, f } = ctx; const x = f.noseX; const s = hull.at(x);
      const y = s.top - s.sh - 0.13;
      grille(g, x + 0.004, y, 0, 0.9, 0.22, { slats: 8 });
      for (const zs of [-1, 1]) {
        g.set(C.black, MAT.TRIM); frontPanel(g, x, y, zs * s.hw * 0.78, shape.circle(0.09, 12), 0.005, 0.03);
        g.set(C.head, MAT.LIGHT); frontPanel(g, x + 0.004, y, zs * s.hw * 0.78, shape.circle(0.07, 12), 0.006, 0.0);
      }
      g.set(C.white, MAT.PAINT); g.box(x + 0.01, s.bot + 0.06, 0, 0.06, 0.1, s.hw * 1.8);
      g.set(C.amber, MAT.LIGHT); for (const zs of [-1, 1]) frontPanel(g, x + 0.04, s.bot + 0.06, zs * s.hw * 0.7, shape.rect(0.2, 0.025), 0.005, 0.0);
    },
    blower(g, ctx) {
      ONI.frontParts.stock(g, ctx);
      const { hull } = ctx;
      const x = 1.55, y = hull.topY(x, 0);
      g.set(C.dark, MAT.TRIM); g.box(x, y + 0.08, 0, 0.5, 0.18, 0.4);
      g.set(C.chrome, MAT.CHROME); g.box(x, y + 0.2, 0, 0.44, 0.08, 0.34);
      // butterfly scoop
      g.set(C.chrome, MAT.CHROME); g.box(x + 0.02, y + 0.36, 0, 0.34, 0.24, 0.3, [0.9, 0.9]);
      g.set(C.black, MAT.TRIM); frontPanel(g, x + 0.19, y + 0.38, 0, shape.rect(0.22, 0.16), 0.005, 0.02);
      g.set(C.red, MAT.TRIM); g.box(x - 0.29, y + 0.06, 0.12, 0.06, 0.12, 0.08);
      g.set(C.black, MAT.TRIM); for (const zs of [-1, 1]) tube(g, [[x - 0.2, y + 0.02, zs * 0.18], [x - 0.35, y + 0.02, zs * 0.25]], 0.03, 6, false);
      ctx.blower = [x, y + 0.5, 0];
    },
    kaido(g, ctx) { FRONT_KITS.kaido(g, ctx); },
  },
  rearParts: {
    stock(g, ctx) {
      const { r, bed } = ctx; const x = r.tailX;
      for (const zs of [-1, 1]) {
        g.set(C.black, MAT.TRIM); rearPanel(g, x, r.railY - 0.2, zs * 0.84, shape.rect(0.1, 0.26), 0.012, 0.02);
        g.set(C.red, MAT.LIGHT); rearPanel(g, x - 0.012, r.railY - 0.16, zs * 0.84, shape.rect(0.08, 0.14), 0.01, 0.0);
        g.set(C.amber, MAT.LIGHT); rearPanel(g, x - 0.012, r.railY - 0.3, zs * 0.84, shape.rect(0.08, 0.06), 0.01, 0.0);
      }
      g.set(C.chrome, MAT.CHROME); g.box(x - 0.06, r.tailBot + 0.06, 0, 0.14, 0.12, 1.8);
      licensePlate(g, x - 0.02, r.tailBot + 0.22, false);
      exhaustTip(g, ctx, [x + 0.25, r.tailBot - 0.06, 0.55], [-1, 0, 0], 0.045, 0.2);
      void bed;
    },
    deko(g, ctx) {
      const { r } = ctx; const x = r.tailX;
      // shell box
      const x0 = x + 0.02, x1 = -0.52, y0 = r.railY - 0.02, y1 = ONI.dims.roof - 0.02, w = 0.9;
      g.set(C.white, MAT.PAINT); g.box((x0 + x1) / 2, (y0 + y1) / 2, 0, x1 - x0, y1 - y0, w * 2);
      g.set(C.chrome, MAT.CHROME);
      for (const yy of [y0 + 0.02, y1 - 0.02]) for (const zs of [-1, 1]) g.box((x0 + x1) / 2, yy, zs * (w + 0.01), x1 - x0 + 0.04, 0.05, 0.03);
      for (const xx of [x0, x1]) for (const zs of [-1, 1]) g.box(xx, (y0 + y1) / 2, zs * (w + 0.01), 0.05, y1 - y0, 0.03);
      const cols = [C.amber, C.red, C.cyan, [0.3, 1, 0.3], C.pink];
      for (let i = 0; i < 10; i++) for (const zs of [-1, 1]) {
        g.set(cols[i % 5], MAT.LIGHT);
        sidePanel(g, lerp(x0 + 0.1, x1 - 0.1, i / 9), y1 - 0.06, zs * (w + 0.03), shape.circle(0.025, 8), 0.012, 0.01, [0, 0, zs]);
        sidePanel(g, lerp(x0 + 0.1, x1 - 0.1, i / 9), y0 + 0.06, zs * (w + 0.03), shape.circle(0.025, 8), 0.012, 0.01, [0, 0, zs]);
      }
      // rear doors of the shell
      g.set(C.chrome, MAT.CHROME); rearPanel(g, x0, (y0 + y1) / 2, 0, shape.rect(1.7, y1 - y0 - 0.05), 0.012, 0.01);
      g.set(C.white, MAT.ACCENT); rearPanel(g, x0 - 0.012, (y0 + y1) / 2, 0, shape.rect(1.5, y1 - y0 - 0.2), 0.008, 0.0);
      for (let i = 0; i < 8; i++) { g.set(cols[i % 5], MAT.LIGHT); rearPanel(g, x0 - 0.02, y1 - 0.08, -0.7 + i * 0.2, shape.circle(0.03, 8), 0.012, 0.0); }
      for (const zs of [-1, 1]) { g.set(C.red, MAT.LIGHT); rearPanel(g, x - 0.01, r.tailBot + 0.25, zs * 0.75, shape.rect(0.22, 0.1), 0.012, 0.01); }
      g.set(C.chrome, MAT.CHROME); g.box(x - 0.08, r.tailBot + 0.08, 0, 0.18, 0.16, 1.9);
      exhaustTip(g, ctx, [x + 0.2, r.tailBot - 0.05, 0.6], [-1, 0, 0], 0.05, 0.2);
    },
    baja(g, ctx) {
      ONI.rearParts.stock(g, ctx);
      const x = -0.62, top = ONI.dims.roof + 0.08;
      g.set(C.black, MAT.TRIM);
      tube(g, [[x, ctx.r.railY, -0.84], [x, top, -0.7], [x, top, 0.7], [x, ctx.r.railY, 0.84]], 0.035, 8);
      tube(g, [[x, top, -0.7], [x - 0.5, ctx.r.railY, -0.84]], 0.03, 6, false);
      tube(g, [[x, top, 0.7], [x - 0.5, ctx.r.railY, 0.84]], 0.03, 6, false);
      for (let i = 0; i < 4; i++) roundLamp(g, [x + 0.06, top + 0.08, -0.54 + i * 0.36], [1, 0, 0], 0.065, C.yellow);
      // spare tyre in the bed
      g.set([0.09, 0.09, 0.11], MAT.RUBBER);
      g.at([-1.5, 0.98, 0], [0, 0, Math.PI / 2], 1, (gg) => gg.lathe([[0.2, -0.12], [0.37, -0.12], [0.4, -0.06], [0.4, 0.06], [0.37, 0.12], [0.2, 0.12]], 16, true));
      g.set(C.white, MAT.RIM); g.at([-1.5, 1.105, 0], [0, 0, Math.PI / 2], 1, (gg) => gg.disc(0, 0.2, 12));
    },
    stacks(g, ctx) {
      ONI.rearParts.stock(g, ctx);
      for (const zs of [-1, 1]) {
        const x = -0.66, z = zs * 0.74;
        g.set(C.chrome, MAT.CHROME);
        g.cyl([x, 0.9, z], [x, 2.45, z], 0.075, 0.075, 12, false);
        g.set(C.black, MAT.TRIM); g.cyl([x, 1.3, z], [x, 1.7, z], 0.085, 0.085, 12, false);
        g.set(C.chrome, MAT.CHROME); g.cyl([x, 2.45, z], [x - 0.12, 2.6, z], 0.075, 0.09, 12, false);
        ctx.exhausts.push({ pos: [x - 0.12, 2.62, z], dir: [-0.4, 1, 0], r: 0.09, big: true });
      }
    },
    tonneau(g, ctx) {
      const { r } = ctx; const x = r.tailX;
      g.set(C.dark, MAT.CARBON); g.box((x - 0.5) / 2, r.railY + 0.01, 0, -0.52 - x, 0.03, 1.84);
      g.set(C.white, MAT.PAINT); g.at([x + 0.08, r.railY + 0.06, 0], [0, 0, 0.3], 1, (gg) => gg.box(0, 0, 0, 0.2, 0.03, 1.8));
      for (const zs of [-1, 1]) tailStrip(g, x, r.railY - 0.16, zs * 0.62, 0.5, 0.06);
      diffuser(g, ctx, { x: x + 0.05, y: r.tailBot - 0.08, w: 0.8, len: 0.35, fins: 6 });
      for (const zs of [-1, 1]) exhaustTip(g, ctx, [x - 0.06, r.tailBot + 0.03, zs * 0.3], [-1, 0, 0], 0.05, 0.2);
      licensePlate(g, x - 0.01, r.tailBot + 0.28, false);
    },
    takeyari(g, ctx) {
      const { r } = ctx; const x = r.tailX;
      for (const zs of [-1, 1]) roundTail(g, x, r.railY - 0.2, zs * 0.7, 0.08);
      g.set(C.white, MAT.ACCENT); g.box(x - 0.04, r.tailBot + 0.08, 0, 0.14, 0.16, 1.9);
      licensePlate(g, x - 0.02, r.tailBot + 0.3, false);
      takeyari(g, ctx, { x: x + 0.1, y: r.tailBot + 0.12, z: 0.72, height: 1.6, lean: 0.55, count: 2 });
    },
  },
};

// ------------------------------------------------------------------ RAIDEN (coupe)
const RAIDEN = {
  dims: { wb: 2.5, track: 1.54, R: 0.345, W: 0.245, archR: 0.41, hw: 0.91, rocker: 0.25, sh: 0.075, belt: 0.84, roof: 1.2 },
  fronts: {
    stock: { noseX: 2.12, hoodFront: 0.73, faceTop: 0.63, faceBot: 0.2, noseHW: 0.8, sh: 0.06 },
    popup: { noseX: 2.2, hoodFront: 0.66, faceTop: 0.54, faceBot: 0.2, noseHW: 0.82, sh: 0.05 },
    hyper: { noseX: 2.16, hoodFront: 0.7, faceTop: 0.58, faceBot: 0.16, noseHW: 0.86, sh: 0.05 },
    shark: { noseX: 2.36, hoodFront: 0.7, faceTop: 0.56, faceBot: 0.26, noseHW: 0.72, sh: 0.06 },
    attack: { noseX: 2.2, hoodFront: 0.7, faceTop: 0.6, faceBot: 0.16, noseHW: 0.86, sh: 0.05 },
    kaido: { noseX: 2.16, hoodFront: 0.74, faceTop: 0.68, faceBot: 0.26, noseHW: 0.84, sh: 0.05 },
  },
  rears: {
    stock: { tailX: -2.1, deckEnd: 0.9, tailTop: 0.82, tailBot: 0.27, tailHW: 0.84, sh: 0.06 },
    lightbar: { tailX: -2.12, deckEnd: 0.9, tailTop: 0.82, tailBot: 0.27, tailHW: 0.86, sh: 0.05 },
    ducktail: { tailX: -2.14, deckEnd: 1.0, tailTop: 0.9, tailBot: 0.26, tailHW: 0.86, sh: 0.05, duck: true },
    venturi: { tailX: -2.12, deckEnd: 0.92, tailTop: 0.84, tailBot: 0.34, tailHW: 0.88, sh: 0.05 },
    takeyari: { tailX: -2.16, deckEnd: 0.9, tailTop: 0.8, tailBot: 0.24, tailHW: 0.86, sh: 0.05 },
    missile: { tailX: -1.92, deckEnd: 0.92, tailTop: 0.84, tailBot: 0.42, tailHW: 0.86, sh: 0.05 },
  },
  keys(f, r) {
    const d = this.dims;
    return [
      ...rearKeys(d, r, -1.75, 0.93, 0.95),
      { x: -1.75, top: 0.93, bot: d.rocker, hw: 0.955, sh: d.sh, ease: true },
      { x: -1.1, top: 0.87, bot: d.rocker, hw: 0.96, sh: d.sh, ease: true },
      { x: -0.35, top: 0.845, bot: d.rocker, hw: 0.9, sh: d.sh, ease: true },
      { x: 0.75, top: 0.85, bot: d.rocker, hw: 0.9, sh: d.sh, ease: true },
      { x: 1.25, top: lerp(0.85, f.hoodFront, 0.45), bot: d.rocker, hw: 0.935, sh: d.sh, ease: true },
      ...frontKeys(d, f, 1.25, lerp(0.85, f.hoodFront, 0.45), 0.935),
    ];
  },
  cabin(g, ctx) {
    const d = this.dims;
    return buildCabin(g, {
      profile: [[0.75, 0.85], [0.0, d.roof], [-0.5, d.roof - 0.01], [-1.25, 0.99], [-1.75, 0.93]],
      roles: ['glass', 'paint', 'glass', 'paint'], belt: 0.85, roof: d.roof, bw: 0.86, rw: 0.6, pillar: 0.07, clipRear: -0.95,
    });
  },
  mount(ctx) { return { x: ctx.r.tailX + 0.22, y: ctx.r.deckEnd, hw: 0.86, roofX: -0.5, roofY: this.dims.roof, roofHW: 0.56 }; },
  frontParts: {
    stock(g, ctx) {
      const { hull, f } = ctx; const x = f.noseX; const s = hull.at(x);
      for (const zs of [-1, 1]) noseLamp(g, hull, [[x - 0.04, zs * s.hw * 0.52], [x - 0.08, zs * s.hw * 0.93], [x - 0.36, zs * s.hw * 1.02], [x - 0.3, zs * s.hw * 0.7]], C.head);
      g.set(C.black, MAT.TRIM); frontPanel(g, x + 0.004, s.bot + 0.14, 0, shape.circle(0.34, 16, 0.09), 0.012, 0.03);
      g.set(C.dark, MAT.TRIM); frontPanel(g, x + 0.016, s.bot + 0.14, 0, shape.rect(0.5, 0.012), 0.006, 0.0);
      for (const zs of [-1, 1]) { g.set(C.amber, MAT.LIGHT); frontPanel(g, x + 0.004, s.bot + 0.12, zs * s.hw * 0.78, shape.round(0.1, 0.04, 0.015), 0.01, 0.02); }
    },
    popup(g, ctx) {
      const { hull, f } = ctx; const x = f.noseX; const s = hull.at(x);
      for (const zs of [-1, 1]) {
        const px = x - 0.42, pz = zs * s.hw * 0.66, py = hull.topY(px, pz);
        g.set(C.white, MAT.PAINT);
        g.at([px, py + 0.07, pz], [0, 0, -0.08], 1, (gg) => gg.box(0, 0, 0, 0.1, 0.14, 0.3));
        g.set(C.black, MAT.TRIM); frontPanel(g, px + 0.052, py + 0.07, pz, shape.rect(0.27, 0.11), 0.006, 0.01);
        g.set(C.head, MAT.LIGHT); frontPanel(g, px + 0.058, py + 0.07, pz - zs * 0.06, shape.circle(0.045, 10), 0.01, 0.0);
        g.set(C.head, MAT.LIGHT); frontPanel(g, px + 0.058, py + 0.07, pz + zs * 0.06, shape.circle(0.045, 10), 0.01, 0.0);
        g.set(C.amber, MAT.LIGHT); frontPanel(g, x + 0.004, s.top - s.sh - 0.08, zs * s.hw * 0.72, shape.rect(0.18, 0.04), 0.01, 0.02);
      }
      g.set(C.black, MAT.TRIM); frontPanel(g, x + 0.004, s.bot + 0.12, 0, shape.round(1.0, 0.08, 0.03), 0.012, 0.03);
      licensePlate(g, x + 0.02, s.bot + 0.2, true);
    },
    hyper(g, ctx) {
      const { hull, f } = ctx; const x = f.noseX; const s = hull.at(x);
      for (const zs of [-1, 1]) {
        noseLamp(g, hull, [[x - 0.02, zs * s.hw * 0.3], [x - 0.02, zs * s.hw * 0.95], [x - 0.07, zs * s.hw * 0.98], [x - 0.06, zs * s.hw * 0.32]], C.cyan);
        g.set(C.black, MAT.TRIM); frontPanel(g, x + 0.004, s.bot + 0.15, zs * s.hw * 0.66, shape.trap(0.42, 0.3, 0.2, zs * 0.04), 0.014, 0.03);
        g.set(C.dark, MAT.CARBON); for (let i = 0; i < 3; i++) frontPanel(g, x + 0.018, s.bot + 0.09 + i * 0.06, zs * s.hw * 0.66, shape.rect(0.36 - i * 0.04, 0.012), 0.008, 0);
      }
      g.set(C.white, MAT.ACCENT); frontPanel(g, x + 0.004, s.bot + 0.16, 0, shape.trap(0.34, 0.26, 0.14), 0.04, 0.03);
      g.set(C.cyan, MAT.LIGHT); frontPanel(g, x + 0.045, s.bot + 0.1, 0, shape.rect(0.3, 0.012), 0.006, 0);
      g.set(C.dark, MAT.CARBON); g.box(x + 0.03, s.bot - 0.01, 0, 0.14, 0.025, s.hw * 1.9);
    },
    shark(g, ctx) {
      const { hull, f } = ctx; const x = f.noseX; const s = hull.at(x);
      g.set(C.chrome, MAT.CHROME); frontPanel(g, x, s.bot + 0.14, 0, shape.circle(0.2, 16, 0.13), 0.02, 0.03);
      g.set(C.black, MAT.TRIM); frontPanel(g, x + 0.02, s.bot + 0.14, 0, shape.circle(0.17, 16, 0.105), 0.006, 0.0);
      for (const zs of [-1, 1]) {
        const px = x - 0.46, pz = zs * s.hw * 0.72;
        const py = hull.topY(px, pz);
        g.set(C.black, MAT.TRIM);
        panel(g, [px, py, pz], [0.7, 0.7, 0], [0, 0, 1], shape.circle(0.1, 12), 0.01, 0.03);
        g.set(C.head, MAT.LIGHT);
        panel(g, [px + 0.007, py + 0.007, pz], [0.7, 0.7, 0], [0, 0, 1], shape.circle(0.075, 12), 0.012, 0.0);
        g.set(C.amber, MAT.LIGHT); frontPanel(g, x - 0.02, s.bot + 0.24, zs * s.hw * 0.6, shape.round(0.12, 0.035, 0.012), 0.01, 0.02);
      }
    },
    attack(g, ctx) { FRONT_KITS.attack(g, ctx); },
    kaido(g, ctx) { FRONT_KITS.kaido(g, ctx); },
  },
  rearParts: {
    stock(g, ctx) {
      const { hull, r } = ctx; const x = r.tailX; const s = hull.at(x);
      const y = s.top - s.sh - 0.07;
      for (const zs of [-1, 1]) { roundTail(g, x, y, zs * s.hw * 0.52, 0.075); roundTail(g, x, y, zs * s.hw * 0.78, 0.075); }
      licensePlate(g, x - 0.01, s.bot + 0.22, false);
      exhaustTip(g, ctx, [x - 0.06, s.bot + 0.04, 0.0], [-1, 0, 0], 0.07, 0.2);
      g.set(C.dark, MAT.TRIM); g.box(x + 0.03, s.bot - 0.01, 0, 0.12, 0.04, s.hw * 1.5);
    },
    lightbar(g, ctx) {
      const { hull, r } = ctx; const x = r.tailX; const s = hull.at(x);
      const y = s.top - s.sh - 0.06;
      g.set(C.black, MAT.TRIM); rearPanel(g, x, y - 0.04, 0, shape.rect(s.hw * 1.8, 0.16), 0.01, 0.03);
      g.set(C.red, MAT.LIGHT); rearPanel(g, x - 0.01, y, 0, shape.rect(s.hw * 1.76, 0.03), 0.008, 0);
      g.set(C.white, MAT.LIGHT); rearPanel(g, x - 0.01, y - 0.07, 0, shape.rect(0.3, 0.02), 0.006, 0);
      for (const zs of [-1, 1]) exhaustTip(g, ctx, [x - 0.05, s.bot + 0.05, zs * s.hw * 0.66], [-1, 0, 0], 0.05, 0.2);
      licensePlate(g, x - 0.01, s.bot + 0.2, false);
    },
    ducktail(g, ctx) {
      const { hull, r } = ctx; const x = r.tailX; const s = hull.at(x);
      const y = s.top - s.sh - 0.07;
      for (const zs of [-1, 1]) for (let i = 0; i < 3; i++) {
        g.set(C.black, MAT.TRIM); rearPanel(g, x, y - i * 0.035, zs * s.hw * 0.62, shape.rect(0.42, 0.022), 0.01, 0.03);
        g.set(C.red, MAT.LIGHT); rearPanel(g, x - 0.01, y - i * 0.035, zs * s.hw * 0.62, shape.rect(0.4, 0.014), 0.006, 0);
      }
      diffuser(g, ctx, { x: x + 0.03, y: s.bot - 0.06, w: s.hw * 0.75, len: 0.25, fins: 5 });
      for (const zs of [-1, 1]) exhaustTip(g, ctx, [x - 0.06, s.bot + 0.04, zs * 0.14], [-1, 0, 0], 0.05, 0.2);
    },
    venturi(g, ctx) {
      const { hull, r } = ctx; const x = r.tailX; const s = hull.at(x);
      const y = s.top - s.sh - 0.07;
      g.set(C.black, MAT.TRIM); rearPanel(g, x, (y + s.bot) / 2 + 0.02, 0, shape.rect(s.hw * 1.7, y - s.bot + 0.04), 0.01, 0.03);
      g.set(C.dark, MAT.TRIM); for (let i = 0; i < 5; i++) rearPanel(g, x - 0.012, s.bot + 0.12 + i * 0.07, 0, shape.rect(s.hw * 1.6, 0.012), 0.006, 0);
      for (const zs of [-1, 1]) { g.set(C.red, MAT.LIGHT); rearPanel(g, x - 0.012, y + 0.02, zs * s.hw * 0.72, shape.rect(0.28, 0.035), 0.01, 0); }
      diffuser(g, ctx, { x: x + 0.1, y: s.bot - 0.14, w: s.hw, len: 0.55, fins: 8 });
      for (const zs of [-1, 1]) exhaustTip(g, ctx, [x - 0.08, s.bot + 0.14, zs * 0.28], [-1, 0, 0], 0.075, 0.3, { color: [0.45, 0.35, 0.8] });
    },
    takeyari(g, ctx) {
      const { hull, r } = ctx; const x = r.tailX; const s = hull.at(x);
      const y = s.top - s.sh - 0.06;
      for (const zs of [-1, 1]) roundTail(g, x, y, zs * s.hw * 0.66, 0.08);
      g.set(C.white, MAT.ACCENT); g.box(x - 0.02, s.bot + 0.04, 0, 0.14, 0.1, s.hw * 1.9);
      takeyari(g, ctx, { x: x + 0.1, y: s.bot + 0.1, z: s.hw * 0.72, height: 1.35, lean: 0.55, count: 2 });
    },
    missile(g, ctx) { KAZE.rearParts.missile(g, ctx); },
  },
};

// ------------------------------------------------------------------ key builders
function frontKeys(d, f, cowlX, cowlTop, hwIn = d.hw) {
  const ax = d.wb / 2;
  const k = [];
  if (ax + 0.2 < f.noseX - 0.34 && ax + 0.2 > cowlX + 0.05) k.push({ x: ax + 0.2, top: lerp(cowlTop, f.hoodFront, 0.6), bot: d.rocker, hw: hwIn, sh: d.sh });
  k.push({ x: f.noseX - 0.3, top: f.hoodFront, bot: f.faceBot + 0.02, hw: hwIn - 0.005, sh: d.sh });
  k.push({ x: f.noseX - 0.1, top: lerp(f.hoodFront, f.faceTop, 0.62), bot: f.faceBot, hw: lerp(hwIn, f.noseHW, 0.55), sh: lerp(d.sh, f.sh, 0.5) });
  k.push({ x: f.noseX, top: f.faceTop, bot: f.faceBot + 0.05, hw: f.noseHW, sh: f.sh });
  return k;
}

function rearKeys(d, r, deckX, deckTop, hwIn = d.hw) {
  const k = [
    { x: r.tailX, top: r.tailTop, bot: r.tailBot + 0.05, hw: r.tailHW, sh: r.sh },
    { x: r.tailX + 0.1, top: lerp(r.deckEnd, r.tailTop, 0.55), bot: r.tailBot, hw: lerp(hwIn, r.tailHW, 0.5), sh: r.sh },
    { x: r.tailX + 0.3, top: r.deckEnd, bot: r.tailBot + 0.01, hw: hwIn - 0.005, sh: d.sh },
  ];
  if (r.duck) k.splice(2, 0, { x: r.tailX + 0.18, top: r.deckEnd + 0.01, bot: r.tailBot + 0.01, hw: hwIn - 0.01, sh: d.sh * 0.6 });
  if (r.tailX + 0.3 < deckX - 0.1) k.push({ x: lerp(r.tailX + 0.3, deckX, 0.5), top: lerp(r.deckEnd, deckTop, 0.5) + 0.01, bot: d.rocker, hw: hwIn, sh: d.sh });
  return k;
}

export const BODY_DEFS = { kaze: KAZE, oni: ONI, raiden: RAIDEN };
export { buildBed };
void sidePanel; void Hull; void tube;
