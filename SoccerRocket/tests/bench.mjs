// Physics cost benchmark: 6 cars (3v3 kickoff, then boosting into a pile-up
// with random steering / jumps) + ball, fixed 120 Hz ticks.
// Run: node tests/bench.mjs [seconds=60]   (add --trace-gc to count GCs)
import { World } from '../public/js/physics/world.js';
import { rng } from '../public/js/physics/math.js';

const secs = +(process.argv[2] || 60);
const w = new World({ seed: 7 });
for (let i = 0; i < 6; i++) w.addCar(i % 2);
w.setupKickoff();
w.unlimitedBoost = true;
const r = rng(99);
const ticks = Math.round(secs * 120);
const times = new Float64Array(ticks);
// warm-up
for (let t = 0; t < 600; t++) w.step();
w.setupKickoff();
for (let t = 0; t < ticks; t++) {
  if (t % 30 === 0) for (const c of w.cars) {
    // drive at the ball most of the time so cars pile up around it
    const dx = w.ball.pos.x - c.pos.x, dy = w.ball.pos.y - c.pos.y;
    const f = c.forward, ang = Math.atan2(dy, dx) - Math.atan2(f.y, f.x);
    const steer = Math.max(-1, Math.min(1, -Math.atan2(Math.sin(ang), Math.cos(ang)) * 2));
    Object.assign(c.controls, {
      throttle: 1, steer: r() < 0.8 ? steer : r() * 2 - 1, boost: r() < 0.7,
      jump: r() < 0.15, pitch: r() * 2 - 1, yaw: r() * 2 - 1, roll: 0, handbrake: r() < 0.1,
    });
  }
  const t0 = performance.now();
  w.step();
  times[t] = performance.now() - t0;
}
const sorted = Array.from(times).sort((a, b) => a - b);
const mean = sorted.reduce((s, x) => s + x, 0) / ticks;
const q = (p) => sorted[Math.min(ticks - 1, Math.floor(p * ticks))];
console.log(`${ticks} ticks, 6 cars + ball: mean ${mean.toFixed(4)} ms/tick, p50 ${q(0.5).toFixed(4)}, p99 ${q(0.99).toFixed(4)}, max ${sorted[ticks - 1].toFixed(3)} ms`);
