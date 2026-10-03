// One-step ("teacher forced") comparison: before every tick the JS bodies
// are set to RocketSim's state at the start of that tick (position,
// orientation, velocity, angular velocity), one tick is simulated, and the
// result is compared with RocketSim's state at the end of the tick. Errors
// therefore do not accumulate: each line shows what a single tick of our
// physics does differently, which separates collision / solver errors (at the
// contact ticks) from slow drift. Car internal state (wheel contact, jump
// timers, tyre friction memory) still comes from our own run.
//
//   node tools/rocketsim/onestep.mjs <scenario name or file> [--obj car0] [--from N] [--to N] [--top K]
//
// Without --from/--to it prints the K ticks with the largest velocity error
// per object.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runScenarioJS, quatFromBasis } from './run-js.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RS_BIN = process.env.RS_ORACLE || path.join(HERE, '.build', 'rs_oracle');
const argv = process.argv.slice(2);
const opt = { obj: null, from: -1, to: Infinity, top: 8, file: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--obj') opt.obj = argv[++i];
  else if (a === '--from') opt.from = +argv[++i];
  else if (a === '--to') opt.to = +argv[++i];
  else if (a === '--top') opt.top = +argv[++i];
  else opt.file = a;
}
if (!opt.file) { console.error('usage: onestep.mjs <scenario> [--obj car0] [--from N] [--to N] [--top K]'); process.exit(2); }
let file = opt.file;
if (!fs.existsSync(file)) {
  const dir = path.join(HERE, 'scenarios');
  const hit = fs.readdirSync(dir).find((f) => f.replace(/^\d+_/, '').replace(/\.json$/, '') === opt.file) ||
    fs.readdirSync(dir).find((f) => f.includes(opt.file));
  if (!hit) { console.error('no scenario matches', opt.file); process.exit(2); }
  file = path.join(dir, hit);
}
const sc = JSON.parse(fs.readFileSync(file, 'utf8'));
sc.every = 1;
const tmp = path.join(os.tmpdir(), `onestep-${process.pid}.json`);
fs.writeFileSync(tmp, JSON.stringify(sc));
let rs;
try { rs = JSON.parse(execFileSync(RS_BIN, [tmp], { maxBuffer: 1 << 30, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); }
finally { fs.unlinkSync(tmp); }
const byTick = new Map(rs.frames.map((f) => [f.tick, f]));

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const setBody = (b, s) => { b.pos.set(...s.pos); b.vel.set(...s.vel); b.angVel.set(...s.angVel); };
const js = runScenarioJS(sc, {
  beforeStep(t, w, cars) {
    const f = byTick.get(t);
    if (!f) return;
    if (!w.ball.frozen) setBody(w.ball, f.ball);
    cars.forEach((car, i) => {
      const s = f.cars[i];
      if (!s || s.demoed || car.isDemoed) return;
      setBody(car, s);
      quatFromBasis(s.fwd, cross(s.up, s.fwd), s.up, car.quat);
      car.R.fromQuat(car.quat);
    });
  },
});

const sub = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const objs = ['ball', ...(sc.cars || []).map((_, i) => `car${i}`)].filter((o) => !opt.obj || o === opt.obj);
const pick = (f, o) => (o === 'ball' ? f.ball : f.cars[+o.slice(3)]);
const fmt = (v) => v.map((x) => x.toFixed(2).padStart(9)).join(' ');
for (const o of objs) {
  const rows = [];
  for (const jf of js.frames) {
    const t = jf.tick;
    if (t === 0 || t < opt.from || t > opt.to) continue;
    const rf = byTick.get(t);
    if (!rf) continue;
    const a = pick(rf, o), b = pick(jf, o);
    if (!a || !b) continue;
    rows.push({ t, a, b, dv: sub(a.vel, b.vel), dw: sub(a.angVel, b.angVel), dp: sub(a.pos, b.pos) });
  }
  const show = opt.from >= 0 || opt.to < Infinity ? rows : [...rows].sort((x, y) => y.dv - x.dv).slice(0, opt.top).sort((x, y) => x.t - y.t);
  console.log(`== ${o}: one-step errors (${show.length} ticks)`);
  for (const r of show) {
    console.log(`t ${String(r.t).padStart(4)} |dv| ${r.dv.toFixed(2).padStart(8)} |dw| ${r.dw.toFixed(3).padStart(7)} |dp| ${r.dp.toFixed(3).padStart(7)}`);
    console.log(`     RS vel ${fmt(r.a.vel)}  w ${fmt(r.a.angVel)}${r.a.wheels !== undefined ? `  wheels ${r.a.wheels}` : ''}`);
    console.log(`     JS vel ${fmt(r.b.vel)}  w ${fmt(r.b.angVel)}${r.b.wheels !== undefined ? `  wheels ${r.b.wheels}` : ''}`);
  }
}
