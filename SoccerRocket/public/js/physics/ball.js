// Ball rigid body: a solid sphere (btSphereShape, I = 2/5 m r^2) with linear
// drag. Its contacts with the arena are "special" RocketSim contacts that the
// solver merges into one averaged contact (solver.js), which gives the game's
// bounces (restitution 0.6, friction 0.35 against the arena).
//
// World drives it in RocketSim's order: the ball sleeps (no gravity, no
// integration) while its velocity and spin are exactly zero, e.g. on the
// kickoff spot, until a car touches it; drag is applied before collision
// detection; the extra car-hit impulse arrives through velocityImpulseCache
// and finishPhysicsTick() adds it, then clamps once.
import { V3, Quat, M3 } from './math.js';
import * as K from './constants.js';
import { Narrowphase } from './contacts.js';
import { Solver } from './solver.js';

export class Ball {
  constructor() {
    this.radius = K.BALL_RADIUS;
    this.mass = K.BALL_MASS;
    this.invMass = 1 / this.mass;
    this.invInertia = 1 / (0.4 * this.mass * this.radius * this.radius);
    this.invInertiaLocal = new V3(this.invInertia, this.invInertia, this.invInertia);
    this.friction = K.BALL_FRICTION;
    this.restitution = K.BALL_RESTITUTION;
    this.pos = new V3(0, 0, K.BALL_REST_Z);
    this.vel = new V3();
    this.angVel = new V3();
    this.quat = new Quat();
    this.R = new M3();
    this.extForce = new V3();
    this.extTorque = new V3();
    this.velocityImpulseCache = new V3();
    this.sb = null;
    this.lastImpact = 0;
    this.lastNormal = new V3(0, 0, 1);
    this.frozen = false;   // game-level freeze (countdown, after goals): not simulated at all
    this.sleeping = false; // RocketSim zero-velocity sleep (set by World each tick)
  }

  reset(x = 0, y = 0, z = K.BALL_REST_Z) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    this.velocityImpulseCache.set(0, 0, 0);
  }

  copyFrom(b) {
    this.pos.copy(b.pos); this.vel.copy(b.vel); this.angVel.copy(b.angVel); this.quat.copy(b.quat);
    this.R.fromQuat(this.quat);
    this.frozen = b.frozen;
    return this;
  }

  velAt(rx, ry, rz, out) {
    const w = this.angVel;
    return out.set(this.vel.x + w.y * rz - w.z * ry, this.vel.y + w.z * rx - w.x * rz, this.vel.z + w.x * ry - w.y * rx);
  }

  /** btRigidBody::applyDamping (linear only; v *= (1 - drag)^dt). */
  applyDamping(dt) {
    this.vel.scale(Math.pow(1 - K.BALL_DRAG, dt));
  }

  /** Ball::_FinishPhysicsTick: add the velocity cache (car hits), then clamp once. */
  finishPhysicsTick() {
    const c = this.velocityImpulseCache;
    if (c.x !== 0 || c.y !== 0 || c.z !== 0) { this.vel.add(c); c.set(0, 0, 0); }
    this.vel.clampLength(K.BALL_MAX_SPEED);
    this.angVel.clampLength(K.BALL_MAX_ANG_SPEED);
  }
}

// ---------------------------------------------------------------------------
// Ball-only simulation for prediction (bots, shot detection): the same tick as
// World.step without cars.
// ---------------------------------------------------------------------------
const _ballOnlyListener = { onBallWorld(pt) { pt.special = true; }, onCarWorld() {}, onCarBall() {}, onCarCar() {} };
const _pred = { np: null, mesh: null, solver: new Solver(), ball: new Ball() };

/** One RocketSim tick of a lone ball against the arena. */
export function stepBallAlone(ball, np, solver, dt) {
  if (ball.frozen) return;
  if (ball.vel.x === 0 && ball.vel.y === 0 && ball.vel.z === 0 && ball.angVel.x === 0 && ball.angVel.y === 0 && ball.angVel.z === 0) return; // asleep
  ball.extForce.set(0, 0, K.GRAVITY_Z);
  ball.applyDamping(dt);
  np.begin();
  np.ballWorld(ball);
  solver.begin(dt);
  solver.addBody(ball);
  for (let i = 0; i < np.nManifolds; i++) {
    const m = np.manifolds[i];
    for (let k = 0; k < m.n; k++) solver.addContact(m.pts[k]);
  }
  solver.solve();
  solver.finish();
  ball.finishPhysicsTick();
}

/**
 * Predicts the ball trajectory (ignoring cars). Writes into `out`, an array of
 * { t, x, y, z, vx, vy, vz } slots, reusing them. Returns the slot count used.
 */
export function predictBall(ball, mesh, seconds, step, out) {
  const P = _pred;
  if (P.mesh !== mesh) { P.mesh = mesh; P.np = new Narrowphase(mesh, _ballOnlyListener); }
  const b = P.ball.copyFrom(ball);
  b.frozen = false;
  const sub = Math.max(1, Math.round(step * K.TICK_RATE));
  const n = Math.floor(seconds / step);
  for (let i = 0; i < n; i++) {
    for (let s = 0; s < sub; s++) stepBallAlone(b, P.np, P.solver, K.DT);
    let o = out[i];
    if (!o) o = out[i] = { t: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    o.t = (i + 1) * sub * K.DT;
    o.x = b.pos.x; o.y = b.pos.y; o.z = b.pos.z;
    o.vx = b.vel.x; o.vy = b.vel.y; o.vz = b.vel.z;
  }
  return n;
}

