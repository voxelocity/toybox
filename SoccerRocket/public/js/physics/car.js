// Car rigid body with raycast suspension, friction curves, throttle / brake,
// steering, boost, jumps, dodges and air control at 120 Hz.
//
// Interface with World (world.js runs RocketSim's Arena::Step order):
//   preTick(world, dt)   once per tick before collision detection, on the
//                        start-of-tick transform. Wheel rays go through
//                        world.raycastWheel(). Effects RocketSim applies with
//                        applyImpulse / applyCentralImpulse / setLinearVelocity
//                        (suspension, tyre friction, jump start, double jump,
//                        dodge, auto-flip, flip z-damping) change vel / angVel
//                        immediately. Effects it applies as FORCES / TORQUES
//                        (sticky, boost, jump hold, air throttle, air control,
//                        flip torque, auto-roll) are accumulated as
//                        accelerations into extForce (uu/s^2) and extTorque
//                        (rad/s^2); the solver integrates them (with gravity,
//                        which World adds) as F/m*dt and I^-1*tau*dt.
//   (collision)          World's contact callbacks set worldContact
//                        {hasContact, normal} (read next preTick, cleared at
//                        the end of preTick), add bump velocity to
//                        velocityImpulseCache, set isDemoed, ballHitTick.
//   postTick(world, dt)  after integration: supersonic state, bump cooldown.
//   finishPhysicsTick()  adds velocityImpulseCache, then the single velocity
//                        clamp (2300 uu/s, 5.5 rad/s).
// Collision shape: RocketSim's Octane box (half extents incl. Bullet margin
// in `half`, `margin`, offset hbOffset), inertia from btBoxShape.
import { V3, Quat, M3, applyInvInertia, curve, clamp, sign } from './math.js';
import * as K from './constants.js';
import { makeRayHit, HIT_STATIC, HIT_BALL } from './contacts.js';

const _v = new V3(), _r = new V3(), _t = new V3(), _a = new V3(), _b = new V3(), _c = new V3(), _s = new V3();
const _fwd = new V3(), _left = new V3(), _up = new V3(), _down = new V3();
const _hit = makeRayHit();

export function makeControls() {
  return { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false };
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

    this.wheels = [];
    for (const [i, def] of [[0, P.front], [1, P.front], [2, P.back], [3, P.back]]) {
      const side = (i % 2 === 0) ? 1 : -1; // even = left (+y), odd = right
      this.wheels.push({
        front: i < 2,
        local: new V3(def.x, def.y * side, def.z),
        radius: def.radius,
        rest: def.rest - K.MAX_SUSPENSION_TRAVEL,          // spring is relaxed at this length
        reach: def.rest + def.radius - K.SUSPENSION_SUBTRACTION, // ray length (contact range)
        scale: i < 2 ? K.SUSPENSION_FORCE_SCALE_FRONT : K.SUSPENSION_FORCE_SCALE_BACK,
        contact: false,
        hitStatic: false, hitType: -1, hitBody: null,
        normal: new V3(0, 0, 1),
        point: new V3(),
        hard: new V3(),
        susLen: def.rest - K.MAX_SUSPENSION_TRAVEL,
        steer: 0,
        spin: 0,          // visual wheel rotation (rad)
        latFriction: 1, longFriction: 1,
        sideImpulse: 0, fwdImpulse: 0,
        axle: new V3(), fwdWS: new V3(),
        slip: 0,
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
    this.controls = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false };
    this.lastJump = false;
    this.events = [];
    this.reset(0, 0, K.CAR_SPAWN_REST_Z, Math.PI / 2);
  }

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
    this.flipRelTorque = new V3();
    this.dodgeDir = new V3();
    this.airTime = 0; this.airTimeSinceJump = 0;
    this.isBoosting = false; this.boostingTime = 0;
    this.handbrakeVal = 0;
    this.isSupersonic = false; this.supersonicTime = 0;
    this.isDemoed = false; this.respawnTimer = 0;
    this.isAutoFlipping = false; this.autoFlipTimer = 0; this.autoFlipScale = 0;
    this.worldContact.hasContact = false; this.worldContact.normal.set(0, 0, 1);
    this.bumpCooldown = 0; this.bumpOther = -1;
    this.ballHitTick = -10;
    this.lastJump = false;
    this.events.length = 0;
    for (const w of this.wheels || []) { w.contact = true; w.susLen = w.rest - 1.9; }
    this.wasOnGround = true;
    this.forwardSpeed = 0;
    this.lastLandSpeed = 0;
    this.ballWheelContacts = 0;
  }

  get forward() { return this.R.col(0, new V3()); }
  get up() { return this.R.col(2, new V3()); }

  hitboxCenter(out) {
    return this.R.mulV(this.hbOffset, out).add(this.pos);
  }

  applyImpulseAt(jx, jy, jz, rx, ry, rz) {
    this.vel.x += jx * this.invMass; this.vel.y += jy * this.invMass; this.vel.z += jz * this.invMass;
    _a.set(ry * jz - rz * jy, rz * jx - rx * jz, rx * jy - ry * jx);
    applyInvInertia(this.R, this.invInertia, _a, _a);
    this.angVel.add(_a);
  }

  // effective mass denominator for an impulse along unit dir at offset r
  invEffMass(rx, ry, rz, dx, dy, dz) {
    _a.set(ry * dz - rz * dy, rz * dx - rx * dz, rx * dy - ry * dx);
    applyInvInertia(this.R, this.invInertia, _a, _b);
    _c.crossVectors(_b, _r.set(rx, ry, rz));
    return this.invMass + _c.x * dx + _c.y * dy + _c.z * dz;
  }

  velAt(rx, ry, rz, out) {
    const w = this.angVel;
    return out.set(this.vel.x + w.y * rz - w.z * ry, this.vel.y + w.z * rx - w.x * rz, this.vel.z + w.x * ry - w.y * rx);
  }

  /** Car::Demolish: the body stops being simulated from the next tick on. */
  demolish() {
    this.isDemoed = true;
    this.respawnTimer = K.DEMO_RESPAWN_TIME;
    this.isBoosting = false;
  }

  /**
   * Vehicle update before collision detection (see header).
   * world: World (raycastWheel, ball, unlimitedBoost, tick)
   */
  preTick(world, dt) {
    const ctl = this.controls;
    this.events.length = 0;
    if (this.isDemoed) return;

    const R = this.R.fromQuat(this.quat);
    const fwd = R.col(0, _fwd), left = R.col(1, _left), up = R.col(2, _up);
    const F = this.extForce, Tq = this.extTorque;

    // ---- wheel ray casts (arena both sides, ball, other cars) -------------
    let n = 0, nStatic = 0, nBall = 0;
    const upSum = _t.set(0, 0, 0), staticUpSum = _s.set(0, 0, 0);
    const down = _down.set(-up.x, -up.y, -up.z);
    for (const w of this.wheels) {
      R.mulV(w.local, _v).add(this.pos); // hardpoint
      w.hard.copy(_v);
      if (world.raycastWheel(_v, down, w.reach, this, _hit)) {
        w.contact = true;
        w.hitType = _hit.type; w.hitBody = _hit.body; w.hitStatic = _hit.type === HIT_STATIC;
        w.normal.set(_hit.nx, _hit.ny, _hit.nz);
        w.susLen = _hit.t - w.radius;
        w.point.set(_hit.px, _hit.py, _hit.pz);
        upSum.add(w.normal);
        n++;
        if (w.hitStatic) { nStatic++; staticUpSum.add(w.normal); }
        if (_hit.type === HIT_BALL) nBall++;
      } else {
        w.contact = false; w.hitStatic = false; w.hitType = -1; w.hitBody = null;
        w.susLen = w.rest;
      }
    }
    this.ballWheelContacts = nBall;

    const wasOnGround = this.isOnGround;
    this.numContacts = n;
    this.isOnGround = n >= 3;
    if (this.isOnGround && !wasOnGround && nBall < 3) {
      this.lastLandSpeed = Math.abs(this.vel.dot(_a.copy(upSum).normalize()));
      this.events.push('land');
    }
    const forwardSpeed = this.vel.dot(fwd);
    const absFwd = Math.abs(forwardSpeed);
    this.forwardSpeed = forwardSpeed;

    // ---- handbrake ---------------------------------------------------------
    if (ctl.handbrake) this.handbrakeVal = Math.min(1, this.handbrakeVal + K.POWERSLIDE_RISE_RATE * dt);
    else this.handbrakeVal = Math.max(0, this.handbrakeVal - K.POWERSLIDE_FALL_RATE * dt);

    // ---- boost state ---------------------------------------------------------
    const hasBoost = world.unlimitedBoost || this.boost > 0;
    if (hasBoost && (ctl.boost || (this.isBoosting && this.boostingTime < K.BOOST_MIN_TIME))) {
      if (!this.isBoosting) this.events.push('boostStart');
      this.isBoosting = true;
      this.boostingTime += dt;
      if (!world.unlimitedBoost) this.boost = Math.max(0, this.boost - K.BOOST_USED_PER_SECOND * dt);
    } else {
      if (this.isBoosting) this.events.push('boostEnd');
      this.isBoosting = false; this.boostingTime = 0;
    }

    // ---- throttle / brake ------------------------------------------------------
    let realThrottle = clamp(ctl.throttle, -1, 1);
    if (this.isBoosting) realThrottle = 1;
    let engineThrottle = realThrottle, realBrake = 0;
    if (Math.abs(realThrottle) >= K.THROTTLE_DEADZONE) {
      if (absFwd > 0 && sign(realThrottle) !== sign(forwardSpeed)) {
        realBrake = 1;
        if (absFwd > 0.01) engineThrottle = 0;
      }
    } else {
      engineThrottle = 0;
      realBrake = absFwd < K.STOPPING_FORWARD_VEL ? 1 : K.COASTING_BRAKE_FACTOR;
    }
    const driveScale = curve(K.DRIVE_SPEED_TORQUE_CURVE, absFwd);
    const m = this.mass;
    const engineForce = engineThrottle * m * (K.THROTTLE_ACCEL / 4) * driveScale;
    const brakeImpulse = realBrake * m * (K.BRAKE_ACCEL / 4) * dt;

    // ---- steering --------------------------------------------------------------
    let steerAngle = curve(K.STEER_ANGLE_CURVE, absFwd);
    if (this.handbrakeVal) steerAngle += (curve(K.POWERSLIDE_STEER_ANGLE_CURVE, absFwd) - steerAngle) * this.handbrakeVal;
    steerAngle *= clamp(ctl.steer, -1, 1);
    this.wheels[0].steer = this.wheels[1].steer = steerAngle;

    // ---- suspension (impulses) -------------------------------------------------
    const jumpPressed = ctl.jump && !this.lastJump;
    const jumpingOff = this.isJumping || (this.isOnGround && jumpPressed);
    for (const w of this.wheels) {
      if (!w.contact) continue;
      _r.subVectors(w.point, this.pos);
      const nrm = w.normal;
      const denom = -(nrm.dot(up));
      let relVel = 0, clipped = 10;
      if (denom < -0.1) {
        const inv = -1 / denom;
        this.velAt(_r.x, _r.y, _r.z, _v);
        relVel = nrm.dot(_v) * inv;
        clipped = inv;
      }
      let force = K.SUSPENSION_STIFFNESS * (w.rest - w.susLen) * clipped;
      force -= (relVel < 0 ? K.WHEELS_DAMPING_COMPRESSION : K.WHEELS_DAMPING_RELAXATION) * relVel;
      force *= w.scale;
      if (force < 0) force = 0;
      w.suspForce = force;
      const j = force * dt;
      this.applyImpulseAt(nrm.x * j, nrm.y * j, nrm.z * j, _r.x, _r.y, _r.z);
    }

    // ---- tyre friction (impulses) ------------------------------------------------
    let wheelsOnGround = 0;
    for (const w of this.wheels) if (w.contact) wheelsOnGround++;
    const fullStick = realThrottle !== 0 || absFwd > K.STOPPING_FORWARD_VEL;
    for (const w of this.wheels) {
      w.sideImpulse = 0; w.fwdImpulse = 0;
      if (!w.contact) { w.latFriction = w.longFriction = 0; continue; }
      // wheel axes (steered). Local forward (cos, -sin) turns right for +steer.
      const s = w.steer, cs = Math.cos(s), sn = Math.sin(s);
      R.mulXYZ(-sn, -cs, 0, w.axle);              // wheel right axis (unprojected)
      R.mulXYZ(cs, -sn, 0, _a);                   // wheel forward (unprojected)
      // friction curve input, from the hardpoint velocity
      _r.subVectors(w.hard, this.pos);
      this.velAt(_r.x, _r.y, _r.z, _v);
      const latDir = w.axle;
      _b.crossVectors(latDir, w.normal); // longitudinal dir (sign irrelevant)
      const baseFriction = Math.abs(_v.dot(latDir));
      let input = 0;
      if (baseFriction > 5) input = baseFriction / (Math.abs(_v.dot(_b)) + baseFriction);
      w.slip = input;
      let lat = curve(K.LAT_FRICTION_CURVE, input);
      let long = curve(K.LONG_FRICTION_CURVE, input);
      if (this.handbrakeVal) {
        lat *= (K.HANDBRAKE_LAT_FRICTION_FACTOR - 1) * this.handbrakeVal + 1;
        long *= (curve(K.HANDBRAKE_LONG_FRICTION_CURVE, input) - 1) * this.handbrakeVal + 1;
      } else long = 1;
      if (!fullStick) {
        const ns = curve(K.NON_STICKY_FRICTION_CURVE, w.normal.z);
        lat *= ns; long *= ns;
      }
      w.latFriction = lat; w.longFriction = long;

      // project axle onto contact plane, forward = normal x axle
      const ax = w.axle;
      ax.addScaled(w.normal, -ax.dot(w.normal)).normalize();
      w.fwdWS.crossVectors(w.normal, ax).normalize();

      _r.subVectors(w.point, this.pos);
      this.velAt(_r.x, _r.y, _r.z, _v);
      // lateral: soft bilateral constraint
      const kSide = this.invEffMass(_r.x, _r.y, _r.z, ax.x, ax.y, ax.z);
      w.sideImpulse = -K.LATERAL_CONTACT_DAMPING * _v.dot(ax) / kSide * lat;
      // longitudinal: engine or rolling friction / brakes
      if (engineForce !== 0) {
        w.fwdImpulse = engineForce * dt * long;
      } else if (brakeImpulse > 0) {
        const kF = this.invEffMass(_r.x, _r.y, _r.z, w.fwdWS.x, w.fwdWS.y, w.fwdWS.z);
        let j = -_v.dot(w.fwdWS) / (kF * wheelsOnGround);
        j = clamp(j, -brakeImpulse, brakeImpulse);
        w.fwdImpulse = j * long;
      }
    }
    for (const w of this.wheels) {
      if (!w.contact) continue;
      // Friction acts in the plane of the centre of mass (no pitch / roll
      // torque from tyre forces, so cars do not dive or lean).
      _r.subVectors(w.point, this.pos);
      _r.addScaled(up, -up.dot(_r) * (1 - K.ROLL_INFLUENCE));
      const jf = w.fwdImpulse, js = w.sideImpulse;
      if (jf || js) {
        this.applyImpulseAt(w.fwdWS.x * jf + w.axle.x * js, w.fwdWS.y * jf + w.axle.y * js, w.fwdWS.z * jf + w.axle.z * js, _r.x, _r.y, _r.z);
      }
    }

    // ---- sticky force (force; static-ground wheels only) -------------------------------
    if (nStatic >= 3 && !jumpingOff) {
      staticUpSum.normalize();
      let scale = K.STICKY_FORCE_BASE;
      if (fullStick) scale += 1 - Math.abs(staticUpSum.z);
      F.addScaled(staticUpSum, scale * K.GRAVITY_Z);
    }

    // ---- jumping -------------------------------------------------------------------
    if (this.isOnGround) {
      this.airTime = 0;
      this.airTimeSinceJump = 0;
      // landing on the ball with used jumps restores them (flip reset)
      if (!wasOnGround && nBall >= 3 && (this.hasFlipped || this.hasDoubleJumped || this.hasJumped)) this.events.push('flipReset');
      if (!this.isJumping) { this.hasJumped = false; }
      this.hasDoubleJumped = false;
      this.hasFlipped = false;
      this.isFlipping = false;
    } else {
      this.airTime += dt;
      if (this.hasJumped && !this.isJumping) this.airTimeSinceJump += dt;
      else this.airTimeSinceJump = 0;
    }

    if (this.isOnGround && jumpPressed && !this.isJumping) {
      this.isJumping = true; this.hasJumped = true; this.jumpTime = 0;
      this.vel.addScaled(up, K.JUMP_IMMEDIATE_VEL);
      this.events.push('jump');
    }
    if (this.isJumping) {
      if (this.jumpTime < K.JUMP_MIN_TIME || (ctl.jump && this.jumpTime < K.JUMP_MAX_TIME)) {
        const acc = K.JUMP_ACCEL * (this.jumpTime < K.JUMP_MIN_TIME ? K.JUMP_PRE_MIN_ACCEL_SCALE : 1);
        F.addScaled(up, acc);
      } else {
        this.isJumping = false;
      }
      this.jumpTime += dt;
    }

    // second jump / dodge
    if (!this.isOnGround && jumpPressed && !this.isJumping) {
      const canSecond = !this.hasDoubleJumped && !this.hasFlipped &&
        (!this.hasJumped || this.airTimeSinceJump < K.DOUBLEJUMP_MAX_DELAY);
      if (canSecond) {
        const mag = Math.abs(ctl.yaw) + Math.abs(ctl.pitch) + Math.abs(ctl.roll);
        if (mag >= K.DODGE_DEADZONE) this._dodge(fwd);
        else {
          this.vel.addScaled(up, K.JUMP_IMMEDIATE_VEL);
          this.hasDoubleJumped = true;
          this.events.push('doubleJump');
        }
      }
    }

    // ---- auto-flip (turtle recovery) ----------------------------------------------------
    const wc = this.worldContact;
    if (n === 0 && wc.hasContact && jumpPressed && up.dot(wc.normal) < -K.AUTOFLIP_NORMZ_THRESH) {
      this.isAutoFlipping = true; this.autoFlipTimer = 0;
      // roll toward whichever side is lower relative to the surface
      this.autoFlipScale = left.dot(wc.normal) > 0 ? 1 : -1;
      this.vel.addScaled(wc.normal, K.AUTOFLIP_IMPULSE);
      this.events.push('autoflip');
    }
    if (this.isAutoFlipping) {
      this.autoFlipTimer += dt;
      if (this.autoFlipTimer > K.AUTOFLIP_TIME + 0.2 || (this.isOnGround && this.autoFlipTimer > 0.1)) this.isAutoFlipping = false;
      else {
        // spin about forward axis at max rate
        const along = this.angVel.dot(fwd);
        this.angVel.addScaled(fwd, this.autoFlipScale * K.CAR_MAX_ANG_SPEED - along);
      }
    }

    // ---- air control and dodge torque (torques) ------------------------------------------
    if (!this.isOnGround) this._airTorque(dt, n === 0, fwd, left, up);

    // ---- auto-roll: partial wheel contact pulls the car onto the surface ----------------
    if (n > 0 && n < 4 && !this.isJumping) {
      upSum.normalize();
      _a.crossVectors(up, upSum); // rotation axis toward the surface normal
      Tq.addScaled(_a, K.AUTOROLL_TORQUE * K.CAR_TORQUE_SCALE);
      F.addScaled(upSum, -K.AUTOROLL_FORCE);
    }

    // ---- boost force ---------------------------------------------------------------------
    if (this.isBoosting) {
      const acc = this.isOnGround ? K.BOOST_ACCEL_GROUND : K.BOOST_ACCEL_AIR;
      F.addScaled(fwd, acc);
    }
    // air throttle
    if (n === 0) F.addScaled(fwd, clamp(ctl.throttle, -1, 1) * K.THROTTLE_AIR_ACCEL);

    // flip z-damping (velocity, before this tick's forces are integrated)
    if (this.isFlipping) {
      this.flipTime += dt;
      if (this.flipTime >= K.FLIP_Z_DAMP_START && (this.vel.z < 0 || this.flipTime < K.FLIP_Z_DAMP_END)) {
        this.vel.z *= Math.pow(1 - K.FLIP_Z_DAMP_120, dt * 120);
      }
    } else if (this.hasFlipped) this.flipTime += dt;

    // visual wheel spin
    for (const w of this.wheels) {
      const v = w.contact ? this.vel.dot(fwd) : (w.spinVel || 0) * 0.98;
      w.spinVel = v;
      w.spin += (v / w.radius) * dt;
    }
    this.lastJump = ctl.jump;
    wc.hasContact = false;
  }

  /** Car::_PostTickUpdate: after integration (supersonic, bump cooldown). */
  postTick(world, dt) {
    if (this.isDemoed) return;
    const s2 = this.vel.lenSq();
    const was = this.isSupersonic;
    if (this.isSupersonic && this.supersonicTime < K.SUPERSONIC_MAINTAIN_MAX_TIME) {
      this.isSupersonic = s2 >= K.SUPERSONIC_MAINTAIN_MIN_SPEED * K.SUPERSONIC_MAINTAIN_MIN_SPEED;
    } else {
      this.isSupersonic = s2 >= K.SUPERSONIC_START_SPEED * K.SUPERSONIC_START_SPEED;
    }
    this.supersonicTime = this.isSupersonic ? this.supersonicTime + dt : 0;
    if (this.isSupersonic && !was) this.events.push('supersonic');
    if (this.bumpCooldown > 0) this.bumpCooldown = Math.max(this.bumpCooldown - dt, 0);
  }

  /** Car::_FinishPhysicsTick: add the velocity cache (bumps), then clamp once. */
  finishPhysicsTick() {
    if (this.isDemoed) return;
    const c = this.velocityImpulseCache;
    if (c.x !== 0 || c.y !== 0 || c.z !== 0) { this.vel.add(c); c.set(0, 0, 0); }
    this.clampVelocities();
  }

  _dodge(fwd) {
    const ctl = this.controls;
    // dodge direction: x forward, y right
    let dx = -ctl.pitch, dy = ctl.yaw + ctl.roll;
    if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) { dx = 0; dy = 0; }
    else { const l = Math.hypot(dx, dy); dx /= l; dy /= l; }
    // relative torque in body frame: (about forward, about left, about up)
    this.flipRelTorque.set(dy, dx, 0);
    this.dodgeDir.set(dx, dy, 0);
    if (Math.abs(dx) < 0.1) dx = 0;
    if (Math.abs(dy) < 0.1) dy = 0;
    if (dx !== 0 || dy !== 0) {
      // horizontal frame
      const f2x = fwd.x, f2y = fwd.y;
      const fl = Math.hypot(f2x, f2y) || 1;
      const fx = f2x / fl, fy = f2y / fl;
      const rx = fy, ry = -fx; // right of forward on the ground plane
      const forwardSpeed = this.vel.x * fx + this.vel.y * fy;
      const ratio = Math.abs(forwardSpeed) / K.CAR_MAX_SPEED;
      let backwards;
      if (Math.abs(forwardSpeed) < 100) backwards = dx < 0;
      else backwards = (dx >= 0) !== (forwardSpeed >= 0);
      let ix = dx * K.FLIP_INITIAL_VEL_SCALE, iy = dy * K.FLIP_INITIAL_VEL_SCALE;
      const maxX = backwards ? K.FLIP_BACKWARD_IMPULSE_MAX_SPEED_SCALE : K.FLIP_FORWARD_IMPULSE_MAX_SPEED_SCALE;
      ix *= (maxX - 1) * ratio + 1;
      iy *= (K.FLIP_SIDE_IMPULSE_MAX_SPEED_SCALE - 1) * ratio + 1;
      if (backwards) ix *= K.FLIP_BACKWARD_IMPULSE_SCALE_X;
      this.vel.x += fx * ix + rx * iy;
      this.vel.y += fy * ix + ry * iy;
    }
    this.hasFlipped = true;
    this.isFlipping = true;
    this.flipTime = 0;
    this.events.push('flip');
  }

  // Air control and flip torques, accumulated as angular acceleration (extTorque).
  _airTorque(dt, airControl, fwd, left, up) {
    const ctl = this.controls, Tq = this.extTorque;
    if (this.isFlipping) this.isFlipping = this.hasFlipped && this.flipTime < K.FLIP_TORQUE_TIME;
    let doAir = false;
    if (this.isFlipping) {
      const rt = this.flipRelTorque;
      if (rt.x !== 0 || rt.y !== 0) {
        // flip cancel: pitch input against the flip direction
        let pitchScale = 1;
        if (rt.y !== 0 && ctl.pitch !== 0 && sign(ctl.pitch) === sign(rt.y)) {
          pitchScale = 1 - Math.min(Math.abs(ctl.pitch), 1);
          doAir = true;
        }
        const roll = rt.x * K.FLIP_TORQUE_ROLL, pitchDown = rt.y * pitchScale * K.FLIP_TORQUE_PITCH;
        // roll right = +about forward; nose down = +about left
        Tq.addScaled(fwd, roll).addScaled(left, pitchDown);
      } else doAir = true;
    } else doAir = true;
    doAir = doAir && !this.isAutoFlipping && airControl;
    if (!doAir) return;

    let pitchScale = 1;
    if (this.isFlipping || (this.hasFlipped && this.flipTime < K.FLIP_TORQUE_TIME + K.FLIP_PITCHLOCK_EXTRA_TIME)) pitchScale = 0;
    const p = clamp(ctl.pitch, -1, 1) * pitchScale, y = clamp(ctl.yaw, -1, 1), r = clamp(ctl.roll, -1, 1);
    // axes: pitch about right (= -left), yaw about up (turn right = -up), roll about forward
    const w = this.angVel;
    const wPitch = -w.dot(left), wYaw = -w.dot(up), wRoll = w.dot(fwd);
    const S = K.CAR_TORQUE_SCALE;
    const aPitch = (p * K.AIR_TORQUE.pitch - wPitch * K.AIR_DAMPING.pitch * (1 - Math.abs(p))) * S;
    const aYaw = (y * K.AIR_TORQUE.yaw - wYaw * K.AIR_DAMPING.yaw * (1 - Math.abs(y))) * S;
    const aRoll = (r * K.AIR_TORQUE.roll - wRoll * K.AIR_DAMPING.roll) * S;
    Tq.addScaled(left, -aPitch).addScaled(up, -aYaw).addScaled(fwd, aRoll);
  }

  clampVelocities() {
    this.vel.clampLength(K.CAR_MAX_SPEED);
    this.angVel.clampLength(K.CAR_MAX_ANG_SPEED);
  }
}
