// Runs oracle scenarios on SoccerRocket's own physics (public/js/physics) and
// produces the same output schema as rs_oracle (see README.md).
//
//   node tools/rocketsim/run-js.mjs scenario.json [...]   (no files: stdin)
//
// Frames and control conventions are RocketSim's. Both engines use the same
// numeric world frame (x, y, z up; same arena, symmetric in x). Rocket League
// calls car-local +y "right" while SoccerRocket calls it "left", so the
// steer / yaw / roll inputs, which RL defines as "turn/roll to the right", are
// negated when handed to our Car. Pitch, throttle and the buttons map 1:1.
// Orientation: RocketSim Angle(yaw, pitch, roll).ToRotMat() is
// Rz(yaw) * Ry(-pitch) * Rx(-roll) (btMatrix3x3::setEulerYPR); rotMatRS builds
// it the same way in 32-bit floats, so that exact ties (roll = pi: which way
// does the auto-flip go?) break the same way in both engines.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// SR_PHYSICS_DIR=<dir> runs a different copy of public/js/physics (A/B tests
// of candidate fixes without touching the game).
const PHYS = process.env.SR_PHYSICS_DIR
  ? pathToFileURL(path.resolve(process.env.SR_PHYSICS_DIR)).href + '/'
  : new URL('../../public/js/physics/', import.meta.url).href;
const { World } = await import(PHYS + 'world.js');
const K = await import(PHYS + 'constants.js');

export const PARKED_BALL_POS = [0, 0, 1900];

/**
 * rs_oracle reuses one Arena per pad setting for every scenario of a run, and
 * a fresh Arena differs on its first tick: Bullet's solver info still holds
 * its default 1/60 s time step, which btVehicleRL's extra suspension pushback
 * reads. These 1-tick scenarios go first in every oracle run, so each real
 * scenario starts on an Arena that has stepped (like a running game, and
 * like our World), whatever the batch order. Returns the files' paths.
 */
export function writeOracleWarmup(dir) {
  const docs = [{ name: 'warmup', ticks: 1 }, { name: 'warmup_pads', ticks: 1, pads: true }];
  return docs.map((d) => {
    const f = path.join(dir, `${d.name}.json`);
    fs.writeFileSync(f, JSON.stringify(d));
    return f;
  });
}

export const PHYSICS_DIR = PHYS;
const v3 = (a, def) => (Array.isArray(a) && a.length >= 3 ? a : def);
const arr = (v) => [v.x, v.y, v.z];

export function quatFromBasis(f, l, u, q) {
  // rotation matrix columns f, l, u -> quaternion (Shepperd)
  const m00 = f[0], m10 = f[1], m20 = f[2];
  const m01 = l[0], m11 = l[1], m21 = l[2];
  const m02 = u[0], m12 = u[1], m22 = u[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q.set((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s);
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q.set(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q.set((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s);
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q.set((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s);
  }
  return q.normalize();
}

// Angle(yaw, pitch, roll).ToRotMat(): setEulerYPR(yaw, -pitch, -roll) ->
// setEulerZYX(-roll, -pitch, yaw), in float like RocketSim; returns columns.
export function rotMatRS(yaw, pitch, roll) {
  const f = Math.fround;
  const X = f(-f(roll)), Y = f(-f(pitch)), Z = f(yaw);
  const ci = f(Math.cos(X)), cj = f(Math.cos(Y)), ch = f(Math.cos(Z));
  const si = f(Math.sin(X)), sj = f(Math.sin(Y)), sh = f(Math.sin(Z));
  const cc = f(ci * ch), cs = f(ci * sh), sc = f(si * ch), ss = f(si * sh);
  return [
    [f(cj * ch), f(cj * sh), -sj],
    [f(f(sj * sc) - cs), f(f(sj * ss) + cc), f(cj * si)],
    [f(f(sj * cc) + ss), f(f(sj * cs) - sc), f(cj * ci)],
  ];
}

const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Applies one controls-timeline entry (RL conventions) onto an RL-convention control state. */
function mergeControls(c, e) {
  for (const k of ['throttle', 'steer', 'pitch', 'yaw', 'roll', 'jump', 'boost', 'handbrake']) {
    if (e[k] !== undefined && e[k] !== null) c[k] = e[k];
  }
  if ('targetSpeed' in e) c.targetSpeed = typeof e.targetSpeed === 'number' ? e.targetSpeed : null;
}

/** Cruise control shared with rs_oracle.cpp: P-controller on forward speed. */
export function cruiseThrottle(target, fwdSpeed) {
  const t = (target - fwdSpeed) / 100 + 0.01;
  return t < 0.01 ? 0.01 : t > 1 ? 1 : t;
}

/**
 * opts.beforeStep(t, world, cars): called before tick t + 1 is simulated
 * (after the controls are set), e.g. to overwrite body states (onestep.mjs).
 */
export function runScenarioJS(sc, opts = {}) {
  const ticks = sc.ticks ?? 120;
  const every = Math.max(1, sc.every ?? 1);
  const w = new World();
  w.goalsEnabled = true;
  w.unlimitedBoost = !!sc.unlimitedBoost;
  if (!sc.pads) for (const p of w.pads) { p.active = false; p.timer = 1e12; }

  const ball = w.ball;
  if (sc.ball) {
    ball.frozen = false;
    const p = v3(sc.ball.pos, [0, 0, K.BALL_REST_Z]);
    ball.reset(p[0], p[1], p[2]);
    ball.vel.set(...v3(sc.ball.vel, [0, 0, 0]));
    ball.angVel.set(...v3(sc.ball.angVel, [0, 0, 0]));
  } else {
    // Parked like rs_oracle: zero velocity, so it sleeps (RocketSim Arena::Step)
    ball.reset(...PARKED_BALL_POS);
    ball.frozen = false;
  }

  const cars = [];
  const timelines = [];
  for (const cj of sc.cars || []) {
    const car = w.addCar(cj.team ? 1 : 0);
    const p = v3(cj.pos, [0, 0, K.CAR_SPAWN_REST_Z]);
    car.reset(p[0], p[1], p[2], cj.yaw ?? 0);
    if (cj.forward) {
      const f = norm(cj.forward);
      const up0 = cj.up || [0, 0, 1];
      const l = norm(cross(up0, f));
      const u = norm(cross(f, l));
      quatFromBasis(f, l, u, car.quat);
    } else {
      const [f, l, u] = rotMatRS(cj.yaw ?? 0, cj.pitch ?? 0, cj.roll ?? 0);
      quatFromBasis(f, l, u, car.quat);
    }
    car.R.fromQuat(car.quat);
    car.vel.set(...v3(cj.vel, [0, 0, 0]));
    car.angVel.set(...v3(cj.angVel, [0, 0, 0]));
    car.boost = cj.boost ?? K.BOOST_SPAWN_AMOUNT;
    if (cj.isOnGround === false) car.isOnGround = false;
    if (cj.hasJumped) car.hasJumped = true;
    if (cj.hasDoubleJumped) car.hasDoubleJumped = true;
    if (cj.hasFlipped) car.hasFlipped = true;
    if (cj.airTimeSinceJump) car.airTimeSinceJump = cj.airTimeSinceJump;
    cars.push(car);
    timelines.push([...(cj.controls || [])].sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0)));
  }
  const rl = cars.map(() => ({ throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false, targetSpeed: null }));
  const tlPos = cars.map(() => 0);

  const frames = [];
  const events = [];
  let goalSeen = false;
  const r7 = (x) => (x === 0 ? 0 : +x.toPrecision(7));
  const vec = (v) => [r7(v.x), r7(v.y), r7(v.z)];
  const frame = (tick) => {
    frames.push({
      tick,
      ball: { pos: vec(ball.pos), vel: vec(ball.vel), angVel: vec(ball.angVel) },
      cars: cars.map((c) => ({
        pos: vec(c.pos), vel: vec(c.vel), angVel: vec(c.angVel),
        fwd: vec(c.R.col(0, { set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } })),
        up: vec(c.R.col(2, { set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } })),
        onGround: !!c.isOnGround, wheels: c.numContacts,
        hasJumped: !!c.hasJumped, hasDoubleJumped: !!c.hasDoubleJumped, hasFlipped: !!c.hasFlipped,
        isFlipping: !!c.isFlipping, isJumping: !!c.isJumping,
        boost: r7(c.boost), demoed: !!c.isDemoed, handbrake: r7(c.handbrakeVal), supersonic: !!c.isSupersonic,
        jumpTime: r7(c.jumpTime || 0), flipTime: r7(c.flipTime || 0), airTime: r7(c.airTime || 0),
      })),
    });
  };

  frame(0);
  for (let t = 0; t < ticks; t++) {
    cars.forEach((car, i) => {
      const tl = timelines[i];
      while (tlPos[i] < tl.length && (tl[tlPos[i]].tick ?? 0) <= t) mergeControls(rl[i], tl[tlPos[i]++]);
      const c = rl[i];
      let throttle = c.throttle;
      if (c.targetSpeed !== null && c.targetSpeed !== undefined) {
        const fwdSpeed = car.vel.x * car.R.e[0] + car.vel.y * car.R.e[3] + car.vel.z * car.R.e[6];
        throttle = cruiseThrottle(c.targetSpeed, fwdSpeed);
      }
      Object.assign(car.controls, {
        throttle, steer: -c.steer, pitch: c.pitch, yaw: -c.yaw, roll: -c.roll,
        jump: !!c.jump, boost: !!c.boost, handbrake: !!c.handbrake,
      });
    });
    if (opts.beforeStep) opts.beforeStep(t, w, cars);
    const ev = w.step();
    for (const e of ev) {
      if (e.type === 'ballHit') events.push({ tick: t + 1, type: 'ballHit', car: cars.indexOf(e.car), extraVel: null });
      else if (e.type === 'bump' || e.type === 'demo') events.push({ tick: t + 1, type: e.type, attacker: cars.indexOf(e.attacker), victim: cars.indexOf(e.victim) });
      else if (e.type === 'goal' && !goalSeen) { goalSeen = true; events.push({ tick: t + 1, type: 'goal', team: e.team }); }
    }
    if ((t + 1) % every === 0 || t + 1 === ticks) frame(t + 1);
  }
  return { name: sc.name || 'unnamed', engine: 'soccerrocket', ticks, every, frames, events };
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const files = process.argv.slice(2);
  const docs = files.length ? files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))) : [JSON.parse(fs.readFileSync(0, 'utf8'))];
  const scs = [];
  let asArray = docs.length > 1;
  for (const d of docs) { if (Array.isArray(d)) { asArray = true; scs.push(...d); } else scs.push(d); }
  const res = scs.map((s) => runScenarioJS(s));
  process.stdout.write(JSON.stringify(asArray ? res : res[0]) + '\n');
}
