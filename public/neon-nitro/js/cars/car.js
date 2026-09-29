// Assembles a complete car model from a config: hull + cabin + style parts,
// wheels with stance, paint finish and livery. One material per car drives
// every surface via the aMat attribute.
import * as THREE from 'three';
import { Geo } from '../geo/builder.js';
import { carMaterial } from '../render/toon.js';
import { Hull, buildBed, MAT, C } from './hull.js';
import { BODY_DEFS } from './bodies.js';
import { mirrors, sideSkirt, overfender, mudflaps, sideExit, vents, wing, sidePanel, shape, exhaustTip } from './parts.js';
import { buildWheelGeometry, buildCaliperGeometry } from './wheels.js';
import { FINISHES, HEIGHTS, CAMBERS, statsFor, BODIES } from './catalog.js';
import { liveryTexture } from './livery.js';

const SIDE_CFG = {
  stock: { trackAdd: 0, tireAdd: 0 },
  skirts: { trackAdd: 0.01, tireAdd: 0 },
  widebody: { trackAdd: 0.11, tireAdd: 0.035 },
  sidepipes: { trackAdd: 0, tireAdd: 0 },
  works: { trackAdd: 0.09, tireAdd: 0.03 },
  silhouette: { trackAdd: 0.13, tireAdd: 0.04 },
};

function buildSides(g, ctx) {
  const { d, cfg, hull } = ctx;
  const ax = d.wb / 2;
  const s = SIDE_CFG[cfg.side] || SIDE_CFG.stock;
  const mirrorX = ctx.cowlX - 0.12;
  const mirrorY = d.belt + 0.07;
  const cab = ctx.cabinBW ?? d.hw - 0.06;
  const between = [-ax + d.archR + 0.02, ax - d.archR - 0.02];
  const rockerZ = hull.at(0).hw * 0.97;
  // door handles & side markers (always)
  g.set(C.black, MAT.TRIM);
  for (const zs of [-1, 1]) {
    const hx = ctx.handleX ?? -0.35;
    sidePanel(g, hx, d.belt - 0.1, zs * (hull.sideZ(hx, d.belt - 0.1) + 0.004), shape.round(0.14, 0.035, 0.012), 0.012, 0.01, [0, 0, zs]);
  }
  switch (cfg.side) {
    case 'skirts':
      mirrors(g, ctx, { x: mirrorX, y: mirrorY, z: cab, style: 'aero' });
      sideSkirt(g, ctx, { x0: between[0], x1: between[1], y: d.rocker - 0.07, z: rockerZ, h: 0.12, out: 0.04 });
      g.set(C.dark, MAT.CARBON);
      for (const zs of [-1, 1]) g.box((between[0] + between[1]) / 2, d.rocker - 0.085, zs * (rockerZ + 0.07), between[1] - between[0] - 0.1, 0.015, 0.08);
      break;
    case 'widebody':
    case 'works':
    case 'silhouette': {
      const wb = cfg.side === 'widebody', works = cfg.side === 'works', sil = cfg.side === 'silhouette';
      mirrors(g, ctx, { x: mirrorX, y: mirrorY, z: cab, style: sil ? 'aero' : (works ? 'fender' : 'aero') });
      for (const axx of [ax, -ax]) {
        const hw = hull.at(axx).hw;
        overfender(g, ctx, {
          ax: axx, cy: d.R, r: d.archR + 0.01, z: hw - 0.02, out: wb ? 0.15 : (works ? 0.13 : 0.19),
          band: wb ? 0.17 : (works ? 0.2 : 0.26), rivets: !sil, boxy: works, y0: d.rocker - 0.08,
        });
      }
      sideSkirt(g, ctx, { x0: between[0] - 0.04, x1: between[1] + 0.04, y: d.rocker - 0.08, z: rockerZ + (sil ? 0.08 : 0.05), h: sil ? 0.2 : 0.12, out: sil ? 0.1 : 0.06 });
      if (works) mudflaps(g, ctx, { x: -ax - d.archR - 0.06, y: d.rocker - 0.12, z: rockerZ + 0.05 });
      if (sil) {
        sideExit(g, ctx, { x: between[0] + 0.25, y: d.rocker + 0.02, z: rockerZ + 0.15 });
        vents(g, ax - d.archR - 0.12, d.belt - 0.22, hull.at(ax - d.archR - 0.12).hw + 0.13, 3, 0.2);
        g.set(C.black, MAT.TRIM);
        for (const zs of [-1, 1]) sidePanel(g, -0.5, d.rocker + 0.1, zs * (rockerZ + 0.19), shape.trap(0.34, 0.2, 0.08), 0.01, 0.02, [0, 0, zs]);
      }
      break;
    }
    case 'sidepipes':
      mirrors(g, ctx, { x: mirrorX, y: mirrorY, z: cab, style: 'oem' });
      sideExit(g, ctx, { x: -ax + d.archR + 0.3, y: d.rocker + 0.04, z: rockerZ });
      vents(g, ax - d.archR - 0.14, d.belt - 0.2, hull.sideZ(ax - d.archR - 0.14, d.belt - 0.2) + 0.005, 3, 0.18);
      break;
    default:
      mirrors(g, ctx, { x: mirrorX, y: mirrorY, z: cab, style: 'oem' });
      g.set(C.amber, MAT.LIGHT);
      for (const zs of [-1, 1]) sidePanel(g, ax + d.archR + 0.08, d.rocker + 0.28, zs * (hull.sideZ(ax + d.archR + 0.08, d.rocker + 0.28) + 0.004), shape.round(0.08, 0.03, 0.01), 0.008, 0.01, [0, 0, zs]);
  }
  return s;
}

/** Build geometry for a config (no Three objects besides BufferGeometry). */
export function buildCarGeometry(cfg) {
  const B = BODY_DEFS[cfg.body];
  const d = B.dims;
  const f = B.fronts[cfg.front] || B.fronts.stock;
  const r = B.rears[cfg.rear] || B.rears.stock;
  const arches = [{ x: d.wb / 2, cy: d.R, r: d.archR }, { x: -d.wb / 2, cy: d.R, r: d.archR }];
  const hull = new Hull(B.keys(f, r), arches);
  const g = new Geo();
  const ctx = { hull, f, r, d, cfg, exhausts: [], exits: [], cowlX: 0, B };
  hull.build(g, { noRearCap: cfg.body === 'oni' });
  if (cfg.body === 'oni') {
    ctx.cowlX = 0.72;
    const bedHull = new Hull(B.bedKeys(r), arches);
    buildBed(g, bedHull, r.tailX, -0.47, r.railY, 0.94, 0.06, { tailgate: true });
    ctx.bed = bedHull;
    // rear bumper region under the bed
  } else {
    ctx.cowlX = cfg.body === 'kaze' ? 0.85 : 0.75;
  }
  const cab = B.cabin(g, ctx);
  ctx.cabinBW = cfg.body === 'oni' ? 0.9 : (cfg.body === 'kaze' ? 0.845 : 0.86);
  ctx.handleX = cfg.body === 'oni' ? -0.12 : -0.35;
  (B.frontParts[cfg.front] || B.frontParts.stock)(g, ctx);
  (B.rearParts[cfg.rear] || B.rearParts.stock)(g, ctx);
  const sideCfg = buildSides(g, ctx);
  const mount = B.mount(ctx);
  if (cfg.aero && cfg.aero !== 'none') wing(g, ctx, cfg.aero, mount);
  // underbody plate
  g.set([0.05, 0.05, 0.07], MAT.TRIM);
  const xmin = hull.xMin + 0.25, xmax = hull.xMax - 0.3;
  g.quad([xmin, d.rocker + 0.005, 0.7], [xmin, d.rocker + 0.005, -0.7], [xmax, d.rocker + 0.005, -0.7], [xmax, d.rocker + 0.005, 0.7]);
  // side exits registered into exhausts already; takeyari flagged in ctx
  const geom = g.build({ color: true, mat: true });
  const bb = geom.boundingBox;
  return {
    geom, ctx, hull, cab, sideCfg, dims: d,
    bounds: { minX: bb.min.x, maxX: bb.max.x, minY: Math.max(0.1, d.rocker - 0.1), maxY: d.roof + 0.05, halfW: Math.max(bb.max.z, -bb.min.z) },
    tris: g.triCount,
  };
}

const _paint = new THREE.Color();

export class CarModel {
  constructor(cfg, opts = {}) {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.material = carMaterial();
    this.wheels = [];
    this.opts = opts;
    this.shadow = null;
    this.build(cfg);
  }

  build(cfg) {
    this.cfg = { ...cfg };
    // clear previous
    for (const w of this.wheels) this.root.remove(w.pivot);
    this.body.clear();
    this.wheels = [];
    this.geoms?.forEach((gm) => gm.dispose());
    this.geoms = [];

    const G = buildCarGeometry(cfg);
    this.info = G;
    const d = G.dims;
    const mesh = new THREE.Mesh(G.geom, this.material);
    mesh.frustumCulled = true;
    this.body.add(mesh);
    this.bodyMesh = mesh;
    this.geoms.push(G.geom);

    const heightOff = HEIGHTS[cfg.height] ?? 0;
    const camberDeg = CAMBERS[cfg.camber] ?? 0;
    this.heightOff = heightOff;
    this.body.position.y = heightOff;
    this.camber = THREE.MathUtils.degToRad(camberDeg);

    // wheels
    const W = d.W + G.sideCfg.tireAdd;
    const trackAdd = G.sideCfg.trackAdd + Math.sin(this.camber) * d.R * 0.55;
    const wheelOpts = { R: d.R, W, rimR: d.R * 0.68 };
    const gR = buildWheelGeometry(cfg.wheels, { ...wheelOpts, side: 1 });
    const gL = buildWheelGeometry(cfg.wheels, { ...wheelOpts, side: -1 });
    const cR = buildCaliperGeometry({ ...wheelOpts, side: 1 });
    const cL = buildCaliperGeometry({ ...wheelOpts, side: -1 });
    this.geoms.push(gR, gL, cR, cL);
    const lift = d.R * (Math.cos(this.camber) - 1) + (W / 2) * Math.sin(this.camber);
    for (const [ax, front] of [[d.wb / 2, true], [-d.wb / 2, false]]) {
      for (const side of [1, -1]) {
        const pivot = new THREE.Group();
        pivot.position.set(ax, d.R + lift, side * (d.track / 2 + trackAdd));
        const steer = new THREE.Group();
        const camber = new THREE.Group();
        camber.rotation.x = -side * this.camber;
        const spin = new THREE.Group();
        spin.add(new THREE.Mesh(side > 0 ? gR : gL, this.material));
        camber.add(new THREE.Mesh(side > 0 ? cR : cL, this.material));
        camber.add(spin);
        steer.add(camber);
        pivot.add(steer);
        this.root.add(pivot);
        this.wheels.push({ pivot, steer, camber, spin, front, side, baseY: pivot.position.y });
      }
    }
    this.dims = { ...d, length: G.bounds.maxX - G.bounds.minX, halfW: G.bounds.halfW + (trackAdd > 0.05 ? 0.05 : 0), height: d.roof + heightOff };
    this.exhausts = G.ctx.exhausts.map((e) => ({ ...e }));
    this.takeyari = !!G.ctx.takeyari;
    this.rainLight = G.ctx.rainLight || null;
    this.blower = G.ctx.blower || null;
    this.stats = statsFor(cfg);
    this.applyPaint(cfg);
    return this;
  }

  applyPaint(cfg) {
    const u = this.material.uniforms;
    const fin = FINISHES.find((f) => f.id === cfg.finish) || FINISHES[0];
    u.uPaint.value.set(cfg.paint);
    u.uFinish.value.set(...fin.finish);
    u.uFinishKind.value = fin.kind;
    u.uAccent.value.set(cfg.liveryColor || '#ffffff');
    u.uNeon.value.set(cfg.liveryColor || '#00e5ff');
    u.uRimCol.value.set(cfg.rimColor || '#d7d9de');
    const b = this.info.bounds;
    u.uBounds.value.set(b.minX, b.maxX, b.minY, b.maxY);
    u.uHalfW.value = b.halfW;
    if (cfg.livery && cfg.livery !== 'none') {
      const old = u.uLivery.value;
      u.uLivery.value = liveryTexture(cfg.livery, cfg.liveryColor || '#ffffff', { paint: cfg.paint, body: cfg.body, seed: cfg.number ?? 7, jp: BODIES[cfg.body].jp, bounds: b });
      if (old && old !== u.uLivery.value) old.dispose();
      u.uLiveryOn.value = 1;
    } else {
      u.uLiveryOn.value = 0;
    }
    void _paint;
  }

  /** Per-frame visuals: wheel spin, steer, suspension bob. */
  animate(speed, steerAngle, dt, bodyRoll = 0, bodyPitch = 0) {
    const R = this.dims.R;
    for (const w of this.wheels) {
      w.spin.rotation.z -= (speed / R) * dt;
      if (w.front) w.steer.rotation.y = steerAngle;
    }
    this.body.rotation.x = bodyRoll;
    this.body.rotation.z = bodyPitch;
  }

  dispose() {
    this.geoms?.forEach((gm) => gm.dispose());
    this.material.uniforms.uLivery.value?.dispose();
    this.material.dispose();
  }
}

export { exhaustTip };
