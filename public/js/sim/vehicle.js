// Straight-line vehicle simulation: launch, shifts, traction, aero, top speed.
// Time-stepped at 5 ms. Inputs are plain numbers so this runs in Node too.

const G = 9.80665;
const RHO = 1.184; // kg/m^3 at 25 C, sea level
const MPH = 0.44704;

/** Car-level skidpad g from UTQG treadwear (widely used empirical fit). */
export function muFromTreadwear(tw) {
  return 2.25 / Math.pow(Math.max(40, tw), 0.15);
}
/** Peak longitudinal tyre friction: the skidpad fit already includes load
 *  transfer and slip-angle losses, so the tyre itself grips ~12 % more. */
export function muLongFromTreadwear(tw) {
  return muFromTreadwear(tw) * 1.12;
}

/**
 * @param v {
 *   curve: { rpm[], torqueNm[] }, limiter, idle,
 *   ratios[], finalDrive, driveEff, shiftTimeS, auto: bool,
 *   massKg, frontFrac, cgHeightM, wheelbaseM, cd, areaM2, crr,
 *   tireRadiusM, muLong, lsd: bool, clutchNm, launchRpm,
 *   engineInertia (kg m^2), wheelInertia (kg m^2 total), speedLimitMs (or null)
 * }
 */
export function simulate(v) {
  const torqueAt = makeTorque(v.curve, v.limiter);
  const r = v.tireRadiusM;
  const gears = v.ratios;
  const eff = v.driveEff;
  const m = v.massKg;
  const L = v.wheelbaseM, h = v.cgHeightM;
  const drag = (s) => 0.5 * RHO * v.cd * v.areaM2 * s * s + v.crr * m * G;
  const lsdK = v.lsd ? 1.0 : 0.97; // an open diff loses a little usable traction on launch
  const Ie = v.engineInertia ?? 0.13;
  const Iw = v.wheelInertia ?? 4 * 1.1;

  // wheel force available in gear g at speed s (ignoring traction)
  const force = (g, s) => {
    const rpm = (s / r) * (60 / (2 * Math.PI)) * gears[g] * v.finalDrive;
    if (rpm > v.limiter + 1) return -Infinity;
    const T = torqueAt(Math.max(rpm, v.idle || 800));
    return (T * gears[g] * v.finalDrive * eff) / r;
  };
  // optimal shift speeds: switch when the next gear pulls harder, else at the limiter
  const shiftAt = [];
  for (let g = 0; g < gears.length - 1; g++) {
    const sLim = (v.limiter * 2 * Math.PI / 60) * r / (gears[g] * v.finalDrive);
    let best = sLim * 0.995;
    for (let s = sLim * 0.55; s < sLim; s += 0.05) {
      if (force(g + 1, s) >= force(g, s)) { best = s; break; }
    }
    shiftAt.push(best);
  }

  const dt = 0.005;
  let t = 0, s = 0, x = 0, gear = 0, shifting = 0, a = 0;
  const res = { t60: null, t100k: null, t100mph: null, quarter: null, trap: null, t60_130: null, eighth: null, trace: [] };
  let t60Start = null, tRoll = null;
  const launchRpm = v.launchRpm ?? 3200;
  const limitMs = v.speedLimitMs ?? Infinity;
  for (let step = 0; step < 60 / dt; step++) {
    const wheelRpm = (s / r) * (60 / (2 * Math.PI));
    let rpm = wheelRpm * gears[gear] * v.finalDrive;
    let Fdrive = 0;
    let slipping = false;
    if (shifting > 0) {
      shifting -= dt;
      if (v.auto) Fdrive = force(gear, s) * 0.6; // torque is mostly kept through an automatic's shift
    } else {
      let T;
      slipping = gear === 0 && rpm < launchRpm;
      if (slipping) {
        // clutch slip phase: engine held near launch rpm, clutch passes what it can
        T = Math.min(torqueAt(launchRpm), v.clutchNm ?? Infinity);
        rpm = launchRpm;
      } else {
        T = torqueAt(Math.min(Math.max(rpm, v.idle || 800), v.limiter));
        if (v.clutchNm && T > v.clutchNm) T = v.clutchNm; // slipping clutch caps torque
      }
      Fdrive = (T * gears[gear] * v.finalDrive * eff) / r;
      if (s >= limitMs) Fdrive = Math.min(Fdrive, drag(s));
    }
    // traction: rear axle load including longitudinal transfer
    const Nrear = m * G * (1 - v.frontFrac) + (m * a * h) / L;
    const Fmax = v.muLong * Nrear * lsdK;
    const F = Math.min(Fdrive, Fmax);
    const ratio = gears[gear] * v.finalDrive;
    // engine inertia only loads the car when the clutch is locked (not while slipping or shifting)
    const mEff = m + Iw / (r * r) + ((shifting > 0 && !v.auto) || slipping ? 0 : (Ie * ratio * ratio) / (r * r));
    a = (F - drag(s)) / mEff;
    s = Math.max(0, s + a * dt);
    x += s * dt;
    t += dt;
    if (step % 20 === 0) res.trace.push([t, s, x, gear, rpm]);
    if (tRoll === null && x >= 0.3048) tRoll = t;
    if (res.t60 === null && s >= 60 * MPH) res.t60 = t;
    if (res.t100k === null && s >= 100 / 3.6) res.t100k = t;
    if (res.t100mph === null && s >= 100 * MPH) res.t100mph = t;
    if (t60Start === null && s >= 60 * MPH) t60Start = t;
    if (res.t60_130 === null && s >= 130 * MPH) res.t60_130 = t - t60Start;
    if (res.eighth === null && x >= 201.168) res.eighth = t;
    if (res.quarter === null && x >= 402.336) { res.quarter = t; res.trap = s; }
    // shifting
    if (shifting <= 0 && gear < gears.length - 1 && s >= shiftAt[gear]) { gear++; shifting = v.shiftTimeS; }
    if (res.quarter !== null && res.t100mph !== null && (res.t60_130 !== null || t > 40)) break;
  }
  // US magazine convention: timing starts after the first foot of travel
  res.rollout = tRoll ?? 0;
  res.t60Rollout = res.t60 != null ? res.t60 - res.rollout : null;
  res.quarterRollout = res.quarter != null ? res.quarter - res.rollout : null;
  res.topSpeed = topSpeed(v, force, drag);
  res.shiftAt = shiftAt;
  return res;
}

function makeTorque(curve, limiter) {
  const rpm = curve.rpm, T = curve.torqueNm;
  return (x) => {
    if (x <= rpm[0]) return T[0] * (x / rpm[0]) ** 0.5;
    if (x > limiter) return 0;
    const i = Math.min(rpm.length - 2, Math.floor((x - rpm[0]) / (rpm[1] - rpm[0])));
    const t = (x - rpm[i]) / (rpm[i + 1] - rpm[i]);
    return T[i] + (T[i + 1] - T[i]) * Math.min(1, Math.max(0, t));
  };
}

function topSpeed(v, force, drag) {
  let best = { speed: 0, gear: 0, limitedBy: 'drag' };
  for (let g = 0; g < v.ratios.length; g++) {
    let s = 5;
    for (; s < 120; s += 0.05) {
      const f = force(g, s);
      if (f === -Infinity) { if (s > best.speed) best = { speed: s, gear: g, limitedBy: 'rev limiter' }; break; }
      if (f <= drag(s)) { if (s > best.speed) best = { speed: s, gear: g, limitedBy: 'drag' }; break; }
    }
  }
  if (v.speedLimitMs && best.speed > v.speedLimitMs) best = { ...best, speed: v.speedLimitMs, limitedBy: 'electronic limiter' };
  return best;
}

/** 60-0 mph stopping distance (m) from tyre friction; ABS efficiency ~0.92. */
export function brakingDistance(mu, speedMs = 60 * MPH) {
  return (speedMs * speedMs) / (2 * G * mu * 0.92);
}

export { MPH, G };
