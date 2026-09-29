// A built track: path + resolved edges + meshes + static colliders + surface
// queries used by physics and AI.
import * as THREE from 'three';
import { Path } from './path.js';
import { Chunks, resolveEdges, buildRoad, rgb } from './build.js';
import { toonMaterial, skyMaterial, applyTheme, G } from '../render/toon.js';
import { Geo } from '../geo/builder.js';
import { signAtlas } from '../render/signs.js';

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const OFFROAD = { gravel: 0.62, grass: 0.55, sand: 0.5, water: 0.5 };

export class Track {
  constructor(def, opts = {}) {
    this.def = def;
    this.theme = def.theme;
    this.opts = opts;
    // scenery density for the quality tier (scatter/skyline counts scale with it)
    this.detail = { low: 0.5, medium: 0.8 }[opts.quality] ?? 1;
    this.group = new THREE.Group();
    this.path = new Path(def.points, { width: def.width ?? 18, height: def.height ?? 0, maxBank: def.maxBank ?? 0.1, autoBank: def.autoBank ?? 4 });
    this.length = this.path.length;
    this.edges = resolveEdges(this.path, def);
    this.rng = mulberry(def.seed ?? 1234);
    this.colliders = [];
    this.grid = new Map();
    this.cell = 16;
    this.ramps = [];
    this.updaters = [];
    this.materials = {};
    this.lights = [];
    this.animated = [];
    const N = this.path.N;
    this.limL = new Float32Array(N); this.limR = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const hw = this.path.w[i] / 2;
      this.limL[i] = hw + this.edges.L[i].width - (this.edges.L[i].kind === 'sidewalk' ? 0.55 : 0.35);
      this.limR[i] = hw + this.edges.R[i].width - (this.edges.R[i].kind === 'sidewalk' ? 0.55 : 0.35);
    }
  }

  // ------------------------------------------------------------ build
  build(scene) {
    const def = this.def;
    applyTheme(this.theme);
    this._fog = [G.uFogNear.value, G.uFogFar.value];
    G.uHalftone.value = this.theme.halftone ?? 1;
    this.scene = scene;
    const worldMat = toonMaterial({ vertexColors: true, emitAttr: true, windows: true, rim: 0.2 });
    const atlas = signAtlas();
    const signMat = toonMaterial({ vertexColors: true, map: atlas, emitAttr: true, alphaTest: true, rim: 0, side: THREE.DoubleSide });
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.materials = { world: worldMat, sign: signMat, glow: glowMat };
    const chunks = new Chunks(this.path);
    this.chunks = chunks;
    this.chunkMeshes = [];
    buildRoad(this, chunks);
    for (const r of def.ramps || []) this.addRamp(r.u, r.lat ?? 0, r.w ?? 8, r.len ?? 10, r.h ?? 1.6, r);
    this.propSpots = [];
    // theme / track specific scenery
    if (def.scenery) def.scenery(this, chunks, this.rng);
    // meshes
    for (let c = 0; c < chunks.n; c++) {
      for (const [geo, mat, uv] of [[chunks.world[c], worldMat, true], [chunks.signs[c], signMat, true], [chunks.glow[c], glowMat, false]]) {
        if (!geo.pos.length) continue;
        const m = new THREE.Mesh(geo.build({ color: true, emit: mat !== glowMat, uv }), mat);
        m.matrixAutoUpdate = false;
        if (mat === glowMat) m.renderOrder = 5;
        m.geometry.computeBoundingSphere();
        this.chunkMeshes.push(m);
        this.group.add(m);
      }
    }
    // extra free-standing geometry (not chunked): skyline, terrain etc.
    if (this.extra) {
      for (const [geo, matKey] of this.extra) {
        const m = new THREE.Mesh(geo.build({ color: true, emit: matKey !== 'glow', uv: matKey !== 'glow' }), this.materials[matKey] || worldMat);
        m.matrixAutoUpdate = false;
        this.group.add(m);
      }
    }
    // sky
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), skyMaterial());
    const su = sky.material.uniforms;
    if (this.theme.moonDir) su.uMoonDir.value.set(...this.theme.moonDir).normalize();
    if (this.theme.moonColor) su.uMoonColor.value.set(this.theme.moonColor);
    if (this.theme.moonSize) su.uMoonSize.value = this.theme.moonSize;
    if (this.theme.stars !== undefined) su.uStars.value = this.theme.stars;
    if (this.theme.cloud) su.uCloudColor.value.set(this.theme.cloud);
    su.uSun.value = this.theme.sun ? 1 : 0;
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.sky = sky;
    this.group.add(sky);
    // ground plane
    if (this.theme.ground !== false && this.theme.groundColor) {
      const gm = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), toonMaterial({ color: this.theme.groundColor, rim: 0 }));
      gm.rotation.x = -Math.PI / 2;
      gm.position.y = (this.theme.groundY ?? 0) - 0.35;
      this.group.add(gm);
    }
    if (def.setup) def.setup(this, scene);
    scene.add(this.group);
    return this;
  }

  // ------------------------------------------------------------ colliders
  addCircle(x, z, r, opts = {}) {
    const c = { type: 'circle', x, z, r, y0: opts.y0 ?? -50, y1: opts.y1 ?? 50, bounce: opts.bounce ?? 0.4, tag: opts.tag };
    this._insert(c, x - r, z - r, x + r, z + r);
    return c;
  }
  addBox(x, z, hx, hz, ang = 0, opts = {}) {
    const c = { type: 'box', x, z, hx, hz, ang, cos: Math.cos(ang), sin: Math.sin(ang), y0: opts.y0 ?? -50, y1: opts.y1 ?? 50, bounce: opts.bounce ?? 0.4, tag: opts.tag };
    const r = Math.hypot(hx, hz);
    this._insert(c, x - r, z - r, x + r, z + r);
    return c;
  }
  _insert(c, x0, z0, x1, z1) {
    this.colliders.push(c);
    const s = this.cell;
    for (let gx = Math.floor(x0 / s); gx <= Math.floor(x1 / s); gx++) for (let gz = Math.floor(z0 / s); gz <= Math.floor(z1 / s); gz++) {
      const k = gx * 73856093 ^ gz * 19349663;
      let arr = this.grid.get(k);
      if (!arr) { arr = []; this.grid.set(k, arr); }
      arr.push(c);
    }
  }
  nearby(x, z) {
    const s = this.cell;
    const k = Math.floor(x / s) * 73856093 ^ Math.floor(z / s) * 19349663;
    return this.grid.get(k) || EMPTY;
  }

  /** Ramps: wedge height bumps in (s, lat) space. */
  addRamp(u, lat, width, len, height, opts = {}) {
    const s = u * this.length;
    const r = { s0: s, s1: s + len, lat0: lat - width / 2, lat1: lat + width / 2, h: height, kick: opts.kick ?? true, trick: opts.trick ?? true };
    this.ramps.push(r);
    // mesh
    const g = this.chunks.W(s);
    const P = (ss, l, dy) => { const p = this.path.point(ss, l); return [p.px, p.py + dy, p.pz]; };
    const col = rgb(opts.color || '#ffd23f'), side = rgb(opts.side || '#2a2440');
    const n = 6;
    for (let k = 0; k < n; k++) {
      const a = s + (len * k) / n, b = s + (len * (k + 1)) / n;
      const ha = (height * k) / n, hb = (height * (k + 1)) / n;
      g.set((k % 2) ? col : rgb('#1c1a26'), 0, (k % 2) ? 0.2 : 0);
      g.quad(P(a, r.lat0, ha + 0.02), P(a, r.lat1, ha + 0.02), P(b, r.lat1, hb + 0.02), P(b, r.lat0, hb + 0.02));
      g.set(side, 0, 0);
      g.quad(P(a, r.lat0, 0), P(a, r.lat0, ha), P(b, r.lat0, hb), P(b, r.lat0, 0));
      g.quad(P(b, r.lat1, 0), P(b, r.lat1, hb), P(a, r.lat1, ha), P(a, r.lat1, 0));
    }
    g.set(side, 0, 0);
    g.quad(P(s + len, r.lat0, 0), P(s + len, r.lat0, height), P(s + len, r.lat1, height), P(s + len, r.lat1, 0));
    return r;
  }

  rampHeight(s, lat) {
    let h = 0;
    for (const r of this.ramps) {
      let ds = s - r.s0;
      if (ds < -this.length / 2) ds += this.length;
      if (ds < 0 || ds > r.s1 - r.s0 || lat < r.lat0 || lat > r.lat1) continue;
      h = Math.max(h, (ds / (r.s1 - r.s0)) * r.h);
    }
    return h;
  }

  // ------------------------------------------------------------ queries
  /**
   * Surface info at a world point. hint = last sample index (or -1).
   */
  surface(x, z, hint, out = {}, yHint = null) {
    const p = this.path.project(x, z, hint, hint < 0 ? 40 : 24, out, yHint);
    const i = p.i;
    const hw = p.w / 2;
    p.limL = this.limL[i]; p.limR = this.limR[i];
    let surf = 'road';
    if (p.lat < -hw) surf = this.edges.L[i].surface;
    else if (p.lat > hw) surf = this.edges.R[i].surface;
    p.surf = surf;
    p.offroad = OFFROAD[surf] || 1;
    // sidewalk lift
    const e = p.lat < 0 ? this.edges.L[i] : this.edges.R[i];
    if (Math.abs(p.lat) > hw && e.lift) p.y += e.lift;
    if (this.ramps.length) p.y += this.rampHeight(p.s, p.lat);
    p.tunnel = this.edges.tunnel[i];
    return p;
  }

  update(dt, t, race) {
    for (const u of this.updaters) u(dt, t, race);
  }

  /**
   * Draw distance for lower quality tiers: pull the fog in and skip road
   * chunks that are fully inside it. draw = 1 leaves everything as authored.
   */
  applyDrawDistance(camPos, draw = 1) {
    const [near, far] = this._fog;
    G.uFogNear.value = near * draw;
    G.uFogFar.value = far * draw;
    const lim = far * draw + 40;
    for (const m of this.chunkMeshes) {
      const bs = m.geometry.boundingSphere;
      m.visible = draw >= 1 || camPos.distanceTo(bs.center) - bs.radius < lim;
    }
  }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of Object.values(this.materials)) m.dispose?.();
    this.scene?.remove(this.group);
  }
}
const EMPTY = [];
export { Geo };
