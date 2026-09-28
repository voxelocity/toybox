// Parametric car body loft.
//
// A body definition (see cars/*/body.js) describes key lines running the length
// of the car. At every station x we build a half cross-section from those key
// points (crown -> greenhouse -> shoulder -> side -> rocker -> floor), clamp it
// by the plan-view nose/tail outlines, and stitch consecutive sections into a
// structured grid. The grid is mirrored for the other side.
//
// Everything here works in millimetres in car coordinates:
//   x forward from the front axle, w lateral half-width, z height.

import * as THREE from 'three';
import { pchip, pchipColumns, clamp, lerp, smoothstep, smin, qbez, cbez, inverseTable } from './interp.js';

// Rows per segment, top to bottom.
export const SEGMENTS = [
  { key: 'crown', n: 20 },   // top centre -> ue
  { key: 'glass', n: 10 },   // ue -> bl
  { key: 'ledge', n: 8 },    // bl -> sh
  { key: 'upper', n: 7 },    // sh -> bt
  { key: 'bump', n: 6 },     // bt -> wd (bt = bumper top parting line at the ends)
  { key: 'mid', n: 7 },      // wd -> lm
  { key: 'lower', n: 9 },    // lm -> rk
  { key: 'sill', n: 7 },     // rk -> sb
  { key: 'floor', n: 6 },    // sb -> bottom centre
];

export function rowLayout() {
  const rows = [];
  let r = 0;
  SEGMENTS.forEach((s, si) => {
    for (let i = 0; i < s.n; i++) rows.push({ seg: s.key, segIndex: si, t: i / s.n, row: r++ });
  });
  rows.push({ seg: 'floor', segIndex: SEGMENTS.length - 1, t: 1, row: r++ }); // bottom centre
  return rows;
}

export class BodyLoft {
  constructor(def, opts = {}) {
    this.def = def;
    this.zScale = opts.zScale ?? 1;
    const zs = this.zScale;
    this.zTop = pchip(def.zTop.map(([x, z]) => [x, z * zs]));
    this.zBot = pchip(def.zBot.map(([x, z]) => [x, z * zs]));
    const cols = (rows) => pchipColumns(rows.map(([x, w, z]) => [x, w, z * zs]));
    this.lines = {};
    for (const k of ['ue', 'bl', 'sh', 'bt', 'wd', 'lm', 'rk', 'sb']) this.lines[k] = cols(def[k]);
    this.crown = pchip(def.crown);
    this.nose = {
      split: def.nose.split.map((z) => z * zs),
      lower: inverseTable(def.nose.lower),
      upper: inverseTable(def.nose.upper),
    };
    this.tail = {
      split: def.tail.split.map((z) => z * zs),
      lower: inverseTable(def.tail.lower),
      upper: inverseTable(def.tail.upper),
    };
    this.xFront = Math.max(...def.nose.lower.map((p) => p[1]));
    this.xRear = Math.min(...def.tail.lower.map((p) => p[1]));
    this.rows = rowLayout();
    this.deform = null; // optional (x, w, z, rowInfo) => [w, z] used by body-kit variants
  }

  key(name, x) {
    const [w, z] = this.lines[name];
    return [w(x), z(x)];
  }

  /** Lateral limit from the nose/tail plan outlines at station x, height z. */
  planLimit(x, z) {
    const n = this.nose, t = this.tail;
    const fn = lerp(n.lower(x), n.upper(x), smoothstep(n.split[0], n.split[1], z));
    const ft = lerp(t.lower(x), t.upper(x), smoothstep(t.split[0], t.split[1], z));
    const a = isFinite(fn) ? fn : Infinity, b = isFinite(ft) ? ft : Infinity;
    return Math.min(a, b);
  }

  /** Half cross-section at station x: array of [w, z] rows, top centre to bottom centre. */
  section(x) {
    const zt = this.zTop(x), zb = this.zBot(x);
    let K = ['ue', 'bl', 'sh', 'bt', 'wd', 'lm', 'rk', 'sb'].map((k) => this.key(k, x));
    // keep key heights inside the section and in descending order
    let ceiling = zt;
    K = K.map(([w, z]) => { const zz = clamp(Math.min(z, ceiling), zb, zt); ceiling = zz; return [w, zz]; });
    const [ue, bl, sh, bt, wd, lm, rk, sb] = K;
    const p = this.crown(x);
    const pts = [];
    const push = (w, z) => pts.push([Math.max(0, w), z]);

    // crown: centre -> ue, sampled in w with more points toward the edge
    const nCrown = SEGMENTS[0].n;
    for (let i = 0; i < nCrown; i++) {
      const s = i / nCrown;
      const u = 1 - Math.pow(1 - s, 1.6);
      const w = ue[0] * u;
      const z = ue[1] + (zt - ue[1]) * (1 - Math.pow(u, p));
      push(w, z);
    }
    const seg = (a, b, ctrl, n, cubicCtrl2) => {
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const q = cubicCtrl2 ? cbez(a, ctrl, cubicCtrl2, b, t) : qbez(a, ctrl, b, t);
        push(q[0], q[1]);
      }
    };
    // glass / pillar: slightly convex outward
    {
      const mx = (ue[0] + bl[0]) / 2, mz = (ue[1] + bl[1]) / 2;
      const dx = bl[0] - ue[0], dz = bl[1] - ue[1];
      const len = Math.hypot(dx, dz) || 1;
      const bulge = Math.min(10, len * 0.03);
      seg(ue, bl, [mx + (-dz / len) * -bulge, mz + (dx / len) * -bulge], SEGMENTS[1].n);
    }
    // ledge: belt -> shoulder crease, convex
    seg(bl, sh, [lerp(bl[0], sh[0], 0.7), lerp(bl[1], sh[1], 0.2)], SEGMENTS[2].n);
    // upper side: crease -> bumper-top line -> widest point (vertical tangent at wd)
    {
      // one cubic from sh to wd, split at the height of bt so a row lands on it
      const c1 = [lerp(sh[0], wd[0], 0.85), lerp(sh[1], wd[1], 0.25)], c2 = [wd[0], lerp(sh[1], wd[1], 0.6)];
      const zAt = (t) => cbez(sh, c1, c2, wd, t)[1];
      let lo = 0, hi = 1;
      for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (zAt(m) > bt[1]) lo = m; else hi = m; }
      const tb = clamp((lo + hi) / 2, 0.02, 0.98);
      const n1 = SEGMENTS[3].n, n2 = SEGMENTS[4].n;
      for (let i = 0; i < n1; i++) { const q = cbez(sh, c1, c2, wd, tb * (i / n1)); push(q[0], q[1]); }
      for (let i = 0; i < n2; i++) {
        // pack rows toward the bumper-top line so the ledge at the ends stays clean
        const u = i / n2, t = tb + (1 - tb) * (u * u * 0.6 + u * 0.4);
        const q = cbez(sh, c1, c2, wd, t); push(q[0], q[1]);
      }
    }
    // mid side: widest -> lower line
    seg(wd, lm, [wd[0], lerp(wd[1], lm[1], 0.45)], SEGMENTS[5].n);
    // lower side: lower line -> rocker top
    seg(lm, rk, [lerp(lm[0], rk[0], 0.25), lerp(lm[1], rk[1], 0.55)], SEGMENTS[6].n);
    // sill: rocker -> sill bottom corner (tucks under)
    seg(rk, sb, [rk[0] - 2, lerp(rk[1], sb[1], 0.8)], SEGMENTS[7].n, [lerp(rk[0], sb[0], 0.55), sb[1] - 2]);
    // floor: sill corner -> centre
    const nFloor = SEGMENTS[8].n;
    for (let i = 0; i < nFloor; i++) {
      const t = Math.pow(i / nFloor, 0.7);
      push(sb[0] * (1 - t), lerp(sb[1], zb, Math.min(1, t * 1.6)));
    }
    push(0, zb);

    // clamp by the nose / tail plan outlines (smoothly, rounds the corners)
    for (const pt of pts) {
      const lim = this.planLimit(x, pt[1]);
      if (isFinite(lim)) pt[0] = Math.max(0, smin(pt[0], lim, 22));
    }
    if (this.deform) {
      for (let i = 0; i < pts.length; i++) {
        const r = this.deform(x, pts[i][0], pts[i][1], this.rows[i]);
        if (r) { pts[i][0] = r[0]; pts[i][1] = r[1]; }
      }
    }
    return pts;
  }

  /** Body half-width at station x and height z (searches the side rows). */
  widthAt(x, z, sec = null) {
    const pts = sec || this.section(x);
    const start = SEGMENTS[0].n; // skip the crown (sampled in w)
    let best = null;
    for (let i = start; i < pts.length - 1; i++) {
      const [w0, z0] = pts[i], [w1, z1] = pts[i + 1];
      if ((z0 - z) * (z1 - z) <= 0 && z0 !== z1) {
        const t = (z - z0) / (z1 - z0);
        const w = w0 + (w1 - w0) * t;
        if (best === null || w > best) best = w;
      }
    }
    return best ?? 0;
  }

  /** Station x positions, dense where the shape changes quickly. */
  stations() {
    const xs = [];
    const add = (a, b, step) => { const n = Math.max(1, Math.round(Math.abs(b - a) / step)); for (let i = 0; i < n; i++) xs.push(a + (b - a) * i / n); };
    add(this.xFront, 745, 1.5);
    add(745, 700, 2.5);
    add(700, 560, 7);
    add(560, -3560, 16);
    add(-3560, -3625, 5);
    add(-3625, this.xRear, 1.5);
    xs.push(this.xRear);
    return xs;
  }

  /**
   * Build the full (mirrored) body grid.
   * Returns { positions: Float32Array(mm), stations, rows, index(fn) }
   */
  buildGrid() {
    const xs = this.stations();
    const R = this.rows.length;
    const S = xs.length;
    const P = new Float32Array(S * R * 3);
    for (let s = 0; s < S; s++) {
      const sec = this.section(xs[s]);
      for (let r = 0; r < R; r++) {
        const o = (s * R + r) * 3;
        P[o] = xs[s]; P[o + 1] = sec[r][1]; P[o + 2] = sec[r][0];
      }
    }
    return { P, xs, S, R };
  }
}

/**
 * Turn a grid (or a sub-rectangle of it) into a THREE.BufferGeometry in metres,
 * mirrored to both sides. `filter(s, r)` decides which quads are included.
 * `creaseRows` duplicates vertices along those rows so normals stay sharp.
 * Coordinates: THREE x = car x, y = z (up), z = +/- w.
 */
export function gridGeometry(grid, { filter = () => true, creaseRows = [], offsetX = 0 } = {}) {
  const { P, S, R } = grid;
  const creases = new Set(creaseRows);
  // Build a vertex map with duplication across crease rows: each quad takes the
  // "lower" copy of its top row when the top row is a crease row.
  const pos = [], uv = [], idx = [];
  const vmap = new Map();
  const vert = (s, r, side, copy) => {
    const onCentre = P[(s * R + r) * 3 + 2] < 1.0; // shared by both sides -> no seam
    const key = ((s * R + r) * 2 + (side > 0 || onCentre ? 1 : 0)) * 2 + copy;
    let v = vmap.get(key);
    if (v !== undefined) return v;
    const o = (s * R + r) * 3;
    v = pos.length / 3;
    pos.push((P[o] + offsetX) / 1000, P[o + 1] / 1000, onCentre ? 0 : side * P[o + 2] / 1000);
    uv.push(s / (S - 1), r / (R - 1));
    vmap.set(key, v);
    return v;
  };
  for (const side of [1, -1]) {
    for (let s = 0; s < S - 1; s++) {
      for (let r = 0; r < R - 1; r++) {
        if (!filter(s, r)) continue;
        const cTop = creases.has(r) ? 1 : 0; // quad below a crease uses copy 1 of the crease row
        const a = vert(s, r, side, cTop), b = vert(s + 1, r, side, cTop);
        const c = vert(s + 1, r + 1, side, 0), d = vert(s, r + 1, side, 0);
        // skip fully degenerate quads
        if (side > 0) idx.push(a, b, d, b, c, d);
        else idx.push(a, d, b, b, d, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
