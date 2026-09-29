// Wangan Midnight — figure-eight expressway over the bay: flyover crossing,
// suspension bridge, toll plaza, underpass tunnel, traffic, construction jump.
import * as THREE from 'three';
import { Geo } from '../../geo/builder.js';
import { rgb } from '../build.js';
import { skyline, latticeTower, streetLamp, container } from '../kit.js';
import { propLine, propCluster, water } from '../scenery/common.js';
import { traffic, frame } from '../hazards.js';
import { toonMaterial } from '../../render/toon.js';
import { addSign, signUV } from '../../render/signs.js';

export default {
  id: 'wangan',
  name: 'Wangan Midnight',
  jp: '湾岸ミッドナイト',
  laps: 3,
  width: 22,
  music: 'synthwave',
  seed: 4242,
  maxBank: 0.09,
  points: [
    [0, 0, 15.0], [106, 122, 14.7], [202, 198, 13.8], [278, 198, 12.3], [327, 122, 10.5], [344, 0, 8.5], [327, -122, 6.5],
    [278, -198, 4.7], [202, -198, 3.2], [106, -122, 2.3], [0, 0, 2.0], [-106, 122, 2.3, 22], [-160, 178, 2.8, 34], [-202, 198, 3.2, 34], [-240, 202, 4, 22],
    [-278, 198, 4.7], [-327, 122, 6.5], [-344, 0, 8.5], [-327, -122, 10.5], [-278, -198, 12.3], [-202, -198, 13.8], [-106, -122, 14.7],
  ],
  theme: {
    light: '#ffcfa0', shadow: '#4a3f8a', sky: '#34306a', ground: '#16122a', rim: '#ff9a3a', fog: '#241c48',
    skyTop: '#05061a', skyHorizon: '#7a2a6a', poolK: 0.45, lightDir: [0.3, 0.75, 0.5], fogNear: 120, fogFar: 760, rimStrength: 0.55, windowLit: 0.5,
    road: '#2e2e46', line: '#f2eee0', center: '#ffb21e', barrier: '#c8c4d8', barrierStripe: '#ff9a1e', deck: '#3a3652', deckSide: '#5c5878', pillar: '#6e6a88',
    groundColor: '#15122a', ground: false, stars: 0.8, moonDir: [-0.6, 0.35, 0.7], moonSize: 0.075, cloud: '#2a1f55', rumble: false,
    tunnel: '#5a5068', tunnelLight: '#ff9a3a', tunnelStripe: '#ffb21e', padA: '#ffb21e', padB: '#ff2d6f', groundY: 0,
  },
  edges: [
    { from: 0, to: 1, both: { kind: 'barrier', width: 2.2, height: 1.1 } },
    { from: 0.56, to: 0.66, both: { kind: 'shoulder', width: 2.5, height: 1.0 } },
  ],
  tunnels: [[0.455, 0.545]],
  itemRows: [0.1, 0.36, { u: 0.61, n: 7 }, 0.86],
  boostPads: [{ u: 0.05, lat: -6 }, { u: 0.05, lat: 6 }, { u: 0.27, lat: 0, len: 12 }, { u: 0.5, lat: 0, len: 14 }, { u: 0.77, lat: 4 }],
  ramps: [{ u: 0.83, lat: -5, w: 8, len: 10, h: 1.9 }, { u: 0.83, lat: 5, w: 8, len: 10, h: 1.9 }],
  scenery(track, chunks, rng) {
    const path = track.path;
    const L = path.length;
    // tall sodium lamps on the median-side barrier
    for (let s = 5; s < L; s += 32) {
      const i = path.indexAt(s);
      if (track.edges.tunnel[i]) continue;
      for (const side of [-1, 1]) {
        if ((Math.round(s / 32) + (side > 0 ? 1 : 0)) % 2) continue;
        const lim = (side < 0 ? track.limL[i] : track.limR[i]) + 0.4;
        const P = path.point(s, side * lim);
        streetLamp({ world: chunks.W(s), glow: chunks.L(s) }, P.px, P.py + 1, P.pz, -side * P.rx, -side * P.rz, { h: 10, reach: 3.5, light: '#ffb45a', pole: '#8a86a0', groundY: P.py, pool: 10, poolK: 0.5 });
      }
    }
    // overhead gantry signs (green expressway signs)
    for (const u of [0.02, 0.2, 0.4, 0.7, 0.93]) {
      const s = u * L;
      const i = path.indexAt(s);
      const F = frame(track, s);
      const W = track.limL[i] + track.limR[i] + 1;
      const g = chunks.W(s);
      g.set(rgb('#8a86a0'), 0, 0);
      g.at([F.x, F.y, F.z], [0, F.ang, 0], 1, (gg) => {
        for (const z of [-W / 2, W / 2]) gg.box(0, 3.8, z, 0.5, 7.6, 0.5);
        gg.box(0, 7.6, 0, 0.5, 0.5, W);
        gg.set(rgb('#1f7a4a'), 0, 0); gg.box(-0.35, 6.4, -W / 4, 0.15, 2.2, W / 2.6); gg.box(-0.35, 6.4, W / 4, 0.15, 2.2, W / 2.6);
        gg.set([1, 1, 1], 0, 0.3); gg.box(-0.44, 6.9, -W / 4, 0.02, 0.35, W / 3.2); gg.box(-0.44, 6.0, -W / 4, 0.02, 0.25, W / 4); gg.box(-0.44, 6.9, W / 4, 0.02, 0.35, W / 3.2); gg.box(-0.44, 6.0, W / 4, 0.02, 0.25, W / 4);
      });
    }
    suspensionBridge(track, chunks, 0.2, 0.3);
    tollPlaza(track, chunks, 0.61, rng);
    // construction zone before the jump
    propLine(track, 'cone', 0.8, 0.84, 0, 7);
    propLine(track, 'barrier', 0.795, 0.82, -9, 8);
    propLine(track, 'barrier', 0.795, 0.82, 9, 8);
    propCluster(track, 'barrel', 0.845, 0, 5, 2, rng);
    // skyline, port and landmark
    const g = new Geo(), sg = new Geo();
    skyline(g, sg, null, rng, { cx: -300, cz: 0, r0: 520, r1: 1100, count: 120, hMin: 50, hMax: 220 });
    latticeTower(g, -700, -520, 230);
    // container port on the far bay shore
    for (let k = 0; k < 60; k++) container(g, 700 + (k % 10) * 14, 0, -300 + Math.floor(k / 10) * 3 * 40 + (k % 3) * 3, 0, ['#ff2d6f', '#2a8cff', '#ffb21e', '#56f06b', '#8a3dff'][k % 5]);
    track.extra = (track.extra || []).concat([[g, 'world'], [sg, 'sign']]);
    // big neon signs on rooftops beside the road
    for (const [u, side] of [[0.15, 1], [0.42, -1], [0.72, 1], [0.95, -1]]) {
      const s = u * L; const i = path.indexAt(s);
      const P = path.point(s, side * (track.limR[i] + 30));
      addSign(chunks.S(s), [P.px, P.py + 18, P.pz], -side * P.rx, -side * P.rz, 26, 11, signUV('b', Math.floor(rng() * 8)), 1);
      chunks.W(s).set(rgb('#2a2440'), 0, 0);
      chunks.W(s).at([P.px, 0, P.pz], [0, Math.atan2(-P.tz, P.tx), 0], 1, (gg) => { gg.box(0, (P.py + 12) / 2, 0, 3, P.py + 12, 3); });
    }
  },
  setup(track) {
    // land on the west, bay water on the east
    const land = new THREE.Mesh(new THREE.PlaneGeometry(2400, 3000), toonMaterial({ color: '#15122a', rim: 0 }));
    land.rotation.x = -Math.PI / 2; land.position.set(-1080, -0.05, 0);
    track.group.add(land);
    water(track, -1.2, '#0f2a58', 4000, [1500, 0]);
    traffic(track, { count: 12, speed: 26, lanes: [-0.62, -0.2, 0.2, 0.62] });
  },
};

function suspensionBridge(track, chunks, u0, u1) {
  const path = track.path;
  const L = path.length;
  const sA = u0 * L, sB = u1 * L;
  const g = chunks.W((sA + sB) / 2);
  const tower = (s) => {
    const i = path.indexAt(s);
    const F = frame(track, s);
    const W = track.limL[i] + track.limR[i] + 3;
    g.set(rgb('#e8e4f4'), 0, 0.1);
    g.at([F.x, 0, F.z], [0, F.ang, 0], 1, (gg) => {
      for (const z of [-W / 2 - 1, W / 2 + 1]) { gg.box(0, (F.y + 40) / 2, z, 3, F.y + 40, 3); }
      gg.box(0, F.y + 12, 0, 2.6, 2, W + 4); gg.box(0, F.y + 34, 0, 2.6, 2, W + 4);
      gg.set(rgb('#ff2d6f'), 0, 1); for (const z of [-W / 2 - 1, W / 2 + 1]) gg.box(0, F.y + 40.5, z, 1.2, 1, 1.2);
    });
    return { F, W };
  };
  const t1 = tower(sA + (sB - sA) * 0.2), t2 = tower(sA + (sB - sA) * 0.8);
  // main cables (sag between towers, drop toward the ends)
  for (const side of [-1, 1]) {
    let prev = null;
    for (let k = 0; k <= 40; k++) {
      const s = sA + ((sB - sA) * k) / 40;
      const f = k / 40;
      const i = path.indexAt(s);
      const P = path.point(s, side * ((track.limL[i] + track.limR[i] + 3) / 2 + 1));
      let hC;
      if (f < 0.2) hC = 40 * (f / 0.2);
      else if (f > 0.8) hC = 40 * ((1 - f) / 0.2);
      else { const x = (f - 0.5) / 0.3; hC = 8 + 32 * x * x; }
      const pt = [P.px, P.py + hC, P.pz];
      if (prev) { g.set(rgb('#f4f0ff'), 0, 0.3); g.cyl(prev, pt, 0.35, 0.35, 5, false); }
      // hangers
      if (k % 2 === 0 && hC > 2) { g.set(rgb('#bcb8d0'), 0, 0); g.cyl([P.px, P.py + 1, P.pz], pt, 0.06, 0.06, 3, false); }
      // rainbow light strings on the cable
      if (k % 2 === 1) { g.set(rgb(['#ff2d6f', '#ffe23b', '#20d8ff', '#56f06b', '#c93dff'][k % 5]), 0, 1); g.sphere(pt[0], pt[1] + 0.4, pt[2], 0.45, 0.45, 0.45, 5, 3); }
      prev = pt;
    }
  }
  void t1; void t2;
}

function tollPlaza(track, chunks, u, rng) {
  const path = track.path;
  const s = u * path.length;
  const i = path.indexAt(s);
  const hw = path.w[i] / 2;
  const F = frame(track, s);
  const g = chunks.W(s), sg = chunks.S(s);
  const booths = 4;
  // canopy
  g.set(rgb('#3a3656'), 0, 0);
  g.at([F.x, F.y, F.z], [0, F.ang, 0], 1, (gg) => {
    gg.box(0, 7.2, 0, 10, 0.8, hw * 2 + 6);
    gg.set(rgb('#20d8ff'), 0, 1); gg.box(-5.02, 6.9, 0, 0.05, 0.25, hw * 2 + 6); gg.box(5.02, 6.9, 0, 0.05, 0.25, hw * 2 + 6);
  });
  for (let k = 0; k < booths; k++) {
    const lat = -hw + ((k + 1) * (hw * 2)) / (booths + 1);
    const P = path.point(s, lat);
    g.set(rgb('#e8e4f4'), 0, 0);
    g.at([P.px, P.py, P.pz], [0, F.ang, 0], 1, (gg) => {
      gg.box(0, 0.25, 0, 7, 0.5, 2.2);
      gg.set(rgb('#ffe23b'), 0, 0.2); gg.box(3.4, 0.6, 0, 0.3, 1.2, 2.2);
      gg.set(rgb('#dcd6ee'), 0, 0); gg.box(0, 1.7, 0, 2.2, 2.6, 1.6);
      gg.set(rgb('#9fe8ff'), 0, 0.6); gg.box(0, 2.1, 0.81, 1.8, 1.0, 0.02); gg.box(0, 2.1, -0.81, 1.8, 1.0, 0.02);
      gg.set(rgb('#ff2d6f'), 0, 0.2); gg.box(0, 3.1, 0, 2.4, 0.2, 1.8);
      gg.set(rgb('#8a86a0'), 0, 0); gg.box(0, 5, 0, 0.4, 4.4, 0.4);
    });
    addSign(sg, [P.px - F.tx * 0.2, P.py + 6.1, P.pz - F.tz * 0.2], -F.tx, -F.tz, 3.2, 1.1, signUV('h', k % 2 ? 13 : 12), 1);
    // rounded island (chain of circles) so glancing cars slide off instead of stopping dead
    for (const a of [-2.6, -0.9, 0.9, 2.6]) track.addCircle(P.px + F.tx * a, P.pz + F.tz * a, 1.05, { tag: 'booth', bounce: 0.2 });
  }
  // AI: line up with a toll lane (gap centres between booths) on approach
  const gaps = Array.from({ length: booths + 1 }, (_, k) => -hw + ((k + 0.5) * (hw * 2)) / (booths + 1));
  const prev = track.aiLaneBias;
  track.aiLaneBias = (ss, latT) => {
    let b = prev ? prev(ss, latT) : 0;
    const ds = path.delta(ss, s);
    if (ds > -5 && ds < 70) {
      const t = latT + b;
      const gp = gaps.reduce((a, x) => (Math.abs(x - t) < Math.abs(a - t) ? x : a));
      b += (gp - t) * (ds < 40 ? 1 : 0.6);
    }
    return b;
  };
  void rng;
}
