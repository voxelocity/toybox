// Arcade vehicle. Physics yaw is the direction of travel; the drift angle is
// a visual offset, so a drift can never turn into a spin. Walls deflect the
// car along the barrier instead of stopping it. Every racer (player and AI)
// drives through the same inputs.
import * as THREE from 'three';

const GRAV = 34;
const _m = new THREE.Matrix4(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();

export const DRIFT_LEVELS = [0.5, 1.15, 1.95];
export const DRIFT_BOOST = [0.55, 0.95, 1.5];

export class Vehicle {
  constructor(opts) {
    this.id = opts.id;
    this.name = opts.name;
    this.model = opts.model;
    this.isPlayer = !!opts.isPlayer;
    this.track = opts.track;
    this.race = opts.race;
    this.color = opts.color || '#ffffff';
    this.setStats(opts.stats, opts.cfg);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.latVel = 0;
    this.vy = 0;
    this.grounded = true;
    this.airT = 0;
    this.input = { steer: 0, throttle: 0, brake: 0, drift: false, driftPressed: false, driftReleased: false };
    this.drift = { on: false, dir: 0, t: 0, level: 0, pending: 0, hop: 0 };
    this.boostT = 0; this.boostMul = 1; this.boostKind = '';
    this.spinT = 0; this.spinDur = 0; this.spinTurns = 2; this.tumble = false; this.squashT = 0; this.hackT = 0;
    this.invulnT = 0; this.shieldT = 0;
    this.visYaw = 0; this.visRoll = 0; this.visPitch = 0; this.driftVis = 0;
    this.trick = { t: 0, kind: 0, ready: false, done: false };
    this.hint = -1;
    this.surf = {};
    this.s = 0; this.lap = 0; this.progress = 0; this.lastS = 0; this.checkpoint = 0; this.finished = false; this.finishTime = 0;
    this.place = 0;
    this.item = null; this.itemCount = 0; this.rolling = 0;
    this.wrongWayT = 0;
    this.wallHitT = 0;
    this.upSmooth = new THREE.Vector3(0, 1, 0);
    this.radius = 1.45;
    this.slip = 0;
    this.lastSafe = { s: 0, lat: 0 };
    this.stuckT = 0;
    this.slipstream = 0;
    this.events = [];
    this.respawnT = 0;
    this.rubber = 1;
    this.speedCap = 1;
  }

  setStats(st, cfg) {
    this.stats = st;
    this.cfg = cfg;
    this.vmax = 38.5 + st.spd * 1.65;
    this.accel = 17 + st.acc * 2.5;
    this.yawRate = 1.5 + st.hnd * 0.075;
    this.grip = 6 + st.hnd * 0.45;
    this.driftTurn = 0.95 + st.drf * 0.035;
    this.driftCharge = 0.82 + st.drf * 0.045;
    this.mass = 0.75 + st.wgt * 0.11;
    this.lifted = cfg && cfg.height === 'lifted';
    this.takeyari = false;
  }

  place0(s, lat) {
    const p = this.track.path.point(s, lat);
    this.pos.set(p.px, p.py + 0.02, p.pz);
    this.yaw = Math.atan2(-p.tz, p.tx);
    this.visYaw = this.yaw;
    this.speed = 0; this.latVel = 0; this.vy = 0;
    this.hint = p.i;
    this.s = this.track.path.wrapS(s);
    this.lastS = this.s;
    this.grounded = true;
    this.lastSafe = { s, lat };
  }

  get forward() { return _f.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }

  boost(dur, mul = 1.3, kind = 'mt') {
    const extra = this.takeyari && kind !== 'pad' ? 1.15 : 1;
    this.boostT = Math.max(this.boostT, dur * extra);
    this.boostMul = Math.max(this.boostT > dur * extra - 0.01 ? mul : this.boostMul, mul);
    this.boostKind = kind;
    this.events.push({ type: 'boost', kind, dur });
  }

  /** Hit reactions. kind: 'spin' | 'tumble' | 'squash' | 'bump' */
  hit(kind = 'spin', from = null) {
    if (this.invulnT > 0 || this.ryuT > 0 || this.respawnT > 0) return false;
    if (this.shieldT > 0 && kind !== 'bump') { this.shieldT = 0; this.invulnT = 0.6; this.events.push({ type: 'shieldPop' }); return false; }
    if (kind === 'bump') { this.speed *= 0.85; return true; }
    if (kind === 'hack') {
      // Glitch Storm: engine hacked - lose speed and wobble, but keep control (no spin)
      this.hackT = 1.8; this.speed *= 0.75;
      this.drift.on = false; this.drift.t = 0; this.drift.level = 0;
      this.boostT = 0;
      this.invulnT = 1.2;
      this.events.push({ type: 'hit', kind, from });
      return true;
    }
    this.drift.on = false; this.drift.t = 0; this.drift.level = 0;
    this.boostT = 0;
    this.spinDur = kind === 'tumble' ? 1.45 : kind === 'squash' ? 1.3 : 1.05;
    this.spinT = this.spinDur;
    this.spinTurns = kind === 'tumble' ? 1 : 2;
    this.tumble = kind === 'tumble';
    this.spinKind = kind;
    if (kind === 'tumble') { this.vy = 11; this.grounded = false; }
    if (kind === 'squash') this.squashT = 1.3;
    this.invulnT = this.spinDur + 1.1;
    this.events.push({ type: 'hit', kind, from });
    return true;
  }

  update(dt) {
    const tr = this.track;
    const inp = this.input;
    const path = tr.path;
    this.events.length = 0;
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.shieldT = Math.max(0, this.shieldT - dt);
    this.squashT = Math.max(0, this.squashT - dt);
    this.wallHitT = Math.max(0, this.wallHitT - dt);
    if (this.respawnT > 0) { this._respawnTick(dt); return; }
    const spinning = this.spinT > 0;
    if (spinning) this.spinT = Math.max(0, this.spinT - dt);
    const ryu = this.ryuT > 0;

    // ---------- surface
    const S = tr.surface(this.pos.x, this.pos.z, this.hint, this.surf, this.pos.y);
    this.hint = S.i;
    const offF = S.offroad < 1 && this.grounded ? (this.lifted ? 1 - (1 - S.offroad) * 0.45 : S.offroad) : 1;
    this.offroad = offF < 1;

    // ---------- targets
    let vmax = this.vmax * this.rubber * this.speedCap;
    if (this.boostT > 0) { vmax *= this.boostMul; this.boostT -= dt; }
    else if (offF < 1) vmax *= offF;
    if (ryu) vmax = this.vmax * 1.45;
    if (this.slipstream > 1.2) vmax *= 1.08;
    const hacked = this.hackT > 0;
    if (hacked) { this.hackT = Math.max(0, this.hackT - dt); vmax *= 0.55; }

    let throttle = spinning ? 0 : inp.throttle;
    let brake = spinning ? 0 : inp.brake;
    let steer = spinning ? 0 : inp.steer;
    if (hacked) steer = Math.max(-1, Math.min(1, steer + Math.sin(this.hackT * 23) * 0.3));
    if (this.boostT > 0) throttle = 1;

    // ---------- drift state machine
    const d = this.drift;
    if (!spinning && this.grounded && inp.driftPressed && Math.abs(this.speed) > 14) {
      d.hop = 0.22;
      this.vy = 4.2; this.grounded = false; this.airT = 0;
      if (Math.abs(steer) > 0.2) this._startDrift(Math.sign(steer));
      else d.pending = 0.28;
    }
    if (d.pending > 0) {
      d.pending -= dt;
      if (Math.abs(steer) > 0.25 && inp.drift) { this._startDrift(Math.sign(steer)); d.pending = 0; }
    }
    // tricks off ramps
    if (!this.grounded && this.trick.ready && inp.driftPressed && !this.trick.done) {
      this.trick.done = true; this.trick.t = 0.55; this.trick.kind = (Math.random() * 3) | 0;
      this.events.push({ type: 'trick' });
    }
    if (d.on) {
      if (!inp.drift || spinning || Math.abs(this.speed) < 10 || ryu) {
        // release
        if (d.level > 0 && !spinning && !ryu) this.boost(DRIFT_BOOST[d.level - 1], 1.24 + d.level * 0.03, 'mt' + d.level);
        d.on = false; d.t = 0; d.level = 0;
      } else {
        const k = steer * d.dir;
        d.t += dt * this.driftCharge * (0.75 + 0.55 * Math.max(0, k) + (this.grounded ? 0 : -0.75));
        const lvl = d.t > DRIFT_LEVELS[2] ? 3 : d.t > DRIFT_LEVELS[1] ? 2 : d.t > DRIFT_LEVELS[0] ? 1 : 0;
        if (lvl > d.level) this.events.push({ type: 'driftLevel', level: lvl });
        d.level = lvl;
      }
    }

    // ---------- longitudinal
    const sp = this.speed;
    if (ryu) {
      this.speed += (vmax - sp) * Math.min(1, dt * 3);
    } else if (brake > 0 && sp > 0.5) {
      this.speed -= 46 * brake * dt;
    } else if (brake > 0 && throttle < 0.1) {
      this.speed = Math.max(-13, sp - 22 * dt);
    } else if (throttle > 0) {
      if (sp < vmax) {
        const a = this.boostT > 0 ? Math.max(this.accel * 2.6, 70) : this.accel;
        const k = Math.max(0, 1 - Math.pow(Math.max(0, sp) / vmax, 1.7));
        this.speed += a * throttle * Math.max(k, this.boostT > 0 ? 0.6 : 0.02) * dt;
        if (sp < 0) this.speed += 30 * dt;
      } else {
        this.speed -= (sp - vmax) * Math.min(1, dt * 1.6);
      }
    } else {
      this.speed -= Math.sign(sp) * Math.min(Math.abs(sp), (5 + 0.004 * sp * sp) * dt);
    }
    if (spinning) this.speed *= Math.pow(this.spinKind === 'squash' ? 0.2 : 0.42, dt);
    if (!this.grounded && !ryu) this.speed -= this.speed * 0.02 * dt;

    // ---------- yaw
    const v = this.speed;
    const vf = Math.min(1, Math.abs(v) / 9) * (1 - 0.3 * Math.pow(Math.min(1, Math.abs(v) / this.vmax), 2));
    let yawRate = 0;
    if (ryu) {
      yawRate = this._autoSteer(dt) * 2.4;
    } else if (d.on) {
      const k = steer * d.dir;
      yawRate = -d.dir * this.yawRate * this.driftTurn * (0.72 + 0.55 * k) * Math.min(1, Math.abs(v) / 14);
    } else {
      yawRate = -steer * this.yawRate * vf * Math.sign(v || 1);
      if (!this.grounded) yawRate *= 0.5;
    }
    this.yaw += yawRate * dt;

    // ---------- lateral slip (grip) & velocity
    const fwd = _f.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const right = _r.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // slip builds from cornering at speed, grip pulls it back
    const cornering = -yawRate * v;
    const slipTarget = d.on ? -d.dir * Math.abs(v) * 0.07 : -cornering * 0.012;
    this.latVel += (slipTarget - this.latVel) * Math.min(1, dt * (d.on ? 4 : this.grip * 0.6));
    this.vel.set(fwd.x * v + right.x * this.latVel, 0, fwd.z * v + right.z * this.latVel);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // ---------- walls (track edge)
    const S2 = tr.surface(this.pos.x, this.pos.z, this.hint, this.surf, this.pos.y);
    this.hint = S2.i;
    const rel = Math.atan2(fwd.x * S2.rx + fwd.z * S2.rz, fwd.x * S2.tx + fwd.z * S2.tz);
    const ext = 0.95 + 1.3 * Math.abs(Math.sin(rel));
    const limR = S2.limR - ext, limL = -(S2.limL - ext);
    if (S2.lat > limR || S2.lat < limL) {
      const sgn = S2.lat > limR ? 1 : -1;
      const pen = sgn > 0 ? S2.lat - limR : limL - S2.lat;
      const nx = -sgn * S2.rx, nz = -sgn * S2.rz; // inward normal
      this.pos.x += nx * pen; this.pos.z += nz * pen;
      const vx = this.vel.x, vz = this.vel.z;
      const vn = vx * nx + vz * nz;
      if (vn < 0) {
        const impact = -vn;
        let nvx = vx - 1.25 * vn * nx, nvz = vz - 1.25 * vn * nz;
        const keep = impact > 12 ? 0.86 : 0.96;
        nvx *= keep; nvz *= keep;
        // re-express in car frame, then nudge heading along the wall
        this.speed = nvx * fwd.x + nvz * fwd.z;
        this.latVel = nvx * right.x + nvz * right.z;
        const tx = S2.tx, tz = S2.tz;
        const along = Math.sign(fwd.x * tx + fwd.z * tz) || 1;
        const targetYaw = Math.atan2(-tz * along, tx * along);
        let dy = targetYaw - this.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this.yaw += dy * Math.min(1, 0.25 + impact * 0.02);
        if (impact > 6 && this.wallHitT <= 0) {
          this.events.push({ type: 'wall', impact, x: this.pos.x - nx * 1.2, y: this.pos.y + 0.6, z: this.pos.z - nz * 1.2 });
          this.wallHitT = 0.35;
          if (d.on && impact > 14) { d.on = false; d.t = 0; d.level = 0; }
        }
      }
    }

    // ---------- static colliders
    const cols = tr.nearby(this.pos.x, this.pos.z);
    for (let i = 0; i < cols.length; i++) this._collide(cols[i]);

    // ---------- vertical
    const S3 = tr.surface(this.pos.x, this.pos.z, this.hint, this.surf, this.pos.y);
    const roadY = S3.y;
    if (this.grounded) {
      const prevY = this.pos.y;
      if (roadY < prevY - Math.max(0.35, Math.abs(v) * dt * 0.9) && d.hop <= 0) {
        // crest: leave the ground with the road's vertical velocity
        this.grounded = false; this.airT = 0;
        this.trick.ready = this.airLaunch || false; this.trick.done = false;
      } else {
        this.vy = (roadY - prevY) / Math.max(dt, 1e-3);
        this.vy = Math.max(-20, Math.min(20, this.vy));
        this.pos.y = roadY;
      }
      this.airLaunch = false;
    }
    if (!this.grounded) {
      this.airT += dt;
      this.vy -= GRAV * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= roadY) {
        const landV = -this.vy;
        this.pos.y = roadY;
        this.grounded = true;
        if (this.airT > 0.35) this.events.push({ type: 'land', v: landV });
        if (this.trick.done && this.trick.t <= 0.05) { this.boost(0.7, 1.28, 'trick'); }
        this.trick.ready = false; this.trick.done = false;
        this.vy = 0;
      }
    }
    d.hop = Math.max(0, d.hop - dt);
    this.trick.t = Math.max(0, this.trick.t - dt);
    // ramps set a flag so the crest detection enables tricks
    if (this.grounded && tr.ramps.length && tr.rampHeight(S3.s, S3.lat) > 0.3) this.airLaunch = true;

    // fell off the world?
    if (this.pos.y < roadY - 12 || (this.track.def.killY != null && this.pos.y < this.track.def.killY)) this.startRespawn();

    // ---------- bookkeeping
    this.s = S3.s;
    this.lat = S3.lat;
    const rs = S3.lat;
    if (Math.abs(rs) < Math.min(S3.limL, S3.limR) - 2 && this.grounded) this.lastSafe = { s: S3.s, lat: rs * 0.5 };
    this.surfNow = S3.surf;
    // wrong way (forward vs tangent)
    const dot = fwd.x * S3.tx + fwd.z * S3.tz;
    this.wrongWayT = dot < -0.3 && v > 2 ? this.wrongWayT + dt : Math.max(0, this.wrongWayT - dt * 2);
    this.stuckT = Math.abs(v) < 2 && inp.throttle > 0.5 && !spinning ? this.stuckT + dt : 0;
    this.slowT = Math.abs(v) < 3.5 && !spinning && this.grounded ? (this.slowT || 0) + dt : 0;

    this._visuals(dt, S3, yawRate);
  }

  _startDrift(dir) {
    const d = this.drift;
    d.on = true; d.dir = dir; d.t = 0; d.level = 0;
    this.events.push({ type: 'driftStart', dir });
  }

  _autoSteer() {
    // steer toward the racing line ahead (used by Ryu Rush and AI helpers)
    const p = this.track.path.at(this.s + Math.max(18, this.speed * 0.9));
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const want = Math.atan2(-dz, dx);
    let e = want - this.yaw;
    while (e > Math.PI) e -= Math.PI * 2;
    while (e < -Math.PI) e += Math.PI * 2;
    return Math.max(-1, Math.min(1, e * 2));
  }

  _collide(c) {
    if (this.pos.y < c.y0 || this.pos.y > c.y1) return;
    let nx, nz, pen;
    const R = this.radius;
    if (c.type === 'circle') {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const dist = Math.hypot(dx, dz);
      pen = R + c.r - dist;
      if (pen <= 0) return;
      nx = dx / (dist || 1); nz = dz / (dist || 1);
    } else {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
      const cx = Math.max(-c.hx, Math.min(c.hx, lx)), cz = Math.max(-c.hz, Math.min(c.hz, lz));
      let ex = lx - cx, ez = lz - cz;
      let dist = Math.hypot(ex, ez);
      if (dist < 1e-4) {
        // inside: push out along the shallowest axis
        const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
        if (px < pz) { ex = Math.sign(lx) || 1; ez = 0; pen = px + R; } else { ex = 0; ez = Math.sign(lz) || 1; pen = pz + R; }
        dist = 1;
      } else pen = R - dist;
      if (pen <= 0) return;
      ex /= dist; ez /= dist;
      nx = ex * c.cos + ez * c.sin; nz = -ex * c.sin + ez * c.cos;
    }
    this.pos.x += nx * pen; this.pos.z += nz * pen;
    const fwd = _f.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const right = _r.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const vx = fwd.x * this.speed + right.x * this.latVel, vz = fwd.z * this.speed + right.z * this.latVel;
    const vn = vx * nx + vz * nz;
    if (vn < 0) {
      const b = 1 + (c.bounce ?? 0.4);
      const nvx = (vx - b * vn * nx) * 0.9, nvz = (vz - b * vn * nz) * 0.9;
      this.speed = nvx * fwd.x + nvz * fwd.z;
      this.latVel = nvx * right.x + nvz * right.z;
      if (-vn > 8 && this.wallHitT <= 0) { this.events.push({ type: 'wall', impact: -vn, x: this.pos.x - nx, y: this.pos.y + 0.7, z: this.pos.z - nz }); this.wallHitT = 0.3; }
      // align with the deflection so we slide past rather than stick
      const t = Math.atan2(-(nvz), nvx);
      if (this.speed > 5) { let dy = t - this.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2; if (Math.abs(dy) < 1.2) this.yaw += dy * 0.3; }
    }
  }

  startRespawn() {
    if (this.respawnT > 0) return;
    this.respawnT = 1.4;
    this.drift.on = false; this.boostT = 0;
    this.events.push({ type: 'respawn' });
  }

  _respawnTick(dt) {
    this.respawnT -= dt;
    const ls = this.lastSafe;
    const p = this.track.path.point(ls.s - 6, ls.lat * 0.3);
    const t = Math.max(0, this.respawnT);
    this.pos.set(p.px, p.py + 6 * Math.min(1, t / 0.7), p.pz);
    this.yaw = Math.atan2(-p.tz, p.tx);
    this.speed = 0; this.latVel = 0; this.vy = 0;
    this.hint = p.i;
    if (this.respawnT <= 0) {
      this.respawnT = 0; this.grounded = true; this.pos.y = p.py; this.invulnT = 1.5; this.speed = 10;
      this.s = this.track.path.wrapS(ls.s - 6);
    }
    this._visuals(dt, this.track.surface(this.pos.x, this.pos.z, this.hint, this.surf, this.pos.y), 0);
  }

  _visuals(dt, S, yawRate) {
    const m = this.model;
    const d = this.drift;
    // drift body angle (visual only)
    const targetDrift = d.on ? -d.dir * (0.42 + 0.12 * (this.input.steer * d.dir)) : -Math.max(-0.12, Math.min(0.12, this.latVel * 0.03));
    this.driftVis += (targetDrift - this.driftVis) * Math.min(1, dt * 7);
    let spinOff = 0;
    if (this.spinT > 0 && !this.tumble) {
      const k = 1 - this.spinT / this.spinDur;
      spinOff = (1 - Math.pow(1 - k, 2.2)) * Math.PI * 2 * this.spinTurns;
    }
    const hackJitter = this.hackT > 0 ? Math.sin(this.hackT * 61) * 0.06 : 0;
    const yawV = this.yaw + this.driftVis + spinOff + hackJitter;
    // up vector from the road
    const up = _u.set(0, 1, 0);
    if (this.grounded) {
      const slope = this.track.path.slope[S.i] || 0;
      up.set(-slope * S.tx - Math.tan(S.bank) * S.rx, 1, -slope * S.tz - Math.tan(S.bank) * S.rz).normalize();
    }
    this.upSmooth.lerp(up, Math.min(1, dt * 10)).normalize();
    // orientation: yaw about world up, then tilt to the road normal
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawV);
    _q2.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.upSmooth);
    _q2.multiply(_q);
    // body roll/pitch from dynamics
    const lateralG = -yawRate * this.speed;
    const rollT = Math.max(-0.08, Math.min(0.08, lateralG * 0.0018)) + (d.on ? d.dir * 0.05 : 0);
    this.visRoll += (rollT - this.visRoll) * Math.min(1, dt * 6);
    const pitchT = (this.input.brake > 0 && this.speed > 5 ? -0.035 : 0) + (this.boostT > 0 ? 0.04 : 0);
    this.visPitch += (pitchT - this.visPitch) * Math.min(1, dt * 5);
    // tricks / tumble
    let trickRot = 0, trickAxis = 0;
    if (this.trick.t > 0) { trickRot = (1 - this.trick.t / 0.55) * Math.PI * 2; trickAxis = this.trick.kind; }
    if (this.tumble && this.spinT > 0) { trickRot = (1 - this.spinT / this.spinDur) * Math.PI * 2; trickAxis = 0; }
    const root = m.root;
    root.position.copy(this.pos);
    root.quaternion.copy(_q2);
    if (trickRot) {
      _e.set(trickAxis === 0 ? trickRot : 0, trickAxis === 2 ? trickRot : 0, trickAxis === 1 ? -trickRot : 0);
      root.quaternion.multiply(_q.setFromEuler(_e));
      root.position.y += Math.sin(trickRot / 2) * 0.8;
    }
    // squash & hop
    const sq = this.squashT > 0 ? 0.35 + 0.65 * Math.pow(1 - this.squashT / 1.3, 3) : 1;
    root.scale.set(1 + (1 - sq) * 0.4, sq, 1 + (1 - sq) * 0.3);
    m.body.rotation.x = this.visRoll;
    m.body.rotation.z = this.visPitch;
    // wheels
    const steerA = (d.on ? d.dir * 0.12 : this.input.steer * 0.42) * (this.spinT > 0 ? 0 : 1);
    const R = m.dims.R;
    for (const w of m.wheels) {
      w.spin.rotation.z -= (this.speed / R) * dt;
      if (w.front) w.steer.rotation.y = -steerA;
    }
    // brake lights
    m.material.uniforms.uBrake.value = this.input.brake > 0 && this.speed > 1 ? 1 : 0;
    // invulnerability flash
    const fl = this.invulnT > 0 && this.spinT <= 0 ? (Math.sin(performance.now() * 0.03) > 0 ? 0.5 : 0) : 0;
    m.material.uniforms.uFlash.value = fl;
    root.visible = !(this.respawnT > 0 && Math.sin(performance.now() * 0.04) > 0.3);
  }

  worldMatrix() { return _m.compose(this.pos, this.model.root.quaternion, this.model.root.scale); }
}
