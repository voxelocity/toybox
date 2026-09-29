// Shibuya Scramble — neon downtown street circuit.
import { cityDressing, crosswalk } from '../scenery/city.js';
import { propLine, propCluster, sidewalkProps } from '../scenery/common.js';
import { levelCrossing, viaduct, frame } from '../hazards.js';
import { building, spotGlow } from '../kit.js';
import { addSign, signUV } from '../../render/signs.js';
import { rgb } from '../build.js';

export default {
  id: 'shibuya',
  name: 'Shibuya Scramble',
  jp: '渋谷スクランブル',
  laps: 3,
  // flat city streets: banking would sink the inside edge under the ground/dock slabs
  maxBank: 0.02,
  width: 20,
  music: 'citypop',
  seed: 88,
  points: [
    [60, 0, 0, 20], [120, 0], [170, 0],
    [208, 10], [226, 42],
    [230, 95], [232, 150, 0, 24],
    [232, 195, 0, 34], [232, 235, 0, 34],
    [236, 272, 0, 22], [258, 302, 0, 20],
    [305, 316], [385, 318], [440, 320],
    [480, 334, 0, 19], [494, 366], [478, 396], [438, 406],
    [380, 402], [320, 398], [268, 412],
    [226, 440], [178, 452], [122, 450],
    [80, 432], [56, 400, -3], [44, 352, -7],
    [42, 300, -7], [46, 252, -3], [58, 208, 0],
    [54, 166], [30, 134], [30, 98], [10, 66],
    [-12, 38], [-10, 12], [12, 0],
  ],
  theme: {
    light: '#c3c8ff', shadow: '#4b3d82', sky: '#2c2258', ground: '#140c22', rim: '#ff3fa4', fog: '#1d1238',
    skyTop: '#05030f', skyHorizon: '#7a2474', lightDir: [-0.45, 0.8, -0.35], fogNear: 90, fogFar: 560, rimStrength: 0.6, windowLit: 0.42,
    road: '#2c2b42', roadEdge: '#25243a', line: '#ecebff', sidewalk: '#6c6690', curb: '#c4bee0', rail: '#e9e6f4', barrier: '#cfcbe0',
    groundColor: '#1c1730', stars: 0.5, moonDir: [0.5, 0.42, -0.75], cloud: '#3c1848', centerLine: true,
    tunnel: '#4d4868', tunnelLight: '#ffb65c', tunnelStripe: '#ff2d6f', deck: '#3d3856', padA: '#20d8ff', padB: '#ff2d6f',
  },
  edges: [
    { from: 0, to: 1, both: { kind: 'sidewalk', width: 4.5 } },
    { from: 0.19, to: 0.27, both: { kind: 'open', width: 9, surface: 'pave', lift: 0.02 } },
    { from: 0.735, to: 0.87, both: { kind: 'barrier', width: 2.2, height: 1.1 } },
  ],
  tunnels: [[0.765, 0.84]],
  itemRows: [0.11, { u: 0.3, n: 5 }, 0.52, { u: 0.745, n: 4 }, 0.93],
  boostPads: [{ u: 0.035, lat: -5 }, { u: 0.035, lat: 5 }, { u: 0.275, lat: 0 }, { u: 0.455, lat: -3 }, { u: 0.8, lat: 0, len: 12 }],
  ramps: [{ u: 0.232, lat: 11, w: 7, len: 8, h: 1.5 }],
  scenery(track, chunks, rng) {
    cityDressing(track, chunks, rng, {
      hMin: 12, hMax: 70, intersections: [0.07, 0.955], footbridges: [0.14, 0.64],
      gaps: [[0.72, 0.88], [0.575, 0.605]], trees: 'round', landmark: [260, -420, 210],
    });
    scramble(track, chunks, rng);
    sidewalkProps(track, rng, ['vending', 'trash', 'sign', 'trash', 'box'], 20);
    // chicane cones and the hairpin crates
    propLine(track, 'cone', 0.875, 0.92, -8.5, 5);
    propLine(track, 'cone', 0.9, 0.94, 8.5, 5);
    propCluster(track, 'crate', 0.43, 8, 6, 2.5, rng);
    propCluster(track, 'barrel', 0.445, -8, 5, 2.5, rng);
    propLine(track, 'barrier', 0.735, 0.75, -7, 7);
  },
  setup(track) {
    viaduct(track, 0.365, { height: 10, period: 13, trainColor: '#56f06b' });
    viaduct(track, 0.66, { height: 11, period: 17, offset: 5, trainColor: '#ff8a1e' });
    levelCrossing(track, 0.59, { period: 22, cross: 4, warn: 3, offset: 9, color: '#ffe23b', cars: 3 });
  },
};

// The scramble: X crosswalks, giant screens, a tower and the statue island
function scramble(track, chunks, rng) {
  const path = track.path;
  const L = path.length;
  const sC = 0.232 * L;
  const g = chunks.W(sC), sg = chunks.S(sC), gl = chunks.L(sC);
  const C = frame(track, sC);
  // diagonal zebra (X) across the plaza
  g.set([0.93, 0.93, 0.98], 0, 0.25);
  for (const dirSign of [-1, 1]) {
    // band direction d (diagonal), stripes spaced along it, each spanning p
    let dx = C.tx + C.rx * dirSign, dz = C.tz + C.rz * dirSign;
    const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
    const px = -dz, pz = dx;
    for (let k = -9; k <= 9; k++) {
      if (Math.abs(k) < 2) continue;
      const cx = C.x + dx * k * 1.6, cz = C.z + dz * k * 1.6;
      const w = 2.4, l = 0.5;
      const P = (a, b) => [cx + px * a + dx * b, C.y + 0.018, cz + pz * a + dz * b];
      g.quad(P(-w, -l), P(w, -l), P(w, l), P(-w, l));
    }
  }
  crosswalk(track, chunks, sC - 22);
  crosswalk(track, chunks, sC + 22);
  // statue island
  const sx = C.x, sz = C.z;
  g.set(rgb('#8a84a8'), 0, 0); g.cyl([sx, C.y, sz], [sx, C.y + 0.5, sz], 3.2, 3.4, 16, true);
  g.set(rgb('#56f06b'), 0, 0.2); g.cyl([sx, C.y + 0.5, sz], [sx, C.y + 0.62, sz], 3.0, 3.0, 16, true);
  g.set(rgb('#5a5470'), 0, 0); g.cbox(sx, C.y + 1.6, sz, 1.8, 2.0, 1.2, 0.2);
  // loyal dog statue (bronze)
  g.set(rgb('#b98a4a'), 0, 0.05);
  g.at([sx, C.y + 2.6, sz], [0, C.ang, 0], 1, (gg) => {
    gg.sphere(0, 0.45, 0, 0.8, 0.45, 0.35, 8, 5);
    gg.sphere(0.72, 0.95, 0, 0.32, 0.3, 0.28, 8, 5);
    gg.box(0.95, 0.9, 0, 0.3, 0.18, 0.2);
    for (const z of [-0.18, 0.18]) { gg.box(0.62, 1.22, z, 0.1, 0.2, 0.1); }
    for (const x of [-0.5, 0.5]) for (const z of [-0.2, 0.2]) gg.box(x, 0.0, z, 0.14, 0.5, 0.14);
    gg.cyl([-0.75, 0.55, 0], [-1.0, 0.95, 0], 0.08, 0.05, 5, false);
  });
  track.addCircle(sx, sz, 3.4, { tag: 'statue' });
  // plaza buildings: the tower and the giant-screen block
  for (const [side, du, w, d, h, style] of [[1, -0.012, 16, 16, 58, 'tower'], [-1, -0.006, 24, 18, 44, 'screens'], [1, 0.02, 22, 16, 36, 'screens'], [-1, 0.022, 18, 16, 64, 'screens']]) {
    const s = sC + du * L;
    const i = path.indexAt(s);
    const lat = side * (track.limR[i] + 4 + d * 0.1);
    const P = path.point(s, lat);
    const fx = -side * P.rx, fz = -side * P.rz;
    const sinks = { world: chunks.W(s), signs: chunks.S(s), glow: chunks.L(s) };
    if (style === 'tower') {
      // cylindrical fashion tower
      const cx = P.px - fx * 8, cz = P.pz - fz * 8;
      g.uvMode = (p, n) => (Math.abs(n.y) > 0.5 ? [0, 0] : [Math.atan2(p.z - cz, p.x - cx) * 8, p.y - 4.5]);
      g.set(rgb('#d8d4e8'), 0, 0); g.cyl([cx, 0, cz], [cx, h, cz], 8, 8, 20, true);
      g.uvMode = null;
      g.set(rgb('#ff2d6f'), 0, 1); g.cyl([cx, h - 6, cz], [cx, h - 2, cz], 8.15, 8.15, 20, false);
      addSign(sg, [cx + fx * 8.3, h - 4, cz + fz * 8.3], fx, fz, 7, 3.2, signUV('h', 29), 1);
      track.addCircle(cx, cz, 8, { tag: 'building' });
    } else {
      building(sinks, P.px, P.pz, fx, fz, { w, d, h, color: ['#3a3656', '#443a66'][Math.floor(rng() * 2)], rng, storefront: true, vertChance: 0.3, boardChance: 0 });
      track.addBox(P.px - fx * d / 2, P.pz - fz * d / 2, d / 2, w / 2, Math.atan2(-fz, fx), { tag: 'building' });
      // giant video screens stacked on the facade
      for (let k = 0; k < 2; k++) {
        const bw = w * 0.82, bh = bw * 0.44;
        const y = 10 + k * (bh + 2.5);
        if (y + bh / 2 > h - 2) break;
        addSign(sg, [P.px + fx * 0.3, y + bh / 2, P.pz + fz * 0.3], fx, fz, bw, bh, signUV('b', Math.floor(rng() * 8)), 1);
        spotGlow(gl, [P.px + fx * 2, y + bh / 2, P.pz + fz * 2], bw * 0.6, [0.35, 0.25, 0.55]);
      }
    }
  }
}
