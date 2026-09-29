// Shared part generators. Everything is positioned from the hull so the same
// wing, flare or exhaust fits all three bodies.
import * as THREE from 'three';
import { MAT, C } from './hull.js';

const lerp = (a, b, t) => a + (b - a) * t;
const V3 = (a) => new THREE.Vector3(...a);

// ---------------------------------------------------------------- 2D shapes
export const shape = {
  rect: (w, h) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]],
  circle: (r, n = 12, ry = r) => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * ry]),
  round: (w, h, rr = 0.03, n = 3) => {
    const pts = [];
    const cs = [[w / 2 - rr, h / 2 - rr, 0], [-w / 2 + rr, h / 2 - rr, 1], [-w / 2 + rr, -h / 2 + rr, 2], [w / 2 - rr, -h / 2 + rr, 3]];
    for (const [cx, cy, q] of cs) for (let i = 0; i <= n; i++) { const a = (q + i / n) * Math.PI / 2; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
    return pts;
  },
  trap: (wb, wt, h, skew = 0) => [[-wb / 2, -h / 2], [wb / 2, -h / 2], [wt / 2 + skew, h / 2], [-wt / 2 + skew, h / 2]],
  // arbitrary quad from four [x,y]
  quad: (a, b, c, d) => [a, b, c, d],
};

/**
 * Raised panel: 2D polygon (CCW) placed at centre c on a plane with outward normal n and
 * up vector u, extruded outward by depth (base sunk by `sink`). No back face.
 */
export function panel(g, c, n, u, pts, depth = 0.02, sink = 0.01) {
  const N = V3(n).normalize();
  let U = V3(u);
  U.addScaledVector(N, -U.dot(N)).normalize();
  const R = new THREE.Vector3().crossVectors(U, N);
  const C0 = V3(c);
  const P = (p, d) => C0.clone().addScaledVector(R, p[0]).addScaledVector(U, p[1]).addScaledVector(N, d).toArray();
  const base = pts.map((p) => P(p, -sink));
  const top = pts.map((p) => P(p, depth));
  g.poly(top);
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    g.quad(base[i], base[j], top[j], top[i]);
  }
  return { R, U, N, P };
}

/** Front-face panel at x facing +x: coordinates (z, y) with +z to the car's right. */
export function frontPanel(g, x, y, z, pts, depth = 0.02, sink = 0.01) {
  // seen from +x the car's right (+z) is screen-left, so mirror z into the panel's local x
  return panel(g, [x, y, z], [1, 0, 0], [0, 1, 0], pts.map(([a, b]) => [-a, b]).reverse(), depth, sink);
}
export function rearPanel(g, x, y, z, pts, depth = 0.02, sink = 0.01) {
  return panel(g, [x, y, z], [-1, 0, 0], [0, 1, 0], pts, depth, sink);
}
export function topPanel(g, x, y, z, pts, depth = 0.02, sink = 0.01, n = [0, 1, 0]) {
  // pts are (x forward, z right); the panel frame is (z, x, y) so swap and restore CCW
  return panel(g, [x, y, z], n, [1, 0, 0], pts.map(([a, b]) => [b, a]).reverse(), depth, sink);
}
/** Side panel on the right (+z) surface, local (x forward, y up). */
export function sidePanel(g, x, y, z, pts, depth = 0.02, sink = 0.01, n = [0, 0, 1]) {
  return panel(g, [x, y, z], n, [0, 1, 0], pts, depth, sink);
}

/** Tube along a polyline. */
export function tube(g, pts, r, seg = 8, joints = true) {
  for (let i = 0; i < pts.length - 1; i++) g.cyl(pts[i], pts[i + 1], r, r, seg, false);
  if (joints) for (const p of pts) g.sphere(p[0], p[1], p[2], r, r, r, seg, 4);
}

/** Round lamp on a plane: bezel ring + lens. */
export function roundLamp(g, c, n, r, lens = C.head, bezel = C.black, depth = 0.025) {
  const N = V3(n).normalize();
  g.set(bezel, MAT.TRIM);
  panel(g, c, n, Math.abs(N.y) > 0.9 ? [1, 0, 0] : [0, 1, 0], shape.circle(r * 1.18, 12), depth * 0.6, 0.02);
  g.set(lens, MAT.LIGHT);
  const cc = V3(c).addScaledVector(N, depth * 0.6).toArray();
  panel(g, cc, n, Math.abs(N.y) > 0.9 ? [1, 0, 0] : [0, 1, 0], shape.circle(r, 12), depth * 0.5, 0.005);
}

// ---------------------------------------------------------------- front bits
export function splitter(g, ctx, { x, y, w, depth = 0.28, mat = MAT.CARBON, supports = true }) {
  g.set(C.dark, mat);
  g.box(x + depth / 2 - 0.06, y, 0, depth + 0.12, 0.022, w * 2);
  if (supports) {
    g.set(C.chrome, MAT.CHROME);
    for (const s of [-1, 1]) g.cyl([x + depth - 0.08, y + 0.01, s * w * 0.55], [x - 0.02, y + 0.25, s * w * 0.45], 0.008, 0.008, 5);
  }
  // end fences
  g.set(C.dark, mat);
  for (const s of [-1, 1]) g.box(x + depth / 2 - 0.04, y + 0.04, s * (w - 0.01), depth + 0.02, 0.07, 0.015);
}

export function canards(g, ctx, { x, y, z, n = 2, mat = MAT.CARBON }) {
  g.set(C.dark, mat);
  for (const s of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const yy = y + i * 0.1;
      g.at([x - 0.05 - i * 0.03, yy, s * z], [s * -0.35, 0, 0.18], 1, (gg) => gg.box(0, 0, 0, 0.22 - i * 0.04, 0.012, 0.16));
    }
  }
}

export function oilCooler(g, ctx, { x, y, w = 0.5, h = 0.2 }) {
  g.set(C.metal, MAT.CHROME);
  g.box(x, y, 0, 0.05, h, w);
  g.set(C.dark, MAT.TRIM);
  for (let i = 0; i < 7; i++) g.box(x + 0.028, y - h / 2 + 0.025 + i * (h - 0.05) / 6, 0, 0.008, 0.008, w * 0.92);
  // braided lines
  g.set(C.grey, MAT.TRIM);
  for (const s of [-1, 1]) tube(g, [[x, y + h * 0.3, s * w / 2], [x - 0.1, y + h * 0.5, s * (w / 2 + 0.05)], [x - 0.3, y + h * 0.1, s * (w / 2 + 0.08)]], 0.014, 6, false);
  g.set(C.red, MAT.TRIM);
  for (const s of [-1, 1]) g.box(x, y - h / 2 - 0.02, s * (w / 2 - 0.03), 0.06, 0.03, 0.04);
}

/** Bosozoku "deppa" chin spoiler: a big plate sticking forward and down. */
export function deppa(g, ctx, { x, y, w = 0.8, reach = 0.5 }) {
  g.set(C.white, MAT.ACCENT);
  const x1 = x + reach;
  const pts = [
    [x - 0.02, y + 0.14, -w], [x - 0.02, y + 0.14, w], [x1, y - 0.03, w * 0.92], [x1, y - 0.03, -w * 0.92],
  ];
  const drop = 0.05;
  const lower = pts.map(([a, b, c]) => [a, b - drop, c]);
  // top, bottom, front lip, sides
  g.quad(pts[0], pts[1], pts[2], pts[3]);
  g.quad(lower[3], lower[2], lower[1], lower[0]);
  g.quad(lower[3], pts[3], pts[2], lower[2]);
  g.quad(lower[0], pts[0], pts[3], lower[3]);
  g.quad(lower[2], pts[2], pts[1], lower[1]);
  g.set(C.black, MAT.TRIM);
  for (const s of [-1, 1]) g.box(x + reach * 0.4, y + 0.02, s * w * 0.5, 0.05, 0.12, 0.03);
}

export function towHook(g, x, y, z, color = C.red) {
  g.set(color, MAT.TRIM);
  g.box(x + 0.05, y, z, 0.1, 0.02, 0.05);
  g.box(x + 0.1, y + 0.03, z, 0.02, 0.07, 0.05);
}

export function licensePlate(g, x, y, front = true, text = null) {
  g.set(C.white, MAT.TRIM);
  if (front) frontPanel(g, x, y, 0, shape.rect(0.4, 0.11), 0.01, 0.02);
  else rearPanel(g, x, y, 0, shape.rect(0.34, 0.16), 0.01, 0.02);
  g.set([0.1, 0.35, 0.2], MAT.TRIM);
  if (front) frontPanel(g, x + 0.011, y, 0, shape.rect(0.3, 0.03), 0.003, 0.0);
  else rearPanel(g, x - 0.011, y, 0, shape.rect(0.26, 0.05), 0.003, 0.0);
  void text;
}

/** Mesh grille: dark recess with slats. Front face. */
export function grille(g, x, y, z, w, h, { slats = 4, frame = C.chrome, frameMat = MAT.CHROME, vertical = false, color = C.grille } = {}) {
  if (frame) { g.set(frame, frameMat); frontPanel(g, x, y, z, shape.round(w + 0.04, h + 0.04, 0.025), 0.012, 0.03); }
  g.set(color, MAT.TRIM);
  frontPanel(g, x + (frame ? 0.004 : 0), y, z, shape.round(w, h, 0.02), 0.01, 0.03);
  g.set(frame && frameMat === MAT.CHROME ? C.chrome : C.grey, frame && frameMat === MAT.CHROME ? MAT.CHROME : MAT.TRIM);
  for (let i = 0; i < slats; i++) {
    const t = (i + 0.5) / slats;
    if (vertical) frontPanel(g, x + 0.012, y, z - w / 2 + t * w, shape.rect(0.012, h * 0.9), 0.01, 0.005);
    else frontPanel(g, x + 0.012, y - h / 2 + t * h, z, shape.rect(w * 0.94, 0.012), 0.01, 0.005);
  }
}

// ---------------------------------------------------------------- rear bits
export function exhaustTip(g, ctx, pos, dir = [-1, 0, 0], r = 0.045, len = 0.12, { color = C.chrome, mat = MAT.CHROME, slant = false } = {}) {
  const D = V3(dir).normalize();
  const P1 = V3(pos), P0 = P1.clone().addScaledVector(D, -len);
  g.set(color, mat);
  g.cyl(P0.toArray(), P1.toArray(), r * 0.92, r, 10, false);
  // inner dark
  g.set(C.black, MAT.TRIM);
  g.cyl(P1.clone().addScaledVector(D, -0.03).toArray(), P1.clone().addScaledVector(D, -0.001).toArray(), r * 0.8, r * 0.8, 10, false);
  g.at(P1.clone().addScaledVector(D, -0.02).toArray(), [0, 0, 0], 1, (gg) => {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), D);
    gg.push(new THREE.Matrix4().makeRotationFromQuaternion(q)); gg.disc(0, r * 0.8, 10); gg.pop();
  });
  ctx.exhausts.push({ pos: P1.toArray(), dir: D.toArray(), r });
  void slant;
}

/** Bosozoku takeyari ("bamboo spear") exhausts rising past the roof. */
export function takeyari(g, ctx, { x, y, z, height = 1.7, lean = 0.75, count = 2, r = 0.05 }) {
  for (const s of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const zz = s * (z - i * 0.13);
      const base = [x + 0.12, y, zz];
      const bend = [x - 0.08, y + 0.05, zz];
      const tip = [x - 0.08 - lean * (1 + i * 0.12), y + height * (1 + i * 0.08), zz + s * 0.06];
      g.set(C.chrome, MAT.CHROME);
      g.cyl(base, bend, r, r, 10, false);
      g.sphere(bend[0], bend[1], bend[2], r, r, r, 10, 4);
      g.cyl(bend, tip, r, r * 1.08, 10, false);
      // oblique cut: dark disc tilted at the tip
      const D = new THREE.Vector3().subVectors(V3(tip), V3(bend)).normalize();
      g.set(C.black, MAT.TRIM);
      g.at(tip, [0, 0, 0], 1, (gg) => {
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(D.x * 0.6 - 0.4, D.y, D.z).normalize());
        gg.push(new THREE.Matrix4().makeRotationFromQuaternion(q)); gg.disc(0.002, r * 1.02, 10); gg.pop();
      });
      // colour band
      g.set(C.white, MAT.ACCENT);
      const band = V3(bend).lerp(V3(tip), 0.55).toArray();
      const band2 = V3(bend).lerp(V3(tip), 0.62).toArray();
      g.cyl(band, band2, r * 1.12, r * 1.12, 10, false);
      ctx.exhausts.push({ pos: tip, dir: D.toArray(), r: r * 1.1, big: true });
    }
  }
  ctx.takeyari = true;
}

export function diffuser(g, ctx, { x, y, w, len = 0.35, fins = 5, mat = MAT.CARBON }) {
  g.set(C.dark, mat);
  // sloped plate
  const a = [x + 0.1, y + 0.02, -w], b = [x + 0.1, y + 0.02, w], c = [x - len, y + 0.16, w], d = [x - len, y + 0.16, -w];
  g.quad(a, b, c, d); g.quad(d, c, b, a);
  for (let i = 0; i < fins; i++) {
    const z = -w + (i + 0.5) * (2 * w) / fins;
    g.box(x - len / 2 + 0.05, y + 0.07, z, len, 0.12, 0.012);
  }
}

// ---------------------------------------------------------------- side bits
export function mirrors(g, ctx, { x, y, z, style = 'oem' }) {
  for (const s of [-1, 1]) {
    if (style === 'aero') {
      g.set(C.dark, MAT.TRIM);
      g.cyl([x, y - 0.02, s * (z - 0.02)], [x - 0.06, y + 0.04, s * (z + 0.1)], 0.01, 0.01, 5);
      g.set(C.white, MAT.PAINT);
      g.at([x - 0.08, y + 0.05, s * (z + 0.12)], [0, 0, 0], 1, (gg) => gg.sphere(0, 0, 0, 0.1, 0.045, 0.05, 8, 5));
    } else if (style === 'fender') {
      g.set(C.chrome, MAT.CHROME);
      g.cyl([x, y - 0.03, s * z], [x, y + 0.08, s * z], 0.008, 0.008, 5);
      g.set(C.white, MAT.PAINT);
      g.at([x, y + 0.1, s * z], [0, 0, 0], 1, (gg) => gg.sphere(0, 0, 0, 0.05, 0.035, 0.045, 8, 5));
    } else {
      g.set(C.white, MAT.PAINT);
      g.at([x, y, s * (z + 0.08)], [0, s * 0.15, 0], 1, (gg) => gg.box(0, 0, 0, 0.12, 0.1, 0.16, [0.8, 0.9]));
      g.set(C.dark, MAT.TRIM);
      g.box(x + 0.01, y - 0.03, s * (z + 0.01), 0.05, 0.04, 0.04);
    }
  }
}

export function sideSkirt(g, ctx, { x0, x1, y, z, h = 0.1, out = 0.035, mat = MAT.PAINT, color = C.white }) {
  g.set(color, mat);
  for (const s of [-1, 1]) {
    const zz = s * (z + out / 2);
    g.box((x0 + x1) / 2, y + h / 2 - 0.02, zz, x1 - x0, h, out + 0.06);
  }
}

/** Arc flare around an arch (right side, mirrored). */
export function overfender(g, ctx, { ax, cy, r, z, out = 0.12, band = 0.13, rivets = true, boxy = false, a0 = 0.02, a1 = Math.PI - 0.02, y0 = 0 }) {
  const seg = boxy ? 5 : 12;
  for (const s of [-1, 1]) {
    g.set(C.white, MAT.PAINT);
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * (i / seg);
      let rr = r;
      if (boxy) rr = r / Math.max(Math.abs(Math.cos(a)) * 0.85, Math.abs(Math.sin(a)), 0.7);
      pts.push([ax - Math.cos(a) * rr, Math.max(y0, cy + Math.sin(a) * rr)]);
    }
    const outer = pts.map(([x, y], i) => {
      const a = a0 + (a1 - a0) * (i / seg);
      return [x - Math.cos(a) * band, y + Math.sin(a) * band];
    });
    const zi = s * (z - 0.06), zo = s * (z + out);
    for (let i = 0; i < seg; i++) {
      // outer face (faces +z*s), top face, inner lip
      const p0 = [pts[i][0], pts[i][1], zo], p1 = [pts[i + 1][0], pts[i + 1][1], zo];
      const q0 = [outer[i][0], outer[i][1], (zo + zi) / 2 + s * out * 0.2], q1 = [outer[i + 1][0], outer[i + 1][1], (zo + zi) / 2 + s * out * 0.2];
      const w0 = [outer[i][0], outer[i][1], zi], w1 = [outer[i + 1][0], outer[i + 1][1], zi];
      const i0 = [pts[i][0], pts[i][1], zi], i1 = [pts[i + 1][0], pts[i + 1][1], zi];
      if (s > 0) {
        g.quad(p0, q0, q1, p1);
        g.quad(q0, w0, w1, q1);
        g.set(C.well, MAT.TRIM); g.quad(i0, p0, p1, i1); g.set(C.white, MAT.PAINT);
      } else {
        g.quad(p1, q1, q0, p0);
        g.quad(q1, w1, w0, q0);
        g.set(C.well, MAT.TRIM); g.quad(i1, p1, p0, i0); g.set(C.white, MAT.PAINT);
      }
    }
    // end caps
    for (const k of [0, seg]) {
      const p = [pts[k][0], pts[k][1]], o = [outer[k][0], outer[k][1]];
      const quad = [[p[0], p[1], zo], [o[0], o[1], (zo + zi) / 2 + s * out * 0.2], [o[0], o[1], zi], [p[0], p[1], zi]];
      if ((k === 0) === (s > 0)) g.quad(quad[3], quad[2], quad[1], quad[0]); else g.quad(quad[0], quad[1], quad[2], quad[3]);
    }
    if (rivets) {
      g.set(C.chrome, MAT.CHROME);
      for (let i = 1; i < seg; i += boxy ? 1 : 2) {
        const m = [lerp(pts[i][0], outer[i][0], 0.5), lerp(pts[i][1], outer[i][1], 0.5)];
        g.sphere(m[0], m[1], s * (z + out * 0.62), 0.012, 0.012, 0.012, 5, 3);
      }
    }
  }
}

export function mudflaps(g, ctx, { x, y, z, w = 0.22, h = 0.26 }) {
  g.set(C.black, MAT.TRIM);
  for (const s of [-1, 1]) g.box(x, y + h / 2, s * z, 0.015, h, w);
}

export function sideExit(g, ctx, { x, y, z }) {
  for (const s of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const pos = [x - i * 0.1, y, s * (z + 0.02)];
      exhaustTip(g, ctx, pos, [-0.3, -0.05, s], 0.036, 0.1);
    }
  }
}

export function vents(g, x, y, z, n = 3, w = 0.18, len = 0.2) {
  g.set(C.black, MAT.TRIM);
  for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
    sidePanel(g, x - i * 0.05, y + i * 0.0, s * z, shape.trap(0.03, 0.03, w), 0.01, 0.02, [0, 0, s]);
  }
  void len;
}

// ---------------------------------------------------------------- aero
function airfoil(g, x, y, chord, span, thick = 0.035, angle = 0.12, mat = MAT.PAINT, color = C.white) {
  g.set(color, mat);
  const prof = [[chord * 0.5, 0], [chord * 0.3, thick * 0.6], [-chord * 0.2, thick * 0.9], [-chord * 0.5, thick * 0.3], [-chord * 0.5, 0], [chord * 0.45, -thick * 0.2]];
  g.at([x, y, 0], [0, 0, angle], 1, (gg) => gg.extrude(prof, span * 2));
}

export function wing(g, ctx, kind, m) {
  // m: mount {x, y (deck surface), hw (deck half width), roofX, roofY}
  const span = m.hw * 0.98;
  switch (kind) {
    case 'lip': {
      g.set(C.white, MAT.PAINT);
      g.at([m.x + 0.04, m.y + 0.01, 0], [0, 0, 0.35], 1, (gg) => gg.box(0, 0.02, 0, 0.16, 0.035, span * 1.9));
      break;
    }
    case 'gt': {
      const h = 0.3;
      airfoil(g, m.x - 0.1, m.y + h, 0.36, span + 0.04, 0.04, 0.14);
      g.set(C.dark, MAT.CARBON);
      for (const s of [-1, 1]) {
        g.box(m.x - 0.05, m.y + h / 2, s * span * 0.62, 0.16, h, 0.025, [0.7, 1]);
        g.box(m.x - 0.1, m.y + h + 0.02, s * (span + 0.05), 0.46, 0.2, 0.014);
      }
      break;
    }
    case 'swan': {
      const h = 0.42;
      airfoil(g, m.x - 0.14, m.y + h, 0.42, span + 0.06, 0.045, 0.16, MAT.CARBON, C.dark);
      g.set(C.dark, MAT.CARBON);
      for (const s of [-1, 1]) {
        const z = s * span * 0.45;
        tube(g, [[m.x + 0.08, m.y, z], [m.x + 0.06, m.y + h * 0.7, z], [m.x - 0.02, m.y + h + 0.06, z], [m.x - 0.12, m.y + h + 0.04, z]], 0.018, 5, false);
        g.set(C.white, MAT.PAINT);
        g.box(m.x - 0.16, m.y + h + 0.05, s * (span + 0.07), 0.56, 0.3, 0.016);
        g.set(C.dark, MAT.CARBON);
      }
      break;
    }
    case 'boso': {
      const h = 0.85;
      airfoil(g, m.x - 0.2, m.y + h, 0.34, span + 0.1, 0.04, -0.25, MAT.ACCENT);
      airfoil(g, m.x - 0.22, m.y + h * 0.6, 0.26, span * 0.7, 0.035, -0.15, MAT.ACCENT);
      g.set(C.chrome, MAT.CHROME);
      for (const s of [-1, 1]) {
        tube(g, [[m.x + 0.05, m.y, s * span * 0.55], [m.x - 0.15, m.y + h, s * span * 0.62]], 0.022, 6, false);
      }
      g.set(C.white, MAT.PAINT);
      for (const s of [-1, 1]) g.box(m.x - 0.22, m.y + h, s * (span + 0.12), 0.46, 0.34, 0.02);
      break;
    }
    case 'roof': {
      if (m.roofX == null) break;
      g.set(C.white, MAT.PAINT);
      g.at([m.roofX - 0.02, m.roofY + 0.015, 0], [0, 0, 0.1], 1, (gg) => gg.box(0, 0, 0, 0.22, 0.03, m.roofHW * 1.9));
      g.set(C.dark, MAT.CARBON);
      g.at([m.roofX + 0.35, m.roofY + 0.05, 0], [0, 0, 0], 1, (gg) => gg.extrude([[0.2, 0], [-0.15, 0], [-0.15, 0.1], [-0.05, 0.1]], 0.02));
      for (let i = 0; i < 7; i++) {
        const z = -m.roofHW * 0.8 + i * (m.roofHW * 1.6) / 6;
        g.at([m.roofX + 0.05, m.roofY + 0.03, z], [0, 0.4 * (i % 2 ? 1 : -1), 0], 1, (gg) => gg.extrude([[0.06, 0], [-0.04, 0], [-0.04, 0.05]], 0.01));
      }
      break;
    }
    default: break;
  }
}
