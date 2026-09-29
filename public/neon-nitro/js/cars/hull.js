// Parametric car hull: a loft of cross-sections along the car's length (x),
// defined by key stations {x, top, bot, hw, sh, tuck}. Wheel arches are cut
// by raising the bottom line around each axle. A separate greenhouse (cabin)
// is built from a side-profile polygon with tumblehome, with inset glass.
//
// Car space: +x forward, +y up, +z right. Origin on the ground, mid-wheelbase.
import * as THREE from 'three';

export const MAT = { TRIM: 0, PAINT: 1, CHROME: 2, GLASS: 3, LIGHT: 4, RUBBER: 5, CARBON: 6, ACCENT: 7, RIM: 8, NEON: 9 };
export const C = {
  black: [0.06, 0.06, 0.08], dark: [0.12, 0.12, 0.15], grey: [0.35, 0.36, 0.4], chrome: [0.95, 0.95, 1.0],
  white: [1, 1, 1], head: [1.0, 0.98, 0.88], amber: [1.0, 0.62, 0.1], red: [1.0, 0.08, 0.12], yellow: [1.0, 0.88, 0.2],
  well: [0.04, 0.03, 0.06], grille: [0.08, 0.08, 0.1], cyan: [0.2, 0.95, 1.0], pink: [1.0, 0.3, 0.75], orange: [1, 0.45, 0.1],
  metal: [0.7, 0.72, 0.76], rust: [0.55, 0.3, 0.18], primer: [0.55, 0.56, 0.52],
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Hull {
  /**
   * @param keys  station keys sorted by x ascending (rear -> front)
   * @param arches [{x, cy, r}] wheel arch circles (side view)
   */
  constructor(keys, arches, opts = {}) {
    this.keys = keys;
    this.arches = arches;
    this.opts = opts;
    this.xMin = keys[0].x;
    this.xMax = keys[keys.length - 1].x;
  }

  at(x) {
    const k = this.keys;
    if (x <= k[0].x) return { ...k[0], x };
    if (x >= k[k.length - 1].x) return { ...k[k.length - 1], x };
    let i = 0;
    while (i < k.length - 2 && k[i + 1].x < x) i++;
    const a = k[i], b = k[i + 1];
    let t = (x - a.x) / (b.x - a.x);
    if (a.ease || b.ease) t = t * t * (3 - 2 * t);
    const r = { x };
    for (const key of ['top', 'bot', 'hw', 'sh', 'tuck']) r[key] = lerp(a[key] ?? 0, b[key] ?? 0, t);
    return r;
  }

  /** Bottom height including arch cut-outs. */
  bottom(x) {
    const s = this.at(x);
    let bot = s.bot;
    for (const a of this.arches) {
      const dx = x - a.x;
      if (Math.abs(dx) < a.r) bot = Math.max(bot, a.cy + Math.sqrt(a.r * a.r - dx * dx));
    }
    return Math.min(bot, s.top - s.sh - 0.1);
  }

  inArch(x0, x1) {
    for (const a of this.arches) if (x1 > a.x - a.r + 0.01 && x0 < a.x + a.r - 0.01) return true;
    return false;
  }

  /** Right-half section template: [z, y] from top centre to bottom centre. */
  half(x) {
    const s = this.at(x);
    const bot = this.bottom(x);
    const top = s.top, hw = s.hw, sh = s.sh, tk = s.tuck || 0;
    const shoulder = top - sh;
    const widest = shoulder - 0.07;
    const mid = lerp(bot, widest, 0.45);
    return [
      [0, top],
      [0.5 * hw, top - 0.2 * sh],
      [0.86 * hw, top - 0.62 * sh],
      [0.975 * hw, shoulder],
      [hw, Math.max(widest, bot + 0.02)],
      [0.99 * hw, Math.max(mid, bot + 0.015)],
      [(0.97 - 0.3 * tk) * hw, Math.min(bot + 0.07, Math.max(mid, bot + 0.01))],
      [(0.93 - 0.4 * tk) * hw, bot],
      [0, bot],
    ];
  }

  /** Stations: key xs, uniform spacing, dense around arches. */
  stations(step = 0.14) {
    const xs = new Set(this.keys.map((k) => +k.x.toFixed(4)));
    for (let x = this.xMin; x < this.xMax; x += step) xs.add(+x.toFixed(4));
    for (const a of this.arches) {
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const x = a.x - a.r * Math.cos((i / n) * Math.PI);
        if (x > this.xMin && x < this.xMax) xs.add(+x.toFixed(4));
      }
      for (const d of [-0.02, 0.02]) {
        for (const e of [a.x - a.r + d, a.x + a.r + d]) if (e > this.xMin && e < this.xMax) xs.add(+e.toFixed(4));
      }
    }
    return [...xs].sort((a, b) => a - b).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 0.012);
  }

  /** Emit the hull into a Geo. Paint on top/sides, dark underbody and arch wells. */
  build(g, opts = {}) {
    const xs = this.stations(opts.step);
    const rings = xs.map((x) => {
      const h = this.half(x);
      const right = h.map(([z, y]) => [x, y, z]);
      const left = h.slice(1, -1).map(([z, y]) => [x, y, -z]).reverse();
      // CCW from +x: start at bottom centre? We need top going -z -> +z.
      // right goes top->bottom along +z side; left(reversed) goes bottom->top along -z side.
      return [...right, ...left];
    });
    // Orientation check: right[] runs top centre -> +z shoulder -> bottom. Seen from +x
    // (+z on the screen's left) that is counter-clockwise, which the loft needs.
    const n = rings[0].length;
    const nh = 9; // points in half template
    for (let r = 0; r < rings.length - 1; r++) {
      const A = rings[r], B = rings[r + 1];
      const arch = this.inArch(xs[r], xs[r + 1]);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        // segment index within half: right half segs 0..7 (i=0..7), left half mirrored
        const seg = i < nh - 1 ? i : (i >= nh - 1 ? (n - 1 - i) : i);
        const isBottom = seg >= 7;
        const isLowerEdge = seg === 6;
        if (isBottom || (arch && isLowerEdge)) g.set(C.well, MAT.TRIM);
        else g.set(C.white, MAT.PAINT);
        g.quad(A[i], A[j], B[j], B[i]);
      }
    }
    // end caps (rings are CCW seen from +x)
    g.set(C.white, MAT.PAINT);
    const first = rings[0], last = rings[rings.length - 1];
    if (!opts.noRearCap) g.poly([...first].reverse());
    if (!opts.noFrontCap) g.poly([...last]);
    this.xs = xs;
    return this;
  }

  /** Point on the right-side surface at x and height y (outermost), z >= 0. */
  sideZ(x, y) {
    const h = this.half(x);
    for (let i = 3; i < h.length - 1; i++) {
      const [z0, y0] = h[i], [z1, y1] = h[i + 1];
      if ((y <= y0 && y >= y1) || (y >= y0 && y <= y1)) {
        const t = Math.abs(y1 - y0) < 1e-6 ? 0 : (y - y0) / (y1 - y0);
        return lerp(z0, z1, t);
      }
    }
    return y > h[3][1] ? h[3][0] : h[7][0];
  }

  /** Height of the top surface at x and lateral z. */
  topY(x, z) {
    const h = this.half(x);
    const az = Math.abs(z);
    for (let i = 0; i < 4; i++) {
      const [z0, y0] = h[i], [z1, y1] = h[i + 1];
      if (az >= z0 && az <= z1) return lerp(y0, y1, (az - z0) / Math.max(1e-6, z1 - z0));
    }
    return h[4][1];
  }
}

/**
 * U-section lofted bed (truck). Open top; outer walls to rail height, floor at floorY.
 */
export function buildBed(g, hull, x0, x1, railY, floorY, wall = 0.06, opts = {}) {
  const xs = hull.stations().filter((x) => x > x0 && x < x1);
  xs.unshift(x0); xs.push(x1);
  const ringAt = (x) => {
    const s = hull.at(x);
    const bot = Math.min(hull.bottom(x), floorY - 0.04);
    const hw = s.hw;
    const iw = hw - wall;
    // right half outer then inner, as a closed U: start at inner floor centre
    return {
      pts: [
        [x, floorY, 0], [x, floorY, iw], [x, railY - 0.01, iw], [x, railY, iw + wall * 0.3], [x, railY, hw * 0.99], [x, railY - 0.06, hw],
        [x, lerp(bot, railY, 0.4), hw * 0.995], [x, bot + 0.05, hw * 0.97], [x, bot, hw * 0.92], [x, bot, 0],
      ],
      arch: hull.bottom(x) > s.bot + 0.01,
    };
  };
  const rings = xs.map((x) => {
    const r = ringAt(x);
    const right = r.pts;
    const left = right.slice(1, -1).map(([a, b, c]) => [a, b, -c]).reverse();
    return [...right, ...left];
  });
  const n = rings[0].length;
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r], B = rings[r + 1];
    const arch = hull.inArch(xs[r], xs[r + 1]);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const seg = i < 9 ? i : n - 1 - i;
      if (seg === 0) g.set(opts.floorColor || C.dark, MAT.TRIM);
      else if (seg === 1 || seg === 2) g.set(opts.innerColor || C.dark, opts.innerMat ?? MAT.TRIM);
      else if (seg >= 8 || (arch && seg === 7)) g.set(C.well, MAT.TRIM);
      else g.set(C.white, MAT.PAINT);
      // the U ring is CCW seen from +x like the hull, so the same winding faces out
      g.quad(A[i], A[j], B[j], B[i]);
    }
  }
  // end walls as thin boxes (tailgate / bulkhead)
  const endWall = (x, dir) => {
    const s = hull.at(x);
    const hw = s.hw;
    const bot = Math.min(hull.bottom(x), floorY - 0.04);
    g.set(C.white, MAT.PAINT);
    const xa = x, xb = x + dir * wall;
    const P = [[xa, bot, -hw * 0.92], [xa, bot, hw * 0.92], [xa, railY, hw * 0.99], [xa, railY, -hw * 0.99]];
    const Q = P.map(([, y, z]) => [xb, y, z]);
    if (dir < 0) { g.quad(Q[0], Q[1], Q[2], Q[3]); g.quad(P[3], P[2], P[1], P[0]); }
    else { g.quad(P[0], P[1], P[2], P[3]); g.quad(Q[3], Q[2], Q[1], Q[0]); }
    if (dir > 0) g.quad(P[3], P[2], Q[2], Q[3]); else g.quad(P[2], P[3], Q[3], Q[2]);
  };
  if (opts.tailgate !== false) endWall(x0, 1);
  endWall(x1, -1);
  return xs;
}

/** Offset a convex polygon (CCW in the plane) inward by d. */
export function insetPoly(pts, d) {
  const n = pts.length;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    // inward normal for CCW polygon is (-dy, dx)
    const nx = -dy / L, ny = dx / L;
    lines.push({ p: [a[0] + nx * d, a[1] + ny * d], d: [dx / L, dy / L] });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const l0 = lines[(i + n - 1) % n], l1 = lines[i];
    const det = l0.d[0] * l1.d[1] - l0.d[1] * l1.d[0];
    if (Math.abs(det) < 1e-6) { out.push(l1.p); continue; }
    const t = ((l1.p[0] - l0.p[0]) * l1.d[1] - (l1.p[1] - l0.p[1]) * l1.d[0]) / det;
    out.push([l0.p[0] + l0.d[0] * t, l0.p[1] + l0.d[1] * t]);
  }
  return out;
}

/** Clip convex polygon by half-plane a*x + b*y + c >= 0. */
export function clipPoly(pts, a, b, c) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const dp = a * p[0] + b * p[1] + c, dq = a * q[0] + b * q[1] + c;
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      out.push([lerp(p[0], q[0], t), lerp(p[1], q[1], t)]);
    }
  }
  return out;
}

/**
 * Greenhouse from a side profile (x,y) polygon listed from the cowl, over the roof, to the
 * rear base: [[xCowl, belt], [xAtop, roof], ..., [xRear, beltRear]]. Width tapers from bw at
 * belt to rw at roof. roles[i] names the top face between profile points i and i+1:
 * 'glass' | 'paint' | 'trim'.
 */
export function buildCabin(g, spec) {
  const { profile, belt, roof, bw, rw, roles, pillar = 0.075, bPillar = null, windowFloor = 0.05, frameless = false } = spec;
  const zAt = (y) => lerp(bw, rw, clamp((y - belt) / (roof - belt), 0, 1));
  const P = profile.map(([x, y]) => [x, y, zAt(y)]);
  const L = (p) => [p[0], p[1], -p[2]];
  // top faces
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const role = roles[i] || 'paint';
    if (role === 'glass') g.set(C.white, MAT.PAINT); else g.set(C.white, role === 'trim' ? MAT.TRIM : MAT.PAINT);
    if (role === 'trim') g.set(C.black, MAT.TRIM);
    g.quad(a, L(a), L(b), b);
  }
  // sides: the profile runs front -> roof -> rear, CCW seen from +z
  g.set(C.white, MAT.PAINT);
  g.poly(P);
  g.poly(P.map((p) => L(p)).reverse());
  // bottom closure (hidden), skip

  // glass on top faces
  const off = 0.007;
  for (let i = 0; i < P.length - 1; i++) {
    if (roles[i] !== 'glass') continue;
    const a = P[i], b = P[i + 1];
    const A = new THREE.Vector3(...L(a)), B = new THREE.Vector3(...a), Cc = new THREE.Vector3(...b), D = new THREE.Vector3(...L(b));
    const n = new THREE.Vector3().subVectors(D, A).cross(new THREE.Vector3().subVectors(B, A)).normalize();
    const bil = (u, v) => {
      const p0 = A.clone().lerp(B, u), p1 = D.clone().lerp(Cc, u);
      return p0.lerp(p1, v).addScaledVector(n, off).toArray();
    };
    const iu = pillar / (2 * bw), iv = 0.06;
    g.set(C.white, MAT.GLASS);
    g.quad(bil(1 - iu, iv), bil(iu, iv), bil(iu, 1 - iv), bil(1 - iu, 1 - iv));
  }
  // side windows: inset profile, clipped above belt
  // profile runs front -> over the roof -> rear: CCW in (x, y)
  const poly = profile.map(([x, y]) => [x, y]);
  let win = insetPoly(poly, pillar);
  win = clipPoly(win, 0, 1, -(belt + windowFloor));
  if (spec.clipRear != null) win = clipPoly(win, 1, 0, -spec.clipRear);
  if (spec.clipFront != null) win = clipPoly(win, -1, 0, spec.clipFront);
  if (win.length >= 3) {
    const side = (sgn) => {
      g.set(C.white, MAT.GLASS);
      // plane of the side: z = zAt(y); normal points outwards (sgn)
      const pts = win.map(([x, y]) => [x, y, sgn * (zAt(y) + off)]);
      if (sgn > 0) g.poly(pts); else g.poly(pts.slice().reverse());
    };
    side(1); side(-1);
    if (bPillar != null) {
      const w = 0.05;
      g.set(frameless ? C.black : C.black, MAT.TRIM);
      for (const sgn of [1, -1]) {
        const y0 = belt + windowFloor - 0.01, y1 = roof - pillar - 0.004;
        const pts = [[bPillar - w, y0], [bPillar + w, y0], [bPillar + w * 0.8, y1], [bPillar - w * 0.8, y1]].map(([x, y]) => [x, y, sgn * (zAt(y) + off * 2)]);
        if (sgn > 0) g.poly(pts); else g.poly(pts.slice().reverse());
      }
    }
  }
  return { zAt, P };
}
