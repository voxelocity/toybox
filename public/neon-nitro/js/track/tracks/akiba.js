// Akiba Overdrive — Electric Town. Signs on every floor, gacha capsules
// bouncing down the main drag, a spiral car-park climb, a rooftop sprint and
// a kicker off the roof onto the exit ramp.
import * as THREE from 'three';
import { Geo } from '../../geo/builder.js';
import { rgb } from '../build.js';
import { cityDressing } from '../scenery/city.js';
import { propLine, propCluster, sidewalkProps, propAt } from '../scenery/common.js';
import { rollers, laserGates, viaduct, searchlights, frame } from '../hazards.js';
import { spotGlow, groundGlow, streetLamp } from '../kit.js';
import { addSign, signUV } from '../../render/signs.js';

// car-park helix: 1.5 turns around (CX, CZ), climbing to the roof deck at 16 m
const CX = 330, CZ = 285, HR = 36, ROOF = 16;
const HELIX = Array.from({ length: 19 }, (_, k) => {
  const a = Math.PI - (k * Math.PI) / 6;
  return [CX + HR * Math.cos(a), CZ + HR * Math.sin(a), (ROOF * k) / 18];
});
// sign atlas cells that read as Electric Town (games, anime, manga, maid, gacha...)
const H_SIGNS = [2, 42, 7, 47, 17, 57, 19, 59, 23, 63, 27, 67, 30, 70, 33, 73, 36, 76, 39, 79, 12];
const V_SIGNS = [11, 32, 4, 25, 5, 26, 8, 29];
const CAPS = ['#ff5ccf', '#20d8ff', '#ffe23b', '#56f06b', '#ff8a1e', '#c93dff'];

export default {
  id: 'akiba',
  name: 'Akiba Overdrive',
  jp: '秋葉原',
  laps: 3,
  // flat city streets: banking would sink the inside edge under the ground/dock slabs
  maxBank: 0.02,
  width: 22,
  music: 'chip',
  seed: 3939,
  points: [
    [60, 0, 0, 22], [140, 0], [205, 4], [246, 28], [262, 78], [262, 150], [264, 210], [284, 252, 0, 18],
    ...HELIX,
    [372, 240, ROOF, 20], [372, 190, ROOF], [372, 150, ROOF], [372, 115, 10], [372, 80, 2], [372, 50, 0, 22],
    [392, 12], [430, -20], [442, -76], [410, -126], [320, -140], [210, -150], [110, -140], [30, -128], [-24, -100], [-40, -52], [-24, -12], [16, 0],
  ],
  theme: {
    light: '#d4ccff', shadow: '#48358a', sky: '#2a1f5e', ground: '#120a24', rim: '#2af0ff', fog: '#22164a',
    skyTop: '#06031a', skyHorizon: '#a02a8a', lightDir: [0.35, 0.8, 0.45], fogNear: 80, fogFar: 540, rimStrength: 0.65, windowLit: 0.5,
    road: '#2e2c48', roadEdge: '#26243e', line: '#f0eeff', sidewalk: '#6e6496', curb: '#d2c8f0', rail: '#f0ecff',
    barrier: '#d8d0ee', barrierStripe: '#ffe23b', groundColor: '#1e1834', stars: 0.3, moonDir: [-0.4, 0.5, 0.75], cloud: '#3a1a5a',
    centerLine: true, deck: '#3e3860', deckSide: '#5a5480', pillar: '#7a74a0', padA: '#ffe23b', padB: '#ff5ccf',
  },
  edges: [
    { from: 0, to: 1, both: { kind: 'sidewalk', width: 4.5 } },
    { from: 0.236, to: 0.552, both: { kind: 'barrier', width: 1.4, height: 1.1 } },
  ],
  noPillars: [[0.236, 0.5]],
  itemRows: [0.09, { u: 0.226, n: 5 }, { u: 0.458, n: 4 }, 0.63, 0.775, 0.935],
  boostPads: [{ u: 0.03, lat: -5 }, { u: 0.03, lat: 5 }, { u: 0.14, lat: 0 }, { u: 0.474, lat: 0, len: 12 }, { u: 0.69, lat: -4 }, { u: 0.835, lat: 3 }],
  ramps: [{ u: 0.4885, lat: 0, w: 10, len: 10, h: 1.8, color: '#ffe23b' }],
  ambient: { kind: 'embers', rate: 22, color: [0.55, 1, 1] },
  scenery(track, chunks, rng) {
    cityDressing(track, chunks, rng, {
      hMin: 14, hMax: 58, vertChance: 1, boardChance: 0.7, hSigns: H_SIGNS, vSigns: V_SIGNS,
      palette: ['#5a3a86', '#3a4a8a', '#6a3a7a', '#2f5a86', '#7a4a8a', '#4a3a70', '#3a5a7a', '#8a3a6a'],
      intersections: [0.06, 0.8], footbridges: [0.155, 0.87],
      gaps: [[0.19, 0.475], [0.732, 0.748]], noLamps: [[0.236, 0.428]],
      skyline: { hMin: 50, hMax: 170 },
      // keep the blocks around the roof deck and exit ramp low so the rooftop feels high up
      heightAt: (u, side, h, r) => (u > 0.465 && u < 0.545 ? 5 + r() * 11 : h),
    });
    carPark(track, chunks, rng);
    gachaGate(track, chunks, 0.2);
    parkEntrance(track, chunks, 0.238);
    sidewalkProps(track, rng, ['vending', 'vending', 'box', 'sign', 'trash', 'box'], 18);
    propLine(track, 'cone', 0.45, 0.472, -8, 5);
    propLine(track, 'cone', 0.45, 0.472, 8, 5);
    propCluster(track, 'box', 0.562, 8, 6, 2.5, rng);
    propCluster(track, 'crate', 0.59, -8, 5, 2.5, rng);
    propCluster(track, 'box', 0.72, 8, 6, 2.2, rng);
    propCluster(track, 'barrel', 0.905, -7, 4, 2.2, rng);
    propAt(track, 'tanuki', 0.955 * track.path.length, 10);
    propAt(track, 'sign', 0.182 * track.path.length, 0);
  },
  setup(track) {
    rollers(track, [[0.2, 1, 0], [0.2, -1, 3.8]], { kind: 'gacha', along: 105, period: 7.6, colors: CAPS });
    laserGates(track, [[0.242, 0]], { style: 'boom', period: 3.6 });
    viaduct(track, 0.74, { height: 10, period: 15, offset: 4, trainColor: '#ffe23b', cars: 6 });
    searchlights(track, [[359, 17, 150], [385, 17, 150], [CX, 36, CZ]]);
    blimp(track);
  },
};

// ------------------------------------------------------------------ car park
function carPark(track, chunks) {
  const path = track.path;
  const N = path.N;
  const g = new Geo(), sg = new Geo(), gl = new Geo();
  // clearance from every road sample (all levels): true if (x, z) is clear by `m`
  const clearOfRoad = (x, z, m) => {
    for (let i = 0; i < N; i += 2) {
      const d = Math.hypot(path.px[i] - x, path.pz[i] - z);
      if (d < path.w[i] / 2 + 1.4 + m) return false;
    }
    return true;
  };

  // -- central core: lift shaft tower with neon rings, P signs and billboards
  const coreR = 21, coreH = 34;
  g.set(rgb('#3a3462'), 0, 0); g.cyl([CX, -0.1, CZ], [CX, coreH, CZ], coreR, coreR, 24, true);
  for (const [y, c] of [[4.2, '#ff5ccf'], [9.6, '#20d8ff'], [14.9, '#ffe23b'], [22, '#ff5ccf'], [coreH - 0.6, '#20d8ff']]) {
    g.set(rgb(c), 0, 1); g.cyl([CX, y, CZ], [CX, y + 0.35, CZ], coreR + 0.12, coreR + 0.12, 24, false);
  }
  g.set(rgb('#2a2446'), 0, 0); g.cyl([CX, coreH, CZ], [CX, coreH + 1.2, CZ], coreR + 0.6, coreR + 0.6, 24, true);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const nx = Math.cos(a), nz = Math.sin(a);
    pSign(g, [CX + nx * (coreR + 0.2), 28.5, CZ + nz * (coreR + 0.2)], nx, nz, 7);
    const b = a + Math.PI / 4;
    const bx = Math.cos(b), bz = Math.sin(b);
    addSign(sg, [CX + bx * (coreR + 0.3), 27.5, CZ + bz * (coreR + 0.3)], bx, bz, 15, 6.6, signUV('b', k * 2 + 1), 1);
    spotGlow(gl, [CX + bx * (coreR + 2), 27.5, CZ + bz * (coreR + 2)], 9, [0.35, 0.25, 0.55]);
    addSign(sg, [CX + bx * (coreR + 0.3), 19, CZ + bz * (coreR + 0.3)], bx, bz, 2.2, 7.4, signUV('v', V_SIGNS[k]), 1);
  }
  track.addCircle(CX, CZ, coreR + 0.3, { tag: 'building' });

  // -- outer ring of columns with neon floor beams (skipped where a road passes)
  const ringR = 51, nCol = 28;
  const keep = [];
  for (let k = 0; k < nCol; k++) {
    const a = (k / nCol) * Math.PI * 2;
    const x = CX + Math.cos(a) * ringR, z = CZ + Math.sin(a) * ringR;
    keep.push(clearOfRoad(x, z, 1.2) ? [x, z] : null);
  }
  keep.forEach((c, k) => {
    if (!c) return;
    g.set(rgb('#6a6490'), 0, 0); g.box(c[0], 8.9, c[1], 1.4, 17.8, 1.4);
    track.addCircle(c[0], c[1], 1, { tag: 'pillar' });
    const n = keep[(k + 1) % nCol];
    if (!n) return;
    for (const [y, col, e] of [[5.4, '#8a84b0', 0], [10.8, '#8a84b0', 0], [16.4, '#8a84b0', 0], [6.1, '#ff5ccf', 1], [11.5, '#20d8ff', 1], [17.1, '#ffe23b', 1]]) {
      g.set(rgb(col), 0, e);
      g.cyl([c[0], y, c[1]], [n[0], y, n[1]], e ? 0.12 : 0.45, e ? 0.12 : 0.45, e ? 4 : 5, false);
    }
  });

  // -- lighting: strips under the upper deck, pools on the ramp below, wall lamps where open
  const s0 = 0.246 * track.path.length, turn = (2 * Math.PI * HR);
  const L1 = 0.305 * track.path.length, L2 = 0.425 * track.path.length;
  for (let s = s0 + 4; s < L1; s += 9) {
    const up = s + turn * 0.985;
    for (const lat of [-5, 0, 5]) {
      const P = path.point(up, lat);
      g.set(rgb('#e8f4ff'), 0, 1); g.at([P.px, P.py - 1.34, P.pz], [0, Math.atan2(-P.tz, P.tx), 0], 1, (gg) => gg.box(0, 0, 0, 3.2, 0.1, 0.35));
    }
    const Q = path.point(s, 0);
    groundGlow(chunks.L(s), Q.px, Q.py + 0.05, Q.pz, 7, [0.32, 0.36, 0.42]);
  }
  for (let s = L1 + 6; s < L2; s += 20) {
    const Pc = path.point(s, 0);
    const Pr = path.point(s, 9);
    const outer = Math.hypot(Pr.px - CX, Pr.pz - CZ) > Math.hypot(Pc.px - CX, Pc.pz - CZ) ? 1 : -1;
    const i = path.indexAt(s);
    const lim = outer > 0 ? track.limR[i] : track.limL[i];
    const P = path.point(s, outer * (lim + 0.2));
    streetLamp({ world: chunks.W(s), glow: chunks.L(s) }, P.px, P.py, P.pz, -outer * P.rx, -outer * P.rz, { h: 6.5, reach: 1.8, light: ['#ff9ae6', '#9aeaff'][Math.round(s / 20) % 2], groundY: P.py, pool: 7 });
  }

  // -- the main block under the roof deck: open-sided car park floors
  const bx0 = 372 - 13, bx1 = 372 + 13, bz0 = 153, bz1 = 238, top = ROOF - 1.3;
  const bcx = (bx0 + bx1) / 2, bcz = (bz0 + bz1) / 2, bw = bx1 - bx0, bd = bz1 - bz0;
  g.set(rgb('#1a1630'), 0, 0); g.box(bcx, top / 2, bcz, bw - 1, top, bd - 1);
  for (let y = 0; y < top - 1; y += 3.6) {
    g.set(rgb('#8a84a8'), 0, 0); g.box(bcx, y + 0.45 + (y ? 0 : 0.2), bcz, bw, 0.9, bd);
    g.set(rgb('#dff0ff'), 0, 0.95); g.box(bcx, y + 3.15, bcz, bw - 0.85, 0.12, bd - 0.85);
  }
  g.set(rgb('#8a84a8'), 0, 0); g.box(bcx, top - 0.5, bcz, bw, 1, bd);
  g.set(rgb('#5a5480'), 0, 0);
  for (let x = bx0; x <= bx1 + 0.1; x += bw / 3) for (const z of [bz0, bz1]) g.box(x, top / 2, z, 0.9, top, 0.9);
  for (let z = bz0; z <= bz1 + 0.1; z += bd / 8) for (const x of [bx0, bx1]) g.box(x, top / 2, z, 0.9, top, 0.9);
  // facade signage: giant ad toward the helix + main street, verticals, a big P
  addSign(sg, [bx0 - 0.3, 8, bcz - 12], -1, 0, 26, 11.4, signUV('b', 4), 1);
  spotGlow(gl, [bx0 - 3, 8, bcz - 12], 16, [0.4, 0.3, 0.6]);
  addSign(sg, [bx0 - 0.3, 8, bcz + 22], -1, 0, 2.2, 10, signUV('v', 11), 1);
  addSign(sg, [bx1 + 0.3, 7.5, bcz], 1, 0, 24, 10.5, signUV('b', 6), 1);
  addSign(sg, [bx1 + 0.3, 7.5, bcz - 25], 1, 0, 2.2, 10, signUV('v', 32), 1);
  addSign(sg, [bcx, 9, bz0 - 0.3], 0, -1, 14, 5.2, signUV('h', 30), 1);
  pSign(g, [bx1 + 0.5, 8, bcz + 24], 1, 0, 6);
  pSign(g, [bx0 - 0.5, 8, bcz - 30], -1, 0, 6);
  track.addBox(bcx, bcz, bw / 2, bd / 2, 0, { tag: 'building', y1: top - 0.5 });
  // painted parking bays along the roof deck edges
  const r0 = 0.432 * track.path.length, r1 = 0.482 * track.path.length;
  for (let s = r0; s < r1; s += 2.8) {
    for (const sg2 of [-1, 1]) {
      const [a, b] = sg2 > 0 ? [path.point(s, 6.8), path.point(s, 9.6)] : [path.point(s, -9.6), path.point(s, -6.8)];
      const w = chunks.W(s);
      w.set([0.92, 0.92, 1], 0, 0.15);
      const tx = a.tx * 0.07, tz = a.tz * 0.07;
      w.quad([a.px - tx, a.py + 0.025, a.pz - tz], [b.px - tx, b.py + 0.025, b.pz - tz], [b.px + tx, b.py + 0.025, b.pz + tz], [a.px + tx, a.py + 0.025, a.pz + tz]);
    }
  }
  track.extra = (track.extra || []).concat([[g, 'world'], [sg, 'sign'], [gl, 'glow']]);
}

/** Blue parking "P" panel facing (nx, nz), side length s. */
function pSign(g, c, nx, nz, s) {
  const ang = Math.atan2(-nz, nx);
  g.at(c, [0, ang, 0], 1, (gg) => {
    gg.set(rgb('#1a6aff'), 0, 0.85); gg.box(0, 0, 0, 0.3, s, s);
    gg.set([1, 1, 1], 0, 0); gg.box(-0.05, 0, 0, 0.32, s + 0.3, s + 0.3);
    gg.set([1, 1, 1], 0, 1);
    // viewer's left is local +z
    gg.box(0.17, 0, s * 0.14, 0.06, s * 0.64, s * 0.12);
    gg.box(0.17, s * 0.26, -s * 0.01, 0.06, s * 0.12, s * 0.3);
    gg.box(0.17, s * 0.02, -s * 0.01, 0.06, s * 0.12, s * 0.3);
    gg.box(0.17, s * 0.14, -s * 0.16, 0.06, s * 0.36, s * 0.12);
  });
}

/** Car-park entrance portal with ticket-gate booms (the booms are a hazard, see setup). */
function parkEntrance(track, chunks, u) {
  const s = u * track.path.length;
  const F = frame(track, s);
  const i = track.path.indexAt(s);
  const W = Math.max(track.limL[i], track.limR[i]) + 1.6;
  const g = chunks.W(s), sg = chunks.S(s);
  g.at([F.x, F.y, F.z], [0, F.ang, 0], 1, (gg) => {
    gg.set(rgb('#2a2446'), 0, 0);
    for (const z of [-W, W]) gg.box(0, 3.5, z, 1.2, 7, 1.2);
    gg.box(0, 7.6, 0, 1.6, 1.6, W * 2 + 1.2);
    gg.set(rgb('#ffe23b'), 0, 0.9); gg.box(-0.82, 6.9, 0, 0.05, 0.18, W * 2 + 1.2);
    // clearance bar
    gg.set(rgb('#ffe23b'), 0, 0.2); gg.box(0, 6.4, 0, 0.3, 0.3, W * 2);
  });
  pSign(g, [F.x - F.tx * 0.9, F.y + 9.9, F.z - F.tz * 0.9], -F.tx, -F.tz, 3.2);
  addSign(sg, [F.x - F.tx * 0.85 + F.rx * 6, F.y + 7.6, F.z - F.tz * 0.85 + F.rz * 6], -F.tx, -F.tz, 7, 1.4, signUV('h', 24), 1);
  addSign(sg, [F.x - F.tx * 0.85 - F.rx * 6, F.y + 7.6, F.z - F.tz * 0.85 - F.rz * 6], -F.tx, -F.tz, 7, 1.4, signUV('h', 12), 1);
  for (const side of [-1, 1]) track.addCircle(F.x + F.rx * side * W, F.z + F.rz * side * W, 0.9, { tag: 'post' });
}

/** Giant gacha machine arching over the main street; its capsules roll at the racers. */
function gachaGate(track, chunks, u) {
  const s = u * track.path.length;
  const F = frame(track, s);
  const i = track.path.indexAt(s);
  const W = Math.max(track.limL[i], track.limR[i]) + 1.2;
  const g = chunks.W(s), sg = chunks.S(s), gl = chunks.L(s);
  const bodyY = 9.5, bodyH = 6, depth = 6;
  g.at([F.x, F.y, F.z], [0, F.ang, 0], 1, (gg) => {
    // legs + body
    gg.set(rgb('#ff2d6f'), 0, 0.05);
    for (const z of [-W, W]) gg.cbox(0, bodyY / 2, z, depth * 0.6, bodyY, 2.2, 0.3);
    gg.cbox(0, bodyY + bodyH / 2, 0, depth, bodyH, W * 2 + 2.2, 0.4);
    gg.set(rgb('#f4f0ff'), 0, 0.1); gg.box(0, bodyY + 0.3, 0, depth + 0.1, 0.6, W * 2 + 2.3);
    gg.set(rgb('#ffe23b'), 0, 0.9); gg.box(0, bodyY + bodyH - 0.3, 0, depth + 0.1, 0.25, W * 2 + 2.3);
    // front face (toward oncoming racers = local -x): crank, coin slot, chute
    for (const fx of [-1, 1]) {
      const x = fx * (depth / 2 + 0.05);
      gg.set(rgb('#f4f0ff'), 0, 0.2); gg.cyl([x, bodyY + 3.2, -W * 0.45], [x + fx * 0.5, bodyY + 3.2, -W * 0.45], 1.7, 1.7, 16, true);
      gg.set(rgb('#c8c0e0'), 0, 0); gg.box(x + fx * 0.75, bodyY + 3.2, -W * 0.45, 0.5, 0.6, 3.6);
      gg.set(rgb('#ffe23b'), 0, 0.8); gg.box(x, bodyY + 3.4, W * 0.45, 0.2, 1.6, 1.1);
      gg.set(rgb('#141020'), 0, 0); gg.box(x, bodyY + 1.3, W * 0.45, 0.2, 0.25, 0.6);
      gg.set(rgb('#141020'), 0, 0); gg.box(x, bodyY + 1.1, 0, 0.2, 1.6, 3.4);
    }
    // glass dome: frame arcs, capsules piled inside, knob on top
    const dy = bodyY + bodyH, dr = Math.min(W * 0.75, 9);
    gg.set(rgb('#f4f0ff'), 0, 0.25);
    for (let m = 0; m < 6; m++) {
      const a = (m / 6) * Math.PI;
      let prev = null;
      for (let k = 0; k <= 6; k++) {
        const t = (k / 6) * Math.PI;
        const q = [Math.cos(a) * Math.cos(t) * depth * 0.55, dy + Math.sin(t) * dr * 0.9, Math.sin(a) * Math.cos(t) * dr];
        if (prev) gg.cyl(prev, q, 0.12, 0.12, 4, false);
        prev = q;
      }
    }
    for (let k = 0; k < 22; k++) {
      const a = k * 2.39996, rr = Math.sqrt((k + 0.5) / 22) * dr * 0.8;
      const px = Math.cos(a) * Math.min(rr, depth * 0.3), pz = Math.sin(a) * rr;
      const py = dy + 1.2 + (k % 3) * 1.3 + (1 - rr / dr) * 1.8;
      gg.set(rgb(CAPS[k % CAPS.length]), 0, 0.25);
      gg.sphere(px, py, pz, 1.05, 1.05, 1.05, 8, 5);
    }
    gg.set(rgb('#ff2d6f'), 0, 0.2); gg.sphere(0, dy + dr * 0.9 + 0.6, 0, 1.2, 0.9, 1.2, 8, 5);
  });
  for (const fx of [-1, 1]) {
    addSign(sg, [F.x + F.tx * fx * (depth / 2 + 0.12), F.y + bodyY + 3.3, F.z + F.tz * fx * (depth / 2 + 0.12)], F.tx * fx, F.tz * fx, 9, 3.4, signUV('h', 39 + (fx > 0 ? 40 : 0)), 1);
    spotGlow(gl, [F.x + F.tx * fx * (depth / 2 + 2), F.y + bodyY + 3.3, F.z + F.tz * fx * (depth / 2 + 2)], 8, [0.5, 0.2, 0.4]);
  }
  for (const side of [-1, 1]) track.addBox(F.x + F.rx * side * W, F.z + F.rz * side * W, depth * 0.3, 1.1, Math.atan2(-F.tz, F.tx), { tag: 'post' });
}

// ------------------------------------------------------------------ live set dressing
/** Advertising blimp circling Electric Town. */
function blimp(track) {
  const g = new Geo(), sg = new Geo();
  g.set(rgb('#ece8f8'), 0, 0.05); g.sphere(0, 0, 0, 17, 5.4, 5.4, 16, 8);
  g.set(rgb('#ff2d6f'), 0, 0.3);
  for (const [y, z] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) g.box(-15, y, z, 4.5, y ? 3.4 : 0.3, z ? 3.4 : 0.3);
  g.set(rgb('#2a2446'), 0, 0); g.box(2, -5.6, 0, 6, 1.8, 2.4);
  g.set(rgb('#ffe23b'), 0, 1); g.box(2, -5.6, 0, 6.05, 0.4, 2.45);
  for (const side of [-1, 1]) addSign(sg, [1, 0.4, side * 5.1], 0, side, 20, 8.8, signUV('b', side > 0 ? 3 : 7), 1);
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(g.build({ color: true, emit: true }), track.materials.world));
  grp.add(new THREE.Mesh(sg.build({ color: true, emit: true, uv: true }), track.materials.sign));
  track.group.add(grp);
  const cx = 210, cz = 70, R = 230, w = (Math.PI * 2) / 110;
  track.updaters.push((dt, t) => {
    const a = t * w;
    grp.position.set(cx + Math.cos(a) * R, 88 + Math.sin(t * 0.3) * 2, cz + Math.sin(a) * R);
    grp.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
  });
}
