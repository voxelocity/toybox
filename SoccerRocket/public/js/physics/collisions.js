// Car vs arena, car vs ball and car vs car contact resolution.
import { V3, applyInvInertia, curve, clamp } from './math.js';
import * as K from './constants.js';

const _h = new V3(), _l = new V3(), _q = new V3(), _n = new V3(), _cp = new V3();
const _rb = new V3(), _rc = new V3(), _vb = new V3(), _vc = new V3(), _t = new V3();
const _a = new V3(), _b = new V3(), _tmp = new V3();

// ---------------------------------------------------------------------------
// Car vs world: the hitbox is approximated by a grid of spheres on its
// mid-plane (a rounded box), tested against the arena mesh.
// ---------------------------------------------------------------------------
const carContacts = [];
for (let i = 0; i < 64; i++) carContacts.push({ p: new V3(), n: new V3(), depth: 0, r: new V3(), vn0: 0, acc: 0 });

export function collideCarWorld(car, mesh) {
  if (car.isDemoed) return 0;
  const R = car.R;
  car.hitboxCenter(_h);
  const hx = car.half.x, hy = car.half.y, rho = car.half.z;
  const bound = Math.hypot(hx, hy, rho) + 2;
  const nCand = mesh.gather(_h.x - bound, _h.y - bound, _h.z - bound, _h.x + bound, _h.y + bound, _h.z + bound);
  if (nCand === 0) return 0;
  const cx = hx - rho, cy = hy - rho;
  let nc = 0;
  const NX = 5, NY = 4;
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NY; j++) {
      const lx = car.hbOffset.x - cx + (2 * cx * i) / (NX - 1);
      const ly = -cy + (2 * cy * j) / (NY - 1);
      R.mulXYZ(lx, ly, car.hbOffset.z, _a).add(car.pos);
      const k = mesh.sphere(_a.x, _a.y, _a.z, rho, nCand);
      for (let c = 0; c < k && nc < carContacts.length; c++) {
        const src = mesh.contacts[c], dst = carContacts[nc++];
        dst.p.set(src.px, src.py, src.pz); dst.n.set(src.nx, src.ny, src.nz); dst.depth = src.depth;
      }
    }
  }
  if (nc === 0) return 0;

  // positional correction (accumulated so parallel contacts do not stack)
  const corr = _b.set(0, 0, 0);
  let deepest = null;
  const order = carContacts.slice(0, nc).sort((a, b) => b.depth - a.depth);
  for (const c of order) {
    const need = c.depth - corr.dot(c.n);
    if (need > 0) corr.addScaled(c.n, need * 0.8);
    if (!deepest) deepest = c;
  }
  car.pos.add(corr);
  car.worldContact = true;
  car.worldNormal.copy(deepest.n);

  // velocity: sequential impulses
  let impact = 0;
  for (let i = 0; i < nc; i++) {
    const c = carContacts[i];
    c.r.subVectors(c.p, car.pos);
    car.velAt(c.r.x, c.r.y, c.r.z, _vc);
    c.vn0 = _vc.dot(c.n);
    c.acc = 0;
    if (-c.vn0 > impact) impact = -c.vn0;
  }
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < nc; i++) {
      const c = carContacts[i];
      const r = c.r, n = c.n;
      car.velAt(r.x, r.y, r.z, _vc);
      const vn = _vc.dot(n);
      const target = c.vn0 < -60 ? -K.CARWORLD_RESTITUTION * c.vn0 : 0;
      const k = car.invEffMass(r.x, r.y, r.z, n.x, n.y, n.z);
      let j = (target - vn) / k;
      const acc = Math.max(0, c.acc + j);
      j = acc - c.acc; c.acc = acc;
      if (j !== 0) car.applyImpulseAt(n.x * j, n.y * j, n.z * j, r.x, r.y, r.z);
    }
  }
  // Coulomb friction, bounded by the accumulated normal impulse
  for (let i = 0; i < nc; i++) {
    const c = carContacts[i];
    if (c.acc <= 0) continue;
    const r = c.r, n = c.n;
    car.velAt(r.x, r.y, r.z, _vc);
    const vn2 = _vc.dot(n);
    _t.set(_vc.x - n.x * vn2, _vc.y - n.y * vn2, _vc.z - n.z * vn2);
    const vt = _t.len();
    if (vt < 1e-4) continue;
    _t.scale(1 / vt);
    const kt = car.invEffMass(r.x, r.y, r.z, _t.x, _t.y, _t.z);
    const jt = Math.min(vt / kt, K.CARWORLD_FRICTION * c.acc);
    car.applyImpulseAt(-_t.x * jt, -_t.y * jt, -_t.z * jt, r.x, r.y, r.z);
  }
  car.clampVelocities();
  return impact;
}

// ---------------------------------------------------------------------------
// Car vs ball: exact OBB/sphere contact + rigid impulse, plus the extra
// "hit" impulse that gives car-soccer touches their punch.
// ---------------------------------------------------------------------------
export function collideCarBall(car, ball, tick, result) {
  if (car.isDemoed || ball.frozen) return false;
  const R = car.R, half = car.half, br = ball.radius;
  car.hitboxCenter(_h);
  R.mulTV(_l.subVectors(ball.pos, _h), _l);
  // quick reject
  if (Math.abs(_l.x) > half.x + br || Math.abs(_l.y) > half.y + br || Math.abs(_l.z) > half.z + br) return false;
  _q.set(clamp(_l.x, -half.x, half.x), clamp(_l.y, -half.y, half.y), clamp(_l.z, -half.z, half.z));
  _n.subVectors(_l, _q);
  let dist = _n.len(), depth;
  if (dist >= br) return false;
  if (dist > 1e-6) { _n.scale(1 / dist); depth = br - dist; } else {
    // centre inside the box: least penetration axis
    const px = half.x - Math.abs(_l.x), py = half.y - Math.abs(_l.y), pz = half.z - Math.abs(_l.z);
    if (px < py && px < pz) { _n.set(Math.sign(_l.x) || 1, 0, 0); depth = br + px; }
    else if (py < pz) { _n.set(0, Math.sign(_l.y) || 1, 0); depth = br + py; }
    else { _n.set(0, 0, Math.sign(_l.z) || 1); depth = br + pz; }
  }
  R.mulV(_n, _n); // world normal, car -> ball
  R.mulV(_q, _cp).add(_h); // contact point on car surface

  // extra impulse from pre-collision state
  let extraX = 0, extraY = 0, extraZ = 0, hasExtra = false;
  if (tick > car.ballHitTick + 1 || car.ballHitTick > tick) {
    _a.subVectors(ball.vel, car.vel);
    const relSpeed = Math.min(_a.len(), K.BALL_CAR_EXTRA_IMPULSE_MAX_DELTA_VEL);
    if (relSpeed > 0) {
      const fwd = R.col(0, _b);
      _a.subVectors(ball.pos, car.pos);
      _a.z *= K.BALL_CAR_EXTRA_IMPULSE_Z_SCALE;
      _a.normalize();
      const f = _a.dot(fwd) * (1 - K.BALL_CAR_EXTRA_IMPULSE_FORWARD_SCALE);
      _a.addScaled(fwd, -f).normalize();
      const s = relSpeed * curve(K.BALL_CAR_EXTRA_IMPULSE_CURVE, relSpeed);
      extraX = _a.x * s; extraY = _a.y * s; extraZ = _a.z * s;
      hasExtra = true;
    }
    car.ballHitTick = tick;
  }

  const bvx = ball.vel.x, bvy = ball.vel.y, bvz = ball.vel.z;

  // positional correction, split by inverse mass
  const wb = ball.invMass / (ball.invMass + car.invMass), wc = 1 - wb;
  ball.pos.addScaled(_n, depth * wb);
  car.pos.addScaled(_n, -depth * wc);

  // rigid impulse
  _rb.subVectors(_cp, ball.pos);
  _rc.subVectors(_cp, car.pos);
  ball.velAt(_rb.x, _rb.y, _rb.z, _vb);
  car.velAt(_rc.x, _rc.y, _rc.z, _vc);
  _vb.sub(_vc);
  const vn = _vb.dot(_n);
  let impulse = 0;
  if (vn < 0) {
    const kb = ball.invMass + ball.invInertia * (_tmp.crossVectors(_rb, _n).lenSq());
    const kc = car.invEffMass(_rc.x, _rc.y, _rc.z, _n.x, _n.y, _n.z);
    const jn = -(1 + K.CARBALL_RESTITUTION) * vn / (kb + kc);
    impulse = jn;
    ball.applyImpulseAt(_n.x * jn, _n.y * jn, _n.z * jn, _rb.x, _rb.y, _rb.z);
    car.applyImpulseAt(-_n.x * jn, -_n.y * jn, -_n.z * jn, _rc.x, _rc.y, _rc.z);
    // friction
    ball.velAt(_rb.x, _rb.y, _rb.z, _vb);
    car.velAt(_rc.x, _rc.y, _rc.z, _vc);
    _vb.sub(_vc);
    const vn2 = _vb.dot(_n);
    _t.set(_vb.x - _n.x * vn2, _vb.y - _n.y * vn2, _vb.z - _n.z * vn2);
    const vt = _t.len();
    if (vt > 1e-4) {
      _t.scale(1 / vt);
      const kbt = ball.invMass + ball.invInertia * (_tmp.crossVectors(_rb, _t).lenSq());
      const kct = car.invEffMass(_rc.x, _rc.y, _rc.z, _t.x, _t.y, _t.z);
      const jt = Math.min(vt / (kbt + kct), K.CARBALL_FRICTION * jn);
      ball.applyImpulseAt(-_t.x * jt, -_t.y * jt, -_t.z * jt, _rb.x, _rb.y, _rb.z);
      car.applyImpulseAt(_t.x * jt, _t.y * jt, _t.z * jt, _rc.x, _rc.y, _rc.z);
    }
  }
  if (hasExtra) { ball.vel.x += extraX; ball.vel.y += extraY; ball.vel.z += extraZ; }
  ball.vel.clampLength(K.BALL_MAX_SPEED);
  ball.angVel.clampLength(K.BALL_MAX_ANG_SPEED);
  car.clampVelocities();
  if (result) {
    result.car = car;
    result.point.copy(_cp);
    result.normal.copy(_n);
    result.dv = Math.hypot(ball.vel.x - bvx, ball.vel.y - bvy, ball.vel.z - bvz);
    result.impulse = impulse;
    result.newTouch = hasExtra;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Car vs car: OBB/OBB separating axis test, rigid impulse, bumps and demos.
// ---------------------------------------------------------------------------
const _axA = [new V3(), new V3(), new V3()], _axB = [new V3(), new V3(), new V3()];
const _ca = new V3(), _cb = new V3(), _T = new V3(), _L = new V3(), _best = new V3();
const _verts = [];
for (let i = 0; i < 8; i++) _verts.push(new V3());

function boxVerts(R, c, half, out) {
  let k = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    R.mulXYZ(sx * half.x, sy * half.y, sz * half.z, out[k]).add(c); k++;
  }
}
function insideBox(R, c, half, p, tol) {
  R.mulTV(_tmp.subVectors(p, c), _tmp);
  return Math.abs(_tmp.x) <= half.x + tol && Math.abs(_tmp.y) <= half.y + tol && Math.abs(_tmp.z) <= half.z + tol;
}

function obbSat(A, B) {
  A.hitboxCenter(_ca); B.hitboxCenter(_cb);
  for (let i = 0; i < 3; i++) { A.R.col(i, _axA[i]); B.R.col(i, _axB[i]); }
  _T.subVectors(_cb, _ca);
  const ea = [A.half.x, A.half.y, A.half.z], eb = [B.half.x, B.half.y, B.half.z];
  let minPen = Infinity;
  const test = (L) => {
    const l = L.len();
    if (l < 1e-6) return true;
    L.scale(1 / l);
    let ra = 0, rb = 0;
    for (let i = 0; i < 3; i++) { ra += ea[i] * Math.abs(_axA[i].dot(L)); rb += eb[i] * Math.abs(_axB[i].dot(L)); }
    const d = _T.dot(L);
    const pen = ra + rb - Math.abs(d);
    if (pen <= 0) return false;
    if (pen < minPen) { minPen = pen; _best.copy(L); if (d < 0) _best.scale(-1); }
    return true;
  };
  for (let i = 0; i < 3; i++) if (!test(_L.copy(_axA[i]))) return 0;
  for (let i = 0; i < 3; i++) if (!test(_L.copy(_axB[i]))) return 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (!test(_L.crossVectors(_axA[i], _axB[j]))) return 0;
  return minPen;
}

const bumpResult = { attacker: null, victim: null, demo: false, speed: 0 };

export function collideCarCar(A, B, events) {
  if (A.isDemoed || B.isDemoed) return;
  if (A.pos.distTo(B.pos) > 200) return;
  const depth = obbSat(A, B);
  if (depth <= 0) return;
  const n = _n.copy(_best); // A -> B
  // contact point: average of vertices inside the other box
  let cnt = 0;
  _cp.set(0, 0, 0);
  boxVerts(B.R, _cb, B.half, _verts);
  for (const v of _verts) if (insideBox(A.R, _ca, A.half, v, 1)) { _cp.add(v); cnt++; }
  boxVerts(A.R, _ca, A.half, _verts);
  for (const v of _verts) if (insideBox(B.R, _cb, B.half, v, 1)) { _cp.add(v); cnt++; }
  if (cnt) _cp.scale(1 / cnt); else _cp.addVectors(_ca, _cb).scale(0.5);

  // bumps / demos, evaluated from pre-collision velocities
  const bumps = [];
  for (const [P, Q] of [[A, B], [B, A]]) {
    if (P.bumpCooldown > 0 && P.bumpOther === Q.id) continue;
    _a.subVectors(Q.pos, P.pos);
    if (P.vel.dot(_a) <= 0) continue;
    const speed = P.vel.len();
    if (speed < 1e-3) continue;
    const velDir = P.vel.clone().scale(1 / speed);
    const dirTo = _a.clone().normalize();
    const towards = P.vel.dot(dirTo);
    const away = Q.vel.dot(velDir);
    if (towards <= away) continue;
    P.R.mulTV(_tmp.subVectors(_cp, P.pos), _tmp);
    if (_tmp.x <= K.BUMP_MIN_FORWARD_DIST) continue;
    const demo = P.isSupersonic && P.team !== Q.team;
    bumps.push({ P, Q, demo, towards, velDir });
    P.bumpOther = Q.id; P.bumpCooldown = K.BUMP_COOLDOWN_TIME;
  }

  // rigid impulse
  const wa = 0.5;
  A.pos.addScaled(n, -depth * wa);
  B.pos.addScaled(n, depth * (1 - wa));
  _ca.subVectors(_cp, A.pos); _cb.subVectors(_cp, B.pos);
  B.velAt(_cb.x, _cb.y, _cb.z, _vb);
  A.velAt(_ca.x, _ca.y, _ca.z, _vc);
  _vb.sub(_vc);
  const vn = _vb.dot(n);
  if (vn < 0) {
    const ka = A.invEffMass(_ca.x, _ca.y, _ca.z, n.x, n.y, n.z);
    const kb = B.invEffMass(_cb.x, _cb.y, _cb.z, n.x, n.y, n.z);
    const jn = -(1 + K.CARCAR_RESTITUTION) * vn / (ka + kb);
    B.applyImpulseAt(n.x * jn, n.y * jn, n.z * jn, _cb.x, _cb.y, _cb.z);
    A.applyImpulseAt(-n.x * jn, -n.y * jn, -n.z * jn, _ca.x, _ca.y, _ca.z);
    B.velAt(_cb.x, _cb.y, _cb.z, _vb);
    A.velAt(_ca.x, _ca.y, _ca.z, _vc);
    _vb.sub(_vc);
    const vn2 = _vb.dot(n);
    _t.set(_vb.x - n.x * vn2, _vb.y - n.y * vn2, _vb.z - n.z * vn2);
    const vt = _t.len();
    if (vt > 1e-4) {
      _t.scale(1 / vt);
      const kat = A.invEffMass(_ca.x, _ca.y, _ca.z, _t.x, _t.y, _t.z);
      const kbt = B.invEffMass(_cb.x, _cb.y, _cb.z, _t.x, _t.y, _t.z);
      const jt = Math.min(vt / (kat + kbt), K.CARCAR_FRICTION * jn);
      B.applyImpulseAt(-_t.x * jt, -_t.y * jt, -_t.z * jt, _cb.x, _cb.y, _cb.z);
      A.applyImpulseAt(_t.x * jt, _t.y * jt, _t.z * jt, _ca.x, _ca.y, _ca.z);
    }
    if (-vn > 150) events.push({ type: 'carCar', a: A, b: B, speed: -vn, point: _cp.clone() });
  }

  for (const b of bumps) {
    if (b.demo) {
      b.Q.demolish();
      events.push({ type: 'demo', attacker: b.P, victim: b.Q, point: b.Q.pos.clone() });
    } else {
      const ground = b.Q.isOnGround;
      const base = curve(ground ? K.BUMP_VEL_GROUND_CURVE : K.BUMP_VEL_AIR_CURVE, b.towards);
      const upDir = ground ? b.Q.R.col(2, new V3()) : new V3(0, 0, 1);
      b.Q.vel.addScaled(b.velDir, base).addScaled(upDir, curve(K.BUMP_UPWARD_VEL_CURVE, b.towards));
      b.Q.clampVelocities();
      events.push({ type: 'bump', attacker: b.P, victim: b.Q, speed: b.towards, point: _cp.clone() });
    }
  }
  A.clampVelocities(); B.clampVelocities();
}

export { applyInvInertia };
