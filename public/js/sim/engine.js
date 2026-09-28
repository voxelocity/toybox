// Engine model: turns a base engine (published torque curve) plus a set of
// modifications into a predicted crank torque curve.
//
// The approach is a mean-value airflow model calibrated to the factory curve:
//   - the stock curve already contains the stock intake loss, exhaust
//     backpressure and ignition calibration, so every modification is applied
//     as a physical change relative to stock rather than a flat "+hp";
//   - forced induction multiplies charge density (pressure ratio / charge
//     temperature) and subtracts turbine backpressure pumping work or the
//     supercharger's drive power;
//   - knock limits (fuel, compression, charge temperature) retard ignition;
//   - fuel system, clutch-free engine limits are reported separately (limits.js).
// All numbers are SI unless the name says otherwise.

export const P_ATM = 101.325; // kPa
export const PSI = 6.894757;  // kPa per psi
const R_AIR = 0.287;          // kJ/kg/K
const CP = 1.005;             // kJ/kg/K
const GAMMA_EXP = 0.2857;     // (gamma-1)/gamma for air
const T_AMB = 298.15;         // 25 C
const AIR_PER_W = 1.04e-6;    // kg/s of air per W of brake power at WOT (BSFC 0.30 kg/kWh, AFR 12.5)

export function interpCurve(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (x <= curve[i][0]) {
      const [x0, y0] = curve[i - 1], [x1, y1] = curve[i];
      const t = (x - x0) / (x1 - x0);
      // smoothstep blend keeps the curve from looking faceted between points
      const s = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
      return y0 + (y1 - y0) * s;
    }
  }
  // beyond the published curve: continue the last slope (valve-train / VE fall-off)
  const n = curve.length;
  const [x0, y0] = curve[n - 2], [x1, y1] = curve[n - 1];
  const slope = (y1 - y0) / (x1 - x0);
  return y1 + slope * 1.25 * (x - x1);
}

const bump = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const ramp = (x, a, b) => (x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a));
const smooth = (x, a, b) => { const t = ramp(x, a, b); return t * t * (3 - 2 * t); };

/**
 * Collapse the chosen parts into one modifier description.
 * Each part may carry `engine` effects (see the catalogue for field meanings).
 */
export function combineMods(parts) {
  const m = {
    intakeLossMult: 1, manifoldLossMult: 1, catbackLossMult: 1, headerScavenge: 0, headerCenter: 5200,
    tuneGain: 0, tuneMidGain: 0, revLimit: null, speedLimiterRemoved: false, camGain: 0, camCenter: 5800, camLowLoss: 0,
    fi: null, intercooler: null, turbo: null, wastegateMaxPsi: null, bovOk: true, management: null,
    injectorsCc: null, pumpLph: null, compression: null, forgedInternals: false, headStuds: false,
    flywheelInertiaMult: 1, mapConversion: false, mafLimitGs: null,
  };
  for (const p of parts) {
    const e = p.engine;
    if (!e) continue;
    if (e.intakeLossMult != null) m.intakeLossMult *= e.intakeLossMult;
    if (e.manifoldLossMult != null) m.manifoldLossMult *= e.manifoldLossMult;
    if (e.catbackLossMult != null) m.catbackLossMult *= e.catbackLossMult;
    if (e.headerScavenge != null) { m.headerScavenge += e.headerScavenge; if (e.headerCenter) m.headerCenter = e.headerCenter; }
    if (e.tuneGain != null) m.tuneGain = Math.max(m.tuneGain, e.tuneGain);
    if (e.tuneMidGain != null) m.tuneMidGain = Math.max(m.tuneMidGain, e.tuneMidGain);
    if (e.revLimit != null) m.revLimit = Math.max(m.revLimit || 0, e.revLimit);
    if (e.speedLimiterRemoved) m.speedLimiterRemoved = true;
    if (e.camGain != null) { m.camGain += e.camGain; if (e.camCenter) m.camCenter = e.camCenter; m.camLowLoss += e.camLowLoss || 0; }
    if (e.fi) m.fi = { ...(m.fi || {}), ...e.fi };
    if (e.intercooler) m.intercooler = e.intercooler;
    if (e.turbo) m.turbo = e.turbo;
    if (e.wastegateMaxPsi != null) m.wastegateMaxPsi = e.wastegateMaxPsi;
    if (e.management) m.management = e.management;
    if (e.injectorsCc != null) m.injectorsCc = e.injectorsCc;
    if (e.pumpLph != null) m.pumpLph = e.pumpLph;
    if (e.compression != null) m.compression = e.compression;
    if (e.forgedInternals) m.forgedInternals = true;
    if (e.headStuds) m.headStuds = true;
    if (e.flywheelInertiaMult != null) m.flywheelInertiaMult *= e.flywheelInertiaMult;
    if (e.mafLimitGs != null) m.mafLimitGs = e.mafLimitGs;
  }
  return m;
}

/** Octane-limited boost before the calibration has to retard ignition (psi). */
export function knockFreeBoost(fuel, cr, chargeTempK) {
  // Anchors: 10.5:1 on 93 AKI runs roughly 7 psi before the calibration has
  // to pull much timing with an intercooled 45 C charge (owners report ~280
  // whp from turbo M54B25s on 91-93 with factory compression); each point of
  // compression is worth ~2.2 psi; E85 roughly triples the margin.
  const base = { '91': 5.5, '93': 7.0, '100': 9.5, 'E85': 20.0 }[fuel] ?? 7.0;
  const crAdj = (10.5 - cr) * 2.2;
  const tAdj = -Math.max(0, chargeTempK - 318) * 0.045;
  return Math.max(0.5, base + crAdj + tAdj);
}

/**
 * Evaluate a build.
 * @param engine  engine definition (data/engines.js)
 * @param mods    combineMods(...) output
 * @param opts    { boostPsi, fuel: '91'|'93'|'E85', ambientC }
 * @returns { rpm[], torqueNm[], powerKw[], boostPsi[], chargeC[], airflowKgS[], limiter, notes[] }
 */
export function engineCurve(engine, modsIn, opts = {}) {
  let mods = modsIn;
  const fuel = opts.fuel || '93';
  const Vd = engine.displacementL / 1000; // m^3
  const cr = mods.compression ?? engine.cr;
  const stockLimiter = engine.limiter;
  const limiter = Math.min(mods.revLimit ?? stockLimiter, engine.maxSafeRpm ?? 7200);
  const Tamb = (opts.ambientC ?? 25) + 273.15;
  const base = engine.torqueCurve; // [[rpm, Nm]] crank, as rated for this market
  const tMax = Math.max(...base.map((p) => p[1]));
  const rpmPeakPow = base.reduce((best, p) => (p[0] * p[1] > best[0] * best[1] ? p : best), base[0])[0];
  const flowRel = (rpm) => (rpm * interpCurve(base, rpm)) / (rpmPeakPow * interpCurve(base, rpmPeakPow));

  const dpIntake0 = engine.stockIntakeLossKPa;   // at peak-power flow
  const dpManifold0 = engine.stockManifoldBackpressureKPa; // exhaust manifold + pre-cats
  const dpCatback0 = engine.stockCatbackBackpressureKPa;   // cats + mufflers

  const fi = mods.fi;
  if (fi?.type === 'turbo') {
    // the turbo manifold and downpipe replace the cast manifolds and pre-cats,
    // and the compressor inlet replaces the factory airbox
    mods = { ...mods, manifoldLossMult: 0, intakeLossMult: Math.min(mods.intakeLossMult, 0.6) };
  }
  const notes = [];
  const out = { rpm: [], torqueNm: [], powerKw: [], boostPsi: [], chargeC: [], airflowKgS: [], limiter, stockLimiter, notes };

  // turbo spool from turbine size / housing / displacement / target boost
  let rpmFull = 0, rpmOnset = 0;
  const boostTarget = fi ? Math.min(opts.boostPsi ?? fi.defaultBoostPsi ?? 6, fi.maxBoostPsi ?? 40) : 0;
  if (fi?.type === 'turbo') {
    const t = mods.turbo || fi.turbo;
    const K = 1.917;
    rpmFull = (K * t.turbineMm ** 2 * Math.sqrt(t.ar) * (1 + 0.04 * boostTarget)) / engine.displacementL;
    rpmFull = Math.max(2400, rpmFull);
    rpmOnset = rpmFull * 0.55;
  }

  for (let rpm = 1000; rpm <= limiter + 1; rpm += 50) {
    let T = interpCurve(base, rpm);
    const f = flowRel(rpm);
    // ---- naturally aspirated breathing changes (relative to stock)
    const dpi0 = dpIntake0 * f * f, dpi = dpi0 * mods.intakeLossMult;
    T *= (P_ATM - dpi) / (P_ATM - dpi0);
    const dpe0 = (dpManifold0 + dpCatback0) * f * f;
    const dpe = (dpManifold0 * mods.manifoldLossMult + dpCatback0 * mods.catbackLossMult) * f * f;
    // pumping work: (delta p) * Vd / (4 pi) for a four-stroke
    T += ((dpe0 - dpe) * 1000 * Vd) / (4 * Math.PI);
    // residual gas: lower backpressure leaves less exhaust in the cylinder
    T *= 1 + (0.22 * (dpe0 - dpe)) / P_ATM;
    // header scavenging (tuned primary lengths) and cams
    if (mods.headerScavenge) T *= 1 + mods.headerScavenge * bump(rpm, mods.headerCenter, 1500) - mods.headerScavenge * 0.3 * (1 - smooth(rpm, 1500, 3000));
    if (mods.camGain) T *= 1 + mods.camGain * bump(rpm, mods.camCenter, 1400) - mods.camLowLoss * (1 - smooth(rpm, 1500, 3500));
    // calibration (ignition/fuel) gains
    if (mods.tuneGain || mods.tuneMidGain) T *= 1 + mods.tuneGain * smooth(rpm, 3000, 6000) + mods.tuneMidGain * bump(rpm, 3500, 1400);

    let boost = 0, chargeK = Tamb, airflow = AIR_PER_W * T * rpm * Math.PI / 30;
    if (fi) {
      // ---- boost vs rpm
      let target = boostTarget;
      if (fi.type === 'centrifugal') target = boostTarget * (rpm / limiter) ** 2;
      else if (fi.type === 'turbo') target = boostTarget * smooth(rpm, rpmOnset, rpmFull);
      else if (fi.type === 'roots' || fi.type === 'twinscrew') target = boostTarget * (0.8 + 0.2 * smooth(rpm, 1200, 2600));
      // compressor flow limit (choke): engine demand at this PR cannot exceed max flow
      const comp = fi.type === 'turbo' ? (mods.turbo || fi.turbo) : fi.compressor;
      const naFlow = airflow; // kg/s at 1 bar with this build's NA breathing
      // the boost controller targets manifold pressure, so the compressor also
      // has to make up the intercooler's pressure drop (rated drop at ~0.35 kg/s)
      const icDropPsi = mods.intercooler ? mods.intercooler.dropPsi * (naFlow * (1 + target / 14.7) / 0.35) ** 2 : 0;
      let PR = (P_ATM + (target + icDropPsi) * PSI) / P_ATM;
      const wMax = comp.maxFlowLbMin * 0.00756; // kg/s
      // rough density ratio used for the flow estimate (charge cooler improves it)
      const flowAt = (pr) => naFlow * pr * 0.92;
      if (flowAt(PR) > wMax * 0.96) {
        PR = Math.max(1, (wMax * 0.96) / (naFlow * 0.92));
        if (!notes.includes('choke')) notes.push('choke');
      }
      // compressor efficiency: best near 60 % of max flow, falls away either side
      const wRel = Math.min(1.2, flowAt(PR) / wMax);
      let eta = comp.peakEff - 0.30 * ((wRel - 0.6) / 0.45) ** 2;
      if (PR > 2.6) eta -= (PR - 2.6) * 0.04;
      eta = Math.max(0.55, Math.min(comp.peakEff, eta));
      if (wRel < 0.28 && PR > 1.8 && !notes.includes('surge')) notes.push('surge');
      const T2 = Tamb * (1 + (PR ** GAMMA_EXP - 1) / eta);
      const eff = mods.intercooler ? mods.intercooler.effectiveness : 0;
      chargeK = T2 - eff * (T2 - Tamb);
      // ethanol's heat of vaporisation cools the charge further (~12 K at WOT)
      if (fuel === 'E85') chargeK -= 12;
      const PRman = Math.max(1, (P_ATM * PR - icDropPsi * PSI) / P_ATM);
      boost = (PRman - 1) * P_ATM / PSI;
      const DR = PRman * (Tamb / chargeK);
      // knock-limited ignition: retard costs ~1.8 % torque per psi over the limit
      const kf = knockFreeBoost(fuel, cr, chargeK);
      const knock = 1 - 0.018 * Math.max(0, boost - kf);
      // lower compression costs a little efficiency off-boost
      const crEff = cr < engine.cr ? 1 - (engine.cr - cr) * 0.012 : 1;
      let Tfi = T * DR * knock * crEff;
      // calibration quality under boost (piggyback/MAF-limited vs full MAP or standalone)
      Tfi *= mods.management?.boostCalQuality ?? 0.97;
      // exhaust side
      if (fi.type === 'turbo') {
        const t = mods.turbo || fi.turbo;
        const pInt = P_ATM * PRman;
        const ratio = 1 + (t.backpressure ?? 0.3) * (0.4 + 0.6 * smooth(rpm, rpmOnset, limiter));
        const pExh = pInt * ratio;
        Tfi -= ((pExh - pInt) * 1000 * Vd) / (4 * Math.PI);
      } else {
        // supercharger drive power: m_dot * cp * dT_isentropic / (eta_c * eta_drive)
        const mdot = naFlow * DR;
        const pDrive = (mdot * CP * Tamb * (PR ** GAMMA_EXP - 1)) / (eta * (fi.driveEff ?? 0.95)) * 1000; // W
        Tfi -= pDrive / (rpm * Math.PI / 30);
      }
      T = Tfi;
      airflow = naFlow * DR;
    }
    // MAF saturation on MAF-based calibrations (stock HFM on MS43)
    if (mods.mafLimitGs && airflow * 1000 > mods.mafLimitGs) {
      const k = (mods.mafLimitGs / 1000) / airflow;
      T *= k; airflow *= k;
      if (!notes.includes('maf')) notes.push('maf');
    }
    out.rpm.push(rpm);
    out.torqueNm.push(T);
    out.powerKw.push((T * rpm * Math.PI / 30) / 1000);
    out.boostPsi.push(boost);
    out.chargeC.push(chargeK - 273.15);
    out.airflowKgS.push(airflow);
  }
  out.rpmFull = rpmFull;
  return out;
}

export function peak(curve) {
  let pi = 0, ti = 0;
  curve.powerKw.forEach((p, i) => { if (p > curve.powerKw[pi]) pi = i; });
  curve.torqueNm.forEach((t, i) => { if (t > curve.torqueNm[ti]) ti = i; });
  return {
    powerKw: curve.powerKw[pi], powerRpm: curve.rpm[pi],
    torqueNm: curve.torqueNm[ti], torqueRpm: curve.rpm[ti],
    maxBoostPsi: Math.max(0, ...curve.boostPsi),
    maxAirflowKgS: Math.max(...curve.airflowKgS),
  };
}

export const kwToHp = (kw) => kw * 1.341022;
export const nmToLbft = (nm) => nm * 0.737562;
