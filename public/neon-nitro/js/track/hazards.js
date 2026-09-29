// Interactive set pieces. Each installer adds meshes to the track group and a
// per-frame updater that animates it and resolves collisions with racers.
import * as THREE from 'three';
import { Geo } from '../geo/builder.js';
import { toonMaterial } from '../render/toon.js';
import { rgb } from './build.js';
import { SHAPE } from '../race/fx.js';

const matCache = new Map();
function mat(key = 'std') {
  if (!matCache.has(key)) matCache.set(key, toonMaterial({ vertexColors: true, emitAttr: true, rim: 0.4, spec: 0.3 }));
  return matCache.get(key);
}
const mesh = (g) => { const m = new THREE.Mesh(g.build({ color: true, emit: true }), mat()); return m; };
const lerp = (a, b, t) => a + (b - a) * t;

/** Local frame at arc length s: origin on the centreline, x = tangent, z = right. */
function frame(track, s, lat = 0) {
  const p = track.path.point(s, lat);
  return { x: p.px, y: p.py, z: p.pz, tx: p.tx, tz: p.tz, rx: p.rx, rz: p.rz, ang: Math.atan2(-p.tz, p.tx), i: p.i };
}

// ------------------------------------------------------------------ trains
export function trainModel(cars = 4, color = '#56f06b') {
  const g = new Geo();
  const L = 18;
  for (let k = 0; k < cars; k++) {
    const x = -k * (L + 0.8);
    g.set([0.82, 0.84, 0.9], 0, 0); g.box(x, 2.1, 0, L, 3.2, 3.0);
    g.set(rgb(color), 0, 0.2); g.box(x, 1.35, 0, L + 0.02, 0.35, 3.04);
    g.set([0.12, 0.14, 0.22], 0, 0);
    for (let w = 0; w < 6; w++) { g.box(x - L / 2 + 1.8 + w * 2.9, 2.6, 1.52, 1.8, 1.0, 0.02); g.box(x - L / 2 + 1.8 + w * 2.9, 2.6, -1.52, 1.8, 1.0, 0.02); }
    g.set([1, 0.95, 0.75], 0, 0.7);
    for (let w = 0; w < 6; w++) { g.box(x - L / 2 + 1.8 + w * 2.9, 2.6, 1.53, 1.6, 0.8, 0.01); g.box(x - L / 2 + 1.8 + w * 2.9, 2.6, -1.53, 1.6, 0.8, 0.01); }
    g.set([0.2, 0.2, 0.24], 0, 0); g.box(x, 0.35, 0, L - 2, 0.7, 2.4);
    g.set([0.3, 0.3, 0.36], 0, 0); g.box(x, 3.85, 0, L - 3, 0.3, 1.6);
  }
  // cab front
  g.set([0.12, 0.14, 0.22], 0, 0); g.box(L / 2 + 0.02, 2.6, 0, 0.04, 1.2, 2.4);
  g.set([1, 1, 0.8], 0, 1); g.box(L / 2 + 0.05, 1.3, 1.0, 0.04, 0.3, 0.4); g.box(L / 2 + 0.05, 1.3, -1.0, 0.04, 0.3, 0.4);
  return mesh(g);
}

/**
 * Level crossing: a train crosses the road at u every `period` seconds.
 */
export function levelCrossing(track, u, o = {}) {
  const path = track.path;
  const s0 = u * path.length;
  const F = frame(track, s0);
  const period = o.period ?? 21, cross = o.cross ?? 4.2, warn = o.warn ?? 2.8, offset = o.offset ?? 6;
  const halfW = Math.max(track.limL[F.i], track.limR[F.i]) + 6;
  const g = new Geo();
  // rails across the road
  g.set([0.35, 0.33, 0.4], 0, 0);
  for (const d of [-0.75, 0.75]) {
    g.at([F.x, F.y + 0.03, F.z], [0, F.ang, 0], 1, (gg) => gg.box(d, 0, 0, 0.14, 0.06, halfW * 2 + 60));
  }
  g.set([0.9, 0.8, 0.1], 0, 0.1);
  g.at([F.x, F.y + 0.02, F.z], [0, F.ang, 0], 1, (gg) => { for (const d of [-3.2, 3.2]) gg.box(d, 0, 0, 0.4, 0.02, halfW * 2); });
  // gates + lights both sides
  const lights = [];
  for (const side of [-1, 1]) {
    for (const along of [-4.5, 4.5]) {
      const P = frame(track, s0 + along, side * (halfW - 5));
      g.set([0.95, 0.95, 0.98], 0, 0); g.cyl([P.x, P.y, P.z], [P.x, P.y + 3.4, P.z], 0.12, 0.12, 6, false);
      g.set([0.1, 0.08, 0.1], 0, 0); g.box(P.x, P.y + 3.2, P.z, 0.2, 0.7, 1.3);
      g.set([1, 1, 0.1], 0, 0.5); g.at([P.x, P.y + 3.9, P.z], [0, P.ang, 0], 1, (gg) => { gg.box(0, 0, 0, 0.06, 0.12, 1.6); gg.box(0, 0, 0, 0.06, 1.6, 0.12); });
      lights.push([P.x, P.y + 3.3, P.z, P.ang]);
    }
  }
  const base = mesh(g);
  track.group.add(base);
  // flashing lamp pair (separate so we can blink)
  const lampGeo = new THREE.SphereGeometry(0.22, 8, 6);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xff2030 });
  const lampMat2 = new THREE.MeshBasicMaterial({ color: 0x401010 });
  const lamps = lights.flatMap(([x, y, z, a]) => [-1, 1].map((k) => { const m = new THREE.Mesh(lampGeo, lampMat2); m.position.set(x + Math.sin(a) * 0.4 * k, y, z + Math.cos(a) * 0.4 * k); track.group.add(m); return m; }));
  // boom gates (pivot on the kerb side, swing down over the road)
  const booms = [];
  for (const side of [-1, 1]) for (const along of [-4.5, 4.5]) {
    const P = frame(track, s0 + along, side * (halfW - 5));
    const pivot = new THREE.Group();
    pivot.position.set(P.x, P.y + 1.1, P.z);
    pivot.rotation.y = P.ang;
    const bg = new Geo();
    for (let k = 0; k < 8; k++) { bg.set(k % 2 ? [1, 0.85, 0.1] : [0.08, 0.06, 0.1], 0, 0.05); bg.box(0, 0, -side * (0.6 + k * 1.1), 0.12, 0.18, 1.1); }
    const bm = mesh(bg);
    pivot.add(bm);
    track.group.add(pivot);
    booms.push({ pivot, side });
  }
  // train
  const train = trainModel(o.cars ?? 4, o.color ?? '#56f06b');
  track.group.add(train);
  const trainLen = (o.cars ?? 4) * 18.8;
  const state = { phase: 0 };
  track.crossings = track.crossings || [];
  const X = { s0, period, cross, warn, offset, active: false };
  track.crossings.push(X);
  let bellT = 0;
  track.updaters.push((dt, t, race) => {
    const ph = ((t + offset) % period);
    const warning = ph > period - warn - cross && ph < period - cross;
    const passing = ph >= period - cross;
    X.active = warning || passing;
    X.passing = passing;
    X.timeTo = warning || passing ? 0 : period - warn - cross - ph;
    const blink = Math.floor(t * 3) % 2;
    lamps.forEach((m, k) => { m.material = X.active && ((k % 2) === blink) ? lampMat : lampMat2; });
    const down = X.active ? 1 : 0;
    for (const b of booms) b.pivot.rotation.x += ((down ? 0 : b.side * 1.35) - b.pivot.rotation.x) * Math.min(1, dt * 3);
    // train position along the cross axis
    const k = passing ? (ph - (period - cross)) / cross : -1;
    const lat = lerp(-halfW - trainLen - 10, halfW + trainLen + 10, Math.max(0, k));
    train.visible = passing;
    const P = frame(track, s0, 0);
    train.position.set(P.x + P.rx * lat, P.y, P.z + P.rz * lat);
    train.rotation.y = Math.atan2(-P.rz, P.rx);
    state.lat = lat;
    if (race) {
      if (X.active && race.player.pos.distanceTo(train.position) < 140 && (bellT -= dt) <= 0) { bellT = 0.5; race.audio?.tone(1300, 0.18, { type: 'square', vol: 0.05 }); race.audio?.tone(1100, 0.18, { type: 'square', vol: 0.05, t: 0.2 }); }
      if (passing) {
        for (const c of race.cars) {
          const ds = path.delta(s0, c.s);
          if (Math.abs(ds) > 3.2) continue;
          const cl = c.lat ?? 0;
          if (cl < lat + 10.5 && cl > lat - trainLen + 7.5) {
            if (race.hitCar(c, 'tumble', null, 'CLANG!!')) {
              c.speed = -Math.abs(c.speed) * 0.3;
              race.fx.burst(c.pos.x, c.pos.y + 1, c.pos.z, 20, { color: [1, 0.9, 0.4], shape: SHAPE.STAR, size: 1.2, life: 0.5, speed: 12 });
            }
          }
        }
      }
    }
  });
  // AI: stop before the crossing if the train will be there
  const prev = track.aiSpeedLimit;
  track.aiSpeedLimit = (s, v) => {
    let lim = prev ? prev(s, v) : Infinity;
    const ds = path.delta(s, s0);
    if (ds > 0 && ds < 70) {
      const eta = ds / Math.max(8, v.speed);
      const ph = ((race0.time + eta + offset) % period);
      const busy = ph >= period - cross - 0.6 || (X.active && eta < cross + 0.3);
      if (busy) lim = Math.min(lim, Math.max(0, (ds - 9) * 1.1));
    }
    return lim;
  };
  const race0 = { get time() { return track._time || 0; } };
  track.updaters.push((dt, t) => { track._time = t; });
  return X;
}

/** Elevated train passing over the road on a viaduct (visual). */
export function viaduct(track, u, o = {}) {
  const s0 = u * track.path.length;
  const F = frame(track, s0);
  const H = o.height ?? 9;
  const span = 400;
  const g = new Geo();
  g.set(rgb(o.color || '#5a5474'), 0, 0);
  g.at([F.x, F.y + H, F.z], [0, F.ang, 0], 1, (gg) => {
    gg.box(0, 0, 0, 7, 1.2, span);
    gg.set(rgb('#8a84a8'), 0, 0);
    gg.box(-3.3, 1.1, 0, 0.3, 1.0, span); gg.box(3.3, 1.1, 0, 0.3, 1.0, span);
    gg.set(rgb('#ff2d6f'), 0, 0.9); gg.box(-3.5, -0.3, 0, 0.1, 0.25, span); gg.box(3.5, -0.3, 0, 0.1, 0.25, span);
    gg.set(rgb('#4a4466'), 0, 0);
    // piers: down to the road level, or all the way to the ground for skyways
    const ph = o.ground ? F.y + H - (track.theme.groundY ?? 0) : H;
    for (let z = -span / 2 + 20; z < span / 2; z += 40) {
      const lim = Math.max(track.limL[F.i], track.limR[F.i]) + 4;
      if (Math.abs(z) < lim) continue;
      gg.box(0, -ph / 2, z, 3, ph, 3);
    }
  });
  track.group.add(mesh(g));
  const train = trainModel(o.cars ?? 5, o.trainColor || '#ff8a1e');
  track.group.add(train);
  const period = o.period ?? 14;
  const len = (o.cars ?? 5) * 18.8;
  track.updaters.push((dt, t) => {
    const k = ((t + (o.offset ?? 0)) % period) / period;
    const z = lerp(-span / 2 - len, span / 2 + len, k);
    const dir = [Math.sin(F.ang), Math.cos(F.ang)];
    train.position.set(F.x + dir[0] * z, F.y + H + 0.6, F.z + dir[1] * z);
    train.rotation.y = F.ang - Math.PI / 2;
  });
}

// ------------------------------------------------------------------ traffic
function trafficModel(kind, color) {
  const g = new Geo();
  const c = rgb(color);
  if (kind === 'truck') {
    g.set([0.9, 0.9, 0.92], 0, 0); g.box(-1.5, 1.9, 0, 7, 3.2, 2.5);
    g.set(c, 0, 0); g.box(2.8, 1.5, 0, 2.2, 2.4, 2.4);
    g.set([0.12, 0.15, 0.25], 0, 0); g.box(3.6, 2.0, 0, 0.6, 0.9, 2.2);
    g.set([0.1, 0.1, 0.12], 0, 0); for (const x of [-3.5, -1, 2.8]) for (const z of [-1.1, 1.1]) g.at([x, 0.5, z], [Math.PI / 2, 0, 0], 1, (gg) => gg.cyl([0, -0.2, 0], [0, 0.2, 0], 0.5, 0.5, 10, true));
    g.set([1, 0.1, 0.1], 0, 1); g.box(-5.02, 1.0, 1.0, 0.04, 0.3, 0.4); g.box(-5.02, 1.0, -1.0, 0.04, 0.3, 0.4);
    g.set([1, 0.6, 0.1], 0, 0.8); for (let k = 0; k < 5; k++) g.box(-4.8 + k * 1.6, 3.55, 1.26, 0.2, 0.1, 0.02);
  } else {
    g.set(c, 0, 0); g.box(0, 0.75, 0, 4.2, 0.8, 1.8); g.box(-0.3, 1.4, 0, 2.2, 0.6, 1.6, [0.8, 0.9]);
    g.set([0.12, 0.15, 0.25], 0, 0); g.box(-0.3, 1.42, 0, 2.0, 0.45, 1.62, [0.8, 0.9]);
    g.set([0.1, 0.1, 0.12], 0, 0); for (const x of [-1.3, 1.3]) for (const z of [-0.85, 0.85]) g.at([x, 0.35, z], [Math.PI / 2, 0, 0], 1, (gg) => gg.cyl([0, -0.15, 0], [0, 0.15, 0], 0.35, 0.35, 10, true));
    g.set([1, 0.1, 0.1], 0, 1); g.box(-2.12, 0.85, 0.65, 0.04, 0.2, 0.4); g.box(-2.12, 0.85, -0.65, 0.04, 0.2, 0.4);
    if (kind === 'taxi') { g.set([1, 0.9, 0.2], 0, 1); g.box(-0.3, 1.85, 0, 0.6, 0.25, 0.4); }
  }
  return mesh(g);
}

/** Civilian traffic on lanes, same direction as the race. */
export function traffic(track, o = {}) {
  const n = o.count ?? 10;
  const path = track.path;
  const list = [];
  const kinds = ['car', 'car', 'taxi', 'truck', 'car', 'taxi'];
  const colors = ['#f4f4f4', '#2b2f3a', '#c93dff', '#ff8a1e', '#2a8cff', '#7c8190', '#ffe23b'];
  for (let k = 0; k < n; k++) {
    const kind = kinds[k % kinds.length];
    const m = trafficModel(kind, kind === 'taxi' ? '#ffcf3a' : colors[k % colors.length]);
    track.group.add(m);
    const lane = (o.lanes || [-0.55, -0.18, 0.18, 0.55])[k % (o.lanes?.length || 4)];
    list.push({ m, s: (k / n) * path.length + Math.random() * 30, laneF: lane, speed: (o.speed ?? 24) * (0.85 + Math.random() * 0.3), r: kind === 'truck' ? 2.8 : 1.9, kind, lat: 0, bumpT: 0, dodge: 0 });
  }
  track.movers = track.movers || [];
  for (const t of list) track.movers.push(t);
  track.updaters.push((dt, t, race) => {
    for (const c of list) {
      if (o.ranges && !o.ranges.some(([a, b]) => { const u = c.s / path.length; return u >= a && u <= b; })) { c.s += (o.speed ?? 24) * 3 * dt; }
      c.s = path.wrapS(c.s + c.speed * dt);
      const i = path.indexAt(c.s);
      const hw = path.w[i] / 2;
      c.bumpT = Math.max(0, c.bumpT - dt);
      c.dodge *= Math.pow(0.3, dt);
      c.lat = c.laneF * (hw - 2) + c.dodge;
      const P = path.point(c.s, c.lat);
      const visible = !o.ranges || o.ranges.some(([a, b]) => { const u = c.s / path.length; return u >= a && u <= b; });
      c.m.visible = visible;
      c.m.position.set(P.px, P.py, P.pz);
      c.m.rotation.y = Math.atan2(-P.tz, P.tx) + Math.sin(c.bumpT * 20) * c.bumpT * 0.3;
      c.x = P.px; c.z = P.pz;
      if (!race || !visible) continue;
      for (const v of race.cars) {
        const dx = v.pos.x - P.px, dz = v.pos.z - P.pz;
        const d = Math.hypot(dx, dz);
        const R = c.r + 1.3;
        if (d < R && Math.abs(v.pos.y - P.py) < 3) {
          const nx = dx / (d || 1), nz = dz / (d || 1);
          v.pos.x += nx * (R - d); v.pos.z += nz * (R - d);
          const vn = v.vel.x * nx + v.vel.z * nz - (P.tx * nx + P.tz * nz) * c.speed;
          if (vn < 0) {
            const fx = Math.cos(v.yaw), fz = -Math.sin(v.yaw), rx = Math.sin(v.yaw), rz = Math.cos(v.yaw);
            const ix = -1.5 * vn * nx, iz = -1.5 * vn * nz;
            v.speed += ix * fx + iz * fz;
            v.latVel += (ix * rx + iz * rz) * 0.6;
            c.bumpT = 0.5; c.dodge += -Math.sign((v.lat ?? 0) - c.lat) * 1.5;
            if (-vn > 10) {
              race.fx.burst((v.pos.x + P.px) / 2, P.py + 1, (v.pos.z + P.pz) / 2, 12, { color: [1, 0.85, 0.4], shape: SHAPE.STAR, size: 1, life: 0.4, speed: 9 });
              if (v.isPlayer) { race.audio?.sfx('bump'); race.chase.shake(0.35); race.audio?.tone(520, 0.25, { type: 'square', vol: 0.06 }); race.audio?.tone(420, 0.3, { type: 'square', vol: 0.06, t: 0.12 }); if (Math.random() < 0.5) race.fx.pop(['HONK!', 'BEEP BEEP!', 'OI!'][Math.floor(Math.random() * 3)], { world: new THREE.Vector3(P.px, P.py + 3, P.pz), cls: 'small' }); }
            }
          }
        }
      }
    }
  });
}

// ------------------------------------------------------------------ crane drops
export function craneDrop(track, spots, o = {}) {
  const path = track.path;
  const list = [];
  for (const [u, lat, off] of spots) {
    const s = u * path.length;
    const F = frame(track, s, lat);
    const g = new Geo();
    // gantry crane straddling the road
    const hw = Math.max(track.limL[F.i], track.limR[F.i]) + 3;
    const C = frame(track, s, 0);
    g.set(rgb(o.color || '#ff8a1e'), 0, 0);
    g.at([C.x, C.y, C.z], [0, C.ang, 0], 1, (gg) => {
      for (const z of [-hw, hw]) for (const x of [-4, 4]) gg.box(x, 12, z, 1, 24, 1);
      gg.box(0, 24.5, 0, 10, 1.5, hw * 2 + 2);
      for (const z of [-hw, hw]) gg.box(0, 1, z, 10, 0.8, 1.4);
      gg.set(rgb('#2a2440'), 0, 0); gg.box(0, 25.8, 0, 3, 1.2, hw * 2 + 6);
    });
    track.group.add(mesh(g));
    track.addBox(C.x + C.rx * -hw, C.z + C.rz * -hw, 4.5, 0.7, C.ang, { tag: 'crane' });
    track.addBox(C.x + C.rx * hw, C.z + C.rz * hw, 4.5, 0.7, C.ang, { tag: 'crane' });
    // trolley + container
    const cg = new Geo();
    cg.set(rgb(['#2a8cff', '#ff2d6f', '#56f06b', '#ffe23b'][list.length % 4]), 0, 0);
    cg.box(0, 1.3, 0, 7, 2.6, 2.6);
    cg.set([0, 0, 0], 0, 0); for (let k = 0; k < 10; k++) cg.box(-3.3 + k * 0.73, 1.3, 0, 0.1, 2.4, 2.66);
    const cont = mesh(cg);
    const trol = new THREE.Group();
    trol.add(cont);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 4), new THREE.MeshBasicMaterial({ color: 0x140818 }));
    trol.add(cable);
    track.group.add(trol);
    // warning shadow
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.4), new THREE.MeshBasicMaterial({ color: 0xff2050, transparent: true, opacity: 0.0, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.rotation.z = F.ang;
    shadow.position.set(F.x, F.y + 0.06, F.z);
    track.group.add(shadow);
    list.push({ F, trol, cont, cable, shadow, off: off ?? list.length * 3.1, s, lat, period: o.period ?? 9 });
  }
  track.updaters.push((dt, t, race) => {
    for (const d of list) {
      const ph = ((t + d.off) % d.period) / d.period; // 0..1
      // 0-.45 hold high, .45-.6 warn, .6-.7 drop, .7-.85 sit, .85-1 lift
      let y;
      if (ph < 0.45) y = 20; else if (ph < 0.62) y = 20 - (ph - 0.45) / 0.17 * 1.5; else if (ph < 0.68) y = lerp(18.5, 0, (ph - 0.62) / 0.06); else if (ph < 0.85) y = 0; else y = lerp(0, 20, (ph - 0.85) / 0.15);
      d.trol.position.set(d.F.x, d.F.y + y, d.F.z);
      d.trol.rotation.y = d.F.ang;
      d.cable.scale.y = Math.max(0.1, 25 - y - 2.6);
      d.cable.position.y = 2.6 + (25 - y - 2.6) / 2;
      const warn = ph > 0.42 && ph < 0.7;
      d.shadow.material.opacity = warn ? 0.35 + 0.3 * (Math.sin(t * 20) > 0 ? 1 : 0) : 0;
      const landing = ph >= 0.62 && ph < 0.69;
      const onGround = ph >= 0.66 && ph < 0.86;
      if (landing && !d.landed && ph > 0.675) {
        d.landed = true;
        if (race) {
          race.fx.burst(d.F.x, d.F.y + 0.3, d.F.z, 18, { color: [0.8, 0.75, 0.7], shape: SHAPE.PUFF, size: 2, grow: 1.5, life: 0.7, speed: 9, up: 1 });
          const dist = race.player.pos.distanceTo(d.trol.position);
          if (dist < 60) { race.chase.shake(0.5 * (1 - dist / 60)); race.audio?.sfx('bump', { vol: 1 }); race.audio?.sfx('smashBig', { vol: 0.6 * (1 - dist / 60) }); }
          if (dist < 40) race.fx.pop('KA-THOOM!', { world: new THREE.Vector3(d.F.x, d.F.y + 5, d.F.z) });
        }
      }
      if (!landing) d.landed = false;
      if (!race) continue;
      if (onGround || (landing && ph > 0.655)) {
        for (const c of race.cars) {
          const dx = c.pos.x - d.F.x, dz = c.pos.z - d.F.z;
          const la = dx * d.F.tx + dz * d.F.tz, lo = dx * d.F.rx + dz * d.F.rz;
          if (Math.abs(la) < 3.8 + 1.2 && Math.abs(lo) < 1.4 + 1.2) {
            if (landing) race.hitCar(c, 'squash', null, 'SQUASH!');
            // solid block while it sits on the road
            const px = Math.abs(la) - (3.8 + 1.2), pz = Math.abs(lo) - (1.4 + 1.2);
            if (px > pz) { const k = -px * Math.sign(la); c.pos.x += d.F.tx * k; c.pos.z += d.F.tz * k; c.speed *= 0.5; }
            else { const k = -pz * Math.sign(lo); c.pos.x += d.F.rx * k; c.pos.z += d.F.rz * k; c.latVel *= -0.3; }
          }
        }
      }
    }
  });
  track.movers = track.movers || [];
  for (const d of list) track.movers.push({ get s() { return d.s; }, get lat() { return d.lat; }, get x() { return d.F.x; }, get z() { return d.F.z; }, r: 4, hazard: true, get active() { return ((track._time + d.off) % d.period) / d.period > 0.4 && ((track._time + d.off) % d.period) / d.period < 0.86; } });
  track.updaters.push((dt, t) => { track._time = t; });
}

// ------------------------------------------------------------------ drawbridge
export function drawbridge(track, u, len = 26, o = {}) {
  const path = track.path;
  const s0 = u * path.length;
  const i = path.indexAt(s0);
  const w = path.w[i] + 1;
  const ramp = track.addRamp(u, 0, w, len, 0.01, { color: o.color || '#ffd23f', side: '#3a3450' });
  ramp.dynamic = true;
  // deck mesh that tilts: two leaves meeting in the middle
  const F0 = frame(track, s0), F1 = frame(track, s0 + len);
  const leaf = (F, dir) => {
    const g = new Geo();
    g.set(rgb('#5a5474'), 0, 0); g.box(dir * len / 4, -0.3, 0, len / 2, 0.6, w);
    g.set(rgb('#ffd23f'), 0, 0.15); for (let k = 0; k < 5; k++) g.box(dir * (len / 2 * (k + 0.5) / 5), 0.02, 0, 0.6, 0.04, w * 0.95);
    g.set(rgb('#ff2d6f'), 0, 0.8); g.box(dir * len / 4, 0.3, w / 2, len / 2, 0.15, 0.15); g.box(dir * len / 4, 0.3, -w / 2, len / 2, 0.15, 0.15);
    const m = mesh(g);
    const pivot = new THREE.Group();
    pivot.position.set(F.x, F.y, F.z);
    pivot.rotation.y = F.ang;
    pivot.add(m);
    track.group.add(pivot);
    return pivot;
  };
  const a = leaf(F0, 1);
  const b = leaf(F1, -1);
  // tower portals
  const g = new Geo();
  for (const F of [F0, F1]) {
    g.set(rgb('#8a84a8'), 0, 0);
    g.at([F.x, F.y, F.z], [0, F.ang, 0], 1, (gg) => { for (const z of [-w / 2 - 1.5, w / 2 + 1.5]) gg.box(0, 8, z, 2.4, 16, 2.4); gg.box(0, 15.5, 0, 2.4, 1.6, w + 5); gg.set(rgb('#ff2d6f'), 0, 1); gg.box(1.25, 15.5, 0, 0.05, 0.4, w + 4); });
  }
  track.group.add(mesh(g));
  const period = o.period ?? 16;
  const maxA = o.angle ?? 0.26;
  track.updaters.push((dt, t) => {
    const ph = ((t + (o.offset ?? 0)) % period) / period;
    // raise, hold (jump ramp), lower, hold flat
    const k = ph < 0.2 ? ph / 0.2 : ph < 0.55 ? 1 : ph < 0.7 ? 1 - (ph - 0.55) / 0.15 : 0;
    const e = k * k * (3 - 2 * k);
    const ang = e * maxA;
    a.rotation.z = ang;
    b.rotation.z = -ang * 0.0;
    // physics: first half becomes a ramp rising to its tip
    ramp.h = Math.sin(ang) * len / 2;
    ramp.s1 = ramp.s0 + len / 2;
  });
  ramp.s1 = ramp.s0 + len / 2;
  return ramp;
}

// ------------------------------------------------------------------ rolling hazards
function ballModel(kind, color) {
  const g = new Geo();
  if (kind === 'gacha') {
    // two-tone capsule: coloured cap, white base, dark seam band
    const R = 1.6, n = 6;
    const half = (sgn) => { const pr = []; for (let k = 0; k <= n; k++) { const a = (k / n) * Math.PI / 2; pr.push([Math.cos(a) * R, sgn * Math.sin(a) * R]); } return sgn > 0 ? pr : pr.reverse(); };
    g.set(rgb(color || '#ff5ccf'), 0, 0.15); g.lathe(half(1).map(([r, x]) => [r, x + 0.02]).reverse(), 12);
    g.set([0.96, 0.96, 1], 0, 0.05); g.lathe(half(-1).map(([r, x]) => [r, x - 0.02]).reverse(), 12);
    g.set([0.12, 0.1, 0.16], 0, 0); g.cyl([-0.08, 0, 0], [0.08, 0, 0], R * 1.01, R * 1.01, 12, false);
  } else {
    g.set([0.5, 0.44, 0.5], 0, 0); g.sphere(0, 0, 0, 1.7, 1.5, 1.6, 7, 5);
    g.set([0.38, 0.33, 0.4], 0, 0); g.sphere(0.6, 0.5, 0.3, 0.9, 0.8, 0.9, 5, 4);
  }
  return mesh(g);
}

/** Boulders / capsules rolling across or along the road on a cycle. */
export function rollers(track, spots, o = {}) {
  const path = track.path;
  const list = spots.map(([u, dir, off], k) => {
    const m = ballModel(o.kind || 'rock', o.colors?.[k % o.colors.length]);
    track.group.add(m);
    return { m, s0: u * path.length, dir, off: off ?? 0, s: 0, lat: 0, x: 0, z: 0, active: false };
  });
  const period = o.period ?? 7;
  track.movers = track.movers || [];
  for (const b of list) track.movers.push(b);
  track.updaters.push((dt, t, race) => {
    for (const b of list) {
      const ph = ((t + b.off) % period) / period;
      const i = path.indexAt(b.s0);
      const W = Math.max(track.limL[i], track.limR[i]) + 12;
      let s = b.s0, lat;
      if (o.along) { s = b.s0 - ph * (o.along); lat = b.dir * (path.w[i] / 2 - 3) * Math.sin(ph * 9); }
      else lat = b.dir * lerp(-W, W, ph);
      const P = path.point(s, lat);
      b.s = s; b.lat = lat; b.x = P.px; b.z = P.pz; b.active = true;
      const r = o.kind === 'gacha' ? 1.6 : 1.7;
      const bounce = Math.abs(Math.sin(ph * Math.PI * 6)) * 0.8;
      b.m.position.set(P.px, P.py + r + bounce, P.pz);
      b.m.rotation.x += dt * 4 * b.dir; b.m.rotation.z += dt * 3;
      if (!race) continue;
      for (const c of race.cars) {
        const dx = c.pos.x - P.px, dz = c.pos.z - P.pz;
        if (dx * dx + dz * dz < (r + 1.3) ** 2) race.hitCar(c, 'tumble', null, o.kind === 'gacha' ? 'GACHA-BONK!' : 'KRAK!');
      }
    }
  });
}

// ------------------------------------------------------------------ laser gates / boom barriers
/** Gates that block one half of the road at a time. o.style: 'laser' | 'boom' (car park barrier arms). */
export function laserGates(track, spots, o = {}) {
  const path = track.path;
  const list = [];
  const boom = o.style === 'boom';
  for (const [u, off] of spots) {
    const s = u * path.length;
    const i = path.indexAt(s);
    const W = Math.max(track.limL[i], track.limR[i]);
    const F = frame(track, s);
    // posts
    const g = new Geo();
    for (const side of [-1, 1]) {
      const P = frame(track, s, side * (W + 0.3));
      if (boom) {
        g.set(rgb('#ffd23f'), 0, 0); g.box(P.x, P.y + 0.6, P.z, 1.1, 1.2, 1.1);
        g.set(rgb('#2a2440'), 0, 0); g.box(P.x, P.y + 1.35, P.z, 0.9, 0.3, 0.9);
        g.set(rgb('#ff2d6f'), 0, 1); g.sphere(P.x, P.y + 1.75, P.z, 0.22, 0.22, 0.22, 6, 4);
      } else {
        g.set(rgb('#2a2440'), 0, 0); g.box(P.x, P.y + 2, P.z, 0.8, 4, 0.8);
        g.set(rgb('#ff2d6f'), 0, 1); g.box(P.x, P.y + 4.1, P.z, 0.9, 0.2, 0.9);
      }
      track.addCircle(P.x, P.z, 0.6, { tag: 'post' });
    }
    track.group.add(mesh(g));
    const beams = [];
    for (const half of [-1, 1]) {
      if (boom) {
        // striped arm on a pivot at the post; rotates up about the road tangent
        const ag = new Geo();
        for (let k = 0; k < 6; k++) {
          ag.set(k % 2 ? rgb('#ff2d6f') : rgb('#f4f4ff'), 0, k % 2 ? 0.35 : 0.1);
          ag.box(0, 0, -half * (k + 0.5) * (W / 6), 0.22, 0.3, W / 6);
        }
        const P = frame(track, s, half * (W + 0.3));
        const pivot = new THREE.Group();
        pivot.position.set(P.x, P.y + 1.15, P.z);
        pivot.rotation.order = 'YXZ';
        pivot.rotation.y = F.ang;
        pivot.add(mesh(ag));
        track.group.add(pivot);
        beams.push({ half, pivot, a: 1.4 });
        continue;
      }
      const bm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, W), new THREE.MeshBasicMaterial({ color: half < 0 ? new THREE.Color(2.6, 0.3, 0.6) : new THREE.Color(0.3, 2.2, 2.6) }));
      const P = frame(track, s, half * W / 2);
      bm.position.set(P.x, P.y + 1.0, P.z);
      bm.rotation.y = F.ang;
      track.group.add(bm);
      const bm2 = bm.clone(); bm2.position.y += 0.9; track.group.add(bm2);
      beams.push({ half, meshes: [bm, bm2] });
    }
    list.push({ s, W, beams, off: off ?? 0, F });
  }
  const period = o.period ?? 3.2;
  track.updaters.push((dt, t, race) => {
    for (const g of list) {
      const ph = ((t + g.off) % period) / period;
      const onHalf = ph < 0.5 ? -1 : 1;
      let flicker = ph % 0.5 > 0.42;
      for (const b of g.beams) {
        if (boom) {
          const target = b.half === onHalf ? 0 : 1.4;
          b.a += Math.max(-dt * 3.2, Math.min(dt * 3.2, target - b.a));
          b.pivot.rotation.x = b.half * b.a;
          b.on = b.a < 0.35;
          continue;
        }
        const on = b.half === onHalf && !flicker; b.meshes.forEach((m) => { m.visible = on; }); b.on = on;
      }
      if (boom) flicker = !g.beams.some((b) => b.on && b.half === onHalf);
      g.onHalf = onHalf;
      if (!race) continue;
      for (const c of race.cars) {
        const ds = path.delta(g.s, c.s);
        if (Math.abs(ds) > 1.2) continue;
        const l = c.lat ?? 0;
        if (!flicker && Math.sign(l || 1) === onHalf && Math.abs(l) > 0.5) race.hitCar(c, 'spin', null, boom ? 'BONK!' : 'BZZZT!');
      }
    }
  });
  const prevBias = track.aiLaneBias;
  track.aiLaneBias = (s, latT) => {
    let b = prevBias ? prevBias(s, latT) : 0;
    for (const g of list) {
      const ds = path.delta(s, g.s);
      if (ds > 0 && ds < 50) { const safe = -(g.onHalf || 1); if (Math.sign(latT || 1) !== safe) b += safe * 5; }
    }
    return b;
  };
}

// ------------------------------------------------------------------ gutter hook (touge)
export function gutters(track, spots) {
  const path = track.path;
  const zones = [];
  for (const [u0, u1, side] of spots) {
    const s0 = u0 * path.length, s1 = u1 * path.length;
    const g = track.chunks.W(s0);
    for (let s = s0; s < s1; s += 2) {
      const i = path.indexAt(s);
      const hw = path.w[i] / 2;
      const a = path.point(s, side * (hw - 1.4)), b = path.point(s, side * (hw - 0.2)), c = path.point(s + 2, side * (hw - 0.2)), d = path.point(s + 2, side * (hw - 1.4));
      g.set(((s / 2) | 0) % 2 ? rgb('#3a3450') : rgb('#56f06b'), 0, ((s / 2) | 0) % 2 ? 0 : 0.6);
      const P = (q) => [q.px, q.py + 0.02, q.pz];
      if (side > 0) g.quad(P(a), P(b), P(c), P(d)); else g.quad(P(b), P(a), P(d), P(c));
    }
    zones.push({ s0, s1, side });
  }
  track.updaters.push((dt, t, race) => {
    if (!race) return;
    for (const c of race.cars) {
      if (!c.grounded) continue;
      for (const z of zones) {
        let ds = c.s - z.s0; if (ds < 0) ds += path.length;
        if (ds > z.s1 - z.s0) continue;
        const i = path.indexAt(c.s);
        const hw = path.w[i] / 2;
        const l = (c.lat ?? 0) * z.side;
        if (l > hw - 1.8 && l < hw + 0.5) {
          // hook: tighter line + speed
          c.yaw += -z.side * 0.9 * dt * (c.speed > 0 ? 1 : 0);
          if (!c._hooked || c._hooked < performance.now() - 1500) {
            c._hooked = performance.now();
            c.boost(0.7, 1.25, 'pad');
            if (c.isPlayer) race.fx.pop('GUTTER HOOK!', { cls: '', y: 34, color: '#56f06b' });
          }
        }
      }
    }
  });
}

// ------------------------------------------------------------------ kaiju
export function kaiju(track, pos, o = {}) {
  const g = new Geo();
  const S = o.scale ?? 1;
  const skin = rgb(o.color || '#2f5a4a'), belly = rgb('#6f9a6a'), glow = rgb(o.glow || '#40f0ff');
  g.at([0, 0, 0], [0, 0, 0], S, (gg) => {
    gg.set(skin, 0, 0);
    gg.sphere(0, 30, 0, 14, 22, 12, 10, 8);             // torso
    gg.sphere(0, 56, 6, 8, 7, 9, 10, 6);                // head
    gg.box(0, 52, 14, 7, 4, 8, [0.8, 0.8]);             // snout
    gg.set(belly, 0, 0); gg.sphere(0, 28, 8, 9, 16, 6, 8, 6);
    gg.set(skin, 0, 0);
    for (const x of [-12, 12]) { gg.cyl([x, 40, 2], [x * 1.4, 26, 14], 3.5, 2.4, 7, true); gg.sphere(x * 1.4, 25, 15, 3, 3, 3, 6, 4); }
    for (const x of [-7, 7]) gg.cyl([x, 12, 0], [x, -8, 2], 6, 5, 8, true);
    gg.cyl([0, 16, -8], [0, 4, -40], 7, 1, 8, true);   // tail
    gg.set(glow, 0, 1);
    for (let k = 0; k < 7; k++) gg.at([0, 18 + k * 6, -9 - (k < 4 ? 0 : 0)], [0.3, 0, 0], 1 + (3 - Math.abs(k - 3)) * 0.2, (g3) => g3.extrude([[0, 0], [2.4, 0], [1.2, 5]], 1.2));
    gg.set([1, 0.9, 0.2], 0, 1); gg.sphere(-3.5, 58, 13, 1.1, 1.1, 1.1, 6, 4); gg.sphere(3.5, 58, 13, 1.1, 1.1, 1.1, 6, 4);
    gg.set([0.95, 0.95, 0.9], 0, 0.1); for (let k = 0; k < 5; k++) gg.cyl([-3 + k * 1.5, 50.5, 17], [-3 + k * 1.5, 49, 17.5], 0.5, 0.05, 4, true);
  });
  const m = mesh(g);
  const root = new THREE.Group();
  root.add(m);
  root.position.set(pos[0], pos[1] ?? -60, pos[2]);
  root.rotation.y = o.face ?? 0;
  track.group.add(root);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 9, 160, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0x40f0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.rotation.x = Math.PI / 2.4;
  beam.position.set(0, 56 * S, 90 * S);
  root.add(beam);
  const period = o.period ?? 26;
  let roared = false;
  track.updaters.push((dt, t, race) => {
    const ph = ((t + (o.offset ?? 0)) % period) / period;
    // rise from the water, roar, sink
    const up = ph < 0.2 ? ph / 0.2 : ph < 0.75 ? 1 : ph < 0.95 ? 1 - (ph - 0.75) / 0.2 : 0;
    const e = up * up * (3 - 2 * up);
    root.position.y = lerp(-80 * S, (pos[1] ?? -6), e);
    m.rotation.z = Math.sin(t * 0.8) * 0.04;
    m.rotation.x = ph > 0.35 && ph < 0.5 ? -0.12 : 0;
    const roar = ph > 0.36 && ph < 0.48;
    beam.material.opacity = roar ? 0.35 + 0.2 * Math.sin(t * 30) : 0;
    if (race && roar && !roared) {
      roared = true;
      race.chase.shake(0.55);
      race.fx.pop('GRAOOOOOO!!', { cls: 'huge', y: 22, rot: -8, color: '#40f0ff', life: 1.6 });
      race.audio?.sfx('item_ryu', { vol: 0.9 });
      race.audio?.sfx('explosion', { vol: 0.4 });
    }
    if (!roar) roared = false;
  });
  return root;
}

// ------------------------------------------------------------------ boss drone
function oniHead() {
  const g = new Geo();
  const dark = rgb('#2a1426'), bone = rgb('#f0e8d8'), red = rgb('#b0182e'), deep = rgb('#6a1020');
  // skull + face plate (x = forward)
  g.set(dark, 0, 0); g.cbox(-0.5, 0.2, 0, 8, 7.4, 9.4, 0.9);
  g.set(red, 0, 0.08); g.cbox(3.1, 0.4, 0, 2.6, 6.2, 8.2, 0.7);
  // cheek plates, brow, nose ridge, crest
  g.set(deep, 0, 0);
  for (const z of [-1, 1]) g.at([3.4, -1.2, z * 3.6], [0, z * 0.45, z * -0.2], 1, (gg) => gg.box(0, 0, 0, 1.6, 3.4, 2.2));
  g.at([4.3, 2.0, 0], [0, 0, 0], 1, (gg) => { gg.box(0, 0, -2.2, 1.1, 1.1, 3.8); gg.box(0, 0, 2.2, 1.1, 1.1, 3.8); });
  g.set(red, 0, 0.1); g.box(4.5, 0.2, 0, 0.9, 2.4, 1.1);
  g.set(dark, 0, 0); g.at([0.5, 4.1, 0], [0, 0, 0], 1, (gg) => gg.box(0, 0, 0, 7, 1.4, 1.2, [0.4, 1]));
  g.set(rgb('#ff2d6f'), 0, 1); g.box(0.5, 4.85, 0, 6.4, 0.12, 0.5);
  // eyes (angry slant)
  g.set(rgb('#ffe23b'), 0, 1);
  for (const z of [-2.2, 2.2]) g.at([4.55, 1.05, z], [z > 0 ? 0.3 : -0.3, 0, 0], 1, (gg) => gg.box(0, 0, 0, 0.5, 0.95, 2.3));
  // curved horns
  g.set(bone, 0, 0.12);
  for (const z of [-1, 1]) {
    const a = [0.4, 3.4, z * 3.2], b = [-0.2, 6.6, z * 5.2], c = [-1.6, 9.6, z * 5.6];
    g.cyl(a, b, 1.25, 0.75, 8, true); g.cyl(b, c, 0.75, 0.1, 8, true);
  }
  // jaw with teeth + fangs and the laser emitter
  g.set(dark, 0, 0); g.cbox(2, -4.3, 0, 4.8, 2, 7.4, 0.4);
  g.set(bone, 0, 0.12);
  for (let k = -3; k <= 3; k++) g.box(4.35, -3.2, k * 1.0, 0.5, 0.6, 0.55);
  for (const z of [-1, 1]) g.cyl([4.3, -2.9, z * 2.9], [4.4, -4.6, z * 2.7], 0.35, 0.05, 6, true);
  g.set(rgb('#ff2d6f'), 0, 1); g.cyl([2.2, -5.2, 0], [2.2, -5.8, 0], 1.3, 0.8, 10, true);
  // thrusters, side fins
  g.set(rgb('#20d8ff'), 0, 1); for (const z of [-3, 3]) g.cyl([-2, -3.4, z], [-2, -4.3, z], 1.0, 0.6, 8, true);
  g.set(rgb('#4a2440'), 0, 0); for (const z of [-5, 5]) g.at([-1, -0.4, z], [0, 0, 0.25], 1, (gg) => gg.box(0, 0, 0, 5.4, 3.2, 0.6));
  return g;
}

/**
 * Giant mecha-oni head that glides ahead of the leader and fires telegraphed
 * laser strikes at racers: a red ring marks the spot, then the beam lands.
 */
export function bossDrone(track, o = {}) {
  const path = track.path;
  const L = path.length;
  const root = new THREE.Group();
  const head = mesh(oniHead());
  root.add(head);
  root.scale.setScalar(o.scale ?? 1.5);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(7.8, 0.35, 6, 36), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.35, 0.8) }));
  halo.rotation.y = Math.PI / 2; halo.position.x = -4;
  root.add(halo);
  const orbs = [0, 1, 2].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2, 2.4) })); root.add(m); return m; });
  track.group.add(root);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.2, 0.5), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 4.8, 32), ringMat);
  const fillMat = ringMat.clone();
  const fill = new THREE.Mesh(new THREE.CircleGeometry(3.4, 32), fillMat);
  for (const m of [ring, fill]) { m.rotation.x = -Math.PI / 2; m.renderOrder = 4; track.group.add(m); }
  const beam = new THREE.Group();
  const beamOuter = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.4, 1.2), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const beamCore = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1, 8, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3) }));
  beam.add(beamOuter, beamCore);
  beam.visible = false;
  track.group.add(beam);

  const st = { s: 0, phase: 'idle', t: 0, next: o.delay ?? 7, tx: 0, ty: 0, tz: 0, ts: 0, tl: 0, pos: new THREE.Vector3() };
  track.boss = { root, st };
  const mover = { s: 0, lat: 0, x: 0, z: 0, r: 5.5, hazard: true, active: false };
  track.movers = track.movers || [];
  track.movers.push(mover);
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), mouth = new THREE.Vector3();
  const period = o.period ?? 4.2, warn = o.warn ?? 1.35;
  track.updaters.push((dt, t, race) => {
    // ---- glide ahead of the leader (a lazy lap when there is no race)
    let goal = (t * 24) % L;
    let rage = 1;
    if (race && race.cars.length) {
      const lead = race.cars.reduce((a, c) => (c.progress > a.progress ? c : a));
      goal = lead.s + (o.ahead ?? 80);
      if (lead.lap >= (race.laps || 3)) rage = 0.7;
    }
    const ds = path.delta(st.s, goal);
    st.s = path.wrapS(st.s + Math.max(-60, Math.min(90, ds * 1.6)) * dt);
    const P = path.point(st.s, Math.sin(t * 0.6) * 4);
    const hy = P.py + (o.height ?? 24) + Math.sin(t * 1.3) * 1.2;
    st.pos.set(P.px, hy, P.pz);
    root.position.copy(st.pos);
    // face the oncoming pack (against the direction of travel), look down at the target while charging
    root.rotation.set(0, Math.atan2(P.tz, -P.tx), st.phase === 'warn' ? -0.25 : 0, 'YXZ');
    halo.rotation.x = t * 1.8;
    orbs.forEach((m, k) => { const a = t * 2.4 + (k * Math.PI * 2) / 3; m.position.set(-4, Math.cos(a) * 7.8, Math.sin(a) * 7.8); });
    // ---- strike cycle: pick -> warn (ring) -> fire (beam) -> cool
    st.t += dt;
    if (st.phase === 'idle' && st.t > st.next && race && race.state === 'race') {
      const cand = race.cars.filter((c) => { const d = path.delta(c.s, st.s); return d > 25 && d < 150 && !c.finished; });
      if (cand.length) {
        const c = (race.player && cand.includes(race.player) && Math.random() < 0.45) ? race.player : cand[Math.floor(Math.random() * cand.length)];
        st.ts = path.wrapS(c.s + Math.max(12, c.speed * warn * 0.95));
        st.tl = Math.max(-6, Math.min(6, (c.lat ?? 0) * 0.8));
        const T = path.point(st.ts, st.tl);
        st.tx = T.px; st.ty = T.py; st.tz = T.pz;
        st.phase = 'warn'; st.t = 0;
        for (const m of [ring, fill]) m.position.set(st.tx, st.ty + 0.09, st.tz);
        mover.s = st.ts; mover.lat = st.tl; mover.x = st.tx; mover.z = st.tz; mover.active = true;
        if (race.player && st.pos.distanceTo(race.player.pos) < 160) race.audio?.sfx('laserCharge', { vol: 0.8 });
      } else st.next = st.t + 0.5;
    }
    if (st.phase === 'warn') {
      const k = st.t / warn;
      const blink = Math.sin(st.t * (10 + k * 30)) > 0 ? 1 : 0.55;
      ringMat.opacity = 0.9 * blink; fillMat.opacity = 0.18 + 0.3 * k;
      ring.scale.setScalar(1.4 - 0.4 * k);
      if (st.t >= warn) {
        st.phase = 'fire'; st.t = 0;
        ringMat.opacity = 0; fillMat.opacity = 0;
        if (race) {
          race.fx.explosion(st.tx, st.ty + 0.5, st.tz, 1.1, [1, 0.3, 0.7]);
          race.fx.ring(st.tx, st.ty + 0.3, st.tz, 9, [1, 0.4, 0.8]);
          for (const c of race.cars) {
            const dx = c.pos.x - st.tx, dz = c.pos.z - st.tz;
            if (dx * dx + dz * dz < 5.6 * 5.6 && Math.abs(c.pos.y - st.ty) < 4) race.hitCar(c, 'tumble', null, 'ZAAAP!');
          }
          const d = race.player ? race.player.pos.distanceTo(new THREE.Vector3(st.tx, st.ty, st.tz)) : 999;
          if (d < 90) { race.chase.shake(0.55 * (1 - d / 90)); race.audio?.sfx('laserFire', { vol: 1 - d / 120 }); }
          if (d < 50) race.fx.pop('ZA-BOOM!', { world: new THREE.Vector3(st.tx, st.ty + 5, st.tz), color: '#ff5ccf' });
        }
      }
    }
    if (st.phase === 'fire') {
      beam.visible = st.t < 0.38;
      mouth.set(2.2, -5.6, 0).multiplyScalar(root.scale.x).applyEuler(root.rotation).add(st.pos);
      dir.set(st.tx - mouth.x, st.ty - mouth.y, st.tz - mouth.z);
      const len = dir.length();
      beam.position.set((mouth.x + st.tx) / 2, (mouth.y + st.ty) / 2, (mouth.z + st.tz) / 2);
      beam.quaternion.setFromUnitVectors(up, dir.normalize());
      const w = 1 - st.t / 0.38;
      beam.scale.set(0.4 + w, len, 0.4 + w);
      if (st.t > 0.6) { st.phase = 'idle'; st.t = 0; st.next = period * rage * (0.8 + Math.random() * 0.4); mover.active = false; beam.visible = false; }
    }
  });
}

// ------------------------------------------------------------------ searchlights
/** Sweeping searchlight beams (additive cones) from the roof tops. */
export function searchlights(track, spots, o = {}) {
  const beam = new Geo();
  const C = o.color || [0.3, 0.34, 0.5], K = [0, 0, 0];
  const len = o.len ?? 150, r = o.r ?? 7;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2, b = ((k + 1) / 6) * Math.PI * 2;
    beam.triCol([0, 0, 0], [Math.cos(a) * r, len, Math.sin(a) * r], [Math.cos(b) * r, len, Math.sin(b) * r], C, K, K);
  }
  const geo = beam.build({ color: true, emit: false, uv: false });
  const list = spots.map(([x, y, z], k) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.rotation.order = 'YXZ';
    const m = new THREE.Mesh(geo, track.materials.glow);
    m.renderOrder = 6;
    m.frustumCulled = false;
    pivot.add(m);
    track.group.add(pivot);
    return { pivot, ph: k * 2.1 };
  });
  track.updaters.push((dt, t) => {
    for (const l of list) { l.pivot.rotation.y = t * 0.35 + l.ph; l.pivot.rotation.x = (o.tilt ?? 0.42) + Math.sin(t * 0.5 + l.ph) * 0.18; }
  });
}

export { frame };
