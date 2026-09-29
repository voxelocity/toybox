// Kaiju Harbor — stormy container port. Crane drops on the quay, a pier loop
// out into the bay (where something enormous surfaces), a drawbridge jump,
// a warehouse drive-through and container canyons.
import * as THREE from 'three';
import { Geo } from '../../geo/builder.js';
import { rgb } from '../build.js';
import { container, streetLamp, skyline, groundGlow } from '../kit.js';
import { water, propCluster, propLine, propAt } from '../scenery/common.js';
import { craneDrop, drawbridge, kaiju, frame } from '../hazards.js';
import { toonMaterial } from '../../render/toon.js';
import { addSign, signUV } from '../../render/signs.js';

const CCOLS = ['#ff2d6f', '#2a8cff', '#ffb21e', '#56f06b', '#8a3dff', '#e8e4f4', '#ff8a1e', '#1ee89c'];

export default {
  id: 'harbor',
  name: 'Kaiju Harbor',
  jp: '怪獣港',
  laps: 3,
  // flat city streets: banking would sink the inside edge under the ground/dock slabs
  maxBank: 0.02,
  width: 20,
  music: 'dnb',
  seed: 5150,
  points: [
    [60, 0, 1.5, 20], [120, 0], [200, 0],
    [245, 18], [262, 60],
    [262, 140], [262, 215],
    [246, 258], [204, 274], [164, 252],
    [152, 196], [150, 136], [138, 84],
    [106, 54], [56, 46],
    [0, 46, 1.5], [-60, 48, 1.5],
    [-122, 38], [-168, 6],
    [-186, -44], [-182, -104],
    [-150, -142], [-94, -152],
    [-54, -136], [-24, -150], [6, -138], [36, -150],
    [66, -130], [70, -84], [40, -48],
    [-6, -44], [-40, -30], [-40, -8], [-16, 0], [14, 0],
  ],
  theme: {
    light: '#b8f0e0', shadow: '#2f4a6a', sky: '#1f4a5a', ground: '#0a1418', rim: '#40f0ff', fog: '#16303a',
    skyTop: '#040c12', skyHorizon: '#1f5a5a', lightDir: [0.4, 0.8, -0.2], fogNear: 70, fogFar: 520, rimStrength: 0.65, windowLit: 0.35,
    road: '#2a3238', line: '#e8f4f0', center: '#ffd23f', concrete: '#6a7478', quayEdge: '#ffd23f', quayWall: '#3a4448', bollard: '#1a2226',
    fence: '#a8b4bc', fenceMesh: '#56646c', barrier: '#c8d0d4', barrierStripe: '#ffd23f', groundColor: '#1a2226', ground: false,
    stars: 0, moonDir: [0.3, 0.3, 0.9], moonColor: '#d8fff4', moonSize: 0.05, cloud: '#123a42', rumble: false,
    tunnel: '#5a5448', tunnelRoof: '#3a3630', tunnelLight: '#e8f4ff', tunnelStripe: '#ffd23f', tunnelHeight: 9, padA: '#40f0ff', padB: '#56f06b',
    decks: false, groundY: 0,
  },
  edges: [
    { from: 0, to: 1, both: { kind: 'fence', width: 3, surface: 'concrete' } },
    { from: 0, to: 0.13, right: { kind: 'quay', width: 3, surface: 'concrete' } },
    { from: 0.13, to: 0.44, both: { kind: 'quay', width: 3, surface: 'concrete' } },
    { from: 0.44, to: 0.6, left: { kind: 'quay', width: 3, surface: 'concrete' } },
  ],
  tunnels: [[0.625, 0.685]],
  itemRows: [0.08, { u: 0.3, n: 5 }, 0.5, 0.715, 0.905],
  boostPads: [{ u: 0.02, lat: 0 }, { u: 0.2, lat: -4 }, { u: 0.4, lat: 4 }, { u: 0.51, lat: 0, len: 10 }, { u: 0.875, lat: 0 }],
  ambient: { kind: 'rain', rate: 260 },
  scenery(track, chunks, rng) {
    const path = track.path;
    const L = path.length;
    // dock slabs (concrete ground) north of the waterfront, with a canal cut for the drawbridge
    const g = new Geo();
    g.set(rgb('#3a4448'), 0, 0);
    const slab = (x0, x1, z0, z1) => { g.box((x0 + x1) / 2, 0.55, (z0 + z1) / 2, x1 - x0, 1.9, z1 - z0); };
    slab(-600, -40, -700, 30); slab(-40, 10, -700, 20); slab(10, 320, -700, 30);
    slab(-600, -30, 30, 72); slab(12, 130, 30, 72);
    // pier decks under the loop (piles)
    g.set(rgb('#4a5458'), 0, 0);
    for (let s = 0.13 * L; s < 0.44 * L; s += 12) {
      const P = path.point(s, 0);
      const i = path.indexAt(s);
      g.at([P.px, 0, P.pz], [0, Math.atan2(-P.tz, P.tx), 0], 1, (gg) => { gg.box(0, 0.1, 0, 12.5, 2.8, path.w[i] + 6); for (const z of [-path.w[i] / 2 - 2, 0, path.w[i] / 2 + 2]) gg.cyl([0, -4, z], [0, 0, z], 0.6, 0.6, 6, false); });
    }
    track.extra = (track.extra || []).concat([[g, 'world']]);
    // container canyons along fence edges (stacks behind the fence)
    for (let s = 3; s < L; s += 13.5) {
      const i = path.indexAt(s);
      if (track.edges.tunnel[i]) continue;
      for (const side of [-1, 1]) {
        const e = side < 0 ? track.edges.L[i] : track.edges.R[i];
        if (e.kind !== 'fence') continue;
        if (rng() < 0.18) continue;
        const lim = side < 0 ? track.limL[i] : track.limR[i];
        const P = path.point(s, side * (lim + 3.2));
        const ang = Math.atan2(-P.tz, P.tx);
        const n = 1 + Math.floor(rng() * 3.2);
        for (let k = 0; k < n; k++) container(chunks.W(s), P.px, 1.45 + k * 2.6, P.pz, ang, CCOLS[Math.floor(rng() * CCOLS.length)]);
        if (rng() < 0.3) container(chunks.W(s), P.px - side * P.rx * 2.6, 1.45, P.pz - side * P.rz * 2.6, ang, CCOLS[Math.floor(rng() * CCOLS.length)]);
      }
    }
    // quay lamps
    for (let s = 8; s < L; s += 28) {
      const i = path.indexAt(s);
      if (track.edges.tunnel[i]) continue;
      const side = (Math.round(s / 28) % 2) ? 1 : -1;
      const lim = side < 0 ? track.limL[i] : track.limR[i];
      const P = path.point(s, side * (lim - 0.4));
      streetLamp({ world: chunks.W(s), glow: chunks.L(s) }, P.px, P.py, P.pz, -side * P.rx, -side * P.rz, { h: 11, reach: 2, light: '#d8fff4', pole: '#56646c', groundY: P.py, pool: 8, poolK: 0.35 });
    }
    warehouse(track, chunks, 0.625, 0.685);
    // cargo ship moored off the pier
    const sg = new Geo();
    sg.at([420, -1, 120], [0, 0.3, 0], 1, (gg) => {
      gg.set(rgb('#2a3a4a'), 0, 0); gg.box(0, 5, 0, 140, 12, 26, [0.95, 0.9]);
      gg.set(rgb('#c83a3a'), 0, 0); gg.box(0, -0.5, 0, 141, 2, 26.5);
      gg.set(rgb('#e8e4f4'), 0, 0); gg.box(-55, 18, 0, 18, 14, 20);
      gg.set(rgb('#ffe8a0'), 0, 0.8); for (let k = 0; k < 4; k++) gg.box(-45.9, 13 + k * 3, 0, 0.1, 1, 16);
      for (let k = 0; k < 30; k++) container(gg, -30 + (k % 10) * 13, 11 + Math.floor(k / 10) * 2.6, -8 + (k % 3) * 8, 0, CCOLS[k % CCOLS.length]);
    });
    track.extra.push([sg, 'world']);
    // distant city + neon
    const cg = new Geo(), csg = new Geo();
    skyline(cg, csg, null, rng, { cx: 40, cz: 40, r0: 720, r1: 1200, count: 80, hMin: 40, hMax: 180, colors: ['#1f3a44', '#24404a', '#1a3038'] });
    track.extra.push([cg, 'world'], [csg, 'sign']);
    for (const [u, side] of [[0.05, -1], [0.58, 1], [0.8, 1]]) {
      const s = u * L, i = path.indexAt(s);
      const P = path.point(s, side * ((side < 0 ? track.limL[i] : track.limR[i]) + 12));
      addSign(chunks.S(s), [P.px, 16, P.pz], -side * P.rx, -side * P.rz, 20, 8.8, signUV('b', [6, 0, 3][Math.floor(rng() * 3)]), 1);
    }
    // props
    for (const [u, lat, t, n] of [[0.06, -7, 'crate', 5], [0.14, 7, 'barrel', 5], [0.32, -6, 'crate', 6], [0.47, 7, 'box', 6], [0.6, 7, 'barrel', 4], [0.74, -6, 'crate', 5], [0.83, 6, 'box', 6], [0.92, -7, 'barrel', 5]]) propCluster(track, t, u, lat, n, 2.5, rng);
    propLine(track, 'cone', 0.5, 0.52, -6, 4);
    propLine(track, 'cone', 0.5, 0.52, 6, 4);
    propLine(track, 'barrier', 0.535, 0.545, -9.5, 3);
    propAt(track, 'sign', 0.49 * L, 0);
  },
  setup(track) {
    water(track, -0.6, '#123a4a', 5000, [0, 0]);
    craneDrop(track, [[0.045, -4.5, 0], [0.095, 4.5, 3.4], [0.24, 0, 1.7], [0.79, -3, 5]], { period: 8.5, color: '#ff8a1e' });
    drawbridge(track, 0.525, 26, { period: 15, angle: 0.25, offset: 2 });
    kaiju(track, [470, -8, 330], { face: -2.4, scale: 1.3, period: 24, color: '#2f5a4a', glow: '#40f0ff' });
    // storm lightning
    let next = 6;
    track.updaters.push((dt, t, race) => {
      if (!race || t < next) return;
      next = t + 9 + Math.random() * 10;
      const f = race.view.post.fx;
      f.uFlash.value = 0.55; f.uFlashColor.value.setRGB(0.85, 1, 1);
      setTimeout(() => { f.uFlash.value = 0.35; }, 120);
      race.audio?.noise(1.6, { type: 'lowpass', f: 400, sweep: 60, vol: 0.5, t: 0.35 });
    });
  },
};

function warehouse(track, chunks, u0, u1) {
  const path = track.path;
  const L = path.length;
  // corrugated shell outside the tunnel + roof sign; crates inside
  for (let s = u0 * L; s < u1 * L; s += 4) {
    const i = path.indexAt(s);
    const F = frame(track, s);
    const W = track.limL[i] + track.limR[i];
    const g = chunks.W(s);
    g.set(rgb((Math.floor(s / 4) % 2) ? '#5a6a70' : '#52626a'), 0, 0);
    g.at([F.x, F.y, F.z], [0, F.ang, 0], 1, (gg) => { gg.box(0, 10.8, 0, 4.1, 1.2, W + 6, [1, 0.7]); });
  }
  const s0 = u0 * L;
  const F = frame(track, s0);
  addSign(chunks.S(s0), [F.x - F.tx * 1.2, F.y + 12.5, F.z - F.tz * 1.2], -F.tx, -F.tz, 14, 3.4, signUV('h', 13), 1);
  for (let k = 0; k < 6; k++) propCluster(track, k % 2 ? 'crate' : 'box', u0 + ((u1 - u0) * (k + 0.5)) / 6, (k % 2 ? 1 : -1) * 7, 3, 1.5);
}
