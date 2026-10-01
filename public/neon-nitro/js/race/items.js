// Item boxes, the position-weighted roulette and every power-up's behaviour.
import * as THREE from 'three';
import { Geo } from '../geo/builder.js';
import { toonMaterial } from '../render/toon.js';
import { FONT_COMIC } from '../cars/livery.js';
import { SHAPE } from './fx.js';

export const ITEMS = {
  nitro: { name: 'Nitro', desc: 'Instant turbo boost.' },
  nitro3: { name: 'Triple Nitro', desc: 'Three boosts. Use them wisely.' },
  oil: { name: 'Oil Slick', desc: 'Drop behind. Spins out whoever hits it.' },
  shuriken: { name: 'Shuriken', desc: 'Fires straight ahead, ricochets off walls. Hold back to throw behind.' },
  missile: { name: 'Homing Missile', desc: 'Locks onto the racer ahead.' },
  daruma: { name: 'Daruma Bomb', desc: 'Lob it forward. Big boom. Hold back to drop it.' },
  shield: { name: 'Barrier', desc: 'Blocks the next hit for 10 seconds.' },
  emp: { name: 'EMP Blast', desc: 'Shockwave spins out everyone close by.' },
  ryu: { name: 'Ryu Rush', desc: 'Become a neon dragon. Autopilot, invincible, unstoppable.' },
  glitch: { name: 'Glitch Storm', desc: 'Hacks every racer ahead of you.' },
};
export const ITEM_IDS = Object.keys(ITEMS);
const EMP_RADIUS = 24;

// weights per rank bucket: 1st, 2-3, 4-5, 6-7, last
const TABLE = {
  nitro: [14, 16, 15, 10, 6], nitro3: [0, 4, 14, 22, 22], oil: [34, 16, 6, 0, 0], shuriken: [30, 22, 12, 6, 0],
  missile: [0, 18, 22, 20, 14], daruma: [10, 10, 10, 6, 2], shield: [12, 10, 9, 6, 4], emp: [0, 4, 9, 12, 10],
  ryu: [0, 0, 1, 10, 24], glitch: [0, 0, 1, 5, 12],
};

export function rollItem(rank, n, rng = Math.random, excludeRare = false) {
  const t = n <= 1 ? 0 : (rank - 1) / (n - 1);
  const b = rank === 1 ? 0 : t < 0.35 ? 1 : t < 0.6 ? 2 : t < 0.9 ? 3 : 4;
  let total = 0;
  const w = ITEM_IDS.map((id) => { const v = excludeRare && (id === 'glitch' || id === 'ryu') ? 0 : TABLE[id][b]; total += v; return v; });
  let r = rng() * total;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return ITEM_IDS[i]; }
  return 'nitro';
}

// ------------------------------------------------------------ textures & models
function qTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 128, 128); g.addColorStop(0, '#ff5ccf'); g.addColorStop(0.5, '#8a3dff'); g.addColorStop(1, '#20d8ff');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  for (let yy = 0; yy < 128; yy += 8) for (let xx = (yy / 8) % 2 * 4; xx < 128; xx += 8) { x.fillStyle = 'rgba(255,255,255,0.18)'; x.beginPath(); x.arc(xx, yy, 1.6, 0, 7); x.fill(); }
  x.lineWidth = 10; x.strokeStyle = '#140818'; x.strokeRect(5, 5, 118, 118);
  x.font = `96px ${FONT_COMIC}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 12; x.lineJoin = 'round'; x.strokeStyle = '#140818'; x.strokeText('?', 64, 70);
  x.fillStyle = '#ffe23b'; x.fillText('?', 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}
function oilTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#0a0810';
  x.beginPath();
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2, r = 46 + Math.sin(i * 2.7) * 12; x.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
  x.closePath(); x.fill();
  const g = x.createRadialGradient(50, 50, 4, 60, 60, 40); g.addColorStop(0, 'rgba(255,90,220,0.8)'); g.addColorStop(0.4, 'rgba(60,220,255,0.5)'); g.addColorStop(0.7, 'rgba(255,230,60,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.beginPath(); x.arc(56, 54, 30, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}

function shurikenGeo() {
  const g = new Geo();
  g.set([0.8, 0.82, 0.9], 0, 0);
  const pts = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, r = i % 2 ? 0.35 : 1.3; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  g.at([0, 0, 0], [Math.PI / 2, 0, 0], 1, (gg) => gg.extrude(pts, 0.12));
  g.set([1, 0.15, 0.3], 0, 0.6);
  g.cyl([0, -0.1, 0], [0, 0.1, 0], 0.3, 0.3, 10, true);
  return g.build({ color: true, emit: true });
}
function missileGeo() {
  const g = new Geo();
  g.set([0.95, 0.2, 0.25], 0, 0);
  g.cyl([-0.9, 0, 0], [0.5, 0, 0], 0.26, 0.26, 10, true);
  g.set([1, 1, 1], 0, 0);
  g.cyl([0.5, 0, 0], [1.1, 0, 0], 0.26, 0.02, 10, false);
  g.set([0.15, 0.12, 0.2], 0, 0);
  for (let i = 0; i < 4; i++) g.at([-0.75, 0, 0], [(i * Math.PI) / 2, 0, 0], 1, (gg) => gg.box(0, 0.35, 0, 0.35, 0.4, 0.04));
  g.set([1, 0.9, 0.3], 0, 1);
  g.cyl([-1.0, 0, 0], [-0.88, 0, 0], 0.18, 0.2, 8, true);
  // eyes (comic)
  g.set([1, 1, 1], 0, 0.3); g.sphere(0.62, 0.12, 0.14, 0.09, 0.09, 0.05, 6, 4); g.sphere(0.62, 0.12, -0.14, 0.09, 0.09, 0.05, 6, 4);
  return g.build({ color: true, emit: true });
}
function darumaGeo() {
  const g = new Geo();
  g.set([0.92, 0.12, 0.15], 0, 0);
  g.sphere(0, 0.85, 0, 0.9, 0.95, 0.9, 12, 8);
  g.set([1, 0.95, 0.88], 0, 0.1);
  g.at([0.62, 1.0, 0], [0, 0, -0.2], 1, (gg) => gg.sphere(0, 0, 0, 0.18, 0.45, 0.5, 10, 6));
  g.set([0.08, 0.06, 0.1], 0, 0);
  g.sphere(0.78, 1.08, 0.2, 0.05, 0.08, 0.08, 6, 4); g.sphere(0.78, 1.08, -0.2, 0.05, 0.08, 0.08, 6, 4);
  g.set([1, 0.85, 0.2], 0, 0.3);
  g.cyl([0, 1.75, 0], [0, 2.2, 0], 0.03, 0.03, 4, false);
  g.set([1, 0.6, 0.1], 0, 1); g.sphere(0, 2.25, 0, 0.12, 0.12, 0.12, 6, 4);
  return g.build({ color: true, emit: true });
}
function dragonGeo() {
  // head: long snout, horns, whiskers
  const g = new Geo();
  g.set([0.2, 0.95, 0.75], 0, 0.55);
  g.at([0, 0, 0], [0, 0, 0], 1, (gg) => { gg.box(0.6, 0, 0, 2.2, 1.0, 1.2, [0.7, 0.8]); gg.box(1.9, -0.15, 0, 1.1, 0.6, 0.9, [0.7, 0.8]); });
  g.set([1, 0.85, 0.2], 0, 0.8);
  for (const z of [-0.4, 0.4]) { g.cyl([0.2, 0.45, z], [-0.9, 1.4, z * 1.8], 0.12, 0.03, 5, false); }
  g.set([1, 0.2, 0.4], 0, 1);
  for (const z of [-0.45, 0.45]) g.sphere(1.3, 0.3, z, 0.16, 0.16, 0.12, 6, 4);
  g.set([1, 0.95, 0.9], 0, 0.3);
  for (const z of [-0.5, 0.5]) g.cyl([2.3, -0.2, z * 0.7], [1.2, -0.5, z * 3.2], 0.04, 0.02, 4, false);
  g.set([1, 1, 1], 0, 0.3);
  for (let i = 0; i < 4; i++) g.at([2.35, -0.42, -0.3 + i * 0.2], [0, 0, 0], 1, (gg) => gg.cyl([0, 0, 0], [0, -0.2, 0], 0.05, 0.01, 4, true));
  return g.build({ color: true, emit: true });
}
function segGeo() {
  const g = new Geo();
  g.set([0.2, 0.95, 0.75], 0, 0.5);
  g.sphere(0, 0, 0, 0.9, 0.75, 0.75, 8, 6);
  g.set([1, 0.85, 0.2], 0, 0.8);
  g.at([0, 0.7, 0], [0, 0, 0], 1, (gg) => gg.extrude([[0.4, 0], [-0.4, 0], [-0.1, 0.5]], 0.1));
  return g.build({ color: true, emit: true });
}

// ------------------------------------------------------------ system
export class Items {
  constructor(race) {
    this.race = race;
    this.scene = race.scene;
    this.track = race.track;
    this.fx = race.fx;
    this.objs = [];
    this.mat = toonMaterial({ vertexColors: true, emitAttr: true, rim: 0.5, spec: 0.5 });
    this.geos = { shuriken: shurikenGeo(), missile: missileGeo(), daruma: darumaGeo(), dragon: dragonGeo(), seg: segGeo() };
    this.oilTex = oilTexture();
    this.oilMat = new THREE.MeshBasicMaterial({ map: this.oilTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.oilGeo = new THREE.CircleGeometry(2.3, 16).rotateX(-Math.PI / 2);
    this.shieldMat = new THREE.MeshBasicMaterial({ color: 0x40e8ff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: false });
    this.shieldGeo = new THREE.IcosahedronGeometry(2.9, 1);
    this.shieldEdge = new THREE.LineBasicMaterial({ color: 0x9ff6ff, transparent: true, opacity: 0.8 });
    this.shieldEdges = new THREE.EdgesGeometry(this.shieldGeo);
    this.buildBoxes();
  }

  // ---------------------------------------------------------- boxes
  buildBoxes() {
    const rows = this.track.def.itemRows || [0.2, 0.5, 0.8];
    const path = this.track.path;
    const list = [];
    for (const row of rows) {
      const u = typeof row === 'number' ? row : row.u;
      const n = typeof row === 'number' ? 5 : row.n ?? 5;
      const s = u * path.length;
      const i = path.indexAt(s);
      const hw = path.w[i] / 2 - 2.2;
      const off = typeof row === 'number' ? 0 : row.lat ?? 0;
      const spread = typeof row === 'number' ? hw : Math.min(hw, row.spread ?? hw);
      for (let k = 0; k < n; k++) {
        const lat = off + (n === 1 ? 0 : -spread + (2 * spread * k) / (n - 1));
        const p = path.point(s, lat);
        list.push({ x: p.px, y: p.py + 1.3, z: p.pz, t: 0, active: true, phase: Math.random() * 6 });
      }
    }
    this.boxes = list;
    const geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    const mat = toonMaterial({ map: qTexture(), unlit: true });
    this.boxMesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    this.boxMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, list.length) * 3).fill(1), 3);
    this.boxMesh.frustumCulled = false;
    this.scene.add(this.boxMesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this._c = new THREE.Color();
  }

  updateBoxes(dt, t) {
    const m = this._m;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (!b.active) { b.t -= dt; if (b.t <= 0) { b.active = true; b.pop = 0.35; } }
      let sc = b.active ? 1 : 0;
      if (b.pop > 0) { b.pop -= dt; sc = 1 - b.pop / 0.35 * 0.8 + Math.sin((1 - b.pop / 0.35) * Math.PI) * 0.3; }
      this._q.setFromEuler(new THREE.Euler(0.5, t * 1.6 + b.phase, 0.3));
      this._p.set(b.x, b.y + Math.sin(t * 2.2 + b.phase) * 0.25, b.z);
      this._s.setScalar(Math.max(0.001, sc));
      m.compose(this._p, this._q, this._s);
      this.boxMesh.setMatrixAt(i, m);
      this._c.setHSL((t * 0.15 + i * 0.07) % 1, 0.5, 0.75);
      this.boxMesh.setColorAt(i, this._c);
    }
    this.boxMesh.instanceMatrix.needsUpdate = true;
    if (this.boxMesh.instanceColor) this.boxMesh.instanceColor.needsUpdate = true;
  }

  checkBoxes(v) {
    for (const b of this.boxes) {
      if (!b.active) continue;
      const dx = v.pos.x - b.x, dz = v.pos.z - b.z, dy = v.pos.y + 0.8 - b.y;
      if (dx * dx + dz * dz < 5.5 && Math.abs(dy) < 3) {
        b.active = false; b.t = 2.4;
        this.fx.burst(b.x, b.y, b.z, 14, { color: [1, 0.9, 0.3], shape: SHAPE.STAR, size: 0.9, life: 0.5, speed: 9, grav: 6 });
        this.fx.burst(b.x, b.y, b.z, 8, { color: [0.6, 0.4, 1], shape: SHAPE.SQUARE, size: 0.7, life: 0.8, speed: 7, grav: 14, spin: 6 });
        if (!v.item && v.rolling <= 0) {
          v.rolling = v.isPlayer ? 1.25 : 0.6 + Math.random() * 0.6;
          v.pendingItem = rollItem(v.place || 1, this.race.cars.length, Math.random, this.race.itemsNoRare);
          this.race.onEvent(v, { type: 'itembox' });
        }
      }
    }
  }

  tickRoulette(v, dt) {
    if (v.rolling > 0) {
      v.rolling -= dt;
      if (v.rolling <= 0) {
        v.item = v.pendingItem; v.itemCount = v.item === 'nitro3' ? 3 : 1;
        this.race.onEvent(v, { type: 'itemGot', item: v.item });
      }
    }
  }

  // ---------------------------------------------------------- use
  use(v, back = false) {
    const id = v.item;
    if (!id || v.rolling > 0) return;
    const fwd = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
    const race = this.race;
    switch (id) {
      case 'nitro': case 'nitro3':
        v.boost(1.45, 1.42, 'nitro');
        break;
      case 'oil': this.spawnOil(v, fwd, back); break;
      case 'shuriken': this.spawnShuriken(v, fwd, back); break;
      case 'missile': this.spawnMissile(v, fwd); break;
      case 'daruma': this.spawnDaruma(v, fwd, back); break;
      case 'shield': v.shieldT = 10; this.attachShield(v); break;
      case 'emp': this.emp(v); break;
      case 'ryu': this.ryu(v); break;
      case 'glitch': this.glitch(v); break;
      default: break;
    }
    race.onEvent(v, { type: 'itemUsed', item: id, back });
    v.itemCount--;
    if (v.itemCount <= 0) { v.item = null; v.itemCount = 0; }
  }

  _addObj(o) { this.objs.push(o); if (o.mesh) this.scene.add(o.mesh); return o; }

  spawnOil(v, fwd, forward) {
    const dir = forward ? 1 : -1;
    const mesh = new THREE.Mesh(this.oilGeo, this.oilMat);
    const o = { kind: 'oil', owner: v, mesh, t: 0, life: 40, r: 2.2, grace: 0.8 };
    const p = v.pos.clone().addScaledVector(fwd, dir * (forward ? 12 : 4));
    if (forward) { o.fly = { vx: fwd.x * 22 + v.vel.x * 0.5, vz: fwd.z * 22 + v.vel.z * 0.5, vy: 8, y: v.pos.y + 1 }; }
    this._place(o, p);
    this._addObj(o);
  }

  spawnShuriken(v, fwd, back) {
    const dir = back ? -1 : 1;
    const mesh = new THREE.Mesh(this.geos.shuriken, this.mat);
    const sp = back ? 30 : 72 + Math.max(0, v.speed);
    const o = { kind: 'shuriken', owner: v, mesh, t: 0, life: 7, r: 1.5, grace: 0.25, vx: fwd.x * sp * dir, vz: fwd.z * sp * dir, bounces: 0, hint: v.hint };
    const p = v.pos.clone().addScaledVector(fwd, dir * 3.2);
    this._place(o, p);
    this._addObj(o);
  }

  spawnMissile(v, fwd) {
    const mesh = new THREE.Mesh(this.geos.missile, this.mat);
    const target = this.race.carAhead(v);
    const o = { kind: 'missile', owner: v, mesh, t: 0, life: 9, r: 1.6, grace: 0.3, target, speed: Math.max(62, v.speed + 22), s: v.s, lat: v.lat ?? 0, hint: v.hint, yaw: v.yaw };
    const p = v.pos.clone().addScaledVector(fwd, 3.5);
    this._place(o, p);
    o.y = p.y + 1.1;
    this._addObj(o);
  }

  spawnDaruma(v, fwd, back) {
    const mesh = new THREE.Mesh(this.geos.daruma, this.mat);
    mesh.scale.setScalar(0.9);
    const o = { kind: 'daruma', owner: v, mesh, t: 0, life: 6, fuse: back ? 2.6 : 3.2, r: 2, grace: 0.6, hint: v.hint };
    const p = v.pos.clone().addScaledVector(fwd, back ? -4 : 3);
    o.fly = back ? { vx: -fwd.x * 4, vz: -fwd.z * 4, vy: 4, y: v.pos.y + 1.5 } : { vx: fwd.x * (v.speed + 20), vz: fwd.z * (v.speed + 20), vy: 13, y: v.pos.y + 1.6 };
    this._place(o, p);
    this._addObj(o);
  }

  attachShield(v) {
    if (v.shieldMesh) return;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.shieldGeo, this.shieldMat));
    g.add(new THREE.LineSegments(this.shieldEdges, this.shieldEdge));
    g.position.y = 0.9;
    g.scale.set(1.25, 0.72, 0.95);
    v.model.root.add(g);
    v.shieldMesh = g;
  }

  emp(v) {
    this.fx.ring(v.pos.x, v.pos.y + 0.5, v.pos.z, EMP_RADIUS, [0.3, 0.9, 1]);
    this.fx.ring(v.pos.x, v.pos.y + 1.5, v.pos.z, EMP_RADIUS * 0.72, [1, 0.3, 0.8]);
    this.fx.burst(v.pos.x, v.pos.y + 1, v.pos.z, 30, { color: [0.4, 0.9, 1], shape: SHAPE.STAR, size: 1.2, life: 0.6, speed: 24, grav: 0 });
    for (const c of this.race.cars) {
      if (c === v) continue;
      if (c.pos.distanceTo(v.pos) < EMP_RADIUS) this.race.hitCar(c, 'spin', v, 'ZZAP!');
    }
  }

  ryu(v) {
    v.ryuT = 5;
    v.drift.on = false;
    const grp = new THREE.Group();
    const head = new THREE.Mesh(this.geos.dragon, this.mat);
    head.scale.setScalar(1.3);
    grp.add(head);
    const segs = [];
    for (let i = 0; i < 9; i++) { const m = new THREE.Mesh(this.geos.seg, this.mat); m.scale.setScalar(1.25 - i * 0.07); this.scene.add(m); segs.push(m); }
    this.scene.add(grp);
    v.ryu = { grp, head, segs, trail: [] };
  }

  glitch(v) {
    this.race.glitchFlash = 1;
    for (const c of this.race.cars) {
      if (c === v || c.place > v.place) continue;
      if (c.place < v.place) {
        // comic lightning bolt from the sky
        this.fx.burst(c.pos.x, c.pos.y + 2, c.pos.z, 16, { color: [0.4, 1, 0.6], shape: SHAPE.SQUARE, size: 0.9, life: 0.7, speed: 8, grav: 8 });
        if (this.race.hitCar(c, 'hack', v, 'HACKED!', true)) c.glitchT = 2.2;
      }
    }
  }

  _place(o, p) {
    const S = this.track.surface(p.x, p.z, o.hint ?? -1, {}, p.y);
    o.hint = S.i;
    o.x = p.x; o.z = p.z; o.y = S.y;
    o.mesh.position.set(p.x, S.y + 0.05, p.z);
  }

  // ---------------------------------------------------------- simulate
  update(dt, t) {
    this.updateBoxes(dt, t);
    const cars = this.race.cars;
    const tr = this.track;
    for (let i = this.objs.length - 1; i >= 0; i--) {
      const o = this.objs[i];
      o.t += dt;
      let dead = o.t > o.life;
      if (o.fly) {
        const f = o.fly;
        f.vy -= 30 * dt; f.y += f.vy * dt;
        o.x += f.vx * dt; o.z += f.vz * dt;
        const S = tr.surface(o.x, o.z, o.hint ?? -1, {}, f.y);
        o.hint = S.i;
        // keep inside the track
        const lim = S.lat > 0 ? S.limR - 1 : S.limL - 1;
        if (Math.abs(S.lat) > lim) { const k = (Math.abs(S.lat) - lim) * Math.sign(S.lat); o.x -= S.rx * k; o.z -= S.rz * k; f.vx *= 0.5; f.vz *= 0.5; }
        if (f.y <= S.y) { f.y = S.y; if (Math.abs(f.vy) > 4 && o.kind === 'daruma') { f.vy = -f.vy * 0.35; f.vx *= 0.6; f.vz *= 0.6; } else { o.y = S.y; delete o.fly; } }
        o.mesh.position.set(o.x, f.y + 0.05, o.z);
        if (o.kind === 'daruma') o.mesh.rotation.z += dt * 8;
      }
      switch (o.kind) {
        case 'shuriken': dead = this._tickShuriken(o, dt) || dead; break;
        case 'missile': dead = this._tickMissile(o, dt) || dead; break;
        case 'daruma': {
          o.fuse -= dt;
          const flash = o.fuse < 1 ? (Math.sin(o.t * 30) > 0 ? 1.15 : 0.9) : 1;
          o.mesh.scale.setScalar(0.9 * flash);
          if (!o.fly) {
            for (const c of cars) if (c !== o.owner || o.t > o.grace + 1) { if (c.pos.distanceToSquared(o.mesh.position) < 16) o.fuse = Math.min(o.fuse, 0); }
          }
          if (o.fuse <= 0) { this._explode(o, 11); dead = true; }
          break;
        }
        case 'oil': {
          if (!o.fly) {
            for (const c of cars) {
              if (c === o.owner && o.t < o.grace) continue;
              const dx = c.pos.x - o.x, dz = c.pos.z - o.z;
              if (dx * dx + dz * dz < (o.r + 0.8) ** 2 && c.grounded) {
                if (this.race.hitCar(c, 'spin', o.owner, 'SPLOOSH!')) { dead = true; break; }
              }
            }
          }
          break;
        }
        default: break;
      }
      // hits vs cars for projectiles
      if (!dead && (o.kind === 'shuriken' || o.kind === 'missile')) {
        for (const c of cars) {
          if (c === o.owner && o.t < o.grace + 0.4) continue;
          const d2 = (c.pos.x - o.x) ** 2 + (c.pos.z - o.z) ** 2;
          if (d2 < (o.r + 1.3) ** 2 && Math.abs(c.pos.y + 0.5 - o.y) < 3) {
            if (o.kind === 'missile') { this._explode(o, 5, c); }
            else { this.race.hitCar(c, 'spin', o.owner, 'SHING!'); this.fx.burst(o.x, o.y + 0.5, o.z, 12, { color: [1, 1, 0.8], shape: SHAPE.STAR, size: 1, life: 0.4, speed: 10 }); }
            dead = true; break;
          }
        }
        // projectiles vs other items (shuriken knocks oil/daruma)
        if (!dead) {
          for (const p of this.objs) {
            if (p === o || p.dead || (p.kind !== 'oil' && p.kind !== 'daruma' && p.kind !== 'shuriken')) continue;
            if ((p.x - o.x) ** 2 + (p.z - o.z) ** 2 < 6) { p.dead = true; dead = true; this.fx.burst(o.x, o.y + 0.5, o.z, 10, { color: [1, 0.8, 0.3], shape: SHAPE.STAR, size: 1, life: 0.4, speed: 8 }); break; }
          }
        }
      }
      if (o.dead) dead = true;
      if (dead) { this.scene.remove(o.mesh); this.objs.splice(i, 1); }
    }
    // shields & dragons
    for (const c of cars) {
      if (c.shieldMesh) {
        if (c.shieldT <= 0) { c.model.root.remove(c.shieldMesh); c.shieldMesh = null; this.fx.burst(c.pos.x, c.pos.y + 1, c.pos.z, 16, { color: [0.4, 0.9, 1], shape: SHAPE.SQUARE, size: 0.7, life: 0.6, speed: 9, grav: 10 }); }
        else { c.shieldMesh.rotation.y += dt * 1.5; c.shieldMesh.children[0].material.opacity = 0.2 + 0.1 * Math.sin(t * 8); }
      }
      if (c.ryu) this._tickRyu(c, dt, t);
    }
  }

  _tickShuriken(o, dt) {
    const tr = this.track;
    o.x += o.vx * dt; o.z += o.vz * dt;
    const S = tr.surface(o.x, o.z, o.hint, {}, o.y);
    o.hint = S.i;
    o.y = S.y + 0.9;
    const lim = (S.lat > 0 ? S.limR : S.limL) - 1.2;
    if (Math.abs(S.lat) > lim) {
      const nx = -Math.sign(S.lat) * S.rx, nz = -Math.sign(S.lat) * S.rz;
      const vn = o.vx * nx + o.vz * nz;
      if (vn < 0) { o.vx -= 2 * vn * nx; o.vz -= 2 * vn * nz; o.bounces++; this.fx.burst(o.x, o.y, o.z, 6, { color: [1, 0.9, 0.5], shape: SHAPE.STAR, size: 0.8, life: 0.3, speed: 8 }); }
      const k = (Math.abs(S.lat) - lim) * Math.sign(S.lat);
      o.x -= S.rx * k; o.z -= S.rz * k;
    }
    for (const c of tr.nearby(o.x, o.z)) {
      if (c.type === 'circle' && (o.x - c.x) ** 2 + (o.z - c.z) ** 2 < (c.r + 0.8) ** 2) { o.vx = -o.vx; o.vz = -o.vz; o.bounces++; }
    }
    o.mesh.position.set(o.x, o.y, o.z);
    o.mesh.rotation.y += dt * 22;
    if (Math.random() < 0.6) this.fx.spawn({ x: o.x, y: o.y, z: o.z, life: 0.25, size: 0.8, color: [0.8, 0.9, 1], alpha: 0.6, shape: SHAPE.DOT });
    return o.bounces > 5;
  }

  _tickMissile(o, dt) {
    const tr = this.track;
    const path = tr.path;
    const tg = o.target && !o.target.finished ? o.target : null;
    let aimX, aimZ;
    const distT = tg ? Math.hypot(tg.pos.x - o.x, tg.pos.z - o.z) : 1e9;
    if (tg && distT < 34) { aimX = tg.pos.x; aimZ = tg.pos.z; }
    else {
      const S = tr.surface(o.x, o.z, o.hint, {}, o.y);
      o.hint = S.i;
      const latT = tg && distT < 80 ? (tg.lat ?? 0) : S.lat * 0.9;
      const p = path.point(S.s + 16, latT);
      aimX = p.px; aimZ = p.pz;
    }
    const want = Math.atan2(-(aimZ - o.z), aimX - o.x);
    let d = want - o.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    o.yaw += Math.max(-4 * dt, Math.min(4 * dt, d)) * (distT < 34 ? 2 : 1);
    o.speed = Math.min(o.speed + 20 * dt, 86);
    o.x += Math.cos(o.yaw) * o.speed * dt;
    o.z += -Math.sin(o.yaw) * o.speed * dt;
    const S = tr.surface(o.x, o.z, o.hint, {}, o.y);
    o.hint = S.i;
    o.y += (S.y + 1.2 - o.y) * Math.min(1, dt * 8);
    o.mesh.position.set(o.x, o.y, o.z);
    o.mesh.rotation.set(0, o.yaw, Math.sin(o.t * 10) * 0.1);
    // flame trail
    this.fx.spawn({ x: o.x - Math.cos(o.yaw) * 1.1, y: o.y, z: o.z + Math.sin(o.yaw) * 1.1, life: 0.3, size: 1.1, grow: 0.8, color: [1, 0.6, 0.15], shape: SHAPE.FLAME, drag: 4 });
    if (Math.random() < 0.5) this.fx.spawn({ x: o.x - Math.cos(o.yaw) * 1.4, y: o.y, z: o.z + Math.sin(o.yaw) * 1.4, life: 0.8, size: 1.3, grow: 1.5, color: [0.85, 0.82, 0.9], shape: SHAPE.PUFF, drag: 3 });
    const lim = (S.lat > 0 ? S.limR : S.limL) - 1;
    if (Math.abs(S.lat) > lim) { const k = (Math.abs(S.lat) - lim) * Math.sign(S.lat); o.x -= S.rx * k; o.z -= S.rz * k; }
    return false;
  }

  _explode(o, radius, direct = null) {
    const p = o.mesh.position;
    this.fx.explosion(p.x, p.y, p.z, radius > 8 ? 1.4 : 1);
    this.race.onEvent(o.owner, { type: 'explosion', x: p.x, y: p.y, z: p.z });
    for (const c of this.race.cars) {
      const d = c.pos.distanceTo(p);
      if (c === direct || d < radius) this.race.hitCar(c, 'tumble', o.owner, radius > 8 ? 'KABOOM!' : 'BLAM!');
    }
  }

  _tickRyu(c, dt, t) {
    const r = c.ryu;
    c.ryuT -= dt;
    const fwd = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    r.grp.position.set(c.pos.x + fwd.x * 2.4, c.pos.y + 1.4 + Math.sin(t * 6) * 0.2, c.pos.z + fwd.z * 2.4);
    r.grp.rotation.set(0, c.yaw, Math.sin(t * 8) * 0.08);
    r.trail.unshift([c.pos.x, c.pos.y + 1.2, c.pos.z]);
    if (r.trail.length > 60) r.trail.pop();
    r.segs.forEach((m, i) => {
      const k = Math.min(r.trail.length - 1, (i + 1) * 4);
      const p = r.trail[k];
      m.position.set(p[0], p[1] + Math.sin(t * 7 + i * 0.8) * 0.9, p[2]);
      const q = r.trail[Math.max(0, k - 2)];
      m.rotation.y = Math.atan2(-(q[2] - p[2]), q[0] - p[0]);
    });
    if (Math.random() < 0.8) this.fx.spawn({ x: c.pos.x + (Math.random() - 0.5) * 3, y: c.pos.y + 1.5, z: c.pos.z + (Math.random() - 0.5) * 3, life: 0.5, size: 1.2, grow: 1, color: [0.3, 1, 0.8], shape: SHAPE.STAR, drag: 2, spin: 4 });
    // knock racers aside
    for (const o of this.race.cars) {
      if (o === c) continue;
      if (o.pos.distanceToSquared(c.pos) < 16) this.race.hitCar(o, 'tumble', c, 'GRAAH!');
    }
    if (c.ryuT <= 0) {
      this.scene.remove(r.grp);
      r.segs.forEach((m) => this.scene.remove(m));
      c.ryu = null; c.ryuT = 0;
      c.invulnT = 1;
      this.fx.burst(c.pos.x, c.pos.y + 1.5, c.pos.z, 24, { color: [0.3, 1, 0.8], shape: SHAPE.PUFF, size: 1.6, grow: 1.5, life: 0.7, speed: 8 });
    }
  }

  dispose() {
    for (const o of this.objs) this.scene.remove(o.mesh);
    this.objs.length = 0;
    this.scene.remove(this.boxMesh);
    this.boxMesh.geometry.dispose();
    for (const g of Object.values(this.geos)) g.dispose();
    this.oilTex.dispose();
  }
}
