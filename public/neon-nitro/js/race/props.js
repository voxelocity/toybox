// Destructible props: instanced per type, sent flying (and spinning) when a
// car ploughs through them, then reset to their spot after a while.
import * as THREE from 'three';
import { Geo } from '../geo/builder.js';
import { toonMaterial } from '../render/toon.js';
import { SHAPE } from './fx.js';

const T = {};
function model(fn) { const g = new Geo(); fn(g); return g.build({ color: true, emit: true }); }

export const PROP_TYPES = {
  cone: { r: 0.45, mass: 0.2, h: 0.8, words: ['BOINK!', 'THWAP!'], geo: () => model((g) => {
    g.set([1, 0.45, 0.1], 0, 0.1); g.box(0, 0.04, 0, 0.7, 0.08, 0.7);
    g.cyl([0, 0.08, 0], [0, 0.85, 0], 0.3, 0.05, 10, true);
    g.set([1, 1, 1], 0, 0.2); g.cyl([0, 0.4, 0], [0, 0.55, 0], 0.2, 0.16, 10, false);
  }) },
  barrel: { r: 0.6, mass: 0.45, h: 1.1, words: ['BONG!', 'KLONK!'], geo: () => model((g) => {
    for (let i = 0; i < 4; i++) { g.set(i % 2 ? [1, 1, 1] : [1, 0.25, 0.2], 0, 0.05); g.cyl([0, i * 0.27, 0], [0, (i + 1) * 0.27, 0], 0.5, 0.5, 10, i === 3); }
  }) },
  vending: { r: 0.9, mass: 1.2, h: 1.9, words: ['CRASH!', 'KER-SMASH!'], geo: () => model((g) => {
    g.set([0.9, 0.2, 0.35], 0, 0); g.box(0, 0.95, 0, 0.8, 1.9, 1.0);
    g.set([0.8, 0.95, 1], 0, 0.9); g.box(0.41, 1.2, 0, 0.02, 0.9, 0.8);
    g.set([1, 0.9, 0.3], 0, 0.8); for (let i = 0; i < 3; i++) g.box(0.42, 0.95 + i * 0.25, 0, 0.02, 0.04, 0.7);
    g.set([0.1, 0.1, 0.12], 0, 0); g.box(0.41, 0.35, 0, 0.03, 0.2, 0.6);
  }) },
  trash: { r: 0.45, mass: 0.25, h: 0.9, words: ['CLATTER!', 'BONK!'], geo: () => model((g) => {
    g.set([0.2, 0.5, 0.95], 0, 0); g.cyl([0, 0, 0], [0, 0.85, 0], 0.32, 0.36, 10, true);
    g.set([0.12, 0.3, 0.6], 0, 0); g.cyl([0, 0.85, 0], [0, 0.95, 0], 0.38, 0.38, 10, true);
  }) },
  crate: { r: 0.65, mass: 0.5, h: 1.0, words: ['CRUNCH!', 'SPLINTER!'], geo: () => model((g) => {
    g.set([0.75, 0.52, 0.3], 0, 0); g.box(0, 0.5, 0, 1, 1, 1);
    g.set([0.5, 0.33, 0.18], 0, 0); g.box(0, 0.5, 0, 1.02, 0.14, 1.02); g.box(0, 0.5, 0, 0.14, 1.02, 1.02);
  }) },
  sign: { r: 0.5, mass: 0.2, h: 1.0, words: ['FWAP!'], geo: () => model((g) => {
    g.set([1, 0.9, 0.2], 0, 0.3); g.at([0, 0.5, 0], [0, 0, 0.2], 1, (gg) => gg.box(0.1, 0, 0, 0.05, 1, 0.7));
    g.at([0, 0.5, 0], [0, 0, -0.2], 1, (gg) => gg.box(-0.1, 0, 0, 0.05, 1, 0.7));
    g.set([0.1, 0.08, 0.12], 0, 0); g.box(0.14, 0.6, 0, 0.02, 0.3, 0.5);
  }) },
  hay: { r: 0.8, mass: 0.5, h: 1.0, words: ['FWUMP!', 'POOF!'], geo: () => model((g) => {
    g.set([0.95, 0.82, 0.35], 0, 0); g.at([0, 0.6, 0], [Math.PI / 2, 0, 0], 1, (gg) => gg.cyl([0, -0.6, 0], [0, 0.6, 0], 0.6, 0.6, 12, true));
    g.set([0.7, 0.5, 0.2], 0, 0); g.at([0, 0.6, 0], [Math.PI / 2, 0, 0], 1, (gg) => gg.cyl([0, -0.2, 0], [0, -0.1, 0], 0.62, 0.62, 12, false));
  }) },
  tanuki: { r: 0.6, mass: 0.4, h: 1.2, words: ['PON!', 'BONK!'], geo: () => model((g) => {
    g.set([0.55, 0.4, 0.3], 0, 0); g.sphere(0, 0.45, 0, 0.45, 0.45, 0.45, 10, 6);
    g.set([0.9, 0.85, 0.75], 0, 0); g.sphere(0.25, 0.4, 0, 0.3, 0.32, 0.36, 8, 5);
    g.set([0.55, 0.4, 0.3], 0, 0); g.sphere(0, 1.0, 0, 0.32, 0.3, 0.32, 10, 6);
    g.set([0.35, 0.25, 0.2], 0, 0); g.cyl([0, 1.25, 0], [0, 1.45, 0], 0.35, 0.3, 10, true);
    g.set([0.08, 0.06, 0.08], 0, 0); g.sphere(0.27, 1.02, 0.12, 0.08, 0.1, 0.1, 5, 3); g.sphere(0.27, 1.02, -0.12, 0.08, 0.1, 0.1, 5, 3);
    g.set([0.95, 0.9, 0.85], 0, 0.1); g.box(-0.1, 0.55, 0.42, 0.3, 0.3, 0.04);
  }) },
  barrier: { r: 0.8, mass: 0.6, h: 1.0, words: ['KA-THUNK!'], geo: () => model((g) => {
    g.set([1, 0.2, 0.25], 0, 0); g.box(0, 0.5, 0, 0.6, 1, 1.6, [0.7, 1]);
    g.set([1, 1, 1], 0, 0.1); g.box(0, 0.75, 0, 0.62, 0.18, 1.62);
  }) },
  lantern: { r: 0.5, mass: 0.15, h: 1.6, words: ['POP!'], geo: () => model((g) => {
    g.set([0.3, 0.22, 0.2], 0, 0); g.cyl([0, 0, 0], [0, 1.3, 0], 0.05, 0.05, 5, false);
    g.set([1, 0.35, 0.25], 0, 0.9); g.sphere(0, 1.4, 0, 0.3, 0.38, 0.3, 8, 5);
  }) },
  box: { r: 0.55, mass: 0.2, h: 0.7, words: ['FLUMP!'], geo: () => model((g) => {
    g.set([0.85, 0.7, 0.5], 0, 0); g.box(0, 0.35, 0, 0.8, 0.7, 0.7);
    g.set([0.95, 0.9, 0.8], 0, 0); g.box(0, 0.71, 0, 0.2, 0.02, 0.72);
  }) },
};

export class Props {
  constructor(race) {
    this.race = race;
    this.fx = race.fx;
    const spots = race.track.propSpots || [];
    this.mat = toonMaterial({ vertexColors: true, emitAttr: true, rim: 0.4 });
    this.groups = {};
    this.list = [];
    const byType = {};
    for (const s of spots) (byType[s.type] = byType[s.type] || []).push(s);
    for (const [type, arr] of Object.entries(byType)) {
      const def = PROP_TYPES[type];
      if (!def) continue;
      T[type] = T[type] || def.geo();
      const mesh = new THREE.InstancedMesh(T[type], this.mat, arr.length);
      mesh.frustumCulled = false;
      race.scene.add(mesh);
      const items = arr.map((s, i) => ({
        type, def, mesh, i, home: { x: s.x, y: s.y, z: s.z, ang: s.ang || 0 },
        pos: new THREE.Vector3(s.x, s.y, s.z), vel: new THREE.Vector3(), q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.ang || 0), av: new THREE.Vector3(),
        state: 0, t: 0, hint: -1,
      }));
      this.groups[type] = { mesh, items };
      this.list.push(...items);
      for (const it of items) this._write(it);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.grid = new Map();
    for (const it of this.list) {
      const k = this._key(it.home.x, it.home.z);
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(it);
    }
    this._m = new THREE.Matrix4(); this._s = new THREE.Vector3(1, 1, 1); this._dq = new THREE.Quaternion(); this._e = new THREE.Euler();
    this.active = new Set();
  }

  _key(x, z) { return Math.floor(x / 20) * 92821 + Math.floor(z / 20); }

  _write(it) {
    const m = this._m || new THREE.Matrix4();
    m.compose(it.pos, it.q, it.scale != null ? new THREE.Vector3(it.scale, it.scale, it.scale) : new THREE.Vector3(1, 1, 1));
    it.mesh.setMatrixAt(it.i, m);
    it.mesh.instanceMatrix.needsUpdate = true;
  }

  check(v) {
    const R = 1.5;
    const cx = v.pos.x, cz = v.pos.z;
    for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
      const arr = this.grid.get(this._key(cx + gx * 20, cz + gz * 20));
      if (!arr) continue;
      for (const it of arr) {
        if (it.state === 1 || it.state === 3) continue;
        const dx = it.pos.x - cx, dz = it.pos.z - cz;
        const rr = R + it.def.r;
        if (dx * dx + dz * dz > rr * rr || Math.abs(it.pos.y - v.pos.y) > 2.5) continue;
        this._launch(it, v);
      }
    }
  }

  _launch(it, v) {
    const sp = Math.hypot(v.vel.x, v.vel.z);
    if (sp < 3) {
      // gentle nudge
      const dx = it.pos.x - v.pos.x, dz = it.pos.z - v.pos.z, d = Math.hypot(dx, dz) || 1;
      it.pos.x += (dx / d) * 0.3; it.pos.z += (dz / d) * 0.3;
      this._write(it);
      return;
    }
    const m = it.def.mass;
    const dx = it.pos.x - v.pos.x, dz = it.pos.z - v.pos.z, d = Math.hypot(dx, dz) || 1;
    const k = 1.25 - m * 0.35;
    it.vel.set(v.vel.x * k + (dx / d) * 6, 5 + sp * 0.18 * (1.2 - m * 0.5) + Math.random() * 3, v.vel.z * k + (dz / d) * 6);
    it.av.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
    it.state = 1; it.t = 0;
    this.active.add(it);
    v.speed *= 1 - Math.min(0.2, m * 0.1);
    this.fx.burst(it.pos.x, it.pos.y + 0.6, it.pos.z, 6 + Math.floor(m * 8), { color: [1, 0.9, 0.5], shape: SHAPE.STAR, size: 0.7, life: 0.35, speed: 7 });
    this.fx.burst(it.pos.x, it.pos.y + 0.5, it.pos.z, 4 + Math.floor(m * 6), { color: [0.9, 0.85, 0.8], shape: SHAPE.SQUARE, size: 0.5, life: 0.9, speed: 8, grav: 16, spin: 8 });
    if (v.isPlayer) {
      this.race.audio?.sfx(m > 0.8 ? 'smashBig' : 'smash', { vol: 0.8 });
      if (m >= 0.4 || Math.random() < 0.3) this.fx.pop(it.def.words[Math.floor(Math.random() * it.def.words.length)], { world: it.pos.clone().setY(it.pos.y + 2), cls: m > 0.8 ? '' : 'small' });
      this.race.hud.smash();
    }
  }

  update(dt) {
    if (!this.active.size) return;
    const tr = this.race.track;
    for (const it of this.active) {
      it.t += dt;
      if (it.state === 1) {
        it.vel.y -= 28 * dt;
        it.pos.addScaledVector(it.vel, dt);
        this._e.set(it.av.x * dt, it.av.y * dt, it.av.z * dt);
        it.q.multiply(this._dq.setFromEuler(this._e));
        const S = tr.surface(it.pos.x, it.pos.z, it.hint, {}, it.pos.y);
        it.hint = S.i;
        const ground = Math.abs(S.lat) < Math.max(S.limL, S.limR) + 30 ? S.y : (tr.theme.groundY ?? 0);
        if (it.pos.y < ground) {
          it.pos.y = ground;
          if (it.vel.y < -3) { it.vel.y *= -0.35; it.vel.x *= 0.6; it.vel.z *= 0.6; it.av.multiplyScalar(0.6); }
          else { it.state = 2; it.t = 0; }
        }
        if (it.t > 6) { it.state = 2; it.t = 0; }
      } else if (it.state === 2) {
        if (it.t > 10) { it.state = 3; it.t = 0; }
      } else if (it.state === 3) {
        // pop back home
        const k = Math.min(1, it.t / 0.4);
        it.pos.set(it.home.x, it.home.y, it.home.z);
        it.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.home.ang);
        it.scale = k < 1 ? k : undefined;
        if (k >= 1) { it.state = 0; it.scale = undefined; this.active.delete(it); }
      }
      this._write(it);
    }
  }

  dispose() {
    for (const g of Object.values(this.groups)) this.race.scene.remove(g.mesh);
    this.mat.dispose();
  }
}
