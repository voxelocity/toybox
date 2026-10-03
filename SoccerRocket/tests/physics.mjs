// Physics behaviour checks against documented car-soccer measurements.
// Run: node tests/physics.mjs
import { World } from '../public/js/physics/world.js';
import * as K from '../public/js/physics/constants.js';

let fails = 0;
const results = [];
function check(name, value, lo, hi, unit = '') {
  const ok = value >= lo && value <= hi;
  if (!ok) fails++;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${value.toFixed(2)}${unit}  (expected ${lo}..${hi})`);
}
function info(name, value, unit = '') { results.push(`INFO  ${name}: ${typeof value === 'number' ? value.toFixed(3) : value}${unit}`); }

function freshCar(x = 0, y = 0, yaw = Math.PI / 2, opts = {}) {
  const w = new World();
  w.goalsEnabled = false;
  w.ball.frozen = true;
  w.ball.reset(0, 4000, 93.15);
  const car = w.addCar(0);
  car.reset(x, y, K.CAR_SPAWN_REST_Z + 3, yaw);
  car.boost = 100;
  if (!opts.pads) for (const p of w.pads) { p.active = false; p.timer = 1e9; }
  // settle
  for (let i = 0; i < 120; i++) w.step();
  return { w, car };
}
const run = (w, secs, fn) => { const n = Math.round(secs * K.TICK_RATE); for (let i = 0; i < n; i++) { if (fn) fn(i / K.TICK_RATE); w.step(); } };

// 1. Rest height
{
  const { car } = freshCar();
  check('rest height', car.pos.z, 16, 18.5, ' uu');
  check('rest wheel contacts', car.numContacts, 4, 4);
  check('rest speed', car.vel.len(), 0, 1, ' uu/s');
  // documented Octane-class (Fennec) resting inclination: -0.55 deg (nose down)
  check('rest inclination', Math.asin(car.forward.z) * 180 / Math.PI, -0.75, -0.4, ' deg');
}

// 2. Throttle-only top speed and acceleration
{
  const { w, car } = freshCar(0, -4500);
  car.controls.throttle = 1;
  run(w, 0.25);
  const v1 = car.vel.len();
  check('throttle accel 0-0.25s (avg)', v1 / 0.25, 1350, 1650, ' uu/s^2');
  run(w, 5);
  check('throttle top speed', car.vel.len(), 1395, 1420, ' uu/s');
}

// 3. Boost top speed and time to supersonic
{
  const { w, car } = freshCar(0, -4800);
  w.unlimitedBoost = true;
  car.controls.throttle = 1; car.controls.boost = true;
  let tSuper = -1, t = 0;
  run(w, 4.5, (tt) => { t = tt; if (tSuper < 0 && car.isSupersonic) tSuper = tt; });
  check('boost top speed', car.vel.len(), 2295, 2300.1, ' uu/s');
  check('time to supersonic', tSuper, 1.4, 2.4, ' s');
}

// 4. Boost consumption (full tank lasts ~3 s)
{
  const { w, car } = freshCar(0, -4800);
  car.boost = 100; car.controls.boost = true;
  let t = -1;
  run(w, 4, (tt) => { if (t < 0 && car.boost <= 0) t = tt; });
  check('boost tank duration', t, 2.95, 3.1, ' s');
}

// 5. Braking from 1400
{
  const { w, car } = freshCar(0, -4800);
  car.controls.throttle = 1;
  run(w, 4);
  const v0 = car.vel.dot(car.forward);
  car.controls.throttle = -1;
  let t = -1;
  run(w, 2, (tt) => { if (t < 0 && car.vel.dot(car.forward) <= 0) t = tt; });
  check('brake decel', v0 / t, 3000, 3700, ' uu/s^2');
}

// 6. Coasting decel
{
  const { w, car } = freshCar(0, -4800);
  car.controls.throttle = 1;
  run(w, 4);
  const v0 = car.vel.len();
  car.controls.throttle = 0;
  run(w, 0.5);
  check('coast decel', (v0 - car.vel.len()) / 0.5, 450, 600, ' uu/s^2');
}

// 7. Jumps
{
  const { w, car } = freshCar();
  const z0 = car.pos.z;
  car.controls.jump = true;
  let maxZ = 0;
  run(w, 1.2, () => { maxZ = Math.max(maxZ, car.pos.z); });
  check('full single jump height', maxZ - z0, 200, 260, ' uu');
}
{
  const { w, car } = freshCar();
  const z0 = car.pos.z;
  let maxZ = 0;
  run(w, 1.4, (t) => {
    car.controls.jump = t < 0.2 || (t > 0.25 && t < 0.3);
    maxZ = Math.max(maxZ, car.pos.z);
  });
  check('double jump height', maxZ - z0, 430, 560, ' uu');
}
{
  const { w, car } = freshCar();
  const z0 = car.pos.z;
  let maxZ = 0;
  run(w, 1.0, (t) => { car.controls.jump = t < 1 / 120; maxZ = Math.max(maxZ, car.pos.z); });
  check('min (tap) jump height', maxZ - z0, 40, 110, ' uu');
}

// 8. Front flip from standstill
{
  const { w, car } = freshCar();
  let landed = false, vmax = 0;
  run(w, 1.6, (t) => {
    car.controls.jump = t < 0.05 || (t > 0.1 && t < 0.15);
    car.controls.pitch = t > 0.09 ? -1 : 0;
    if (t > 0.12) vmax = Math.max(vmax, Math.hypot(car.vel.x, car.vel.y));
  });
  check('front flip horizontal speed', vmax, 480, 560, ' uu/s');
  info('front flip final up.z', car.up.z);
  check('car upright after flip + settle', (run(w, 1.5), car.up.z), 0.9, 1.01);
}

// 9. Turning circle at low speed vs documented curvature
for (const target of [500, 1000, 1500, 2200]) {
  const { w, car } = freshCar(-1500, -4300);
  w.unlimitedBoost = true;
  car.controls.throttle = 1;
  // accelerate to target
  let reached = false;
  run(w, 4, () => {
    const v = car.vel.len();
    if (!reached && v >= target) reached = true;
    car.controls.throttle = reached ? (v > target ? 0.01 : 1) : 1;
    car.controls.boost = target > 1400 && v < target - 5;
  });
  car.controls.steer = 1;
  let yaw0 = Math.atan2(car.forward.y, car.forward.x), dyaw = 0, prev = yaw0, vSum = 0, n = 0;
  run(w, 1.0, () => {
    const y = Math.atan2(car.forward.y, car.forward.x);
    let d = y - prev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
    dyaw += d; prev = y;
    const v = car.vel.len();
    car.controls.throttle = v > target ? 0.01 : 1;
    car.controls.boost = target > 1400 && v < target - 5;
    vSum += v; n++;
  });
  const vAvg = vSum / n;
  const curvature = Math.abs(dyaw) / (vAvg * 1.0);
  const doc = { 500: 0.00398, 1000: 0.00235, 1500: 0.001375, 2200: 0.000913 }[target];
  check(`turn curvature @${target}`, curvature * 1000, doc * 1000 * 0.93, doc * 1000 * 1.07, ' /1000uu');
}

// 10. Ball bounce
{
  const w = new World();
  w.goalsEnabled = false;
  w.ball.reset(0, 0, 1000);
  w.ball.vel.z = -1; // a ball with exactly zero velocity sleeps (RocketSim), like on the kickoff spot
  let maxZ2 = 0, bounced = false;
  run(w, 3.5, () => {
    if (w.ball.vel.z > 0) bounced = true;
    if (bounced) maxZ2 = Math.max(maxZ2, w.ball.pos.z);
  });
  const h0 = 1000 - K.BALL_RADIUS, h1 = maxZ2 - K.BALL_RADIUS;
  check('ball bounce height ratio (~0.6^2 minus drag)', h1 / h0, 0.30, 0.37);
}
// ball rolling spin: slide into roll
{
  const w = new World();
  w.goalsEnabled = false;
  w.ball.reset(0, -3000, K.BALL_RADIUS);
  w.ball.vel.set(0, 1500, -100);
  run(w, 1);
  const rollSpeed = w.ball.angVel.len() * K.BALL_RADIUS;
  info('ball surface speed / linear (rolling ~1, capped by max ang 6)', rollSpeed / w.ball.vel.len());
}

// 11. Ball hit by a supersonic car goes fast
{
  const { w, car } = freshCar(0, -2500);
  w.ball.frozen = false;
  w.ball.reset(0, 0, K.BALL_REST_Z);
  w.unlimitedBoost = true;
  car.controls.throttle = 1; car.controls.boost = true;
  let hitSpeed = 0;
  run(w, 3, () => { for (const e of w.events) if (e.type === 'ballHit' && !hitSpeed) hitSpeed = 1; });
  // RocketSim, same setup (tools/rocketsim oracle, 3 s from rest): 2796 uu/s
  check('ball speed after supersonic hit', w.ball.vel.len(), 2750, 2850, ' uu/s');
}

// 12. Drive up the wall: car turns into wall at speed and sticks
{
  const { w, car } = freshCar(3000, 0, 0); // facing +x toward right wall
  w.unlimitedBoost = true;
  car.controls.throttle = 1;
  let maxZ = 0, onWallTicks = 0;
  run(w, 4, () => {
    maxZ = Math.max(maxZ, car.pos.z);
    if (car.isOnGround && Math.abs(car.up.x) > 0.9) onWallTicks++;
    car.controls.boost = car.pos.z < 900;
  });
  check('wall drive: max height', maxZ, 600, 2100, ' uu');
  check('wall drive: ticks on wall', onWallTicks, 30, 1e9);
}

// 13. Car-car demo
{
  const w = new World();
  w.goalsEnabled = false; w.ball.frozen = true; w.ball.reset(0, 4500, 93);
  const a = w.addCar(0), b = w.addCar(1);
  a.reset(0, -4000, 17, Math.PI / 2); b.reset(0, 1000, 17, 0);
  w.unlimitedBoost = true;
  let demo = false;
  run(w, 3.5, () => { a.controls.throttle = 1; a.controls.boost = true; for (const e of w.events) if (e.type === 'demo') demo = true; });
  check('supersonic demo occurs', demo ? 1 : 0, 1, 1);
}

// 14. Air roll rate
{
  const { w, car } = freshCar();
  car.reset(0, 0, 1000, Math.PI / 2);
  car.isOnGround = false;
  let maxW = 0;
  run(w, 0.5, () => { car.controls.roll = 1; maxW = Math.max(maxW, car.angVel.len()); });
  check('air roll saturates at max ang speed', maxW, 5.4, 5.51, ' rad/s');
}

// 15. Pads
{
  const { w, car } = freshCar(-3072, -3600, -Math.PI / 2, { pads: true });
  car.boost = 0;
  car.controls.throttle = 1;
  run(w, 1.5);
  check('big pad pickup', car.boost, 99, 100);
}

// 16. Performance
{
  const w = new World();
  for (let i = 0; i < 6; i++) w.addCar(i % 2);
  w.setupKickoff();
  for (const c of w.cars) { c.controls.throttle = 1; c.controls.boost = true; }
  const t0 = performance.now();
  run(w, 10);
  const ms = (performance.now() - t0) / (10 * K.TICK_RATE);
  check('ms per tick (6 cars)', ms, 0, 0.6, ' ms');
}


// 17. Turtle recovery (upside down on the floor, press jump)
{
  const { w, car } = freshCar();
  car.reset(0, 0, 60, Math.PI / 2);
  car.quat.setEuler(Math.PI / 2, 0, Math.PI);
  car.R.fromQuat(car.quat);
  run(w, 1.5);
  info('turtle: up.z before jump', car.up.z);
  run(w, 2.5, (t) => { car.controls.jump = t < 0.05; });
  check('turtle recovery: upright', car.up.z, 0.9, 1.01);
}

// 18. Goal scoring and post bounce
{
  const w = new World();
  w.ball.reset(0, 3500, 300);
  w.ball.vel.set(0, 2500, 0);
  let goal = null;
  run(w, 2, () => { for (const e of w.events) if (e.type === 'goal' && !goal) goal = e; });
  check('shot into orange goal scores for blue', goal && goal.team === 0 ? 1 : 0, 1, 1);
}
{
  const w = new World();
  w.ball.reset(893 + 40, 3500, 300);
  w.ball.vel.set(0, 2500, 0);
  let goal = false, minVy = 0;
  run(w, 2, () => { for (const e of w.events) if (e.type === 'goal') goal = true; minVy = Math.min(minVy, w.ball.vel.y); });
  check('post hit does not score', goal ? 1 : 0, 0, 0);
  check('post hit bounces back', -minVy, 500, 3000, ' uu/s');
}

// 19. Ball containment under random shots
{
  const w = new World();
  w.goalsEnabled = false;
  let worst = -1e9, nan = false;
  const rnd = (a) => (Math.random() * 2 - 1) * a;
  for (let k = 0; k < 40; k++) {
    w.ball.reset(rnd(3000), rnd(4000), 100 + Math.random() * 1500);
    w.ball.vel.set(rnd(6000), rnd(6000), rnd(6000)).clampLength(6000);
    run(w, 3, () => {
      const p = w.ball.pos;
      if (!Number.isFinite(p.x + p.y + p.z)) nan = true;
      const outX = Math.abs(p.x) - 4096, outZ = Math.max(-p.z, p.z - 2044);
      const outY = Math.abs(p.x) < 893 ? Math.abs(p.y) - 6000 : Math.abs(p.y) - 5120;
      worst = Math.max(worst, outX, outY, outZ);
    });
  }
  // Bullet (RocketSim) has no continuous collision: a 6000 uu/s ball can sink up
  // to one tick of travel (50 uu) into a wall before it is pushed out, exactly
  // as in RocketSim (oracle: 44.9 uu). The centre must stay inside.
  check('ball never escapes (max overshoot past walls)', worst, -1e9, -(K.BALL_RADIUS - K.BALL_MAX_SPEED * K.DT), ' uu');
  check('ball no NaN', nan ? 1 : 0, 0, 0);
}

// 20. Car chaos: random inputs, 6 cars, nothing escapes or NaNs
{
  const w = new World();
  w.goalsEnabled = false;
  w.unlimitedBoost = true;
  for (let i = 0; i < 6; i++) w.addCar(i % 2);
  w.setupKickoff();
  let worst = -1e9, nan = false;
  const rnd = () => Math.random() * 2 - 1;
  run(w, 60, (t) => {
    if (Math.floor(t * 120) % 30 === 0) for (const c of w.cars) {
      Object.assign(c.controls, { throttle: rnd() > -0.5 ? 1 : -1, steer: rnd(), pitch: rnd(), yaw: rnd(), roll: rnd() * (Math.random() < 0.3 ? 1 : 0), jump: Math.random() < 0.3, boost: Math.random() < 0.6, handbrake: Math.random() < 0.2 });
    }
    for (const c of w.cars) {
      const p = c.pos;
      if (!Number.isFinite(p.x + p.y + p.z + c.quat.w)) nan = true;
      const outY = Math.abs(p.x) < 893 ? Math.abs(p.y) - 6000 : Math.abs(p.y) - 5120;
      worst = Math.max(worst, Math.abs(p.x) - 4096, outY, -p.z, p.z - 2044);
    }
  });
  // Discrete collision like RocketSim: a car can sink up to one tick of travel
  // (2300 / 120 = 19 uu) before the solver pushes it out; the hitbox bottom
  // is 1.5 uu above the origin. Anything beyond that would be a real escape.
  check('cars never escape (origin vs surfaces)', worst, -1e9, K.CAR_MAX_SPEED * K.DT, ' uu');
  check('cars no NaN', nan ? 1 : 0, 0, 0);
}

console.log(results.join('\n'));
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exitCode = fails ? 1 : 0;
