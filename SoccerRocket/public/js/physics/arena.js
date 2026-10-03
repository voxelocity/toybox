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
//
// The simulated world matches RocketSim's SOCCAR setup: arena triangles plus
// infinite planes for the floor (z=0), the ceiling (z=2048) and the side walls
// (x=+-4096) (Arena.cpp _SetupArenaCollisionShapes; the planes live in
// contacts.js). The flat floor / goal floor and the flat side-wall triangles
// are therefore left out of the triangle mesh, exactly as
// tools/rocketsim/export-cmf.mjs does for the RocketSim oracle, so both engines
// collide with identical geometry. Our ceiling triangles (z=2044) stay, in
// front of the 2048 plane.
//
// Per-triangle internal-edge info (btGenerateInternalEdgeInfo, Bullet, zlib)
// lets contacts.js correct contact normals at shared edges like RocketSim.
// ---------------------------------------------------------------------------
const EDGE_EPS = 0.01;
/** Triangle filter shared with export-cmf.mjs: true = covered by a plane. */
export function isPlaneCoveredTriangle(tag, v) {
  if (tag === 'floor' || tag === 'goalfloor') return true;
  for (let sx = -1; sx <= 1; sx += 2) {
    if (Math.abs(v[0] - sx * X) < EDGE_EPS && Math.abs(v[3] - sx * X) < EDGE_EPS && Math.abs(v[6] - sx * X) < EDGE_EPS) return true;
  }
  return Math.abs(v[2]) < EDGE_EPS && Math.abs(v[5]) < EDGE_EPS && Math.abs(v[8]) < EDGE_EPS;
}

// btTriangleInfo flags (edge slots 0 = V0V1, 1 = V1V2, 2 = V2V0)
export const TRI_V0V1_CONVEX = 1, TRI_V1V2_CONVEX = 2, TRI_V2V0_CONVEX = 4;
export const TRI_V0V1_SWAP = 8, TRI_V1V2_SWAP = 16, TRI_V2V0_SWAP = 32;
export const NO_EDGE = 2 * Math.PI; // angle of an edge without a neighbour

export class CollisionMesh {
  /**
   * surfaces: buildArenaSurfaces() output. opts.filter(tag, v9) -> true drops
   * a triangle (default: keep all).
   */
  constructor(surfaces, cell = 256, opts = {}) {
    const filter = opts.filter || null;
    const list = [];
    const v9 = new Float64Array(9);
    // Vertices are welded (first occurrence wins, 0.001 uu key) exactly like
    // export-cmf.mjs, so this mesh and RocketSim's copy are the same numbers.
    const weld = new Map(), vid = [];
    for (const s of surfaces) {
      const p = s.positions, id = s.indices;
      for (let i = 0; i < id.length; i += 3) {
        for (let k = 0; k < 3; k++) { const v = id[i + k]; v9[k * 3] = p[v * 3]; v9[k * 3 + 1] = p[v * 3 + 1]; v9[k * 3 + 2] = p[v * 3 + 2]; }
        if (filter && filter(s.tag, v9)) continue;
        for (let k = 0; k < 3; k++) {
          const key = `${Math.round(v9[k * 3] * 1000)},${Math.round(v9[k * 3 + 1] * 1000)},${Math.round(v9[k * 3 + 2] * 1000)}`;
          let w = weld.get(key);
          if (!w) { w = { id: weld.size, x: v9[k * 3], y: v9[k * 3 + 1], z: v9[k * 3 + 2] }; weld.set(key, w); }
          list.push(w.x, w.y, w.z);
          vid.push(w.id);
        }
      }
    }
    this.triVerts = Int32Array.from(vid); // welded vertex ids, 3 per triangle
    const nt = list.length / 9;
    const T = new Float64Array(list), N = new Float64Array(nt * 3), B = new Float64Array(nt * 6);
    for (let t = 0; t < nt; t++) {
      const o = t * 9;
      const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
      const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const l = Math.hypot(nx, ny, nz) || 1;
      N[t * 3] = nx / l; N[t * 3 + 1] = ny / l; N[t * 3 + 2] = nz / l;
      for (let a = 0; a < 3; a++) {
        B[t * 6 + a] = Math.min(T[o + a], T[o + 3 + a], T[o + 6 + a]);
        B[t * 6 + 3 + a] = Math.max(T[o + a], T[o + 3 + a], T[o + 6 + a]);
      }
    }
    this.tris = T; this.norms = N; this.boxes = B; this.count = nt;
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
      const [ix0, iy0, iz0] = this._cellOf(B[i * 6] - eps, B[i * 6 + 1] - eps, B[i * 6 + 2] - eps);
      const [ix1, iy1, iz1] = this._cellOf(B[i * 6 + 3] + eps, B[i * 6 + 4] + eps, B[i * 6 + 5] + eps);
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
    this.hits = new Int32Array(4096);
    this._rayBox = new Float64Array(6);
    this._buildEdgeInfo();
    this._buildBvhOrder();
  }

  /**
   * The order in which RocketSim's btBvhTriangleMeshShape (quantized BVH,
   * btQuantizedBvh::buildTree + walkStacklessQuantizedTreeCacheFriendly)
   * reports overlapping triangles. Contacts are added to a <= 4 point manifold
   * in that order and the replacement rule depends on it, so the narrowphase
   * visits candidates by triRank. Built in Bullet units with float32 maths
   * to reproduce the tree exactly.
   */
  _buildBvhOrder() {
    const nt = this.count, T = this.tris, f = Math.fround;
    const V = new Float32Array(nt * 9);
    for (let i = 0; i < nt * 9; i++) V[i] = T[i] * (1 / 50); // export-cmf: float32(uu * UU_TO_BT)
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < nt * 3; i++) for (let a = 0; a < 3; a++) { const v = V[i * 3 + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
    // setQuantizationValues(min, max, margin 1)
    const bmin = mn.map((v) => f(v - 1)), bmax = mx.map((v) => f(v + 1));
    let Q = [0, 1, 2].map((a) => f(65533 / f(bmax[a] - bmin[a])));
    const quant = (p, isMax, out) => {
      for (let a = 0; a < 3; a++) {
        const v = f(f(p[a] - bmin[a]) * Q[a]);
        out[a] = isMax ? ((Math.trunc(f(v + 1)) & 0xffff) | 1) : (Math.trunc(v) & 0xfffe);
      }
      return out;
    };
    const unq = (q, a) => f(f(q / Q[a]) + bmin[a]);
    const qv = [0, 0, 0];
    quant(bmin, false, qv);
    for (let a = 0; a < 3; a++) bmin[a] = Math.min(bmin[a], f(unq(qv[a], a) - 1));
    Q = [0, 1, 2].map((a) => f(65533 / f(bmax[a] - bmin[a])));
    quant(bmax, true, qv);
    for (let a = 0; a < 3; a++) bmax[a] = Math.max(bmax[a], f(unq(qv[a], a) + 1));
    Q = [0, 1, 2].map((a) => f(65533 / f(bmax[a] - bmin[a])));
    // leaf nodes (QuantizedNodeTriangleCallback)
    const qmin = new Int32Array(nt * 3), qmax = new Int32Array(nt * 3), tri = new Int32Array(nt);
    const lo = [0, 0, 0], hi = [0, 0, 0], q = [0, 0, 0];
    for (let t = 0; t < nt; t++) {
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(V[t * 9 + a], V[t * 9 + 3 + a], V[t * 9 + 6 + a]);
        hi[a] = Math.max(V[t * 9 + a], V[t * 9 + 3 + a], V[t * 9 + 6 + a]);
        if (f(hi[a] - lo[a]) < f(0.002)) { hi[a] = f(hi[a] + f(0.001)); lo[a] = f(lo[a] - f(0.001)); }
      }
      quant(lo, false, q); qmin[t * 3] = q[0]; qmin[t * 3 + 1] = q[1]; qmin[t * 3 + 2] = q[2];
      quant(hi, true, q); qmax[t * 3] = q[0]; qmax[t * 3 + 1] = q[1]; qmax[t * 3 + 2] = q[2];
      tri[t] = t;
    }
    const center = (i, a) => f(f(0.5) * f(unq(qmax[i * 3 + a], a) + unq(qmin[i * 3 + a], a)));
    const swap = (i, j) => {
      for (let a = 0; a < 3; a++) {
        let x = qmin[i * 3 + a]; qmin[i * 3 + a] = qmin[j * 3 + a]; qmin[j * 3 + a] = x;
        x = qmax[i * 3 + a]; qmax[i * 3 + a] = qmax[j * 3 + a]; qmax[j * 3 + a] = x;
      }
      const x = tri[i]; tri[i] = tri[j]; tri[j] = x;
    };
    const means = (s, e) => {
      const m = [0, 0, 0];
      for (let i = s; i < e; i++) for (let a = 0; a < 3; a++) m[a] = f(m[a] + center(i, a));
      const k = f(1 / (e - s));
      for (let a = 0; a < 3; a++) m[a] = f(m[a] * k);
      return m;
    };
    const nodeLeaf = new Int32Array(2 * nt).fill(-1), nodeEscape = new Int32Array(2 * nt);
    const headers = [];
    let cur = 0;
    const MAX_NODES = 2048 / 16; // MAX_SUBTREE_SIZE_IN_BYTES / sizeof(btQuantizedBvhNode)
    const sizeOf = (n) => (nodeLeaf[n] >= 0 ? 1 : nodeEscape[n]);
    const build = (s, e) => {
      const num = e - s, curIndex = cur;
      if (num === 1) { nodeLeaf[cur] = tri[s]; cur++; return; }
      // calcSplittingAxis (variance of AABB centres)
      const m = means(s, e), vr = [0, 0, 0];
      for (let i = s; i < e; i++) for (let a = 0; a < 3; a++) { const d = f(center(i, a) - m[a]); vr[a] = f(vr[a] + f(d * d)); }
      const kv = f(1 / f(num - 1));
      for (let a = 0; a < 3; a++) vr[a] = f(vr[a] * kv);
      const axis = vr[0] < vr[1] ? (vr[1] < vr[2] ? 2 : 1) : (vr[0] < vr[2] ? 2 : 0);
      // sortAndCalcSplittingIndex
      const sv = means(s, e)[axis];
      let split = s;
      for (let i = s; i < e; i++) if (center(i, axis) > sv) { swap(i, split); split++; }
      const bal = (num / 3) | 0;
      if (split <= s + bal || split >= e - 1 - bal) split = s + (num >> 1);
      const node = cur; cur++;
      const left = cur; build(s, split);
      const right = cur; build(split, e);
      const esc = cur - curIndex;
      if (esc > MAX_NODES) { // updateSubtreeHeaders
        if (sizeOf(left) <= MAX_NODES) headers.push([left, sizeOf(left)]);
        if (sizeOf(right) <= MAX_NODES) headers.push([right, sizeOf(right)]);
      }
      nodeEscape[node] = esc;
    };
    build(0, nt);
    if (!headers.length) headers.push([0, sizeOf(0)]);
    const rank = new Int32Array(nt);
    let r = 0;
    for (const [root, size] of headers) for (let n = root; n < root + size; n++) if (nodeLeaf[n] >= 0) rank[nodeLeaf[n]] = r++;
    this.triRank = rank;
  }

  /**
   * btGenerateInternalEdgeInfo / btConnectivityProcessor: for every edge shared
   * with another triangle store the corrected angle and the convexity flags.
   * edgeAngle[t * 3 + slot], slot 0 = V0V1, 1 = V1V2, 2 = V2V0; NO_EDGE if unshared.
   */
  _buildEdgeInfo() {
    const nt = this.count, T = this.tris;
    const angle = new Float64Array(nt * 3).fill(NO_EDGE), flags = new Uint8Array(nt);
    const tv = this.triVerts; // welded vertex ids (Bullet compares positions, 1e-4 bt)
    const byVert = new Map();
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const id = tv[t * 3 + k];
      let l = byVert.get(id);
      if (!l) byVert.set(id, l = []);
      if (l[l.length - 1] !== t) l.push(t);
    }
    const P = (t, k) => [T[t * 9 + k * 3], T[t * 9 + k * 3 + 1], T[t * 9 + k * 3 + 2]];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
    const triNormal = (p0, p1, p2) => norm(cross(sub(p1, p0), sub(p2, p0)));
    for (let ta = 0; ta < nt; ta++) {
      const A = [P(ta, 0), P(ta, 1), P(ta, 2)];
      const cand = new Set();
      for (let k = 0; k < 3; k++) for (const t of byVert.get(tv[ta * 3 + k])) if (t !== ta) cand.add(t);
      for (const tb of [...cand].sort((a, b) => a - b)) {
        const Bv = [P(tb, 0), P(tb, 1), P(tb, 2)];
        const sA = [], sB = [];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (tv[ta * 3 + i] === tv[tb * 3 + j]) { sA.push(i); sB.push(j); }
        if (sA.length !== 2) continue;
        if (sA[0] === 0 && sA[1] === 2) { sA[0] = 2; sA[1] = 0; const tmp = sB[1]; sB[1] = sB[0]; sB[0] = tmp; }
        const sumA = sA[0] + sA[1], otherA = 3 - sumA, otherB = 3 - (sB[0] + sB[1]);
        const edge = norm(sub(A[sA[1]], A[sA[0]]));
        const nA = triNormal(A[0], A[1], A[2]);
        const nB = triNormal(Bv[sB[1]], Bv[sB[0]], Bv[otherB]);
        let ecA = norm(cross(edge, nA));
        if (dot(ecA, sub(A[otherA], A[sA[0]])) < 0) ecA = [-ecA[0], -ecA[1], -ecA[2]];
        let ecB = norm(cross(edge, nB));
        if (dot(ecB, sub(Bv[otherB], Bv[sB[0]])) < 0) ecB = [-ecB[0], -ecB[1], -ecB[2]];
        const calc = cross(ecA, ecB);
        let corrected = 0, convex = false;
        if (dot(calc, calc) >= 0.0001) { // m_planarEpsilon
          const calcNA = norm(cross(norm(calc), ecA));
          const angle2 = Math.atan2(dot(ecB, calcNA), dot(ecB, ecA));
          convex = dot(nA, ecB) < 0;
          corrected = convex ? Math.PI - angle2 : -(Math.PI - angle2);
        }
        // edge slot and rotation axis as in the switch on sumvertsA
        const slot = sumA === 1 ? 0 : sumA === 3 ? 1 : 2;
        const ax = slot === 0 ? sub(A[0], A[1]) : slot === 1 ? sub(A[1], A[2]) : sub(A[2], A[0]);
        if (dot(rotateAxisAngle(ax, -corrected, nA), nB) < 0) flags[ta] |= (8 << slot);
        angle[ta * 3 + slot] = -corrected;
        if (convex) flags[ta] |= (1 << slot);
      }
    }
    this.edgeAngle = angle;
    this.edgeFlags = flags;
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

  /**
   * Collects unique triangles whose grid cells overlap an AABB (box =
   * [x0, y0, z0, x1, y1, z1], a Float64Array so no double is passed as an
   * argument and boxed) into this.cand and returns the count. Allocation-free;
   * exact tests are up to the caller.
   */
  gather(box) {
    const c = this.cell, d = this.dims, m = this.min;
    const x0 = box[0], y0 = box[1], z0 = box[2], x1 = box[3], y1 = box[4], z1 = box[5];
    const ix0 = Math.max(0, Math.floor((x0 - m[0]) / c)), ix1 = Math.min(d[0] - 1, Math.floor((x1 - m[0]) / c));
    const iy0 = Math.max(0, Math.floor((y0 - m[1]) / c)), iy1 = Math.min(d[1] - 1, Math.floor((y1 - m[1]) / c));
    const iz0 = Math.max(0, Math.floor((z0 - m[2]) / c)), iz1 = Math.min(d[2] - 1, Math.floor((z1 - m[2]) / c));
    if (++this.stampId > 0x3fffffff) { this.stampId = 1; this.stamp.fill(0); }
    const id = this.stampId;
    let n = 0;
    for (let iz = iz0; iz <= iz1; iz++) for (let iy = iy0; iy <= iy1; iy++) {
      const base = (iz * d[1] + iy) * d[0];
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
   * Triangles whose AABB overlaps box ([x0, y0, z0, x1, y1, z1]), in
   * RocketSim's BVH report order (triRank), into this.hits. Returns the count.
   * Allocation-free.
   */
  overlapping(box) {
    const n = this.gather(box), cand = this.cand, rank = this.triRank, B = this.boxes;
    if (this.hits.length < n) this.hits = new Int32Array(this.cand.length);
    const out = this.hits;
    const x0 = box[0], y0 = box[1], z0 = box[2], x1 = box[3], y1 = box[4], z1 = box[5];
    let m = 0;
    for (let k = 0; k < n; k++) {
      const t = cand[k], o = t * 6;
      // TestTriangleAgainstAabb2
      if (B[o] > x1 || B[o + 3] < x0 || B[o + 1] > y1 || B[o + 4] < y0 || B[o + 2] > z1 || B[o + 5] < z0) continue;
      // insertion sort by rank (few candidates)
      const r = rank[t];
      let j = m++;
      while (j > 0 && rank[out[j - 1]] > r) { out[j] = out[j - 1]; j--; }
      out[j] = t;
    }
    return m;
  }

  /**
   * Ray cast against the triangles. ray = { ox, oy, oz, dx, dy, dz, len }
   * (dir unit length). Like Bullet's btTriangleRaycastCallback without
   * kF_FilterBackfaces, both sides are hit and the normal faces the ray origin
   * (twoSided = false skips back faces). hit = { t, nx, ny, nz, tri }.
   */
  raycast(ray, hit, twoSided = true) {
    const ox = ray.ox, oy = ray.oy, oz = ray.oz, dx = ray.dx, dy = ray.dy, dz = ray.dz, maxT = ray.len;
    const ex = ox + dx * maxT, ey = oy + dy * maxT, ez = oz + dz * maxT;
    const box = this._rayBox;
    box[0] = Math.min(ox, ex) - 1; box[1] = Math.min(oy, ey) - 1; box[2] = Math.min(oz, ez) - 1;
    box[3] = Math.max(ox, ex) + 1; box[4] = Math.max(oy, ey) + 1; box[5] = Math.max(oz, ez) + 1;
    const n = this.gather(box);
    const T = this.tris, N = this.norms;
    let best = maxT, found = false;
    for (let k = 0; k < n; k++) {
      const t = this.cand[k], o = t * 9;
      const nx = N[t * 3], ny = N[t * 3 + 1], nz = N[t * 3 + 2];
      const dn = dx * nx + dy * ny + dz * nz;
      if (dn >= -1e-9 && (!twoSided || dn <= 1e-9)) continue; // parallel, or back face
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
      if (tt < 0 || tt >= best) continue;
      best = tt; found = true;
      const s = dn < 0 ? 1 : -1;
      hit.nx = nx * s; hit.ny = ny * s; hit.nz = nz * s; hit.tri = t;
    }
    if (found) hit.t = best;
    return found;
  }
}

// Rotation of v about axis (any length) by angle a (btQuaternion(axis, a) + quatRotate).
function rotateAxisAngle(axis, a, v) {
  const l = Math.hypot(axis[0], axis[1], axis[2]);
  const ux = axis[0] / l, uy = axis[1] / l, uz = axis[2] / l;
  const c = Math.cos(a), s = Math.sin(a), d = ux * v[0] + uy * v[1] + uz * v[2];
  return [
    v[0] * c + (uy * v[2] - uz * v[1]) * s + ux * d * (1 - c),
    v[1] * c + (uz * v[0] - ux * v[2]) * s + uy * d * (1 - c),
    v[2] * c + (ux * v[1] - uy * v[0]) * s + uz * d * (1 - c),
  ];
}

let _shared = null;
/** The simulation's arena: triangles not covered by RocketSim's planes. */
export function getCollisionMesh() {
  if (!_shared) {
    _shared = new CollisionMesh(buildArenaSurfaces({ filletSteps: 16, arcSteps: 6, maxSeg: 1024 }), 256, { filter: isPlaneCoveredTriangle });
  }
  return _shared;
}
