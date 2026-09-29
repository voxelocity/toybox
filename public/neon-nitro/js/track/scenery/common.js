// Shared placement helpers: destructible prop spots, road-carved terrain,
// water planes, ambient particle emitters and decorative scatter.
import * as THREE from 'three';
import { Geo } from '../../geo/builder.js';
import { toonMaterial } from '../../render/toon.js';
import { rgb } from '../build.js';
import { tree } from '../kit.js';

export function propAt(track, type, s, lat, ang = null) {
  const p = track.path.point(s, lat);
  const i = p.i;
  const hw = track.path.w[i] / 2;
  const e = lat < 0 ? track.edges.L[i] : track.edges.R[i];
  const lift = Math.abs(lat) > hw ? e.lift || 0 : 0;
  track.propSpots.push({ type, x: p.px, y: p.py + lift, z: p.pz, ang: ang ?? Math.atan2(-p.tz, p.tx) + Math.PI / 2 });
}

/** Row of props along the track between u0 and u1 at a fixed lateral offset. */
export function propLine(track, type, u0, u1, lat, step = 6) {
  const L = track.path.length;
  for (let s = u0 * L; s <= u1 * L; s += step) propAt(track, type, s, lat);
}

/** Cluster (pyramid/scatter) of props. */
export function propCluster(track, type, u, lat, n = 6, spread = 3, rng = Math.random) {
  const s0 = u * track.path.length;
  for (let k = 0; k < n; k++) propAt(track, type, s0 + (rng() - 0.5) * spread * 2, lat + (rng() - 0.5) * spread * 2, rng() * 6.28);
}

/** Random props along sidewalks. */
export function sidewalkProps(track, rng, types = ['vending', 'trash', 'sign', 'cone'], every = 22) {
  const path = track.path;
  for (let s = 10; s < path.length; s += every * (0.6 + rng() * 0.8)) {
    const i = path.indexAt(s);
    const side = rng() < 0.5 ? -1 : 1;
    const e = side < 0 ? track.edges.L[i] : track.edges.R[i];
    if (e.kind !== 'sidewalk' || track.edges.tunnel[i]) continue;
    const hw = path.w[i] / 2;
    const type = types[Math.floor(rng() * types.length)];
    const lat = side * (hw + (type === 'vending' ? e.width - 1.3 : 1.2 + rng() * (e.width - 2.4)));
    propAt(track, type, s, lat, type === 'vending' ? Math.atan2(-path.tz[i], path.tx[i]) + (side > 0 ? Math.PI / 2 : -Math.PI / 2) : null);
  }
}

/**
 * Terrain heightfield carved around the road. base(x, z) gives the natural height.
 * The surface blends to just below the road near it. Returns a sampler.
 */
export function carvedTerrain(track, o) {
  const path = track.path;
  const N = path.N;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < N; i++) { minX = Math.min(minX, path.px[i]); maxX = Math.max(maxX, path.px[i]); minZ = Math.min(minZ, path.pz[i]); maxZ = Math.max(maxZ, path.pz[i]); }
  const pad = o.pad ?? 260;
  minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
  const res = o.res ?? 8;
  const nx = Math.ceil((maxX - minX) / res), nz = Math.ceil((maxZ - minZ) / res);
  // spatial hash of road samples for nearest queries
  const cell = 24;
  const grid = new Map();
  for (let i = 0; i < N; i += 2) {
    const k = Math.floor(path.px[i] / cell) * 100003 + Math.floor(path.pz[i] / cell);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const near = (x, z) => {
    let best = -1, bd = Infinity;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let r = 0; r <= 5 && (best < 0 || r <= 2); r++) {
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
        const arr = grid.get((cx + a) * 100003 + (cz + b));
        if (!arr) continue;
        for (const i of arr) { const d = (x - path.px[i]) ** 2 + (z - path.pz[i]) ** 2; if (d < bd) { bd = d; best = i; } }
      }
    }
    return { i: best, d: Math.sqrt(bd) };
  };
  const H = new Float32Array((nx + 1) * (nz + 1));
  const road = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = minX + i * res, z = minZ + j * res;
    const b = o.base(x, z);
    const n = near(x, z);
    let h = b;
    if (n.i >= 0) {
      const lim = Math.max(track.limL[n.i], track.limR[n.i]);
      const ry = path.py[n.i] - (o.below ?? 0.4);
      const t = Math.min(1, Math.max(0, (n.d - lim - (o.flat ?? 4)) / (o.blend ?? 40)));
      const e = t * t * (3 - 2 * t);
      h = ry + (b - ry) * e;
      if (o.cliff && n.d > lim && b < ry) h = Math.min(h, ry - (n.d - lim) * o.cliff);
      road[j * (nx + 1) + i] = n.d < lim + 2 ? 1 : 0;
    }
    H[j * (nx + 1) + i] = h;
  }
  const g = new Geo();
  const col = (h, slope, x, z) => {
    const c = o.color ? o.color(h, slope, x, z) : (slope > 0.9 ? rgb('#6f5f73') : rgb('#3f8f4f'));
    return c;
  };
  const P = (i, j) => [minX + i * res, H[j * (nx + 1) + i], minZ + j * res];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    const hy = (a[1] + b[1] + c[1] + d[1]) / 4;
    const slope = (Math.abs(a[1] - c[1]) + Math.abs(b[1] - d[1])) / (res * 2);
    g.set(col(hy, slope, a[0], a[2]), 0, 0);
    g.quad(d, c, b, a);
  }
  const mat = toonMaterial({ vertexColors: true, rim: 0 });
  const m = new THREE.Mesh(g.build({ color: true }), mat);
  m.matrixAutoUpdate = false;
  track.group.add(m);
  const sample = (x, z) => {
    const fi = (x - minX) / res, fj = (z - minZ) / res;
    const i = Math.max(0, Math.min(nx - 1, Math.floor(fi))), j = Math.max(0, Math.min(nz - 1, Math.floor(fj)));
    const u = fi - i, v = fj - j;
    const h00 = H[j * (nx + 1) + i], h10 = H[j * (nx + 1) + i + 1], h01 = H[(j + 1) * (nx + 1) + i], h11 = H[(j + 1) * (nx + 1) + i + 1];
    return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
  };
  return { sample, near, bounds: { minX, maxX, minZ, maxZ }, mesh: m };
}

/** Scatter trees on terrain away from the road. */
export function scatterTrees(track, terr, rng, o) {
  const { minX, maxX, minZ, maxZ } = terr.bounds;
  const g = new Geo();
  let placed = 0;
  const count = Math.round((o.count ?? 500) * (track.detail ?? 1));
  for (let k = 0; k < (o.tries ?? 2500) && placed < count; k++) {
    const x = minX + rng() * (maxX - minX), z = minZ + rng() * (maxZ - minZ);
    const n = terr.near(x, z);
    if (n.i >= 0) {
      const lim = Math.max(track.limL[n.i], track.limR[n.i]);
      if (n.d < lim + (o.clear ?? 4)) continue;
      if (o.maxDist && n.d > o.maxDist) continue;
    }
    const y = terr.sample(x, z);
    if (o.minY != null && y < o.minY) continue;
    const kinds = o.kinds || ['pine'];
    tree(g, x, y - 0.2, z, kinds[Math.floor(rng() * kinds.length)], (o.scale ?? 1.4) * (0.7 + rng() * 0.6), rng);
    placed++;
  }
  const m = new THREE.Mesh(g.build({ color: true, emit: true }), toonMaterial({ vertexColors: true, emitAttr: true, rim: 0.3 }));
  m.matrixAutoUpdate = false;
  track.group.add(m);
  return placed;
}

/** Animated water plane with a toon sheen. */
export function water(track, y, color = '#1b3a6a', size = 5000, center = [0, 0]) {
  const geo = new THREE.PlaneGeometry(size, size, 60, 60).rotateX(-Math.PI / 2);
  const mat = toonMaterial({ color, spec: 1, shine: 60, rim: 0.4, wave: true });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(center[0], y, center[1]);
  track.group.add(m);
  return m;
}

/** Ambient particles around the camera (petals, rain, embers). */
export function ambient(track, o) {
  track.ambient = o;
}

export { rgb };
