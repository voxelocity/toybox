// Contact solver: a sequential-impulse (projected Gauss-Seidel) solver with
// split-impulse penetration recovery, configured the way RocketSim runs
// Bullet's btSequentialImpulseConstraintSolver every tick.
//
// Ported from RocketSim (MIT, Copyright (c) 2022 ZealanL) and Bullet Physics
// (zlib, Copyright (c) 2003-2006 Erwin Coumans): btSequentialImpulseConstraintSolver.cpp
// (initSolverBody, setupContactConstraint, setupFrictionConstraint,
// convertContact + RocketSim's convertContactSpecial, the split-impulse and
// velocity iterations, writeBackBodies), btSolverBody.h and
// btTransformUtil::integrateTransform. Units are uu (Bullet's are uu / 50),
// so velocity thresholds are scaled by 50 and squared ones by 2500.
//
// Settings (RocketSim Arena.cpp + btContactSolverInfo defaults): 10 iterations,
// SOR 1, global CFM 0, split impulse always on (penetration threshold 1e30)
// with ERP2 0.8 and turn ERP 0.1, restitution only when the approach speed is
// at least 10 uu/s, warm starting is a no-op (RocketSim's broadphase rebuilds
// every manifold each tick, so contact points never carry an old impulse), one
// friction direction along the relative tangential velocity.
//
// RocketSim changes kept here: contacts with positive distance ("speculative",
// up to ~2 uu apart) get no -dist/dt term, and ball-vs-arena points are
// "special": they still drive split-impulse push-out individually but the
// velocity solve replaces them with ONE averaged contact per body (normal =
// mean of the normals, not renormalised; lever = mean |r|).
//
// Usage per tick (World.step):
//   solver.begin(dt)
//   solver.addBody(body)                for every simulated body (sets body.sb)
//   solver.addContact(point)            for every manifold point (after all bodies)
//   solver.solve()                      special merge + split + velocity iterations
//   solver.finish()                     write velocities (+ ext impulses), apply
//                                       push/turn, integrate transforms
// Bodies expose pos (V3), quat (Quat), R (M3, refreshed by finish), vel,
// angVel, invMass, invInertiaLocal (V3, body-frame diagonal), extForce and
// extTorque (V3, linear / angular ACCELERATIONS integrated this tick).
import { V3 } from './math.js';

export const SOLVER_ITERATIONS = 10;
const ERP2 = 0.8;
const SPLIT_TURN_ERP = 0.1;
const RESTITUTION_VEL_THRESHOLD = 0.2 * 50;       // 0.2 bt/s
const SIMD_EPSILON = 1.1920929e-7;
const LAT_REL_VEL_EPS = SIMD_EPSILON * 2500;      // bt^2/s^2 -> uu^2/s^2
const ANGULAR_MOTION_THRESHOLD = 0.5 * Math.PI / 2;
const SQRT12 = Math.SQRT1_2;

/** Per-body solver state (btSolverBody). */
export class SolverBody {
  constructor() {
    this.body = null;
    this.dyn = false;
    this.invMass = 0;
    this.I = new Float64Array(9); // world-space inverse inertia (symmetric)
    this.vx = 0; this.vy = 0; this.vz = 0; this.wx = 0; this.wy = 0; this.wz = 0;
    this.dvx = 0; this.dvy = 0; this.dvz = 0; this.dwx = 0; this.dwy = 0; this.dwz = 0;
    this.pvx = 0; this.pvy = 0; this.pvz = 0; this.twx = 0; this.twy = 0; this.twz = 0;
    this.fex = 0; this.fey = 0; this.fez = 0; this.tex = 0; this.tey = 0; this.tez = 0;
    // RocketSim btSpecialResolveInfo
    this.nSpecial = 0; this.spFriction = 0; this.spRestitution = 0;
    this.spNx = 0; this.spNy = 0; this.spNz = 0; this.spDist = 0;
  }
}

/** One constraint row (btSolverConstraint). */
class Row {
  constructor() {
    this.A = null; this.B = null;
    this.n1x = 0; this.n1y = 0; this.n1z = 0; this.c1x = 0; this.c1y = 0; this.c1z = 0;
    this.n2x = 0; this.n2y = 0; this.n2z = 0; this.c2x = 0; this.c2y = 0; this.c2z = 0;
    this.aAx = 0; this.aAy = 0; this.aAz = 0; this.aBx = 0; this.aBy = 0; this.aBz = 0;
    this.jac = 0; this.rhs = 0; this.rhsPen = 0; this.lo = 0; this.hi = 0;
    this.applied = 0; this.appliedPush = 0; this.friction = 0;
    this.frictionIndex = 0; this.special = false;
  }
}

// out = I * (x, y, z) for a symmetric 3x3 stored row-major
function mulI(I, x, y, z, out) {
  out.x = I[0] * x + I[1] * y + I[2] * z;
  out.y = I[3] * x + I[4] * y + I[5] * z;
  out.z = I[6] * x + I[7] * y + I[8] * z;
  return out;
}

const _t = new V3(), _p = new V3(), _q = new V3();

// btPlaneSpace1: two unit vectors orthogonal to n (n unit)
function planeSpace1(nx, ny, nz, p) {
  if (Math.abs(nz) > SQRT12) {
    const a = ny * ny + nz * nz, k = 1 / Math.sqrt(a);
    p.set(0, -nz * k, ny * k);
  } else {
    const a = nx * nx + ny * ny, k = 1 / Math.sqrt(a);
    p.set(-ny * k, nx * k, 0);
  }
  return p;
}

/**
 * btTransformUtil::integrateTransform (exponential map), in place on pos/quat.
 */
export function integrateTransform(pos, q, vx, vy, vz, wx, wy, wz, dt) {
  pos.x += vx * dt; pos.y += vy * dt; pos.z += vz * dt;
  const a2 = wx * wx + wy * wy + wz * wz;
  let ang = a2 > SIMD_EPSILON ? Math.sqrt(a2) : 0;
  if (ang * dt > ANGULAR_MOTION_THRESHOLD) ang = ANGULAR_MOTION_THRESHOLD / dt;
  let s;
  if (ang < 0.001) s = 0.5 * dt - (dt * dt * dt) * 0.020833333333 * ang * ang;
  else s = Math.sin(0.5 * ang * dt) / ang;
  const dx = wx * s, dy = wy * s, dz = wz * s, dw = Math.cos(ang * dt * 0.5);
  const x = q.x, y = q.y, z = q.z, w = q.w;
  // dorn * orn0
  const nx = dw * x + dx * w + dy * z - dz * y;
  const ny = dw * y + dy * w + dz * x - dx * z;
  const nz = dw * z + dz * w + dx * y - dy * x;
  const nw = dw * w - dx * x - dy * y - dz * z;
  const l2 = nx * nx + ny * ny + nz * nz + nw * nw;
  if (l2 > SIMD_EPSILON) {
    const il = 1 / Math.sqrt(l2);
    q.x = nx * il; q.y = ny * il; q.z = nz * il; q.w = nw * il;
  }
}

export class Solver {
  constructor() {
    this.dt = 1 / 120;
    this.bodies = [];
    this.nBodies = 0;
    this.fixed = new SolverBody();
    this.rows = [];
    this.nRows = 0;
    this.fric = [];
    this.nFric = 0;
    this.iterations = SOLVER_ITERATIONS;
  }

  begin(dt) {
    this.dt = dt;
    this.nBodies = 0;
    this.nRows = 0;
    this.nFric = 0;
  }

  _row(pool, n) {
    let r = pool[n];
    if (!r) r = pool[n] = new Row();
    return r;
  }

  /** initSolverBody: snapshot velocity and external impulses (F/m dt, I^-1 tau dt). */
  addBody(body) {
    let sb = body.sb;
    if (!sb) sb = body.sb = new SolverBody();
    sb.body = body;
    sb.dyn = true;
    sb.invMass = body.invMass;
    const R = body.R.e, il = body.invInertiaLocal, I = sb.I;
    // I = R diag(il) R^T
    for (let i = 0; i < 3; i++) {
      for (let j = i; j < 3; j++) {
        const v = R[i * 3] * il.x * R[j * 3] + R[i * 3 + 1] * il.y * R[j * 3 + 1] + R[i * 3 + 2] * il.z * R[j * 3 + 2];
        I[i * 3 + j] = v; I[j * 3 + i] = v;
      }
    }
    const dt = this.dt, v = body.vel, w = body.angVel, f = body.extForce, t = body.extTorque;
    sb.vx = v.x; sb.vy = v.y; sb.vz = v.z; sb.wx = w.x; sb.wy = w.y; sb.wz = w.z;
    sb.dvx = sb.dvy = sb.dvz = sb.dwx = sb.dwy = sb.dwz = 0;
    sb.pvx = sb.pvy = sb.pvz = sb.twx = sb.twy = sb.twz = 0;
    sb.fex = f.x * dt; sb.fey = f.y * dt; sb.fez = f.z * dt;
    sb.tex = t.x * dt; sb.tey = t.y * dt; sb.tez = t.z * dt;
    sb.nSpecial = 0; sb.spNx = sb.spNy = sb.spNz = 0; sb.spDist = 0;
    this.bodies[this.nBodies++] = sb;
    return sb;
  }

  /**
   * convertContact for one manifold point. pt: { a (body), b (body|null),
   * ax.. (world point on A), bx.. (world point on B), nx.. (normal on B toward A),
   * dist, friction, restitution, special }. Bodies must have been added.
   */
  addContact(pt) {
    const A = pt.a.sb, B = pt.b ? pt.b.sb : this.fixed;
    const pa = pt.a.pos;
    const r1x = pt.ax - pa.x, r1y = pt.ay - pa.y, r1z = pt.az - pa.z;
    let r2x = 0, r2y = 0, r2z = 0;
    if (pt.b) { const pb = pt.b.pos; r2x = pt.bx - pb.x; r2y = pt.by - pb.y; r2z = pt.bz - pb.z; }
    else { r2x = pt.bx; r2y = pt.by; r2z = pt.bz; } // static: origin at 0
    const row = this._setupContact(A, B, pt.nx, pt.ny, pt.nz, r1x, r1y, r1z, r2x, r2y, r2z, pt.dist, pt.friction, pt.restitution);
    row.special = !!pt.special;
    if (pt.special) {
      // RocketSim: accumulate btSpecialResolveInfo on the dynamic body (A)
      A.nSpecial++;
      A.spFriction = pt.friction; A.spRestitution = pt.restitution;
      A.spNx += pt.nx; A.spNy += pt.ny; A.spNz += pt.nz;
      A.spDist += Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z);
    }
    this._addFriction(row, A, B, pt.nx, pt.ny, pt.nz, r1x, r1y, r1z, r2x, r2y, r2z, pt.friction);
    return row;
  }

  // setupContactConstraint (relaxation = SOR = 1, cfm = 0)
  _setupContact(A, B, nx, ny, nz, r1x, r1y, r1z, r2x, r2y, r2z, dist, friction, restitution) {
    const c = this._row(this.rows, this.nRows++);
    c.A = A; c.B = B;
    // torqueAxis0 = r1 x n, torqueAxis1 = r2 x n
    const t0x = r1y * nz - r1z * ny, t0y = r1z * nx - r1x * nz, t0z = r1x * ny - r1y * nx;
    const t1x = r2y * nz - r2z * ny, t1y = r2z * nx - r2x * nz, t1z = r2x * ny - r2y * nx;
    let denom = 0;
    if (A.dyn) {
      mulI(A.I, t0x, t0y, t0z, _t);
      c.aAx = _t.x; c.aAy = _t.y; c.aAz = _t.z;
      // n . (angA x r1)
      const vx = _t.y * r1z - _t.z * r1y, vy = _t.z * r1x - _t.x * r1z, vz = _t.x * r1y - _t.y * r1x;
      denom += A.invMass + nx * vx + ny * vy + nz * vz;
      c.n1x = nx; c.n1y = ny; c.n1z = nz; c.c1x = t0x; c.c1y = t0y; c.c1z = t0z;
    } else {
      c.aAx = c.aAy = c.aAz = 0; c.n1x = c.n1y = c.n1z = 0; c.c1x = c.c1y = c.c1z = 0;
    }
    if (B.dyn) {
      mulI(B.I, -t1x, -t1y, -t1z, _t);
      c.aBx = _t.x; c.aBy = _t.y; c.aBz = _t.z;
      // n . ((-angB) x r2)
      const ax = -_t.x, ay = -_t.y, az = -_t.z;
      const vx = ay * r2z - az * r2y, vy = az * r2x - ax * r2z, vz = ax * r2y - ay * r2x;
      denom += B.invMass + nx * vx + ny * vy + nz * vz;
      c.n2x = -nx; c.n2y = -ny; c.n2z = -nz; c.c2x = -t1x; c.c2y = -t1y; c.c2z = -t1z;
    } else {
      c.aBx = c.aBy = c.aBz = 0; c.n2x = c.n2y = c.n2z = 0; c.c2x = c.c2y = c.c2z = 0;
    }
    c.jac = 1 / denom;
    c.friction = friction;

    // restitution from the rigid-body velocity (no external impulse)
    let relVel = 0;
    if (A.dyn) {
      const vx = A.vx + (A.wy * r1z - A.wz * r1y), vy = A.vy + (A.wz * r1x - A.wx * r1z), vz = A.vz + (A.wx * r1y - A.wy * r1x);
      relVel += nx * vx + ny * vy + nz * vz;
    }
    if (B.dyn) {
      const vx = B.vx + (B.wy * r2z - B.wz * r2y), vy = B.vy + (B.wz * r2x - B.wx * r2z), vz = B.vz + (B.wx * r2y - B.wy * r2x);
      relVel -= nx * vx + ny * vy + nz * vz;
    }
    let rest = Math.abs(relVel) < RESTITUTION_VEL_THRESHOLD ? 0 : restitution * -relVel;
    if (rest <= 0) rest = 0;

    c.applied = 0; c.appliedPush = 0;
    // velocity error including this tick's external force / torque impulses
    let vel1 = 0, vel2 = 0;
    if (A.dyn) {
      vel1 = c.n1x * (A.vx + A.fex) + c.n1y * (A.vy + A.fey) + c.n1z * (A.vz + A.fez) +
        c.c1x * (A.wx + A.tex) + c.c1y * (A.wy + A.tey) + c.c1z * (A.wz + A.tez);
    }
    if (B.dyn) {
      vel2 = c.n2x * (B.vx + B.fex) + c.n2y * (B.vy + B.fey) + c.n2z * (B.vz + B.fez) +
        c.c2x * (B.wx + B.tex) + c.c2y * (B.wy + B.tey) + c.c2z * (B.wz + B.tez);
    }
    const velErr = rest - (vel1 + vel2);
    // RocketSim: no -dist/dt term for speculative (dist > 0) contacts
    const posErr = dist > 0 ? 0 : -dist * ERP2 / this.dt;
    c.rhs = velErr * c.jac;          // split impulse: velocity and position kept apart
    c.rhsPen = posErr * c.jac;
    c.lo = 0; c.hi = 1e10;
    c.special = false;
    return c;
  }

  // convertContactInner: one friction row along the relative tangential velocity
  _addFriction(contact, A, B, nx, ny, nz, r1x, r1y, r1z, r2x, r2y, r2z, friction) {
    // getVelocityInLocalPointNoDelta: v + extF + (w + extT) x r
    let vx = 0, vy = 0, vz = 0;
    if (A.dyn) {
      const wx = A.wx + A.tex, wy = A.wy + A.tey, wz = A.wz + A.tez;
      vx += A.vx + A.fex + (wy * r1z - wz * r1y); vy += A.vy + A.fey + (wz * r1x - wx * r1z); vz += A.vz + A.fez + (wx * r1y - wy * r1x);
    }
    if (B.dyn) {
      const wx = B.wx + B.tex, wy = B.wy + B.tey, wz = B.wz + B.tez;
      vx -= B.vx + B.fex + (wy * r2z - wz * r2y); vy -= B.vy + B.fey + (wz * r2x - wx * r2z); vz -= B.vz + B.fez + (wx * r2y - wy * r2x);
    }
    const rel = nx * vx + ny * vy + nz * vz;
    let dx = vx - nx * rel, dy = vy - ny * rel, dz = vz - nz * rel;
    const l2 = dx * dx + dy * dy + dz * dz;
    if (l2 > LAT_REL_VEL_EPS) {
      const il = 1 / Math.sqrt(l2); dx *= il; dy *= il; dz *= il;
    } else {
      planeSpace1(nx, ny, nz, _p); dx = _p.x; dy = _p.y; dz = _p.z;
    }
    const f = this._row(this.fric, this.nFric++);
    f.frictionIndex = this.nRows - 1;
    contact.frictionIndex = this.nFric - 1;
    f.A = A; f.B = B;
    f.friction = friction;
    f.applied = 0; f.appliedPush = 0; f.special = false;
    let denom = 0;
    if (A.dyn) {
      const cx = r1y * dz - r1z * dy, cy = r1z * dx - r1x * dz, cz = r1x * dy - r1y * dx;
      f.n1x = dx; f.n1y = dy; f.n1z = dz; f.c1x = cx; f.c1y = cy; f.c1z = cz;
      mulI(A.I, cx, cy, cz, _t);
      f.aAx = _t.x; f.aAy = _t.y; f.aAz = _t.z;
      const ux = _t.y * r1z - _t.z * r1y, uy = _t.z * r1x - _t.x * r1z, uz = _t.x * r1y - _t.y * r1x;
      denom += A.invMass + dx * ux + dy * uy + dz * uz;
    } else {
      f.n1x = f.n1y = f.n1z = 0; f.c1x = f.c1y = f.c1z = 0; f.aAx = f.aAy = f.aAz = 0;
    }
    if (B.dyn) {
      // rel_pos2 x (-dir)
      const cx = -(r2y * dz - r2z * dy), cy = -(r2z * dx - r2x * dz), cz = -(r2x * dy - r2y * dx);
      f.n2x = -dx; f.n2y = -dy; f.n2z = -dz; f.c2x = cx; f.c2y = cy; f.c2z = cz;
      mulI(B.I, cx, cy, cz, _t);
      f.aBx = _t.x; f.aBy = _t.y; f.aBz = _t.z;
      const ax = -_t.x, ay = -_t.y, az = -_t.z;
      const ux = ay * r2z - az * r2y, uy = az * r2x - ax * r2z, uz = ax * r2y - ay * r2x;
      denom += B.invMass + dx * ux + dy * uy + dz * uz;
    } else {
      f.n2x = f.n2y = f.n2z = 0; f.c2x = f.c2y = f.c2z = 0; f.aBx = f.aBy = f.aBz = 0;
    }
    f.jac = 1 / denom;
    // setupFrictionConstraint: rel. velocity with the external FORCE impulse but
    // without the external torque impulse (Bullet quirk, kept)
    let v1 = 0, v2 = 0;
    if (A.dyn) v1 = f.n1x * (A.vx + A.fex) + f.n1y * (A.vy + A.fey) + f.n1z * (A.vz + A.fez) + f.c1x * A.wx + f.c1y * A.wy + f.c1z * A.wz;
    if (B.dyn) v2 = f.n2x * (B.vx + B.fex) + f.n2y * (B.vy + B.fey) + f.n2z * (B.vz + B.fez) + f.c2x * B.wx + f.c2y * B.wy + f.c2z * B.wz;
    f.rhs = -(v1 + v2) * f.jac;
    f.rhsPen = 0;
    f.lo = -friction; f.hi = friction;
  }

  // RocketSim convertContactSpecial: one averaged contact against the fixed body
  _addSpecial(A) {
    const n = A.nSpecial;
    const dist = A.spDist / n;
    const nx = A.spNx / n, ny = A.spNy / n, nz = A.spNz / n;
    const r1x = -nx * dist, r1y = -ny * dist, r1z = -nz * dist;
    const c = this._setupContact(A, this.fixed, nx, ny, nz, r1x, r1y, r1z, 0, 0, 0, dist, A.spFriction, A.spRestitution);
    this._addFriction(c, A, this.fixed, nx, ny, nz, r1x, r1y, r1z, 0, 0, 0, A.spFriction);
    A.nSpecial = 0;
  }

  solve() {
    for (let i = 0; i < this.nBodies; i++) if (this.bodies[i].nSpecial > 0) this._addSpecial(this.bodies[i]);
    const rows = this.rows, fric = this.fric, nr = this.nRows, nf = this.nFric, its = this.iterations;

    // split-impulse (penetration) iterations, all rows incl. special ones
    for (let it = 0; it < its; it++) {
      let resid = 0;
      for (let j = 0; j < nr; j++) {
        const c = rows[j];
        if (!c.rhsPen) continue;
        const A = c.A, B = c.B;
        let d = c.rhsPen;
        d -= (c.n1x * A.pvx + c.n1y * A.pvy + c.n1z * A.pvz + c.c1x * A.twx + c.c1y * A.twy + c.c1z * A.twz) * c.jac;
        d -= (c.n2x * B.pvx + c.n2y * B.pvy + c.n2z * B.pvz + c.c2x * B.twx + c.c2y * B.twy + c.c2z * B.twz) * c.jac;
        const sum = c.appliedPush + d;
        if (sum < c.lo) { d = c.lo - c.appliedPush; c.appliedPush = c.lo; } else c.appliedPush = sum;
        if (A.dyn) {
          const k = A.invMass * d;
          A.pvx += c.n1x * k; A.pvy += c.n1y * k; A.pvz += c.n1z * k;
          A.twx += c.aAx * d; A.twy += c.aAy * d; A.twz += c.aAz * d;
        }
        if (B.dyn) {
          const k = B.invMass * d;
          B.pvx += c.n2x * k; B.pvy += c.n2y * k; B.pvz += c.n2z * k;
          B.twx += c.aBx * d; B.twy += c.aBy * d; B.twz += c.aBz * d;
        }
        const r = d / c.jac;
        if (r * r > resid) resid = r * r;
      }
      if (resid <= 0) break;
    }

    // velocity iterations: normal rows (skipping the original special points),
    // then friction rows bounded by mu * (normal impulse)
    for (let it = 0; it < its; it++) {
      for (let j = 0; j < nr; j++) {
        const c = rows[j];
        if (c.special) continue;
        resolveRow(c, true);
      }
      for (let j = 0; j < nf; j++) {
        const f = fric[j];
        const total = rows[f.frictionIndex].applied;
        if (total > 0) {
          f.lo = -(f.friction * total); f.hi = f.friction * total;
          resolveRow(f, false);
        }
      }
    }
  }

  /** writeBackBodies + integrateTransforms for every solver body. */
  finish() {
    const dt = this.dt;
    for (let i = 0; i < this.nBodies; i++) {
      const sb = this.bodies[i], b = sb.body;
      const vx = sb.vx + sb.dvx, vy = sb.vy + sb.dvy, vz = sb.vz + sb.dvz;
      const wx = sb.wx + sb.dwx, wy = sb.wy + sb.dwy, wz = sb.wz + sb.dwz;
      if (sb.pvx !== 0 || sb.pvy !== 0 || sb.pvz !== 0 || sb.twx !== 0 || sb.twy !== 0 || sb.twz !== 0) {
        integrateTransform(b.pos, b.quat, sb.pvx, sb.pvy, sb.pvz, sb.twx * SPLIT_TURN_ERP, sb.twy * SPLIT_TURN_ERP, sb.twz * SPLIT_TURN_ERP, dt);
      }
      b.vel.set(vx + sb.fex, vy + sb.fey, vz + sb.fez);
      b.angVel.set(wx + sb.tex, wy + sb.tey, wz + sb.tez);
      integrateTransform(b.pos, b.quat, b.vel.x, b.vel.y, b.vel.z, b.angVel.x, b.angVel.y, b.angVel.z, dt);
      b.R.fromQuat(b.quat);
      sb.body = null;
    }
    this.nBodies = 0;
  }
}

// resolveSingleConstraintRow{LowerLimit,Generic}
function resolveRow(c, lowerOnly) {
  const A = c.A, B = c.B;
  let d = c.rhs;
  d -= (c.n1x * A.dvx + c.n1y * A.dvy + c.n1z * A.dvz + c.c1x * A.dwx + c.c1y * A.dwy + c.c1z * A.dwz) * c.jac;
  d -= (c.n2x * B.dvx + c.n2y * B.dvy + c.n2z * B.dvz + c.c2x * B.dwx + c.c2y * B.dwy + c.c2z * B.dwz) * c.jac;
  const sum = c.applied + d;
  if (sum < c.lo) { d = c.lo - c.applied; c.applied = c.lo; }
  else if (!lowerOnly && sum > c.hi) { d = c.hi - c.applied; c.applied = c.hi; }
  else c.applied = sum;
  if (A.dyn) {
    const k = A.invMass * d;
    A.dvx += c.n1x * k; A.dvy += c.n1y * k; A.dvz += c.n1z * k;
    A.dwx += c.aAx * d; A.dwy += c.aAy * d; A.dwz += c.aAz * d;
  }
  if (B.dyn) {
    const k = B.invMass * d;
    B.dvx += c.n2x * k; B.dvy += c.n2y * k; B.dvz += c.n2z * k;
    B.dwx += c.aBx * d; B.dwy += c.aBy * d; B.dwz += c.aBz * d;
  }
}
