// Ball rigid body: a solid sphere with drag, Coulomb friction against the
// arena (which yields the characteristic spin-on-bounce) and restitution.
import { V3 } from './math.js';
import * as K from './constants.js';

const _r = new V3(), _v = new V3(), _t = new V3(), _a = new V3();

export class Ball {
  constructor() {
    this.radius = K.BALL_RADIUS;
    this.mass = K.BALL_MASS;
    this.invMass = 1 / this.mass;
    this.invInertia = 1 / (0.4 * this.mass * this.radius * this.radius);
    this.pos = new V3(0, 0, K.BALL_REST_Z);
    this.vel = new V3();
    this.angVel = new V3();
    this.lastImpact = 0;
    this.lastNormal = new V3(0, 0, 1);
    this.frozen = false;
  }

  reset(x = 0, y = 0, z = K.BALL_REST_Z) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
  }

  copyFrom(b) {
    this.pos.copy(b.pos); this.vel.copy(b.vel); this.angVel.copy(b.angVel);
    return this;
  }

  velAt(rx, ry, rz, out) {
    const w = this.angVel;
    return out.set(this.vel.x + w.y * rz - w.z * ry, this.vel.y + w.z * rx - w.x * rz, this.vel.z + w.x * ry - w.y * rx);
  }

  applyImpulseAt(jx, jy, jz, rx, ry, rz) {
    this.vel.x += jx * this.invMass; this.vel.y += jy * this.invMass; this.vel.z += jz * this.invMass;
    const k = this.invInertia;
    this.angVel.x += (ry * jz - rz * jy) * k;
    this.angVel.y += (rz * jx - rx * jz) * k;
    this.angVel.z += (rx * jy - ry * jx) * k;
  }

  preStep(dt) {
    if (this.frozen) return;
    this.vel.z += K.GRAVITY_Z * dt;
    this.vel.scale(Math.pow(1 - K.BALL_DRAG, dt));
  }

  integrate(dt) {
    if (this.frozen) return;
    this.vel.clampLength(K.BALL_MAX_SPEED);
    this.angVel.clampLength(K.BALL_MAX_ANG_SPEED);
    this.pos.addScaled(this.vel, dt);
  }

  /**
   * Resolve contact with the arena. Returns the largest approach speed of a
   * new impact this tick (0 when resting / no contact).
   */
  collideWorld(mesh) {
    if (this.frozen) return 0;
    const n = mesh.sphere(this.pos.x, this.pos.y, this.pos.z, this.radius);
    let impact = 0;
    const R = this.radius, m = this.mass;
    for (let i = 0; i < n; i++) {
      const c = mesh.contacts[i];
      const nx = c.nx, ny = c.ny, nz = c.nz;
      // push out
      this.pos.x += nx * c.depth; this.pos.y += ny * c.depth; this.pos.z += nz * c.depth;
      _r.set(-nx * R, -ny * R, -nz * R);
      this.velAt(_r.x, _r.y, _r.z, _v);
      const vn = _v.x * nx + _v.y * ny + _v.z * nz;
      if (vn >= 0) continue;
      const e = -vn > 10 ? K.BALL_RESTITUTION : 0;
      const jn = -(1 + e) * vn * m;
      this.vel.x += nx * jn / m; this.vel.y += ny * jn / m; this.vel.z += nz * jn / m;
      if (-vn > impact) { impact = -vn; this.lastNormal.set(nx, ny, nz); }
      // friction at the contact point
      this.velAt(_r.x, _r.y, _r.z, _v);
      const vn2 = _v.x * nx + _v.y * ny + _v.z * nz;
      _t.set(_v.x - nx * vn2, _v.y - ny * vn2, _v.z - nz * vn2);
      const vt = _t.len();
      if (vt > 1e-6) {
        _t.scale(1 / vt);
        const kT = 1 / m + R * R * this.invInertia; // r is parallel to n
        const jt = Math.min(vt / kT, K.BALL_FRICTION * jn);
        this.applyImpulseAt(-_t.x * jt, -_t.y * jt, -_t.z * jt, _r.x, _r.y, _r.z);
      }
    }
    this.lastImpact = impact;
    return impact;
  }
}

/**
 * Predicts the ball trajectory (ignoring cars). Writes into `out`, an array of
 * { t, x, y, z, vx, vy, vz } slots, reusing them. Returns the slot count used.
 */
const _pb = new Ball();
export function predictBall(ball, mesh, seconds, step, out) {
  _pb.copyFrom(ball);
  const sub = Math.max(1, Math.round(step * K.TICK_RATE));
  const n = Math.floor(seconds / step);
  for (let i = 0; i < n; i++) {
    for (let s = 0; s < sub; s++) {
      _pb.preStep(K.DT); _pb.integrate(K.DT); _pb.collideWorld(mesh);
    }
    let o = out[i];
    if (!o) o = out[i] = { t: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    o.t = (i + 1) * sub * K.DT;
    o.x = _pb.pos.x; o.y = _pb.pos.y; o.z = _pb.pos.z;
    o.vx = _pb.vel.x; o.vy = _pb.vel.y; o.vz = _pb.vel.z;
  }
  return n;
}
