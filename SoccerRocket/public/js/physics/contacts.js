// Narrowphase: contact points between the ball, the cars and the arena, and
// the wheel ray casts, generated the way RocketSim's Bullet world does it.
//
// Ported from RocketSim (MIT, Copyright (c) 2022 ZealanL) and Bullet Physics
// (zlib, Copyright (c) 2003-2006 Erwin Coumans; box-box from ODE,
// Copyright (c) 2001-2002 Russell L. Smith, zlib-licensed in Bullet):
//   SphereTriangleDetector (RocketSim's closestPointTriangle variant),
//   btConvexPlaneCollisionAlgorithm (one support-vertex point, no perturbation),
//   btSphereBoxCollisionAlgorithm (core box + margin), btBoxBoxDetector
//   (dBoxBox2, up to 4 points, contacts only while the boxes overlap),
//   btConvexTriangleCallback (triangle AABB + support early-outs),
//   btManifoldResult::addContactPoint / btPersistentManifold (<= 4 points per
//   pair, replacement keeps the deepest and maximises area), RocketSim's
//   material combine (static: min friction, max restitution; else products)
//   and btAdjustInternalEdgeContacts (normal correction at shared mesh edges).
// Box vs triangle uses exact closest features between the margin-shrunk box
// and the triangle (what Bullet's GJK computes) and a SAT minimum-translation
// axis when the shrunk box intersects (Bullet's EPA); ties are averaged.
//
// RocketSim rebuilds every broadphase pair each tick, so nothing persists
// between ticks: each tick starts with empty manifolds. Contacts exist from
// a small distance before touching ("speculative"): car pairs 2.0334 uu,
// anything with the ball 1.905 uu (Bullet's relative breaking threshold:
// 0.02 * angular motion disc; RocketSim adds 0.08 bt to sphere bounds).
//
// Frames: point A is on body A (the dynamic body that owns the manifold: the
// ball for ball-world and car-ball, the car for car-world, the lower-index car
// for car-car), point B on body B; the normal is on B and points toward A;
// dist < 0 is penetration.
import * as K from './constants.js';
import { NO_EDGE, TRI_V0V1_CONVEX, TRI_V1V2_CONVEX, TRI_V2V0_CONVEX, TRI_V0V1_SWAP, TRI_V1V2_SWAP, TRI_V2V0_SWAP } from './arena.js';

export const KIND_BALL_WORLD = 1, KIND_CAR_WORLD = 2, KIND_CAR_BALL = 3, KIND_CAR_CAR = 4;
// Hit body types returned by ray casts
export const HIT_STATIC = 0, HIT_BALL = 1, HIT_CAR = 2;

// RocketSim's static planes (Arena.cpp): floor, ceiling, side walls. Point + normal.
export const PLANES = [
  { px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 1 },
  { px: 0, py: 0, pz: K.ARENA_HEIGHT, nx: 0, ny: 0, nz: -1 },
  { px: -K.ARENA.X, py: 0, pz: K.ARENA_HEIGHT / 2, nx: 1, ny: 0, nz: 0 },
  { px: K.ARENA.X, py: 0, pz: K.ARENA_HEIGHT / 2, nx: -1, ny: 0, nz: 0 },
];

// Ball: AABB grows by 0.08 bt (RocketSim btSphereShape::getAabb), breaking
// threshold 0.02 * (r + 0.08 bt).
export const BALL_AABB_EXTRA = 0.08 * 50;
export const BALL_CONTACT_THRESHOLD = 0.02 * (K.BALL_RADIUS + BALL_AABB_EXTRA);
const ARENA_FRICTION = 0.6, ARENA_RESTITUTION = 0.3; // ARENA_COLLISION_BASE_*
const SIMD_EPSILON = 1.1920929e-7;
const EPS2_UU = SIMD_EPSILON * 2500;
const EDGE_DIST_THRESHOLD = 0.1 * 50; // btTriangleInfoMap::m_edgeDistanceThreshold

/** One manifold point (btManifoldPoint subset). */
export class ContactPoint {
  constructor() {
    this.a = null; this.b = null; this.kind = 0;
    this.ax = 0; this.ay = 0; this.az = 0; this.bx = 0; this.by = 0; this.bz = 0;
    this.nx = 0; this.ny = 0; this.nz = 0; this.dist = 0;
    this.lax = 0; this.lay = 0; this.laz = 0; // point A relative to A's origin
    this.friction = 0; this.restitution = 0; this.special = false;
    this.tri = -1;  // arena triangle index (-1: plane / body)
    this.vn = 0;    // approach speed along the normal at detection (for events)
  }
  copy(o) {
    this.a = o.a; this.b = o.b; this.kind = o.kind;
    this.ax = o.ax; this.ay = o.ay; this.az = o.az; this.bx = o.bx; this.by = o.by; this.bz = o.bz;
    this.nx = o.nx; this.ny = o.ny; this.nz = o.nz; this.dist = o.dist;
    this.lax = o.lax; this.lay = o.lay; this.laz = o.laz;
    this.friction = o.friction; this.restitution = o.restitution; this.special = o.special;
    this.tri = o.tri; this.vn = o.vn;
    return this;
  }
}

function area(ax, ay, az, bx, by, bz) {
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  return cx * cx + cy * cy + cz * cz;
}

/** Per-pair point cache, at most 4 points (btPersistentManifold, MANIFOLD_CACHE_SIZE 4). */
export class Manifold {
  constructor() {
    this.pts = [new ContactPoint(), new ContactPoint(), new ContactPoint(), new ContactPoint()];
    this.n = 0; this.a = null; this.b = null; this.kind = 0; this.threshold = 0;
  }
  // addManifoldPoint: append, or replace per sortCachedPoints when full
  add(p) {
    let i = this.n;
    if (i === 4) i = this._sortCachedPoints(p);
    else this.n++;
    return this.pts[i].copy(p);
  }
  // gContactCalcArea3Points = true; keeps the deepest point, maximises area
  _sortCachedPoints(p) {
    const P = this.pts;
    let maxPen = p.dist, maxIdx = -1;
    for (let i = 0; i < 4; i++) if (P[i].dist < maxPen) { maxIdx = i; maxPen = P[i].dist; }
    let r0 = 0, r1 = 0, r2 = 0, r3 = 0;
    if (maxIdx !== 0) r0 = area(p.lax - P[1].lax, p.lay - P[1].lay, p.laz - P[1].laz, P[3].lax - P[2].lax, P[3].lay - P[2].lay, P[3].laz - P[2].laz);
    if (maxIdx !== 1) r1 = area(p.lax - P[0].lax, p.lay - P[0].lay, p.laz - P[0].laz, P[3].lax - P[2].lax, P[3].lay - P[2].lay, P[3].laz - P[2].laz);
    if (maxIdx !== 2) r2 = area(p.lax - P[0].lax, p.lay - P[0].lay, p.laz - P[0].laz, P[3].lax - P[1].lax, P[3].lay - P[1].lay, P[3].laz - P[1].laz);
    if (maxIdx !== 3) r3 = area(p.lax - P[0].lax, p.lay - P[0].lay, p.laz - P[0].laz, P[2].lax - P[1].lax, P[2].lay - P[1].lay, P[2].laz - P[1].laz);
    // btVector4::closestAxis4 -> first index of the largest
    let best = 0, bv = r0;
    if (r1 > bv) { best = 1; bv = r1; }
    if (r2 > bv) { best = 2; bv = r2; }
    if (r3 > bv) { best = 3; }
    return best;
  }
}

/**
 * Contact generation for one World. `listener` receives the RocketSim contact
 * callbacks as points are added: onBallWorld(pt), onCarBall(car, ball, pt),
 * onCarCar(carA, carB, pt), onCarWorld(car, pt). They may change pt.friction /
 * pt.restitution / pt.special (Arena::_BulletContactAddedCallback).
 */
export class Narrowphase {
  constructor(mesh, listener) {
    this.mesh = mesh;
    this.listener = listener;
    this.manifolds = [];
    this.nManifolds = 0;
    this._tmp = new ContactPoint();
  }

  begin() { this.nManifolds = 0; }

  _manifold(a, b, kind, threshold) {
    let m = this.manifolds[this.nManifolds];
    if (!m) m = this.manifolds[this.nManifolds] = new Manifold();
    m.n = 0; m.a = a; m.b = b; m.kind = kind; m.threshold = threshold;
    return m;
  }
  // keep the manifold only if it got points (Bullet drops empty ones in the solver anyway)
  _commit(m) { if (m.n > 0) this.nManifolds++; }

  /**
   * btManifoldResult::addContactPoint in the manifold's frame: normal on B
   * toward A, point on B, depth (< 0 penetrating). Fires the contact callback
   * and, for arena triangles, the internal-edge correction.
   */
  _add(m, nx, ny, nz, bx, by, bz, depth, tri) {
    if (depth > m.threshold) return null;
    const p = this._tmp, a = m.a;
    p.a = a; p.b = m.b; p.kind = m.kind;
    p.nx = nx; p.ny = ny; p.nz = nz; p.dist = depth;
    p.bx = bx; p.by = by; p.bz = bz;
    p.ax = bx + nx * depth; p.ay = by + ny * depth; p.az = bz + nz * depth;
    p.lax = p.ax - a.pos.x; p.lay = p.ay - a.pos.y; p.laz = p.az - a.pos.z;
    p.tri = tri; p.special = false;
    // default material combine (RocketSim btManifoldResult): with a static
    // body min friction / max restitution, else products
    if (m.b === null) {
      p.friction = Math.min(a.friction, ARENA_FRICTION);
      p.restitution = Math.max(a.restitution, ARENA_RESTITUTION);
    } else {
      p.friction = a.friction * m.b.friction;
      p.restitution = a.restitution * m.b.restitution;
    }
    // approach speed at detection (event strength only, not used by the solver)
    setApproachSpeed(a, m.b, p);
    const pt = m.add(p);
    const L = this.listener;
    switch (m.kind) {
      case KIND_BALL_WORLD: L.onBallWorld(pt); break;
      case KIND_CAR_WORLD: L.onCarWorld(a, pt); break;
      case KIND_CAR_BALL: L.onCarBall(m.b, a, pt); break;
      case KIND_CAR_CAR: L.onCarCar(a, m.b, pt); break;
      default: break;
    }
    if (tri >= 0) adjustInternalEdgeContact(pt, this.mesh, tri);
    return pt;
  }

  // ------------------------------------------------------------------ ball vs arena
  /** Ball vs the triangle mesh (one manifold) and each plane (one manifold each). */
  ballWorld(ball) {
    const mesh = this.mesh, thr = BALL_CONTACT_THRESHOLD, r = ball.radius;
    const c = ball.pos, e = r + BALL_AABB_EXTRA;
    const x0 = c.x - e, y0 = c.y - e, z0 = c.z - e, x1 = c.x + e, y1 = c.y + e, z1 = c.z + e;
    const m = this._manifold(ball, null, KIND_BALL_WORLD, thr);
    const n = mesh.overlapping(x0, y0, z0, x1, y1, z1);
    for (let k = 0; k < n; k++) {
      const t = mesh.hits[k];
      if (sphereTriangle(c.x, c.y, c.z, r, thr, mesh.tris, t * 9, _st)) {
        this._add(m, _st.nx, _st.ny, _st.nz, _st.px, _st.py, _st.pz, _st.depth, t);
      }
    }
    this._commit(m);
    for (let i = 0; i < PLANES.length; i++) {
      const P = PLANES[i];
      const d = P.nx * (c.x - P.px) + P.ny * (c.y - P.py) + P.nz * (c.z - P.pz) - r;
      if (d >= thr) continue;
      const mp = this._manifold(ball, null, KIND_BALL_WORLD, thr);
      // support vertex c - n r, projected onto the plane
      const k = r + d;
      this._add(mp, P.nx, P.ny, P.nz, c.x - P.nx * k, c.y - P.ny * k, c.z - P.nz * k, d, -1);
      this._commit(mp);
    }
  }

  // ------------------------------------------------------------------ car vs arena
  /** Car hitbox (btBoxShape with margin) vs the mesh (one manifold) and each plane. */
  carWorld(car) {
    const mesh = this.mesh, thr = car.contactThreshold;
    boxFrame(car, _bx);
    const h = car.half, mg = car.margin, R = car.R.e;
    // btBoxShape::getAabb: |R| * (half - margin) + margin
    const ex = Math.abs(R[0]) * _bx.ex + Math.abs(R[1]) * _bx.ey + Math.abs(R[2]) * _bx.ez + mg;
    const ey = Math.abs(R[3]) * _bx.ex + Math.abs(R[4]) * _bx.ey + Math.abs(R[5]) * _bx.ez + mg;
    const ez = Math.abs(R[6]) * _bx.ex + Math.abs(R[7]) * _bx.ey + Math.abs(R[8]) * _bx.ez + mg;
    const x0 = _bx.cx - ex, y0 = _bx.cy - ey, z0 = _bx.cz - ez, x1 = _bx.cx + ex, y1 = _bx.cy + ey, z1 = _bx.cz + ez;
    const m = this._manifold(car, null, KIND_CAR_WORLD, thr);
    const n = mesh.overlapping(x0, y0, z0, x1, y1, z1);
    const T = mesh.tris, N = mesh.norms;
    for (let k = 0; k < n; k++) {
      const t = mesh.hits[k];
      // btConvexTriangleCallback early-out: the box (sharp corners) entirely
      // on one side of the triangle plane beyond the threshold
      const o = t * 9, tnx = N[t * 3], tny = N[t * 3 + 1], tnz = N[t * 3 + 2];
      const rad = h.x * Math.abs(tnx * R[0] + tny * R[3] + tnz * R[6]) + h.y * Math.abs(tnx * R[1] + tny * R[4] + tnz * R[7]) + h.z * Math.abs(tnx * R[2] + tny * R[5] + tnz * R[8]);
      const sd = tnx * (_bx.cx - T[o]) + tny * (_bx.cy - T[o + 1]) + tnz * (_bx.cz - T[o + 2]);
      if (sd - rad > thr || -sd - rad > thr) continue;
      if (boxTriangle(_bx, R, mg, T, o, tnx, tny, tnz, thr, _st)) {
        this._add(m, _st.nx, _st.ny, _st.nz, _st.px, _st.py, _st.pz, _st.depth, t);
      }
    }
    this._commit(m);
    for (let i = 0; i < PLANES.length; i++) {
      const P = PLANES[i];
      // support vertex of the full box along -n (btBoxShape::localGetSupportingVertex, fsel >= 0)
      const lx = -(P.nx * R[0] + P.ny * R[3] + P.nz * R[6]), ly = -(P.nx * R[1] + P.ny * R[4] + P.nz * R[7]), lz = -(P.nx * R[2] + P.ny * R[5] + P.nz * R[8]);
      const sx = lx >= 0 ? h.x : -h.x, sy = ly >= 0 ? h.y : -h.y, sz = lz >= 0 ? h.z : -h.z;
      const vx = _bx.cx + R[0] * sx + R[1] * sy + R[2] * sz;
      const vy = _bx.cy + R[3] * sx + R[4] * sy + R[5] * sz;
      const vz = _bx.cz + R[6] * sx + R[7] * sy + R[8] * sz;
      const d = P.nx * (vx - P.px) + P.ny * (vy - P.py) + P.nz * (vz - P.pz);
      if (d >= thr) continue;
      const mp = this._manifold(car, null, KIND_CAR_WORLD, thr);
      this._add(mp, P.nx, P.ny, P.nz, vx - P.nx * d, vy - P.ny * d, vz - P.nz * d, d, -1);
      this._commit(mp);
    }
  }

  // ------------------------------------------------------------------ car vs ball
  /** btSphereBoxCollisionAlgorithm: manifold A = ball, B = car. */
  carBall(car, ball) {
    const thr = Math.min(BALL_CONTACT_THRESHOLD, car.contactThreshold);
    boxFrame(car, _bx);
    const R = car.R.e, mg = car.margin, r = ball.radius;
    const dx = ball.pos.x - _bx.cx, dy = ball.pos.y - _bx.cy, dz = ball.pos.z - _bx.cz;
    // sphere centre in box space
    const sx = R[0] * dx + R[3] * dy + R[6] * dz, sy = R[1] * dx + R[4] * dy + R[7] * dz, sz = R[2] * dx + R[5] * dy + R[8] * dz;
    let qx = Math.max(-_bx.ex, Math.min(_bx.ex, sx)), qy = Math.max(-_bx.ey, Math.min(_bx.ey, sy)), qz = Math.max(-_bx.ez, Math.min(_bx.ez, sz));
    const inter = r + mg, contactDist = inter + thr;
    let nx = sx - qx, ny = sy - qy, nz = sz - qz;
    const d2 = nx * nx + ny * ny + nz * nz;
    if (d2 > contactDist * contactDist) return;
    let dist;
    if (d2 <= EPS2_UU) {
      // centre inside the core box: push out through the nearest face (getSpherePenetration)
      let f = _bx.ex - sx, mn = f; qx = _bx.ex; qy = sy; qz = sz; nx = 1; ny = 0; nz = 0;
      f = _bx.ex + sx; if (f < mn) { mn = f; qx = -_bx.ex; qy = sy; qz = sz; nx = -1; ny = 0; nz = 0; }
      f = _bx.ey - sy; if (f < mn) { mn = f; qx = sx; qy = _bx.ey; qz = sz; nx = 0; ny = 1; nz = 0; }
      f = _bx.ey + sy; if (f < mn) { mn = f; qx = sx; qy = -_bx.ey; qz = sz; nx = 0; ny = -1; nz = 0; }
      f = _bx.ez - sz; if (f < mn) { mn = f; qx = sx; qy = sy; qz = _bx.ez; nx = 0; ny = 0; nz = 1; }
      f = _bx.ez + sz; if (f < mn) { mn = f; qx = sx; qy = sy; qz = -_bx.ez; nx = 0; ny = 0; nz = -1; }
      dist = -mn;
    } else {
      dist = Math.sqrt(d2);
      nx /= dist; ny /= dist; nz /= dist;
    }
    const px = qx + nx * mg, py = qy + ny * mg, pz = qz + nz * mg;
    const depth = dist - inter;
    const wnx = R[0] * nx + R[1] * ny + R[2] * nz, wny = R[3] * nx + R[4] * ny + R[5] * nz, wnz = R[6] * nx + R[7] * ny + R[8] * nz;
    const wpx = _bx.cx + R[0] * px + R[1] * py + R[2] * pz, wpy = _bx.cy + R[3] * px + R[4] * py + R[5] * pz, wpz = _bx.cz + R[6] * px + R[7] * py + R[8] * pz;
    const m = this._manifold(ball, car, KIND_CAR_BALL, thr);
    this._add(m, wnx, wny, wnz, wpx, wpy, wpz, depth, -1);
    this._commit(m);
  }

  // ------------------------------------------------------------------ car vs car
  /** btBoxBoxDetector (dBoxBox2, maxc 4) on the full hitboxes. A = carA, B = carB. */
  carCar(carA, carB) {
    boxFrame(carA, _bx); boxFrame(carB, _by);
    const m = this._manifold(carA, carB, KIND_CAR_CAR, Math.min(carA.contactThreshold, carB.contactThreshold));
    boxBox(this, m, _bx, carA.R.e, carA.half, _by, carB.R.e, carB.half);
    this._commit(m);
  }

  // ------------------------------------------------------------------ wheel rays
  /**
   * Closest hit along from + dir * t, t in [0, len] (dir unit), against the
   * arena (two-sided triangles + planes), the ball and every car except
   * `ignore` (btDefaultVehicleRaycaster: ClosestRayResultCallback, then no hit
   * if that body has no contact response, i.e. a demolished car).
   * world: { ball, cars }. Fills `out` and returns true on a hit.
   */
  raycast(world, fx, fy, fz, dx, dy, dz, len, ignore, out) {
    let best = len, type = -1, body = null;
    // triangles
    if (this.mesh.raycast(fx, fy, fz, dx, dy, dz, len, _rh, true)) {
      best = _rh.t; type = HIT_STATIC; out.nx = _rh.nx; out.ny = _rh.ny; out.nz = _rh.nz;
    }
    // planes (two-sided, normal toward the ray origin)
    for (let i = 0; i < PLANES.length; i++) {
      const P = PLANES[i];
      const den = P.nx * dx + P.ny * dy + P.nz * dz;
      if (Math.abs(den) < 1e-12) continue;
      const t = (P.nx * (P.px - fx) + P.ny * (P.py - fy) + P.nz * (P.pz - fz)) / den;
      if (t < 0 || t >= best) continue;
      best = t; type = HIT_STATIC;
      const s = den < 0 ? 1 : -1;
      out.nx = P.nx * s; out.ny = P.ny * s; out.nz = P.nz * s;
    }
    // ball
    const ball = world.ball;
    if (ball && !ball.frozen) {
      const t = raySphere(fx, fy, fz, dx, dy, dz, ball.pos, ball.radius, best, _rn);
      if (t >= 0) { best = t; type = HIT_BALL; body = ball; out.nx = _rn[0]; out.ny = _rn[1]; out.nz = _rn[2]; }
    }
    // cars (full hitbox)
    const cars = world.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c === ignore || !c.inWorld) continue;
      const t = rayBox(fx, fy, fz, dx, dy, dz, c, best, _rn);
      if (t >= 0) { best = t; type = HIT_CAR; body = c; out.nx = _rn[0]; out.ny = _rn[1]; out.nz = _rn[2]; }
    }
    if (type < 0) return false;
    if (type === HIT_CAR && body.isDemoed) return false;
    out.t = best; out.fraction = best / len;
    out.px = fx + dx * best; out.py = fy + dy * best; out.pz = fz + dz * best;
    out.type = type; out.body = body;
    if (body) {
      const rx = out.px - body.pos.x, ry = out.py - body.pos.y, rz = out.pz - body.pos.z, w = body.angVel, v = body.vel;
      out.vx = v.x + w.y * rz - w.z * ry; out.vy = v.y + w.z * rx - w.x * rz; out.vz = v.z + w.x * ry - w.y * rx;
    } else { out.vx = 0; out.vy = 0; out.vz = 0; }
    return true;
  }
}

export function makeRayHit() {
  return { t: 0, fraction: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 1, type: -1, body: null, vx: 0, vy: 0, vz: 0 };
}

// p.vn = approach speed of A toward B along the normal at the point (> 0 closing).
function setApproachSpeed(a, b, p) {
  const rax = p.ax - a.pos.x, ray = p.ay - a.pos.y, raz = p.az - a.pos.z, wa = a.angVel, va = a.vel;
  let vx = va.x + wa.y * raz - wa.z * ray, vy = va.y + wa.z * rax - wa.x * raz, vz = va.z + wa.x * ray - wa.y * rax;
  if (b) {
    const rbx = p.bx - b.pos.x, rby = p.by - b.pos.y, rbz = p.bz - b.pos.z, wb = b.angVel, vb = b.vel;
    vx -= vb.x + wb.y * rbz - wb.z * rby; vy -= vb.y + wb.z * rbx - wb.x * rbz; vz -= vb.z + wb.x * rby - wb.y * rbx;
  }
  p.vn = -(p.nx * vx + p.ny * vy + p.nz * vz);
}

// Car hitbox frame: centre (pos + R offset) and core half extents (half - margin).
const _bx = { cx: 0, cy: 0, cz: 0, ex: 0, ey: 0, ez: 0 };
const _by = { cx: 0, cy: 0, cz: 0, ex: 0, ey: 0, ez: 0 };
function boxFrame(car, out) {
  const R = car.R.e, o = car.hbOffset, p = car.pos;
  out.cx = p.x + R[0] * o.x + R[1] * o.y + R[2] * o.z;
  out.cy = p.y + R[3] * o.x + R[4] * o.y + R[5] * o.z;
  out.cz = p.z + R[6] * o.x + R[7] * o.y + R[8] * o.z;
  out.ex = car.half.x - car.margin; out.ey = car.half.y - car.margin; out.ez = car.half.z - car.margin;
  return out;
}

// ---------------------------------------------------------------------------
// Sphere vs triangle (SphereTriangleDetector::collide, RocketSim version)
// ---------------------------------------------------------------------------
const _st = { nx: 0, ny: 0, nz: 0, px: 0, py: 0, pz: 0, depth: 0 };
const _cp = new Float64Array(3);

function sphereTriangle(cx, cy, cz, r, thr, T, o, out) {
  const ax = T[o], ay = T[o + 1], az = T[o + 2];
  const e1x = T[o + 3] - ax, e1y = T[o + 4] - ay, e1z = T[o + 5] - az;
  const e2x = T[o + 6] - ax, e2y = T[o + 7] - ay, e2z = T[o + 8] - az;
  let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const l2 = nx * nx + ny * ny + nz * nz;
  if (l2 < 1e-12) return false;
  const il = 1 / Math.sqrt(l2); nx *= il; ny *= il; nz *= il;
  const rt = r + thr;
  let dp = (cx - ax) * nx + (cy - ay) * ny + (cz - az) * nz;
  if (dp < 0) { dp = -dp; nx = -nx; ny = -ny; nz = -nz; }
  if (dp >= rt) return false;
  let px, py, pz;
  // facecontains (barycentric, VirxEC)
  const wx = cx - ax, wy = cy - ay, wz = cz - az;
  const ux = e1x, uy = e1y, uz = e1z, vx = e2x, vy = e2y, vz = e2z;
  const Nx = uy * vz - uz * vy, Ny = uz * vx - ux * vz, Nz = ux * vy - uy * vx, NN = Nx * Nx + Ny * Ny + Nz * Nz;
  const gamma = ((uy * wz - uz * wy) * Nx + (uz * wx - ux * wz) * Ny + (ux * wy - uy * wx) * Nz) / NN;
  const beta = ((wy * vz - wz * vy) * Nx + (wz * vx - wx * vz) * Ny + (wx * vy - wy * vx) * Nz) / NN;
  const alpha = 1 - gamma - beta;
  if (alpha >= 0 && alpha <= 1 && beta >= 0 && beta <= 1 && gamma >= 0 && gamma <= 1) {
    px = cx - nx * dp; py = cy - ny * dp; pz = cz - nz * dp;
  } else {
    closestPtTri(cx, cy, cz, T, o, _cp);
    const qx = cx - _cp[0], qy = cy - _cp[1], qz = cz - _cp[2];
    if (qx * qx + qy * qy + qz * qz >= rt * rt) return false;
    px = _cp[0]; py = _cp[1]; pz = _cp[2];
  }
  const qx = cx - px, qy = cy - py, qz = cz - pz, d2 = qx * qx + qy * qy + qz * qz;
  if (d2 >= rt * rt) return false;
  if (d2 > EPS2_UU) {
    const d = Math.sqrt(d2);
    out.nx = qx / d; out.ny = qy / d; out.nz = qz / d; out.depth = d - r;
  } else {
    out.nx = nx; out.ny = ny; out.nz = nz; out.depth = -r;
  }
  out.px = px; out.py = py; out.pz = pz;
  return true;
}

// Ericson, Real-Time Collision Detection 5.1.5 (same as RocketSim's closestPointTriangle)
function closestPtTri(px, py, pz, T, o, out) {
  const ax = T[o], ay = T[o + 1], az = T[o + 2];
  const bx = T[o + 3], by = T[o + 4], bz = T[o + 5];
  const cx = T[o + 6], cy = T[o + 7], cz = T[o + 8];
  return closestPtTriV(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out);
}
function closestPtTriV(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v; return;
  }
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

// ---------------------------------------------------------------------------
// Box (with margin) vs triangle
// ---------------------------------------------------------------------------
// Triangle in box space, scratch
const _tl = new Float64Array(9);
const _q = new Float64Array(3), _sa = new Float64Array(3), _sb = new Float64Array(3);
// 12 edges of the box as (axis, sign a, sign b): along `axis`, the other two coords at +-extent
const BOX_EDGES = new Int8Array([
  0, -1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1,
  1, -1, -1, 1, 1, -1, 1, -1, 1, 1, 1, 1,
  2, -1, -1, 2, 1, -1, 2, -1, 1, 2, 1, 1,
]);
const _ext = new Float64Array(3);
// running minimum of closest-feature candidates (ties within tol averaged)
const _cf = { best: 0, cnt: 0, sAx: 0, sAy: 0, sAz: 0, sBx: 0, sBy: 0, sBz: 0 };
function consider(c, d2, ax, ay, az, bx, by, bz) {
  if (d2 < c.best - 1e-6) { c.best = d2; c.cnt = 1; c.sAx = ax; c.sAy = ay; c.sAz = az; c.sBx = bx; c.sBy = by; c.sBz = bz; }
  else if (d2 <= c.best + 1e-6) { c.cnt++; c.sAx += ax; c.sAy += ay; c.sAz += az; c.sBx += bx; c.sBy += by; c.sBz += bz; }
}

/**
 * Contact between a box (centre/core half extents in bx, rotation R, margin
 * mg) and a triangle (T[o..o+8], unit normal tn). Writes normal (triangle ->
 * box), the point on the triangle and the distance (rounded box surface to
 * triangle) into out. False if farther than thr.
 */
function boxTriangle(bx, R, mg, T, o, tnx, tny, tnz, thr, out) {
  const e0 = bx.ex, e1 = bx.ey, e2 = bx.ez;
  // triangle into box space
  for (let k = 0; k < 3; k++) {
    const x = T[o + k * 3] - bx.cx, y = T[o + k * 3 + 1] - bx.cy, z = T[o + k * 3 + 2] - bx.cz;
    _tl[k * 3] = R[0] * x + R[3] * y + R[6] * z;
    _tl[k * 3 + 1] = R[1] * x + R[4] * y + R[7] * z;
    _tl[k * 3 + 2] = R[2] * x + R[5] * y + R[8] * z;
  }
  const lnx = R[0] * tnx + R[3] * tny + R[6] * tnz, lny = R[1] * tnx + R[4] * tny + R[7] * tnz, lnz = R[2] * tnx + R[5] * tny + R[8] * tnz;
  // ---- SAT on the core box: separated? else minimum translation axis
  let bestPen = Infinity, bax = 0, bay = 0, baz = 0, bestKind = -1, bestI = 0, bestJ = 0;
  let separated = false;
  for (let a = 0; a < 13 && !separated; a++) {
    let Lx, Ly, Lz, kind = 0, ii = 0, jj = 0;
    if (a < 3) { Lx = a === 0 ? 1 : 0; Ly = a === 1 ? 1 : 0; Lz = a === 2 ? 1 : 0; kind = 0; ii = a; }
    else if (a === 3) { Lx = lnx; Ly = lny; Lz = lnz; kind = 1; }
    else {
      const bi = ((a - 4) / 3) | 0, ek = (a - 4) % 3;
      const p0 = ek * 3, p1 = ((ek + 1) % 3) * 3;
      const ux = _tl[p1] - _tl[p0], uy = _tl[p1 + 1] - _tl[p0 + 1], uz = _tl[p1 + 2] - _tl[p0 + 2];
      // box axis bi x edge
      if (bi === 0) { Lx = 0; Ly = -uz; Lz = uy; } else if (bi === 1) { Lx = uz; Ly = 0; Lz = -ux; } else { Lx = -uy; Ly = ux; Lz = 0; }
      const l = Math.sqrt(Lx * Lx + Ly * Ly + Lz * Lz);
      const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
      if (l < 1e-6 * ul) continue;
      Lx /= l; Ly /= l; Lz /= l; kind = 2; ii = bi; jj = ek;
    }
    const rb = e0 * Math.abs(Lx) + e1 * Math.abs(Ly) + e2 * Math.abs(Lz);
    const s0 = _tl[0] * Lx + _tl[1] * Ly + _tl[2] * Lz, s1 = _tl[3] * Lx + _tl[4] * Ly + _tl[5] * Lz, s2 = _tl[6] * Lx + _tl[7] * Ly + _tl[8] * Lz;
    const tmin = Math.min(s0, s1, s2), tmax = Math.max(s0, s1, s2);
    if (tmin > rb || tmax < -rb) { separated = true; break; }
    // move the box along +L by (tmax + rb) or along -L by (rb - tmin)
    const oPlus = tmax + rb, oMinus = rb - tmin;
    const pen = Math.min(oPlus, oMinus), sgn = oPlus < oMinus ? 1 : -1;
    if (pen < bestPen) { bestPen = pen; bax = Lx * sgn; bay = Ly * sgn; baz = Lz * sgn; bestKind = kind; bestI = ii; bestJ = jj; }
  }

  let nx, ny, nz, pbx, pby, pbz, dist;
  if (separated) {
    // ---- exact closest features (what GJK converges to); ties averaged
    _cf.best = Infinity; _cf.cnt = 0;
    // triangle vertices vs box
    for (let k = 0; k < 3; k++) {
      const x = _tl[k * 3], y = _tl[k * 3 + 1], z = _tl[k * 3 + 2];
      const qx = x < -e0 ? -e0 : x > e0 ? e0 : x, qy = y < -e1 ? -e1 : y > e1 ? e1 : y, qz = z < -e2 ? -e2 : z > e2 ? e2 : z;
      consider(_cf, (x - qx) * (x - qx) + (y - qy) * (y - qy) + (z - qz) * (z - qz), qx, qy, qz, x, y, z);
    }
    // box vertices vs triangle
    for (let v = 0; v < 8; v++) {
      const x = v & 1 ? e0 : -e0, y = v & 2 ? e1 : -e1, z = v & 4 ? e2 : -e2;
      closestPtTriV(x, y, z, _tl[0], _tl[1], _tl[2], _tl[3], _tl[4], _tl[5], _tl[6], _tl[7], _tl[8], _q);
      consider(_cf, (x - _q[0]) * (x - _q[0]) + (y - _q[1]) * (y - _q[1]) + (z - _q[2]) * (z - _q[2]), x, y, z, _q[0], _q[1], _q[2]);
    }
    // box edges vs triangle edges
    const ext = _ext; ext[0] = e0; ext[1] = e1; ext[2] = e2;
    for (let b = 0; b < 12; b++) {
      const ax = BOX_EDGES[b * 3], s1 = BOX_EDGES[b * 3 + 1], s2 = BOX_EDGES[b * 3 + 2];
      const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
      _sa[ax] = -ext[ax]; _sa[a1] = s1 * ext[a1]; _sa[a2] = s2 * ext[a2];
      _sb[ax] = ext[ax]; _sb[a1] = _sa[a1]; _sb[a2] = _sa[a2];
      for (let k = 0; k < 3; k++) {
        const p = k * 3, q = ((k + 1) % 3) * 3;
        segSeg(_sa[0], _sa[1], _sa[2], _sb[0], _sb[1], _sb[2], _tl[p], _tl[p + 1], _tl[p + 2], _tl[q], _tl[q + 1], _tl[q + 2], _ss);
        consider(_cf, _ss[6], _ss[0], _ss[1], _ss[2], _ss[3], _ss[4], _ss[5]);
      }
    }
    const k = 1 / _cf.cnt;
    const sAx = _cf.sAx * k, sAy = _cf.sAy * k, sAz = _cf.sAz * k, sBx = _cf.sBx * k, sBy = _cf.sBy * k, sBz = _cf.sBz * k;
    const d = Math.sqrt(_cf.best);
    dist = d - mg;
    if (dist >= thr) return false;
    nx = sAx - sBx; ny = sAy - sBy; nz = sAz - sBz;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l > 1e-9) { nx /= l; ny /= l; nz /= l; }
    else { nx = lnx; ny = lny; nz = lnz; if (nx * sAx + ny * sAy + nz * sAz < nx * sBx + ny * sBy + nz * sBz) { nx = -nx; ny = -ny; nz = -nz; } }
    pbx = sBx; pby = sBy; pbz = sBz;
  } else {
    // ---- penetrating core: minimum translation axis (EPA on the rounded box)
    nx = bax; ny = bay; nz = baz;
    dist = -(bestPen + mg);
    if (bestKind === 1) {
      // deepest box vertex along -n, projected onto the triangle plane
      const vx = nx >= 0 ? -e0 : e0, vy = ny >= 0 ? -e1 : e1, vz = nz >= 0 ? -e2 : e2;
      pbx = vx + nx * bestPen; pby = vy + ny * bestPen; pbz = vz + nz * bestPen;
    } else if (bestKind === 0) {
      // deepest triangle vertex along +n
      let bi = 0, bv = -Infinity;
      for (let k = 0; k < 3; k++) { const s = _tl[k * 3] * nx + _tl[k * 3 + 1] * ny + _tl[k * 3 + 2] * nz; if (s > bv) { bv = s; bi = k; } }
      pbx = _tl[bi * 3]; pby = _tl[bi * 3 + 1]; pbz = _tl[bi * 3 + 2];
    } else {
      // edge-edge: box edge along axis bestI at the support corner (-n), triangle edge bestJ
      const ext = _ext; ext[0] = e0; ext[1] = e1; ext[2] = e2;
      const cx = nx >= 0 ? -e0 : e0, cy = ny >= 0 ? -e1 : e1, cz = nz >= 0 ? -e2 : e2;
      _sa[0] = cx; _sa[1] = cy; _sa[2] = cz; _sb[0] = cx; _sb[1] = cy; _sb[2] = cz;
      _sa[bestI] = -ext[bestI]; _sb[bestI] = ext[bestI];
      const p = bestJ * 3, q = ((bestJ + 1) % 3) * 3;
      segSeg(_sa[0], _sa[1], _sa[2], _sb[0], _sb[1], _sb[2], _tl[p], _tl[p + 1], _tl[p + 2], _tl[q], _tl[q + 1], _tl[q + 2], _ss);
      pbx = _ss[3]; pby = _ss[4]; pbz = _ss[5];
    }
  }
  // back to world
  out.nx = R[0] * nx + R[1] * ny + R[2] * nz; out.ny = R[3] * nx + R[4] * ny + R[5] * nz; out.nz = R[6] * nx + R[7] * ny + R[8] * nz;
  out.px = bx.cx + R[0] * pbx + R[1] * pby + R[2] * pbz;
  out.py = bx.cy + R[3] * pbx + R[4] * pby + R[5] * pbz;
  out.pz = bx.cz + R[6] * pbx + R[7] * pby + R[8] * pbz;
  out.depth = dist;
  return true;
}

// Closest points between segments p1-q1 and p2-q2 (Ericson 5.1.9).
// out = [c1x, c1y, c1z, c2x, c2y, c2z, squared distance] (no double return:
// a non-inlined call would box it).
const _ss = new Float64Array(7);
function segSeg(p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z, out) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  out[0] = p1x + d1x * s; out[1] = p1y + d1y * s; out[2] = p1z + d1z * s;
  out[3] = p2x + d2x * t; out[4] = p2y + d2y * t; out[5] = p2z + d2z * t;
  const dx = out[0] - out[3], dy = out[1] - out[4], dz = out[2] - out[5];
  out[6] = dx * dx + dy * dy + dz * dz;
}

// ---------------------------------------------------------------------------
// btAdjustInternalEdgeContacts (default flags: front facing, single sided)
// ---------------------------------------------------------------------------
const _ev = new Float64Array(9);
function nearestOnSeg(px, py, pz, ax, ay, az, bx, by, bz, out) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy + dz * dz;
  if (l2 < EPS2_UU) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  let t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  out[0] = ax + dx * t; out[1] = ay + dy * t; out[2] = az + dz * t;
}
// rotate v about (unnormalised) axis by angle a
function rotAxis(axx, axy, axz, a, vx, vy, vz, out) {
  const l = Math.sqrt(axx * axx + axy * axy + axz * axz);
  const ux = axx / l, uy = axy / l, uz = axz / l, c = Math.cos(a), s = Math.sin(a), d = ux * vx + uy * vy + uz * vz;
  out[0] = vx * c + (uy * vz - uz * vy) * s + ux * d * (1 - c);
  out[1] = vy * c + (uz * vx - ux * vz) * s + uy * d * (1 - c);
  out[2] = vz * c + (ux * vy - uy * vx) * s + uz * d * (1 - c);
}
const _nr = new Float64Array(3), _cl = new Float64Array(3);
// btClampNormal: returns true and writes _cl if the normal was clamped
function clampNormal(ex, ey, ez, tnx, tny, tnz, cnx, cny, cnz, corrected) {
  // edgeCross = edge x tri_normal, normalised
  let ecx = ey * tnz - ez * tny, ecy = ez * tnx - ex * tnz, ecz = ex * tny - ey * tnx;
  const l = Math.sqrt(ecx * ecx + ecy * ecy + ecz * ecz); ecx /= l; ecy /= l; ecz /= l;
  const cur = Math.atan2(cnx * ecx + cny * ecy + cnz * ecz, cnx * tnx + cny * tny + cnz * tnz);
  if ((corrected < 0 && cur < corrected) || (corrected >= 0 && cur > corrected)) {
    rotAxis(ex, ey, ez, corrected - cur, cnx, cny, cnz, _cl);
    return true;
  }
  return false;
}

function adjustInternalEdgeContact(pt, mesh, t) {
  const T = mesh.tris, o = t * 9;
  for (let k = 0; k < 9; k++) _ev[k] = T[o + k];
  const v0x = _ev[0], v0y = _ev[1], v0z = _ev[2], v1x = _ev[3], v1y = _ev[4], v1z = _ev[5], v2x = _ev[6], v2y = _ev[7], v2z = _ev[8];
  const tnx = mesh.norms[t * 3], tny = mesh.norms[t * 3 + 1], tnz = mesh.norms[t * 3 + 2];
  const ang = mesh.edgeAngle, fl = mesh.edgeFlags[t];
  const a01 = ang[t * 3], a12 = ang[t * 3 + 1], a20 = ang[t * 3 + 2];
  const px = pt.bx, py = pt.by, pz = pt.bz; // contact = localPointB (mesh at the origin)
  let cnx = pt.nx, cny = pt.ny, cnz = pt.nz;
  { const l = Math.sqrt(cnx * cnx + cny * cny + cnz * cnz); cnx /= l; cny /= l; cnz /= l; }
  const MAX_ANGLE = NO_EDGE; // m_maxEdgeAngleThreshold = SIMD_2_PI
  // closest valid edge
  let best = -1, bestD = Infinity;
  if (Math.abs(a01) < MAX_ANGLE) { nearestOnSeg(px, py, pz, v0x, v0y, v0z, v1x, v1y, v1z, _nr); const d = Math.hypot(px - _nr[0], py - _nr[1], pz - _nr[2]); if (d < bestD) { best = 0; bestD = d; } }
  if (Math.abs(a12) < MAX_ANGLE) { nearestOnSeg(px, py, pz, v1x, v1y, v1z, v2x, v2y, v2z, _nr); const d = Math.hypot(px - _nr[0], py - _nr[1], pz - _nr[2]); if (d < bestD) { best = 1; bestD = d; } }
  if (Math.abs(a20) < MAX_ANGLE) { nearestOnSeg(px, py, pz, v2x, v2y, v2z, v0x, v0y, v0z, _nr); const d = Math.hypot(px - _nr[0], py - _nr[1], pz - _nr[2]); if (d < bestD) { best = 2; bestD = d; } }
  if (best < 0 || bestD >= EDGE_DIST_THRESHOLD) return;
  const angle = best === 0 ? a01 : best === 1 ? a12 : a20;
  let concave = 0;
  if (angle === 0) concave = 1;
  else {
    let ex, ey, ez;
    if (best === 0) { ex = v0x - v1x; ey = v0y - v1y; ez = v0z - v1z; }
    else if (best === 1) { ex = v1x - v2x; ey = v1y - v2y; ez = v1z - v2z; }
    else { ex = v2x - v0x; ey = v2y - v0y; ez = v2z - v0z; }
    const convex = (fl & (best === 0 ? TRI_V0V1_CONVEX : best === 1 ? TRI_V1V2_CONVEX : TRI_V2V0_CONVEX)) !== 0;
    const swap = (fl & (best === 0 ? TRI_V0V1_SWAP : best === 1 ? TRI_V1V2_SWAP : TRI_V2V0_SWAP)) !== 0;
    const sf = convex ? 1 : -1;
    const nAx = sf * tnx, nAy = sf * tny, nAz = sf * tnz;
    rotAxis(ex, ey, ez, angle, tnx, tny, tnz, _nr);
    const sb = swap ? -sf : sf;
    const nBx = sb * _nr[0], nBy = sb * _nr[1], nBz = sb * _nr[2];
    const dA = cnx * nAx + cny * nAy + cnz * nAz, dB = cnx * nBx + cny * nBy + cnz * nBz;
    if (dA < 0 && dB < 0) concave = 1; // m_convexEpsilon = 0
    else if (clampNormal(ex, ey, ez, nAx, nAy, nAz, pt.nx, pt.ny, pt.nz, angle)) {
      if (_cl[0] * tnx + _cl[1] * tny + _cl[2] * tnz > 0) setNormal(pt, _cl[0], _cl[1], _cl[2]);
    }
  }
  if (concave) {
    // snap to the (front-facing) triangle normal unless it opposes the contact normal
    if (tnx * cnx + tny * cny + tnz * cnz < 0) return;
    setNormal(pt, tnx, tny, tnz);
  }
}
// new normal; reproject point B along it from point A
function setNormal(pt, nx, ny, nz) {
  pt.nx = nx; pt.ny = ny; pt.nz = nz;
  pt.bx = pt.ax - nx * pt.dist; pt.by = pt.ay - ny * pt.dist; pt.bz = pt.az - nz * pt.dist;
}

// ---------------------------------------------------------------------------
// Rays vs ball / car boxes
// ---------------------------------------------------------------------------
const _rh = { t: 0, nx: 0, ny: 0, nz: 0, tri: -1 };
const _rn = new Float64Array(3);
function raySphere(fx, fy, fz, dx, dy, dz, c, r, maxT, nOut) {
  const ox = fx - c.x, oy = fy - c.y, oz = fz - c.z;
  const b = ox * dx + oy * dy + oz * dz, cc = ox * ox + oy * oy + oz * oz - r * r;
  let t;
  if (cc <= 0) t = 0; // starts inside
  else {
    if (b > 0) return -1;
    const disc = b * b - cc;
    if (disc < 0) return -1;
    t = -b - Math.sqrt(disc);
  }
  if (t >= maxT) return -1;
  if (t === 0 && cc <= 0) { nOut[0] = -dx; nOut[1] = -dy; nOut[2] = -dz; return 0; }
  const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t, l = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
  nOut[0] = hx / l; nOut[1] = hy / l; nOut[2] = hz / l;
  return t;
}
const _lo = new Float64Array(3), _ld = new Float64Array(3), _he = new Float64Array(3);
function rayBox(fx, fy, fz, dx, dy, dz, car, maxT, nOut) {
  boxFrame(car, _by);
  const R = car.R.e, h = car.half;
  const ox = fx - _by.cx, oy = fy - _by.cy, oz = fz - _by.cz;
  // ray in box space
  const lo = _lo, ld = _ld, he = _he;
  lo[0] = R[0] * ox + R[3] * oy + R[6] * oz; lo[1] = R[1] * ox + R[4] * oy + R[7] * oz; lo[2] = R[2] * ox + R[5] * oy + R[8] * oz;
  ld[0] = R[0] * dx + R[3] * dy + R[6] * dz; ld[1] = R[1] * dx + R[4] * dy + R[7] * dz; ld[2] = R[2] * dx + R[5] * dy + R[8] * dz;
  he[0] = h.x; he[1] = h.y; he[2] = h.z;
  let tmin = 0, tmax = maxT, axis = -1, sgn = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-12) { if (lo[i] < -he[i] || lo[i] > he[i]) return -1; continue; }
    const inv = 1 / ld[i];
    let t1 = (-he[i] - lo[i]) * inv, t2 = (he[i] - lo[i]) * inv, s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sgn = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmin >= maxT) return -1;
  if (axis < 0) { nOut[0] = -dx; nOut[1] = -dy; nOut[2] = -dz; return 0; } // starts inside
  nOut[0] = R[axis] * sgn; nOut[1] = R[3 + axis] * sgn; nOut[2] = R[6 + axis] * sgn;
  return tmin;
}

// ---------------------------------------------------------------------------
// Box vs box: ODE dBoxBox2 as adapted in Bullet's btBoxBoxDetector
// ---------------------------------------------------------------------------
const R1 = new Float64Array(12), R2 = new Float64Array(12);
const _p = new Float64Array(3), _pp = new Float64Array(3), _nC = new Float64Array(3), _nrm = new Float64Array(3);
const _pa = new Float64Array(3), _pb = new Float64Array(3), _ua = new Float64Array(3), _ub = new Float64Array(3);
const _ctr = new Float64Array(3), _nr2 = new Float64Array(3), _nrr = new Float64Array(3), _anr = new Float64Array(3);
const _quad = new Float64Array(8), _ret = new Float64Array(16), _buf = new Float64Array(16);
const _point = new Float64Array(24), _dep = new Float64Array(8), _iret = new Int32Array(8), _A8 = new Float64Array(8), _avail = new Int32Array(8);
const _ab = [0, 0], _AA = new Float64Array(3), _BB = new Float64Array(3), _rect = new Float64Array(2);
const M__PI = 3.14159265;

// dMatrix3 from our row-major M3 (R[4*row + col])
function toDMatrix(e, out) {
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 4 + c] = e[r * 3 + c];
  out[3] = out[7] = out[11] = 0;
}
// dot of column i of A (stride 4) with column j of B
const dDOT44 = (A, i, B, j) => A[i] * B[j] + A[i + 4] * B[j + 4] + A[i + 8] * B[j + 8];
// dot of vector v (stride 1) with column j of A
const dDOT14 = (v, A, j) => v[0] * A[j] + v[1] * A[j + 4] + v[2] * A[j + 8];

function lineClosestApproach(pa, ua, pb, ub, out) {
  const px = pb[0] - pa[0], py = pb[1] - pa[1], pz = pb[2] - pa[2];
  const uaub = ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2];
  const q1 = ua[0] * px + ua[1] * py + ua[2] * pz;
  const q2 = -(ub[0] * px + ub[1] * py + ub[2] * pz);
  let d = 1 - uaub * uaub;
  if (d <= 0.0001) { out[0] = 0; out[1] = 0; }
  else { d = 1 / d; out[0] = (q1 + uaub * q2) * d; out[1] = (uaub * q1 + q2) * d; }
}

function intersectRectQuad2(h, p, ret) {
  let nq = 4, nr = 0;
  let q = p, r = ret, qOff = 0, rOff = 0;
  // q and r are (array, offset) pairs into p / ret / _buf
  let qArr = p, rArr = ret;
  for (let dir = 0; dir <= 1; dir++) {
    for (let sign = -1; sign <= 1; sign += 2) {
      let pq = 0, pr = 0;
      nr = 0;
      for (let i = nq; i > 0; i--) {
        if (sign * qArr[pq + dir] < h[dir]) {
          rArr[pr] = qArr[pq]; rArr[pr + 1] = qArr[pq + 1];
          pr += 2; nr++;
          if (nr & 8) { qArr = rArr; return finishRect(qArr, ret, nr); }
        }
        const nextq = i > 1 ? pq + 2 : 0;
        if ((sign * qArr[pq + dir] < h[dir]) !== (sign * qArr[nextq + dir] < h[dir])) {
          rArr[pr + 1 - dir] = qArr[pq + 1 - dir] + (qArr[nextq + 1 - dir] - qArr[pq + 1 - dir]) / (qArr[nextq + dir] - qArr[pq + dir]) * (sign * h[dir] - qArr[pq + dir]);
          rArr[pr + dir] = sign * h[dir];
          pr += 2; nr++;
          if (nr & 8) { qArr = rArr; return finishRect(qArr, ret, nr); }
        }
        pq += 2;
      }
      qArr = rArr;
      rArr = (qArr === ret) ? _buf : ret;
      nq = nr;
    }
  }
  return finishRect(qArr, ret, nr);
}
function finishRect(q, ret, nr) {
  if (q !== ret) for (let i = 0; i < nr * 2; i++) ret[i] = q[i];
  return nr;
}

function cullPoints2(n, p, m, i0, iret) {
  let a, cx, cy, q;
  if (n === 1) { cx = p[0]; cy = p[1]; }
  else if (n === 2) { cx = 0.5 * (p[0] + p[2]); cy = 0.5 * (p[1] + p[3]); }
  else {
    a = 0; cx = 0; cy = 0;
    for (let i = 0; i < n - 1; i++) {
      q = p[i * 2] * p[i * 2 + 3] - p[i * 2 + 2] * p[i * 2 + 1];
      a += q;
      cx += q * (p[i * 2] + p[i * 2 + 2]);
      cy += q * (p[i * 2 + 1] + p[i * 2 + 3]);
    }
    q = p[n * 2 - 2] * p[1] - p[0] * p[n * 2 - 1];
    if (Math.abs(a + q) > SIMD_EPSILON) a = 1 / (3 * (a + q)); else a = 1e30;
    cx = a * (cx + q * (p[n * 2 - 2] + p[0]));
    cy = a * (cy + q * (p[n * 2 - 1] + p[1]));
  }
  for (let i = 0; i < n; i++) _A8[i] = Math.atan2(p[i * 2 + 1] - cy, p[i * 2] - cx);
  for (let i = 0; i < n; i++) _avail[i] = 1;
  _avail[i0] = 0;
  iret[0] = i0;
  let k = 1;
  for (let j = 1; j < m; j++) {
    a = j * (2 * M__PI / m) + _A8[i0];
    if (a > M__PI) a -= 2 * M__PI;
    let maxdiff = 1e9;
    iret[k] = i0;
    for (let i = 0; i < n; i++) {
      if (_avail[i]) {
        let diff = Math.abs(_A8[i] - a);
        if (diff > M__PI) diff = 2 * M__PI - diff;
        if (diff < maxdiff) { maxdiff = diff; iret[k] = i; }
      }
    }
    _avail[iret[k]] = 0;
    k++;
  }
}

/**
 * dBoxBox2 for the two hitboxes (frames from boxFrame, full half extents).
 * Adds up to 4 points to manifold m (A = box 1). Returns the count.
 */
function boxBox(np, m, f1, e1, h1, f2, e2, h2) {
  const fudge = 1.05;
  toDMatrix(e1, R1); toDMatrix(e2, R2);
  const p1 = _pa, p2 = _pb;
  // NOTE: p1/p2 reuse _pa/_pb only until the edge case recomputes them below
  const p1x = f1.cx, p1y = f1.cy, p1z = f1.cz, p2x = f2.cx, p2y = f2.cy, p2z = f2.cz;
  _p[0] = p2x - p1x; _p[1] = p2y - p1y; _p[2] = p2z - p1z;
  _pp[0] = dDOT14(_p, R1, 0); _pp[1] = dDOT14(_p, R1, 1); _pp[2] = dDOT14(_p, R1, 2);
  const A = _AA, B = _BB;
  A[0] = h1.x; A[1] = h1.y; A[2] = h1.z; B[0] = h2.x; B[1] = h2.y; B[2] = h2.z;
  const R11 = dDOT44(R1, 0, R2, 0), R12 = dDOT44(R1, 0, R2, 1), R13 = dDOT44(R1, 0, R2, 2);
  const R21 = dDOT44(R1, 1, R2, 0), R22 = dDOT44(R1, 1, R2, 1), R23 = dDOT44(R1, 1, R2, 2);
  const R31 = dDOT44(R1, 2, R2, 0), R32 = dDOT44(R1, 2, R2, 1), R33 = dDOT44(R1, 2, R2, 2);
  let Q11 = Math.abs(R11), Q12 = Math.abs(R12), Q13 = Math.abs(R13);
  let Q21 = Math.abs(R21), Q22 = Math.abs(R22), Q23 = Math.abs(R23);
  let Q31 = Math.abs(R31), Q32 = Math.abs(R32), Q33 = Math.abs(R33);

  const S = _sat;
  S.s = -Infinity; S.invert = false; S.code = 0; S.mat = null; S.col = -1;
  // separating axis = u1,u2,u3 then v1,v2,v3
  if (!tstFace(S, _pp[0], A[0] + B[0] * Q11 + B[1] * Q12 + B[2] * Q13, R1, 0, 1)) return 0;
  if (!tstFace(S, _pp[1], A[1] + B[0] * Q21 + B[1] * Q22 + B[2] * Q23, R1, 1, 2)) return 0;
  if (!tstFace(S, _pp[2], A[2] + B[0] * Q31 + B[1] * Q32 + B[2] * Q33, R1, 2, 3)) return 0;
  if (!tstFace(S, dDOT14(_p, R2, 0), A[0] * Q11 + A[1] * Q21 + A[2] * Q31 + B[0], R2, 0, 4)) return 0;
  if (!tstFace(S, dDOT14(_p, R2, 1), A[0] * Q12 + A[1] * Q22 + A[2] * Q32 + B[1], R2, 1, 5)) return 0;
  if (!tstFace(S, dDOT14(_p, R2, 2), A[0] * Q13 + A[1] * Q23 + A[2] * Q33 + B[2], R2, 2, 6)) return 0;
  // separating axis = u_i x v_j (normal relative to box 1)
  const f2e = 1.0e-5;
  Q11 += f2e; Q12 += f2e; Q13 += f2e; Q21 += f2e; Q22 += f2e; Q23 += f2e; Q31 += f2e; Q32 += f2e; Q33 += f2e;
  const pp = _pp;
  if (!tstEdge(S, pp[2] * R21 - pp[1] * R31, A[1] * Q31 + A[2] * Q21 + B[1] * Q13 + B[2] * Q12, 0, -R31, R21, 7)) return 0;
  if (!tstEdge(S, pp[2] * R22 - pp[1] * R32, A[1] * Q32 + A[2] * Q22 + B[0] * Q13 + B[2] * Q11, 0, -R32, R22, 8)) return 0;
  if (!tstEdge(S, pp[2] * R23 - pp[1] * R33, A[1] * Q33 + A[2] * Q23 + B[0] * Q12 + B[1] * Q11, 0, -R33, R23, 9)) return 0;
  if (!tstEdge(S, pp[0] * R31 - pp[2] * R11, A[0] * Q31 + A[2] * Q11 + B[1] * Q23 + B[2] * Q22, R31, 0, -R11, 10)) return 0;
  if (!tstEdge(S, pp[0] * R32 - pp[2] * R12, A[0] * Q32 + A[2] * Q12 + B[0] * Q23 + B[2] * Q21, R32, 0, -R12, 11)) return 0;
  if (!tstEdge(S, pp[0] * R33 - pp[2] * R13, A[0] * Q33 + A[2] * Q13 + B[0] * Q22 + B[1] * Q21, R33, 0, -R13, 12)) return 0;
  if (!tstEdge(S, pp[1] * R11 - pp[0] * R21, A[0] * Q21 + A[1] * Q11 + B[1] * Q33 + B[2] * Q32, -R21, R11, 0, 13)) return 0;
  if (!tstEdge(S, pp[1] * R12 - pp[0] * R22, A[0] * Q22 + A[1] * Q12 + B[0] * Q33 + B[2] * Q31, -R22, R12, 0, 14)) return 0;
  if (!tstEdge(S, pp[1] * R13 - pp[0] * R23, A[0] * Q23 + A[1] * Q13 + B[0] * Q32 + B[1] * Q31, -R23, R13, 0, 15)) return 0;
  const code = S.code;
  if (!code) return 0;

  const normal = _nrm;
  if (S.mat) { normal[0] = S.mat[S.col]; normal[1] = S.mat[S.col + 4]; normal[2] = S.mat[S.col + 8]; }
  else {
    normal[0] = R1[0] * _nC[0] + R1[1] * _nC[1] + R1[2] * _nC[2];
    normal[1] = R1[4] * _nC[0] + R1[5] * _nC[1] + R1[6] * _nC[2];
    normal[2] = R1[8] * _nC[0] + R1[9] * _nC[1] + R1[10] * _nC[2];
  }
  if (S.invert) { normal[0] = -normal[0]; normal[1] = -normal[1]; normal[2] = -normal[2]; }
  const depth = -S.s;

  if (code > 6) {
    // edge-edge
    p1[0] = p1x; p1[1] = p1y; p1[2] = p1z;
    for (let j = 0; j < 3; j++) {
      const sg = dDOT14(normal, R1, j) > 0 ? 1 : -1;
      for (let i = 0; i < 3; i++) p1[i] += sg * A[j] * R1[i * 4 + j];
    }
    p2[0] = p2x; p2[1] = p2y; p2[2] = p2z;
    for (let j = 0; j < 3; j++) {
      const sg = dDOT14(normal, R2, j) > 0 ? -1 : 1;
      for (let i = 0; i < 3; i++) p2[i] += sg * B[j] * R2[i * 4 + j];
    }
    const ca = ((code - 7) / 3) | 0, cb = (code - 7) % 3;
    for (let i = 0; i < 3; i++) { _ua[i] = R1[ca + i * 4]; _ub[i] = R2[cb + i * 4]; }
    lineClosestApproach(p1, _ua, p2, _ub, _ab);
    for (let i = 0; i < 3; i++) p2[i] += _ub[i] * _ab[1];
    np._add(m, -normal[0], -normal[1], -normal[2], p2[0], p2[1], p2[2], -depth, -1);
    return 1;
  }

  // face-something: reference face 'a', incident face 'b'
  let Ra, Rb, Sa, Sb, pax, pay, paz, pbx, pby, pbz;
  if (code <= 3) { Ra = R1; Rb = R2; Sa = A; Sb = B; pax = p1x; pay = p1y; paz = p1z; pbx = p2x; pby = p2y; pbz = p2z; }
  else { Ra = R2; Rb = R1; Sa = B; Sb = A; pax = p2x; pay = p2y; paz = p2z; pbx = p1x; pby = p1y; pbz = p1z; }
  const n2 = _nr2;
  if (code <= 3) { n2[0] = normal[0]; n2[1] = normal[1]; n2[2] = normal[2]; }
  else { n2[0] = -normal[0]; n2[1] = -normal[1]; n2[2] = -normal[2]; }
  _nrr[0] = dDOT14(n2, Rb, 0); _nrr[1] = dDOT14(n2, Rb, 1); _nrr[2] = dDOT14(n2, Rb, 2);
  _anr[0] = Math.abs(_nrr[0]); _anr[1] = Math.abs(_nrr[1]); _anr[2] = Math.abs(_nrr[2]);
  let lanr, a1, a2;
  if (_anr[1] > _anr[0]) {
    if (_anr[1] > _anr[2]) { a1 = 0; lanr = 1; a2 = 2; } else { a1 = 0; a2 = 1; lanr = 2; }
  } else {
    if (_anr[0] > _anr[2]) { lanr = 0; a1 = 1; a2 = 2; } else { a1 = 0; a2 = 1; lanr = 2; }
  }
  const ctr = _ctr;
  const dpx = pbx - pax, dpy = pby - pay, dpz = pbz - paz;
  if (_nrr[lanr] < 0) {
    ctr[0] = dpx + Sb[lanr] * Rb[lanr]; ctr[1] = dpy + Sb[lanr] * Rb[4 + lanr]; ctr[2] = dpz + Sb[lanr] * Rb[8 + lanr];
  } else {
    ctr[0] = dpx - Sb[lanr] * Rb[lanr]; ctr[1] = dpy - Sb[lanr] * Rb[4 + lanr]; ctr[2] = dpz - Sb[lanr] * Rb[8 + lanr];
  }
  const codeN = code <= 3 ? code - 1 : code - 4;
  let code1, code2;
  if (codeN === 0) { code1 = 1; code2 = 2; } else if (codeN === 1) { code1 = 0; code2 = 2; } else { code1 = 0; code2 = 1; }
  const c1 = dDOT14(ctr, Ra, code1), c2 = dDOT14(ctr, Ra, code2);
  let m11 = dDOT44(Ra, code1, Rb, a1), m12 = dDOT44(Ra, code1, Rb, a2);
  let m21 = dDOT44(Ra, code2, Rb, a1), m22 = dDOT44(Ra, code2, Rb, a2);
  {
    const k1 = m11 * Sb[a1], k2 = m21 * Sb[a1], k3 = m12 * Sb[a2], k4 = m22 * Sb[a2];
    _quad[0] = c1 - k1 - k3; _quad[1] = c2 - k2 - k4;
    _quad[2] = c1 - k1 + k3; _quad[3] = c2 - k2 + k4;
    _quad[4] = c1 + k1 + k3; _quad[5] = c2 + k2 + k4;
    _quad[6] = c1 + k1 - k3; _quad[7] = c2 + k2 - k4;
  }
  _rect[0] = Sa[code1]; _rect[1] = Sa[code2];
  const n = intersectRectQuad2(_rect, _quad, _ret);
  if (n < 1) return 0;
  const det1 = 1 / (m11 * m22 - m12 * m21);
  m11 *= det1; m12 *= det1; m21 *= det1; m22 *= det1;
  let cnum = 0;
  for (let j = 0; j < n; j++) {
    const k1 = m22 * (_ret[j * 2] - c1) - m12 * (_ret[j * 2 + 1] - c2);
    const k2 = -m21 * (_ret[j * 2] - c1) + m11 * (_ret[j * 2 + 1] - c2);
    for (let i = 0; i < 3; i++) _point[cnum * 3 + i] = ctr[i] + k1 * Rb[i * 4 + a1] + k2 * Rb[i * 4 + a2];
    _dep[cnum] = Sa[codeN] - (n2[0] * _point[cnum * 3] + n2[1] * _point[cnum * 3 + 1] + n2[2] * _point[cnum * 3 + 2]);
    if (_dep[cnum] >= 0) {
      _ret[cnum * 2] = _ret[j * 2]; _ret[cnum * 2 + 1] = _ret[j * 2 + 1];
      cnum++;
    }
  }
  if (cnum < 1) return 0;
  let maxc = 4;
  if (maxc > cnum) maxc = cnum;
  if (maxc < 1) maxc = 1;
  if (cnum <= maxc) {
    for (let j = 0; j < cnum; j++) emitBoxPoint(np, m, j, code, pax, pay, paz);
  } else {
    let i1 = 0, maxdepth = _dep[0];
    for (let i = 1; i < cnum; i++) if (_dep[i] > maxdepth) { maxdepth = _dep[i]; i1 = i; }
    cullPoints2(cnum, _ret, maxc, i1, _iret);
    for (let j = 0; j < maxc; j++) emitBoxPoint(np, m, _iret[j], code, pax, pay, paz);
    cnum = maxc;
  }
  return cnum;
}

// output.addContactPoint(-normal, point (moved onto box 2's face if box 2 is the reference), -depth)
function emitBoxPoint(np, m, j, code, pax, pay, paz) {
  const normal = _nrm;
  let x = _point[j * 3] + pax, y = _point[j * 3 + 1] + pay, z = _point[j * 3 + 2] + paz;
  if (code >= 4) { x -= normal[0] * _dep[j]; y -= normal[1] * _dep[j]; z -= normal[2] * _dep[j]; }
  np._add(m, -normal[0], -normal[1], -normal[2], x, y, z, -_dep[j], -1);
}

// dBoxBox2 TST macros (face axes, then scaled cross-product axes with the 1.05 fudge)
const _sat = { s: 0, invert: false, code: 0, mat: null, col: -1 };
function tstFace(S, e1v, e2v, mat, col, cc) {
  const s2 = Math.abs(e1v) - e2v;
  if (s2 > 0) return false;
  if (s2 > S.s) { S.s = s2; S.mat = mat; S.col = col; S.invert = e1v < 0; S.code = cc; }
  return true;
}
function tstEdge(S, e1v, e2v, n1, n2, n3, cc) {
  let s2 = Math.abs(e1v) - e2v;
  if (s2 > SIMD_EPSILON) return false;
  const l = Math.sqrt(n1 * n1 + n2 * n2 + n3 * n3);
  if (l > SIMD_EPSILON) {
    s2 /= l;
    if (s2 * 1.05 > S.s) {
      S.s = s2; S.mat = null; _nC[0] = n1 / l; _nC[1] = n2 / l; _nC[2] = n3 / l;
      S.invert = e1v < 0; S.code = cc;
    }
  }
  return true;
}
