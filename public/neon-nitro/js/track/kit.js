// Reusable scenery pieces. All write into Geo sinks (world / signs / glow).
import { addSign, signUV, SIGN_COUNTS } from '../render/signs.js';
import { rgb } from './build.js';

const TAU = Math.PI * 2;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** uv mode for facades: u along the face, v = height above base - offset (<0 = no windows). */
export function facadeUV(base, offset = 4.5) {
  return (p, n) => {
    if (Math.abs(n.y) > 0.5) return [0, 0];
    const tx = -n.z, tz = n.x;
    return [p.x * tx + p.z * tz, p.y - base - offset];
  };
}

/**
 * Building with a road-facing front. (x, z) = front-centre at ground; (fx, fz) = unit facing
 * direction (toward the road). opts: { w, d, h, color, y, rng, signs, storefront, roof, style }
 */
export function building(sinks, x, z, fx, fz, o) {
  const { world: g, signs: sg, glow } = sinks;
  const r = o.rng;
  const y = o.y ?? 0;
  const w = o.w, d = o.d, h = o.h;
  const ang = Math.atan2(-fz, fx); // local +x -> facing direction
  const col = rgb(o.color);
  // local frame: +x = toward road (front face at x=0), building extends to -x
  g.uvMode = facadeUV(y, o.shopH ?? 4.5);
  const seed = [col[0], col[1], col[2]];
  g.at([x, y, z], [0, ang, 0], 1, (gg) => {
    gg.set(seed, 0, 0);
    // main mass; setbacks for tall towers
    if (h > 34 && o.style !== 'block') {
      const h1 = h * (0.55 + r() * 0.15);
      gg.box(-d / 2, h1 / 2, 0, d, h1, w);
      gg.set(mix(seed, [1, 1, 1], 0.08), 0, 0);
      gg.box(-d / 2 - 1.5, h1 + (h - h1) / 2, 0, d - 3, h - h1, w - 3);
    } else {
      gg.box(-d / 2, h / 2, 0, d, h, w);
    }
  });
  g.uvMode = null;
  // shop front + awning + sign
  const shopH = o.shopH ?? 4.5;
  g.at([x, y, z], [0, ang, 0], 1, (gg) => {
    const glowCol = rgb(o.shopGlow || ['#ffcf7a', '#ff7ad9', '#7ae8ff', '#b9ff7a', '#fff2c4'][Math.floor(r() * 5)]);
    gg.set([0.08, 0.06, 0.1], 0, 0);
    gg.box(0.05, shopH / 2, 0, 0.3, shopH, w - 0.4);
    if (o.storefront !== false) {
      gg.set(glowCol, 0, 0.85);
      gg.box(0.22, 1.5, 0, 0.1, 2.4, w * 0.8);
      // mullions
      gg.set([0.06, 0.05, 0.08], 0, 0);
      for (let k = -2; k <= 2; k++) gg.box(0.28, 1.5, (k * w * 0.8) / 5, 0.06, 2.4, 0.12);
      // awning
      const aw = rgb(['#ff2d6f', '#20d8ff', '#ffe23b', '#56f06b', '#ff8a1e', '#c93dff', '#ffffff'][Math.floor(r() * 7)]);
      gg.set(aw, 0, 0);
      gg.at([0.9, 3.2, 0], [0, 0, -0.35], 1, (g3) => g3.box(0, 0, 0, 1.8, 0.12, w * 0.85));
      gg.set([1, 1, 1], 0, 0);
      for (let k = 0; k < 6; k++) gg.at([1.75, 2.9, -w * 0.4 + (k * w * 0.8) / 5], [0, 0, 0], 1, (g3) => g3.box(0, 0, 0, 0.08, 0.35, (w * 0.8) / 10));
    }
    // roof clutter
    if (o.roof !== false) {
      gg.set([0.4, 0.38, 0.46], 0, 0);
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) gg.box(-d * (0.2 + r() * 0.6), h + 0.6, (r() - 0.5) * w * 0.6, 1.6, 1.2, 1.4);
      if (r() < 0.45) { // water tank
        gg.set([0.55, 0.5, 0.6], 0, 0);
        const tx = -d * (0.3 + r() * 0.4), tz = (r() - 0.5) * w * 0.4;
        gg.cyl([tx, h, tz], [tx, h + 3.2, tz], 1.3, 1.3, 10, true);
      }
      if (r() < 0.35) { // antenna with red beacon
        gg.set([0.3, 0.3, 0.36], 0, 0);
        const ax = -d * 0.5, az = 0;
        gg.cyl([ax, h, az], [ax, h + 8, az], 0.12, 0.05, 5, false);
        gg.set([1, 0.1, 0.15], 0, 1);
        gg.sphere(ax, h + 8.1, az, 0.35, 0.35, 0.35, 6, 4);
      }
      // neon roof trim
      if (r() < 0.5) {
        gg.set(rgb(['#ff2d6f', '#20d8ff', '#c93dff', '#ffe23b'][Math.floor(r() * 4)]), 0, 1);
        gg.box(0.05, h - 0.15, 0, 0.12, 0.2, w);
      }
    }
  });
  // signage (atlas)
  if (sg) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const L = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const nx = fx, nz = fz;
    if (o.storefront !== false) addSign(sg, L(0.34, shopH - 0.55, 0), nx, nz, Math.min(w * 0.7, 6), 1.3, signUV('h', Math.floor(r() * SIGN_COUNTS.h)), 1);
    // vertical projecting signs
    if (h > 10 && r() < (o.vertChance ?? 0.75)) {
      const side = r() < 0.5 ? -1 : 1;
      const vz = side * (w / 2 - 0.8);
      const vh = Math.min(h - shopH - 2, 7 + r() * 5);
      const vy = shopH + 1 + vh / 2;
      const uv = signUV('v', Math.floor(r() * SIGN_COUNTS.v));
      // perpendicular to facade: facing along +-z local
      const px = 1.1;
      const P = L(px, vy, vz);
      const sx = -s * side, sz = -c * side; // local +z in world... facing sideways
      addSign(sg, P, s, c, 1.6, vh, uv, 1);
      addSign(sg, P, -s, -c, 1.6, vh, uv, 1);
      g.set([0.1, 0.08, 0.14], 0, 0);
      g.at(P, [0, ang, 0], 1, (gg) => gg.box(0, 0, 0, 1.7, vh + 0.2, 0.15));
      void sx; void sz;
    }
    // big billboard on the facade or roof
    if (h > 16 && r() < (o.boardChance ?? 0.35)) {
      const bw = Math.min(w * 0.85, 14), bh = bw * 0.44;
      const onRoof = r() < 0.5 || h < 22;
      const by = onRoof ? h + bh / 2 + 1.2 : shopH + 4 + r() * (h - shopH - bh - 6);
      const P = L(onRoof ? -1 : 0.12, by, 0);
      g.set([0.08, 0.06, 0.12], 0, 0);
      g.at(P, [0, ang, 0], 1, (gg) => {
        gg.box(-0.2, 0, 0, 0.3, bh + 0.5, bw + 0.5);
        if (onRoof) { gg.set([0.25, 0.24, 0.3], 0, 0); for (const zz of [-bw / 3, bw / 3]) gg.box(-0.4, -bh / 2 - 0.6, zz, 0.2, 1.4, 0.2); }
      });
      addSign(sg, [P[0] + fx * 0.02, P[1], P[2] + fz * 0.02], nx, nz, bw, bh, signUV('b', Math.floor(r() * SIGN_COUNTS.b)), 1);
      if (glow) spotGlow(glow, [P[0] + fx * 1.5, P[1], P[2] + fz * 1.5], bw * 0.7, [0.4, 0.3, 0.6]);
    }
  }
}

/** Soft additive disc (vertical billboard-ish glow) */
export function spotGlow(glow, c, r, color) {
  const n = 10, K = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, b = ((i + 1) / n) * TAU;
    glow.triCol(c, [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r * 0.5, c[2]], [c[0] + Math.cos(b) * r, c[1] + Math.sin(b) * r * 0.5, c[2]], color, K, K);
  }
}

/** Light pool on the ground (additive). */
export function groundGlow(glow, x, y, z, r, color, n = 14) {
  const K = [0, 0, 0];
  const mid = [color[0] * 0.55, color[1] * 0.55, color[2] * 0.55];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, b = ((i + 1) / n) * TAU;
    const ia = [x + Math.cos(a) * r * 0.45, y, z + Math.sin(a) * r * 0.45], ib = [x + Math.cos(b) * r * 0.45, y, z + Math.sin(b) * r * 0.45];
    const oa = [x + Math.cos(a) * r, y, z + Math.sin(a) * r], ob = [x + Math.cos(b) * r, y, z + Math.sin(b) * r];
    glow.triCol([x, y, z], ib, ia, color, mid, mid);
    glow.triCol(ia, ib, ob, mid, mid, K);
    glow.triCol(ia, ob, oa, mid, K, K);
  }
}

/** Street lamp: pole at (x,z) with arm reaching toward (tx,tz). */
export function streetLamp(sinks, x, y, z, tx, tz, o = {}) {
  const { world: g, glow } = sinks;
  const H = o.h ?? 8.5;
  const reach = o.reach ?? 2.6;
  g.set(rgb(o.pole || '#4a4660'), 0, 0);
  g.cyl([x, y, z], [x, y + H, z], 0.14, 0.1, 6, false);
  const ex = x + tx * reach, ez = z + tz * reach;
  g.cyl([x, y + H, z], [ex, y + H + 0.3, ez], 0.08, 0.08, 5, false);
  const lc = rgb(o.light || '#ffd9a0');
  g.set(lc, 0, 1);
  g.box(ex, y + H + 0.15, ez, 0.8, 0.18, 0.8);
  if (glow) groundGlow(glow, ex + tx * 1.5, (o.groundY ?? y) + 0.06, ez + tz * 1.5, o.pool ?? 6.5, mix(lc, [0, 0, 0], 0.72));
}

/** Utility pole + crossbar; returns top attachment point for wires. */
export function utilityPole(g, x, y, z, ang = 0) {
  const H = 10.5;
  g.set(rgb('#6e6a7a'), 0, 0);
  g.cyl([x, y, z], [x, y + H, z], 0.2, 0.15, 6, false);
  g.set(rgb('#3e3a48'), 0, 0);
  g.at([x, y + H - 0.8, z], [0, ang, 0], 1, (gg) => { gg.box(0, 0, 0, 0.18, 0.18, 2.4); gg.box(0, -0.9, 0, 0.18, 0.18, 1.8); });
  g.set(rgb('#9a96a8'), 0, 0);
  g.cyl([x, y + H - 2.2, z], [x, y + H - 1.6, z], 0.35, 0.35, 8, true);
  return [x, y + H - 0.8, z];
}

/** Sagging wire between two points. */
export function wire(g, a, b, sag = 1.2, seg = 6, r = 0.03) {
  g.set([0.05, 0.04, 0.07], 0, 0);
  let prev = a;
  for (let i = 1; i <= seg; i++) {
    const t = i / seg;
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
    g.cyl(prev, p, r, r, 3, false);
    prev = p;
  }
}

export function tree(g, x, y, z, kind = 'round', s = 1, r = Math.random) {
  if (kind === 'pine') {
    g.set(rgb('#5a3e36'), 0, 0);
    g.cyl([x, y, z], [x, y + 2.2 * s, z], 0.3 * s, 0.22 * s, 5, false);
    const greens = ['#1f6b4f', '#2a7d57', '#185a45'];
    for (let i = 0; i < 3; i++) {
      g.set(rgb(greens[i % 3]), 0, 0);
      const yy = y + (1.6 + i * 1.7) * s;
      g.cyl([x, yy, z], [x, yy + 2.6 * s, z], (2.6 - i * 0.65) * s, 0.02, 7, true);
    }
  } else if (kind === 'sakura') {
    g.set(rgb('#4a3038'), 0, 0);
    g.cyl([x, y, z], [x, y + 2.4 * s, z], 0.3 * s, 0.2 * s, 5, false);
    g.cyl([x, y + 1.8 * s, z], [x + 1.2 * s, y + 3.2 * s, z + 0.4 * s], 0.15 * s, 0.1 * s, 4, false);
    const pinks = ['#ffb3d9', '#ff8fc8', '#ffd1e8'];
    for (let i = 0; i < 4; i++) {
      g.set(rgb(pinks[i % 3]), 0, i === 0 ? 0.08 : 0);
      g.sphere(x + (r() - 0.5) * 2.4 * s, y + (3.4 + r() * 1.2) * s, z + (r() - 0.5) * 2.4 * s, (1.5 + r() * 0.6) * s, (1.2 + r() * 0.4) * s, (1.5 + r() * 0.6) * s, 7, 4);
    }
  } else if (kind === 'maple') {
    g.set(rgb('#4a3038'), 0, 0);
    g.cyl([x, y, z], [x, y + 2.2 * s, z], 0.25 * s, 0.18 * s, 5, false);
    const cols = ['#ff5a2e', '#ff8a1e', '#e8363c'];
    for (let i = 0; i < 3; i++) { g.set(rgb(cols[i]), 0, 0); g.sphere(x + (r() - 0.5) * 2 * s, y + (3 + r()) * s, z + (r() - 0.5) * 2 * s, 1.4 * s, 1.1 * s, 1.4 * s, 6, 4); }
  } else if (kind === 'palm') {
    g.set(rgb('#6b5040'), 0, 0);
    g.cyl([x, y, z], [x + 0.6 * s, y + 6 * s, z], 0.25 * s, 0.18 * s, 5, false);
    g.set(rgb('#2f9a5a'), 0, 0);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; g.cyl([x + 0.6 * s, y + 6 * s, z], [x + 0.6 * s + Math.cos(a) * 2.6 * s, y + 5.2 * s, z + Math.sin(a) * 2.6 * s], 0.25 * s, 0.05, 3, false); }
  } else {
    g.set(rgb('#4a3a40'), 0, 0);
    g.cyl([x, y, z], [x, y + 2 * s, z], 0.22 * s, 0.16 * s, 5, false);
    g.set(rgb(['#2f8a57', '#3ea065', '#277a4c'][Math.floor(r() * 3)]), 0, 0);
    g.sphere(x, y + 3 * s, z, 1.6 * s, 1.5 * s, 1.6 * s, 7, 5);
  }
}

export function torii(g, x, y, z, ang, s = 1, color = '#e8363c') {
  g.at([x, y, z], [0, ang, 0], s, (gg) => {
    gg.set(rgb(color), 0, 0);
    for (const zz of [-3.2, 3.2]) gg.cyl([0, 0, zz], [0, 6.2, zz], 0.36, 0.3, 8, false);
    gg.box(0, 5.2, 0, 0.5, 0.45, 8.4);
    gg.set(rgb('#1a1418'), 0, 0);
    gg.box(0, 6.45, 0, 0.8, 0.5, 9.8);
    gg.set(rgb(color), 0, 0);
    gg.box(0, 6.05, 0, 0.7, 0.3, 9.4);
    gg.set(rgb('#1a1418'), 0, 0);
    for (const zz of [-3.2, 3.2]) gg.cyl([0, 0, zz], [0, 0.6, zz], 0.46, 0.46, 8, true);
  });
}

export function stoneLantern(g, x, y, z, s = 1) {
  g.set(rgb('#9a96a0'), 0, 0);
  g.cbox(x, y + 0.25 * s, z, 0.9 * s, 0.5 * s, 0.9 * s, 0.1 * s);
  g.cyl([x, y + 0.5 * s, z], [x, y + 1.4 * s, z], 0.22 * s, 0.22 * s, 6, false);
  g.cbox(x, y + 1.55 * s, z, 0.8 * s, 0.3 * s, 0.8 * s, 0.1 * s);
  g.set(rgb('#ffcf7a'), 0, 1);
  g.box(x, y + 1.9 * s, z, 0.5 * s, 0.4 * s, 0.5 * s);
  g.set(rgb('#9a96a0'), 0, 0);
  g.cyl([x, y + 2.1 * s, z], [x, y + 2.6 * s, z], 0.75 * s, 0.05, 6, true);
}

export function lantern(g, x, y, z, color = '#ff4f2e') {
  g.set(rgb(color), 0, 0.9);
  g.sphere(x, y, z, 0.35, 0.45, 0.35, 8, 5);
  g.set([0.1, 0.08, 0.1], 0, 0);
  g.box(x, y + 0.48, z, 0.3, 0.08, 0.3);
  g.box(x, y - 0.48, z, 0.3, 0.08, 0.3);
}

export function container(g, x, y, z, ang, color, len = 12.2) {
  g.at([x, y, z], [0, ang, 0], 1, (gg) => {
    gg.set(rgb(color), 0, 0);
    gg.box(0, 1.3, 0, len, 2.6, 2.45);
    gg.set(mix(rgb(color), [0, 0, 0], 0.3), 0, 0);
    for (let k = 0; k < Math.floor(len / 0.6); k++) gg.box(-len / 2 + 0.3 + k * 0.6, 1.3, 0, 0.1, 2.3, 2.5);
  });
}

/**
 * Far skyline ring. centre (cx, cz), radii r0..r1, count, heights.
 */
export function skyline(g, sg, glow, rng, o) {
  const { cx = 0, cz = 0, r0 = 500, r1 = 900, count = 90, hMin = 30, hMax = 160, colors = ['#2a2548', '#332a55', '#231f3d', '#3a2f5a'] } = o;
  g.uvMode = null;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rng() * 0.05;
    const rr = r0 + rng() * (r1 - r0);
    const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
    const w = 18 + rng() * 30, d = 18 + rng() * 30, h = hMin + Math.pow(rng(), 1.6) * (hMax - hMin);
    g.uvMode = facadeUV(0, 2);
    g.set(rgb(colors[i % colors.length]), 0, 0);
    g.at([x, 0, z], [0, a, 0], 1, (gg) => gg.box(0, h / 2, 0, w, h, d));
    g.uvMode = null;
    if (rng() < 0.5) {
      g.set(rgb(['#ff2d6f', '#20d8ff', '#c93dff', '#ffe23b'][i % 4]), 0, 1);
      g.at([x, 0, z], [0, a, 0], 1, (gg) => gg.box(0, h + 0.4, 0, w + 0.4, 0.8, d + 0.4));
    }
    if (rng() < 0.4) { g.set([1, 0.1, 0.15], 0, 1); g.sphere(x, h + 3, z, 1.2, 1.2, 1.2, 5, 3); }
    if (sg && rng() < 0.3) {
      const nx = -Math.cos(a), nz = -Math.sin(a);
      addSign(sg, [x + nx * (d / 2 + 0.5), h * 0.7, z + nz * (d / 2 + 0.5)], nx, nz, w * 0.8, w * 0.35, signUV('b', i), 1);
    }
  }
}

/** Lattice tower landmark (Tokyo-Tower-ish) */
export function latticeTower(g, x, z, H = 180, color = '#ff4f2e') {
  const levels = 10;
  for (let i = 0; i < levels; i++) {
    const y0 = (i / levels) * H, y1 = ((i + 1) / levels) * H;
    const r0 = 22 * Math.pow(1 - i / levels, 1.6) + 1.2, r1 = 22 * Math.pow(1 - (i + 1) / levels, 1.6) + 1.2;
    g.set(rgb(i % 2 ? color : '#ffffff'), 0, 0.15);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + Math.PI / 4;
      g.cyl([x + Math.cos(a) * r0, y0, z + Math.sin(a) * r0], [x + Math.cos(a) * r1, y1, z + Math.sin(a) * r1], 0.9, 0.8, 4, false);
      const b = ((k + 1) / 4) * TAU + Math.PI / 4;
      g.cyl([x + Math.cos(a) * r0, y0, z + Math.sin(a) * r0], [x + Math.cos(b) * r1, y1, z + Math.sin(b) * r1], 0.35, 0.35, 3, false);
    }
    if (i === 3 || i === 6) { g.set(rgb('#ffffff'), 0, 0.3); g.cbox(x, y1, z, r1 * 2.4, 3, r1 * 2.4, r1 * 0.5); }
  }
  g.set([1, 0.2, 0.2], 0, 1);
  g.cyl([x, H, z], [x, H + 25, z], 0.8, 0.2, 5, false);
}

export { mix };
