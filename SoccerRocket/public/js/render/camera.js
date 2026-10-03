// Rocket League's player camera: car cam, ball cam and the blend between them,
// right-stick swivel, rear view and the demolished view, plus the menu / replay
// shots. Works in physics space (uu, z-up, right-handed; car-local y is LEFT)
// and writes the three.js camera through its own methods, so nothing here
// imports three.js and tools/camera-probe.mjs can run it in Node.
//
// Every frame (Camera_X.UpdateCamera):
//   car state -> CameraState_Car_TA / CameraState_BallCam_TA, each producing an
//   FCameraOrientation {Focus, Rotation, Distance, FOV}
//     focus     = car + Height (along the car's up while fully on the ground,
//                 world up otherwise), smoothed; only the part across the view
//                 lags, and Stiffness pulls it back to the true focus
//     rotation  ground: the car's forward on the driving surface, Angle down,
//                 smoothed fast on the floor and slowly on walls, never rolling
//                 more than 10 % of the car's lean
//               air: the car's rotation is ignored; the camera turns to look at
//                 the car from where it is (a camera on a string)
//               ball cam: yaw to the ball, pitch scaled and capped, Angle down
//     distance  = Distance, pulled out while the car moves away from the camera
//                 (less with more Stiffness); FOV +5 with speed, +10 supersonic
//   -> CameraStateBlender_X: blends the two orientations (Transition Speed)
//   -> Camera_TA: swivel, rear view, location = focus - dir * distance,
//      ClipToField (10 uu above the floor), camera shake, aspect (Hor+ at 16:9)
//
// Sources: names and structure from the game's SDK (TAGame.CameraState_Car_TA,
// CameraState_BallCam_TA, Camera_TA, ProjectX.CameraStateBlender_X); the car
// cam's tuning and script logic as read from TAGame.upk (Archetypes.Camera) in
// lewistardif/RocketLeagueMinecraft rl_car_core/src/camera.rs. Values marked
// ESTIMATE are not published anywhere and were chosen to look like the game.
import { S } from './convert.js';
import { CAMERA_LIMITS, CAMERA_PRESETS } from '../settings.js';

const DEG = Math.PI / 180;
const URU = Math.PI * 2 / 65536; // Unreal rotation units
const CAR_MAX_SPEED = 2300;

export const CAMERA_TUNING = {
  // CameraState_Car_TA (Archetypes.Camera.CameraState_Car)
  interpToGroundRate: 2.0,       // AirGroundBlend per second, landing
  interpToAirRate: 4.0,          // AirGroundBlend per second, leaving the ground
  focusRate: 6.32,               // FocusInterp.Rate
  focusOffsetRate: 2.03,         // FocusOffsetInterp.Rate
  distanceRate: 4.14,            // DistanceInterp.Rate
  groundRotationRate: 13.39,     // GroundRotationInterpRate
  groundRotationRateWall: 2.03,  // GroundRotationInterpRateWall
  stiffnessRotationScale: 3.427, // ground rotation rates x lerp(1, this, Stiffness)
  groundNormalRate: 10.46,       // GroundNormalInterpRate
  airVelocityInfluence: 35,      // air rotation rate at rest (per 1/60 s)
  airVelocityInfluenceMaxSpeed: 10, // ... at max speed
  airStartVelocity: 500,         // first air frame: yaw from heading to velocity up to this speed
  groundPitchBlend: 48000 * URU, // car pitch at which the ground view would turn fully to the surface
  distanceSpeedScale: 0.05,      // DistanceSpeedScale
  distanceOffsetMin: -50,        // DistanceOffsetMin
  maxSpeedFOV: 5, fovInterpSpeed: 25,               // deg, deg/s
  supersonicFOV: 10, supersonicFOVInterpSpeed: 40,  // deg, deg/s
  rollScale: 0.1,                // RollScale
  // Camera_TA (Archetypes.Camera.Camera_Default)
  swivelYawMaxSlow: 22500 * URU, swivelYawMaxFast: 18000 * URU, // SwivelExtentSlow/Fast.YawMax
  swivelPitchMax: 5500 * URU, swivelPitchMin: -8900 * URU,      // SwivelExtent PitchMax/PitchMin
  swivelFastSpeed: 2500,         // SwivelFastSpeed (uu/s)
  swivelDieRate: 2,              // SwivelDieRate: returning to centre is this much faster
  groundClampZOffset: 10,        // ClipToField: camera stays this far above the floor
  // CameraState_BallCam_TA: ESTIMATE (RotationRate, PitchScale, PitchExtentMin/Max)
  ballRotationRate: 7,
  ballPitchScale: 0.6,
  ballPitchExtentMin: -30 * DEG,
  ballPitchExtentMax: 25 * DEG,
  // CameraState_Car_TA.StaticOverrideBlendParams: ESTIMATE (blend time at Transition Speed 1, ease in-out)
  blendTime: 0.5,
  // CameraState_Demolished_TA: ESTIMATE (RotationInterpRate, MaxZoomInFOV, FOVBlendTime, MaxFOVBlendDistance)
  demoRotationRate: 3, demoMaxZoomInFOV: 60, demoFOVBlendTime: 1.5, demoMaxFOVBlendDistance: 3000,
};
const T = CAMERA_TUNING;

// ---- small allocation-free helpers ---------------------------------------------------
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const rot = () => ({ p: 0, y: 0, r: 0 });
const alphaOf = (rate, dt) => 1 - Math.exp(-rate * dt);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function wrap(a) {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2; else if (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function copyV(o, a) { o.x = a.x; o.y = a.y; o.z = a.z; return o; }
function copyR(o, a) { o.p = a.p; o.y = a.y; o.r = a.r; return o; }
/** Rotator of a direction (pitch up, yaw counter-clockwise from +x; no roll). */
function rotOf(x, y, z, o) {
  if (x === 0 && y === 0 && z === 0) { o.p = 0; o.y = 0; o.r = 0; return o; }
  o.p = Math.atan2(z, Math.hypot(x, y)); o.y = Math.atan2(y, x); o.r = 0;
  return o;
}
/** RLerp(a, b, t, bShortestPath = true) into o (o may be a). */
function rlerp(o, a, b, t) {
  o.p = a.p + wrap(b.p - a.p) * t;
  o.y = a.y + wrap(b.y - a.y) * t;
  o.r = a.r + wrap(b.r - a.r) * t;
  return o;
}
/** AddCameraPitchOffset: tilt by `off` without passing straight up. */
function addPitchOffset(r, off) { r.p += Math.min(off, Math.PI / 2 - r.p); return r; }
function dirX(r) { return Math.cos(r.p) * Math.cos(r.y); }
function dirY(r) { return Math.cos(r.p) * Math.sin(r.y); }
function dirZ(r) { return Math.sin(r.p); }
function easeInOut(a) { return a < 0.5 ? 2 * a * a : 1 - 2 * (1 - a) * (1 - a); }

/** What the camera needs to know about the viewed car this frame (filled by setTarget). */
function makeTarget() {
  return {
    pos: v3(), vel: v3(), fwd: v3(1, 0, 0), right: v3(0, -1, 0), up: v3(0, 0, 1),
    onGround: true, normal: v3(0, 0, 1), supersonic: false, boosting: false, ball: v3(0, 0, 93),
  };
}

// ---- CameraState_Car_TA / CameraState_BallCam_TA --------------------------------------
class CarCamState {
  constructor(ballCam) {
    this.ballCam = ballCam;
    this.first = true;
    this.onGround = true;
    this.airGroundBlend = 1;            // 1 = ground camera, 0 = air camera
    this.groundNormal = v3(0, 0, 1);
    this.focusLag = v3();               // FocusInterp
    this.focusOffset = v3();            // FocusOffsetInterp
    this.distance = 0;                  // DistanceInterp
    this.rotToBall = rot();             // CurrRotToBall
    // FCameraOrientation
    this.focus = v3(); this.rot = rot(); this.dist = 270; this.fov = 90; this.loc = v3();
    this._a = rot(); this._b = rot(); this._c = rot();
  }

  reset() { this.first = true; }

  update(t, cs, dt) {
    const first = this.first;
    // UpdateAirGroundBlend
    if (first) {
      this.onGround = t.onGround;
      this.airGroundBlend = t.onGround ? 1 : 0;
      copyV(this.groundNormal, t.normal);
    } else {
      if (this.onGround !== t.onGround) {
        this.onGround = t.onGround;
        if (t.onGround) copyV(this.groundNormal, t.normal);
      }
      this.airGroundBlend = clamp(this.airGroundBlend + (this.onGround ? T.interpToGroundRate : -T.interpToAirRate) * dt, 0, 1);
    }
    const blend = this.airGroundBlend;

    // UpdateFocusWorldOffset: Height along the car's up only while fully on the ground
    const h = cs.height, fo = this.focusOffset;
    const ox = blend >= 1 ? t.up.x * h : 0, oy = blend >= 1 ? t.up.y * h : 0, oz = blend >= 1 ? t.up.z * h : h;
    if (first) { fo.x = ox; fo.y = oy; fo.z = oz; } else {
      const k = alphaOf(T.focusOffsetRate, dt);
      fo.x += (ox - fo.x) * k; fo.y += (oy - fo.y) * k; fo.z += (oz - fo.z) * k;
    }

    // UpdateFocus: the smoothed focus lags only across the view; Stiffness pulls it back
    const fx = t.pos.x + fo.x, fy = t.pos.y + fo.y, fz = t.pos.z + fo.z;
    const lag = this.focusLag, F = this.focus;
    if (first) {
      lag.x = fx; lag.y = fy; lag.z = fz;
      F.x = fx; F.y = fy; F.z = fz;
    } else {
      const k = alphaOf(T.focusRate, dt);
      lag.x += (fx - lag.x) * k; lag.y += (fy - lag.y) * k; lag.z += (fz - lag.z) * k;
      const r = this.rot, L = this.loc;
      const dx = dirX(r), dy = dirY(r), dz = dirZ(r);
      // across = (lag - loc) with its along-view part replaced by the true focus's
      let ax = lag.x - L.x, ay = lag.y - L.y, az = lag.z - L.z;
      const along = (fx - L.x) * dx + (fy - L.y) * dy + (fz - L.z) * dz - (ax * dx + ay * dy + az * dz);
      ax += dx * along; ay += dy * along; az += dz * along;
      const s = cs.stiffness;
      F.x = lerp(L.x + ax, fx, s); F.y = lerp(L.y + ay, fy, s); F.z = lerp(L.z + az, fz, s);
    }

    // UpdateAirAndGroundCamera
    const pitchOffset = cs.angle * DEG;
    if (this.ballCam) {
      this.ballRotation(t, pitchOffset, dt, this.rot);
    } else if (blend >= 1) {
      this.groundRotation(t, cs, pitchOffset, dt, this.rot);
    } else if (blend <= 0) {
      this.airRotation(t, pitchOffset, dt, this.rot);
    } else {
      const air = this.airRotation(t, pitchOffset, dt, this._b);
      const ground = this.groundRotation(t, cs, pitchOffset, dt, this._c);
      rlerp(this.rot, air, ground, blend);
    }

    // UpdateDistance: pulled out while moving away from the camera
    const r = this.rot;
    const away = t.vel.x * dirX(r) + t.vel.y * dirY(r) + t.vel.z * dirZ(r);
    const want = cs.distance + Math.max(away * T.distanceSpeedScale * (1 - cs.stiffness), T.distanceOffsetMin);
    this.distance = first ? want : this.distance + (want - this.distance) * alphaOf(T.distanceRate, dt);
    this.dist = this.distance;

    // UpdateFOV
    const speed = Math.hypot(t.vel.x, t.vel.y, t.vel.z);
    const fov = t.supersonic ? cs.fov + T.supersonicFOV : lerp(cs.fov, cs.fov + T.maxSpeedFOV, Math.min(1, speed / CAR_MAX_SPEED));
    const fovRate = (t.supersonic ? T.supersonicFOVInterpSpeed : T.fovInterpSpeed) * dt;
    this.fov = first ? fov : this.fov + clamp(fov - this.fov, -fovRate, fovRate);

    // UpdateRotationModifiers: a little of the car's sideways lean (not in ball cam)
    if (!this.ballCam && blend > 0) {
      const R = t.right;
      r.r = Math.atan2(R.z, Math.hypot(R.x, R.y)) * -T.rollScale * blend;
    } else if (this.ballCam) r.r = 0;

    this.first = false;
    // FinalizeOrientation
    r.p = wrap(r.p); r.y = wrap(r.y); r.r = wrap(r.r);
    this.loc.x = F.x - dirX(r) * this.dist;
    this.loc.y = F.y - dirY(r) * this.dist;
    this.loc.z = F.z - dirZ(r) * this.dist;
  }

  /** UpdateGroundPOV */
  groundRotation(t, cs, pitchOffset, dt, out) {
    const n = this.groundNormal;
    const k = alphaOf(T.groundNormalRate, dt);
    n.x += (t.normal.x - n.x) * k; n.y += (t.normal.y - n.y) * k; n.z += (t.normal.z - n.z) * k;
    const nl = Math.hypot(n.x, n.y, n.z) || 1;
    n.x /= nl; n.y /= nl; n.z /= nl;
    // the car's forward on the surface
    const f = t.fwd, d = f.x * n.x + f.y * n.y + f.z * n.z;
    let gx = f.x - n.x * d, gy = f.y - n.y * d, gz = f.z - n.z * d;
    const gl = Math.hypot(gx, gy, gz);
    if (gl < 1e-6) { gx = dirX(this.rot); gy = dirY(this.rot); gz = dirZ(this.rot); } else { gx /= gl; gy /= gl; gz /= gl; }
    // nose up a wall: look partly into the surface, so the camera sits out from it
    const carPitch = Math.atan2(gz, Math.hypot(gx, gy));
    const pb = Math.min(1, Math.abs(carPitch) / T.groundPitchBlend), sgn = carPitch > 0 ? -1 : 1;
    const target = addPitchOffset(rotOf(lerp(gx, sgn * n.x, pb), lerp(gy, sgn * n.y, pb), lerp(gz, sgn * n.z, pb), this._a), pitchOffset);
    if (this.first) return copyR(out, target);
    const scale = lerp(1, T.stiffnessRotationScale, cs.stiffness);
    const cur = this.rot;
    const wallW = 1 - Math.abs(n.z);
    // floor: rigid at Stiffness 1; wall: always smoothed
    const fa = cs.stiffness < 1 ? alphaOf(T.groundRotationRate * scale, dt) : 1;
    const wa = alphaOf(T.groundRotationRateWall * scale, dt);
    const a = lerp(fa, wa, wallW); // RLerp(floor, wall, wallW) of two RLerps from the same start
    return rlerp(out, cur, target, a);
  }

  /** UpdateAirPOV (CalculateDesiredAirRotation, ScalePitch) */
  airRotation(t, pitchOffset, dt, out) {
    const v = t.vel, speed2d = Math.hypot(v.x, v.y);
    if (this.first) {
      const heading = rotOf(t.fwd.x, t.fwd.y, t.fwd.z, this._a);
      const vel = rotOf(v.x, v.y, v.z, out);
      const yaw = heading.y + wrap(vel.y - heading.y) * Math.min(1, speed2d / T.airStartVelocity);
      out.p = 0; out.y = yaw; out.r = 0;
      return addPitchOffset(out, pitchOffset);
    }
    const speed = Math.hypot(v.x, v.y, v.z);
    const rate = lerp(T.airVelocityInfluence, T.airVelocityInfluenceMaxSpeed, Math.min(1, speed / CAR_MAX_SPEED));
    // look at the (new) focus from where the camera is; the game applies this per 1/60 s frame
    const F = this.focus, L = this.loc;
    const toward = rotOf(F.x - L.x, F.y - L.y, F.z - L.z, this._a);
    const a = 1 - Math.pow(1 - Math.min(1, rate / 60), dt * 60);
    rlerp(out, this.rot, toward, a);
    // ScalePitch: flatten while the car comes towards the camera
    if (v.x * dirX(out) + v.y * dirY(out) + v.z * dirZ(out) < 0) out.p *= 1 - Math.min(1, speed2d / CAR_MAX_SPEED);
    return out;
  }

  /** CameraState_BallCam_TA: CurrRotToBall, eased at RotationRate (ESTIMATE values). */
  ballRotation(t, pitchOffset, dt, out) {
    const F = this.focus, b = t.ball, cur = this.rotToBall;
    const dx = b.x - F.x, dy = b.y - F.y, dz = b.z - F.z, hor = Math.hypot(dx, dy);
    const tgt = this._a;
    tgt.y = hor > 1 ? Math.atan2(dy, dx) : (this.first ? Math.atan2(t.fwd.y, t.fwd.x) : cur.y);
    tgt.p = clamp(Math.atan2(dz, hor) * T.ballPitchScale, T.ballPitchExtentMin, T.ballPitchExtentMax);
    tgt.r = 0;
    if (this.first) copyR(cur, tgt); else rlerp(cur, cur, tgt, alphaOf(T.ballRotationRate, dt));
    copyR(out, cur);
    return addPitchOffset(out, pitchOffset);
  }
}

// ---- Camera_TA ------------------------------------------------------------------------
export class ChaseCamera {
  constructor(camera, renderer, settings) {
    this.camera = camera;
    this.renderer = renderer;
    this.settings = settings;
    this.ballCam = !!settings.camera.ballCamDefault;
    this.rearView = false;           // Rear Camera (held)
    this.demolisher = null;          // physics car that demolished the viewed car
    this.mode = 'menu';              // player | demolished | shot
    this.target = makeTarget();
    this.car = new CarCamState(false);
    this.ball = new CarCamState(true);
    this.blend = this.ballCam ? 1 : 0;       // 0 car cam .. 1 ball cam (linear progress)
    this.swivel = { p: 0, y: 0 };            // CurrentSwivel (radians)
    this.cs = Object.assign({}, settings.camera);
    // the final view (physics space)
    this.pos = v3(0, -800, 300);
    this.look = v3(0, 0, 100);
    this.up = v3(0, 0, 1);
    this.focus = v3(); this.rot = rot(); this.dist = 270; this.hfov = 90;
    this.fwd = v3(1, 0, 0);
    this.shake = 0; this.shakeT = 0;
    this.orbitT = 0;
    this._demoRot = rot(); this._demoT = 0; this._demoFov = 90;
    this._last = v3(); this._hasLast = false; this._bcInit = false;
    this._fov = -1; this._aspect = -1;
  }

  toggleBallCam() { this.ballCam = !this.ballCam; }
  /** Next player update starts over from the car (kickoff, respawn, new match). */
  reset() { this.car.reset(); this.ball.reset(); this.blend = this.ballCam ? 1 : 0; this.swivel.p = this.swivel.y = 0; this._hasLast = false; }
  addShake(a) { if (this.settings.camera.shake) this.shake = Math.min(1.2, this.shake + a); }

  /** The player's settings, clamped to the game's slider ranges. */
  _settings() {
    const src = this.settings.camera, cs = this.cs;
    for (const k in CAMERA_LIMITS) {
      const [lo, hi] = CAMERA_LIMITS[k], v = +src[k];
      cs[k] = Number.isFinite(v) ? clamp(v, lo, hi) : CAMERA_PRESETS.default[k];
    }
    return cs;
  }

  /**
   * Player view of one car.
   * state: interpolated render state {pos, quat, vel, supersonic, boosting, demoed};
   * car: the live physics car (wheel contacts, isOnGround, isJumping) or null;
   * ballPos: {x, y, z}; swivel: right stick {x right, y down} (-1..1).
   */
  updateCar(dt, state, car, ballPos, swivel) {
    if (state.demoed) { this.updateDemolished(dt); return; }
    const t = this.target;
    copyV(t.pos, state.pos); copyV(t.vel, state.vel); copyV(t.ball, ballPos);
    const q = state.quat, x = q.x, y = q.y, z = q.z, w = q.w;
    t.fwd.x = 1 - 2 * (y * y + z * z); t.fwd.y = 2 * (x * y + w * z); t.fwd.z = 2 * (x * z - w * y);
    t.right.x = -2 * (x * y - w * z); t.right.y = -(1 - 2 * (x * x + z * z)); t.right.z = -2 * (y * z + w * x);
    t.up.x = 2 * (x * z + w * y); t.up.y = 2 * (y * z - w * x); t.up.z = 1 - 2 * (x * x + y * y);
    t.supersonic = !!state.supersonic; t.boosting = !!state.boosting;
    // on the ground as the camera sees it: 3+ wheels down and not in a jump
    t.onGround = car ? car.isOnGround && !car.isJumping : state.onGround;
    let nx = 0, ny = 0, nz = 0;
    if (car && car.wheels) for (const wh of car.wheels) if (wh.contact && wh.normal) { nx += wh.normal.x; ny += wh.normal.y; nz += wh.normal.z; }
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 1e-3) { t.normal.x = nx / nl; t.normal.y = ny / nl; t.normal.z = nz / nl; } else copyV(t.normal, t.up);
    // teleports (kickoff, respawn) and coming back from another view start over
    if (this.mode !== 'player' || (this._hasLast && Math.abs(t.pos.x - this._last.x) + Math.abs(t.pos.y - this._last.y) + Math.abs(t.pos.z - this._last.z) > 500)) this.reset();
    this.mode = 'player';
    copyV(this._last, t.pos); this._hasLast = true;
    this.updatePlayer(dt, t, swivel);
  }

  /** The car cam / ball cam pipeline for a filled target. */
  updatePlayer(dt, t, swivel) {
    const cs = this._settings();
    const snap = this.car.first || dt <= 0;
    this.car.update(t, cs, dt);
    this.ball.update(t, cs, dt);
    // CameraStateBlender_X: ease between the two orientations
    const goal = this.ballCam ? 1 : 0;
    if (snap) this.blend = goal;
    const step = dt * cs.transition / T.blendTime;
    this.blend = goal > this.blend ? Math.min(goal, this.blend + step) : Math.max(goal, this.blend - step);
    const a = easeInOut(this.blend), A = this.car, B = this.ball, F = this.focus, R = this.rot;
    F.x = lerp(A.focus.x, B.focus.x, a); F.y = lerp(A.focus.y, B.focus.y, a); F.z = lerp(A.focus.z, B.focus.z, a);
    rlerp(R, A.rot, B.rot, a);
    this.dist = lerp(A.dist, B.dist, a);
    this.hfov = lerp(A.fov, B.fov, a);

    // Camera_TA.UpdateSwivel: right stick, scaled by FOV / 90 like PlayerInput_TA
    const sw = this.swivel, fs = this.hfov / 90;
    const lookRight = clamp((swivel && swivel.x || 0) * fs, -1, 1);
    const lookUp = clamp(-(swivel && swivel.y || 0) * fs, -1, 1) * (this.settings.camera.invertSwivel ? -1 : 1);
    const speed = Math.hypot(t.vel.x, t.vel.y, t.vel.z);
    const yawMax = lerp(T.swivelYawMaxSlow, T.swivelYawMaxFast, clamp(speed / T.swivelFastSpeed, 0, 1));
    const wantYaw = lookRight * yawMax;
    const wantPitch = lookUp > 0 ? lookUp * T.swivelPitchMax : -lookUp * T.swivelPitchMin;
    const ky = Math.min(1, cs.swivel * (Math.abs(wantYaw) < Math.abs(sw.y) ? T.swivelDieRate : 1) * dt);
    const kp = Math.min(1, cs.swivel * (Math.abs(wantPitch) < Math.abs(sw.p) ? T.swivelDieRate : 1) * dt);
    sw.y += (wantYaw - sw.y) * ky;
    sw.p += (wantPitch - sw.p) * kp;
    // ApplySwivel (yaw right is negative here: +y is left), ApplyRearCameraView
    R.p += sw.p;
    R.y -= sw.y;
    if (this.rearView) R.y += Math.PI;

    // camera shake: boosting rumbles a little, hits and demos add more
    if (this.settings.camera.shake && t.boosting) this.shake = Math.max(this.shake, t.supersonic ? 0.4 : 0.3);
    this._finish(dt);
  }

  /** CameraState_Demolished_TA: stay put, turn to follow the demolisher, zoom in. */
  updateDemolished(dt) {
    if (this.mode !== 'demolished') { this.mode = 'demolished'; this._demoT = 0; this._demoFov = this.hfov; }
    this._demoT += dt;
    const d = this.demolisher, R = this.rot, P = this.pos;
    if (d && d.pos && !d.isDemoed) {
      const tr = rotOf(d.pos.x - P.x, d.pos.y - P.y, d.pos.z + 40 - P.z, this._demoRot);
      rlerp(R, R, tr, alphaOf(T.demoRotationRate, dt));
      const dist = Math.hypot(d.pos.x - P.x, d.pos.y - P.y, d.pos.z - P.z);
      const zoom = lerp(this._demoFov, T.demoMaxZoomInFOV, clamp(dist / T.demoMaxFOVBlendDistance, 0, 1));
      this.hfov = lerp(this._demoFov, Math.min(this._demoFov, zoom), clamp(this._demoT / T.demoFOVBlendTime, 0, 1));
    }
    R.r = 0;
    this.dist = 0;
    copyV(this.focus, P);
    this._hasLast = false;
    this._finish(dt, true);
  }

  /** Camera_TA: location from the orientation, ClipToField, shake, then the three.js camera. */
  _finish(dt, fixedPos) {
    const R = this.rot, F = this.focus, P = this.pos;
    R.p = clamp(wrap(R.p), -89 * DEG, 89 * DEG); R.y = wrap(R.y);
    const fx = dirX(R), fy = dirY(R), fz = dirZ(R);
    if (!fixedPos) {
      P.x = F.x - fx * this.dist; P.y = F.y - fy * this.dist; P.z = F.z - fz * this.dist;
      P.z = Math.max(P.z, T.groundClampZOffset);
    }
    // camera axes with roll (positive roll tips the right side down)
    const sy = Math.sin(R.y), cy = Math.cos(R.y), cr = Math.cos(R.r), sr = Math.sin(R.r);
    // unrolled right = (sy, -cy, 0); unrolled up = right x forward
    const rx = sy, ry = -cy, rz = 0;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    this.up.x = ux * cr + rx * sr; this.up.y = uy * cr + ry * sr; this.up.z = uz * cr + rz * sr;
    this.fwd.x = fx; this.fwd.y = fy; this.fwd.z = fz;
    this.look.x = P.x + fx * 100; this.look.y = P.y + fy * 100; this.look.z = P.z + fz * 100;
    this._write(dt, this.hfov);
  }

  // ---- menu / replay shots (unchanged behaviour) ---------------------------------------
  _shot() { if (this.mode !== 'shot') { this.mode = 'shot'; this.car.reset(); this.ball.reset(); } }

  /** Slow orbit around a point (menus). */
  updateOrbit(dt, center, radius = 5200, height = 1500) {
    this._shot();
    this.orbitT += dt * 0.05;
    const a = this.orbitT;
    this._setView(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius * 0.9, height + Math.sin(a * 0.7) * 300, center.x, center.y, center.z);
    this._write(dt, 75);
  }

  /** TV-style sideline camera that tracks the ball (menus, end of match). */
  updateBroadcast(dt, ballPos) {
    this._shot();
    this.orbitT += dt * 0.04;
    const side = Math.sin(this.orbitT) > 0 ? 1 : -1;
    const dx = side * 3500, dy = ballPos.y * 0.75, dz = 1350, P = this.pos;
    if (!this._bcInit) { P.x = dx; P.y = dy; P.z = dz; this._bcInit = true; }
    const k = alphaOf(Math.abs(P.x - dx) > 3000 ? 0.6 : 1.5, dt);
    P.x += (dx - P.x) * k; P.y += (dy - P.y) * k; P.z += (dz - P.z) * k;
    const L = this.look, kl = alphaOf(2.5, dt);
    L.x += (ballPos.x * 0.5 - L.x) * kl; L.y += (ballPos.y - L.y) * kl; L.z += (Math.min(ballPos.z, 600) * 0.5 + 60 - L.z) * kl;
    this._setView(P.x, P.y, P.z, L.x, L.y, L.z);
    this._write(dt, 70);
  }

  /** Cinematic follow for replays: trails the ball from a dramatic angle. */
  updateCinematic(dt, ballPos, ballVel, focusCarPos) {
    this._shot();
    let vx = ballVel.x, vy = ballVel.y;
    if (vx * vx + vy * vy < 100) { vx = 0; vy = 1; }
    const vl = Math.hypot(vx, vy); vx /= vl; vy /= vl;
    const P = this.pos, k = alphaOf(3, dt);
    const dx = clamp(ballPos.x - vx * 900 - vy * 500, -3900, 3900);
    const dy = clamp(ballPos.y - vy * 900 + vx * 500, -4950, 4950);
    const dz = Math.max(250, ballPos.z + 260);
    P.x += (dx - P.x) * k; P.y += (dy - P.y) * k; P.z += (dz - P.z) * k;
    const L = this.look, kl = alphaOf(8, dt);
    const lx = focusCarPos ? lerp(ballPos.x, focusCarPos.x, 0.25) : ballPos.x;
    const ly = focusCarPos ? lerp(ballPos.y, focusCarPos.y, 0.25) : ballPos.y;
    const lz = focusCarPos ? lerp(ballPos.z, focusCarPos.z, 0.25) : ballPos.z;
    L.x += (lx - L.x) * kl; L.y += (ly - L.y) * kl; L.z += (lz - L.z) * kl;
    this._setView(P.x, P.y, P.z, L.x, L.y, L.z);
    this._write(dt, 80);
  }

  /** Fixed camera looking at a point from a position. */
  setStatic(pos, look) {
    this._shot();
    this._setView(pos.x, pos.y, pos.z, look.x, look.y, look.z);
    this._write(0, 80);
  }

  _setView(px, py, pz, lx, ly, lz) {
    const P = this.pos;
    P.x = px; P.y = py; P.z = pz;
    this.look.x = lx; this.look.y = ly; this.look.z = lz;
    rotOf(lx - px, ly - py, lz - pz, this.rot);
    this.fwd.x = dirX(this.rot); this.fwd.y = dirY(this.rot); this.fwd.z = dirZ(this.rot);
    this.up.x = 0; this.up.y = 0; this.up.z = 1;
  }

  /** Writes pose, shake and FOV (horizontal at 16:9, Hor+) to the three.js camera. */
  _write(dt, hfov) {
    const cam = this.camera, P = this.pos, f = this.fwd, u = this.up;
    cam.position.set(P.x * S, P.z * S, -P.y * S);
    cam.up.set(u.x, u.z, -u.y);
    cam.lookAt((P.x + f.x * 100) * S, (P.z + f.z * 100) * S, -(P.y + f.y * 100) * S);
    if (this.shake > 0 && dt > 0) {
      // sine oscillators like UE3's CameraShake, not per-frame noise
      this.shakeT += dt;
      const s = this.shake * this.shake * 0.012, t = this.shakeT;
      cam.rotateX(s * (Math.sin(t * 47.1) + 0.5 * Math.sin(t * 83.3 + 1.7)));
      cam.rotateY(s * (Math.sin(t * 39.7 + 0.6) + 0.5 * Math.sin(t * 71.9 + 2.9)));
      this.shake = Math.max(0, this.shake - dt * 1.8);
    }
    this.setFov(hfov);
  }

  /**
   * Rocket League's FOV is horizontal at 16:9 and keeps that vertical FOV on any
   * other aspect (Hor+: wider screens see more at the sides). Narrower than 4:3
   * (portrait phones) keeps the 4:3 width instead, so the field still fits.
   */
  setFov(hfovDeg) {
    const cam = this.camera, a = cam.aspect || 16 / 9;
    if (hfovDeg === this._fov && a === this._aspect) return;
    this._fov = hfovDeg; this._aspect = a;
    let t = Math.tan(hfovDeg * DEG / 2) * 9 / 16;
    if (a < 4 / 3) t *= (4 / 3) / a;
    cam.fov = Math.min(120, 2 * Math.atan(t) / DEG);
    cam.updateProjectionMatrix();
  }
}
