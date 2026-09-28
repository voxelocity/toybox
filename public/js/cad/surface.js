// Fast queries on a built body grid, and patches that sit on the body surface
// (lamp lenses, badges, trims). Units: millimetres, car coordinates.
import * as THREE from 'three';
import { SEGMENTS } from './body-loft.js';

const Z_STEP = 4, Z_MAX = 1500;

export class SurfaceField {
  constructor(loft, grid) {
    this.loft = loft;
    this.grid = grid;
    const { P, xs, S, R } = grid;
    this.xs = xs;
    const NZ = Math.floor(Z_MAX / Z_STEP) + 1;
    this.NZ = NZ;
    this.W = new Float32Array(S * NZ); // max side width at each (station, z)
    this.top = [];                      // crown rows per station: [[w, z], ...]
    const crownN = SEGMENTS[0].n;
    for (let s = 0; s < S; s++) {
      const row = (r) => [P[(s * R + r) * 3 + 2], P[(s * R + r) * 3 + 1]];
      const crown = [];
      for (let r = 0; r <= crownN; r++) crown.push(row(r));
      this.top.push(crown);
      for (let k = 0; k < NZ; k++) this.W[s * NZ + k] = 0;
      for (let r = 0; r < R - 1; r++) {
        const [w0, z0] = row(r), [w1, z1] = row(r + 1);
        const zlo = Math.min(z0, z1), zhi = Math.max(z0, z1);
        const k0 = Math.ceil(zlo / Z_STEP), k1 = Math.floor(zhi / Z_STEP);
        for (let k = Math.max(0, k0); k <= Math.min(NZ - 1, k1); k++) {
          const z = k * Z_STEP;
          const t = zhi === zlo ? 0 : (z - z0) / (z1 - z0);
          const w = w0 + (w1 - w0) * t;
          const i = s * NZ + k;
          if (w > this.W[i]) this.W[i] = w;
        }
      }
    }
  }

  stationIndex(x) {
    // xs is descending (front to rear)
    const xs = this.xs;
    if (x >= xs[0]) return [0, 0, 0];
    if (x <= xs[xs.length - 1]) return [xs.length - 1, xs.length - 1, 0];
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] > x) lo = m; else hi = m; }
    return [lo, hi, (xs[lo] - x) / (xs[lo] - xs[hi])];
  }

  widthAt(x, z) {
    const [a, b, t] = this.stationIndex(x);
    const kz = Math.max(0, Math.min(this.NZ - 1.001, z / Z_STEP));
    const k0 = Math.floor(kz), fz = kz - k0;
    const w = (s) => this.W[s * this.NZ + k0] * (1 - fz) + this.W[s * this.NZ + k0 + 1] * fz;
    return w(a) * (1 - t) + w(b) * t;
  }

  /** Height of the top (crown) surface at station x, lateral w. */
  topZ(x, w) {
    const [a, b, t] = this.stationIndex(x);
    const zAt = (s) => {
      const c = this.top[s];
      for (let i = 0; i < c.length - 1; i++) {
        const [w0, z0] = c[i], [w1, z1] = c[i + 1];
        if (w >= w0 && w <= w1) return z0 + (z1 - z0) * (w1 === w0 ? 0 : (w - w0) / (w1 - w0));
      }
      return c[c.length - 1][1];
    };
    return zAt(a) * (1 - t) + zAt(b) * t;
  }

  /** Plan outline at height z near one end: array of [x, w] from the centreline outward. */
  endOutline(end, z, xLimit) {
    const out = [];
    const xs = this.xs;
    if (end === 'front') {
      for (let s = 0; s < xs.length && xs[s] >= xLimit; s++) {
        const w = this.widthAt(xs[s], z);
        if (w > 0.5 || out.length) out.push([xs[s], w]);
      }
    } else {
      for (let s = xs.length - 1; s >= 0 && xs[s] <= xLimit; s--) {
        const w = this.widthAt(xs[s], z);
        if (w > 0.5 || out.length) out.push([xs[s], w]);
      }
    }
    // start at w = 0 on the centreline
    if (out.length && out[0][1] > 0.5) out.unshift([out[0][0] + (end === 'front' ? 1 : -1), 0]);
    // arc length
    let acc = 0;
    for (let i = 0; i < out.length; i++) {
      if (i) acc += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
      out[i].push(acc);
    }
    return out;
  }
}

function sampleArc(outline, u) {
  // outline rows [x, w, arc]
  if (u <= 0) return [outline[0][0], outline[0][1]];
  for (let i = 1; i < outline.length; i++) {
    if (outline[i][2] >= u) {
      const [x0, w0, a0] = outline[i - 1], [x1, w1, a1] = outline[i];
      const t = (u - a0) / Math.max(1e-6, a1 - a0);
      return [x0 + (x1 - x0) * t, w0 + (w1 - w0) * t];
    }
  }
  const l = outline[outline.length - 1];
  return [l[0], l[1]];
}

/**
 * A grid patch lying on the body surface near one end, parametrised by arc
 * length u (mm, measured around the plan outline from the centreline) and
 * height z. Returns geometry in metres (car origin offset applied), both sides.
 * uv: (u - u0)/(u1 - u0), (z - z0)/(z1 - z0).
 */
export function endPatch(field, { end, u0, u1, z0, z1, nu = 40, nz = 16, offset = 0, offsetX = 0, xLimit, mirror = true }) {
  const lim = xLimit ?? (end === 'front' ? 200 : -3000);
  const outlines = [];
  for (let j = 0; j <= nz; j++) outlines.push(field.endOutline(end, z0 + (z1 - z0) * (j / nz), lim));
  const pos = [], uv = [], idx = [];
  const sides = mirror ? [1, -1] : [1];
  for (const side of sides) {
    const base = pos.length / 3;
    const pts = [];
    for (let j = 0; j <= nz; j++) {
      const z = z0 + (z1 - z0) * (j / nz);
      for (let i = 0; i <= nu; i++) {
        const u = u0 + (u1 - u0) * (i / nu);
        const [x, w] = sampleArc(outlines[j], u);
        pts.push([x, w, z]);
      }
    }
    // offset along the local surface normal
    const P = (i, j) => pts[j * (nu + 1) + i];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nu; i++) {
      const p = P(i, j);
      const pu = P(Math.min(nu, i + 1), j), pm = P(Math.max(0, i - 1), j);
      const pz = P(i, Math.min(nz, j + 1)), pzm = P(i, Math.max(0, j - 1));
      const du = [pu[0] - pm[0], pu[1] - pm[1], pu[2] - pm[2]];
      const dz = [pz[0] - pzm[0], pz[1] - pzm[1], pz[2] - pzm[2]];
      // normal = du x dz (orientation fixed below)
      let n = [du[1] * dz[2] - du[2] * dz[1], du[2] * dz[0] - du[0] * dz[2], du[0] * dz[1] - du[1] * dz[0]];
      const l = Math.hypot(...n) || 1; n = n.map((v) => v / l);
      // make it point outward: away from the car centre (towards the end / outside)
      const outward = [end === 'front' ? 1 : -1, 0.6, 0];
      if (n[0] * outward[0] + n[1] * outward[1] < 0) n = n.map((v) => -v);
      const x = p[0] + n[0] * offset, w = p[1] + n[1] * offset, z = p[2] + n[2] * offset;
      pos.push((x + offsetX) / 1000, z / 1000, side * w / 1000);
      uv.push(i / nu, j / nz);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, c = a + (nu + 1), d = c + 1;
      const frontFacing = (end === 'front') === (side > 0);
      if (frontFacing) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Patch on the car's side, parametrised by x and z (for side lamps, badges).
 */
export function sidePatch(field, { x0, x1, z0, z1, nx = 30, nz = 10, offset = 0, offsetX = 0, mirror = true }) {
  const pos = [], uv = [], idx = [];
  for (const side of mirror ? [1, -1] : [1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + (x1 - x0) * (i / nx), z = z0 + (z1 - z0) * (j / nz);
      const w = field.widthAt(x, z) + offset;
      pos.push((x + offsetX) / 1000, z / 1000, side * w / 1000);
      uv.push(i / nx, j / nz);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = base + j * (nx + 1) + i, b = a + 1, c = a + (nx + 1), d = c + 1;
      if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Patch on the top surface over an (x, w) rectangle (badges, cowl, trims). */
export function topPatch(field, { x0, x1, w0, w1, nx = 20, nw = 20, offset = 0, offsetX = 0, mirror = false }) {
  const pos = [], uv = [], idx = [];
  for (const side of mirror ? [1, -1] : [1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= nw; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + (x1 - x0) * (i / nx), w = w0 + (w1 - w0) * (j / nw);
      const z = field.topZ(x, Math.abs(w)) + offset;
      pos.push((x + offsetX) / 1000, z / 1000, side * w / 1000);
      uv.push(i / nx, j / nw);
    }
    for (let j = 0; j < nw; j++) for (let i = 0; i < nx; i++) {
      const a = base + j * (nx + 1) + i, b = a + 1, c = a + (nx + 1), d = c + 1;
      if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
