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
    this._box = new Float64Array(6);
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
   * btManifoldResult::addContactPoint in the manifold's frame. The caller has
   * written the candidate into this._tmp: normal nx..nz (on B, toward A),
   * point on B bx..bz and depth dist (< 0 penetrating); doubles travel in
   * fields, not arguments, so nothing is boxed. Fires the contact callback
   * and, for arena triangles, the internal-edge correction.
   */
  _add(m, tri) {
    const p = this._tmp, a = m.a, depth = p.dist;
    if (depth > m.threshold) return null;
    p.a = a; p.b = m.b; p.kind = m.kind;
    p.ax = p.bx + p.nx * depth; p.ay = p.by + p.ny * depth; p.az = p.bz + p.nz * depth;
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
    const mesh = this.mesh, thr = BALL_CONTACT_THRESHOLD, r = ball.radius, p = this._tmp;
    const c = ball.pos, e = r + BALL_AABB_EXTRA, box = this._box;
    box[0] = c.x - e; box[1] = c.y - e; box[2] = c.z - e; box[3] = c.x + e; box[4] = c.y + e; box[5] = c.z + e;
    const m = this._manifold(ball, null, KIND_BALL_WORLD, thr);
    const n = mesh.overlapping(box);
    for (let k = 0; k < n; k++) {
      const t = mesh.hits[k];
      if (sphereTriangle(ball, mesh.tris, t * 9, p)) this._add(m, t);
    }
    this._commit(m);
    for (let i = 0; i < PLANES.length; i++) {
      const P = PLANES[i];
      const d = P.nx * (c.x - P.px) + P.ny * (c.y - P.py) + P.nz * (c.z - P.pz) - r;
      if (d >= thr) continue;
      const mp = this._manifold(ball, null, KIND_BALL_WORLD, thr);
      // support vertex c - n r, projected onto the plane
      const k = r + d;
      p.nx = P.nx; p.ny = P.ny; p.nz = P.nz; p.bx = c.x - P.nx * k; p.by = c.y - P.ny * k; p.bz = c.z - P.nz * k; p.dist = d;
      this._add(mp, -1);
      this._commit(mp);
    }
  }

  // ------------------------------------------------------------------ car vs arena
  /** Car hitbox (btBoxShape with margin) vs the mesh (one manifold) and each plane. */
  carWorld(car) {
    const mesh = this.mesh, thr = car.contactThreshold, p = this._tmp, box = this._box;
    boxFrame(car, _bx);
    _bx.thr = thr;
    const h = car.half, R = car.R.e;
    // btBoxShape::getAabb (btTransformAabb): |R| * (core + margin)
    const ex = Math.abs(R[0]) * h.x + Math.abs(R[1]) * h.y + Math.abs(R[2]) * h.z;
    const ey = Math.abs(R[3]) * h.x + Math.abs(R[4]) * h.y + Math.abs(R[5]) * h.z;
    const ez = Math.abs(R[6]) * h.x + Math.abs(R[7]) * h.y + Math.abs(R[8]) * h.z;
    box[0] = _bx.cx - ex; box[1] = _bx.cy - ey; box[2] = _bx.cz - ez; box[3] = _bx.cx + ex; box[4] = _bx.cy + ey; box[5] = _bx.cz + ez;
    const m = this._manifold(car, null, KIND_CAR_WORLD, thr);
    const n = mesh.overlapping(box);
    const T = mesh.tris, N = mesh.norms;
    for (let k = 0; k < n; k++) {
      const t = mesh.hits[k];
      // btConvexTriangleCallback early-out: the box (sharp corners) entirely
      // on one side of the triangle plane beyond the threshold
      const o = t * 9, tnx = N[t * 3], tny = N[t * 3 + 1], tnz = N[t * 3 + 2];
      const rad = h.x * Math.abs(tnx * R[0] + tny * R[3] + tnz * R[6]) + h.y * Math.abs(tnx * R[1] + tny * R[4] + tnz * R[7]) + h.z * Math.abs(tnx * R[2] + tny * R[5] + tnz * R[8]);
      const sd = tnx * (_bx.cx - T[o]) + tny * (_bx.cy - T[o + 1]) + tnz * (_bx.cz - T[o + 2]);
      if (sd - rad > thr || -sd - rad > thr) continue;
      if (boxTriangle(_bx, R, T, N, t, p)) this._add(m, t);
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
      p.nx = P.nx; p.ny = P.ny; p.nz = P.nz; p.bx = vx - P.nx * d; p.by = vy - P.ny * d; p.bz = vz - P.nz * d; p.dist = d;
      this._add(mp, -1);
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
    const p = this._tmp;
    p.dist = dist - inter;
    p.nx = R[0] * nx + R[1] * ny + R[2] * nz; p.ny = R[3] * nx + R[4] * ny + R[5] * nz; p.nz = R[6] * nx + R[7] * ny + R[8] * nz;
    p.bx = _bx.cx + R[0] * px + R[1] * py + R[2] * pz; p.by = _bx.cy + R[3] * px + R[4] * py + R[5] * pz; p.bz = _bx.cz + R[6] * px + R[7] * py + R[8] * pz;
    const m = this._manifold(ball, car, KIND_CAR_BALL, thr);
    this._add(m, -1);
    this._commit(m);
  }

  // ------------------------------------------------------------------ car vs car
  /**
   * btBoxBoxDetector (dBoxBox2, maxc 4) on the hitboxes (half extents with
   * margin). A = carA, B = carB. Skipped unless the broadphase AABBs (each
   * grown by gContactBreakingThreshold, 0.02 bt) overlap.
   */
  carCar(carA, carB) {
    boxFrame(carA, _bx); boxFrame(carB, _by);
    if (!aabbsOverlap(_bx, carA, _by, carB, BROADPHASE_AABB_EXTRA)) return;
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
   * world: { ball, cars }; ray: makeRay() with origin ox..oz, unit direction
   * dx..dz and length len. Fills `out` and returns true on a hit.
   */
  raycast(world, ray, ignore, out) {
    ray.best = ray.len;
    let type = -1, body = null;
    // triangles
    if (this.mesh.raycast(ray, _rh, true)) {
      ray.best = _rh.t; type = HIT_STATIC; out.nx = _rh.nx; out.ny = _rh.ny; out.nz = _rh.nz;
    }
    // planes (two-sided, normal toward the ray origin)
    const fx = ray.ox, fy = ray.oy, fz = ray.oz, dx = ray.dx, dy = ray.dy, dz = ray.dz;
    for (let i = 0; i < PLANES.length; i++) {
      const P = PLANES[i];
      const den = P.nx * dx + P.ny * dy + P.nz * dz;
      if (Math.abs(den) < 1e-12) continue;
      const t = (P.nx * (P.px - fx) + P.ny * (P.py - fy) + P.nz * (P.pz - fz)) / den;
      if (t < 0 || t >= ray.best) continue;
      ray.best = t; type = HIT_STATIC;
      const s = den < 0 ? 1 : -1;
      out.nx = P.nx * s; out.ny = P.ny * s; out.nz = P.nz * s;
    }
    // ball
    const ball = world.ball;
    if (ball && !ball.frozen && raySphere(ray, ball)) {
      type = HIT_BALL; body = ball; out.nx = _rn[0]; out.ny = _rn[1]; out.nz = _rn[2];
    }
    // cars (hitbox)
    const cars = world.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c === ignore || !c.inWorld) continue;
      if (rayBox(ray, c)) { type = HIT_CAR; body = c; out.nx = _rn[0]; out.ny = _rn[1]; out.nz = _rn[2]; }
    }
    if (type < 0) return false;
    if (type === HIT_CAR && body.isDemoed) return false;
    const best = ray.best;
    out.t = best; out.fraction = best / ray.len;
    out.px = fx + dx * best; out.py = fy + dy * best; out.pz = fz + dz * best;
    out.type = type; out.body = body;
    if (body) {
      const rx = out.px - body.pos.x, ry = out.py - body.pos.y, rz = out.pz - body.pos.z, w = body.angVel, v = body.vel;
      out.vx = v.x + w.y * rz - w.z * ry; out.vy = v.y + w.z * rx - w.x * rz; out.vz = v.z + w.x * ry - w.y * rx;
    } else { out.vx = 0; out.vy = 0; out.vz = 0; }
    return true;
  }
}

/** Scratch ray for Narrowphase.raycast / CollisionMesh.raycast (fields start as doubles). */
export function makeRay() {
  return { ox: 0.5, oy: 0.5, oz: 0.5, dx: 0.5, dy: 0.5, dz: 0.5, len: 0.5, best: 0.5 };
}

export function makeRayHit() {
  return { t: 0.5, fraction: 0.5, px: 0.5, py: 0.5, pz: 0.5, nx: 0.5, ny: 0.5, nz: 0.5, type: -1, body: null, vx: 0.5, vy: 0.5, vz: 0.5 };
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

// Car hitbox frame: centre (pos + R offset), core half extents (half -
// margin), margin mg; thr is set by the caller that needs it.
const _bx = { cx: 0.5, cy: 0.5, cz: 0.5, ex: 0.5, ey: 0.5, ez: 0.5, mg: 0.5, thr: 0.5 };
const _by = { cx: 0.5, cy: 0.5, cz: 0.5, ex: 0.5, ey: 0.5, ez: 0.5, mg: 0.5, thr: 0.5 };
function boxFrame(car, out) {
  const R = car.R.e, o = car.hbOffset, p = car.pos;
  out.cx = p.x + R[0] * o.x + R[1] * o.y + R[2] * o.z;
  out.cy = p.y + R[3] * o.x + R[4] * o.y + R[5] * o.z;
  out.cz = p.z + R[6] * o.x + R[7] * o.y + R[8] * o.z;
  out.ex = car.half.x - car.margin; out.ey = car.half.y - car.margin; out.ez = car.half.z - car.margin;
  out.mg = car.margin;
  return out;
}

// btCollisionWorld::updateSingleAabb grows every broadphase AABB by
// gContactBreakingThreshold (0.02 bt).
const BROADPHASE_AABB_EXTRA = 0.02 * 50;
// Broadphase test of two car boxes (frames from boxFrame).
function aabbsOverlap(fa, ca, fb, cb, extra) {
  const Ra = ca.R.e, ha = ca.half, Rb = cb.R.e, hb = cb.half;
  const ax = Math.abs(Ra[0]) * ha.x + Math.abs(Ra[1]) * ha.y + Math.abs(Ra[2]) * ha.z + extra;
  const bx = Math.abs(Rb[0]) * hb.x + Math.abs(Rb[1]) * hb.y + Math.abs(Rb[2]) * hb.z + extra;
  if (Math.abs(fa.cx - fb.cx) > ax + bx) return false;
  const ay = Math.abs(Ra[3]) * ha.x + Math.abs(Ra[4]) * ha.y + Math.abs(Ra[5]) * ha.z + extra;
  const by = Math.abs(Rb[3]) * hb.x + Math.abs(Rb[4]) * hb.y + Math.abs(Rb[5]) * hb.z + extra;
  if (Math.abs(fa.cy - fb.cy) > ay + by) return false;
  const az = Math.abs(Ra[6]) * ha.x + Math.abs(Ra[7]) * ha.y + Math.abs(Ra[8]) * ha.z + extra;
  const bz = Math.abs(Rb[6]) * hb.x + Math.abs(Rb[7]) * hb.y + Math.abs(Rb[8]) * hb.z + extra;
  return Math.abs(fa.cz - fb.cz) <= az + bz;
}

// ---------------------------------------------------------------------------
// Sphere vs triangle (SphereTriangleDetector::collide, RocketSim version)
// ---------------------------------------------------------------------------
// Helpers below take points as small Float64Arrays rather than as separate
// numbers: a double passed to (or returned from) a function V8 does not
// inline is boxed into a new heap object, and these run per triangle.
const _cp = new Float64Array(3), _p3 = new Float64Array(3);

/** Ball vs triangle T[o..o+8]: writes normal, point on the triangle (bx..) and dist into out. */
function sphereTriangle(ball, T, o, out) {
  const c = ball.pos, cx = c.x, cy = c.y, cz = c.z, r = ball.radius, thr = BALL_CONTACT_THRESHOLD;
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
    _p3[0] = cx; _p3[1] = cy; _p3[2] = cz;
    closestPtTri(_p3, T, o, _cp);
    const qx = cx - _cp[0], qy = cy - _cp[1], qz = cz - _cp[2];
    if (qx * qx + qy * qy + qz * qz >= rt * rt) return false;
    px = _cp[0]; py = _cp[1]; pz = _cp[2];
  }
  const qx = cx - px, qy = cy - py, qz = cz - pz, d2 = qx * qx + qy * qy + qz * qz;
  if (d2 >= rt * rt) return false;
  if (d2 > EPS2_UU) {
    const d = Math.sqrt(d2);
    out.nx = qx / d; out.ny = qy / d; out.nz = qz / d; out.dist = d - r;
  } else {
    out.nx = nx; out.ny = ny; out.nz = nz; out.dist = -r;
  }
  out.bx = px; out.by = py; out.bz = pz;
  return true;
}

// Closest point to P (array of 3) on the triangle V[o..o+8] (Ericson,
// Real-Time Collision Detection 5.1.5; same as RocketSim's closestPointTriangle).
function closestPtTri(P, V, o, out) {
  const px = P[0], py = P[1], pz = P[2];
  const ax = V[o], ay = V[o + 1], az = V[o + 2];
  const bx = V[o + 3], by = V[o + 4], bz = V[o + 5];
  const cx = V[o + 6], cy = V[o + 7], cz = V[o + 8];
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
const _q = new Float64Array(3), _seg = new Float64Array(6);
// 12 edges of the box as (axis, sign a, sign b): along `axis`, the other two coords at +-extent
const BOX_EDGES = new Int8Array([
  0, -1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1,
  1, -1, -1, 1, 1, -1, 1, -1, 1, 1, 1, 1,
  2, -1, -1, 2, 1, -1, 2, -1, 1, 2, 1, 1,
]);
const _ext = new Float64Array(3);
// running minimum of closest-feature candidates (ties within tol averaged)
// candidate: v = [squared distance, point on box (3), point on triangle (3)]
const _cf = { best: 0.5, cnt: 0, sAx: 0.5, sAy: 0.5, sAz: 0.5, sBx: 0.5, sBy: 0.5, sBz: 0.5 };
const _cv = new Float64Array(7);
function consider(c, v) {
  const d2 = v[0];
  if (d2 < c.best - 1e-6) { c.best = d2; c.cnt = 1; c.sAx = v[1]; c.sAy = v[2]; c.sAz = v[3]; c.sBx = v[4]; c.sBy = v[5]; c.sBz = v[6]; }
  else if (d2 <= c.best + 1e-6) { c.cnt++; c.sAx += v[1]; c.sAy += v[2]; c.sAz += v[3]; c.sBx += v[4]; c.sBy += v[5]; c.sBz += v[6]; }
}

/**
 * Contact between a box (bx: centre, core half extents, margin mg, threshold
 * thr; rotation R) and triangle t (vertices T, unit normals N). Writes the
 * normal (triangle -> box), the point on the triangle (bx..bz) and the
 * distance from the rounded box surface (dist) into out. False if farther
 * than thr.
 */
function boxTriangle(bx, R, T, N, t, out) {
  const e0 = bx.ex, e1 = bx.ey, e2 = bx.ez, mg = bx.mg, thr = bx.thr, o = t * 9;
  const tnx = N[t * 3], tny = N[t * 3 + 1], tnz = N[t * 3 + 2];
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
    const cv = _cv;
    for (let k = 0; k < 3; k++) {
      const x = _tl[k * 3], y = _tl[k * 3 + 1], z = _tl[k * 3 + 2];
      const qx = x < -e0 ? -e0 : x > e0 ? e0 : x, qy = y < -e1 ? -e1 : y > e1 ? e1 : y, qz = z < -e2 ? -e2 : z > e2 ? e2 : z;
      cv[0] = (x - qx) * (x - qx) + (y - qy) * (y - qy) + (z - qz) * (z - qz);
      cv[1] = qx; cv[2] = qy; cv[3] = qz; cv[4] = x; cv[5] = y; cv[6] = z;
      consider(_cf, cv);
    }
    // box vertices vs triangle
    for (let v = 0; v < 8; v++) {
      const x = v & 1 ? e0 : -e0, y = v & 2 ? e1 : -e1, z = v & 4 ? e2 : -e2;
      _p3[0] = x; _p3[1] = y; _p3[2] = z;
      closestPtTri(_p3, _tl, 0, _q);
      cv[0] = (x - _q[0]) * (x - _q[0]) + (y - _q[1]) * (y - _q[1]) + (z - _q[2]) * (z - _q[2]);
      cv[1] = x; cv[2] = y; cv[3] = z; cv[4] = _q[0]; cv[5] = _q[1]; cv[6] = _q[2];
      consider(_cf, cv);
    }
    // box edges vs triangle edges
    const ext = _ext; ext[0] = e0; ext[1] = e1; ext[2] = e2;
    for (let b = 0; b < 12; b++) {
      const ax = BOX_EDGES[b * 3], s1 = BOX_EDGES[b * 3 + 1], s2 = BOX_EDGES[b * 3 + 2];
      const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
      _seg[ax] = -ext[ax]; _seg[a1] = s1 * ext[a1]; _seg[a2] = s2 * ext[a2];
      _seg[3 + ax] = ext[ax]; _seg[3 + a1] = _seg[a1]; _seg[3 + a2] = _seg[a2];
      for (let k = 0; k < 3; k++) {
        segSeg(_seg, _tl, k * 3, ((k + 1) % 3) * 3, _ss);
        cv[0] = _ss[6]; cv[1] = _ss[0]; cv[2] = _ss[1]; cv[3] = _ss[2]; cv[4] = _ss[3]; cv[5] = _ss[4]; cv[6] = _ss[5];
        consider(_cf, cv);
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
      _seg[0] = cx; _seg[1] = cy; _seg[2] = cz; _seg[3] = cx; _seg[4] = cy; _seg[5] = cz;
      _seg[bestI] = -ext[bestI]; _seg[3 + bestI] = ext[bestI];
      segSeg(_seg, _tl, bestJ * 3, ((bestJ + 1) % 3) * 3, _ss);
      pbx = _ss[3]; pby = _ss[4]; pbz = _ss[5];
    }
  }
  // back to world
  out.nx = R[0] * nx + R[1] * ny + R[2] * nz; out.ny = R[3] * nx + R[4] * ny + R[5] * nz; out.nz = R[6] * nx + R[7] * ny + R[8] * nz;
  out.bx = bx.cx + R[0] * pbx + R[1] * pby + R[2] * pbz;
  out.by = bx.cy + R[3] * pbx + R[4] * pby + R[5] * pbz;
  out.bz = bx.cz + R[6] * pbx + R[7] * pby + R[8] * pbz;
  out.dist = dist;
  return true;
}

// Closest points between segments S[0..2]-S[3..5] and V[p..p+2]-V[q..q+2]
// (Ericson 5.1.9). out = [c1x, c1y, c1z, c2x, c2y, c2z, squared distance].
const _ss = new Float64Array(7);
function segSeg(S, V, p, q, out) {
  const p1x = S[0], p1y = S[1], p1z = S[2], q1x = S[3], q1y = S[4], q1z = S[5];
  const p2x = V[p], p2y = V[p + 1], p2z = V[p + 2], q2x = V[q], q2y = V[q + 1], q2z = V[q + 2];
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
// squared distance from P to the segment V[a..a+2]-V[b..b+2] (closest point in out)
function nearestOnSeg(P, V, a, b, out) {
  const ax = V[a], ay = V[a + 1], az = V[a + 2];
  const dx = V[b] - ax, dy = V[b + 1] - ay, dz = V[b + 2] - az, l2 = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (l2 >= EPS2_UU) {
    t = ((P[0] - ax) * dx + (P[1] - ay) * dy + (P[2] - az) * dz) / l2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
  }
  out[0] = ax + dx * t; out[1] = ay + dy * t; out[2] = az + dz * t;
  const ex = P[0] - out[0], ey = P[1] - out[1], ez = P[2] - out[2];
  out[3] = ex * ex + ey * ey + ez * ez;
}
// rotate v (array of 3) about the (unnormalised) axis A[0..2] by angle A[3]
function rotAxis(A, v, out) {
  const l = Math.sqrt(A[0] * A[0] + A[1] * A[1] + A[2] * A[2]), a = A[3];
  const ux = A[0] / l, uy = A[1] / l, uz = A[2] / l, c = Math.cos(a), s = Math.sin(a);
  const vx = v[0], vy = v[1], vz = v[2], d = ux * vx + uy * vy + uz * vz;
  out[0] = vx * c + (uy * vz - uz * vy) * s + ux * d * (1 - c);
  out[1] = vy * c + (uz * vx - ux * vz) * s + uy * d * (1 - c);
  out[2] = vz * c + (ux * vy - uy * vx) * s + uz * d * (1 - c);
}
const _nr = new Float64Array(4), _cl = new Float64Array(3), _ax = new Float64Array(4), _tn = new Float64Array(3), _cn = new Float64Array(3);
// btClampNormal for edge E (_ax[0..2], corrected angle _ax[3]), triangle normal
// _tn and contact normal _cn: returns true and writes _cl if it was clamped
function clampNormal() {
  const ex = _ax[0], ey = _ax[1], ez = _ax[2], corrected = _ax[3];
  const tnx = _tn[0], tny = _tn[1], tnz = _tn[2], cnx = _cn[0], cny = _cn[1], cnz = _cn[2];
  // edgeCross = edge x tri_normal, normalised
  let ecx = ey * tnz - ez * tny, ecy = ez * tnx - ex * tnz, ecz = ex * tny - ey * tnx;
  const l = Math.sqrt(ecx * ecx + ecy * ecy + ecz * ecz); ecx /= l; ecy /= l; ecz /= l;
  const cur = Math.atan2(cnx * ecx + cny * ecy + cnz * ecz, cnx * tnx + cny * tny + cnz * tnz);
  if ((corrected < 0 && cur < corrected) || (corrected >= 0 && cur > corrected)) {
    _ax[3] = corrected - cur;
    rotAxis(_ax, _cn, _cl);
    return true;
  }
  return false;
}

function adjustInternalEdgeContact(pt, mesh, t) {
  const T = mesh.tris, o = t * 9, V = _ev;
  for (let k = 0; k < 9; k++) V[k] = T[o + k];
  const tnx = mesh.norms[t * 3], tny = mesh.norms[t * 3 + 1], tnz = mesh.norms[t * 3 + 2];
  const ang = mesh.edgeAngle, fl = mesh.edgeFlags[t];
  const a01 = ang[t * 3], a12 = ang[t * 3 + 1], a20 = ang[t * 3 + 2];
  _p3[0] = pt.bx; _p3[1] = pt.by; _p3[2] = pt.bz; // contact = localPointB (mesh at the origin)
  let cnx = pt.nx, cny = pt.ny, cnz = pt.nz;
  { const l = Math.sqrt(cnx * cnx + cny * cny + cnz * cnz); cnx /= l; cny /= l; cnz /= l; }
  const MAX_ANGLE = NO_EDGE; // m_maxEdgeAngleThreshold = SIMD_2_PI
  // closest valid edge (squared distances compare the same way)
  let best = -1, bestD2 = Infinity;
  if (Math.abs(a01) < MAX_ANGLE) { nearestOnSeg(_p3, V, 0, 3, _nr); if (_nr[3] < bestD2) { best = 0; bestD2 = _nr[3]; } }
  if (Math.abs(a12) < MAX_ANGLE) { nearestOnSeg(_p3, V, 3, 6, _nr); if (_nr[3] < bestD2) { best = 1; bestD2 = _nr[3]; } }
  if (Math.abs(a20) < MAX_ANGLE) { nearestOnSeg(_p3, V, 6, 0, _nr); if (_nr[3] < bestD2) { best = 2; bestD2 = _nr[3]; } }
  if (best < 0 || bestD2 >= EDGE_DIST_THRESHOLD * EDGE_DIST_THRESHOLD) return;
  const angle = best === 0 ? a01 : best === 1 ? a12 : a20;
  let concave = 0;
  if (angle === 0) concave = 1;
  else {
    // edge vector (v0 - v1, v1 - v2 or v2 - v0) and its corrected angle
    const i0 = best * 3, i1 = ((best + 1) % 3) * 3;
    _ax[0] = V[i0] - V[i1]; _ax[1] = V[i0 + 1] - V[i1 + 1]; _ax[2] = V[i0 + 2] - V[i1 + 2]; _ax[3] = angle;
    const convex = (fl & (best === 0 ? TRI_V0V1_CONVEX : best === 1 ? TRI_V1V2_CONVEX : TRI_V2V0_CONVEX)) !== 0;
    const swap = (fl & (best === 0 ? TRI_V0V1_SWAP : best === 1 ? TRI_V1V2_SWAP : TRI_V2V0_SWAP)) !== 0;
    const sf = convex ? 1 : -1;
    const nAx = sf * tnx, nAy = sf * tny, nAz = sf * tnz;
    _tn[0] = tnx; _tn[1] = tny; _tn[2] = tnz;
    rotAxis(_ax, _tn, _nr);
    const sb = swap ? -sf : sf;
    const nBx = sb * _nr[0], nBy = sb * _nr[1], nBz = sb * _nr[2];
    const dA = cnx * nAx + cny * nAy + cnz * nAz, dB = cnx * nBx + cny * nBy + cnz * nBz;
    if (dA < 0 && dB < 0) concave = 1; // m_convexEpsilon = 0
    else {
      _tn[0] = nAx; _tn[1] = nAy; _tn[2] = nAz;
      _cn[0] = pt.nx; _cn[1] = pt.ny; _cn[2] = pt.nz;
      if (clampNormal() && _cl[0] * tnx + _cl[1] * tny + _cl[2] * tnz > 0) setNormal(pt, _cl);
    }
  }
  if (concave) {
    // snap to the (front-facing) triangle normal unless it opposes the contact normal
    if (tnx * cnx + tny * cny + tnz * cnz < 0) return;
    _cl[0] = tnx; _cl[1] = tny; _cl[2] = tnz;
    setNormal(pt, _cl);
  }
}
// new normal n (array of 3); reproject point B along it from point A
function setNormal(pt, n) {
  const nx = n[0], ny = n[1], nz = n[2];
  pt.nx = nx; pt.ny = ny; pt.nz = nz;
  pt.bx = pt.ax - nx * pt.dist; pt.by = pt.ay - ny * pt.dist; pt.bz = pt.az - nz * pt.dist;
}

// ---------------------------------------------------------------------------
// Rays vs ball / car boxes
// ---------------------------------------------------------------------------
// Bullet casts rays against convex shapes with btSubsimplexConvexCast, which
// reports nothing for a ray that starts inside the shape (no separating
// direction, zero normal), so a wheel inside another car or the ball sees
// through it.
const _rh = { t: 0, nx: 0, ny: 0, nz: 0, tri: -1 };
const _rn = new Float64Array(3);
// ray: makeRay(); ray.best is the closest hit so far and is lowered on a hit
// (normal in _rn).
function raySphere(ray, ball) {
  const c = ball.pos, r = ball.radius, dx = ray.dx, dy = ray.dy, dz = ray.dz;
  const ox = ray.ox - c.x, oy = ray.oy - c.y, oz = ray.oz - c.z;
  const b = ox * dx + oy * dy + oz * dz, cc = ox * ox + oy * oy + oz * oz - r * r;
  if (cc <= 0 || b > 0) return false; // starts inside, or moving away
  const disc = b * b - cc;
  if (disc < 0) return false;
  const t = -b - Math.sqrt(disc);
  if (t >= ray.best) return false;
  const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t, l = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
  _rn[0] = hx / l; _rn[1] = hy / l; _rn[2] = hz / l;
  ray.best = t;
  return true;
}
const _lo = new Float64Array(3), _ld = new Float64Array(3), _he = new Float64Array(3);
function rayBox(ray, car) {
  boxFrame(car, _by);
  const R = car.R.e, h = car.half, dx = ray.dx, dy = ray.dy, dz = ray.dz;
  const ox = ray.ox - _by.cx, oy = ray.oy - _by.cy, oz = ray.oz - _by.cz;
  // ray in box space
  const lo = _lo, ld = _ld, he = _he;
  lo[0] = R[0] * ox + R[3] * oy + R[6] * oz; lo[1] = R[1] * ox + R[4] * oy + R[7] * oz; lo[2] = R[2] * ox + R[5] * oy + R[8] * oz;
  ld[0] = R[0] * dx + R[3] * dy + R[6] * dz; ld[1] = R[1] * dx + R[4] * dy + R[7] * dz; ld[2] = R[2] * dx + R[5] * dy + R[8] * dz;
  he[0] = h.x; he[1] = h.y; he[2] = h.z;
  const maxT = ray.best;
  let tmin = 0, tmax = maxT, axis = -1, sgn = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-12) { if (lo[i] < -he[i] || lo[i] > he[i]) return false; continue; }
    const inv = 1 / ld[i];
    let t1 = (-he[i] - lo[i]) * inv, t2 = (he[i] - lo[i]) * inv, s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sgn = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  if (tmin >= maxT || axis < 0) return false; // beyond the closest hit, or starts inside
  _rn[0] = R[axis] * sgn; _rn[1] = R[3 + axis] * sgn; _rn[2] = R[6 + axis] * sgn;
  ray.best = tmin;
  return true;
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
const _ab = new Float64Array(2), _paO = new Float64Array(3), _AA = new Float64Array(3), _BB = new Float64Array(3), _rect = new Float64Array(2);
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
  S.e1 = _pp[0]; S.e2 = A[0] + B[0] * Q11 + B[1] * Q12 + B[2] * Q13;
  if (!tstFace(S, R1, 0, 1)) return 0;
  S.e1 = _pp[1]; S.e2 = A[1] + B[0] * Q21 + B[1] * Q22 + B[2] * Q23;
  if (!tstFace(S, R1, 1, 2)) return 0;
  S.e1 = _pp[2]; S.e2 = A[2] + B[0] * Q31 + B[1] * Q32 + B[2] * Q33;
  if (!tstFace(S, R1, 2, 3)) return 0;
  S.e1 = dDOT14(_p, R2, 0); S.e2 = A[0] * Q11 + A[1] * Q21 + A[2] * Q31 + B[0];
  if (!tstFace(S, R2, 0, 4)) return 0;
  S.e1 = dDOT14(_p, R2, 1); S.e2 = A[0] * Q12 + A[1] * Q22 + A[2] * Q32 + B[1];
  if (!tstFace(S, R2, 1, 5)) return 0;
  S.e1 = dDOT14(_p, R2, 2); S.e2 = A[0] * Q13 + A[1] * Q23 + A[2] * Q33 + B[2];
  if (!tstFace(S, R2, 2, 6)) return 0;
  // separating axis = u_i x v_j (normal relative to box 1)
  const f2e = 1.0e-5;
  Q11 += f2e; Q12 += f2e; Q13 += f2e; Q21 += f2e; Q22 += f2e; Q23 += f2e; Q31 += f2e; Q32 += f2e; Q33 += f2e;
  const pp = _pp;
  S.e1 = pp[2] * R21 - pp[1] * R31; S.e2 = A[1] * Q31 + A[2] * Q21 + B[1] * Q13 + B[2] * Q12; S.n1 = 0; S.n2 = -R31; S.n3 = R21;
  if (!tstEdge(S, 7)) return 0;
  S.e1 = pp[2] * R22 - pp[1] * R32; S.e2 = A[1] * Q32 + A[2] * Q22 + B[0] * Q13 + B[2] * Q11; S.n1 = 0; S.n2 = -R32; S.n3 = R22;
  if (!tstEdge(S, 8)) return 0;
  S.e1 = pp[2] * R23 - pp[1] * R33; S.e2 = A[1] * Q33 + A[2] * Q23 + B[0] * Q12 + B[1] * Q11; S.n1 = 0; S.n2 = -R33; S.n3 = R23;
  if (!tstEdge(S, 9)) return 0;
  S.e1 = pp[0] * R31 - pp[2] * R11; S.e2 = A[0] * Q31 + A[2] * Q11 + B[1] * Q23 + B[2] * Q22; S.n1 = R31; S.n2 = 0; S.n3 = -R11;
  if (!tstEdge(S, 10)) return 0;
  S.e1 = pp[0] * R32 - pp[2] * R12; S.e2 = A[0] * Q32 + A[2] * Q12 + B[0] * Q23 + B[2] * Q21; S.n1 = R32; S.n2 = 0; S.n3 = -R12;
  if (!tstEdge(S, 11)) return 0;
  S.e1 = pp[0] * R33 - pp[2] * R13; S.e2 = A[0] * Q33 + A[2] * Q13 + B[0] * Q22 + B[1] * Q21; S.n1 = R33; S.n2 = 0; S.n3 = -R13;
  if (!tstEdge(S, 12)) return 0;
  S.e1 = pp[1] * R11 - pp[0] * R21; S.e2 = A[0] * Q21 + A[1] * Q11 + B[1] * Q33 + B[2] * Q32; S.n1 = -R21; S.n2 = R11; S.n3 = 0;
  if (!tstEdge(S, 13)) return 0;
  S.e1 = pp[1] * R12 - pp[0] * R22; S.e2 = A[0] * Q22 + A[1] * Q12 + B[0] * Q33 + B[2] * Q31; S.n1 = -R22; S.n2 = R12; S.n3 = 0;
  if (!tstEdge(S, 14)) return 0;
  S.e1 = pp[1] * R13 - pp[0] * R23; S.e2 = A[0] * Q23 + A[1] * Q13 + B[0] * Q32 + B[1] * Q31; S.n1 = -R23; S.n2 = R13; S.n3 = 0;
  if (!tstEdge(S, 15)) return 0;
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
    const p = np._tmp;
    p.nx = -normal[0]; p.ny = -normal[1]; p.nz = -normal[2]; p.bx = p2[0]; p.by = p2[1]; p.bz = p2[2]; p.dist = -depth;
    np._add(m, -1);
    return 1;
  }

  // face-something: reference face 'a', incident face 'b'
  let Ra, Rb, Sa, Sb, pax, pay, paz, pbx, pby, pbz;
  if (code <= 3) { Ra = R1; Rb = R2; Sa = A; Sb = B; pax = p1x; pay = p1y; paz = p1z; pbx = p2x; pby = p2y; pbz = p2z; }
  else { Ra = R2; Rb = R1; Sa = B; Sb = A; pax = p2x; pay = p2y; paz = p2z; pbx = p1x; pby = p1y; pbz = p1z; }
  _paO[0] = pax; _paO[1] = pay; _paO[2] = paz;
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
    for (let j = 0; j < cnum; j++) emitBoxPoint(np, m, j, code);
  } else {
    let i1 = 0, maxdepth = _dep[0];
    for (let i = 1; i < cnum; i++) if (_dep[i] > maxdepth) { maxdepth = _dep[i]; i1 = i; }
    cullPoints2(cnum, _ret, maxc, i1, _iret);
    for (let j = 0; j < maxc; j++) emitBoxPoint(np, m, _iret[j], code);
    cnum = maxc;
  }
  return cnum;
}

// output.addContactPoint(-normal, point (moved onto box 2's face if box 2 is the reference), -depth)
function emitBoxPoint(np, m, j, code) {
  const normal = _nrm, p = np._tmp;
  let x = _point[j * 3] + _paO[0], y = _point[j * 3 + 1] + _paO[1], z = _point[j * 3 + 2] + _paO[2];
  if (code >= 4) { x -= normal[0] * _dep[j]; y -= normal[1] * _dep[j]; z -= normal[2] * _dep[j]; }
  p.nx = -normal[0]; p.ny = -normal[1]; p.nz = -normal[2]; p.bx = x; p.by = y; p.bz = z; p.dist = -_dep[j];
  np._add(m, -1);
}

// dBoxBox2 TST macros (face axes, then scaled cross-product axes with the 1.05 fudge)
// expression1 / expression2 (and the edge axis n1..n3) arrive in S's fields
const _sat = { s: 0.5, invert: false, code: 0, mat: null, col: -1, e1: 0.5, e2: 0.5, n1: 0.5, n2: 0.5, n3: 0.5 };
function tstFace(S, mat, col, cc) {
  const e1v = S.e1, s2 = Math.abs(e1v) - S.e2;
  if (s2 > 0) return false;
  if (s2 > S.s) { S.s = s2; S.mat = mat; S.col = col; S.invert = e1v < 0; S.code = cc; }
  return true;
}
function tstEdge(S, cc) {
  const e1v = S.e1, n1 = S.n1, n2 = S.n2, n3 = S.n3;
  let s2 = Math.abs(e1v) - S.e2;
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
