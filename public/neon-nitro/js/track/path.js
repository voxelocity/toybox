// Closed racing line: centripetal Catmull-Rom through control points
// [x, z, height?, width?], resampled at uniform arc length. Every sample
// carries position, tangent, right vector, width, bank and curvature, which
// is all the physics, AI and mesh builders need.

const STEP = 1.0;

function catmull(p0, p1, p2, p3, t, alpha = 0.5) {
  // centripetal parameterisation per component set (x, y, z)
  const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1e-4, alpha);
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const out = [];
  for (let k = 0; k < p0.length; k++) {
    const A1 = ((t1 - tt) / (t1 - t0)) * p0[k] + ((tt - t0) / (t1 - t0)) * p1[k];
    const A2 = ((t2 - tt) / (t2 - t1)) * p1[k] + ((tt - t1) / (t2 - t1)) * p2[k];
    const A3 = ((t3 - tt) / (t3 - t2)) * p2[k] + ((tt - t2) / (t3 - t2)) * p3[k];
    const B1 = ((t2 - tt) / (t2 - t0)) * A1 + ((tt - t0) / (t2 - t0)) * A2;
    const B2 = ((t3 - tt) / (t3 - t1)) * A2 + ((tt - t1) / (t3 - t1)) * A3;
    out.push(((t2 - tt) / (t2 - t1)) * B1 + ((tt - t1) / (t2 - t1)) * B2);
  }
  return out;
}

export class Path {
  /**
   * @param ctrl  [[x, z, h, w, bank?], ...]; h/w default to previous values
   * @param opts  { width, height, autoBank, maxBank }
   */
  constructor(ctrl, opts = {}) {
    const W0 = opts.width ?? 18, H0 = opts.height ?? 0;
    let w = W0, h = H0;
    const pts = ctrl.map((c) => {
      if (c[2] != null) h = c[2];
      if (c[3] != null) w = c[3];
      return [c[0], h, c[1], w, c[4] ?? null];
    });
    const n = pts.length;
    // dense polyline
    const dense = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const segLen = Math.hypot(p2[0] - p1[0], p2[2] - p1[2]);
      const m = Math.max(4, Math.ceil(segLen / 2));
      for (let j = 0; j < m; j++) {
        const t = j / m;
        const pos = catmull(p0.slice(0, 3), p1.slice(0, 3), p2.slice(0, 3), p3.slice(0, 3), t);
        // width: smooth (cosine) between control values
        const e = (1 - Math.cos(t * Math.PI)) / 2;
        const width = p1[3] + (p2[3] - p1[3]) * e;
        const bank = p1[4] != null && p2[4] != null ? p1[4] + (p2[4] - p1[4]) * e : null;
        dense.push({ x: pos[0], y: pos[1], z: pos[2], w: width, bank });
      }
    }
    // cumulative length
    let L = 0;
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1], b = dense[i % dense.length];
      L += Math.hypot(b.x - a.x, b.z - a.z);
      cum.push(L);
    }
    this.length = L;
    const N = Math.max(8, Math.round(L / STEP));
    this.N = N;
    this.step = L / N;
    const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
    const wd = new Float32Array(N), bk = new Float32Array(N), bankOv = new Array(N);
    let j = 0;
    for (let i = 0; i < N; i++) {
      const s = i * this.step;
      while (j < dense.length - 1 && cum[j + 1] < s) j++;
      const a = dense[j], b = dense[(j + 1) % dense.length];
      const t = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      px[i] = a.x + (b.x - a.x) * t; py[i] = a.y + (b.y - a.y) * t; pz[i] = a.z + (b.z - a.z) * t;
      wd[i] = a.w + (b.w - a.w) * t;
      bankOv[i] = a.bank != null && b.bank != null ? a.bank + (b.bank - a.bank) * t : null;
    }
    this.px = px; this.py = py; this.pz = pz; this.w = wd;
    // tangents / right vectors / curvature
    const tx = new Float32Array(N), tz = new Float32Array(N), rx = new Float32Array(N), rz = new Float32Array(N), k = new Float32Array(N), slope = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      let dx = px[b] - px[a], dz = pz[b] - pz[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      tx[i] = dx; tz[i] = dz;
      // right = forward x up; forward (dx, 0, dz) -> right (-dz, 0, dx)
      rx[i] = -dz; rz[i] = dx;
      slope[i] = (py[b] - py[a]) / (4 * this.step);
    }
    for (let i = 0; i < N; i++) {
      const a = (i - 4 + N) % N, b = (i + 4) % N;
      const ha = Math.atan2(tz[a], tx[a]), hb = Math.atan2(tz[b], tx[b]);
      let d = hb - ha;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      k[i] = d / (8 * this.step); // + = turning right (toward +right vector)
    }
    // smooth curvature, derive auto bank (outer edge up)
    const ks = new Float32Array(N);
    const R = 6;
    for (let i = 0; i < N; i++) { let s = 0; for (let o = -R; o <= R; o++) s += k[(i + o + N) % N]; ks[i] = s / (2 * R + 1); }
    const maxBank = opts.maxBank ?? 0.12, autoBank = opts.autoBank ?? 5;
    for (let i = 0; i < N; i++) {
      bk[i] = bankOv[i] != null ? bankOv[i] : Math.max(-maxBank, Math.min(maxBank, -ks[i] * autoBank));
    }
    // smooth bank
    const bk2 = new Float32Array(N);
    for (let i = 0; i < N; i++) { let s = 0; for (let o = -8; o <= 8; o++) s += bk[(i + o + N) % N]; bk2[i] = s / 17; }
    this.tx = tx; this.tz = tz; this.rx = rx; this.rz = rz; this.k = ks; this.bank = bk2; this.slope = slope;
  }

  idx(i) { return ((i % this.N) + this.N) % this.N; }
  wrapS(s) { const L = this.length; return ((s % L) + L) % L; }
  indexAt(s) { return this.idx(Math.floor(this.wrapS(s) / this.step)); }

  /** Interpolated frame at arc length s. */
  at(s, out = {}) {
    s = this.wrapS(s);
    const f = s / this.step;
    const i = Math.floor(f) % this.N, j = (i + 1) % this.N, t = f - Math.floor(f);
    const L = (arr) => arr[i] + (arr[j] - arr[i]) * t;
    out.x = L(this.px); out.y = L(this.py); out.z = L(this.pz);
    out.tx = L(this.tx); out.tz = L(this.tz);
    const l = Math.hypot(out.tx, out.tz) || 1; out.tx /= l; out.tz /= l;
    out.rx = -out.tz; out.rz = out.tx;
    out.w = L(this.w); out.bank = L(this.bank); out.k = L(this.k); out.s = s; out.i = i;
    return out;
  }

  /** World point at arc length s and lateral offset lat (+ = right), on the banked surface. */
  point(s, lat, out = {}) {
    const f = this.at(s, out);
    out.px = f.x + f.rx * lat;
    out.pz = f.z + f.rz * lat;
    out.py = f.y + Math.tan(f.bank) * lat;
    return out;
  }

  /**
   * Project a world point. Searches +-range samples around hint (or the whole loop when
   * hint < 0). Returns {i, s, lat, y (surface height at the point), dist2}.
   */
  project(x, z, hint = -1, range = 40, out = {}, yHint = null) {
    const N = this.N;
    let best = -1, bestD = Infinity;
    if (hint < 0) {
      for (let i = 0; i < N; i += 2) {
        const dx = x - this.px[i], dz = z - this.pz[i];
        let d = dx * dx + dz * dz;
        if (yHint != null) { const dy = yHint - this.py[i]; d += dy * dy * 4; }
        if (d < bestD) { bestD = d; best = i; }
      }
      range = 4;
      hint = best;
    }
    bestD = Infinity; best = hint;
    for (let o = -range; o <= range; o++) {
      const i = (hint + o + N) % N;
      const dx = x - this.px[i], dz = z - this.pz[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    // refine on the segment best..next or prev..best
    const i0 = best, i1 = (best + 1) % N, im = (best - 1 + N) % N;
    const seg = (a, b) => {
      const ax = this.px[a], az = this.pz[a];
      const bx = this.px[b] - ax, bz = this.pz[b] - az;
      const l2 = bx * bx + bz * bz || 1;
      let t = ((x - ax) * bx + (z - az) * bz) / l2;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + bx * t, cz = az + bz * t;
      return { t, d: (x - cx) ** 2 + (z - cz) ** 2 };
    };
    const A = seg(i0, i1), B = seg(im, i0);
    let s, ia, t;
    if (A.d <= B.d) { ia = i0; t = A.t; } else { ia = im; t = B.t; }
    s = (ia + t) * this.step;
    const ib = (ia + 1) % N;
    const cx = this.px[ia] + (this.px[ib] - this.px[ia]) * t;
    const cz = this.pz[ia] + (this.pz[ib] - this.pz[ia]) * t;
    const cy = this.py[ia] + (this.py[ib] - this.py[ia]) * t;
    const rxx = this.rx[ia] + (this.rx[ib] - this.rx[ia]) * t;
    const rzz = this.rz[ia] + (this.rz[ib] - this.rz[ia]) * t;
    const lat = (x - cx) * rxx + (z - cz) * rzz;
    const bank = this.bank[ia] + (this.bank[ib] - this.bank[ia]) * t;
    out.i = best; out.s = s; out.lat = lat; out.y = cy + Math.tan(bank) * lat; out.cy = cy;
    out.w = this.w[ia] + (this.w[ib] - this.w[ia]) * t;
    out.bank = bank;
    out.rx = rxx; out.rz = rzz; out.tx = rzz; out.tz = -rxx;
    out.dist2 = bestD;
    return out;
  }

  /** Signed distance along the loop from a to b in (-L/2, L/2]. */
  delta(a, b) {
    let d = b - a;
    const L = this.length;
    while (d > L / 2) d -= L;
    while (d <= -L / 2) d += L;
    return d;
  }
}
