// Haruna Touge — sunset mountain pass: sakura switchbacks, torii tunnel on the
// ridge, a shrine, gutter-hook hairpins, rockslides and a lakeside finish.
import { Geo } from '../../geo/builder.js';
import { rgb } from '../build.js';
import { torii, stoneLantern, lantern, tree } from '../kit.js';
import { carvedTerrain, scatterTrees, water, propCluster, propLine, propAt } from '../scenery/common.js';
import { gutters, rollers, frame } from '../hazards.js';

const noise = (x, z) => Math.sin(x * 0.013) * Math.cos(z * 0.011) * 9 + Math.sin(x * 0.031 + z * 0.02) * 4 + Math.cos(z * 0.043 - x * 0.017) * 2.5;

export default {
  id: 'haruna',
  name: 'Haruna Touge',
  jp: '榛名峠',
  laps: 3,
  width: 16,
  music: 'eurobeat',
  seed: 8686,
  maxBank: 0.11,
  autoBank: 5,
  points: [
    [60, -3, 2, 16], [130, -5, 2], [180, 8, 3],
    [236, 2, 4], [272, -36, 7],
    [284, -100, 12],
    [262, -150, 16], [214, -160, 19], [184, -128, 21],
    [150, -84, 23], [104, -84, 26], [84, -124, 29],
    [104, -176, 32], [160, -226, 36], [234, -258, 40, 20],
    [312, -262, 42, 20], [384, -244, 42, 16],
    [440, -200, 40], [456, -140, 36], [430, -96, 33],
    [390, -104, 30], [376, -150, 27], [344, -168, 24],
    [320, -130, 21], [340, -84, 17], [380, -40, 13],
    [396, 20, 9], [360, 70, 6], [290, 84, 4],
    [200, 72, 3], [120, 62, 2], [40, 54, 2], [-24, 44, 2], [-54, 20, 2], [-40, -2, 2], [0, -4, 2],
  ],
  theme: {
    light: '#ffc38a', shadow: '#6a3f8a', sky: '#8a5aa0', ground: '#3a1f3a', rim: '#ff7a3a', fog: '#b0608a',
    skyTop: '#2a2a78', skyHorizon: '#ff8a5a', lightDir: [-0.7, 0.42, 0.3], fogNear: 140, fogFar: 900, rimStrength: 0.6, windowLit: 0.2,
    road: '#3a3448', line: '#fff4e0', center: '#ffe23b', gravel: '#8a6e62', grass: '#4f9a4a', guardrail: '#f4f2f8', post: '#a8a4b8',
    stars: 0.15, moonDir: [-0.85, 0.12, 0.35], moonColor: '#ffcf6a', moonSize: 0.11, sun: true, cloud: '#ff9aa0', ground: false,
    rumbleA: '#ff2d45', rumbleB: '#fff4e0', decks: false, dust: [0.75, 0.6, 0.5], padA: '#ffe23b', padB: '#ff2d6f', centerLine: true,
  },
  edges: [
    { from: 0, to: 1, both: { kind: 'guardrail', width: 2.4 } },
    { from: 0.83, to: 1, both: { kind: 'grass', width: 4, surface: 'grass' } },
    { from: 0, to: 0.05, both: { kind: 'grass', width: 4, surface: 'grass' } },
  ],
  itemRows: [0.12, 0.34, { u: 0.47, n: 5 }, 0.72, 0.92],
  boostPads: [{ u: 0.03, lat: 0 }, { u: 0.43, lat: 0, len: 10 }, { u: 0.8, lat: -3 }],
  ramps: [{ u: 0.765, lat: 0, w: 9, len: 9, h: 1.6 }],
  ambient: { kind: 'petals', rate: 30, color: [1, 0.72, 0.85] },
  scenery(track, chunks, rng) {
    const path = track.path;
    const L = path.length;
    // mountain: peak north-east, lake bowl to the south
    const terr = carvedTerrain(track, {
      res: 8, pad: 300, flat: 8, blend: 42, below: 1.1,
      base: (x, z) => {
        const peak = 95 * Math.exp(-(((x - 300) / 260) ** 2 + ((z + 230) / 220) ** 2));
        const ridge = 40 * Math.exp(-(((z + 330) / 160) ** 2));
        const lake = -18 * Math.exp(-(((x - 150) / 260) ** 2 + ((z - 190) / 110) ** 2));
        return peak + ridge + lake + noise(x, z) + 4;
      },
      color: (h, slope, x, z) => {
        if (h < 0.6) return rgb('#c9a07a');
        if (slope > 1.1) return rgb('#7a5a70');
        const n = Math.sin(x * 0.05) * Math.cos(z * 0.04);
        return n > 0.4 ? rgb('#5aa04a') : n < -0.5 ? rgb('#3f8a48') : rgb('#4c9648');
      },
    });
    track.terrain = terr;
    scatterTrees(track, terr, rng, { count: 420, tries: 5000, kinds: ['pine', 'pine', 'sakura', 'sakura', 'maple', 'round'], scale: 1.5, clear: 9, minY: 0.5 });
    scatterTrees(track, terr, rng, { count: 260, tries: 3000, kinds: ['sakura', 'sakura', 'maple', 'pine'], scale: 1.25, clear: 5.5, maxDist: 34, minY: 0.5 });
    // torii tunnel on the ridge
    for (let s = 0.395 * L; s < 0.47 * L; s += 6.5) {
      const F = frame(track, s);
      const i = path.indexAt(s);
      const w = (path.w[i] + 3.2) / 8.4;
      torii(chunks.W(s), F.x, F.y, F.z, F.ang, Math.max(1.05, w), Math.floor(s / 6.5) % 5 === 0 ? '#1a1418' : '#e8363c');
      const hw = path.w[i] / 2 + 1.6 * w;
      track.addCircle(F.x + F.rx * hw * 0.98, F.z + F.rz * hw * 0.98, 0.5);
      track.addCircle(F.x - F.rx * hw * 0.98, F.z - F.rz * hw * 0.98, 0.5);
    }
    shrine(track, chunks, 0.5, rng);
    lakeBridge(track, chunks, 0.055, 0.11);
    // stone lanterns & hanging lanterns along the ridge
    for (let s = 0.36 * L; s < 0.55 * L; s += 18) {
      const i = path.indexAt(s);
      for (const side of [-1, 1]) {
        const P = path.point(s, side * (path.w[i] / 2 + 3.4));
        stoneLantern(chunks.W(s), P.px, P.py, P.pz, 1.1);
      }
    }
    // hay bales on hairpin exits, tanuki by the shrine
    for (const [u, lat] of [[0.2, -9], [0.3, 9], [0.595, -9], [0.655, 9], [0.975, 9]]) propCluster(track, 'hay', u, lat, 3, 2.5, rng);
    propLine(track, 'tanuki', 0.49, 0.515, -9.5, 9);
    propLine(track, 'lantern', 0.4, 0.46, 11.5, 12);
    propLine(track, 'lantern', 0.4, 0.46, -11.5, 12);
    propAt(track, 'sign', 0.345 * L, 7);
    propAt(track, 'sign', 0.69 * L, -7);
    // distant mountains ring
    const g = new Geo();
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * Math.PI * 2;
      const r = 1300 + (k % 3) * 150;
      const x = 200 + Math.cos(a) * r, z = -100 + Math.sin(a) * r;
      const h = 160 + ((k * 37) % 9) * 30;
      g.set(rgb(k % 2 ? '#7a4a8a' : '#6a3f7a'), 0, 0);
      g.cyl([x, -20, z], [x, h, z], 260 + (k % 4) * 40, 20, 7, false);
      g.set(rgb('#ffe8f0'), 0, 0.2);
      g.cyl([x, h - 40, z], [x, h + 2, z], 50, 18, 7, false);
    }
    track.extra = (track.extra || []).concat([[g, 'world']]);
  },
  setup(track) {
    water(track, 0.2, '#3a5ab0', 1400, [150, 260]);
    gutters(track, [[0.195, 0.215, 0], [0.285, 0.305, 0], [0.585, 0.605, 0], [0.64, 0.66, 0], [0.97, 0.985, 0]].map(([a, b]) => {
      const k = track.path.k[track.path.indexAt(((a + b) / 2) * track.path.length)];
      return [a, b, k > 0 ? 1 : -1];
    }));
    rollers(track, [[0.355, 1, 0], [0.705, -1, 3.5]], { kind: 'rock', period: 8 });
  },
};

function shrine(track, chunks, u, rng) {
  const path = track.path;
  const s = u * path.length;
  const i = path.indexAt(s);
  const side = -1;
  const P = path.point(s, side * (track.limL[i] + 16));
  const F = frame(track, s);
  const g = chunks.W(s);
  const y = P.py;
  g.at([P.px, y, P.pz], [0, F.ang, 0], 1, (gg) => {
    gg.set(rgb('#9a96a0'), 0, 0); gg.box(0, 0.5, 0, 16, 1, 12);
    gg.set(rgb('#c93a3a'), 0, 0);
    for (const x of [-5, 5]) for (const z of [-3.5, 3.5]) gg.cyl([x, 1, z], [x, 6, z], 0.35, 0.35, 8, false);
    gg.set(rgb('#f4e8d8'), 0, 0); gg.box(0, 3.5, 0, 9, 4, 6);
    gg.set(rgb('#3a2a3a'), 0, 0); gg.box(0, 6.4, 0, 14, 0.6, 10, [0.72, 0.62]); gg.box(0, 7.6, 0, 10, 1.6, 6.4, [0.5, 0.4]);
    gg.set(rgb('#ffcf6a'), 0, 1); gg.box(0, 3, 3.02, 2, 2.4, 0.05);
    // pagoda behind
    for (let k = 0; k < 4; k++) {
      gg.set(rgb('#c93a3a'), 0, 0); gg.box(-14, 3 + k * 5, 0, 6 - k, 3.5, 6 - k);
      gg.set(rgb('#2a2030'), 0, 0); gg.box(-14, 5 + k * 5, 0, 9 - k * 1.2, 0.6, 9 - k * 1.2, [0.7, 0.7]);
    }
    gg.set(rgb('#ffcf6a'), 0, 1); gg.cyl([-14, 23, 0], [-14, 28, 0], 0.2, 0.05, 5, false);
  });
  for (let k = -2; k <= 2; k++) {
    const Q = path.point(s + k * 5, side * (track.limL[i] + 3));
    lantern(g, Q.px, Q.py + 3.2, Q.pz, k % 2 ? '#ff4f2e' : '#ffcf3a');
    g.set(rgb('#3a2a2a'), 0, 0); g.cyl([Q.px, Q.py, Q.pz], [Q.px, Q.py + 2.8, Q.pz], 0.06, 0.06, 4, false);
  }
  tree(g, P.px + 8, y, P.pz + 8, 'sakura', 2.2, rng);
  tree(g, P.px - 8, y, P.pz + 6, 'sakura', 2.0, rng);
}

function lakeBridge(track, chunks, u0, u1) {
  const path = track.path;
  const L = path.length;
  for (let s = u0 * L; s < u1 * L; s += 3) {
    const g = chunks.W(s);
    const i = path.indexAt(s);
    for (const side of [-1, 1]) {
      const lat = side * (path.w[i] / 2 + 1.2);
      const A = path.point(s, lat), B = path.point(s + 3, lat);
      g.set(rgb('#e8363c'), 0, 0.05);
      g.cyl([A.px, A.py + 1.1, A.pz], [B.px, B.py + 1.1, B.pz], 0.12, 0.12, 5, false);
      g.cyl([A.px, A.py, A.pz], [A.px, A.py + 1.25, A.pz], 0.14, 0.14, 5, false);
      g.set(rgb('#ffcf3a'), 0, 0.6); g.sphere(A.px, A.py + 1.35, A.pz, 0.16, 0.16, 0.16, 5, 3);
    }
    // underside arch
    const C = path.point(s, 0);
    const f = (s - u0 * L) / ((u1 - u0) * L);
    const archY = C.py - 1 - Math.sin(f * Math.PI) * 0 - 2.5 * (1 - Math.sin(f * Math.PI));
    g.set(rgb('#b02a30'), 0, 0);
    g.at([C.px, archY, C.pz], [0, Math.atan2(-C.tz, C.tx), 0], 1, (gg) => gg.box(0, 0, 0, 3.2, 0.6, path.w[i] + 2));
  }
}
