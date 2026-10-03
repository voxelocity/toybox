// Small allocation-friendly vector / quaternion / matrix helpers for the
// simulation. Physics runs in "unreal units" (uu, 1 uu = 1 cm) with a
// right-handed frame: +x right (seen from the blue goal), +y toward the
// orange goal, +z up. Nothing here depends on three.js so the sim also runs
// in Node (tests, headless ball prediction).

export class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  scale(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  crossVectors(a, b) {
    const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
    this.x = x; this.y = y; this.z = z; return this;
  }
  len() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  lenSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const l = this.len(); if (l > 1e-9) { this.x /= l; this.y /= l; this.z /= l; } return this; }
  clampLength(max) { const l2 = this.lenSq(); if (l2 > max * max) this.scale(max / Math.sqrt(l2)); return this; }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  distTo(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
  isZero() { return this.x === 0 && this.y === 0 && this.z === 0; }
}

export class Quat {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  normalize() {
    const l = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    this.x /= l; this.y /= l; this.z /= l; this.w /= l; return this;
  }
  setAxisAngle(ax, ay, az, angle) {
    const h = angle / 2, s = Math.sin(h);
    this.x = ax * s; this.y = ay * s; this.z = az * s; this.w = Math.cos(h); return this;
  }
  // this = a * b
  multiplyQuats(a, b) {
    const ax = a.x, ay = a.y, az = a.z, aw = a.w, bx = b.x, by = b.y, bz = b.z, bw = b.w;
    this.x = ax * bw + aw * bx + ay * bz - az * by;
    this.y = ay * bw + aw * by + az * bx - ax * bz;
    this.z = az * bw + aw * bz + ax * by - ay * bx;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
  }
  // Build from yaw (about +z), pitch (about the car's right axis, nose up
  // positive) and roll (about forward, right side down positive).
  setEuler(yaw, pitch, roll) {
    const qy = new Quat().setAxisAngle(0, 0, 1, yaw);
    const qp = new Quat().setAxisAngle(0, -1, 0, pitch);
    const qr = new Quat().setAxisAngle(1, 0, 0, roll);
    return this.multiplyQuats(qy, new Quat().multiplyQuats(qp, qr)).normalize();
  }
  // Integrate a world-space angular velocity over dt.
  integrate(w, dt) {
    const ang = Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z);
    if (ang < 1e-12) return this;
    const h = ang * dt * 0.5, s = Math.sin(h) / ang;
    const dx = w.x * s, dy = w.y * s, dz = w.z * s, dw = Math.cos(h);
    const x = this.x, y = this.y, z = this.z, qw = this.w;
    this.x = dw * x + dx * qw + dy * z - dz * y;
    this.y = dw * y + dy * qw + dz * x - dx * z;
    this.z = dw * z + dz * qw + dx * y - dy * x;
    this.w = dw * qw - dx * x - dy * y - dz * z;
    return this.normalize();
  }
  slerp(qb, t) {
    let cos = this.x * qb.x + this.y * qb.y + this.z * qb.z + this.w * qb.w;
    let bx = qb.x, by = qb.y, bz = qb.z, bw = qb.w;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let k0, k1;
    if (cos > 0.9995) { k0 = 1 - t; k1 = t; } else {
      const a = Math.acos(cos), s = Math.sin(a);
      k0 = Math.sin((1 - t) * a) / s; k1 = Math.sin(t * a) / s;
    }
    this.x = this.x * k0 + bx * k1; this.y = this.y * k0 + by * k1;
    this.z = this.z * k0 + bz * k1; this.w = this.w * k0 + bw * k1;
    return this.normalize();
  }
}

// Row-major 3x3 rotation matrix. Columns are the body axes in world space:
// col 0 = forward, col 1 = left, col 2 = up.
export class M3 {
  constructor() { this.e = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]); }
  fromQuat(q) {
    const { x, y, z, w } = q, e = this.e;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    e[0] = 1 - (yy + zz); e[1] = xy - wz; e[2] = xz + wy;
    e[3] = xy + wz; e[4] = 1 - (xx + zz); e[5] = yz - wx;
    e[6] = xz - wy; e[7] = yz + wx; e[8] = 1 - (xx + yy);
    return this;
  }
  col(i, out) { const e = this.e; return out.set(e[i], e[3 + i], e[6 + i]); }
  // out = M * v  (local -> world)
  mulV(v, out) {
    const e = this.e, x = v.x, y = v.y, z = v.z;
    return out.set(e[0] * x + e[1] * y + e[2] * z, e[3] * x + e[4] * y + e[5] * z, e[6] * x + e[7] * y + e[8] * z);
  }
  mulXYZ(x, y, z, out) {
    const e = this.e;
    return out.set(e[0] * x + e[1] * y + e[2] * z, e[3] * x + e[4] * y + e[5] * z, e[6] * x + e[7] * y + e[8] * z);
  }
  // out = M^T * v  (world -> local)
  mulTV(v, out) {
    const e = this.e, x = v.x, y = v.y, z = v.z;
    return out.set(e[0] * x + e[3] * y + e[6] * z, e[1] * x + e[4] * y + e[7] * z, e[2] * x + e[5] * y + e[8] * z);
  }
}

// Apply a world-space inverse inertia tensor given body rotation R and the
// local diagonal inverse inertia (ix, iy, iz): out = R * diag * R^T * v
export function applyInvInertia(R, inv, v, out) {
  const e = R.e;
  const lx = e[0] * v.x + e[3] * v.y + e[6] * v.z;
  const ly = e[1] * v.x + e[4] * v.y + e[7] * v.z;
  const lz = e[2] * v.x + e[5] * v.y + e[8] * v.z;
  const sx = lx * inv.x, sy = ly * inv.y, sz = lz * inv.z;
  return out.set(e[0] * sx + e[1] * sy + e[2] * sz, e[3] * sx + e[4] * sy + e[5] * sz, e[6] * sx + e[7] * sy + e[8] * sz);
}

// Piecewise linear curve lookup, clamped at the ends: pts = [[x0, y0], ...]
export function curve(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i];
    if (x <= b[0]) {
      const a = pts[i - 1]; // no destructuring: it allocates an iterator per call
      return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    }
  }
  return pts[pts.length - 1][1];
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

// Deterministic PRNG (mulberry32) so kickoffs / AI noise can be replayed.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
