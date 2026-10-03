// Differential test: runs every oracle scenario through RocketSim (rs_oracle)
// and through SoccerRocket's physics (run-js.mjs), then reports divergence and
// derived metrics side by side.
//
//   node tools/rocketsim/compare.mjs                 # whole suite
//   node tools/rocketsim/compare.mjs turn_ hit_1400  # scenarios whose name contains any arg
//   node tools/rocketsim/compare.mjs --summary       # one line per scenario
//   node tools/rocketsim/compare.mjs --trace flip_front [--obj car0] [--every 6] [--from 0] [--to 200]
//   node tools/rocketsim/compare.mjs --json out.json # also write the full report as JSON
//   node tools/rocketsim/compare.mjs --strict        # exit 1 if any metric is out of tolerance
//
// RocketSim results are cached in .build/rs-cache (keyed by scenario content,
// the rs_oracle binary and the exported arena mesh), so loops only pay for the
// JS side. Run build.sh first (and again after changing arena.js).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runScenarioJS } from './run-js.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, '.build');
const RS_BIN = process.env.RS_ORACLE || path.join(BUILD, 'rs_oracle');
const MESH = path.join(BUILD, 'meshes/soccar/soccerrocket_arena.cmf');
const CACHE = path.join(BUILD, 'rs-cache');

// ------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const opt = { filters: [], summary: false, json: null, strict: false, trace: null, obj: null, every: 6, from: 0, to: Infinity, noCache: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--summary') opt.summary = true;
  else if (a === '--json') opt.json = argv[++i];
  else if (a === '--strict') opt.strict = true;
  else if (a === '--trace') opt.trace = argv[++i];
  else if (a === '--obj') opt.obj = argv[++i];
  else if (a === '--every') opt.every = +argv[++i];
  else if (a === '--from') opt.from = +argv[++i];
  else if (a === '--to') opt.to = +argv[++i];
  else if (a === '--no-cache') opt.noCache = true;
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 17).join('\n')); process.exit(0); }
  else opt.filters.push(a);
}

// ------------------------------------------------------------------ scenarios
const scenDir = path.join(HERE, 'scenarios');
let files = fs.readdirSync(scenDir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(scenDir, f));
const filters = opt.trace ? [opt.trace] : opt.filters;
if (filters.length) {
  files = files.filter((f) => filters.some((q) => (q.endsWith('.json') ? path.resolve(q) === f : path.basename(f).includes(q))));
  if (opt.trace) {
    const exact = files.filter((f) => path.basename(f).replace(/^\d+_/, '').replace(/\.json$/, '') === opt.trace);
    if (exact.length) files = exact;
  }
}
if (!files.length) { console.error('no scenarios match'); process.exit(2); }
const scenarios = files.map((f) => ({ file: f, text: fs.readFileSync(f, 'utf8') })).map((s) => ({ ...s, sc: JSON.parse(s.text) }));

// ------------------------------------------------------------------ RocketSim (cached)
if (!fs.existsSync(RS_BIN) || !fs.existsSync(MESH)) {
  console.error(`RocketSim oracle not built (${RS_BIN}). Run: tools/rocketsim/build.sh  (RS_DIR=/path/to/RocketSim to reuse a checkout)`);
  process.exit(2);
}
const binStat = fs.statSync(RS_BIN);
const envKey = `${binStat.size}:${binStat.mtimeMs}:${crypto.createHash('sha1').update(fs.readFileSync(MESH)).digest('hex')}`;
fs.mkdirSync(CACHE, { recursive: true });
const keyOf = (s) => crypto.createHash('sha1').update(envKey).update(s.text).digest('hex').slice(0, 20);
const t0 = performance.now();
const rsRes = new Map();
const todo = [];
for (const s of scenarios) {
  const cf = path.join(CACHE, keyOf(s) + '.json');
  if (!opt.noCache && fs.existsSync(cf)) rsRes.set(s.file, JSON.parse(fs.readFileSync(cf, 'utf8')));
  else todo.push(s);
}
if (todo.length) {
  const out = execFileSync(RS_BIN, todo.map((s) => s.file), { maxBuffer: 1 << 30, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  let parsed = JSON.parse(out);
  if (!Array.isArray(parsed)) parsed = [parsed];
  todo.forEach((s, i) => {
    rsRes.set(s.file, parsed[i]);
    fs.writeFileSync(path.join(CACHE, keyOf(s) + '.json'), JSON.stringify(parsed[i]));
  });
}
const tRS = performance.now() - t0;

// ------------------------------------------------------------------ SoccerRocket
const t1 = performance.now();
const jsRes = new Map();
for (const s of scenarios) jsRes.set(s.file, runScenarioJS(s.sc));
const tJS = performance.now() - t1;

// ------------------------------------------------------------------ field extraction
const D = 180 / Math.PI;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const basis = (c) => [c.fwd, crs(c.up, c.fwd), c.up]; // forward, local +y, up
function rotAngleDeg(A, B) { // angle of the rotation taking basis A to basis B
  const tr = dot(A[0], B[0]) + dot(A[1], B[1]) + dot(A[2], B[2]);
  return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * D;
}
function objOf(frame, obj) { return obj === 'ball' ? frame.ball : frame.cars[+obj.slice(3)]; }
function field(res, k, obj, f) {
  const fr = res.frames[k];
  const o = objOf(fr, obj);
  if (!o) return NaN;
  const p = o.pos, v = o.vel, w = o.angVel;
  switch (f) {
    case 'x': return p[0]; case 'y': return p[1]; case 'z': return p[2];
    case 'vx': return v[0]; case 'vy': return v[1]; case 'vz': return v[2];
    case 'wx': return w[0]; case 'wy': return w[1]; case 'wz': return w[2];
    case 'speed': return len(v);
    case 'hspeed': return Math.hypot(v[0], v[1]);
    case 'angSpeed': return len(w);
    case 'fwdSpeed': return dot(v, o.fwd);
    case 'upz': return o.up[2];
    case 'upx': return o.up[0];
    case 'fwdz': return o.fwd[2];
    case 'pitchDeg': return Math.asin(Math.max(-1, Math.min(1, o.fwd[2]))) * D;
    case 'rollDeg': return Math.asin(Math.max(-1, Math.min(1, crs(o.up, o.fwd)[2]))) * D;
    case 'slipDeg': { const l = crs(o.up, o.fwd); return Math.hypot(v[0], v[1]) < 50 ? 0 : Math.atan2(dot(v, l), dot(v, o.fwd)) * D; }
    case 'heading': return Math.atan2(o.fwd[1], o.fwd[0]);
    case 'orientErrRef': return rotAngleDeg(basis(objOf(res.frames[0], obj)), basis(o));
    case 'onGround': return o.onGround ? 1 : 0;
    case 'supersonic': return o.supersonic ? 1 : 0;
    case 'demoed': return o.demoed ? 1 : 0;
    default: return typeof o[f] === 'boolean' ? (o[f] ? 1 : 0) : o[f];
  }
}
const idxOfTick = (res, tick) => {
  const e = res.every || 1;
  const k = tick >= res.ticks ? res.frames.length - 1 : Math.round(tick / e);
  return Math.max(0, Math.min(res.frames.length - 1, k));
};
const range = (res, from, to) => {
  const a = idxOfTick(res, from ?? 0), b = idxOfTick(res, to ?? res.ticks);
  const out = []; for (let k = a; k <= b; k++) out.push(k); return out;
};
const cmp = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b };

const METRICS = {
  at: (r, m) => field(r, idxOfTick(r, m.tick), m.obj, m.field),
  max: (r, m) => Math.max(...range(r, m.from, m.to).map((k) => field(r, k, m.obj, m.field))),
  min: (r, m) => Math.min(...range(r, m.from, m.to).map((k) => field(r, k, m.obj, m.field))),
  avg: (r, m) => { const ks = range(r, m.from, m.to); return ks.reduce((s, k) => s + field(r, k, m.obj, m.field), 0) / ks.length; },
  argmax: (r, m) => { let best = -Infinity, bt = null; for (const k of range(r, m.from, m.to)) { const v = field(r, k, m.obj, m.field); if (v > best) { best = v; bt = r.frames[k].tick; } } return bt; },
  when: (r, m) => { for (const k of range(r, m.from, r.ticks)) if (cmp[m.op](field(r, k, m.obj, m.field), m.value)) return r.frames[k].tick; return null; },
  yawRate: (r, m) => {
    let acc = 0; const ks = range(r, m.from, m.to);
    for (let i = 1; i < ks.length; i++) {
      let d = field(r, ks[i], m.obj, 'heading') - field(r, ks[i - 1], m.obj, 'heading');
      if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; acc += d;
    }
    return acc / ((r.frames[ks.at(-1)].tick - r.frames[ks[0]].tick) / 120);
  },
  turnRadius: (r, m) => Math.abs(METRICS.avg(r, { ...m, field: 'hspeed' }) / METRICS.yawRate(r, m)),
  ballApexes: (r, m) => {
    const out = []; let prevVz = null;
    for (let k = 0; k < r.frames.length && out.length < m.n; k++) {
      const vz = r.frames[k].ball.vel[2];
      if (prevVz !== null && prevVz > 0 && vz <= 0) out.push(Math.max(r.frames[k - 1].ball.pos[2], r.frames[k].ball.pos[2]));
      prevVz = vz;
    }
    return out;
  },
  eventTick: (r, m) => { const e = r.events.find((x) => x.type === m.type); return e ? e.tick : null; },
  eventCount: (r, m) => r.events.filter((x) => x.type === m.type).length,
  afterEvent: (r, m) => { const e = r.events.find((x) => x.type === m.type); return e ? field(r, idxOfTick(r, e.tick + m.dt), m.obj, m.field) : null; },
};

// ------------------------------------------------------------------ divergence
const THR = { pos: [1, 10, 100], vel: [10, 100, 500], angVel: [0.1, 0.5, 2], rot: [1, 5, 30] };
function divergence(rs, js, sc) {
  const objs = [];
  if (sc.ball) objs.push('ball');
  (sc.cars || []).forEach((_, i) => objs.push(`car${i}`));
  const out = {};
  const n = Math.min(rs.frames.length, js.frames.length);
  for (const obj of objs) {
    const d = { maxPos: 0, maxVel: 0, maxAngVel: 0, maxRot: 0, finalPos: 0, finalVel: 0, finalRot: 0, first: { pos: [null, null, null], vel: [null, null, null], angVel: [null, null, null], rot: [null, null, null] } };
    for (let k = 0; k < n; k++) {
      const a = objOf(rs.frames[k], obj), b = objOf(js.frames[k], obj);
      const tick = rs.frames[k].tick;
      const e = {
        pos: len(sub(a.pos, b.pos)), vel: len(sub(a.vel, b.vel)), angVel: len(sub(a.angVel, b.angVel)),
        rot: obj === 'ball' ? 0 : rotAngleDeg(basis(a), basis(b)),
      };
      if (obj !== 'ball' && (a.demoed || b.demoed)) { e.pos = e.vel = e.angVel = e.rot = 0; }
      d.maxPos = Math.max(d.maxPos, e.pos); d.maxVel = Math.max(d.maxVel, e.vel); d.maxAngVel = Math.max(d.maxAngVel, e.angVel); d.maxRot = Math.max(d.maxRot, e.rot);
      for (const kk of ['pos', 'vel', 'angVel', 'rot']) THR[kk].forEach((t, i) => { if (d.first[kk][i] === null && e[kk] > t) d.first[kk][i] = tick; });
      if (k === n - 1) { d.finalPos = e.pos; d.finalVel = e.vel; d.finalRot = e.rot; }
    }
    out[obj] = d;
  }
  return out;
}

// ------------------------------------------------------------------ formatting
const fmt = (v, p = 1) => {
  if (v === null || v === undefined) return '-';
  if (Array.isArray(v)) return '[' + v.map((x) => fmt(x, p)).join(', ') + ']';
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  return a >= 1000 ? v.toFixed(0) : a >= 100 ? v.toFixed(p) : a >= 1 ? v.toFixed(Math.max(p, 2)) : v.toFixed(3);
};
const pad = (s, n) => (String(s).length >= n ? String(s) : String(s) + ' '.repeat(n - String(s).length));
const lpad = (s, n) => (String(s).length >= n ? String(s) : ' '.repeat(n - String(s).length) + String(s));

function metricDelta(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const A = a || [], B = b || [];
    let worst = 0; const m = Math.max(A.length, B.length);
    for (let i = 0; i < m; i++) worst = Math.max(worst, (A[i] === undefined || B[i] === undefined) ? Infinity : Math.abs(A[i] - B[i]));
    return worst;
  }
  if (a === null && b === null) return 0;
  if (a === null || b === null) return Infinity;
  return b - a;
}

// ------------------------------------------------------------------ trace mode
if (opt.trace) {
  const s = scenarios[0];
  const rs = rsRes.get(s.file), js = jsRes.get(s.file);
  const objs = opt.obj ? [opt.obj] : [...(s.sc.ball ? ['ball'] : []), ...(s.sc.cars || []).map((_, i) => `car${i}`)];
  console.log(`trace ${s.sc.name}: ${s.sc.desc || ''}`);
  const v3 = (v) => v.map((x) => lpad(fmt(x), 8)).join(' ');
  for (const obj of objs) {
    console.log(`\n== ${obj}   (RS = RocketSim, JS = SoccerRocket)`);
    for (let k = 0; k < rs.frames.length; k++) {
      const tick = rs.frames[k].tick;
      if (tick < opt.from || tick > opt.to || (tick % opt.every !== 0 && k !== rs.frames.length - 1)) continue;
      const a = objOf(rs.frames[k], obj), b = objOf(js.frames[k], obj);
      const extra = (c) => (obj === 'ball' ? '' : ` up ${v3(c.up)} g${c.onGround ? 1 : 0} w${c.wheels} ${c.isJumping ? 'J' : '-'}${c.hasJumped ? 'j' : '-'}${c.hasDoubleJumped ? 'd' : '-'}${c.hasFlipped ? 'f' : '-'}${c.isFlipping ? 'F' : '-'} b${fmt(c.boost)}`);
      console.log(`t${lpad(tick, 4)} RS pos ${v3(a.pos)} vel ${v3(a.vel)} w ${v3(a.angVel)}${extra(a)}`);
      console.log(`      JS pos ${v3(b.pos)} vel ${v3(b.vel)} w ${v3(b.angVel)}${extra(b)}`);
    }
  }
  const evs = (r) => r.events.map((e) => `${e.type}@${e.tick}`).join(' ') || 'none';
  console.log(`\nevents RS: ${evs(rs)}\nevents JS: ${evs(js)}`);
  process.exit(0);
}

// ------------------------------------------------------------------ report
const report = [];
let totalPass = 0, totalMetrics = 0;
for (const s of scenarios) {
  const sc = s.sc, rs = rsRes.get(s.file), js = jsRes.get(s.file);
  const div = divergence(rs, js, sc);
  const metrics = (sc.metrics || []).map((m) => {
    const a = METRICS[m.fn](rs, m), b = METRICS[m.fn](js, m);
    const d = metricDelta(a, b);
    const ok = Math.abs(d) <= (m.tol ?? 0) + 1e-9;
    return { label: m.label, rs: a, js: b, delta: d, tol: m.tol, ok };
  });
  const pass = metrics.filter((m) => m.ok).length;
  totalPass += pass; totalMetrics += metrics.length;
  report.push({ name: sc.name, desc: sc.desc, file: path.basename(s.file), divergence: div, metrics, pass, total: metrics.length,
    events: { rs: rs.events.map((e) => `${e.type}@${e.tick}`), js: js.events.map((e) => `${e.type}@${e.tick}`) } });
}

const firstStr = (arr) => arr.map((x) => (x === null ? '-' : x)).join('/');
if (!opt.summary) {
  for (const r of report) {
    console.log(`\n### ${r.name}  [${r.pass}/${r.total} metrics within tol]  ${r.desc || ''}`);
    for (const [obj, d] of Object.entries(r.divergence)) {
      console.log(`  ${pad(obj, 5)} max err: pos ${fmt(d.maxPos)} uu, vel ${fmt(d.maxVel)} uu/s, angVel ${fmt(d.maxAngVel)} rad/s${obj === 'ball' ? '' : `, rot ${fmt(d.maxRot)} deg`} | final pos ${fmt(d.finalPos)}`
        + ` | first tick pos>${THR.pos.join('/')}: ${firstStr(d.first.pos)}  vel>${THR.vel.join('/')}: ${firstStr(d.first.vel)}${obj === 'ball' ? '' : `  rot>${THR.rot.join('/')}deg: ${firstStr(d.first.rot)}`}`);
    }
    if (r.metrics.length) {
      console.log(`  ${pad('metric', 44)} ${lpad('RocketSim', 22)} ${lpad('ours', 22)} ${lpad('delta', 10)}  tol`);
      for (const m of r.metrics) {
        console.log(`  ${pad(m.label, 44)} ${lpad(fmt(m.rs), 22)} ${lpad(fmt(m.js), 22)} ${lpad(fmt(m.delta), 10)}  ${fmt(m.tol)} ${m.ok ? 'ok' : 'XX'}`);
      }
    }
    const er = r.events.rs.join(' '), ej = r.events.js.join(' ');
    if (er || ej) console.log(`  events RS: ${er.slice(0, 160) || 'none'}\n  events JS: ${ej.slice(0, 160) || 'none'}`);
  }
}

console.log(`\n${pad('scenario', 22)} ${lpad('metrics', 7)}  ${lpad('car0 pos', 9)} ${lpad('vel', 7)} ${lpad('rot', 6)} ${lpad('pos>10@', 7)}  ${lpad('ball pos', 9)} ${lpad('vel', 7)}  worst metric (RocketSim vs ours)`);
for (const r of report) {
  const c = r.divergence.car0, b = r.divergence.ball;
  const worst = r.metrics.filter((m) => !m.ok).sort((x, y) => Math.abs(y.delta / (y.tol || 1)) - Math.abs(x.delta / (x.tol || 1)))[0];
  console.log(`${pad(r.name, 22)} ${lpad(`${r.pass}/${r.total}`, 7)}  ${lpad(c ? fmt(c.maxPos) : '', 9)} ${lpad(c ? fmt(c.maxVel) : '', 7)} ${lpad(c ? fmt(c.maxRot) : '', 6)} ${lpad(c ? (c.first.pos[1] ?? '-') : '', 7)}  ${lpad(b ? fmt(b.maxPos) : '', 9)} ${lpad(b ? fmt(b.maxVel) : '', 7)}  ${worst ? `${worst.label}: ${fmt(worst.rs)} vs ${fmt(worst.js)}` : ''}`);
}
console.log(`\n${totalPass}/${totalMetrics} metrics within tolerance across ${report.length} scenarios  (RocketSim ${(tRS / 1000).toFixed(2)} s${todo.length ? `, ${todo.length} uncached` : ', cached'}; SoccerRocket ${(tJS / 1000).toFixed(2)} s)`);
if (opt.json) fs.writeFileSync(opt.json, JSON.stringify({ totalPass, totalMetrics, report }, null, 1));
if (opt.strict && totalPass < totalMetrics) process.exitCode = 1;
