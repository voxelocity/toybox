// Neo Tokyo Tower — the finale. Mag-lev skyways spiral around a 640 m
// megatower, dive through an arcology and pass under a maglev line, while
// ONI-GEAR (a giant mecha-oni head) glides ahead of the leader firing laser
// strikes at the pack.
import * as THREE from 'three';
import { Geo } from '../../geo/builder.js';
import { rgb } from '../build.js';
import { cityDressing } from '../scenery/city.js';
import { propLine } from '../scenery/common.js';
import { laserGates, viaduct, bossDrone, searchlights, frame } from '../hazards.js';
import { facadeUV, spotGlow, groundGlow } from '../kit.js';
import { toonMaterial } from '../../render/toon.js';
import { addSign, signUV } from '../../render/signs.js';

// skyway helix around the tower (centre = origin): 13 segments, climbing 32.5 m
const TR = 95, Y0 = 34, CLIMB = 30;
const HELIX = Array.from({ length: 14 }, (_, k) => {
  const a = (-k * Math.PI) / 6;
  return [TR * Math.cos(a), TR * Math.sin(a), Y0 + (CLIMB * k) / 12];
});
// tower radius profile [height, radius]
const PROFILE = [[0, 34], [60, 30], [160, 24], [250, 20], [350, 15], [440, 11], [480, 6]];
const towerR = (y) => {
  for (let k = 0; k < PROFILE.length - 1; k++) {
    const [y0, r0] = PROFILE[k], [y1, r1] = PROFILE[k + 1];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return PROFILE[PROFILE.length - 1][1];
};

export default {
  id: 'skytree',
  name: 'Neo Tokyo Tower',
  jp: '新東京塔',
  laps: 3,
  width: 22,
  music: 'boss',
  seed: 2077,
  maxBank: 0.06,
  points: [
    [95, 220, Y0, 22], [95, 140], [95, 60],
    ...HELIX,
    [100, -125, 68], [160, -205, 68], [260, -232, 66], [345, -175, 62], [378, -60, 54], [368, 60, 42], [325, 170, 30], [250, 262, 26], [170, 312, 28], [115, 290, 32],
  ],
  theme: {
    light: '#c8e4ff', shadow: '#3a3a8a', sky: '#1a2a5e', ground: '#0a0c20', rim: '#ff3fa4', fog: '#141c44',
    skyTop: '#02030f', skyHorizon: '#3a4ab0', lightDir: [-0.3, 0.85, -0.4], fogNear: 140, fogFar: 950, rimStrength: 0.7, windowLit: 0.55,
    road: '#262a48', roadEdge: '#20243e', line: '#e8f4ff', neonBase: '#161a36', neonA: '#20d8ff', neonB: '#ff2d6f',
    rumbleA: '#ff2d6f', rumbleB: '#e8f4ff', deck: '#2a2e50', deckSide: '#3e4470', pillar: '#4a5080', groundColor: '#12142a',
    stars: 0.9, moonDir: [0.2, 0.35, -0.9], moonSize: 0.045, moonColor: '#e8f0ff', cloud: '#2a2060', centerLine: true,
    tunnel: '#3a3e66', tunnelRoof: '#262a4a', tunnelLight: '#20d8ff', tunnelStripe: '#ff2d6f', tunnelHeight: 8.5, padA: '#20d8ff', padB: '#c93dff',
  },
  edges: [{ from: 0, to: 1, both: { kind: 'neon', width: 1.5 } }],
  tunnels: [[0.835, 0.885]],
  noPillars: [[0.105, 0.47]],
  itemRows: [0.06, { u: 0.25, n: 5 }, 0.49, 0.62, { u: 0.79, n: 5 }, 0.935],
  boostPads: [{ u: 0.03, lat: -4 }, { u: 0.03, lat: 4 }, { u: 0.33, lat: 0 }, { u: 0.505, lat: -4 }, { u: 0.675, lat: 0, len: 12 }, { u: 0.82, lat: -5 }, { u: 0.9, lat: 4 }],
  ramps: [{ u: 0.69, lat: 0, w: 12, len: 10, h: 1.8, color: '#20d8ff' }],
  ambient: { kind: 'embers', rate: 26, color: [1, 0.45, 0.85] },
  scenery(track, chunks, rng) {
    cityDressing(track, chunks, rng, {
      hMin: 26, hMax: 120, setback: 6, vertChance: 0.9, boardChance: 0.6, storefront: false, lamps: false, poles: false,
      palette: ['#2a2e5a', '#34306a', '#26385e', '#3a2c62', '#2c3a6a', '#302a52'],
      gaps: [[0.105, 0.47, -1], [0.83, 0.89]],
      // low blocks under the skyways around the tower plaza, towers further out
      heightAt: (u, side, h, r, x, z) => (Math.hypot(x, z) < 175 ? Math.min(h, 18 + r() * 8) : h),
      skyline: { hMin: 80, hMax: 280, r0: 520, r1: 1100, count: 130 },
    });
    megatower(track, chunks);
    arcology(track, chunks, 0.835, 0.885);
    hoverPads(track, chunks, 0.105, 0.47);
    holoBoards(track, chunks, rng);
    propLine(track, 'cone', 0.555, 0.575, -8, 4);
    propLine(track, 'barrier', 0.575, 0.585, -8.5, 3);
    propLine(track, 'cone', 0.95, 0.97, 8, 4);
  },
  setup(track) {
    laserGates(track, [[0.515, 0], [0.535, 1.6]], { period: 3.2 });
    viaduct(track, 0.6, { height: 14, period: 9, offset: 2, trainColor: '#20d8ff', cars: 6, ground: true, color: '#3a3e6a' });
    bossDrone(track, { ahead: 85, height: 22, period: 5.6 });
    searchlights(track, [[0, 490, 0], [0, 490, 0], [0, 262, 0]], { len: 420, r: 16, color: [0.22, 0.26, 0.45], tilt: 1.05 });
    skyTraffic(track);
    // tower beacon
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(2.4, 10, 6), new THREE.MeshBasicMaterial({ color: 0xff2040 }));
    beacon.position.set(0, 644, 0);
    track.group.add(beacon);
    track.updaters.push((dt, t) => { beacon.visible = (t % 1.6) < 0.8; });
  },
};

// ------------------------------------------------------------------ the megatower
function megatower(track, chunks) {
  const g = new Geo(), sg = new Geo(), gl = new Geo();
  const legs = 8, levels = [];
  for (let y = 0; y <= 480; y += 30) levels.push(y);
  const P = (k, y) => { const a = (k / legs) * Math.PI * 2 + y * 0.0016; const r = towerR(y); return [Math.cos(a) * r, y, Math.sin(a) * r]; };
  // plaza podium
  g.set(rgb('#1e2244'), 0, 0); g.cyl([0, -0.2, 0], [0, 7, 0], 58, 60, 32, true);
  g.set(rgb('#20d8ff'), 0, 1); g.cyl([0, 6.4, 0], [0, 6.9, 0], 58.4, 58.4, 32, false);
  // core with window uv
  g.uvMode = (p, n) => (Math.abs(n.y) > 0.5 ? [0, 0] : [Math.atan2(p.z, p.x) * 12, p.y - 10]);
  g.set(rgb('#303666'), 0, 0);
  for (let k = 0; k < levels.length - 1; k++) {
    const y0 = levels[k], y1 = levels[k + 1];
    g.cyl([0, y0, 0], [0, y1, 0], towerR(y0) * 0.55, towerR(y1) * 0.55, 16, false);
  }
  g.uvMode = null;
  // lattice: legs, X braces, rings
  g.set(rgb('#d8e0ff'), 0, 0.08);
  for (let k = 0; k < legs; k++) {
    for (let l = 0; l < levels.length - 1; l++) {
      const y0 = levels[l], y1 = levels[l + 1];
      g.cyl(P(k, y0), P(k, y1), 1.5, 1.5, 5, false);
      g.cyl(P(k, y0), P(k + 1, y1), 0.55, 0.55, 4, false);
      g.cyl(P(k + 1, y0), P(k, y1), 0.55, 0.55, 4, false);
      g.cyl(P(k, y1), P(k + 1, y1), 0.7, 0.7, 4, false);
    }
  }
  // neon rings on the lattice
  for (let y = 60; y < 480; y += 60) {
    g.set(rgb((y / 60) % 2 ? '#ff2d6f' : '#20d8ff'), 0, 1);
    g.cyl([0, y - 0.5, 0], [0, y + 0.5, 0], towerR(y) + 1.6, towerR(y) + 1.6, 32, false);
  }
  // observation decks
  for (const [y, r, h] of [[250, 30, 16], [360, 22, 11]]) {
    g.set(rgb('#262a50'), 0, 0); g.cyl([0, y - h / 2, 0], [0, y + h / 2, 0], r * 0.92, r, 32, true);
    g.set(rgb('#9ae8ff'), 0, 0.9); g.cyl([0, y - h * 0.15, 0], [0, y + h * 0.25, 0], r + 0.08, r + 0.08, 32, false);
    g.set(rgb('#ff2d6f'), 0, 1); g.cyl([0, y + h / 2 - 0.4, 0], [0, y + h / 2 + 0.3, 0], r + 0.4, r + 0.4, 32, false);
    spotGlow(gl, [0, y, 0], r * 1.6, [0.2, 0.3, 0.55]);
  }
  // spire + antenna rings
  g.set(rgb('#e8ecff'), 0, 0.1); g.cyl([0, 478, 0], [0, 642, 0], 3.2, 0.35, 8, false);
  g.set(rgb('#20d8ff'), 0, 1); for (let y = 500; y < 630; y += 26) g.cyl([0, y, 0], [0, y + 1, 0], 3.4 - (y - 478) * 0.018, 3.4 - (y - 478) * 0.018, 10, false);
  // giant signage on the podium and the core
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const nx = Math.cos(a), nz = Math.sin(a);
    const r = towerR(120) * 0.55 + 0.4;
    addSign(sg, [nx * r, 120, nz * r], nx, nz, 7, 30, signUV('v', [5, 18, 17, 26][k]), 1);
    addSign(sg, [nx * 60.3, 3.4, nz * 60.3], nx, nz, 16, 4.5, signUV('h', [24, 12, 64, 52][k]), 1);
  }
  // cantilever spokes under the helix
  for (let k = 0; k <= 13; k++) {
    const a = (-k * Math.PI) / 6;
    const y = Y0 + (CLIMB * k) / 12 - 2.2;
    const rt = towerR(y) + 0.5, re = TR - 11 - 1.5 + 0.8;
    const c = Math.cos(a), s = Math.sin(a);
    g.set(rgb('#4a5080'), 0, 0); g.cyl([c * rt, y, s * rt], [c * re, y + 0.4, s * re], 1.8, 1.1, 6, true);
    g.set(rgb('#20d8ff'), 0, 1); g.cyl([c * rt, y - 1.3, s * rt], [c * re, y - 0.7, s * re], 0.18, 0.18, 4, false);
  }
  track.extra = (track.extra || []).concat([[g, 'world'], [sg, 'sign'], [gl, 'glow']]);
  void chunks;
}

/** Glowing anti-grav emitters under pillar-less skyway sections. */
function hoverPads(track, chunks, u0, u1) {
  const path = track.path, L = path.length;
  for (let s = u0 * L + 8; s < u1 * L; s += 22) {
    const g = chunks.W(s), gl = chunks.L(s);
    for (const lat of [-6, 6]) {
      const P = path.point(s, lat);
      g.set(rgb('#20d8ff'), 0, 1); g.cyl([P.px, P.py - 1.35, P.pz], [P.px, P.py - 1.7, P.pz], 1.4, 1.0, 10, true);
      groundGlow(gl, P.px, P.py - 1.75, P.pz, 5, [0.1, 0.5, 0.7]);
    }
  }
}

/** Floating holo-billboards beside the skyways. */
function holoBoards(track, chunks, rng) {
  const path = track.path, L = path.length;
  let k = 0;
  for (let s = 60; s < L - 30; s += 110) {
    const i = path.indexAt(s);
    if (track.edges.tunnel[i]) continue;
    const side = k++ % 2 ? 1 : -1;
    const u = s / L;
    if (side < 0 && u > 0.105 && u < 0.47) continue; // tower side of the helix
    const lim = side < 0 ? track.limL[i] : track.limR[i];
    const P = path.point(s, side * (lim + 5));
    const w = 16 + rng() * 6, h = w * 0.44;
    const y = P.py + 7 + rng() * 6;
    addSign(chunks.S(s), [P.px, y, P.pz], -side * P.rx, -side * P.rz, w, h, signUV('b', Math.floor(rng() * 8)), 1);
    addSign(chunks.S(s), [P.px + side * P.rx * 0.05, y, P.pz + side * P.rz * 0.05], side * P.rx, side * P.rz, w, h, signUV('b', Math.floor(rng() * 8)), 1);
    const gw = chunks.W(s);
    gw.set(rgb('#20d8ff'), 0, 1);
    gw.box(P.px, y - h / 2 - 0.3, P.pz, 0.4, 0.3, 0.4);
    spotGlow(chunks.L(s), [P.px - side * P.rx * 1.5, y, P.pz - side * P.rz * 1.5], w * 0.55, [0.3, 0.2, 0.5]);
  }
}

/** The arcology megablock the skyway tunnels through (built in slices so it follows the curve). */
function arcology(track, chunks, u0, u1) {
  const path = track.path, L = path.length;
  const s0 = u0 * L - 6, s1 = u1 * L + 6, step = 3, top = 112, topS = 76, D = 34;
  for (let s = s0; s < s1; s += step) {
    const i = path.indexAt(s);
    const F = frame(track, s);
    const hw = path.w[i] / 2 + 1.5 + 1.3;
    const g = chunks.W(s);
    g.uvMode = facadeUV(0, 6);
    g.set(rgb('#2c3060'), 0, 0);
    g.at([F.x, 0, F.z], [0, F.ang, 0], 1, (gg) => {
      // stepped massing: two wings, a crown over the middle
      for (const sd of [-1, 1]) gg.box(0, topS / 2, sd * (hw + D / 2), step + 0.06, topS, D);
      gg.box(0, (F.y + 9.4 + topS) / 2, 0, step + 0.06, topS - F.y - 9.4, hw * 2 + 0.1);
      gg.box(0, (topS + top) / 2, 0, step + 0.06, top - topS, hw * 2 + D);
      gg.box(0, (F.y - 1.6) / 2, 0, step + 0.06, F.y - 1.6, hw * 2 + 0.1);
    });
    g.uvMode = null;
  }
  // portals: neon frames + signs on both faces
  for (const [s, dir] of [[s0, -1], [s1, 1]]) {
    const F = frame(track, s);
    const i = path.indexAt(s);
    const hw = path.w[i] / 2 + 1.5 + 1.3;
    const nx = F.tx * dir, nz = F.tz * dir;
    const off = step / 2 + 0.1;
    const g = chunks.W(s), sg = chunks.S(s), gl = chunks.L(s);
    g.set(rgb('#ff2d6f'), 0, 1);
    g.at([F.x + nx * off, F.y, F.z + nz * off], [0, F.ang, 0], 1, (gg) => {
      for (const sd of [-1, 1]) gg.box(0, 5, sd * hw, 0.4, 10, 0.5);
      gg.box(0, 9.9, 0, 0.4, 0.5, hw * 2);
    });
    addSign(sg, [F.x + nx * (off + 0.1), F.y + 15, F.z + nz * (off + 0.1)], nx, nz, 20, 5, signUV('h', 24), 1);
    addSign(sg, [F.x + nx * (off + 0.1) + F.rx * 30, F.y + 34, F.z + nz * (off + 0.1) + F.rz * 30], nx, nz, 5, 26, signUV('v', 5), 1);
    addSign(sg, [F.x + nx * (off + 0.1) - F.rx * 30, F.y + 48, F.z + nz * (off + 0.1) - F.rz * 30], nx, nz, 28, 12.3, signUV('b', dir > 0 ? 2 : 5), 1);
    spotGlow(gl, [F.x + nx * (off + 2), F.y + 15, F.z + nz * (off + 2)], 14, [0.4, 0.15, 0.35]);
  }
}

/** Flying cars streaming along sky lanes between the towers. */
function skyTraffic(track) {
  const g = new Geo();
  g.set([0.14, 0.14, 0.24], 0, 0); g.box(0, 0, 0, 4.4, 0.9, 2.1); g.box(-0.3, 0.65, 0, 2.3, 0.6, 1.7);
  g.set([1, 0.25, 0.4], 0, 1); g.box(-2.22, 0, 0, 0.1, 0.3, 1.9);
  g.set([0.8, 0.95, 1], 0, 1); g.box(2.22, 0, 0, 0.1, 0.22, 1.9);
  g.set([0.3, 0.9, 1], 0, 1); g.box(0, -0.5, 0, 3.8, 0.1, 1.7);
  const lanes = [];
  const rng = (() => { let s = 99; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();
  for (let k = 0; k < 8; k++) {
    const a = rng() * Math.PI, y = 90 + rng() * 120, off = (rng() - 0.5) * 600;
    const dx = Math.cos(a), dz = Math.sin(a);
    lanes.push({ ox: -dz * off + 160, oz: dx * off + 40, y, dx, dz, dir: k % 2 ? 1 : -1, speed: 40 + rng() * 30 });
  }
  const per = 7, n = lanes.length * per, len = 1400;
  const im = new THREE.InstancedMesh(g.build({ color: true, emit: true }), toonMaterial({ vertexColors: true, emitAttr: true, rim: 0.3 }), n);
  im.frustumCulled = false;
  track.group.add(im);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  track.updaters.push((dt, t) => {
    let idx = 0;
    for (const l of lanes) {
      q.setFromAxisAngle(up, Math.atan2(-l.dz * l.dir, l.dx * l.dir));
      for (let c = 0; c < per; c++) {
        const d = ((t * l.speed + (c * len) / per) % len) - len / 2;
        p.set(l.ox + l.dx * d * l.dir, l.y + Math.sin(t + c) * 0.8, l.oz + l.dz * d * l.dir);
        m.compose(p, q, sc);
        im.setMatrixAt(idx++, m);
      }
    }
    im.instanceMatrix.needsUpdate = true;
  });
}
