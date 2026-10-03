// The simulation world: cars, ball, boost pads, goals. Fixed 120 Hz ticks.
//
// World.step runs one tick in RocketSim's order (Arena::Step, MIT,
// Copyright (c) 2022 ZealanL, on Bullet's btDiscreteDynamicsWorld, zlib):
//   1. ball sleep check: a ball with exactly zero velocity and spin sleeps
//      (no gravity, no arena contacts) until something touches it
//   2. per car: demo respawn timer, then car.preTick (vehicle update)
//   3. boost pads preTick (cooldowns)
//   4. gravity (as a force) on simulated bodies, ball drag on its velocity
//   5. collision detection on the start-of-tick transforms with RocketSim's
//      contact callbacks (onBallWorld / onCarWorld / onCarBall / onCarCar)
//   6. one shared sequential-impulse solve of all contacts (solver.js:
//      10 split-impulse + 10 velocity iterations, external force impulses),
//      then every simulated body's transform is integrated (exponential map)
//   7. per car: postTick, finishPhysicsTick, boost pad collision; pads
//      postTick (give boost); ball finishPhysicsTick; goal check.
//
// ---- Car <-> World interface (what car.js must provide and may rely on) ----
// Body state (World, the solver and the narrowphase read and write these):
//   pos (V3), quat (Quat), R (M3, rotation from quat; the solver refreshes it
//   after integrating), vel, angVel (uu/s, rad/s, world frame), mass,
//   invMass, invInertiaLocal (V3, body-frame diagonal of the inverse inertia),
//   friction / restitution (Bullet body materials, combined per contact),
//   half (V3, box half extents incl. margin), margin, hbOffset (box centre in
//   the car frame), contactThreshold (Bullet contact breaking threshold), id,
//   team, sb (solver scratch, owned by solver.js).
// Call order within World.step:
//   car.preTick(world, dt)  once, on the start-of-tick transform, only for
//     cars that are simulated this tick (not demolished, not carsFrozen).
//     World has already zeroed extForce / extTorque and car.events. The car:
//     - casts its wheel rays with world.raycastWheel(from, dir, len, car, hit)
//       (closest hit on the arena, two-sided, the ball and other cars' boxes;
//       hit = makeRayHit(): t, fraction, px..pz, normal nx..nz facing the
//       ray, type HIT_STATIC / HIT_BALL / HIT_CAR, body, and that body's
//       velocity at the hit point vx..vz; the ball and car boxes are hit the
//       way Bullet's btSubsimplexConvexCast does it, up to ~0.5 uu early and
//       never from inside; a demolished car blocks nothing). Note that
//       btVehicleRL's friction takes the ground body's velocity with the
//       CAR-relative contact offset (getVelocityInLocalPoint quirk); use
//       hit.body for that, vx..vz is the true point velocity;
//     - applies what RocketSim applies as impulses or by setting the velocity
//       (suspension, tyre friction, jumps, dodges, auto-flip, flip z-damping)
//       to vel / angVel directly;
//     - adds what RocketSim applies as forces / torques (sticky, boost, jump
//       hold, air throttle, air control, flip torque, auto-roll) to extForce
//       (linear ACCELERATION, uu/s^2) and extTorque (angular ACCELERATION,
//       rad/s^2, world frame); World adds gravity and the solver integrates
//       both as extForce*dt and extTorque*dt, like Bullet's F/m*dt and
//       I^-1*tau*dt;
//     - reads worldContact {hasContact, normal} (set by the previous tick's
//       car-world contacts, before internal-edge correction) and clears
//       worldContact.hasContact before returning;
//     - pushes event names onto car.events ('jump', 'land', ...).
//   (collision detection)  World's callbacks may set isDemoed / respawnTimer
//     (car.demolish()), add bump velocity to velocityImpulseCache (V3, uu/s),
//     and read/write bumpCooldown, bumpOther (id of the last car bumped),
//     ballHitTick (tick of the last extra ball impulse), isSupersonic,
//     isOnGround and vel.
//   (solve + integrate)  vel, angVel, pos, quat and R are updated.
//   car.postTick(world, dt)  supersonic state, bump cooldown countdown.
//   car.finishPhysicsTick()  adds velocityImpulseCache to vel, clears it, then
//     clamps vel (2300 uu/s) and angVel (5.5 rad/s): the only clamp.
//   Neither post call runs for a demolished car; its body is frozen with the
//   velocity it had until World respawns it (car.reset) when respawnTimer
//   reaches zero. inWorld is true while the car is simulated this tick.
//
// Events (world.events, rebuilt every tick, read by match / effects / audio;
// replays keep them, so they are new objects, not pooled):
//   ballHit {car, point, normal, dv, speed}, ballBounce {speed, point, normal},
//   carWorld {car, speed}, carCar {a, b, speed, point}, bump {attacker, victim,
//   speed, point}, demo {attacker, victim, point}, pad {pad, car},
//   padRespawn {pad}, goal {team, ball, speed}, respawn {car} and the car's own
//   events {type, car}: land, jump, doubleJump, flip, autoflip, flipReset,
//   boostStart, boostEnd, supersonic.
import { V3, rng, curve } from './math.js';
import * as K from './constants.js';
import { Car } from './car.js';
import { Ball } from './ball.js';
import { getCollisionMesh } from './arena.js';
import { Narrowphase, makeRay } from './contacts.js';
import { Solver } from './solver.js';

const _d = new V3(), _vd = new V3(), _lp = new V3();

export class World {
  constructor(opts = {}) {
    this.mesh = opts.mesh || getCollisionMesh();
    this.cars = [];
    this.ball = new Ball();
    this.tick = 0;
    this.time = 0;
    this.events = [];
    this.unlimitedBoost = false;
    this.carsFrozen = false;
    this.goalsEnabled = true;
    this.random = rng(opts.seed || 1234);
    this.pads = K.BOOST_PADS.map(([x, y, big], i) => ({
      id: i, x, y, z: big ? 73 : 70, big: !!big, active: true, timer: 0,
      lockedCar: null, prevLockedId: -1,
    }));
    this.lastTouch = null;   // car
    this.touchHistory = [];  // recent touches { car, time }
    this.np = new Narrowphase(this.mesh, this);
    this._ray = makeRay();
    this.solver = new Solver();
    // per-tick scratch (no allocation in the hot path)
    this._hits = [];          // cars whose extra ball impulse fired this tick
    this._hitPts = [];        // [point V3, normal V3] per entry of _hits
    this._ballVel0 = new V3();
    this._impact = 0; this._impactP = new V3(); this._impactN = new V3();
    this._carImpact = new Float64Array(64);
  }

  addCar(team, name = '') {
    const car = new Car(this.cars.length, team);
    car.name = name;
    this.cars.push(car);
    return car;
  }

  removeCar(car) {
    this.cars = this.cars.filter((c) => c !== car);
    this.cars.forEach((c, i) => { c.id = i; });
  }

  resetPads() { for (const p of this.pads) { p.active = true; p.timer = 0; p.lockedCar = null; p.prevLockedId = -1; } }

  /** Place cars on kickoff spots and the ball at centre. Returns spot indices. */
  setupKickoff(seedRandom = true) {
    const ball = this.ball;
    ball.reset(0, 0, K.BALL_REST_Z);
    this.lastTouch = null;
    this.touchHistory.length = 0;
    const blue = this.cars.filter((c) => c.team === 0), orange = this.cars.filter((c) => c.team === 1);
    const n = Math.max(blue.length, orange.length);
    // choose kickoff spots like the real thing: random distinct spots,
    // mirrored for the other team.
    const order = [0, 1, 2, 3, 4];
    if (seedRandom) for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]];
    }
    // prefer diagonal / offset / centre combos that exist in standard modes
    let spots;
    if (n === 1) spots = [order[0]];
    else if (n === 2) spots = this.random() < 0.5 ? [0, 1] : (this.random() < 0.5 ? [2, 3] : [0, 4]);
    else spots = order.slice(0, n);
    const place = (cars, team) => {
      cars.forEach((car, i) => {
        const s = K.KICKOFF_SPAWNS[spots[i % spots.length]] || K.KICKOFF_SPAWNS[i % 5];
        const sx = team === 0 ? 1 : -1;
        car.reset(s.x * sx, s.y * sx, K.CAR_SPAWN_REST_Z, team === 0 ? s.yaw : s.yaw + Math.PI);
        car.kickoffSpot = spots[i % spots.length];
      });
    };
    place(blue, 0); place(orange, 1);
    this.resetPads();
    return spots;
  }

  respawn(car) {
    const spots = K.RESPAWN_SPOTS;
    const s = spots[Math.floor(this.random() * spots.length)];
    const sx = car.team === 0 ? 1 : -1;
    car.reset(s.x * sx, s.y * sx, K.CAR_RESPAWN_Z, car.team === 0 ? s.yaw : s.yaw + Math.PI);
    this.events.push({ type: 'respawn', car });
  }

  /**
   * Closest wheel-ray hit (btDefaultVehicleRaycaster): arena (both sides of
   * triangles + planes), ball, other cars' boxes. dir must be unit length.
   */
  raycastWheel(from, dir, len, ignoreCar, out) {
    const r = this._ray;
    r.ox = from.x; r.oy = from.y; r.oz = from.z; r.dx = dir.x; r.dy = dir.y; r.dz = dir.z; r.len = len;
    return this.np.raycast(this, r, ignoreCar, out);
  }

  step(dt = K.DT) {
    const ev = this.events;
    ev.length = 0;
    const ball = this.ball, cars = this.cars, nc = cars.length;

    // ---- 1. ball zero-velocity sleep -----------------------------------------
    const bv = ball.vel, bw = ball.angVel;
    ball.sleeping = bv.x === 0 && bv.y === 0 && bv.z === 0 && bw.x === 0 && bw.y === 0 && bw.z === 0;
    this._ballVel0.copy(bv);

    // ---- 2. cars: respawn timers, vehicle pre-tick --------------------------------
    for (let i = 0; i < nc; i++) {
      const car = cars[i];
      car.inWorld = false;
      car.events.length = 0;
      if (this.carsFrozen) continue;
      let respawned = false;
      if (car.isDemoed) {
        car.respawnTimer = Math.max(car.respawnTimer - dt, 0);
        if (car.respawnTimer > 0) continue;
        this.respawn(car);
        respawned = true; // RocketSim: simulation stays disabled for this tick
      }
      car.extForce.set(0, 0, 0); car.extTorque.set(0, 0, 0);
      car.preTick(this, dt);
      for (const e of car.events) ev.push({ type: e, car });
      car.events.length = 0;
      car.inWorld = !respawned;
    }

    // ---- 3. boost pad pre-tick ------------------------------------------------------
    if (nc > 0) {
      const pads = this.pads;
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (p.timer > 0) p.timer = Math.max(p.timer - dt, 0);
        const was = p.active;
        p.active = p.timer === 0;
        if (p.active && !was) ev.push({ type: 'padRespawn', pad: p });
        p.lockedCar = null;
      }
    }

    // ---- 4. gravity, drag -----------------------------------------------------------
    for (let i = 0; i < nc; i++) if (cars[i].inWorld) cars[i].extForce.z += K.GRAVITY_Z;
    const ballInWorld = !ball.frozen;
    let ballAwake = ballInWorld && !ball.sleeping;
    ball.extForce.set(0, 0, ballAwake ? K.GRAVITY_Z : 0);
    ball.extTorque.set(0, 0, 0);
    if (ballInWorld) ball.applyDamping(dt);

    // ---- 5. collision detection (RocketSim pair order) -----------------------------------
    const np = this.np;
    np.begin();
    this._hits.length = 0;
    this._impact = 0;
    for (let i = 0; i < nc; i++) this._carImpact[i] = 0;
    if (ballInWorld) {
      if (ballAwake) np.ballWorld(ball);
      for (let i = 0; i < nc; i++) {
        const car = cars[i];
        if (!car.inWorld) continue;
        const before = np.nManifolds;
        np.carBall(car, ball);
        if (np.nManifolds > before) ballAwake = true; // a touch wakes a sleeping ball
      }
    }
    for (let i = 0; i < nc; i++) {
      const a = cars[i];
      if (!a.inWorld) continue;
      np.carWorld(a);
      for (let j = i + 1; j < nc; j++) {
        const b = cars[j];
        if (!b.inWorld) continue;
        const before = np.nManifolds;
        np.carCar(b, a); // RocketSim's manifold has the later-added car as body A
        if (np.nManifolds > before) {
          const m = np.manifolds[before];
          let vmax = 0, pi = 0;
          for (let k = 0; k < m.n; k++) if (m.pts[k].vn > vmax) { vmax = m.pts[k].vn; pi = k; }
          if (vmax > 150) {
            const p = m.pts[pi];
            ev.push({ type: 'carCar', a, b, speed: vmax, point: new V3(p.bx, p.by, p.bz) });
          }
        }
      }
    }

    // ---- 6. solve + integrate ---------------------------------------------------------
    const solver = this.solver;
    solver.begin(dt);
    if (ballAwake) solver.addBody(ball);
    for (let i = 0; i < nc; i++) if (cars[i].inWorld) solver.addBody(cars[i]);
    for (let i = 0; i < np.nManifolds; i++) {
      const m = np.manifolds[i];
      if (m.a === ball && !ballAwake) continue;
      for (let k = 0; k < m.n; k++) solver.addContact(m.pts[k]);
    }
    solver.solve();
    solver.finish();

    // ---- 7. post tick -----------------------------------------------------------------
    for (let i = 0; i < nc; i++) {
      const car = cars[i];
      if (this.carsFrozen) break;
      // Demolished (this tick or earlier): RocketSim skips PostTick and
      // FinishPhysicsTick and freezes the body, velocity included, from the
      // next tick on.
      if (car.isDemoed) continue;
      car.postTick(this, dt);
      car.finishPhysicsTick();
      for (const e of car.events) ev.push({ type: e, car });
      car.events.length = 0;
      this._padsCheck(car);
      if (this._carImpact[i] > 250) ev.push({ type: 'carWorld', car, speed: this._carImpact[i] });
    }
    if (nc > 0) this._padsPostTick(ev);
    if (ballInWorld) ball.finishPhysicsTick();

    // events that need the post-solve state
    if (this._impact > 120) {
      ball.lastImpact = this._impact; ball.lastNormal.copy(this._impactN);
      ev.push({ type: 'ballBounce', speed: this._impact, point: this._impactP.clone(), normal: this._impactN.clone() });
    }
    if (this._hits.length) {
      const dv = _vd.subVectors(ball.vel, this._ballVel0).len(), speed = ball.vel.len();
      for (let i = 0; i < this._hits.length; i++) {
        const car = this._hits[i], hp = this._hitPts[i];
        this.lastTouch = car;
        this.touchHistory.push({ car, time: this.time });
        if (this.touchHistory.length > 8) this.touchHistory.shift();
        ev.push({ type: 'ballHit', car, point: hp[0].clone(), normal: hp[1].clone(), dv, speed });
      }
    }

    // goals
    if (this.goalsEnabled && !ball.frozen) {
      const lim = K.GOAL_SCORE_Y + ball.radius;
      if (ball.pos.y > lim) ev.push({ type: 'goal', team: 0, ball: ball.pos.clone(), speed: ball.vel.len() });
      else if (ball.pos.y < -lim) ev.push({ type: 'goal', team: 1, ball: ball.pos.clone(), speed: ball.vel.len() });
    }

    this.tick++;
    this.time += dt;
    return ev;
  }

  // ------------------------------------------------------------------ boost pads
  // BoostPadGrid::CheckCollision + BoostPad::_CheckCollide (last colliding car wins)
  _padsCheck(car) {
    if (car.boost >= K.BOOST_MAX) return;
    const P = K.BOOST_PAD, pos = car.pos, pads = this.pads;
    if (pos.z > P.GRID_MAX_Z) return;
    let aabb = false;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      let hit = false;
      if (p.prevLockedId === car.id) {
        // car AABB (compound box) vs the pad box
        if (!aabb) { carAabb(car, _aMin, _aMax); aabb = true; }
        const r = p.big ? P.BIG_BOX_RAD : P.SMALL_BOX_RAD;
        hit = p.x + r > _aMin.x && p.y + r > _aMin.y && p.z + P.BOX_HEIGHT > _aMin.z &&
          p.x - r < _aMax.x && p.y - r < _aMax.y && p.z < _aMax.z;
      } else {
        const rad = p.big ? P.BIG_RADIUS : P.SMALL_RADIUS;
        const dx = pos.x - p.x, dy = pos.y - p.y;
        if (dx * dx + dy * dy < rad * rad) hit = Math.abs(pos.z - p.z) < P.CYL_HEIGHT;
      }
      if (hit) p.lockedCar = car;
    }
  }

  // BoostPad::_PostTickUpdate
  _padsPostTick(ev) {
    const P = K.BOOST_PAD, pads = this.pads;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      let lockedId = -1;
      const car = p.lockedCar;
      if (car) {
        lockedId = car.id;
        if (p.active) {
          car.boost = Math.min(K.BOOST_MAX, car.boost + (p.big ? P.BIG_AMOUNT : P.SMALL_AMOUNT));
          p.active = false;
          p.timer = p.big ? P.BIG_COOLDOWN : P.SMALL_COOLDOWN;
          ev.push({ type: 'pad', pad: p, car });
        }
      }
      p.prevLockedId = lockedId;
    }
  }

  // ------------------------------------------------------------------ contact callbacks
  // (Arena::_BulletContactAddedCallback and the handlers it dispatches to)

  /** Ball vs arena: becomes a special (averaged) contact. */
  onBallWorld(pt) {
    pt.special = true;
    if (pt.vn > this._impact) {
      this._impact = pt.vn;
      this._impactP.set(pt.bx, pt.by, pt.bz); this._impactN.set(pt.nx, pt.ny, pt.nz);
    }
  }

  /** Car vs arena: flag + normal for next tick's auto-flip / auto-roll; materials. */
  onCarWorld(car, pt) {
    const wc = car.worldContact, n = wc.normal;
    wc.hasContact = true;
    n.x = pt.nx; n.y = pt.ny; n.z = pt.nz;
    pt.friction = K.CARWORLD_FRICTION;
    pt.restitution = K.CARWORLD_RESTITUTION;
    const i = car.id;
    if (i < this._carImpact.length && pt.vn > this._carImpact[i]) this._carImpact[i] = pt.vn;
  }

  /** Ball::_OnHit: materials, and the extra hit impulse every other tick of contact. */
  onCarBall(car, ball, pt) {
    pt.friction = K.CARBALL_FRICTION;
    pt.restitution = K.CARBALL_RESTITUTION;
    const tick = this.tick;
    if (!(tick > car.ballHitTick + 1 || car.ballHitTick > tick)) return;
    car.ballHitTick = tick;
    const R = car.R.e;
    const fx = R[0], fy = R[3], fz = R[6];
    const rvx = ball.vel.x - car.vel.x, rvy = ball.vel.y - car.vel.y, rvz = ball.vel.z - car.vel.z;
    const relSpeed = Math.min(Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz), K.BALL_CAR_EXTRA_IMPULSE_MAX_DELTA_VEL);
    if (relSpeed > 0) {
      const d = _d.set(ball.pos.x - car.pos.x, ball.pos.y - car.pos.y, (ball.pos.z - car.pos.z) * K.BALL_CAR_EXTRA_IMPULSE_Z_SCALE).normalize();
      const f = (d.x * fx + d.y * fy + d.z * fz) * (1 - K.BALL_CAR_EXTRA_IMPULSE_FORWARD_SCALE);
      d.set(d.x - fx * f, d.y - fy * f, d.z - fz * f).normalize();
      const s = relSpeed * curve(K.BALL_CAR_EXTRA_IMPULSE_CURVE, relSpeed);
      ball.velocityImpulseCache.addScaled(d, s);
    }
    const k = this._hits.length;
    this._hits.push(car);
    let hp = this._hitPts[k];
    if (!hp) hp = this._hitPts[k] = [new V3(), new V3()];
    hp[0].set(pt.bx, pt.by, pt.bz);
    hp[1].set(pt.nx, pt.ny, pt.nz);
  }

  /** Arena::_BtCallback_OnCarCarCollision: bump / demo test per contact point, both ways. */
  onCarCar(carA, carB, pt) {
    pt.friction = K.CARCAR_FRICTION;
    pt.restitution = K.CARCAR_RESTITUTION;
    for (let i = 0; i < 2; i++) {
      const swapped = i === 1;
      const c1 = swapped ? carB : carA, c2 = swapped ? carA : carB;
      if (c1.isDemoed || c2.isDemoed) return;
      if (c1.bumpOther === c2.id && c1.bumpCooldown > 0) continue;
      const dx = c2.pos.x - c1.pos.x, dy = c2.pos.y - c1.pos.y, dz = c2.pos.z - c1.pos.z;
      const v = c1.vel;
      if (v.x * dx + v.y * dy + v.z * dz <= 0) continue;
      const sp = v.len();
      const vdx = v.x / sp, vdy = v.y / sp, vdz = v.z / sp;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const towards = (v.x * dx + v.y * dy + v.z * dz) / dl;
      const away = c2.vel.x * vdx + c2.vel.y * vdy + c2.vel.z * vdz;
      if (towards <= away) continue;
      // contact point on c1 in c1's local frame (manifold localPointA / B)
      const R = c1.R.e;
      const px = (swapped ? pt.bx : pt.ax) - c1.pos.x, py = (swapped ? pt.by : pt.ay) - c1.pos.y, pz = (swapped ? pt.bz : pt.az) - c1.pos.z;
      const localX = R[0] * px + R[3] * py + R[6] * pz;
      if (!(localX > K.BUMP_MIN_FORWARD_DIST)) continue;
      const isDemo = c1.isSupersonic && c1.team !== c2.team;
      if (isDemo) {
        c2.demolish();
        this.events.push({ type: 'demo', attacker: c1, victim: c2, point: c2.pos.clone() });
      } else {
        const ground = c2.isOnGround;
        const base = curve(ground ? K.BUMP_VEL_GROUND_CURVE : K.BUMP_VEL_AIR_CURVE, towards);
        const upAmt = curve(K.BUMP_UPWARD_VEL_CURVE, towards);
        const R2 = c2.R.e;
        const ux = ground ? R2[2] : 0, uy = ground ? R2[5] : 0, uz = ground ? R2[8] : 1;
        c2.velocityImpulseCache.x += vdx * base + ux * upAmt;
        c2.velocityImpulseCache.y += vdy * base + uy * upAmt;
        c2.velocityImpulseCache.z += vdz * base + uz * upAmt;
        this.events.push({ type: 'bump', attacker: c1, victim: c2, speed: towards, point: _lp.set(pt.bx, pt.by, pt.bz).clone() });
      }
      c1.bumpOther = c2.id;
      c1.bumpCooldown = K.BUMP_COOLDOWN_TIME;
    }
  }
}

// Car compound-shape AABB (btCompoundShape::getAabb of the offset box).
const _aMin = new V3(), _aMax = new V3();
function carAabb(car, mn, mx) {
  const R = car.R.e, h = car.half, o = car.hbOffset, p = car.pos;
  const cx = p.x + R[0] * o.x + R[1] * o.y + R[2] * o.z;
  const cy = p.y + R[3] * o.x + R[4] * o.y + R[5] * o.z;
  const cz = p.z + R[6] * o.x + R[7] * o.y + R[8] * o.z;
  const ex = Math.abs(R[0]) * h.x + Math.abs(R[1]) * h.y + Math.abs(R[2]) * h.z;
  const ey = Math.abs(R[3]) * h.x + Math.abs(R[4]) * h.y + Math.abs(R[5]) * h.z;
  const ez = Math.abs(R[6]) * h.x + Math.abs(R[7]) * h.y + Math.abs(R[8]) * h.z;
  mn.set(cx - ex, cy - ey, cz - ez); mx.set(cx + ex, cy + ey, cz + ez);
}
