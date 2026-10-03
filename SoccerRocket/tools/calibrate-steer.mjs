// Finds effective steer angles so steady-state turning curvature matches the
// measured max-curvature table. Prints a STEER_ANGLE_CURVE to paste into
// constants.js. Run: node tools/calibrate-steer.mjs
import { World } from '../public/js/physics/world.js';
import * as K from '../public/js/physics/constants.js';

const TARGET = [[500, 0.00398], [1000, 0.00235], [1500, 0.001375], [1750, 0.0011], [2300, 0.00088]];

function measure(speed, angle) {
  const curve = K.STEER_ANGLE_CURVE;
  const saved = curve.map((p) => p.slice());
  curve.length = 0; curve.push([0, angle]);
  const w = new World();
  w.goalsEnabled = false; w.ball.frozen = true; w.ball.reset(0, 4500, 93);
  for (const p of w.pads) { p.active = false; p.timer = 1e9; }
  w.unlimitedBoost = true;
  const car = w.addCar(0);
  car.reset(-1500, -4300, 18, Math.PI / 2);
  const hold = () => {
    const v = car.vel.len();
    car.controls.throttle = v < speed ? 1 : 0.01;
    car.controls.boost = speed > 1400 && v < speed - 5;
  };
  // straight-line spin-up
  for (let i = 0; i < 600 && car.vel.len() < speed - 8; i++) { hold(); car.controls.steer = 0; w.step(); }
  car.controls.steer = 1;
  for (let i = 0; i < 60; i++) { hold(); w.step(); }
  let prev = Math.atan2(car.forward.y, car.forward.x), dyaw = 0, dist = 0;
  for (let i = 0; i < 120; i++) {
    hold();
    w.step();
    const y = Math.atan2(car.forward.y, car.forward.x);
    let d = y - prev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
    dyaw += d; prev = y; dist += car.vel.len() * K.DT;
  }
  curve.length = 0; for (const p of saved) curve.push(p);
  return Math.abs(dyaw) / dist;
}

const out = [[0, 0.53356]];
for (const [speed, kappa] of TARGET) {
  let lo = 0.01, hi = 0.8;
  for (let it = 0; it < 22; it++) {
    const mid = (lo + hi) / 2;
    if (measure(speed, mid) < kappa) lo = mid; else hi = mid;
  }
  const a = (lo + hi) / 2;
  out.push([speed, +a.toFixed(5)]);
  console.log(`speed ${speed}: angle ${a.toFixed(5)}  curvature ${measure(speed, a).toFixed(6)} (target ${kappa})`);
}
// extrapolate to 3000 keeping the 1750->2300 slope
const [s1, a1] = out[out.length - 2], [s2, a2] = out[out.length - 1];
out.push([3000, +Math.max(0.02, a2 + (a2 - a1) * (3000 - s2) / (s2 - s1)).toFixed(5)]);
console.log('\nexport const STEER_ANGLE_CURVE = ' + JSON.stringify(out) + ';');
