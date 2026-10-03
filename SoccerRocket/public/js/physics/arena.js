// Arena geometry. One parametric description produces both the collision
// mesh used by the simulation and the render meshes, so what you see is
// exactly what the ball and cars collide with.
//
// Shape: an octagonal prism (rectangle with 45-degree bevelled corners) whose
// edges are rounded with radius R (floor/wall ramps, ceiling curves and the
// vertical corner rounds), plus a rectangular goal tunnel cut into each back
// wall.
import { ARENA } from './constants.js';

const { X, Y, Z, CORNER, R, GOAL_HALF_W: GW, GOAL_H: GH, GOAL_DEPTH: GD } = ARENA;

// Shrunken octagon (the rounded arena is this octagon grown by R).
const A = X - R, B = Y - R, C = CORNER - R * Math.SQRT2;
export const OCTAGON = [
  [A, -(C - A)], [A, C - A], [C - B, B], [-(C - B), B],
  [-A, C - A], [-A, -(C - A)], [-(C - B), -B], [C - B, -B],
];
const EDGE_NORMALS = [
  [1, 0], [Math.SQRT1_2, Math.SQRT1_2], [0, 1], [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0], [-Math.SQRT1_2, -Math.SQRT1_2], [0, -1], [Math.SQRT1_2, -Math.SQRT1_2],
];

// A mesh builder that keeps every triangle facing the arena interior.
class SurfaceBuilder {
  constructor(tag) { this.tag = tag; this.pos = []; this.nrm = []; this.uv = []; this.idx = []; }
  vert(x, y, z, nx, ny, nz, u = 0, v = 0) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }
  // Adds triangle (a, b, c), flipping winding so it faces along nrm of a.
  tri(a, b, c) {
    const p = this.pos, n = this.nrm;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
    const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    if (cx * cx + cy * cy + cz * cz < 1e-8) return; // degenerate (collapsed corner ring)
    const nx = n[a * 3] + n[b * 3] + n[c * 3], ny = n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1], nz = n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2];
    if (cx * nx + cy * ny + cz * nz >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  build() {
    return {
      tag: this.tag,
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      uvs: new Float32Array(this.uv),
      indices: this.idx.length > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
    };
  }
}

// Stations walk the shrunken octagon: base point P, outward 2D normal N, and
// the running arc length along the outer wall line (for texture u).
function makeStations(maxSeg, arcSteps) {
  const st = [];
  let u = 0, last = null;
  const push = (px, py, nx, ny) => {
    const wx = px + nx * R, wy = py + ny * R;
    if (last) u += Math.hypot(wx - last[0], wy - last[1]);
    last = [wx, wy];
    st.push({ px, py, nx, ny, u });
  };
  for (let i = 0; i < 8; i++) {
    const [x0, y0] = OCTAGON[i], [x1, y1] = OCTAGON[(i + 1) % 8];
    const [nx, ny] = EDGE_NORMALS[i];
    // breakpoints along the edge (goal posts on back walls)
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ts = new Set([0, 1]);
    const n = Math.max(1, Math.ceil(len / maxSeg));
    for (let k = 1; k < n; k++) ts.add(k / n);
    if (i === 2 || i === 6) {
      for (const gx of [-GW, GW]) ts.add((gx - x0) / (x1 - x0));
    }
    const sorted = [...ts].sort((a, b) => a - b);
    for (const t of sorted) push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, nx, ny);
    // corner arc at the end vertex, rotating N by +45 degrees
    const a0 = Math.atan2(ny, nx);
    for (let k = 1; k < arcSteps; k++) {
      const a = a0 + (Math.PI / 4) * (k / arcSteps);
      push(x1, y1, Math.cos(a), Math.sin(a));
    }
  }
  // close loop
  const f = st[0];
  push(f.px, f.py, f.nx, f.ny);
  return st;
}

function inGoalMouth(s0, s1) {
  // Both stations on a back wall and between the posts.
  return Math.abs(s0.ny) > 0.999 && Math.abs(s1.ny) > 0.999 &&
    Math.abs(s0.px) <= GW + 1e-6 && Math.abs(s1.px) <= GW + 1e-6;
}

/**
 * Builds the arena surfaces.
 * opts: { filletSteps, arcSteps, maxSeg, wallSteps }
 * Returns an array of surfaces: { tag, positions, normals, uvs, indices } in uu.
 * Tags: floor, ramp, wall, ceilramp, ceiling, goal (tunnel faces), goalfloor.
 */
export function buildArenaSurfaces(opts = {}) {
  const filletSteps = opts.filletSteps ?? 16;
  const arcSteps = opts.arcSteps ?? 6;
  const maxSeg = opts.maxSeg ?? 1024;
  const wallSteps = opts.wallSteps ?? 1;
  const st = makeStations(maxSeg, arcSteps);

  // Profile rings: [kind, theta or z]
  const ramp = [], wall = [], ceil = [];
  for (let k = 0; k <= filletSteps; k++) ramp.push(-Math.PI / 2 + (Math.PI / 2) * k / filletSteps);
  const wz = new Set([R, GH, Z - R]);
  for (let k = 1; k < wallSteps; k++) wz.add(R + (Z - 2 * R) * k / wallSteps);
  for (const z of [...wz].sort((a, b) => a - b)) wall.push(z);
  for (let k = 0; k <= filletSteps; k++) ceil.push((Math.PI / 2) * k / filletSteps);

  const ringPoint = (s, kind, p) => {
    if (kind === 'ramp') {
      const c = Math.cos(p), sn = Math.sin(p);
      return [s.px + s.nx * R * c, s.py + s.ny * R * c, R + R * sn, -s.nx * c, -s.ny * c, -sn, R * (p + Math.PI / 2)];
    }
    if (kind === 'wall') return [s.px + s.nx * R, s.py + s.ny * R, p, -s.nx, -s.ny, 0, p];
    const c = Math.cos(p), sn = Math.sin(p);
    return [s.px + s.nx * R * c, s.py + s.ny * R * c, Z - R + R * sn, -s.nx * c, -s.ny * c, -sn, R * p];
  };

  const sheet = (tag, kind, rings, skip) => {
    const b = new SurfaceBuilder(tag);
    const grid = st.map((s) => rings.map((p) => {
      const [x, y, z, nx, ny, nz, v] = ringPoint(s, kind, p);
      return b.vert(x, y, z, nx, ny, nz, s.u, v);
    }));
    for (let i = 0; i < st.length - 1; i++) {
      for (let j = 0; j < rings.length - 1; j++) {
        if (skip && skip(st[i], st[i + 1], rings[j], rings[j + 1])) continue;
        b.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
      }
    }
    return b.build();
  };

  const surfaces = [];
  surfaces.push(sheet('ramp', 'ramp', ramp, (s0, s1) => inGoalMouth(s0, s1)));
  surfaces.push(sheet('wall', 'wall', wall, (s0, s1, z0, z1) => inGoalMouth(s0, s1) && z1 <= GH + 1e-6));
  surfaces.push(sheet('ceilramp', 'ceil', ceil));

  // Floor and ceiling: the shrunken octagon, fan triangulated, plus the strip
  // in front of each goal where the ramp is cut away.
  const flat = (tag, z, nz) => {
    const b = new SurfaceBuilder(tag);
    const c = b.vert(0, 0, z, 0, 0, nz, 0, 0);
    const vs = OCTAGON.map(([x, y]) => b.vert(x, y, z, 0, 0, nz, x, y));
    for (let i = 0; i < 8; i++) b.tri(c, vs[i], vs[(i + 1) % 8]);
    if (tag === 'floor') {
      for (const sy of [-1, 1]) {
        const a = b.vert(-GW, sy * B, 0, 0, 0, 1), d = b.vert(GW, sy * B, 0, 0, 0, 1);
        const e = b.vert(GW, sy * Y, 0, 0, 0, 1), f = b.vert(-GW, sy * Y, 0, 0, 0, 1);
        b.quad(a, d, e, f);
      }
    }
    return b.build();
  };
  surfaces.push(flat('floor', 0, 1));
  surfaces.push(flat('ceiling', Z, -1));

  // Goal tunnels.
  const goalFloor = new SurfaceBuilder('goalfloor');
  const goal = new SurfaceBuilder('goal');
  for (const sy of [-1, 1]) {
    const yb = sy * Y, yk = sy * (Y + GD);
    // floor inside the goal
    goalFloor.quad(
      goalFloor.vert(-GW, yb, 0, 0, 0, 1, -GW, yb), goalFloor.vert(GW, yb, 0, 0, 0, 1, GW, yb),
      goalFloor.vert(GW, yk, 0, 0, 0, 1, GW, yk), goalFloor.vert(-GW, yk, 0, 0, 0, 1, -GW, yk));
    // side walls
    for (const sx of [-1, 1]) {
      const x = sx * GW, nx = -sx;
      goal.quad(
        goal.vert(x, yb, 0, nx, 0, 0, 0, 0), goal.vert(x, yk, 0, nx, 0, 0, GD, 0),
        goal.vert(x, yk, GH, nx, 0, 0, GD, GH), goal.vert(x, yb, GH, nx, 0, 0, 0, GH));
      // end caps under the cut ramp, between floor and the ramp arc
      const base = goal.vert(x, yb, 0, nx, 0, 0, 0, 0);
      let prev = null;
      for (let k = 0; k <= filletSteps; k++) {
        const th = -Math.PI / 2 + (Math.PI / 2) * k / filletSteps;
        const y = sy * (B + R * Math.cos(th)), z = R + R * Math.sin(th);
        const v = goal.vert(x, y, z, nx, 0, 0, 0, z);
        if (prev !== null) goal.tri(base, prev, v);
        prev = v;
      }
    }
    // back of the net
    goal.quad(
      goal.vert(-GW, yk, 0, 0, -sy, 0, -GW, 0), goal.vert(GW, yk, 0, 0, -sy, 0, GW, 0),
      goal.vert(GW, yk, GH, 0, -sy, 0, GW, GH), goal.vert(-GW, yk, GH, 0, -sy, 0, -GW, GH));
    // goal roof
    goal.quad(
      goal.vert(-GW, yb, GH, 0, 0, -1, -GW, 0), goal.vert(GW, yb, GH, 0, 0, -1, GW, 0),
      goal.vert(GW, yk, GH, 0, 0, -1, GW, GD), goal.vert(-GW, yk, GH, 0, 0, -1, -GW, GD));
  }
  surfaces.push(goalFloor.build());
  surfaces.push(goal.build());
  return surfaces;
}

// ---------------------------------------------------------------------------
// Collision mesh with a uniform grid broadphase.
// ---------------------------------------------------------------------------
export class CollisionMesh {
  constructor(surfaces, cell = 256) {
    let nt = 0;
    for (const s of surfaces) nt += s.indices.length / 3;
    const T = new Float64Array(nt * 9), N = new Float64Array(nt * 3);
    let t = 0;
    for (const s of surfaces) {
      const p = s.positions, id = s.indices;
      for (let i = 0; i < id.length; i += 3, t++) {
        for (let k = 0; k < 3; k++) {
          const v = id[i + k];
          T[t * 9 + k * 3] = p[v * 3]; T[t * 9 + k * 3 + 1] = p[v * 3 + 1]; T[t * 9 + k * 3 + 2] = p[v * 3 + 2];
        }
        const o = t * 9;
        const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
        const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
        let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        const l = Math.hypot(nx, ny, nz) || 1;
        N[t * 3] = nx / l; N[t * 3 + 1] = ny / l; N[t * 3 + 2] = nz / l;
      }
    }
    this.tris = T; this.norms = N; this.count = nt;
    this.cell = cell;
    this.min = [-X - cell, -(Y + GD) - cell, -cell];
    this.dims = [
      Math.ceil((2 * X + 2 * cell) / cell) + 1,
      Math.ceil((2 * (Y + GD) + 2 * cell) / cell) + 1,
      Math.ceil((Z + 2 * cell) / cell) + 1,
    ];
    const ncell = this.dims[0] * this.dims[1] * this.dims[2];
    const lists = new Array(ncell);
    const eps = 2;
    for (let i = 0; i < nt; i++) {
      const o = i * 9;
      const x0 = Math.min(T[o], T[o + 3], T[o + 6]) - eps, x1 = Math.max(T[o], T[o + 3], T[o + 6]) + eps;
      const y0 = Math.min(T[o + 1], T[o + 4], T[o + 7]) - eps, y1 = Math.max(T[o + 1], T[o + 4], T[o + 7]) + eps;
      const z0 = Math.min(T[o + 2], T[o + 5], T[o + 8]) - eps, z1 = Math.max(T[o + 2], T[o + 5], T[o + 8]) + eps;
      const [ix0, iy0, iz0] = this._cellOf(x0, y0, z0), [ix1, iy1, iz1] = this._cellOf(x1, y1, z1);
      for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) for (let iz = iz0; iz <= iz1; iz++) {
        if (!this._triBoxOverlap(i, ix, iy, iz)) continue;
        const c = (iz * this.dims[1] + iy) * this.dims[0] + ix;
        (lists[c] || (lists[c] = [])).push(i);
      }
    }
    // pack to CSR
    this.cellStart = new Int32Array(ncell + 1);
    let total = 0;
    for (let c = 0; c < ncell; c++) { this.cellStart[c] = total; total += lists[c] ? lists[c].length : 0; }
    this.cellStart[ncell] = total;
    this.cellTris = new Int32Array(total);
    for (let c = 0; c < ncell; c++) if (lists[c]) this.cellTris.set(lists[c], this.cellStart[c]);
    this.stamp = new Int32Array(nt);
    this.stampId = 0;
    this.cand = new Int32Array(4096);
    this.contacts = [];
    for (let i = 0; i < 32; i++) this.contacts.push({ px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0, depth: 0 });
  }

  _cellOf(x, y, z) {
    const c = this.cell, d = this.dims;
    return [
      Math.min(d[0] - 1, Math.max(0, Math.floor((x - this.min[0]) / c))),
      Math.min(d[1] - 1, Math.max(0, Math.floor((y - this.min[1]) / c))),
      Math.min(d[2] - 1, Math.max(0, Math.floor((z - this.min[2]) / c))),
    ];
  }

  // Conservative triangle/box test: plane vs box plus AABB overlap.
  _triBoxOverlap(i, ix, iy, iz) {
    const c = this.cell, h = c / 2 + 2;
    const cx = this.min[0] + (ix + 0.5) * c, cy = this.min[1] + (iy + 0.5) * c, cz = this.min[2] + (iz + 0.5) * c;
    const T = this.tris, o = i * 9, N = this.norms;
    const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    const d = nx * (T[o] - cx) + ny * (T[o + 1] - cy) + nz * (T[o + 2] - cz);
    const r = h * (Math.abs(nx) + Math.abs(ny) + Math.abs(nz));
    if (Math.abs(d) > r) return false;
    // separating axes from triangle edges crossed with box axes (2D projections)
    const v = [[T[o] - cx, T[o + 1] - cy, T[o + 2] - cz], [T[o + 3] - cx, T[o + 4] - cy, T[o + 5] - cz], [T[o + 6] - cx, T[o + 7] - cy, T[o + 8] - cz]];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
      const axes = [[0, -ez, ey], [ez, 0, -ex], [-ey, ex, 0]];
      for (const [ax, ay, az] of axes) {
        if (ax === 0 && ay === 0 && az === 0) continue;
        let mn = Infinity, mx = -Infinity;
        for (const p of v) { const s = p[0] * ax + p[1] * ay + p[2] * az; if (s < mn) mn = s; if (s > mx) mx = s; }
        const rr = h * (Math.abs(ax) + Math.abs(ay) + Math.abs(az));
        if (mn > rr || mx < -rr) return false;
      }
    }
    return true;
  }

  // Collect unique triangle candidates overlapping an AABB.
  gather(x0, y0, z0, x1, y1, z1) {
    const c = this.cell, d = this.dims, m = this.min;
    const ix0 = Math.max(0, Math.floor((x0 - m[0]) / c)), ix1 = Math.min(d[0] - 1, Math.floor((x1 - m[0]) / c));
    const iy0 = Math.max(0, Math.floor((y0 - m[1]) / c)), iy1 = Math.min(d[1] - 1, Math.floor((y1 - m[1]) / c));
    const iz0 = Math.max(0, Math.floor((z0 - m[2]) / c)), iz1 = Math.min(d[2] - 1, Math.floor((z1 - m[2]) / c));
    const id = ++this.stampId;
    let n = 0;
    for (let iz = iz0; iz <= iz1; iz++) for (let iy = iy0; iy <= iy1; iy++) {
      let base = (iz * d[1] + iy) * d[0];
      for (let ix = ix0; ix <= ix1; ix++) {
        const ci = base + ix;
        for (let k = this.cellStart[ci], e = this.cellStart[ci + 1]; k < e; k++) {
          const t = this.cellTris[k];
          if (this.stamp[t] === id) continue;
          this.stamp[t] = id;
          if (n >= this.cand.length) { const nc = new Int32Array(this.cand.length * 2); nc.set(this.cand); this.cand = nc; }
          this.cand[n++] = t;
        }
      }
    }
    return n;
  }

  /**
   * Sphere vs mesh. Returns number of contacts written to this.contacts (a
   * reduced manifold: near-parallel normals are merged keeping the deepest).
   * Contact: point on surface (px..), normal into the arena (nx..), depth.
   */
  sphere(cx, cy, cz, r, candCount = -1) {
    const n = candCount >= 0 ? candCount : this.gather(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r);
    const T = this.tris, N = this.norms, cand = this.cand;
    let nc = 0;
    const out = this.contacts;
    const r2 = r * r;
    for (let k = 0; k < n; k++) {
      const t = cand[k], o = t * 9;
      const tnx = N[t * 3], tny = N[t * 3 + 1], tnz = N[t * 3 + 2];
      // early plane rejection
      const pd = (cx - T[o]) * tnx + (cy - T[o + 1]) * tny + (cz - T[o + 2]) * tnz;
      if (pd > r || pd < -r * 2) continue;
      closestPtTri(cx, cy, cz, T, o, _cp);
      const dx = cx - _cp[0], dy = cy - _cp[1], dz = cz - _cp[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r2 && pd >= 0) continue;
      let nx, ny, nz, depth;
      if (pd < 0) { // centre behind the surface: push out along face normal
        nx = tnx; ny = tny; nz = tnz; depth = r - pd;
        if (d2 > r2 * 4) continue;
      } else {
        const d = Math.sqrt(d2);
        if (d < 1e-6) { nx = tnx; ny = tny; nz = tnz; } else { nx = dx / d; ny = dy / d; nz = dz / d; }
        depth = r - d;
      }
      // merge with an existing contact of similar normal
      let merged = false;
      for (let j = 0; j < nc; j++) {
        const c = out[j];
        if (c.nx * nx + c.ny * ny + c.nz * nz > 0.985) {
          if (depth > c.depth) { c.px = _cp[0]; c.py = _cp[1]; c.pz = _cp[2]; c.nx = nx; c.ny = ny; c.nz = nz; c.depth = depth; }
          merged = true; break;
        }
      }
      if (merged || nc >= out.length) continue;
      const c = out[nc++];
      c.px = _cp[0]; c.py = _cp[1]; c.pz = _cp[2]; c.nx = nx; c.ny = ny; c.nz = nz; c.depth = depth;
    }
    return nc;
  }

  /** Ray cast against front faces. hit = { t, nx, ny, nz }. Returns bool. */
  raycast(ox, oy, oz, dx, dy, dz, maxT, hit) {
    const ex = ox + dx * maxT, ey = oy + dy * maxT, ez = oz + dz * maxT;
    const n = this.gather(Math.min(ox, ex) - 1, Math.min(oy, ey) - 1, Math.min(oz, ez) - 1, Math.max(ox, ex) + 1, Math.max(oy, ey) + 1, Math.max(oz, ez) + 1);
    const T = this.tris, N = this.norms;
    let best = maxT, found = false;
    for (let k = 0; k < n; k++) {
      const t = this.cand[k], o = t * 9;
      const nx = N[t * 3], ny = N[t * 3 + 1], nz = N[t * 3 + 2];
      const dn = dx * nx + dy * ny + dz * nz;
      if (dn >= -1e-9) continue; // back-face or parallel
      const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
      const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const sx = ox - T[o], sy = oy - T[o + 1], sz = oz - T[o + 2];
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < -1e-6 || u > 1 + 1e-6) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < -1e-6 || u + v > 1 + 1e-6) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt < -1e-3 || tt >= best) continue;
      best = tt; found = true;
      hit.nx = nx; hit.ny = ny; hit.nz = nz;
    }
    if (found) hit.t = Math.max(0, best);
    return found;
  }
}

const _cp = [0, 0, 0];
// Ericson, Real-Time Collision Detection 5.1.5
function closestPtTri(px, py, pz, T, o, out) {
  const ax = T[o], ay = T[o + 1], az = T[o + 2];
  const bx = T[o + 3], by = T[o + 4], bz = T[o + 5];
  const cx = T[o + 6], cy = T[o + 7], cz = T[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v; return;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out[0] = ax + acx * w; out[1] = ay + acy * w; out[2] = az + acz * w; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out[0] = bx + (cx - bx) * w; out[1] = by + (cy - by) * w; out[2] = bz + (cz - bz) * w; return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
}

let _shared = null;
export function getCollisionMesh() {
  if (!_shared) _shared = new CollisionMesh(buildArenaSurfaces({ filletSteps: 16, arcSteps: 6, maxSeg: 1024 }));
  return _shared;
}
