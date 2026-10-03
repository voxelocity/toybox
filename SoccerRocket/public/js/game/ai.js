// Computer-controlled players.
//
// Each bot plans every `reaction` seconds using a shared ball prediction:
// it picks a role (attacker / support / last man), finds an intercept it can
// reach, and then a low level controller turns that into stick and button
// inputs every tick: ground driving with powerslides, jump and double-jump
// shots, front-flip power hits, aerials with a PD orientation controller,
// air recovery, kickoffs and turtle / stuck recovery.
import { V3, clamp, curve, sign } from '../physics/math.js';
import * as K from '../physics/constants.js';
import { predictBall } from '../physics/ball.js';

export const DIFFICULTY = {
  rookie: { label: 'Rookie', reaction: 0.32, aimNoise: 420, boostUse: 0.3, aerial: 0, aerialMax: 0, flip: 0.25, speedCap: 1500, kickoffBoost: false, jumpShots: 0.35, recovery: 0.5, turnGain: 2.4 },
  pro: { label: 'Pro', reaction: 0.15, aimNoise: 170, boostUse: 0.8, aerial: 0.6, aerialMax: 1100, flip: 0.75, speedCap: 2300, kickoffBoost: true, jumpShots: 0.85, recovery: 1, turnGain: 3.2 },
  allstar: { label: 'All-Star', reaction: 0.07, aimNoise: 45, boostUse: 1, aerial: 1, aerialMax: 1900, flip: 1, speedCap: 2300, kickoffBoost: true, jumpShots: 1, recovery: 1, turnGain: 3.6 },
};

export const BOT_NAMES = ['Comet', 'Blitz', 'Nova', 'Sprocket', 'Vortex', 'Mako', 'Pixel', 'Ranger', 'Echo', 'Rook', 'Ziggy', 'Bolt', 'Quill', 'Jinx', 'Rascal', 'Tundra', 'Viper', 'Dash'];

const BR = K.BALL_RADIUS;
const _l = new V3(), _a = new V3(), _b = new V3();

/** Shared ball prediction, refreshed by the match a few times per second. */
export class BallPrediction {
  constructor() { this.slices = []; this.n = 0; this.t0 = 0; this.step = 1 / 60; }
  update(world) {
    this.n = predictBall(world.ball, world.mesh, 4, this.step, this.slices);
    this.t0 = world.time;
  }
  /** Ball state at absolute world time t (nearest slice). */
  at(t) {
    const i = clamp(Math.round((t - this.t0) / this.step) - 1, 0, this.n - 1);
    return this.slices[i];
  }
  /** Returns { team, time } if the ball is predicted to enter a goal. */
  goalThreat() {
    for (let i = 0; i < this.n; i++) {
      const s = this.slices[i];
      if (Math.abs(s.y) > K.ARENA.Y + BR * 0.6 && Math.abs(s.x) < K.ARENA.GOAL_HALF_W) return { team: s.y > 0 ? 1 : 0, time: this.t0 + s.t };
    }
    return null;
  }
}

function localOf(car, p, out) { return car.R.mulTV(out.subVectors(p, car.pos), out); }

// Time for a single jump (held) to raise the car by h uu.
function jumpTimeFor(h) {
  const v0 = K.JUMP_IMMEDIATE_VEL, a1 = K.JUMP_ACCEL + K.GRAVITY_Z;
  const z1 = v0 * 0.2 + 0.5 * a1 * 0.04, v1 = v0 + a1 * 0.2;
  if (h <= z1) return (-v0 + Math.sqrt(v0 * v0 + 2 * a1 * h)) / a1;
  const disc = v1 * v1 + 2 * K.GRAVITY_Z * (h - z1);
  if (disc < 0) return null;
  return 0.2 + (v1 - Math.sqrt(disc)) / (-K.GRAVITY_Z);
}
function doubleJumpTimeFor(h) {
  // full first jump, second jump right after
  const v0 = K.JUMP_IMMEDIATE_VEL, a1 = K.JUMP_ACCEL + K.GRAVITY_Z;
  const z1 = v0 * 0.2 + 0.5 * a1 * 0.04, v1 = v0 + a1 * 0.2 + K.JUMP_IMMEDIATE_VEL;
  if (h <= z1) return jumpTimeFor(h);
  const disc = v1 * v1 + 2 * K.GRAVITY_Z * (h - z1);
  if (disc < 0) return null;
  return 0.22 + (v1 - Math.sqrt(disc)) / (-K.GRAVITY_Z);
}

export class Bot {
  constructor(car, difficulty = 'pro', seed = 1) {
    this.car = car;
    this.d = DIFFICULTY[difficulty] || DIFFICULTY.pro;
    this.planTimer = Math.random() * this.d.reaction;
    this.role = 'attack';
    this.target = new V3();
    this.targetTime = 0;
    this.aimDir = new V3(0, 1, 0);
    this.script = null;
    this.mode = 'drive';       // drive | aerial | recover
    this.aerialTarget = new V3();
    this.aerialTime = 0;
    this.stuckTime = 0;
    this.reverseTime = 0;
    this.noise = new V3();
    this.kickoffDone = false;
    this.seed = seed;
    this.desiredSpeed = 2300;
    this.wantJump = null;     // { at, type }
  }

  get attackDir() { return this.car.team === 0 ? 1 : -1; }

  resetKickoff() { this.kickoffDone = false; this.script = null; this.mode = 'drive'; this.planTimer = 0; }

  // ---- planning --------------------------------------------------------------
  plan(ctx) {
    const car = this.car, d = this.d, world = ctx.world, pred = ctx.prediction;
    const dir = this.attackDir;
    const ball = world.ball;
    // role: attacker = best ETA on the right side of the ball
    const mates = ctx.teammates;
    const myScore = this.chaseScore(car, ball, dir);
    let better = 0;
    for (const m of mates) if (m !== car && !m.isDemoed && this.chaseScore(m, ball, dir) < myScore) better++;
    const ownGoalY = -dir * K.ARENA.Y;
    if (better === 0) this.role = 'attack';
    else {
      // closest remaining car to own goal plays last man
      let closerToGoal = 0;
      const myGoalDist = Math.abs(car.pos.y - ownGoalY) + Math.abs(car.pos.x) * 0.3;
      for (const m of mates) if (m !== car && !m.isDemoed && this.chaseScore(m, ball, dir) > myScore - 1e-6 && m !== car) {
        if (Math.abs(m.pos.y - ownGoalY) + Math.abs(m.pos.x) * 0.3 < myGoalDist) closerToGoal++;
      }
      this.role = better >= 1 && closerToGoal === 0 && mates.length > 2 ? 'defend' : (better >= 2 ? 'defend' : 'support');
      if (mates.length === 2) this.role = 'support';
    }
    // emergency: ball heading into our goal soon -> whoever is closest saves
    const threat = pred.goalThreat();
    this.threatened = threat && threat.team === car.team && threat.time - world.time < 2.5;
    if (this.threatened && better <= 1) this.role = 'attack';

    this.noise.set((Math.random() - 0.5) * d.aimNoise, (Math.random() - 0.5) * d.aimNoise, 0);
    if (this.role === 'attack') this.planAttack(ctx);
    else if (this.role === 'support') this.planSupport(ctx);
    else this.planDefend(ctx);
  }

  chaseScore(c, ball, dir) {
    const dx = ball.pos.x - c.pos.x, dy = ball.pos.y - c.pos.y;
    const dist = Math.hypot(dx, dy);
    // facing bonus and wrong-side penalty
    const fwd = c.R.col(0, _a);
    const facing = (fwd.x * dx + fwd.y * dy) / Math.max(1, dist);
    const wrongSide = (c.pos.y - ball.pos.y) * dir > 200 ? 1500 : 0;
    return dist + (1 - facing) * 400 + wrongSide + (c.isDemoed ? 1e6 : 0);
  }

  planAttack(ctx) {
    const car = this.car, d = this.d, world = ctx.world, pred = ctx.prediction;
    const dir = this.attackDir;
    const goal = _a.set(clamp(car.pos.x * 0.15, -500, 500), dir * (K.ARENA.Y + 400), 300);
    const speed = car.vel.len();
    const boostAvail = car.boost > 8 && d.boostUse > 0.4;
    let chosen = null;
    const now = world.time;
    for (let i = 2; i < pred.n; i += 2) {
      const s = pred.slices[i];
      const tAbs = pred.t0 + s.t;
      const tRel = tAbs - now;
      if (tRel < 0.05) continue;
      // shoot toward goal; when defending deep, clear to the side instead
      const sx = s.x, sy = s.y;
      let ax = goal.x - sx, ay = goal.y - sy;
      if (this.threatened && (sy * dir) < -K.ARENA.Y * 0.55) { ax = sx >= 0 ? 4000 - sx : -4000 - sx; ay = dir * 1500; }
      const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
      const hx = sx - ax * (BR + 45), hy = sy - ay * (BR + 45);
      const reach = this.reachHeight();
      if (s.z > reach) continue;
      const dx = hx - car.pos.x, dy = hy - car.pos.y;
      const dist = Math.hypot(dx, dy);
      const fwd = car.R.col(0, _b);
      const ang = Math.acos(clamp((fwd.x * dx + fwd.y * dy) / Math.max(1, dist), -1, 1));
      let extra = 0;
      if (s.z > 160) extra = s.z < 320 ? (jumpTimeFor(Math.max(0, s.z - 110)) || 1) * 0.3 : 0.4;
      const eta = this.eta(dist, ang, speed, boostAvail) + extra;
      if (eta <= tRel + 0.02) {
        chosen = { s, hx, hy, tAbs, ax, ay, dist };
        break;
      }
    }
    if (!chosen) {
      const s = pred.slices[Math.max(0, pred.n - 1)] || { x: world.ball.pos.x, y: world.ball.pos.y, z: world.ball.pos.z, t: 4 };
      chosen = { s, hx: s.x, hy: s.y - dir * 150, tAbs: pred.t0 + s.t, ax: 0, ay: dir, dist: 9999 };
    }
    const s = chosen.s;
    // wrong side of the ball? go around it toward our own goal side first
    const behind = (car.pos.y - s.y) * dir;
    if (behind > 120 && !this.threatened) {
      const side = car.pos.x > s.x ? 1 : -1;
      this.target.set(s.x + side * 700, s.y - dir * 900, 0);
      this.targetTime = 0;
      this.desiredSpeed = 2300;
      this.ballTarget = null;
      return;
    }
    this.target.set(chosen.hx + this.noise.x * 0.4, chosen.hy + this.noise.y * 0.4, 0);
    this.targetTime = chosen.tAbs;
    this.aimDir.set(chosen.ax, chosen.ay, 0);
    this.ballTarget = { x: s.x, y: s.y, z: s.z, t: chosen.tAbs };
    // aerial?
    if (s.z > 560 && d.aerial > 0 && car.boost > 25 && car.isOnGround && car.up.z > 0.9 && chosen.dist < 2600 && !this.script) {
      this.startAerial(chosen.tAbs, s);
    } else if (s.z > 170 && s.z < 600 && Math.random() < d.jumpShots) {
      this.wantJump = { at: chosen.tAbs, z: s.z };
    } else this.wantJump = null;
  }

  reachHeight() {
    const d = this.d;
    if (d.aerial > 0 && this.car.boost > 25) return Math.min(K.ARENA.Z - 150, d.aerialMax);
    return d.jumpShots > 0.5 ? 500 : 260;
  }

  eta(dist, angle, v0, boost) {
    // crude 1D acceleration model + turning time
    let t = angle / 2.2 + (angle > 1.6 ? 0.35 : 0);
    let v = Math.max(0, v0 * Math.cos(Math.min(angle, Math.PI / 2))), x = 0;
    const cap = this.d.speedCap;
    const dt = 1 / 30;
    while (x < dist && t < 6) {
      let a = curve(K.DRIVE_SPEED_TORQUE_CURVE, v) * K.THROTTLE_ACCEL;
      if (boost) a += K.BOOST_ACCEL_GROUND;
      v = Math.min(cap, v + a * dt);
      x += v * dt; t += dt;
    }
    return t;
  }

  planSupport(ctx) {
    const car = this.car, world = ctx.world, ball = world.ball, dir = this.attackDir;
    this.wantJump = null; this.ballTarget = null;
    // grab boost if low and a big pad is reasonably on the way
    if (car.boost < 35) {
      let best = null, bd = 1e9;
      for (const p of world.pads) {
        if (!p.active || !p.big) continue;
        const dd = Math.hypot(p.x - car.pos.x, p.y - car.pos.y) + Math.abs(p.y - (ball.pos.y - dir * 2000)) * 0.4;
        if (dd < bd) { bd = dd; best = p; }
      }
      if (best && bd < 5000) { this.target.set(best.x, best.y, 0); this.targetTime = 0; this.desiredSpeed = 2300; return; }
    }
    this.target.set(clamp(ball.pos.x * 0.45, -3000, 3000), clamp(ball.pos.y - dir * 2400, -4600, 4600), 0);
    this.targetTime = 0;
    this.desiredSpeed = 1400 + Math.min(900, Math.hypot(this.target.x - car.pos.x, this.target.y - car.pos.y) * 0.4);
  }

  planDefend(ctx) {
    const car = this.car, world = ctx.world, ball = world.ball, dir = this.attackDir;
    this.wantJump = null; this.ballTarget = null;
    const gy = -dir * (K.ARENA.Y - 350);
    this.target.set(clamp(ball.pos.x * 0.25, -700, 700), gy, 0);
    this.targetTime = 0;
    const d = Math.hypot(this.target.x - car.pos.x, this.target.y - car.pos.y);
    this.desiredSpeed = d > 1500 ? 2300 : clamp(d * 1.2, 0, 1400);
    this.faceBall = d < 400;
  }

  startAerial(tAbs, s) {
    this.mode = 'aerial';
    this.aerialTarget.set(s.x, s.y, s.z);
    this.aerialTime = tAbs;
    this.script = { t: 0, steps: [[0.2, { jump: true }], [0.04, {}], [0.05, { jump: true }]], keepSteer: true };
  }

  // ---- per-tick control ----------------------------------------------------------
  think(ctx, dt) {
    const car = this.car, c = car.controls, world = ctx.world;
    Object.assign(c, { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false });
    if (car.isDemoed) return;
    if (ctx.kickoff && !this.kickoffDone) { this.kickoff(ctx, dt); return; }

    this.planTimer -= dt;
    if (this.planTimer <= 0 && this.mode !== 'aerial') { this.planTimer = this.d.reaction; this.plan(ctx); }

    // scripted button sequences (jumps / flips)
    if (this.script) {
      const sc = this.script;
      sc.t += dt;
      let acc = 0, step = null;
      for (const st of sc.steps) { acc += st[0]; if (sc.t <= acc) { step = st[1]; break; } }
      if (step) {
        Object.assign(c, step);
        if (this.mode === 'aerial') this.aerialSteer(world, c, true);
        else if (sc.keepSteer) this.driveTo(this.target, 2300, c, true);
        return;
      }
      this.script = null;
    }

    if (this.mode === 'aerial') { if (this.aerialControl(world, c, dt)) return; this.mode = 'drive'; }

    // airborne: recover to land on wheels
    if (car.numContacts === 0 && !car.isJumping) { this.recover(c); this.unstuck(dt, c); return; }

    // turtle
    if (car.numContacts === 0 && car.worldContact) { c.jump = Math.random() < 0.5; return; }

    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      c.throttle = -1; c.steer = Math.sin(this.reverseTime * 4) > 0 ? 1 : -1;
      return;
    }

    let desired = this.desiredSpeed;
    if (this.role === 'attack' && this.targetTime > 0) {
      const dist = Math.hypot(this.target.x - car.pos.x, this.target.y - car.pos.y);
      const tLeft = Math.max(0.05, this.targetTime - world.time);
      desired = clamp(dist / tLeft, 0, 2300);
      if (this.threatened || dist > 2500) desired = 2300;
    }
    this.driveTo(this.target, Math.min(desired, this.d.speedCap), c);

    // face the ball when parked in goal
    if (this.role === 'defend' && this.faceBall) {
      const loc = localOf(car, world.ball.pos, _l);
      const ang = Math.atan2(loc.y, loc.x);
      c.steer = clamp(-ang * 2, -1, 1);
      c.throttle = Math.abs(ang) > 0.4 ? (loc.x > 0 ? 0.4 : -0.4) : 0;
      c.boost = false;
    }

    // jump shots and power flips
    if (this.role === 'attack' && this.ballTarget) this.shotLogic(world, c);
    this.unstuck(dt, c);
  }

  driveTo(target, desiredSpeed, c, steerOnly = false) {
    const car = this.car;
    const loc = localOf(car, target, _l);
    const ang = Math.atan2(loc.y, loc.x);
    const dist = Math.hypot(loc.x, loc.y);
    const yawRate = car.angVel.dot(car.R.col(2, _a));
    c.steer = clamp(-ang * this.d.turnGain + yawRate * 0.15, -1, 1);
    if (steerOnly) return;
    const fwdSpeed = car.forwardSpeed;
    // powerslide for tight turns at speed
    c.handbrake = Math.abs(ang) > 1.25 && fwdSpeed > 650 && car.isOnGround && dist < 2500;
    // turn around on the spot by reversing when target is right behind and close
    if (Math.abs(ang) > 2.6 && dist < 500 && fwdSpeed < 300) { c.throttle = -1; c.steer = -c.steer; return; }
    const err = desiredSpeed - fwdSpeed;
    if (err > 60) {
      c.throttle = 1;
      const wantBoost = desiredSpeed > 1450 && Math.abs(ang) < 0.3 && car.isOnGround && car.up.z > 0.8;
      const reserve = this.role === 'attack' ? 0 : 30;
      c.boost = wantBoost && car.boost > reserve && Math.random() < this.d.boostUse + 0.3 && fwdSpeed < 2280;
    } else if (err < -250) c.throttle = -1;
    else c.throttle = clamp(err / 250, -0.3, 1);
  }

  shotLogic(world, c) {
    const car = this.car, bt = this.ballTarget, d = this.d;
    const tLeft = bt.t - world.time;
    const bp = world.ball.pos;
    const dist = Math.hypot(bp.x - car.pos.x, bp.y - car.pos.y);
    if (!car.isOnGround || this.script) return;
    if (this.wantJump && tLeft > 0) {
      const h = this.wantJump.z - 100;
      const jt = h > 300 ? doubleJumpTimeFor(h) : jumpTimeFor(Math.max(10, h));
      if (jt != null && tLeft <= jt + 0.02 && dist < 900) {
        if (h > 300) this.script = { t: 0, steps: [[0.2, { jump: true }], [0.03, {}], [0.05, { jump: true }], [0.3, {}]], keepSteer: true };
        else this.script = { t: 0, steps: [[Math.min(0.2, 0.05 + h / 900), { jump: true }], [0.3, {}]], keepSteer: true };
        this.wantJump = null;
        return;
      }
    }
    // front flip into a ground ball for power
    const loc = localOf(car, bp, _l);
    const ang = Math.atan2(loc.y, loc.x);
    if (bp.z < 180 && dist < 420 && dist > 200 && Math.abs(ang) < 0.25 && car.forwardSpeed > 900 && Math.random() < d.flip * 0.2) {
      const yaw = clamp(-ang * 3, -1, 1);
      this.script = { t: 0, steps: [[0.06, { jump: true }], [0.03, {}], [0.06, { jump: true, pitch: -1, yaw }], [0.55, { pitch: 0 }]] };
    }
  }

  aerialSteer(world, c, inScript) {
    const car = this.car;
    const tLeft = Math.max(0.05, this.aerialTime - world.time);
    const pos = car.pos, vel = car.vel;
    const want = _a.set(
      this.aerialTarget.x - (pos.x + vel.x * tLeft),
      this.aerialTarget.y - (pos.y + vel.y * tLeft),
      this.aerialTarget.z - (pos.z + vel.z * tLeft + 0.5 * K.GRAVITY_Z * tLeft * tLeft),
    );
    const need = want.len();
    const dir = need > 1 ? want.clone().scale(1 / need) : car.R.col(0, new V3());
    this.orient(dir, new V3(0, 0, 1), c, 5, 1.1);
    return { need, dir, tLeft };
  }

  aerialControl(world, c, dt) {
    const car = this.car;
    const { need, dir, tLeft } = this.aerialSteer(world, c, false);
    const fwd = car.R.col(0, _b);
    const accelNeeded = 2 * need / (tLeft * tLeft);
    c.boost = fwd.dot(dir) > 0.8 && accelNeeded > 150 && car.boost > 0;
    c.throttle = 1;
    // abort conditions
    const ballNow = world.ball.pos;
    const off = Math.hypot(ballNow.x - this.aerialTarget.x, ballNow.y - this.aerialTarget.y) > 1500;
    if (world.time > this.aerialTime + 0.25 || car.isOnGround && world.time > this.aerialTime - 3 && car.airTime === 0 && !car.isJumping && car.jumpTime > 0.5 || accelNeeded > 2600 && tLeft < 0.6 || off) {
      this.mode = 'drive';
      return false;
    }
    // dodge into the ball at the end
    const toBall = Math.hypot(ballNow.x - car.pos.x, ballNow.y - car.pos.y, ballNow.z - car.pos.z);
    if (toBall < 220 && !car.hasFlipped && this.d.flip > 0.5 && !car.hasDoubleJumped) {
      this.script = { t: 0, steps: [[0.05, { jump: true, pitch: -1 }], [0.3, {}]] };
      this.mode = 'drive';
    }
    return true;
  }

  /** PD orientation: point nose along dir with roof toward up. */
  orient(dir, up, c, kp = 4, kd = 0.9) {
    const car = this.car, R = car.R;
    const f = R.col(0, new V3()), l = R.col(1, new V3()), u = R.col(2, new V3());
    const w = car.angVel;
    const e = new V3().crossVectors(f, dir);
    const errPitch = -e.dot(l), errYaw = -e.dot(u);
    // roll: bring roof toward the desired up (projected)
    const upP = up.clone().addScaled(dir, -up.dot(dir)).normalize();
    const er = new V3().crossVectors(u, upP).dot(f);
    const behind = f.dot(dir) < 0;
    c.pitch = clamp(kp * (behind && Math.abs(errPitch) < 0.2 ? sign(errPitch || 1) : errPitch) - kd * (-w.dot(l)), -1, 1);
    c.yaw = clamp(kp * errYaw - kd * (-w.dot(u)), -1, 1);
    c.roll = clamp(3 * er - 0.6 * w.dot(f), -1, 1);
  }

  recover(c) {
    const car = this.car;
    if (this.d.recovery < 1 && Math.random() > this.d.recovery) return;
    const v = car.vel.clone(); v.z = 0;
    if (v.lenSq() < 100) car.R.col(0, v), v.z = 0;
    v.normalize();
    // land facing velocity, wheels down (or toward a nearby wall)
    let up = new V3(0, 0, 1);
    const p = car.pos;
    if (Math.abs(p.x) > K.ARENA.X - 500 && p.z > 300) up = new V3(-sign(p.x), 0, 0.3).normalize();
    this.orient(v, up, c, 3, 0.8);
    c.throttle = 1;
  }

  unstuck(dt, c) {
    const car = this.car;
    if (car.isOnGround && Math.abs(car.forwardSpeed) < 60 && Math.abs(c.throttle) > 0.5) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 1.2) { this.stuckTime = 0; this.reverseTime = 0.6; }
    // upside down on the ground: autoflip
    if (car.numContacts === 0 && car.worldContact && car.up.z < -0.5) c.jump = !car.lastJump;
  }

  kickoff(ctx, dt) {
    const car = this.car, c = car.controls, world = ctx.world, ball = world.ball;
    // only the kicker goes; others grab boost / fall back
    const isKicker = ctx.kicker === car;
    if (!isKicker) {
      const dir = this.attackDir;
      this.target.set(sign(car.pos.x || 1) * 3072, -dir * 4096, 0);
      if (Math.abs(car.pos.y) > 4300) this.target.set(0, -dir * 4800, 0);
      this.driveTo(this.target, 1800, c);
      if (car.boost > 90 || Math.hypot(car.pos.x - this.target.x, car.pos.y - this.target.y) < 300 || ball.vel.lenSq() > 100) this.kickoffDone = true;
      return;
    }
    if (this.script) {
      const sc = this.script; sc.t += dt;
      let acc = 0, step = null;
      for (const st of sc.steps) { acc += st[0]; if (sc.t <= acc) { step = st[1]; break; } }
      if (step) { Object.assign(c, step); c.boost = true; return; }
      this.script = null; this.kickoffDone = true; return;
    }
    const dist = Math.hypot(ball.pos.x - car.pos.x, ball.pos.y - car.pos.y);
    const aim = _b.set(ball.pos.x, ball.pos.y - this.attackDir * 40, 0);
    this.driveTo(aim, 2300, c, true);
    c.throttle = 1;
    c.boost = this.d.kickoffBoost && car.boost > 0;
    const flipAt = car.vel.len() > 1400 ? 720 : 520;
    if (dist < flipAt && this.d.flip > 0.3 && car.isOnGround) {
      this.script = { t: 0, steps: [[0.05, { jump: true }], [0.03, {}], [0.06, { jump: true, pitch: -1 }], [0.6, { pitch: 0 }]] };
    } else if (dist < 250 || ball.vel.lenSq() > 100) this.kickoffDone = true;
  }
}
