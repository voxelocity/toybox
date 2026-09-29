// Low-poly geometry builder. Accumulates flat-shaded triangles with per-vertex
// colour, material id (cars), emissive weight (world) and uv, under a transform
// stack. Mirrored transforms flip winding automatically.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _n = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
const _col = new THREE.Color();

export class Geo {
  constructor() {
    this.pos = []; this.nrm = []; this.col = []; this.mat = []; this.emit = []; this.uv = [];
    this.stack = [new THREE.Matrix4()];
    this.nstack = [new THREE.Matrix3()];
    this.flip = [false];
    this.c = [1, 1, 1];
    this.m = 0;
    this.e = 0;
    this.uvMode = null; // null | fn(worldPoint, normal) -> [u,v]
  }

  get M() { return this.stack[this.stack.length - 1]; }

  push(matrix) {
    const m = this.M.clone().multiply(matrix);
    this.stack.push(m);
    this.nstack.push(new THREE.Matrix3().getNormalMatrix(m));
    this.flip.push(m.determinant() < 0);
    return this;
  }
  pop() { this.stack.pop(); this.nstack.pop(); this.flip.pop(); return this; }

  /** Run fn with an extra transform built from position/rotation(euler xyz)/scale. */
  at(p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], fn) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...(typeof s === 'number' ? [s, s, s] : s)));
    this.push(m); fn(this); this.pop();
    return this;
  }

  /** Run fn twice: as-is and mirrored across z = 0 (car centreline). */
  mirrorZ(fn) {
    fn(this, 1);
    this.push(new THREE.Matrix4().makeScale(1, 1, -1)); fn(this, -1); this.pop();
    return this;
  }
  mirrorX(fn) {
    fn(this, 1);
    this.push(new THREE.Matrix4().makeScale(-1, 1, 1)); fn(this, -1); this.pop();
    return this;
  }

  color(c, m = this.m, e = this.e) {
    if (typeof c === 'number' || typeof c === 'string') { _col.set(c); this.c = [_col.r, _col.g, _col.b]; } else if (c) this.c = c;
    this.m = m; this.e = e;
    return this;
  }
  set(c, m, e = 0) { return this.color(c, m, e); }

  _pushVert(p, n, uv) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.col.push(this.c[0], this.c[1], this.c[2]);
    this.mat.push(this.m);
    this.emit.push(this.e);
    if (uv) this.uv.push(uv[0], uv[1]);
    else if (this.uvMode) { const t = this.uvMode(p, n); this.uv.push(t[0], t[1]); }
    else this.uv.push(0, 0);
  }

  /** Triangle from three local points (arrays). Optional local normals for smooth shading, optional uvs. */
  tri(a, b, c, na, nb, nc, uva, uvb, uvc) {
    const M = this.M;
    _a.set(a[0], a[1], a[2]).applyMatrix4(M);
    _b.set(b[0], b[1], b[2]).applyMatrix4(M);
    _c.set(c[0], c[1], c[2]).applyMatrix4(M);
    const flip = this.flip[this.flip.length - 1];
    if (flip) {
      const t = _b.clone(); _b.copy(_c); _c.copy(t);
      const tn = nb; nb = nc; nc = tn;
      const tu = uvb; uvb = uvc; uvc = tu;
    }
    _e1.subVectors(_b, _a); _e2.subVectors(_c, _a);
    _n.crossVectors(_e1, _e2);
    const len = _n.length();
    if (len < 1e-10) return this;
    _n.multiplyScalar(1 / len);
    if (na) {
      const N = this.nstack[this.nstack.length - 1];
      const n0 = new THREE.Vector3(...na).applyMatrix3(N).normalize();
      const n1 = new THREE.Vector3(...nb).applyMatrix3(N).normalize();
      const n2 = new THREE.Vector3(...nc).applyMatrix3(N).normalize();
      this._pushVert(_a, n0, uva); this._pushVert(_b, n1, uvb); this._pushVert(_c, n2, uvc);
    } else {
      this._pushVert(_a, _n, uva); this._pushVert(_b, _n, uvb); this._pushVert(_c, _n, uvc);
    }
    return this;
  }

  /** Triangle with explicit per-vertex colours (soft glows). */
  triCol(a, b, c, ca, cb, cc) {
    const n0 = this.pos.length;
    this.tri(a, b, c);
    const cols = [ca, cb, cc];
    if (this.pos.length > n0) {
      const flip = this.flip[this.flip.length - 1];
      const order = flip ? [0, 2, 1] : [0, 1, 2];
      for (let k = 0; k < 3; k++) { const col = cols[order[k]]; const o = this.col.length - 9 + k * 3; this.col[o] = col[0]; this.col[o + 1] = col[1]; this.col[o + 2] = col[2]; }
    }
    return this;
  }

  quad(a, b, c, d, uvs) {
    if (uvs) { this.tri(a, b, c, null, null, null, uvs[0], uvs[1], uvs[2]); this.tri(a, c, d, null, null, null, uvs[0], uvs[2], uvs[3]); }
    else { this.tri(a, b, c); this.tri(a, c, d); }
    return this;
  }

  /** Convex polygon fan (CCW from the front). */
  poly(pts) {
    for (let i = 1; i < pts.length - 1; i++) this.tri(pts[0], pts[i], pts[i + 1]);
    return this;
  }

  /** Arbitrary hexahedron from 8 corners: bottom ring b0..b3, top ring t0..t3, both CCW seen from above. */
  hexa(b, t, skip = {}) {
    if (!skip.bottom) this.quad(b[0], b[3], b[2], b[1]);
    if (!skip.top) this.quad(t[0], t[1], t[2], t[3]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      if (skip['s' + i]) continue;
      this.quad(b[i], b[j], t[j], t[i]);
    }
    return this;
  }

  /** Axis-aligned box centred at (x,y,z). taper shrinks the top face (x,z) by factors. */
  box(x, y, z, w, h, d, taper = null, skip = {}) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const tx = taper ? taper[0] : 1, tz = taper ? taper[1] : 1;
    const ox = taper && taper[2] ? taper[2] : 0;
    const b = [[x - hw, y - hh, z + hd], [x + hw, y - hh, z + hd], [x + hw, y - hh, z - hd], [x - hw, y - hh, z - hd]];
    const t = [[x - hw * tx + ox, y + hh, z + hd * tz], [x + hw * tx + ox, y + hh, z + hd * tz], [x + hw * tx + ox, y + hh, z - hd * tz], [x - hw * tx + ox, y + hh, z - hd * tz]];
    return this.hexa(b, t, skip);
  }

  /** Box with chamfered vertical edges (8-sided in plan). */
  cbox(x, y, z, w, h, d, ch = 0.1, skip = {}) {
    const hw = w / 2, hd = d / 2, y0 = y - h / 2, y1 = y + h / 2;
    const ring = [[hw - ch, hd], [hw, hd - ch], [hw, -hd + ch], [hw - ch, -hd], [-hw + ch, -hd], [-hw, -hd + ch], [-hw, hd - ch], [-hw + ch, hd]];
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n];
      this.quad([x + ax, y0, z + az], [x + bx, y0, z + bz], [x + bx, y1, z + bz], [x + ax, y1, z + az]);
    }
    if (!skip.top) this.poly(ring.map(([a, b]) => [x + a, y1, z + b]));
    if (!skip.bottom) this.poly(ring.map(([a, b]) => [x + a, y0, z + b]).reverse());
    return this;
  }

  /** Cylinder / cone frustum between two points. */
  cyl(p0, p1, r0, r1 = r0, seg = 8, caps = true, rot = 0) {
    const A = new THREE.Vector3(...p0), B = new THREE.Vector3(...p1);
    const axis = new THREE.Vector3().subVectors(B, A);
    const len = axis.length();
    axis.normalize();
    const tmp = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(axis, tmp).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    const ring = (C, r) => {
      const out = [];
      for (let i = 0; i < seg; i++) {
        const a = rot + (i / seg) * Math.PI * 2;
        out.push(C.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r).toArray());
      }
      return out;
    };
    const ra = ring(A, r0), rb = ring(B, r1);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.quad(ra[i], ra[j], rb[j], rb[i]);
    }
    if (caps) {
      if (r0 > 0) this.poly([...ra].reverse());
      if (r1 > 0) this.poly(rb);
    }
    void len;
    return this;
  }

  /** Surface of revolution around local X axis. profile: [[r, x], ...]. Faces point to the
   *  right of the profile direction in (x, r): a profile running toward +x faces outward. */
  lathe(profile, seg = 16, smooth = false, a0 = 0, a1 = Math.PI * 2) {
    const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
    const steps = seg;
    for (let k = 0; k < profile.length - 1; k++) {
      const [r0, x0] = profile[k], [r1, x1] = profile[k + 1];
      // profile tangent for smooth normals
      const dx = x1 - x0, dr = r1 - r0;
      const nl = Math.hypot(dx, dr) || 1;
      const nx = -dr / nl, nr = dx / nl;
      for (let i = 0; i < steps; i++) {
        const t0 = a0 + ((a1 - a0) * i) / steps, t1 = a0 + ((a1 - a0) * (i + 1)) / steps;
        if (!full && i >= steps) break;
        const p = (r, x, t) => [x, Math.cos(t) * r, Math.sin(t) * r];
        const q00 = p(r0, x0, t0), q01 = p(r0, x0, t1), q11 = p(r1, x1, t1), q10 = p(r1, x1, t0);
        if (smooth) {
          const n = (t) => [nx, Math.cos(t) * nr, Math.sin(t) * nr];
          this.tri(q00, q01, q11, n(t0), n(t1), n(t1));
          this.tri(q00, q11, q10, n(t0), n(t1), n(t0));
        } else {
          this.quad(q00, q01, q11, q10);
        }
      }
    }
    return this;
  }

  /** Connect consecutive rings of equal length. Rings ordered so that the outward face is CCW. */
  loft(rings, capStart = true, capEnd = true, closed = true) {
    const n = rings[0].length;
    for (let r = 0; r < rings.length - 1; r++) {
      const A = rings[r], B = rings[r + 1];
      const lim = closed ? n : n - 1;
      for (let i = 0; i < lim; i++) {
        const j = (i + 1) % n;
        this.quad(A[i], A[j], B[j], B[i]);
      }
    }
    if (capStart) this.poly([...rings[0]].reverse());
    if (capEnd) this.poly(rings[rings.length - 1]);
    return this;
  }

  /** Extrude a 2D shape (in the local XY plane) along +Z by depth (centred). Handles concave shapes. */
  extrude(shape, depth, bevelTop = true) {
    const pts = shape.map(([x, y]) => new THREE.Vector2(x, y));
    if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    const z0 = -depth / 2, z1 = depth / 2;
    for (const [a, b, c] of tris) {
      this.tri([pts[a].x, pts[a].y, z1], [pts[b].x, pts[b].y, z1], [pts[c].x, pts[c].y, z1]);
      this.tri([pts[a].x, pts[a].y, z0], [pts[c].x, pts[c].y, z0], [pts[b].x, pts[b].y, z0]);
    }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      this.quad([p.x, p.y, z0], [q.x, q.y, z0], [q.x, q.y, z1], [p.x, p.y, z1]);
    }
    void bevelTop;
    return this;
  }

  /** Low-poly sphere / ellipsoid. */
  sphere(x, y, z, rx, ry = rx, rz = rx, ws = 8, hs = 6) {
    const P = (i, j) => {
      const th = (i / ws) * Math.PI * 2, ph = (j / hs) * Math.PI;
      return [x + Math.sin(ph) * Math.cos(th) * rx, y + Math.cos(ph) * ry, z + Math.sin(ph) * Math.sin(th) * rz];
    };
    for (let j = 0; j < hs; j++) for (let i = 0; i < ws; i++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      if (j === 0) this.tri(a, c, d);
      else if (j === hs - 1) this.tri(a, b, c);
      else this.quad(a, b, c, d);
    }
    return this;
  }

  /** Flat ring (annulus) in local YZ plane facing +X. */
  ring(x, r0, r1, seg = 16) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2, b = ((i + 1) / seg) * Math.PI * 2;
      this.quad([x, Math.cos(a) * r0, Math.sin(a) * r0], [x, Math.cos(a) * r1, Math.sin(a) * r1], [x, Math.cos(b) * r1, Math.sin(b) * r1], [x, Math.cos(b) * r0, Math.sin(b) * r0]);
    }
    return this;
  }

  /** Flat disc in local YZ plane facing +X. */
  disc(x, r, seg = 16) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2, b = ((i + 1) / seg) * Math.PI * 2;
      this.tri([x, 0, 0], [x, Math.cos(a) * r, Math.sin(a) * r], [x, Math.cos(b) * r, Math.sin(b) * r]);
    }
    return this;
  }

  /** Torus around local X axis. */
  torus(x, R, r, seg = 16, tseg = 6) {
    for (let i = 0; i < seg; i++) for (let j = 0; j < tseg; j++) {
      const P = (ii, jj) => {
        const a = (ii / seg) * Math.PI * 2, b = (jj / tseg) * Math.PI * 2;
        const rr = R + Math.cos(b) * r;
        return [x + Math.sin(b) * r, Math.cos(a) * rr, Math.sin(a) * rr];
      };
      this.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1));
    }
    return this;
  }

  get triCount() { return this.pos.length / 9; }

  merge(other) {
    for (const k of ['pos', 'nrm', 'col', 'mat', 'emit', 'uv']) { const src = other[k], dst = this[k]; for (let i = 0; i < src.length; i++) dst.push(src[i]); }
    return this;
  }

  /** attrs: which optional attributes to emit: { color, mat, emit, uv } */
  build(attrs = { color: true }) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    if (attrs.color !== false) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (attrs.mat) g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    if (attrs.emit) g.setAttribute('aEmit', new THREE.Float32BufferAttribute(this.emit, 1));
    if (attrs.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export const V = (x, y, z) => [x, y, z];
void _v;
