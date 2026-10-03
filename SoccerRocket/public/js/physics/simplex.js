// Ray casts against convex shapes the way Bullet does them for RocketSim's
// wheel rays: btCollisionWorld::rayTestSingleInternal casts a point with
// btSubsimplexConvexCast (conservative advancement driven by
// btVoronoiSimplexSolver), which stops as soon as the ray point is within
// sqrt(MAX_CONVEX_CAST_EPSILON) = 0.01 bt (0.5 uu) of the shape, so a wheel
// meets the ball up to ~0.25 uu early; a ray that starts inside reports no hit.
//
// Ported from Bullet Physics (zlib, Copyright (c) 2003-2006 Erwin Coumans;
// btVoronoiSimplexSolver contains code from Christer Ericson's Real-Time
// Collision Detection, (c) 2005 Elsevier Inc.) as built into RocketSim (MIT,
// Copyright (c) 2022 ZealanL): float build, so MAX_CONVEX_CAST_ITERATIONS 32,
// MAX_CONVEX_CAST_EPSILON 1e-4 and VORONOI_DEFAULT_EQUAL_VERTEX_THRESHOLD
// 1e-4. Those are in Bullet units (1 bt = 50 uu); this file works in uu, so
// squared lengths scale by 2500.
//
// Allocation-free: all vectors live in Float64Arrays; doubles never cross a
// function boundary as arguments or return values.
const BT2 = 2500;
const SIMD_EPSILON = 1.1920929e-7;
const CAST_MAX_ITER = 32;
const CAST_EPS2 = 0.0001 * BT2;              // MAX_CONVEX_CAST_EPSILON (squared length)
const EQUAL_VERTEX_THRESHOLD = 0.0001 * BT2; // squared distance
const VDOTR_EPS = SIMD_EPSILON * SIMD_EPSILON * BT2;
const DEGENERATE_SIGN = 1e-4 * 125000;       // pointOutsideOfPlane: [AD AB AC] is a length^3

// ---------------------------------------------------------------------------
// btVoronoiSimplexSolver (closest point of a 1-4 vertex simplex to the origin)
// ---------------------------------------------------------------------------
const W = new Float64Array(15), P = new Float64Array(15), Q = new Float64Array(15);
const S = {
  n: 0, needsUpdate: true, validClosest: false,
  lastW: new Float64Array(3), cP1: new Float64Array(3), cP2: new Float64Array(3), cV: new Float64Array(3),
};
// btSubSimplexClosestResult: closest point, used-vertex mask (bits A..D), barycentric coords
const BC = { pt: new Float64Array(3), used: 0, bary: new Float64Array(4), degenerate: false };
const TMP = { pt: new Float64Array(3), used: 0, bary: new Float64Array(4), degenerate: false };
const UA = 1, UB = 2, UC = 4, UD = 8;
const _tri = new Float64Array(9); // a, b, c of the triangle being tested

function bcReset(r) { r.degenerate = false; r.bary[0] = 0; r.bary[1] = 0; r.bary[2] = 0; r.bary[3] = 0; r.used = 0; }
function bcValid(r) { return r.bary[0] >= 0 && r.bary[1] >= 0 && r.bary[2] >= 0 && r.bary[3] >= 0; }

function simplexReset() {
  S.validClosest = false; S.n = 0; S.needsUpdate = true;
  S.lastW[0] = S.lastW[1] = S.lastW[2] = 1e30;
  bcReset(BC);
}

// addVertex(w, p, q) from the scratch arrays _w, _p, _q
function addVertex(w, p, q) {
  S.lastW[0] = w[0]; S.lastW[1] = w[1]; S.lastW[2] = w[2];
  S.needsUpdate = true;
  const o = S.n * 3;
  W[o] = w[0]; W[o + 1] = w[1]; W[o + 2] = w[2];
  P[o] = p[0]; P[o + 1] = p[1]; P[o + 2] = p[2];
  Q[o] = q[0]; Q[o + 1] = q[1]; Q[o + 2] = q[2];
  S.n++;
}

function removeVertex(i) {
  S.n--;
  const o = i * 3, l = S.n * 3;
  W[o] = W[l]; W[o + 1] = W[l + 1]; W[o + 2] = W[l + 2];
  P[o] = P[l]; P[o + 1] = P[l + 1]; P[o + 2] = P[l + 2];
  Q[o] = Q[l]; Q[o + 1] = Q[l + 1]; Q[o + 2] = Q[l + 2];
}

function reduceVertices(used) {
  if (S.n >= 4 && !(used & UD)) removeVertex(3);
  if (S.n >= 3 && !(used & UC)) removeVertex(2);
  if (S.n >= 2 && !(used & UB)) removeVertex(1);
  if (S.n >= 1 && !(used & UA)) removeVertex(0);
}

function inSimplex(w) {
  let found = false;
  for (let i = 0; i < S.n; i++) {
    const o = i * 3, dx = W[o] - w[0], dy = W[o + 1] - w[1], dz = W[o + 2] - w[2];
    if (dx * dx + dy * dy + dz * dz <= EQUAL_VERTEX_THRESHOLD) { found = true; break; }
  }
  if (w[0] === S.lastW[0] && w[1] === S.lastW[1] && w[2] === S.lastW[2]) return true;
  return found;
}

// closestPtPointTriangle with p = origin, triangle _tri (a, b, c), into r
function closestPtOriginTriangle(r) {
  bcReset(r);
  const T = _tri;
  const ax = T[0], ay = T[1], az = T[2], bx = T[3], by = T[4], bz = T[5], cx = T[6], cy = T[7], cz = T[8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = -ax, apy = -ay, apz = -az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const pt = r.pt, bc = r.bary;
  if (d1 <= 0 && d2 <= 0) { pt[0] = ax; pt[1] = ay; pt[2] = az; r.used = UA; bc[0] = 1; return; }
  const bpx = -bx, bpy = -by, bpz = -bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { pt[0] = bx; pt[1] = by; pt[2] = bz; r.used = UB; bc[1] = 1; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    pt[0] = ax + v * abx; pt[1] = ay + v * aby; pt[2] = az + v * abz; r.used = UA | UB; bc[0] = 1 - v; bc[1] = v; return;
  }
  const cpx = -cx, cpy = -cy, cpz = -cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { pt[0] = cx; pt[1] = cy; pt[2] = cz; r.used = UC; bc[2] = 1; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    pt[0] = ax + w * acx; pt[1] = ay + w * acy; pt[2] = az + w * acz; r.used = UA | UC; bc[0] = 1 - w; bc[2] = w; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    pt[0] = bx + w * (cx - bx); pt[1] = by + w * (cy - by); pt[2] = bz + w * (cz - bz); r.used = UB | UC; bc[1] = 1 - w; bc[2] = w; return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  pt[0] = ax + abx * v + acx * w; pt[1] = ay + aby * v + acy * w; pt[2] = az + abz * v + acz * w;
  r.used = UA | UB | UC; bc[0] = 1 - v - w; bc[1] = v; bc[2] = w;
}

// pointOutsideOfPlane(origin, a, b, c, d) with vertices of W by index:
// 1 / 0 = origin and d on opposite / same sides, -1 = degenerate
function outsidePlane(ia, ib, ic, id) {
  const a = ia * 3, b = ib * 3, c = ic * 3, d = id * 3;
  const abx = W[b] - W[a], aby = W[b + 1] - W[a + 1], abz = W[b + 2] - W[a + 2];
  const acx = W[c] - W[a], acy = W[c + 1] - W[a + 1], acz = W[c + 2] - W[a + 2];
  const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
  const signp = -W[a] * nx - W[a + 1] * ny - W[a + 2] * nz;
  const signd = (W[d] - W[a]) * nx + (W[d + 1] - W[a + 1]) * ny + (W[d + 2] - W[a + 2]) * nz;
  if (signd * signd < DEGENERATE_SIGN * DEGENERATE_SIGN) return -1;
  return signp * signd < 0 ? 1 : 0;
}

function setTri(ia, ib, ic) {
  const a = ia * 3, b = ib * 3, c = ic * 3;
  _tri[0] = W[a]; _tri[1] = W[a + 1]; _tri[2] = W[a + 2];
  _tri[3] = W[b]; _tri[4] = W[b + 1]; _tri[5] = W[b + 2];
  _tri[6] = W[c]; _tri[7] = W[c + 1]; _tri[8] = W[c + 2];
}

// closestPtPointTetrahedron (origin vs W[0..3]) into BC; false = no separation
function closestPtOriginTetrahedron() {
  const r = BC;
  r.pt[0] = 0; r.pt[1] = 0; r.pt[2] = 0;
  r.used = UA | UB | UC | UD;
  const oABC = outsidePlane(0, 1, 2, 3), oACD = outsidePlane(0, 2, 3, 1);
  const oADB = outsidePlane(0, 3, 1, 2), oBDC = outsidePlane(1, 3, 2, 0);
  if (oABC < 0 || oACD < 0 || oADB < 0 || oBDC < 0) { r.degenerate = true; return false; }
  if (!oABC && !oACD && !oADB && !oBDC) return false;
  let best = Number.MAX_VALUE;
  const t = TMP, tb = t.bary, b = r.bary;
  if (oABC) {
    setTri(0, 1, 2); closestPtOriginTriangle(t);
    const d = t.pt[0] * t.pt[0] + t.pt[1] * t.pt[1] + t.pt[2] * t.pt[2];
    if (d < best) {
      best = d; r.pt.set(t.pt);
      r.used = (t.used & UA ? UA : 0) | (t.used & UB ? UB : 0) | (t.used & UC ? UC : 0);
      b[0] = tb[0]; b[1] = tb[1]; b[2] = tb[2]; b[3] = 0;
    }
  }
  if (oACD) {
    setTri(0, 2, 3); closestPtOriginTriangle(t);
    const d = t.pt[0] * t.pt[0] + t.pt[1] * t.pt[1] + t.pt[2] * t.pt[2];
    if (d < best) {
      best = d; r.pt.set(t.pt);
      r.used = (t.used & UA ? UA : 0) | (t.used & UB ? UC : 0) | (t.used & UC ? UD : 0);
      b[0] = tb[0]; b[1] = 0; b[2] = tb[1]; b[3] = tb[2];
    }
  }
  if (oADB) {
    setTri(0, 3, 1); closestPtOriginTriangle(t);
    const d = t.pt[0] * t.pt[0] + t.pt[1] * t.pt[1] + t.pt[2] * t.pt[2];
    if (d < best) {
      best = d; r.pt.set(t.pt);
      r.used = (t.used & UA ? UA : 0) | (t.used & UC ? UB : 0) | (t.used & UB ? UD : 0);
      b[0] = tb[0]; b[1] = tb[2]; b[2] = 0; b[3] = tb[1];
    }
  }
  if (oBDC) {
    setTri(1, 3, 2); closestPtOriginTriangle(t);
    const d = t.pt[0] * t.pt[0] + t.pt[1] * t.pt[1] + t.pt[2] * t.pt[2];
    if (d < best) {
      best = d; r.pt.set(t.pt);
      r.used = (t.used & UA ? UB : 0) | (t.used & UC ? UC : 0) | (t.used & UB ? UD : 0);
      b[0] = 0; b[1] = tb[0]; b[2] = tb[2]; b[3] = tb[1];
    }
  }
  return true;
}

// cached P1 / P2 = barycentric combination of the stored P / Q points
function combine(nv) {
  const b = BC.bary, p1 = S.cP1, p2 = S.cP2;
  p1[0] = p1[1] = p1[2] = p2[0] = p2[1] = p2[2] = 0;
  for (let i = 0; i < nv; i++) {
    const o = i * 3, k = b[i];
    p1[0] += P[o] * k; p1[1] += P[o + 1] * k; p1[2] += P[o + 2] * k;
    p2[0] += Q[o] * k; p2[1] += Q[o + 1] * k; p2[2] += Q[o + 2] * k;
  }
  S.cV[0] = p1[0] - p2[0]; S.cV[1] = p1[1] - p2[1]; S.cV[2] = p1[2] - p2[2];
}

function updateClosest() {
  if (!S.needsUpdate) return S.validClosest;
  bcReset(BC);
  S.needsUpdate = false;
  switch (S.n) {
    case 0: S.validClosest = false; break;
    case 1:
      S.cP1[0] = P[0]; S.cP1[1] = P[1]; S.cP1[2] = P[2];
      S.cP2[0] = Q[0]; S.cP2[1] = Q[1]; S.cP2[2] = Q[2];
      S.cV[0] = P[0] - Q[0]; S.cV[1] = P[1] - Q[1]; S.cV[2] = P[2] - Q[2];
      BC.bary[0] = 1;
      S.validClosest = true;
      break;
    case 2: {
      // closest point of the segment W0-W1 to the origin
      const fx = W[0], fy = W[1], fz = W[2];
      const vx = W[3] - fx, vy = W[4] - fy, vz = W[5] - fz;
      let t = -(vx * fx + vy * fy + vz * fz);
      if (t > 0) {
        const vv = vx * vx + vy * vy + vz * vz;
        if (t < vv) { t /= vv; BC.used = UA | UB; } else { t = 1; BC.used = UB; }
      } else { t = 0; BC.used = UA; }
      BC.bary[0] = 1 - t; BC.bary[1] = t;
      S.cP1[0] = P[0] + t * (P[3] - P[0]); S.cP1[1] = P[1] + t * (P[4] - P[1]); S.cP1[2] = P[2] + t * (P[5] - P[2]);
      S.cP2[0] = Q[0] + t * (Q[3] - Q[0]); S.cP2[1] = Q[1] + t * (Q[4] - Q[1]); S.cP2[2] = Q[2] + t * (Q[5] - Q[2]);
      S.cV[0] = S.cP1[0] - S.cP2[0]; S.cV[1] = S.cP1[1] - S.cP2[1]; S.cV[2] = S.cP1[2] - S.cP2[2];
      reduceVertices(BC.used);
      S.validClosest = bcValid(BC);
      break;
    }
    case 3:
      setTri(0, 1, 2);
      closestPtOriginTriangle(BC);
      combine(3);
      reduceVertices(BC.used);
      S.validClosest = bcValid(BC);
      break;
    case 4:
      if (closestPtOriginTetrahedron()) {
        combine(4);
        reduceVertices(BC.used);
        S.validClosest = bcValid(BC);
      } else if (BC.degenerate) {
        S.validClosest = false;
      } else {
        S.validClosest = true;
        S.cV[0] = S.cV[1] = S.cV[2] = 0;
      }
      break;
    default: S.validClosest = false;
  }
  return S.validClosest;
}

// ---------------------------------------------------------------------------
// btSubsimplexConvexCast for a point (the ray) against a sphere or a box
// ---------------------------------------------------------------------------
export const SHAPE_SPHERE = 0, SHAPE_BOX = 1;
/**
 * The convex shape a ray is cast against (fields, so nothing is boxed):
 * sphere: centre cx..cz, radius r. box: centre cx..cz, rotation R (row-major
 * M3 elements), half extents incl. margin hx..hz (btBoxShape supports).
 */
export const castShape = { type: 0, cx: 0.5, cy: 0.5, cz: 0.5, r: 0.5, R: null, hx: 0.5, hy: 0.5, hz: 0.5 };

const _v = new Float64Array(3), _w = new Float64Array(3), _sa = new Float64Array(3), _sb = new Float64Array(3);
const _n = new Float64Array(3);

// world support point of castShape in direction d (Float64Array 3) into out
function support(d, out) {
  const s = castShape;
  if (s.type === SHAPE_SPHERE) {
    let x = d[0], y = d[1], z = d[2];
    let l2 = x * x + y * y + z * z;
    if (l2 < SIMD_EPSILON * SIMD_EPSILON * BT2) { x = -1; y = -1; z = -1; l2 = 3; }
    const k = s.r / Math.sqrt(l2);
    out[0] = s.cx + x * k; out[1] = s.cy + y * k; out[2] = s.cz + z * k;
  } else {
    const R = s.R;
    const lx = R[0] * d[0] + R[3] * d[1] + R[6] * d[2], ly = R[1] * d[0] + R[4] * d[1] + R[7] * d[2], lz = R[2] * d[0] + R[5] * d[1] + R[8] * d[2];
    const sx = lx >= 0 ? s.hx : -s.hx, sy = ly >= 0 ? s.hy : -s.hy, sz = lz >= 0 ? s.hz : -s.hz; // btFsels
    out[0] = s.cx + R[0] * sx + R[1] * sy + R[2] * sz;
    out[1] = s.cy + R[3] * sx + R[4] * sy + R[5] * sz;
    out[2] = s.cz + R[6] * sx + R[7] * sy + R[8] * sz;
  }
}

/**
 * Casts ray (ox..oz, unit dx..dz, length len) against castShape. On a hit
 * with fraction below ray.fraction it sets ray.fraction and the unit normal
 * ray.hnx..hnz (pointing from the shape toward the ray) and returns true.
 */
export function rayCastConvex(ray) {
  simplexReset();
  const rx = ray.dx * ray.len, ry = ray.dy * ray.len, rz = ray.dz * ray.len;
  let lambda = 0;
  let xx = ray.ox, xy = ray.oy, xz = ray.oz; // interpolated ray point
  // first separating vector: point - support(r)
  _v[0] = rx; _v[1] = ry; _v[2] = rz;
  support(_v, _sb);
  _v[0] = xx - _sb[0]; _v[1] = xy - _sb[1]; _v[2] = xz - _sb[2];
  _n[0] = _n[1] = _n[2] = 0;
  let dist2 = _v[0] * _v[0] + _v[1] * _v[1] + _v[2] * _v[2];
  let iter = CAST_MAX_ITER;
  while (dist2 > CAST_EPS2 && iter-- > 0) {
    _sa[0] = xx; _sa[1] = xy; _sa[2] = xz;
    support(_v, _sb);
    _w[0] = _sa[0] - _sb[0]; _w[1] = _sa[1] - _sb[1]; _w[2] = _sa[2] - _sb[2];
    const vw = _v[0] * _w[0] + _v[1] * _w[1] + _v[2] * _w[2];
    if (lambda > 1) return false;
    if (vw > 0) {
      const vr = _v[0] * rx + _v[1] * ry + _v[2] * rz;
      if (vr >= -VDOTR_EPS) return false;
      lambda -= vw / vr;
      // setInterpolate3(from, to, lambda)
      const s = 1 - lambda;
      xx = s * ray.ox + lambda * (ray.ox + rx); xy = s * ray.oy + lambda * (ray.oy + ry); xz = s * ray.oz + lambda * (ray.oz + rz);
      _n[0] = _v[0]; _n[1] = _v[1]; _n[2] = _v[2];
    }
    if (!inSimplex(_w)) addVertex(_w, _sa, _sb);
    if (updateClosest()) {
      _v[0] = S.cV[0]; _v[1] = S.cV[1]; _v[2] = S.cV[2];
      dist2 = _v[0] * _v[0] + _v[1] * _v[1] + _v[2] * _v[2];
    } else {
      _v[0] = S.cV[0]; _v[1] = S.cV[1]; _v[2] = S.cV[2];
      dist2 = 0;
    }
  }
  // normal (zero if it never advanced: the ray started inside or touching)
  const n2 = _n[0] * _n[0] + _n[1] * _n[1] + _n[2] * _n[2];
  if (n2 < SIMD_EPSILON * SIMD_EPSILON * BT2) return false;
  const il = 1 / Math.sqrt(n2), nx = _n[0] * il, ny = _n[1] * il, nz = _n[2] * il;
  if (nx * rx + ny * ry + nz * rz >= 0) return false; // moving away (m_allowedPenetration 0)
  // rayTestSingleInternal: closest hit only
  if (!(lambda < ray.fraction)) return false;
  ray.fraction = lambda;
  ray.hnx = nx; ray.hny = ny; ray.hnz = nz;
  return true;
}
