// Generic neon-city dressing: building rows that follow the street, shop
// fronts, signs, lamps, utility poles with sagging wires, crosswalks, side
// street stubs with barricades, footbridges and a far skyline.
import { building, streetLamp, utilityPole, wire, tree, skyline, facadeUV, groundGlow, latticeTower, mix } from '../kit.js';
import { rgb } from '../build.js';
import { Geo } from '../../geo/builder.js';

/**
 * opts: {
 *   palette: [facade colours], hMin, hMax, gaps: [[u0,u1,side?]], lamps: true, noLamps: [[u0,u1]], poles: true,
 *   hSigns / vSigns: preferred sign atlas cells,
 *   intersections: [u], footbridges: [u], skyline: {...}, setback: metres, landmark: {x,z}
 * }
 */
export function cityDressing(track, chunks, rng, o = {}) {
  const path = track.path;
  const L = path.length;
  const N = path.N;
  const pal = o.palette || ['#4b4470', '#5a4a78', '#3f4a6e', '#6a5480', '#4f5a78', '#71507a', '#3d3a5c', '#5c6480'];
  const inGap = (u, side) => (o.gaps || []).some(([a, b, sd]) => (sd == null || sd === side) && ((u >= a && u <= b) || (a > b && (u >= a || u <= b))));
  const isInter = (u) => (o.intersections || []).some((iu) => Math.abs(path.delta(iu * L, u * L)) < 14);

  // corridor check: world point must stay clear of the road area everywhere
  const clear = (x, z, margin) => {
    const p = path.project(x, z, -1);
    const lim = p.lat < 0 ? track.limL[p.i] : track.limR[p.i];
    return Math.abs(p.lat) > lim + margin;
  };

  // ------------------------------------------------ buildings
  for (const side of [-1, 1]) {
    let s = rng() * 8;
    while (s < L - 4) {
      const u = s / L;
      const i = path.indexAt(s);
      const e = side < 0 ? track.edges.L[i] : track.edges.R[i];
      if (inGap(u, side) || isInter(u) || e.kind === 'open' || e.noBuildings || track.edges.tunnel[i]) { s += 5; continue; }
      const front = 9 + rng() * 13;
      const sc = s + front / 2;
      const ic = path.indexAt(sc);
      const lim = side < 0 ? track.limL[ic] : track.limR[ic];
      const setback = (o.setback ?? 1.4) + rng() * 0.8;
      const lat = side * (lim + setback + 0.55);
      const P = path.point(sc, lat);
      const fx = -side * P.rx, fz = -side * P.rz;
      const depth = 12 + rng() * 16;
      let h = (o.hMin ?? 10) + Math.pow(rng(), 1.7) * ((o.hMax ?? 60) - (o.hMin ?? 10));
      if (o.heightAt) h = o.heightAt(u, side, h, rng, P.px - fx * depth / 2, P.pz - fz * depth / 2);
      // footprint corners (front corners + back corners)
      const tx = P.tx, tz = P.tz;
      const corners = [
        [P.px + tx * front / 2, P.pz + tz * front / 2], [P.px - tx * front / 2, P.pz - tz * front / 2],
        [P.px + tx * front / 2 - fx * depth, P.pz + tz * front / 2 - fz * depth], [P.px - tx * front / 2 - fx * depth, P.pz - tz * front / 2 - fz * depth],
        [P.px - fx * depth * 0.5, P.pz - fz * depth * 0.5],
      ];
      if (!corners.every(([x, z]) => clear(x, z, 0.3))) { s += 4; continue; }
      const sinks = { world: chunks.W(sc), signs: chunks.S(sc), glow: chunks.L(sc) };
      const baseY = (o.groundY ?? track.theme.groundY ?? 0) + (P.py > 0.5 || P.py < -0.5 ? 0 : P.py);
      building(sinks, P.px, P.pz, fx, fz, {
        w: front, d: depth, h, color: pal[Math.floor(rng() * pal.length)], rng, y: Math.min(baseY, P.py),
        vertChance: o.vertChance ?? 0.8, boardChance: o.boardChance ?? 0.4, storefront: o.storefront ?? true,
        hSigns: o.hSigns, vSigns: o.vSigns, shopGlow: o.shopGlow,
      });
      track.addBox(P.px - fx * depth / 2, P.pz - fz * depth / 2, depth / 2, front / 2, Math.atan2(-fz, fx), { tag: 'building' });
      s += front + rng() * 1.2;
    }
  }

  // ------------------------------------------------ lamps / poles / trees
  let lastPole = [null, null];
  for (let s = 6; s < L; s += 13) {
    const i = path.indexAt(s);
    const u = s / L;
    const tun = track.edges.tunnel[i];
    if (tun) { lastPole = [null, null]; continue; }
    const hw = path.w[i] / 2;
    for (const side of [-1, 1]) {
      const e = side < 0 ? track.edges.L[i] : track.edges.R[i];
      if (e.kind !== 'sidewalk' && e.kind !== 'open' && e.kind !== 'barrier') { lastPole[side < 0 ? 0 : 1] = null; continue; }
      const k = Math.round(s / 13);
      const sinks = { world: chunks.W(s), signs: chunks.S(s), glow: chunks.L(s) };
      const lift = e.lift || 0;
      const noLamp = (o.noLamps || []).some(([a, b]) => u >= a && u <= b);
      if (o.lamps !== false && !noLamp && (k + (side > 0 ? 1 : 0)) % 2 === 0) {
        const P = path.point(s, side * (hw + 0.7));
        const lc = o.lampColor || (k % 4 === 0 ? '#ffd9a0' : '#bfe8ff');
        streetLamp(sinks, P.px, P.py + lift, P.pz, -side * P.rx, -side * P.rz, { light: lc, groundY: P.py, pool: 7 });
        track.addCircle(P.px, P.pz, 0.35, { tag: 'lamp' });
      }
      if (o.poles !== false && e.kind === 'sidewalk' && side === (o.poleSide ?? 1) && k % 3 === 0 && !inGap(u, side) && !isInter(u)) {
        const lim = side < 0 ? track.limL[i] : track.limR[i];
        const P = path.point(s, side * (lim + 0.2));
        const top = utilityPole(sinks.world, P.px, P.py + lift, P.pz, Math.atan2(-P.tz, P.tx));
        const idx = side < 0 ? 0 : 1;
        if (lastPole[idx]) {
          for (const dz of [-1.0, 0, 1.0]) {
            const a = [lastPole[idx][0] + P.rx * dz, lastPole[idx][1], lastPole[idx][2] + P.rz * dz];
            const b = [top[0] + P.rx * dz, top[1], top[2] + P.rz * dz];
            wire(sinks.world, a, b, 0.9, 5, 0.03);
          }
          // cross-street wire every so often
          if (k % 9 === 0) {
            const Q = path.point(s, -side * (hw + 2));
            wire(sinks.world, top, [Q.px, top[1] - 0.5, Q.pz], 1.2, 6, 0.025);
          }
        }
        lastPole[idx] = top;
      } else if (k % 3 === 0) lastPole[side < 0 ? 0 : 1] = null;
      if (o.trees && e.kind === 'sidewalk' && (k + 2) % 5 === 0) {
        const P = path.point(s + 4, side * (hw + 2.4));
        tree(sinks.world, P.px, P.py + lift, P.pz, o.trees, 0.8, rng);
        track.addCircle(P.px, P.pz, 0.45, { tag: 'tree' });
      }
    }
  }

  // ------------------------------------------------ intersections: crosswalks + side streets
  for (const iu of o.intersections || []) {
    const s0 = iu * L;
    crosswalk(track, chunks, s0 - 9);
    crosswalk(track, chunks, s0 + 9);
    for (const side of [-1, 1]) sideStreet(track, chunks, s0, side, rng);
    trafficLights(track, chunks, s0);
  }
  for (const fu of o.footbridges || []) footbridge(track, chunks, fu * L);

  // ------------------------------------------------ skyline
  if (o.skyline !== false) {
    let cx = 0, cz = 0;
    for (let i = 0; i < N; i += 10) { cx += path.px[i]; cz += path.pz[i]; }
    cx /= N / 10; cz /= N / 10;
    const g = new Geo(), sg = new Geo();
    skyline(g, sg, null, rng, { cx, cz, r0: 420, r1: 900, count: 110, hMin: 40, hMax: 190, ...(o.skyline || {}) });
    if (o.landmark) latticeTower(g, cx + o.landmark[0], cz + o.landmark[1], o.landmark[2] ?? 200);
    track.extra = track.extra || [];
    track.extra.push([g, 'world'], [sg, 'sign']);
  }
}

export function crosswalk(track, chunks, s) {
  const path = track.path;
  const g = chunks.W(s);
  const i = path.indexAt(s);
  const hw = path.w[i] / 2;
  g.set([0.92, 0.92, 0.98], 0, 0.25);
  for (let l = -hw + 0.8; l < hw - 0.8; l += 1.6) {
    const a = path.point(s - 2.5, l), b = path.point(s - 2.5, l + 0.8), c = path.point(s + 2.5, l + 0.8), d = path.point(s + 2.5, l);
    g.quad([a.px, a.py + 0.015, a.pz], [b.px, b.py + 0.015, b.pz], [c.px, c.py + 0.015, c.pz], [d.px, d.py + 0.015, d.pz]);
  }
}

function sideStreet(track, chunks, s0, side, rng) {
  const path = track.path;
  const g = chunks.W(s0);
  const i = path.indexAt(s0);
  const lim = side < 0 ? track.limL[i] : track.limR[i];
  const w = 11, len = 26;
  const C = path.point(s0, side * (lim + 0.5));
  const ox = side * C.rx, oz = side * C.rz, tx = C.tx, tz = C.tz;
  const P = (a, b, y = 0.02) => [C.px + ox * a + tx * b, C.py + y, C.pz + oz * a + tz * b];
  g.set(rgb(track.theme.road || '#2a2a3a'), 0, 0);
  if (side > 0) g.quad(P(0, -w / 2), P(len, -w / 2), P(len, w / 2), P(0, w / 2)); else g.quad(P(0, w / 2), P(len, w / 2), P(len, -w / 2), P(0, -w / 2));
  // barricade across the side street (striped)
  for (let k = 0; k < 5; k++) {
    const b = -w / 2 + 1 + k * ((w - 2) / 4);
    const Q = P(3.5, b, 0);
    g.set(k % 2 ? [1, 0.85, 0.1] : [0.1, 0.08, 0.12], 0, 0.15);
    g.at(Q, [0, Math.atan2(-tz, tx), 0], 1, (gg) => { gg.box(0, 0.75, 0, 0.25, 0.35, 2.2); gg.set([0.9, 0.9, 0.95], 0, 0); gg.box(0, 0.35, -0.9, 0.2, 0.7, 0.12); gg.box(0, 0.35, 0.9, 0.2, 0.7, 0.12); });
  }
  const Q = P(3.5, 0, 0);
  track.addBox(Q[0], Q[2], 0.4, w / 2, Math.atan2(-tz, tx) + Math.PI / 2, { tag: 'barricade' });
  void rng;
}

function trafficLights(track, chunks, s0) {
  const path = track.path;
  for (const side of [-1, 1]) {
    const s = s0 - side * 12;
    const i = path.indexAt(s);
    const hw = path.w[i] / 2;
    const g = chunks.W(s);
    const P = path.point(s, side * (hw + 1.2));
    g.set(rgb('#3a3650'), 0, 0);
    g.cyl([P.px, P.py, P.pz], [P.px, P.py + 6.5, P.pz], 0.14, 0.12, 6, false);
    const arm = [P.px - side * P.rx * 6, P.py + 6.3, P.pz - side * P.rz * 6];
    g.cyl([P.px, P.py + 6.3, P.pz], arm, 0.1, 0.1, 5, false);
    g.set(rgb('#22202c'), 0, 0);
    g.at(arm, [0, Math.atan2(-P.tz, P.tx), 0], 1, (gg) => {
      gg.box(0, -0.35, 0, 0.4, 0.5, 1.5);
      gg.set([1, 0.2, 0.2], 0, 1); gg.box(-0.21, -0.35, -0.45, 0.05, 0.3, 0.3);
      gg.set([1, 0.8, 0.2], 0, 0.3); gg.box(-0.21, -0.35, 0, 0.05, 0.3, 0.3);
      gg.set([0.2, 1, 0.5], 0, 1); gg.box(-0.21, -0.35, 0.45, 0.05, 0.3, 0.3);
    });
    track.addCircle(P.px, P.pz, 0.35, { tag: 'pole' });
  }
}

function footbridge(track, chunks, s) {
  const path = track.path;
  const i = path.indexAt(s);
  const g = chunks.W(s);
  const span = track.limL[i] + track.limR[i] + 4;
  const C = path.point(s, (track.limR[i] - track.limL[i]) / 2);
  const ang = Math.atan2(-C.tz, C.tx);
  const H = 6.5;
  g.at([C.px, C.py, C.pz], [0, ang, 0], 1, (gg) => {
    gg.set(rgb('#8a84a8'), 0, 0);
    gg.box(0, H, 0, 3.2, 0.5, span);
    gg.set(rgb('#e8e4f4'), 0, 0);
    for (const x of [-1.5, 1.5]) { gg.box(x, H + 0.8, 0, 0.12, 0.12, span); for (let z = -span / 2; z <= span / 2; z += 2) gg.box(x, H + 0.45, z, 0.08, 0.8, 0.08); }
    gg.set(rgb('#ff2d6f'), 0, 0.9);
    gg.box(-1.62, H - 0.05, 0, 0.06, 0.2, span);
    gg.box(1.62, H - 0.05, 0, 0.06, 0.2, span);
    gg.set(rgb('#5a5470'), 0, 0);
    for (const z of [-span / 2 - 1, span / 2 + 1]) gg.box(0, H / 2, z, 2.5, H, 1.2);
  });
  for (const z of [-1, 1]) {
    const lat = (track.limR[i] - track.limL[i]) / 2 + z * (span / 2 + 1);
    const Q = path.point(s, lat);
    track.addBox(Q.px, Q.pz, 1.3, 0.7, ang, { tag: 'pillar' });
  }
}

export { groundGlow, facadeUV, mix };
