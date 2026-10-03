// Car: Rocket League's vehicle model on a rigid box at 120 Hz.
//
// Ported from RocketSim (MIT, Copyright (c) 2022 ZealanL): Car::_PreTickUpdate
// and the functions it calls (src/Sim/Car/Car.cpp), and btVehicleRL
// (src/Sim/btVehicleRL/btVehicleRL.cpp, built on Bullet's btRaycastVehicle,
// zlib), formula for formula and in RocketSim's call order:
//   btVehicleRL::updateVehicleFirst
//     wheel transforms (LAST tick's steer angle), wheel rays (suspension
//     length, relative velocity, extra pushback), friction impulses from
//     LAST tick's tyre friction, engine force and brake (one tick latency)
//   _UpdateWheels      handbrake, throttle / brake, steer angle and tyre
//                      friction for the next tick; sticky force
//   _UpdateAirTorque   (fewer than 3 wheels) flip torque, air control,
//                      air throttle
//   _UpdateJump, _UpdateAutoFlip, _UpdateDoubleJumpOrFlip, _UpdateAutoRoll
//   btVehicleRL::updateVehicleSecond
//     suspension impulses, then the friction impulses computed above
//   _UpdateBoost
// and Car::_PostTickUpdate / _FinishPhysicsTick after the physics step.
//
// Frames: world coordinates and the rotation matrix columns are the same
// numbers as RocketSim's (column 0 forward, column 1 the car's +y, column 2
// up). Rocket League calls the car's +y "right"; SoccerRocket renders the
// world mirrored and calls it "left". RL's steer / yaw / roll inputs mean "to
// the right", i.e. towards +y. So the port runs RocketSim's algebra unchanged
// with rsRight = column 1, and negates steer, yaw and roll as they come in
// (rsControls); SoccerRocket's controls keep "+steer = turn right on screen".
//
// Interface with World (see the Car <-> World contract in world.js):
//   preTick(world, dt)   once per tick before collision detection, on the
//                        start-of-tick transform. Wheel rays go through
//                        world.raycastWheel() (arena, ball, other cars).
//                        What RocketSim applies as impulses or by setting the
//                        velocity changes vel / angVel immediately; what it
//                        applies as forces / torques is accumulated as
//                        accelerations into extForce / extTorque.
//   (collision)          World's callbacks set worldContact (read next
//                        preTick, cleared during preTick like RocketSim),
//                        velocityImpulseCache, isDemoed, ballHitTick.
//   postTick(world, dt)  supersonic state, bump cooldown, last controls.
//   finishPhysicsTick()  velocity cache, then the single velocity clamp.
// Collision shape: RocketSim's Octane box (half extents incl. Bullet margin
// in `half`, `margin`, offset hbOffset), inertia from btBoxShape.
import { V3, Quat, M3, applyInvInertia } from './math.js';
import * as K from './constants.js';
import { makeRayHit, HIT_STATIC, HIT_BALL } from './contacts.js';

const _v = new V3(), _r = new V3(), _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3();
const _fwd = new V3(), _right = new V3(), _up = new V3(), _down = new V3(), _gUp = new V3();
const _hit = makeRayHit();
// Hot paths pass no freshly computed doubles to calls and use no double
// results of calls (V8 boxes them when it does not inline the callee, which
// happens once a big function has used up its inlining budget): vector math
// is written out per component, helpers return scalars through _k.
const _k = new Float64Array(1);
const TRAVEL = K.MAX_SUSPENSION_TRAVEL;
const SIMD_EPSILON_SQ = 1.1920928955078125e-7 * 1.1920928955078125e-7;
// Bullet's btContactSolverInfo::m_erp, used by the extra pushback. (Its
// m_timeStep is the tick's dt once the world has stepped; a freshly created
// RocketSim Arena still has Bullet's default 1/60 on its very first tick.)
const BT_ERP = 0.2;
// RocketSim keeps the car's timers (and boost) in 32-bit floats and compares
// them with float constants, which decides on which tick a jump, flip or boost
// phase ends (24 ticks of 1/120 s add up to >= 0.2 in float, < 0.2 in double).
const f32 = Math.fround;
const T_JUMP_MIN = f32(K.JUMP_MIN_TIME), T_JUMP_MAX = f32(K.JUMP_MAX_TIME);
const T_JUMP_RESET = f32(T_JUMP_MIN + f32(K.JUMP_RESET_TIME_PAD));
const T_DOUBLEJUMP_MAX = f32(K.DOUBLEJUMP_MAX_DELAY);
const T_FLIP_TORQUE = f32(K.FLIP_TORQUE_TIME), T_FLIP_PITCHLOCK = f32(T_FLIP_TORQUE + f32(K.FLIP_PITCHLOCK_EXTRA_TIME));
const T_FLIP_Z_DAMP_START = f32(K.FLIP_Z_DAMP_START), T_FLIP_Z_DAMP_END = f32(K.FLIP_Z_DAMP_END);
const T_BOOST_MIN = f32(K.BOOST_MIN_TIME), T_SUPERSONIC_MAINTAIN = f32(K.SUPERSONIC_MAINTAIN_MAX_TIME);

export function makeControls() {
  return { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false };
}

// LinearPieceCurve::GetOutput (math.js curve) evaluated in place on _k[0]:
// a double passed to or returned from a call V8 does not inline is boxed,
// numbers in a Float64Array are not.
function curveK(pts) {
  const x = _k[0];
  if (x <= pts[0][0]) { _k[0] = pts[0][1]; return; }
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i];
    if (x <= b[0]) {
      const a = pts[i - 1];
      _k[0] = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
      return;
    }
  }
  _k[0] = pts[pts.length - 1][1];
}

// btVector3::safeNormalize
function safeNormalize(v) {
  const l2 = v.x * v.x + v.y * v.y + v.z * v.z;
  if (l2 >= SIMD_EPSILON_SQ) { const l = Math.sqrt(l2); v.x /= l; v.y /= l; v.z /= l; } else v.set(1, 0, 0);
  return v;
}

// (r x n) . I^-1 (r x n) of a body (Bullet's angular jacobian term), in _k[0]
function angularTerm(body, r, n) {
  _d.crossVectors(r, n);
  applyInvInertia(body.R, body.invInertiaLocal, _d, _e);
  _k[0] = _d.dot(_e);
}

// body velocity at offset r from its centre of mass (getVelocityInLocalPoint)
function velocityAt(body, r, out) {
  const v = body.vel, w = body.angVel;
  const x = v.x + w.y * r.z - w.z * r.y, y = v.y + w.z * r.x - w.x * r.z, z = v.z + w.x * r.y - w.y * r.x;
  out.x = x; out.y = y; out.z = z;
  return out;
}

export class Car {
  constructor(id, team, preset = 'octane') {
    this.id = id;
    this.team = team; // 0 blue, 1 orange
    this.name = '';
    const P = K.CAR_PRESETS[preset];
    this.preset = P;
    const HB = P.simHitbox || P.hitbox, OF = P.simOffset || P.offset;
    this.hitbox = new V3(HB[0], HB[1], HB[2]);
    // btBoxShape as RocketSim builds it: the constructor takes Bullet's default
    // margin (0.04 bt = 2 uu) off the half extents, then setSafeMargin lowers
    // the margin to 0.1 * the smallest half extent (1.933 uu) without adding
    // the difference back (RocketSim made setMargin non-virtual). So the core
    // box is half - 2 uu, the margin 1.933 uu, and every query that includes
    // the margin (supports, AABB, box-box, rays, inertia) sees half - 0.067 uu.
    const BT_DEFAULT_MARGIN = 0.04 * 50;
    this.margin = Math.min(BT_DEFAULT_MARGIN, 0.1 * Math.min(HB[0], HB[1], HB[2]) / 2);
    const shrink = BT_DEFAULT_MARGIN - this.margin;
    this.half = new V3(HB[0] / 2 - shrink, HB[1] / 2 - shrink, HB[2] / 2 - shrink); // getHalfExtentsWithMargin
    this.hbOffset = new V3(OF[0], OF[1], OF[2]);
    // Bullet relative contact threshold: 0.02 * (bounding radius + |centre|)
    this.contactThreshold = 0.02 * (this.half.len() + this.hbOffset.len());
    this.mass = K.CAR_MASS;
    this.invMass = 1 / K.CAR_MASS;
    // btBoxShape::calculateLocalInertia (getHalfExtentsWithMargin)
    const L = 2 * this.half.x, W = 2 * this.half.y, H = 2 * this.half.z, m = K.CAR_MASS;
    this.invInertia = new V3(12 / (m * (W * W + H * H)), 12 / (m * (L * L + H * H)), 12 / (m * (L * L + W * W)));
    this.invInertiaLocal = this.invInertia;
    this.friction = K.CAR_COLLISION_FRICTION;
    this.restitution = K.CAR_COLLISION_RESTITUTION;
    // CarConfig::dodgeDeadzone: |yaw| + |pitch| + |roll| needed for a dodge
    this.dodgeDeadzone = K.DODGE_DEADZONE;

    // btWheelInfoRL, in RocketSim's order: 0/1 front, 2/3 back; odd wheels
    // have the connection point's y negated.
    this.wheels = [];
    for (let i = 0; i < 4; i++) {
      const front = i < 2, def = front ? P.front : P.back;
      const rest = def.rest - TRAVEL; // m_suspensionRestLength1
      this.wheels.push({
        front,
        local: new V3(def.x, i % 2 ? -def.y : def.y, def.z), // chassis connection point
        radius: def.radius,
        rest,
        rayLen: rest + TRAVEL + def.radius - K.SUSPENSION_SUBTRACTION,
        pushbackThresh: rest + def.radius - K.SUSPENSION_SUBTRACTION,
        scale: front ? K.SUSPENSION_FORCE_SCALE_FRONT : K.SUSPENSION_FORCE_SCALE_BACK,
        // wheel transform: hard point, steered axle (basis column 1)
        hard: new V3(), axle: new V3(0, 1, 0),
        steerAngle: 0, // m_steerAngle (RocketSim sign: + turns towards +y)
        steer: 0,      // the same angle with SoccerRocket's sign (+ = right), for the view
        // raycast info
        contact: false, contactWorld: false, hitType: -1, hitBody: null,
        point: new V3(), normal: new V3(0, 0, 1),
        susLen: rest, relVel: 0, clippedInv: 1, extraPushback: 0, suspForce: 0,
        // driving parameters set by _updateWheels, used by next tick's friction
        latFriction: 0, longFriction: 0, engineForce: 0, brake: 0,
        impulse: new V3(),
        spin: 0, spinVel: 0, // visual wheel rotation (rad, rad/s * radius)
      });
    }

    this.pos = new V3();
    this.vel = new V3();
    this.angVel = new V3();
    this.quat = new Quat();
    this.R = new M3();
    // solver inputs / outputs (see header)
    this.extForce = new V3();
    this.extTorque = new V3();
    this.velocityImpulseCache = new V3();
    this.worldContact = { hasContact: false, normal: new V3(0, 0, 1) };
    this.inWorld = false; // simulated this tick (not demoed / frozen)
    this.sb = null;       // solver body (solver.js)
    this.controls = makeControls();
    // this tick's controls in RocketSim's conventions (CarControls::ClampFix)
    this.rsControls = { throttle: 0.5, steer: 0.5, pitch: 0.5, yaw: 0.5, roll: 0.5, jump: false, boost: false, handbrake: false };
    this.flipRelTorque = new V3();
    this.dodgeDir = new V3();
    this.events = [];
    this._unlimitedBoost = false;
    this._dt = K.DT;
    this.reset(0, 0, K.CAR_SPAWN_REST_Z, Math.PI / 2);
  }

  /**
   * Car::SetState with a fresh CarState at (x, y, z), yaw. Like RocketSim,
   * the wheels keep their btWheelInfoRL memory (friction, steer, pushback).
   */
  reset(x, y, z, yaw) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.quat.setEuler(yaw, 0, 0);
    this.R.fromQuat(this.quat);
    this.extForce.set(0, 0, 0); this.extTorque.set(0, 0, 0);
    this.velocityImpulseCache.set(0, 0, 0);
    this.boost = K.BOOST_SPAWN_AMOUNT;
    this.isOnGround = true;
    this.numContacts = 4;
    this.isJumping = false; this.hasJumped = false; this.jumpTime = 0;
    this.hasDoubleJumped = false; this.hasFlipped = false; this.isFlipping = false; this.flipTime = 0;
    this.flipRelTorque.set(0, 0, 0);
    this.dodgeDir.set(0, 0, 0);
    this.airTime = 0; this.airTimeSinceJump = 0;
    this.isBoosting = false; this.boostingTime = 0;
    this.handbrakeVal = 0;
    this.isSupersonic = false; this.supersonicTime = 0;
    this.isDemoed = false; this.respawnTimer = 0;
    this.isAutoFlipping = false; this.autoFlipTimer = 0; this.autoFlipTorqueScale = 0;
    this.worldContact.hasContact = false; this.worldContact.normal.set(0, 0, 1);
    this.bumpCooldown = 0; this.bumpOther = -1;
    this.ballHitTick = -10;
    this.lastJump = false; // CarState::lastControls.jump
    this.events.length = 0;
    this.forwardSpeed = 0;
    this.lastLandSpeed = 0;
  }

  get forward() { return this.R.col(0, new V3()); }
  get up() { return this.R.col(2, new V3()); }

  hitboxCenter(out) {
    return this.R.mulV(this.hbOffset, out).add(this.pos);
  }

  /** btRigidBody::applyImpulse(j, r) */
  applyImpulse(j, r) {
    const im = this.invMass;
    this.vel.x += j.x * im; this.vel.y += j.y * im; this.vel.z += j.z * im;
    _a.crossVectors(r, j);
    applyInvInertia(this.R, this.invInertia, _a, _a);
    this.angVel.add(_a);
  }

  /** Car::Demolish: the body stops being simulated from the next tick on. */
  demolish() {
    this.isDemoed = true;
    this.respawnTimer = K.DEMO_RESPAWN_TIME;
    this.isBoosting = false;
  }

  /** Car::_PreTickUpdate (see header). world: raycastWheel, unlimitedBoost, tick. */
  preTick(world, dt) {
    this.events.length = 0;
    if (this.isDemoed) return;
    const c = this.controls, s = this.rsControls;
    let v = +c.throttle || 0; s.throttle = v < -1 ? -1 : v > 1 ? 1 : v;
    v = +c.steer || 0; s.steer = v < -1 ? 1 : v > 1 ? -1 : -v;
    v = +c.pitch || 0; s.pitch = v < -1 ? -1 : v > 1 ? 1 : v;
    v = +c.yaw || 0; s.yaw = v < -1 ? 1 : v > 1 ? -1 : -v;
    v = +c.roll || 0; s.roll = v < -1 ? 1 : v > 1 ? -1 : -v;
    s.jump = !!c.jump; s.boost = !!c.boost; s.handbrake = !!c.handbrake;
    this._unlimitedBoost = !!world.unlimitedBoost;
    this._dt = dt;

    const R = this.R.fromQuat(this.quat);
    const fwd = R.col(0, _fwd), up = R.col(2, _up);
    R.col(1, _right);
    const wheels = this.wheels;

    // ---- btVehicleRL::updateVehicleFirst -----------------------------------
    for (let i = 0; i < 4; i++) this._updateWheelTransform(wheels[i]);
    _down.set(-up.x, -up.y, -up.z);
    for (let i = 0; i < 4; i++) this._rayCast(world, wheels[i]);
    this._calcFrictionImpulses();

    const jumpPressed = s.jump && !this.lastJump;
    let n = 0, nBall = 0;
    for (let i = 0; i < 4; i++) {
      if (wheels[i].contact) { n++; if (wheels[i].hitType === HIT_BALL) nBall++; }
    }
    const wasOnGround = this.isOnGround;
    this.numContacts = n;
    this.isOnGround = n >= 3;
    if (this.isOnGround && !wasOnGround) {
      this._upwardsDir(_gUp);
      this.lastLandSpeed = Math.abs((this.vel.x * _gUp.x + this.vel.y * _gUp.y + this.vel.z * _gUp.z));
      if (nBall < 3) this.events.push('land');
      else if (this.hasJumped || this.hasDoubleJumped || this.hasFlipped) this.events.push('flipReset');
    }
    this.forwardSpeed = (this.vel.x * fwd.x + this.vel.y * fwd.y + this.vel.z * fwd.z);

    this._updateWheels(dt);
    if (n < 3) this._updateAirTorque(n === 0);
    else this.isFlipping = false;
    this._updateJump(dt, jumpPressed);
    this._updateAutoFlip(dt, jumpPressed);
    this._updateDoubleJumpOrFlip(dt, jumpPressed);
    if (s.throttle !== 0 && ((n > 0 && n < 4) || this.worldContact.hasContact)) this._updateAutoRoll();
    this.worldContact.hasContact = false;

    // ---- btVehicleRL::updateVehicleSecond ----------------------------------
    this._updateSuspension(dt);
    this._applyFrictionImpulses(dt);

    this._updateBoost(dt);

    // visual wheel spin
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const v = w.contact ? this.forwardSpeed : w.spinVel * 0.98;
      w.spinVel = v;
      w.spin += (v / w.radius) * dt;
    }
  }

  // btVehicleRL::updateWheelTransform (+ updateWheelTransformsWS): hard point
  // and the wheel basis, rotated about the car's up axis by m_steerAngle.
  _updateWheelTransform(w) {
    const R = this.R;
    R.mulV(w.local, w.hard).add(this.pos);
    const cs = Math.cos(w.steerAngle), sn = Math.sin(w.steerAngle);
    R.mulXYZ(-sn, cs, 0, w.axle); // basis column 1: rsRight * cos - forward * sin
  }

  // btVehicleRL::rayCast
  _rayCast(world, w) {
    const up = _up;
    w.contact = false; w.contactWorld = false; w.hitType = -1; w.hitBody = null;
    if (world.raycastWheel(w.hard, _down, w.rayLen, this, _hit)) {
      const p = w.point, nrm = w.normal;
      p.x = _hit.px; p.y = _hit.py; p.z = _hit.pz;
      nrm.x = _hit.nx; nrm.y = _hit.ny; nrm.z = _hit.nz;
      w.contact = true;
      w.contactWorld = _hit.type === HIT_STATIC;
      w.hitType = _hit.type; w.hitBody = _hit.body;
      const traceLen = (w.hard.x - p.x) * up.x + (w.hard.y - p.y) * up.y + (w.hard.z - p.z) * up.z;
      const len = traceLen - w.radius, lo = w.rest - TRAVEL, hi = w.rest + TRAVEL;
      w.susLen = len < lo ? lo : len > hi ? hi : len;
      const denom = (nrm.x * up.x + nrm.y * up.y + nrm.z * up.z);
      _r.subVectors(p, this.pos);
      velocityAt(this, _r, _v);
      const projVel = (nrm.x * _v.x + nrm.y * _v.y + nrm.z * _v.z);
      if (denom > 0.1) {
        const inv = 1 / denom;
        w.relVel = projVel * inv;
        w.clippedInv = inv;
      } else {
        w.relVel = 0;
        w.clippedInv = 10;
      }
      // m_extraPushback against static objects (keeps its old value otherwise)
      if (w.contactWorld && traceLen < w.pushbackThresh) {
        // resolveSingleCollision(chassis, ground, hit, normal, solverInfo,
        // traceLen - thresh, false), restitution 0, static ground
        angularTerm(this, _r, nrm);
        const positionalError = BT_ERP * (w.pushbackThresh - traceLen) / this._dt;
        let impulse = (positionalError - projVel) / (this.invMass + _k[0]);
        if (impulse < 0) impulse = 0;
        w.extraPushback = impulse / 4;
      }
    } else {
      w.susLen = w.rest + TRAVEL;
      w.relVel = 0;
      w.normal.copy(up);
      w.clippedInv = 1;
      w.extraPushback = 0;
      const L = w.rayLen, h = w.hard;
      w.point.x = h.x + _down.x * L; w.point.y = h.y + _down.y * L; w.point.z = h.z + _down.z * L;
    }
  }

  // btVehicleRL::calcFrictionImpulses, with last tick's wheel parameters
  _calcFrictionImpulses() {
    const frictionScale = this.mass / 3, wheels = this.wheels;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      if (!w.contact) { w.impulse.set(0, 0, 0); continue; }
      const nrm = w.normal, g = w.hitBody; // g: null for static ground
      // axle (with steering) on the contact plane, wheel forward = n x axle
      const wa = w.axle, proj = wa.x * nrm.x + wa.y * nrm.y + wa.z * nrm.z;
      const axle = _a;
      axle.x = wa.x - nrm.x * proj; axle.y = wa.y - nrm.y * proj; axle.z = wa.z - nrm.z * proj;
      safeNormalize(axle);
      const fwdDir = safeNormalize(_b.crossVectors(nrm, axle));
      // resolveSingleBilateral(chassis, contact, ground, contact, 0, axle)
      _r.subVectors(w.point, this.pos);
      velocityAt(this, _r, _v);
      angularTerm(this, _r, axle);
      let jacDiag = this.invMass + _k[0];
      if (g) {
        _c.subVectors(w.point, g.pos);
        _v.sub(velocityAt(g, _c, _c));
        _c.subVectors(w.point, g.pos);
        angularTerm(g, _c, axle);
        jacDiag += g.invMass + _k[0];
      }
      const sideImpulse = -K.BT_CONTACT_DAMPING * (axle.x * _v.x + axle.y * _v.y + axle.z * _v.z) / jacDiag;
      let rollingFriction = 0;
      if (w.engineForce === 0) {
        if (w.brake) {
          // the ground velocity is taken at the CAR-relative offset (Bullet quirk)
          velocityAt(this, _r, _v);
          if (g) _v.sub(velocityAt(g, _r, _c));
          const relVel = _v.x * fwdDir.x + _v.y * fwdDir.y + _v.z * fwdDir.z;
          const rf = -relVel * K.ROLLING_FRICTION_SCALE_MAGIC, b = w.brake;
          rollingFriction = rf < -b ? -b : rf > b ? b : rf;
        }
      } else {
        rollingFriction = -w.engineForce / frictionScale;
      }
      const lon = rollingFriction * w.longFriction, lat = sideImpulse * w.latFriction;
      const imp = w.impulse;
      imp.x = (fwdDir.x * lon + axle.x * lat) * frictionScale;
      imp.y = (fwdDir.y * lon + axle.y * lat) * frictionScale;
      imp.z = (fwdDir.z * lon + axle.z * lat) * frictionScale;
    }
  }

  // btVehicleRL::getUpwardsDirFromWheelContacts
  _upwardsDir(out) {
    out.set(0, 0, 0);
    for (let i = 0; i < 4; i++) { const w = this.wheels[i]; if (w.contact) out.add(w.normal); }
    if (out.x === 0 && out.y === 0 && out.z === 0) return out.copy(_up);
    return safeNormalize(out);
  }

  // Car::_UpdateWheels
  _updateWheels(dt) {
    const s = this.rsControls, wheels = this.wheels;
    const forwardSpeed = this.forwardSpeed, absForwardSpeed = Math.abs(forwardSpeed);
    let wheelsHaveWorldContact = false;
    for (let i = 0; i < 4; i++) wheelsHaveWorldContact = wheelsHaveWorldContact || wheels[i].contactWorld;

    // handbrake value from input
    const dtf = f32(dt);
    if (s.handbrake) this.handbrakeVal = f32(this.handbrakeVal + f32(K.POWERSLIDE_RISE_RATE * dtf));
    else this.handbrakeVal = f32(this.handbrakeVal - f32(K.POWERSLIDE_FALL_RATE * dtf));
    if (this.handbrakeVal < 0) this.handbrakeVal = 0; else if (this.handbrakeVal > 1) this.handbrakeVal = 1;

    let realThrottle = s.throttle, realBrake = 0;
    if (s.boost && (this.boost > 0 || this._unlimitedBoost)) realThrottle = 1;

    // throttle / brake forces
    _k[0] = absForwardSpeed; curveK(K.DRIVE_SPEED_TORQUE_CURVE);
    let driveSpeedScale = _k[0];
    let engineThrottle = realThrottle;
    if (!s.handbrake) { // powersliding: the input throttle is used as is
      if (Math.abs(realThrottle) >= K.THROTTLE_DEADZONE) {
        // RS_SGN(realThrottle) != RS_SGN(forwardSpeed)
        const st = realThrottle > 0 ? 1 : realThrottle < 0 ? -1 : 0, sv = forwardSpeed > 0 ? 1 : forwardSpeed < 0 ? -1 : 0;
        if (absForwardSpeed > K.STOPPING_FORWARD_VEL && st !== sv) {
          // full brake when driving against the motion
          realBrake = 1;
          if (absForwardSpeed > K.BRAKING_NO_THROTTLE_SPEED_THRESH) engineThrottle = 0;
        }
      } else {
        // coasting; full brake when coasting very slowly
        engineThrottle = 0;
        realBrake = absForwardSpeed < K.STOPPING_FORWARD_VEL ? 1 : K.COASTING_BRAKE_FACTOR;
      }
    }
    if (this.numContacts < 3) driveSpeedScale /= 4;
    const engineForce = engineThrottle * K.THROTTLE_TORQUE_AMOUNT * driveSpeedScale;
    const brakeForce = realBrake * K.BRAKE_TORQUE_AMOUNT;
    for (let i = 0; i < 4; i++) { wheels[i].engineForce = engineForce; wheels[i].brake = brakeForce; }

    // steering
    _k[0] = absForwardSpeed; curveK(K.STEER_ANGLE_CURVE);
    let steerAngle = _k[0];
    if (this.handbrakeVal) {
      _k[0] = absForwardSpeed; curveK(K.POWERSLIDE_STEER_ANGLE_CURVE);
      steerAngle += (_k[0] - steerAngle) * this.handbrakeVal;
    }
    steerAngle *= s.steer;
    wheels[0].steerAngle = wheels[1].steerAngle = steerAngle;
    wheels[0].steer = wheels[1].steer = -steerAngle;

    // tyre friction (for wheels touching something)
    const hb = this.handbrakeVal;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      if (!w.contact) continue;
      const latDir = w.axle, longDir = _b.crossVectors(latDir, w.normal);
      _r.subVectors(w.hard, this.pos);
      velocityAt(this, _r, _v);
      const baseFriction = Math.abs((_v.x * latDir.x + _v.y * latDir.y + _v.z * latDir.z));
      let frictionCurveInput = 0;
      // significant friction results in lateral slip
      if (baseFriction > 5) frictionCurveInput = baseFriction / (Math.abs((_v.x * longDir.x + _v.y * longDir.y + _v.z * longDir.z)) + baseFriction);
      _k[0] = frictionCurveInput; curveK(K.LAT_FRICTION_CURVE);
      let latFriction = _k[0];
      _k[0] = frictionCurveInput; curveK(K.LONG_FRICTION_CURVE);
      let longFriction = _k[0];
      if (hb) {
        latFriction *= (K.HANDBRAKE_LAT_FRICTION_FACTOR - 1) * hb + 1;
        _k[0] = frictionCurveInput; curveK(K.HANDBRAKE_LONG_FRICTION_CURVE);
        longFriction *= (_k[0] - 1) * hb + 1;
      } else {
        longFriction = 1;
      }
      if (realThrottle === 0) {
        // not sticky: scale friction down by how steep the surface is
        _k[0] = w.normal.z; curveK(K.NON_STICKY_FRICTION_CURVE);
        const nonStickyScale = _k[0];
        latFriction *= nonStickyScale;
        longFriction *= nonStickyScale;
      }
      w.latFriction = latFriction;
      w.longFriction = longFriction;
    }

    // sticky force if at least one wheel touches the world
    if (wheelsHaveWorldContact) {
      const upwardsDir = this._upwardsDir(_gUp);
      const fullStick = realThrottle !== 0 || absForwardSpeed > K.STOPPING_FORWARD_VEL;
      let stickyForceScale = K.STICKY_FORCE_BASE;
      if (fullStick) stickyForceScale += 1 - Math.abs(upwardsDir.z);
      const a = stickyForceScale * K.GRAVITY_Z, F = this.extForce;
      F.x += upwardsDir.x * a; F.y += upwardsDir.y * a; F.z += upwardsDir.z * a;
    }
  }

  // Car::_UpdateAirTorque: flip torque, air control (if no wheel touches), air throttle
  _updateAirTorque(updateAirControl) {
    const s = this.rsControls, Tq = this.extTorque, fwd = _fwd, right = _right, up = _up;
    // dirPitch_right = -right, dirYaw_up = up, dirRoll_forward = -forward
    let doAirControl = false;
    if (this.isFlipping) this.isFlipping = this.hasFlipped && this.flipTime < T_FLIP_TORQUE;
    if (this.isFlipping) {
      const rt = this.flipRelTorque;
      if (!rt.isZero()) {
        // flip cancel check
        let pitchScale = 1;
        if (rt.y !== 0 && s.pitch !== 0 && (rt.y > 0) === (s.pitch > 0)) {
          pitchScale = 1 - Math.min(Math.abs(s.pitch), 1);
          doAirControl = true;
        }
        // angular acceleration basis * (relTorque * (FLIP_TORQUE_X, FLIP_TORQUE_Y, 0))
        const tx = rt.x * K.FLIP_TORQUE_X, ty = rt.y * pitchScale * K.FLIP_TORQUE_Y;
        Tq.x += fwd.x * tx + right.x * ty;
        Tq.y += fwd.y * tx + right.y * ty;
        Tq.z += fwd.z * tx + right.z * ty;
      } else {
        doAirControl = true; // stall
      }
    } else {
      doAirControl = true;
    }
    doAirControl = doAirControl && !this.isAutoFlipping && updateAirControl;

    if (doAirControl) {
      let pitchTorqueScale = 1;
      let tx = 0, ty = 0, tz = 0;
      if (s.pitch || s.yaw || s.roll) {
        if (this.isFlipping) pitchTorqueScale = 0;
        else if (this.hasFlipped && this.flipTime < T_FLIP_PITCHLOCK) pitchTorqueScale = 0; // pitch lock after a flip
        const p = s.pitch * pitchTorqueScale * K.AIR_TORQUE.pitch, y = s.yaw * K.AIR_TORQUE.yaw, r = s.roll * K.AIR_TORQUE.roll;
        tx = -right.x * p + up.x * y - fwd.x * r;
        ty = -right.y * p + up.y * y - fwd.y * r;
        tz = -right.z * p + up.z * y - fwd.z * r;
      }
      const w = this.angVel;
      const dampPitch = -(right.x * w.x + right.y * w.y + right.z * w.z) * K.AIR_DAMPING.pitch * (1 - Math.abs(s.pitch * pitchTorqueScale));
      const dampYaw = (up.x * w.x + up.y * w.y + up.z * w.z) * K.AIR_DAMPING.yaw * (1 - Math.abs(s.yaw));
      const dampRoll = -(fwd.x * w.x + fwd.y * w.y + fwd.z * w.z) * K.AIR_DAMPING.roll;
      const S = K.CAR_TORQUE_SCALE;
      Tq.x += (tx - (up.x * dampYaw - right.x * dampPitch - fwd.x * dampRoll)) * S;
      Tq.y += (ty - (up.y * dampYaw - right.y * dampPitch - fwd.y * dampRoll)) * S;
      Tq.z += (tz - (up.z * dampYaw - right.z * dampPitch - fwd.z * dampRoll)) * S;
    }
    if (s.throttle !== 0) {
      const a = s.throttle * K.THROTTLE_AIR_ACCEL, F = this.extForce;
      F.x += fwd.x * a; F.y += fwd.y * a; F.z += fwd.z * a;
    }
  }

  // Car::_UpdateJump
  _updateJump(dt, jumpPressed) {
    if (this.isOnGround && !this.isJumping) {
      // keep hasJumped for a moment after a minimum-time jump, we might still be leaving the ground
      if (!(this.hasJumped && this.jumpTime < T_JUMP_RESET)) {
        this.hasJumped = false;
        this.jumpTime = 0;
      }
    }
    if (this.isJumping) {
      this.isJumping = this.jumpTime < T_JUMP_MIN || (this.rsControls.jump && this.jumpTime < T_JUMP_MAX);
    } else if (this.isOnGround && jumpPressed) {
      this.isJumping = true;
      this.jumpTime = 0;
      const v = this.vel, a = K.JUMP_IMMEDIATE_VEL;
      v.x += _up.x * a; v.y += _up.y * a; v.z += _up.z * a;
      this.events.push('jump');
    }
    if (this.isJumping) {
      this.hasJumped = true;
      // extra long-jump force
      const a = K.JUMP_ACCEL * (this.jumpTime < T_JUMP_MIN ? K.JUMP_PRE_MIN_ACCEL_SCALE : 1), F = this.extForce;
      F.x += _up.x * a; F.y += _up.y * a; F.z += _up.z * a;
    }
    if (this.isJumping || this.hasJumped) this.jumpTime = f32(this.jumpTime + f32(dt));
  }

  // Car::_UpdateAutoFlip: jump while upside down on a surface rolls the car over
  _updateAutoFlip(dt, jumpPressed) {
    const wc = this.worldContact;
    if (jumpPressed && wc.hasContact && wc.normal.z > K.AUTOFLIP_NORMZ_THRESH) {
      // Angle::FromRotMat roll (btMatrix3x3::getEulerYPR, negated)
      const e = this.R.e, roll = -Math.atan2(e[7], e[8]), absRoll = Math.abs(roll);
      if (absRoll > K.AUTOFLIP_ROLL_THRESH) {
        this.autoFlipTimer = f32(K.AUTOFLIP_TIME * (absRoll / Math.PI));
        this.autoFlipTorqueScale = roll > 0 ? 1 : -1;
        this.isAutoFlipping = true;
        const v = this.vel, a = -K.AUTOFLIP_IMPULSE;
        v.x += _up.x * a; v.y += _up.y * a; v.z += _up.z * a;
        this.events.push('autoflip');
      }
    }
    if (this.isAutoFlipping) {
      if (this.autoFlipTimer <= 0) {
        this.isAutoFlipping = false;
        this.autoFlipTimer = 0;
      } else {
        const w = this.angVel, a = K.AUTOFLIP_TORQUE * this.autoFlipTorqueScale * dt;
        w.x += _fwd.x * a; w.y += _fwd.y * a; w.z += _fwd.z * a;
        this.autoFlipTimer = f32(this.autoFlipTimer - f32(dt));
      }
    }
  }

  // Car::_UpdateDoubleJumpOrFlip
  _updateDoubleJumpOrFlip(dt, jumpPressed) {
    const s = this.rsControls;
    const tickTimeScale = dt * 120, dtf = f32(dt);
    if (this.isOnGround) {
      this.hasDoubleJumped = false;
      this.hasFlipped = false;
      this.airTime = 0;
      this.airTimeSinceJump = 0;
      this.flipTime = 0;
    } else {
      this.airTime = f32(this.airTime + dtf);
      if (this.hasJumped && !this.isJumping) this.airTimeSinceJump = f32(this.airTimeSinceJump + dtf);
      else this.airTimeSinceJump = 0;

      if (jumpPressed && this.airTimeSinceJump < T_DOUBLEJUMP_MAX) {
        const inputMagnitude = Math.abs(s.yaw) + Math.abs(s.pitch) + Math.abs(s.roll);
        const isFlipInput = inputMagnitude >= this.dodgeDeadzone;
        const canUse = !this.hasDoubleJumped && !this.hasFlipped && !this.isAutoFlipping;
        if (canUse) {
          if (isFlipInput) {
            this.flipTime = 0;
            this.hasFlipped = true;
            this.isFlipping = true;
            this._dodge(tickTimeScale);
            this.events.push('flip');
          } else {
            const v = this.vel, a = K.JUMP_IMMEDIATE_VEL;
            v.x += _up.x * a; v.y += _up.y * a; v.z += _up.z * a;
            this.hasDoubleJumped = true;
            this.events.push('doubleJump');
          }
        }
      }
    }
    if (this.isFlipping) {
      this.flipTime = f32(this.flipTime + dtf);
      if (this.flipTime <= T_FLIP_TORQUE &&
        this.flipTime >= T_FLIP_Z_DAMP_START && (this.vel.z < 0 || this.flipTime < T_FLIP_Z_DAMP_END)) {
        this.vel.z *= Math.pow(1 - K.FLIP_Z_DAMP_120, tickTimeScale);
      }
    } else if (this.hasFlipped) {
      // flip time keeps counting for the pitch lock after the flip
      this.flipTime = f32(this.flipTime + dtf);
    }
  }

  // Dodge start: flip torque direction and the initial dodge impulse
  // (RocketSim, after RLUtilities). Uses the 3D forward speed at the start of the tick.
  _dodge(tickTimeScale) {
    const s = this.rsControls, d = this.dodgeDir, forwardSpeed = this.forwardSpeed;
    const forwardSpeedRatio = Math.abs(forwardSpeed) / K.CAR_MAX_SPEED;
    d.set(-s.pitch, s.yaw + s.roll, 0);
    if (Math.abs(s.yaw + s.roll) < 0.1 && Math.abs(s.pitch) < 0.1) d.set(0, 0, 0);
    else safeNormalize(d);
    this.flipRelTorque.set(-d.y / tickTimeScale, d.x / tickTimeScale, 0);
    if (Math.abs(d.x) < 0.1) d.x = 0;
    if (Math.abs(d.y) < 0.1) d.y = 0;
    if (d.x * d.x + d.y * d.y < SIMD_EPSILON_SQ) return; // fuzzyZero
    let shouldDodgeBackwards;
    if (Math.abs(forwardSpeed) < 100) shouldDodgeBackwards = d.x < 0;
    else shouldDodgeBackwards = (d.x >= 0) !== (forwardSpeed >= 0);
    let ix = d.x * K.FLIP_INITIAL_VEL_SCALE, iy = d.y * K.FLIP_INITIAL_VEL_SCALE;
    const maxSpeedScaleX = shouldDodgeBackwards ? K.FLIP_BACKWARD_IMPULSE_MAX_SPEED_SCALE : K.FLIP_FORWARD_IMPULSE_MAX_SPEED_SCALE;
    ix *= (maxSpeedScaleX - 1) * forwardSpeedRatio + 1;
    iy *= (K.FLIP_SIDE_IMPULSE_MAX_SPEED_SCALE - 1) * forwardSpeedRatio + 1;
    if (shouldDodgeBackwards) ix *= K.FLIP_BACKWARD_IMPULSE_SCALE_X;
    // horizontal forward and rsRight
    let fx = _fwd.x, fy = _fwd.y;
    const fl = Math.sqrt(fx * fx + fy * fy);
    if (fl > 0) { fx /= fl; fy /= fl; }
    this.vel.x += ix * fx - iy * fy;
    this.vel.y += ix * fy + iy * fx;
  }

  // Car::_UpdateAutoRoll: with throttle and partial (or only body) contact,
  // torque the car onto the surface and push it against it.
  _updateAutoRoll() {
    const groundUp = this.numContacts > 0 ? this._upwardsDir(_gUp) : _gUp.copy(this.worldContact.normal);
    const fwd = _fwd, right = _right;
    // crossRight = groundUp x forward, crossForward = groundDown x crossRight
    const crossRight = _a.crossVectors(groundUp, fwd);
    const crossForward = _b.crossVectors(crossRight, groundUp); // (-groundUp) x crossRight
    const dr = (right.x * crossRight.x + right.y * crossRight.y + right.z * crossRight.z), df = (fwd.x * crossForward.x + fwd.y * crossForward.y + fwd.z * crossForward.z);
    const rightTorqueFactor = 1 - (dr < 0 ? 0 : dr > 1 ? 1 : dr);
    const forwardTorqueFactor = 1 - (df < 0 ? 0 : df > 1 ? 1 : df);
    const tr = ((right.x * groundUp.x + right.y * groundUp.y + right.z * groundUp.z) >= 0 ? -1 : 1) * rightTorqueFactor * K.AUTOROLL_TORQUE;
    const tf = ((fwd.x * groundUp.x + fwd.y * groundUp.y + fwd.z * groundUp.z) >= 0 ? 1 : -1) * forwardTorqueFactor * K.AUTOROLL_TORQUE;
    const F = this.extForce, a = -K.AUTOROLL_FORCE;
    F.x += groundUp.x * a; F.y += groundUp.y * a; F.z += groundUp.z * a;
    this.extTorque.x += fwd.x * tr + right.x * tf;
    this.extTorque.y += fwd.y * tr + right.y * tf;
    this.extTorque.z += fwd.z * tr + right.z * tf;
  }

  // btVehicleRL::updateSuspension
  _updateSuspension(dt) {
    const wheels = this.wheels;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      if (w.contact) {
        const force = (w.rest - w.susLen) * K.SUSPENSION_STIFFNESS * w.clippedInv;
        const dampingVelScale = w.relVel < 0 ? K.WHEELS_DAMPING_COMPRESSION : K.WHEELS_DAMPING_RELAXATION;
        let f = (force - dampingVelScale * w.relVel) * w.scale;
        if (f < 0) f = 0; // RL never pulls the car down
        w.suspForce = f;
      } else {
        w.suspForce = 0;
      }
    }
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      if (w.suspForce === 0) continue;
      _r.subVectors(w.point, this.pos);
      const j = w.suspForce * dt + w.extraPushback, n = w.normal;
      _c.x = n.x * j; _c.y = n.y * j; _c.z = n.z * j;
      this.applyImpulse(_c, _r);
    }
  }

  // btVehicleRL::applyFrictionImpulses: at the contact point moved into the
  // plane of the centre of mass (ROLLING_INFLUENCE_FIX)
  _applyFrictionImpulses(dt) {
    const up = _up, wheels = this.wheels;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      if (w.impulse.isZero()) continue;
      _r.subVectors(w.point, this.pos);
      const d = (up.x * _r.x + up.y * _r.y + up.z * _r.z), imp = w.impulse;
      _r.x -= up.x * d; _r.y -= up.y * d; _r.z -= up.z * d;
      _c.x = imp.x * dt; _c.y = imp.y * dt; _c.z = imp.z * dt;
      this.applyImpulse(_c, _r);
    }
  }

  // Car::_UpdateBoost
  _updateBoost(dt) {
    const s = this.rsControls, was = this.isBoosting;
    if (this.boost > 0 || this._unlimitedBoost) {
      if (this.isBoosting) this.isBoosting = s.boost || this.boostingTime < T_BOOST_MIN;
      else if (s.boost) this.isBoosting = true;
    } else {
      this.isBoosting = false;
    }
    this.boostingTime = this.isBoosting ? f32(this.boostingTime + f32(dt)) : 0;
    if (this.isBoosting) {
      if (!this._unlimitedBoost) this.boost = Math.max(f32(this.boost - f32(f32(K.BOOST_USED_PER_SECOND) * f32(dt))), 0);
      const a = this.isOnGround ? K.BOOST_ACCEL_GROUND : K.BOOST_ACCEL_AIR, F = this.extForce;
      F.x += _fwd.x * a; F.y += _fwd.y * a; F.z += _fwd.z * a;
    }
    this.boost = Math.min(this.boost, K.BOOST_MAX);
    if (this.isBoosting && !was) this.events.push('boostStart');
    else if (!this.isBoosting && was) this.events.push('boostEnd');
  }

  /** Car::_PostTickUpdate: after integration (supersonic, bump cooldown, last controls). */
  postTick(world, dt) {
    if (this.isDemoed) return;
    const s2 = this.vel.lenSq();
    const was = this.isSupersonic;
    if (this.isSupersonic && this.supersonicTime < T_SUPERSONIC_MAINTAIN) {
      this.isSupersonic = s2 >= K.SUPERSONIC_MAINTAIN_MIN_SPEED * K.SUPERSONIC_MAINTAIN_MIN_SPEED;
    } else {
      this.isSupersonic = s2 >= K.SUPERSONIC_START_SPEED * K.SUPERSONIC_START_SPEED;
    }
    this.supersonicTime = this.isSupersonic ? f32(this.supersonicTime + f32(dt)) : 0;
    if (this.isSupersonic && !was) this.events.push('supersonic');
    if (this.bumpCooldown > 0) this.bumpCooldown = Math.max(f32(this.bumpCooldown - f32(dt)), 0);
    this.lastJump = !!this.controls.jump;
  }

  /** Car::_FinishPhysicsTick: add the velocity cache (bumps), then clamp once. */
  finishPhysicsTick() {
    if (this.isDemoed) return;
    const c = this.velocityImpulseCache;
    const v = this.vel, w = this.angVel;
    if (c.x !== 0 || c.y !== 0 || c.z !== 0) { v.x += c.x; v.y += c.y; v.z += c.z; c.x = 0; c.y = 0; c.z = 0; }
    // limit velocities (written out: see the note at _k)
    const v2 = v.x * v.x + v.y * v.y + v.z * v.z, w2 = w.x * w.x + w.y * w.y + w.z * w.z;
    if (v2 > K.CAR_MAX_SPEED * K.CAR_MAX_SPEED) {
      const f = K.CAR_MAX_SPEED / Math.sqrt(v2);
      v.x *= f; v.y *= f; v.z *= f;
    }
    if (w2 > K.CAR_MAX_ANG_SPEED * K.CAR_MAX_ANG_SPEED) {
      const f = K.CAR_MAX_ANG_SPEED / Math.sqrt(w2);
      w.x *= f; w.y *= f; w.z *= f;
    }
  }

  clampVelocities() {
    this.vel.clampLength(K.CAR_MAX_SPEED);
    this.angVel.clampLength(K.CAR_MAX_ANG_SPEED);
  }
}
