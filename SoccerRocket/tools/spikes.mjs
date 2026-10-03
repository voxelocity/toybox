// Frame-time spike harness. Plays a real 3v3 match in headless Chromium and
// scripts big events on a fixed cycle: 2300 uu/s car-into-ball hits, car-car
// bumps, supersonic demos, 6000 uu/s wall smashes, a 4-car pile-up and goals
// (explosion, goal replay, kickoff). Every frame is driven with a fixed 1/60 s
// game step, so runs are comparable however slow the machine is, and the
// harness records the main-thread time of App.frame, its split between
// subsystems, the events handled in that frame and three.js'
// renderer.info.programs (which must not grow once the game has booted).
//
// Usage: node tools/spikes.mjs [--q high,low] [--seconds 60] [--size 960x540]
//          [--server path/to/server.js] [--json out.json] [--trace] [--realtime]
//   --server   serve another checkout (for before/after comparisons)
//   --trace    also record a Chrome trace and report GC pauses
//   --realtime use real frame times instead of the fixed step (shows the
//              fixed-step catch-up behaviour after a hitch)
//   --sync     wait for the GPU after every frame (readPixels) and report that
//              wait separately: shows fill-rate / overdraw cost (SwiftShader
//              renders on the CPU, so only relative numbers mean anything)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const QUALITIES = String(opt('q', 'high,low')).split(',');
const SECONDS = +opt('seconds', 60);
const [VW, VH] = String(opt('size', '960x540')).split('x').map(Number);
const SERVER = path.resolve(String(opt('server', path.join(HERE, '..', 'server.js'))));
const JSON_OUT = opt('json', null);
const TRACE = !!opt('trace', false);
const REALTIME = !!opt('realtime', false);
const SYNC = !!opt('sync', false);
const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// ---- in-page harness ------------------------------------------------------------------
// Times every WebGL call that can block the main thread (shader compiles and
// links, texture / buffer uploads, sync queries), per frame.
function glTimers() {
  const G = window.__gl = { acc: {} };
  const names = ['compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'getShaderInfoLog',
    'texImage2D', 'texSubImage2D', 'texImage3D', 'texStorage2D', 'generateMipmap', 'bufferData', 'bufferSubData', 'readPixels', 'getUniformLocation',
    'getActiveUniform', 'getAttribLocation', 'getParameter', 'getError', 'drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced',
    'blitFramebuffer', 'framebufferTexture2D', 'checkFramebufferStatus', 'renderbufferStorageMultisample', 'clientWaitSync', 'fenceSync', 'deleteProgram'];
  for (const P of [window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, window.WebGLRenderingContext && WebGLRenderingContext.prototype]) {
    if (!P) continue;
    for (const n of names) {
      const f = P[n];
      if (typeof f !== 'function') continue;
      P[n] = function (...a) { const t0 = performance.now(); try { return f.apply(this, a); } finally { const e = G.acc[n] || (G.acc[n] = [0, 0]); e[0]++; e[1] += performance.now() - t0; if (n === 'getProgramInfoLog' || n === 'linkProgram') (G[n === 'linkProgram' ? 'linked' : 'used'] || (G[n === 'linkProgram' ? 'linked' : 'used'] = [])).push(a[0]); } };
    }
  }
}

function harness({ seconds, realtime, sync }) {
  const app = window.app, R = app.renderer.renderer;
  const H = window.__spk = { frames: [], marks: [], done: false, error: null, programs0: R.info.programs.length };
  window.__gl.linked = []; window.__gl.used = []; // boot-time compiles are not part of the run
  const STEP = 1000 / 60;
  const T = { tick: 0, events: 0, view: 0, render: 0, audio: 0, hud: 0, cam: 0 };
  const KEYS = Object.keys(T);
  let evTypes = [];
  const wrap = (obj, name, key) => {
    const f = obj[name];
    obj[name] = function (...a) { const t0 = performance.now(); try { return f.apply(this, a); } finally { T[key] += performance.now() - t0; } };
  };
  wrap(Object.getPrototypeOf(app.match), 'tick', 'tick');
  wrap(Object.getPrototypeOf(app.view), 'update', 'view');
  wrap(app.renderer, 'render', 'render');
  wrap(Object.getPrototypeOf(app.audio), 'update', 'audio');
  wrap(Object.getPrototypeOf(app.hud), 'update', 'hud');
  wrap(app, 'updateCamera', 'cam');
  const he = app.handleEvents;
  app.handleEvents = function () {
    for (const e of this.match.events) {
      let tag = e.type;
      if (e.type === 'ballHit') tag += e.dv > 1300 ? ':big' : ':small';
      if (e.type === 'ballBounce') tag += e.speed > 1500 ? ':big' : ':small';
      evTypes.push(tag);
    }
    const t0 = performance.now();
    try { return he.call(this); } finally { T.events += performance.now() - t0; }
  };
  const ur = app.updateReplay;
  app.updateReplay = function (dt) { const r = ur.call(this, dt); if (this.replayState && this.replayState.exploded && !this.replayState._m) { this.replayState._m = 1; evTypes.push('replayGoal'); } return r; };

  // The replay camera is handed physics V3s (no lengthSq) and throws every
  // replay frame, which skips rendering; convert so replays are measured too.
  const cin = app.cam.updateCinematic;
  if (cin) app.cam.updateCinematic = function (dt, p, v, f) {
    const V = this.camera.position.constructor, t = (a) => (a && !a.isVector3 ? new V(a.x, a.y, a.z) : a);
    return cin.call(this, dt, t(p), t(v), t(f));
  };

  // ---- scripted events ---------------------------------------------------------------
  const m = () => app.match, W = () => app.match.world;
  const Z = 17;
  const place = (car, x, y, yaw, speed) => {
    car.reset(x, y, Z, yaw);
    car.vel.set(Math.cos(yaw) * speed, Math.sin(yaw) * speed, 0);
  };
  const ballAt = (x, y, z, vx = 0, vy = 0, vz = 0) => { const b = W().ball; b.reset(x, y, z); b.vel.set(vx, vy, vz); b.frozen = false; };
  const mark = (name) => H.marks.push([H.frames.length, name]);
  const skipCountdown = () => { if (m().state === 'countdown') m().countdown = 0.02; };
  const C = (i) => W().cars[i];
  // 3v3, human on blue: cars 0-2 blue, 3-5 orange
  function hit(car, x = 0) { ballAt(x, 0, 93); place(car, x, -350, Math.PI / 2, 2300); mark('hit'); }
  function bump(a, b, x = -2500) { place(b, x, 2000, 0, 0); place(a, x, 1560, Math.PI / 2, 1400); mark('bump'); }
  function demo(a, b, x = 2500, y = 2000) { place(b, x, y, 0, 0); place(a, x, y - 420, Math.PI / 2, 2300); a.isSupersonic = true; mark('demo'); }
  function wall() { ballAt(3000, -1500, 500, 6000, 0, 0); mark('wall'); }
  function* goal() {
    ballAt(0, 4700, 300, 0, 3000, 0); mark('goal');
    for (let i = 0; i < 600 && m().state !== 'replay'; i++) yield 1;
    yield 150; // watch the replay until the replay explosion has fired
    for (let i = 0; i < 400 && app.replayState && !app.replayState.exploded; i++) yield 1;
    yield 30;
    if (app.replayState) { app.endReplay(); mark('endReplay'); }
    yield 2;
    skipCountdown();
    yield 30;
  }
  function* cycle() {
    hit(C(0)); yield 60;
    bump(C(1), C(3)); yield 60;
    demo(C(2), C(4)); yield 60;
    wall(); yield 60;
    hit(C(5), 600); yield 60;
    // pile-up: two demos, a bump and a hit in the same tick
    demo(C(1), C(3), 2500, 2000); demo(C(4), C(2), -2500, -2000); bump(C(5), C(0), 0, -3500); hit(C(0), 1200); mark('pileup');
    yield 60;
    yield* goal();
  }
  function* script() {
    app.settings.match.mode = 3; app.settings.match.difficulty = 'allstar'; app.settings.match.minutes = 5;
    app.audio.unlock();
    app.startMatch(); mark('matchStart');
    yield 2; skipCountdown(); yield 30;
    while (H.frames.length < seconds * 60) yield* cycle();
  }
  const gen = script();
  let wait = 0, synth = performance.now(), lastStart = performance.now();
  const orig = Object.getPrototypeOf(app).frame;
  const px = new Uint8Array(4);
  app.frame = function (now) {
    if (H.done) return orig.call(this, now);
    const t0 = performance.now();
    const interval = t0 - lastStart; lastStart = t0;
    try {
      if (--wait <= 0) { const r = gen.next(); wait = r.done ? 1 : r.value; }
    } catch (e) { H.error = String(e.stack || e); }
    const t1 = performance.now();
    for (const k of KEYS) T[k] = 0;
    evTypes = [];
    window.__gl.acc = {};
    if (!realtime) { synth += STEP; this.last = synth - STEP; now = synth; }
    const heap0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
    const tick0 = this.match.world.tick;
    const f0 = performance.now();
    orig.call(this, now);
    const f1 = performance.now();
    let gpu = 0;
    if (sync) { const g = R.getContext(); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); gpu = performance.now() - f1; }
    const heap1 = performance.memory ? performance.memory.usedJSHeapSize : 0;
    // three.js links a program when a material first needs it and blocks on the
    // driver's compile when it first draws with it (info log query): name both
    const progName = (glp) => { const p = R.info.programs.find((q) => q.program === glp); return p ? `${p.name || p.type}#${p.id}` : '?'; };
    const progs = [...(window.__gl.linked || []).map((g) => 'link:' + progName(g)), ...(window.__gl.used || []).map((g) => 'use:' + progName(g))].join(' ');
    window.__gl.linked = []; window.__gl.used = [];
    const gl = Object.entries(window.__gl.acc).filter((e) => e[1][1] > 2).sort((a, b) => b[1][1] - a[1][1]).slice(0, 3).map(([n, [c, t]]) => `${n}x${c}=${t.toFixed(0)}`).join(' ');
    H.frames.push([f1 - f0, interval, R.info.programs.length, ...KEYS.map((k) => T[k]), evTypes.join(' '), heap0, heap1, t1 - t0, app.match.state, gl, app.match.world.tick - tick0, gpu, progs]);
    if (H.frames.length >= seconds * 60) { H.done = true; mark('end'); }
  };
  return { programs: H.programs0, textures: R.info.memory.textures, geometries: R.info.memory.geometries };
}

// ---- analysis ----------------------------------------------------------------------------
const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const KEYS = ['tick', 'events', 'view', 'render', 'audio', 'hud', 'cam'];

function analyse(q, boot, H, gc) {
  const F = H.frames.map((r) => ({ ms: r[0], interval: r[1], programs: r[2], ...Object.fromEntries(KEYS.map((k, i) => [k, r[3 + i]])), ev: r[10], heap0: r[11], heap1: r[12], script: r[13], state: r[14], gl: r[15], ticks: r[16], gpu: r[17], progs: r[18] }));
  const ms = F.map((f) => f.ms);
  const skip = 30; // first frames after the match starts include one-off match setup
  const steady = ms.slice(skip);
  const out = { q, boot, frames: F.length, programs: { atReady: boot.programs, start: F[0] ? F[0].programs : NaN, end: F.length ? F[F.length - 1].programs : NaN, growth: [] } };
  for (let i = 1; i < F.length; i++) if (F[i].programs !== F[i - 1].programs) out.programs.growth.push({ frame: i, from: F[i - 1].programs, to: F[i].programs, ms: +F[i].ms.toFixed(1), ev: F[i].ev, state: F[i].state, progs: F[i].progs });
  out.all = { p50: pct(steady, 0.5), p95: pct(steady, 0.95), p99: pct(steady, 0.99), max: Math.max(...steady) };
  // starting the match (new car views, first draw of their materials) is left out of the stats above
  const setup = F.slice(0, skip).map((f, i) => ({ i, ...f })).sort((a, b) => b.ms - a.ms)[0];
  if (setup) out.matchStart = { frame: setup.i, ms: +setup.ms.toFixed(1), script: +F[0].script.toFixed(1), ...Object.fromEntries(KEYS.map((k) => [k, +setup[k].toFixed(1)])), gl: setup.gl, ev: setup.ev, progs: setup.progs };
  // every frame that linked or first drew with a shader program after boot
  out.compiles = F.map((f, i) => ({ i, ...f })).filter((f) => f.progs).map((f) => ({ frame: f.i, ms: +f.ms.toFixed(1), state: f.state, ev: f.ev, progs: f.progs }));
  const iv = F.slice(skip).map((f) => f.interval), tk = F.slice(skip).map((f) => f.ticks);
  out.interval = { p50: pct(iv, 0.5), p95: pct(iv, 0.95), p99: pct(iv, 0.99), max: Math.max(...iv) };
  out.ticks = { p50: pct(tk, 0.5), max: Math.max(...tk), hist: tk.reduce((h, t) => { h[t] = (h[t] || 0) + 1; return h; }, {}) };
  // windows around events: the frame that handles the event and the 3 after it
  const BIG = /^(ballHit:big|ballBounce:big|demo|bump|goalScored|replay|replayGoal|kickoff|supersonic)$/;
  const byType = {};
  const evFrames = new Set();
  for (let i = skip; i < F.length; i++) {
    const types = new Set(F[i].ev.split(' ').filter((t) => BIG.test(t)));
    for (const t of types) {
      let worst = 0;
      for (let k = i; k < Math.min(F.length, i + 4); k++) { worst = Math.max(worst, F[k].ms); evFrames.add(k); }
      (byType[t] = byType[t] || []).push(worst);
    }
  }
  out.events = Object.fromEntries(Object.entries(byType).map(([t, a]) => [t, { n: a.length, p50: pct(a, 0.5), p95: pct(a, 0.95), max: Math.max(...a) }]));
  const evMs = [...evFrames].map((i) => F[i].ms);
  const gpu = F.slice(skip).map((f) => f.gpu);
  if (gpu.some((g) => g > 0)) {
    const evG = [...evFrames].map((i) => F[i].gpu);
    out.gpu = { p50: pct(gpu, 0.5), p95: pct(gpu, 0.95), p99: pct(gpu, 0.99), max: Math.max(...gpu), evP95: pct(evG, 0.95), evMax: Math.max(...evG) };
  }
  const quiet = F.slice(skip).filter((_, i) => !evFrames.has(i + skip)).map((f) => f.ms);
  out.eventFrames = { n: evMs.length, p50: pct(evMs, 0.5), p95: pct(evMs, 0.95), p99: pct(evMs, 0.99), max: Math.max(...evMs) };
  out.quietFrames = { n: quiet.length, p50: pct(quiet, 0.5), p95: pct(quiet, 0.95), p99: pct(quiet, 0.99), max: Math.max(...quiet) };
  const p50 = out.all.p50;
  const thr = Math.max(p50 * 2.5, p50 + 25);
  out.spikeThreshold = thr;
  out.spikes = F.map((f, i) => ({ i, ...f })).filter((f) => f.i >= skip && f.ms > thr).sort((a, b) => b.ms - a.ms).slice(0, 12)
    .map((f) => ({ frame: f.i, ms: +f.ms.toFixed(1), ...Object.fromEntries(KEYS.map((k) => [k, +f[k].toFixed(1)])), programs: f.programs, ev: f.ev, state: f.state, gl: f.gl, gpu: +f.gpu.toFixed(1), progs: f.progs }));
  out.spikeCount = F.slice(skip).filter((f) => f.ms > thr).length;
  // GC (heap drops between frames, or a Chrome trace when --trace is on)
  let drops = 0;
  for (let i = 1; i < F.length; i++) if (F[i].heap0 < F[i - 1].heap1 - 256 * 1024) drops++;
  out.heap = { startMB: +(F[0].heap0 / 1048576).toFixed(1), endMB: +(F[F.length - 1].heap1 / 1048576).toFixed(1), drops };
  if (gc) out.gc = gc;
  out.marks = H.marks;
  return out;
}

function report(r) {
  const L = [];
  L.push(`\n=== q=${r.q}  frames=${r.frames}  boot ${r.boot.bootMs} ms  ===`);
  L.push(`programs: ${r.programs.atReady} at ready, ${r.programs.start} at match start, ${r.programs.end} at end  (${r.programs.growth.length} growth events)`);
  for (const g of r.programs.growth.slice(0, 12)) L.push(`   frame ${g.frame}: ${g.from} -> ${g.to}  ${g.ms} ms  [${g.state}] ${g.ev}  ${g.progs || ''}`);
  if (r.matchStart) { const s = r.matchStart; L.push(`match start: worst frame ${s.frame} ${s.ms} ms (startMatch() took ${s.script} ms)  tick ${s.tick} view ${s.view} render ${s.render} [${s.ev}]${s.gl ? '  gl: ' + s.gl : ''}${s.progs ? '  ' + s.progs : ''}`); }
  L.push(`frames that linked or first used a shader program: ${r.compiles.length}`);
  for (const c of r.compiles.slice(0, 12)) L.push(`   frame ${c.frame}: ${c.ms} ms [${c.state}] ${c.ev}  ${c.progs}`);
  L.push(`frame ms (main thread)   p50 ${f1(r.all.p50)}  p95 ${f1(r.all.p95)}  p99 ${f1(r.all.p99)}  max ${f1(r.all.max)}`);
  L.push(`  rAF interval            p50 ${f1(r.interval.p50)}  p95 ${f1(r.interval.p95)}  p99 ${f1(r.interval.p99)}  max ${f1(r.interval.max)}   ticks/frame ${JSON.stringify(r.ticks.hist)}`);
  L.push(`  event frames (${r.eventFrames.n})    p50 ${f1(r.eventFrames.p50)}  p95 ${f1(r.eventFrames.p95)}  p99 ${f1(r.eventFrames.p99)}  max ${f1(r.eventFrames.max)}`);
  L.push(`  quiet frames (${r.quietFrames.n})   p50 ${f1(r.quietFrames.p50)}  p95 ${f1(r.quietFrames.p95)}  p99 ${f1(r.quietFrames.p99)}  max ${f1(r.quietFrames.max)}`);
  L.push('worst frame within 4 frames of each event type:');
  for (const [t, s] of Object.entries(r.events).sort()) L.push(`   ${t.padEnd(14)} n=${String(s.n).padStart(3)}  p50 ${f1(s.p50)}  p95 ${f1(s.p95)}  max ${f1(s.max)}`);
  if (r.gpu) L.push(`gpu wait (--sync)        p50 ${f1(r.gpu.p50)}  p95 ${f1(r.gpu.p95)}  p99 ${f1(r.gpu.p99)}  max ${f1(r.gpu.max)}   event frames p95 ${f1(r.gpu.evP95)} max ${f1(r.gpu.evMax)}`);
  L.push(`spikes (> ${f1(r.spikeThreshold)} ms): ${r.spikeCount}`);
  for (const s of r.spikes) L.push(`   frame ${s.frame}: ${s.ms} ms  tick ${s.tick} ev ${s.events} view ${s.view} render ${s.render} audio ${s.audio} hud ${s.hud}${s.gpu ? ' gpu ' + s.gpu : ''}  progs ${s.programs} [${s.state}] ${s.ev}${s.gl ? '  gl: ' + s.gl : ''}`);
  L.push(`heap ${r.heap.startMB} -> ${r.heap.endMB} MB, ${r.heap.drops} GC drops`);
  if (r.gc) L.push(`gc (trace): ${r.gc.count} pauses, total ${f1(r.gc.total)} ms, max ${f1(r.gc.max)} ms (${Object.entries(r.gc.byName).map(([k, v]) => `${k} ${v.n}/${v.ms.toFixed(0)}ms`).join(', ')})`);
  return L.join('\n');
}

// ---- driver ------------------------------------------------------------------------------
const cleanups = new Set();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { for (const c of cleanups) await c(); process.exit(130); });

async function run(q) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const srv = spawn(process.execPath, [SERVER, String(port)], { stdio: 'ignore' });
  const killSrv = () => srv.kill();
  cleanups.add(killSrv);
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
  const closeBrowser = () => browser.close().catch(() => {});
  cleanups.add(closeBrowser);
  try {
    const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(glTimers);
    // fixed settings: no auto quality step-down, so every run measures one preset
    await page.addInitScript(() => { try { localStorage.setItem('soccer-rocket-settings-v1', JSON.stringify({ quality: 'high', autoAdjust: false })); } catch { /* ignore */ } });
    const t0 = Date.now();
    await page.goto(`http://localhost:${port}/?q=${q}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
    const bootMs = Date.now() - t0;
    // let the sounds finish synthesising so audio is part of the measurement
    await page.waitForFunction(() => window.app.audio.allReady || !window.app.audio.ctx, null, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(1000);
    if (TRACE) await browser.startTracing(page, { categories: ['disabled-by-default-v8.gc', 'v8', 'devtools.timeline'] });
    const boot = await page.evaluate(harness, { seconds: SECONDS, realtime: REALTIME, sync: SYNC });
    boot.bootMs = bootMs;
    for (let lastLog = Date.now(); ;) {
      const st = await page.evaluate(() => ({ n: window.__spk.frames.length, done: window.__spk.done || !!window.__spk.error, progs: window.app.renderer.renderer.info.programs.length }));
      if (st.done) break;
      if (Date.now() - lastLog > 30000) { lastLog = Date.now(); console.error(`[q=${q}] ${st.n}/${SECONDS * 60} frames, ${st.progs} programs`); }
      await new Promise((r) => setTimeout(r, 1000));
    }
    let gc = null;
    if (TRACE) gc = summariseTrace(JSON.parse((await browser.stopTracing()).toString()));
    const H = await page.evaluate(() => window.__spk);
    if (H.error) console.log('[harness error]', H.error);
    if (errors.length) console.log('[page errors]', [...new Set(errors)].slice(0, 10).join('\n'), `(${errors.length} total)`);
    return analyse(q, boot, H, gc);
  } finally {
    cleanups.delete(closeBrowser);
    await closeBrowser();
    cleanups.delete(killSrv);
    srv.kill();
  }
}

function summariseTrace(trace) {
  const evs = trace.traceEvents || trace;
  const byName = {};
  let count = 0, total = 0, max = 0;
  for (const e of evs) {
    if (e.ph !== 'X' || !/^(MinorGC|MajorGC|V8\.GC_MC_BACKGROUND_MARKING|V8\.GCIncrementalMarking|V8\.GCFinalizeMC|V8\.GCScavenger)$/.test(e.name)) continue;
    const d = (e.dur || 0) / 1000;
    if (e.name === 'MinorGC' || e.name === 'MajorGC') { count++; total += d; max = Math.max(max, d); }
    const b = (byName[e.name] = byName[e.name] || { n: 0, ms: 0 });
    b.n++; b.ms += d;
  }
  return { count, total, max, byName };
}

const results = [];
for (const q of QUALITIES) {
  const r = await run(q);
  results.push(r);
  console.log(report(r));
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 1));
