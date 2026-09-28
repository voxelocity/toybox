// Evaluates a build: resolves parts, runs the engine and vehicle models,
// checks fuel / clutch / internals / fitment, and prices everything.
import { engineCurve, combineMods, peak, kwToHp, nmToLbft } from './engine.js';
import { simulate, muFromTreadwear, muLongFromTreadwear, brakingDistance, MPH } from './vehicle.js';
import { checkCorner, speedoError } from './fitment.js';
import { parseSize, tirePrice, tireWeightLb, tireDiameterIn } from '../../data/tires.js';
import { tireDims } from '../cad/tire.js';
import { slotParts } from '../core/state.js';

const LB = 0.45359237;
const E85_FUEL_FACTOR = 1.39; // E85 needs ~39 % more fuel mass than gasoline at WOT

/** Every selected part object. */
export function selectedParts(cat, b) {
  const out = [];
  const custom = slotParts(b, 'fiKit').includes('custom-turbo');
  for (const s of cat.slots) {
    if (s.customOnly && !custom) continue;
    for (const id of slotParts(b, s.id)) {
      const p = cat.byId.get(id);
      if (p) out.push(p);
    }
  }
  return out;
}

/** Factory or chosen wheels/tyres, resolved to concrete sizes. */
export function resolveWheels(cat, b) {
  const c = cat.car;
  const sport = b.factory.sportPackage;
  const factoryW = sport ? c.stock.sportPackageWheels : c.stock.wheels;
  const factoryT = sport ? c.stock.sportPackageTires : c.stock.tires;
  let wheels;
  if (b.wheels) {
    const d = cat.wheels[b.wheels.design];
    const f = d.sizes[b.wheels.front] ?? d.sizes[0];
    const r = d.sizes[b.wheels.rear ?? b.wheels.front] ?? f;
    wheels = { design: b.wheels.design, def: d, front: f, rear: r, finish: d.finishes.find((x) => x.id === b.wheels.finish) || d.finishes[0], factory: false };
  } else {
    const d = cat.wheels[factoryW.design];
    const find = (s) => d.sizes.find((z) => z.d === s.d && z.w === s.w && z.et === s.et) || d.sizes[0];
    wheels = { design: factoryW.design, def: d, front: find(factoryW.front), rear: find(factoryW.rear), finish: d.finishes[0], factory: true };
  }
  let tires;
  if (b.tires) tires = { model: b.tires.model, front: b.tires.front, rear: b.tires.rear || b.tires.front, factory: false };
  else tires = { model: factoryT.model, front: factoryT.front, rear: factoryT.rear, factory: true };
  // if the wheel diameter changed but the tyres are still factory, pick a sensible size
  if (tires.factory && (parseSize(tires.front).rim !== wheels.front.d || parseSize(tires.rear).rim !== wheels.rear.d)) {
    tires = { model: 'michelin-ps4s', front: suggestTire(wheels.front), rear: suggestTire(wheels.rear), factory: false, auto: true };
  }
  return { wheels, tires, factoryWheels: factoryW, factoryTires: factoryT };
}

/** A tyre size that suits the rim width and keeps the diameter close to stock (632 mm). */
export function suggestTire(w) {
  const widthFor = { 7: 205, 7.5: 225, 8: 225, 8.5: 235, 9: 245, 9.5: 255, 10: 265, 10.5: 275, 11: 285 };
  const width = widthFor[w.w] ?? 245;
  const aspects = [30, 35, 40, 45, 50, 55];
  let best = null;
  for (const a of aspects) {
    const dia = w.d * 25.4 + (2 * width * a) / 100;
    const err = Math.abs(dia - 634);
    if (!best || err < best.err) best = { a, err };
  }
  return `${width}/${best.a}R${w.d}`;
}

export function evaluate(cat, b) {
  const c = cat.car;
  const parts = selectedParts(cat, b);
  const has = (id) => parts.some((p) => p.id === id);
  const inSlot = (slot) => parts.filter((p) => p.slot === slot);
  const warnings = [];
  const warn = (level, area, text, fix) => warnings.push({ level, area, text, fix });

  // ---------------------------------------------------------------- engine
  const swap = parts.find((p) => p.engineSwap);
  const engine = cat.engines[swap ? swap.engineSwap : c.engine];
  const stockEngine = cat.engines[c.engine];
  const mods = combineMods(parts);
  const fiKit = inSlot('fiKit')[0];
  const isCustom = fiKit?.custom;
  if (fiKit) {
    mods.fi = { ...fiKit.engine.fi };
    if (mods.fi.type === 'turbo') {
      mods.turbo = isCustom ? inSlot('turbo')[0]?.turbo : cat.kitTurbos[mods.fi.turboKit];
      if (isCustom && !mods.turbo) warn('error', 'induction', 'Custom turbo build: choose a turbocharger.', 'Pick one in Forced induction → Turbocharger.');
      if (isCustom && !inSlot('turboManifold').length) warn('error', 'induction', 'Custom turbo build: choose a turbo manifold.', null);
      if (isCustom && mods.turbo && !mods.turbo.internalWastegate && !inSlot('wastegate').length) warn('error', 'induction', `${mods.turbo.name} has no internal wastegate: add an external wastegate.`, null);
      if (isCustom && !inSlot('bov').length) warn('warn', 'induction', 'No blow-off valve: compressor surge on lift-off will be loud and hard on the turbo.', 'Add a blow-off valve.');
      if (isCustom && !mods.intercooler) warn('warn', 'induction', 'No intercooler: hot charge air pulls timing and raises knock risk.', 'Add an intercooler.');
      if (isCustom && !mods.management) warn('error', 'induction', 'The factory DME cannot meter boost: choose engine management.', 'Pick a turbo tune or a standalone ECU.');
    }
  }
  if (!mods.management && fiKit) mods.management = { name: 'none', boostCalQuality: 0.85, maxBoostPsi: 0 };
  if (!mods.fi) mods.mafLimitGs = null;

  const fuel = b.setup.fuel || '93';
  let boost = 0;
  if (mods.fi) {
    const fi = mods.fi;
    boost = fi.fixedBoost ? fi.defaultBoostPsi : (b.setup.boostPsi ?? fi.defaultBoostPsi);
    const caps = [fi.maxBoostPsi, mods.management?.maxBoostPsi ?? 99, mods.wastegateMaxPsi ?? 99];
    const capBoost = Math.min(...caps);
    if (boost > capBoost) { boost = capBoost; }
  }
  const curveOpts = { boostPsi: boost, fuel };
  let curve = engineCurve(engine, mods, curveOpts);
  const stockCurve = engineCurve(stockEngine, combineMods([]), { fuel: '93' });

  // fuel system limits (cap the curve if the injectors or pump run out)
  const inj = mods.injectorsCc ?? engine.stockInjectorCc;
  const injRef = mods.injectorsCc ? 3.0 : engine.stockInjectorRefBar;
  const fuelBar = engine.fuelPressureBar;
  const injKgS = (6 * inj * Math.sqrt(fuelBar / injRef) * 0.74) / 60 / 1000; // kg/s at 100 % duty (gasoline density)
  const pump = mods.pumpLph ?? engine.stockPumpLph;
  const pumpKgS = (pump * 0.74 * (mods.fi ? 0.82 : 1)) / 3600;
  const bsfc = (mods.fi ? 0.34 : 0.30) * (fuel === 'E85' ? E85_FUEL_FACTOR : 1); // kg/kWh
  const pk0 = peak(curve);
  const fuelNeeded = (pk0.powerKw * bsfc) / 3600; // kg/s
  const duty = fuelNeeded / injKgS;
  const pumpLoad = fuelNeeded / pumpKgS;
  const limitFrac = Math.min(1, (0.9 * injKgS) / fuelNeeded, pumpKgS / fuelNeeded);
  if (limitFrac < 0.999) {
    // the calibration would have to pull boost: cap power by the fuel supply
    const maxKw = pk0.powerKw * limitFrac;
    curve = capPower(curve, maxKw);
  }
  if (duty > 0.9) warn('error', 'fuel', `Injectors would need ${(duty * 100).toFixed(0)}% duty; power is capped at what ${inj} cc/min injectors can feed.`, 'Fit larger injectors (e.g. ID1050X).');
  else if (duty > 0.82) warn('warn', 'fuel', `Injector duty ${(duty * 100).toFixed(0)}% at peak: little safety margin.`, 'Larger injectors recommended.');
  if (pumpLoad > 1) warn('error', 'fuel', `The fuel pump is ${(pumpLoad * 100 - 100).toFixed(0)}% short at peak power.`, 'Fit a higher-flow pump (e.g. AEM 340 lph).');
  else if (pumpLoad > 0.85) warn('warn', 'fuel', `Fuel pump at ${(pumpLoad * 100).toFixed(0)}% of its flow at peak.`, 'A 340 lph pump adds margin.');
  if (fuel === 'E85' && !mods.injectorsCc) warn('error', 'fuel', 'E85 needs ~39% more fuel: the factory injectors cannot supply it.', 'Fit E85-rated injectors and pump, and a flex/E85 calibration.');
  if (fuel === 'E85' && !mods.fi && !parts.some((p) => p.slot === 'tune')) warn('error', 'fuel', 'E85 needs a matching calibration.', 'Add engine software.');
  if (curve.notes.includes('choke')) warn('warn', 'induction', 'The compressor runs out of flow near redline: boost falls away up top.', 'A larger compressor holds boost to redline.');
  if (curve.notes.includes('surge')) warn('warn', 'induction', 'At low rpm the compressor sits left of its efficient range (surge side).', 'A smaller compressor spools sooner.');
  if (curve.notes.includes('maf')) warn('warn', 'induction', 'Airflow exceeds what the MAF-based calibration can measure; power is capped.', 'Move to a larger MAF housing or a MAP/standalone calibration.');

  const pk = peak(curve);
  const stockPk = peak(stockCurve);

  // internals / rev limit / clutch
  const tq = pk.torqueNm;
  const lim = engine.internals;
  if (!mods.forgedInternals) {
    if (tq > lim.stockRiskNm) warn('error', 'engine', `${tq.toFixed(0)} Nm is well beyond the ${lim.stockRiskNm} Nm owners report cast M54 pistons and rods surviving.`, 'Forged pistons and rods, or less boost.');
    else if (tq > lim.stockSafeNm) warn('warn', 'engine', `${tq.toFixed(0)} Nm is above the ~${lim.stockSafeNm} Nm comfort zone for the stock bottom end (community-reported).`, 'Keep timing conservative, or build the bottom end.');
  } else if (tq > lim.forgedSafeNm) warn('warn', 'engine', `${tq.toFixed(0)} Nm exceeds the typical forged-rod build margin.`, null);
  if (mods.fi && !mods.headStuds && boost > 14) warn('warn', 'engine', `${boost.toFixed(0)} psi on factory head bolts risks lifting the head gasket.`, 'ARP head studs and an MLS gasket.');
  if (curve.limiter > 6750 && !mods.forgedInternals) warn('info', 'engine', `Rev limit ${curve.limiter} rpm: owners recommend 6,750 rpm or less on the stock oil-pump nut arrangement.`, 'Safety-wire or replace the oil-pump nut before revving higher.');
  const clutchNm = parts.reduce((m, p) => (p.vehicle?.clutchNm ? Math.max(m, p.vehicle.clutchNm) : m), c.stock.clutchNm);
  const clutchParts = parts.filter((p) => p.vehicle?.clutchNm);
  const clutchCap = clutchParts.length ? Math.max(...clutchParts.map((p) => p.vehicle.clutchNm)) : c.stock.clutchNm;
  if (tq > clutchCap * 1.02) warn('error', 'drivetrain', `Peak torque ${tq.toFixed(0)} Nm exceeds the clutch's ~${clutchCap.toFixed(0)} Nm: it will slip.`, 'Upgrade the clutch (SPEC Stage 2 holds 485 lb-ft).');
  else if (tq > clutchCap * 0.9) warn('warn', 'drivetrain', `Clutch at ${(tq / clutchCap * 100).toFixed(0)}% of its rated torque.`, null);
  void clutchNm;
  const flywheel = inSlot('flywheel')[0];
  if (flywheel?.id === 'spec-sb64a' && !clutchParts.some((p) => p.id.startsWith('spec-'))) warn('warn', 'drivetrain', 'The SPEC aluminium flywheel needs a single-mass SPEC clutch (SB80xS).', 'Add a SPEC clutch.');
  if (flywheel?.includesClutch && clutchParts.some((p) => p.slot === 'clutch')) warn('info', 'drivetrain', 'The BimmerWorld single-mass kit already includes a clutch.', null);
  for (const p of parts) {
    if (p.fits && !p.fits.includes(engine.id)) warn('error', 'engine', `${p.name} is for the ${p.fits.join('/')}; this build has the ${engine.name}.`, null);
    for (const r of p.requires || []) if (!r.ids.some((id) => has(id))) warn('error', 'engine', `${p.name}: ${r.msg}`, `Add ${cat.byId.get(r.ids[0])?.name}.`);
    if (p.flags?.needsO2Fix && !parts.some((q) => q.slot === 'tune') && !mods.fi) warn('warn', 'engine', `${p.name}: the secondary O2 sensors will set codes without a tune or simulators.`, 'Add engine software.');
    if (p.legal) warn('info', 'legal', `${p.name}: ${p.legal}`, null);
    if (p.requiresNote && !(p.id === 'spec-sb64a' && clutchParts.some((q) => q.id.startsWith('spec-')))) warn('info', 'drivetrain', `${p.name}: ${p.requiresNote}`, null);
  }
  if (parts.some((p) => p.slot === 'tune') && fiKit && !isCustom) warn('info', 'engine', 'The forced-induction kit brings its own calibration; the naturally aspirated tune is not used.', null);
  if (inSlot('turbo').length && !isCustom) void 0;

  // ---------------------------------------------------------------- mass
  const { wheels, tires, factoryWheels, factoryTires } = resolveWheels(cat, b);
  let mass = c.specs.curbWeightKg + (b.factory.transmission === '5at' ? c.specs.autoExtraKg : 0);
  let massEst = false;
  for (const p of parts) { mass += p.weightKg || 0; if (p.weightKg && p.estWeight) massEst = true; }
  if (swap) mass += engine.massKg - stockEngine.massKg;
  // wheel and tyre weight change (x2 per axle)
  const fw = cat.wheels[factoryWheels.design];
  const fwF = fw.sizes.find((z) => z.d === factoryWheels.front.d && z.w === factoryWheels.front.w) || fw.sizes[0];
  const fwR = fw.sizes.find((z) => z.d === factoryWheels.rear.d && z.w === factoryWheels.rear.w) || fw.sizes[0];
  const wheelDeltaLb = 2 * (wheels.front.lb - fwF.lb) + 2 * (wheels.rear.lb - fwR.lb);
  const tireStyle = cat.tires[tires.model]?.style || 'uhp';
  const tireDeltaLb = 2 * (tireWeightLb(tires.front, tireStyle) - tireWeightLb(factoryTires.front, 'allseason')) + 2 * (tireWeightLb(tires.rear, tireStyle) - tireWeightLb(factoryTires.rear, 'allseason'));
  mass += (wheelDeltaLb + tireDeltaLb) * LB;
  const unsprungDeltaKg = (wheelDeltaLb + tireDeltaLb) * LB;
  const testMass = mass + c.specs.driverKg;

  // ---------------------------------------------------------------- vehicle
  const tr = c.transmissions[b.factory.transmission];
  const shifter = inSlot('shifter')[0];
  const rearTire = parseSize(tires.rear);
  const rDims = tireDims(rearTire, wheels.rear.w);
  const r = rDims.R / 1000 * 0.967; // dynamic rolling radius
  const model = cat.tires[tires.model];
  const lsd = parts.some((p) => p.vehicle?.lsd);
  const flyMult = parts.reduce((m, p) => m * (p.vehicle?.flywheelInertiaMult ?? 1), 1);
  const limitMph = (mods.speedLimiterRemoved || (mods.management && mods.management.name !== 'none') || swap) ? null : c.specs.speedLimitMph;
  const vehicleInput = (crv, massKg, rr, mu, extra = {}) => ({
    curve: crv, limiter: crv.limiter, idle: engine.idle,
    ratios: tr.ratios, finalDrive: tr.finalDrive, driveEff: tr.driveEff,
    shiftTimeS: Math.max(0.15, tr.shiftTimeS + (shifter?.vehicle?.shiftTimeDelta || 0)), auto: tr.auto,
    massKg: massKg, frontFrac: c.specs.frontFrac, cgHeightM: c.specs.cgHeightM - ((b.setup.dropF + b.setup.dropR) / 2) / 1000,
    wheelbaseM: c.specs.wheelbaseMm / 1000, cd: c.specs.cd, areaM2: c.specs.areaM2, crr: c.specs.crr,
    tireRadiusM: rr, muLong: mu, lsd, clutchNm: clutchCap, launchRpm: Math.min(tr.launchRpm, crv.limiter - 500),
    engineInertia: c.stock.engineInertia, speedLimitMs: null, ...extra,
  });
  const perf = simulate(vehicleInput(curve, testMass, r, muLongFromTreadwear(model.utqg), { engineInertia: c.stock.engineInertia * flyMult, speedLimitMs: limitMph ? limitMph * MPH : null }));
  const stockModel = cat.tires[factoryTires.model];
  const rStock = tireDims(parseSize(factoryTires.rear), factoryWheels.rear.w).R / 1000 * 0.967;
  const stockPerf = simulate(vehicleInput(stockCurve, c.specs.curbWeightKg + (b.factory.transmission === '5at' ? c.specs.autoExtraKg : 0) + c.specs.driverKg, rStock, muLongFromTreadwear(stockModel.utqg), { speedLimitMs: c.specs.speedLimitMph * MPH, lsd: false, clutchNm: c.stock.clutchNm, shiftTimeS: tr.shiftTimeS }));

  // grip, braking
  const susp = inSlot('suspension')[0];
  const roll = susp?.vehicle?.roll ?? 1;
  const avgWidth = (parseSize(tires.front).width + parseSize(tires.rear).width) / 2;
  const lateralG = muFromTreadwear(model.utqg) * Math.pow(avgWidth / 205, 0.12) * (1 + 0.1 * (roll - 1)) * (1 - Math.max(0, unsprungDeltaKg) * 0.0015);
  const stockLatG = muFromTreadwear(stockModel.utqg);
  const brakeKit = inSlot('brakesFront')[0];
  const fade = brakeKit?.vehicle?.fade ?? 1;
  const brake60 = brakingDistance(muFromTreadwear(model.utqg) * 1.08 * Math.pow(avgWidth / 205, 0.08));
  const stockBrake60 = brakingDistance(stockLatG * 1.08);

  // ---------------------------------------------------------------- fitment
  const drops = susp?.vehicle?.drop;
  const dropF = drops ? clampDrop(b.setup.dropF, drops.front) : 0;
  const dropR = drops ? clampDrop(b.setup.dropR, drops.rear) : 0;
  const plates = susp?.vehicle?.camberPlates;
  const camberF = b.setup.camberF ?? c.stock.alignment.camberFront;
  const camberR = b.setup.camberR ?? c.stock.alignment.camberRear;
  const camberFEff = plates || has('align-performance') ? Math.max(-3.5, camberF) : Math.max(-1.3 - dropF * 0.015, Math.min(camberF, c.stock.alignment.camberFront - dropF * 0.015));
  const camberREff = camberR - dropR * 0.02;
  if (b.setup.camberF != null && b.setup.camberF < -1.3 && !plates) warn('warn', 'chassis', `Front camber ${b.setup.camberF}° needs camber plates (the factory struts reach about -1.3° lowered).`, 'BC Racing coilovers include front camber plates.');
  const brakeMinWheel = brakeKit?.vehicle?.minWheel;
  const fitF = checkCorner('front', wheels.front, parseSize(tires.front), { spacer: b.setup.spacerF, camberDeg: camberFEff, fenders: b.setup.fenders, reducedInner: susp?.vehicle?.reducesInnerClearance, dropMm: dropF, brakeMinWheel, fit: c.fitment });
  const fitR = checkCorner('rear', wheels.rear, parseSize(tires.rear), { spacer: b.setup.spacerR, camberDeg: camberREff, fenders: b.setup.fenders, dropMm: dropR, fit: c.fitment });
  for (const f of [fitF, fitR]) for (const i of f.issues) warn(i.level, 'fitment', i.text, i.fix);
  const stockDia = tireDiameterIn(parseSize(factoryTires.rear)) * 25.4;
  const speedo = speedoError(stockDia, fitR.diameter);
  if (Math.abs(speedo) > 3) warn('warn', 'fitment', `Rear tyres are ${Math.abs(speedo).toFixed(1)}% ${speedo > 0 ? 'taller' : 'shorter'} than stock: the speedometer reads ${speedo > 0 ? 'low' : 'high'}.`, 'Pick a size closer to the factory diameter.');
  if (Math.abs(fitF.diameter - fitR.diameter) > 12) warn('warn', 'fitment', `Front and rear tyre diameters differ by ${Math.abs(fitF.diameter - fitR.diameter).toFixed(0)} mm: DSC/ABS can flag a fault.`, 'Keep front and rear within ~1.5% of each other.');
  if (dropF > 45 || dropR > 45) warn('info', 'chassis', `Lowered ${Math.max(dropF, dropR)} mm: watch the rocker and front lip on driveways; E46 rear subframe mounts dislike hard hits.`, null);
  if (susp && !has('align-performance')) warn('warn', 'chassis', 'Changing ride height moves toe and camber: budget an alignment.', 'Add a performance alignment.');

  // ---------------------------------------------------------------- cost
  const cost = priceBuild(cat, b, parts, wheels, tires);

  return {
    engine, stockEngine, mods, boost, fuel, curve, stockCurve, peak: pk, stockPeak: stockPk,
    duty, pumpLoad, clutchCap,
    massKg: mass, massEst, testMass, unsprungDeltaKg,
    perf, stockPerf, lateralG, stockLatG, brake60, stockBrake60, fade,
    wheels, tires, fitF, fitR, speedo, dropF, dropR, camberF: camberFEff, camberR: camberREff,
    parts, cost, warnings: sortWarnings(warnings),
    hp: kwToHp(pk.powerKw), stockHp: kwToHp(stockPk.powerKw), lbft: nmToLbft(pk.torqueNm), stockLbft: nmToLbft(stockPk.torqueNm),
    whp: kwToHp(pk.powerKw) * tr.driveEff, stockWhp: kwToHp(stockPk.powerKw) * tr.driveEff,
    transmission: tr,
  };
}

function clampDrop(v, [a, b]) {
  if (v == null || v === 0) return a;
  return Math.max(a, Math.min(b, v));
}

function capPower(curve, maxKw) {
  const out = { ...curve, torqueNm: [...curve.torqueNm], powerKw: [...curve.powerKw] };
  for (let i = 0; i < out.rpm.length; i++) {
    if (out.powerKw[i] > maxKw) {
      out.powerKw[i] = maxKw;
      out.torqueNm[i] = (maxKw * 1000) / (out.rpm[i] * Math.PI / 30);
    }
  }
  return out;
}

function sortWarnings(w) {
  const order = { error: 0, warn: 1, info: 2 };
  const seen = new Set();
  return w.filter((x) => { const k = x.text; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => order[a.level] - order[b.level]);
}

export function priceBuild(cat, b, parts, wheels, tires) {
  const rate = b.shop.diy ? 0 : b.shop.laborRate;
  const lines = [];
  for (const p of parts) {
    if (p.alsoSlots && lines.some((l) => l.id === p.id)) continue;
    lines.push({ id: p.id, category: cat.slotById.get(p.slot).category, label: `${p.brand} ${p.name}`, pn: p.pn, price: p.price || 0, estPrice: !!p.estPrice, src: p.src, laborH: p.laborH || 0, estLabor: !!p.estLabor, service: p.brand === 'Shop service' });
  }
  if (!wheels.factory) {
    const n = wheels.front === wheels.rear ? 4 : 2;
    const wLabel = `${wheels.def.brand} ${wheels.def.name}`;
    if (n === 4) lines.push({ id: 'wheels', category: 'wheels', label: `${wLabel} ${fmtSize(wheels.front)} x4`, price: wheels.front.price * 4, estPrice: !!wheels.front.estPrice, src: wheels.front.src, laborH: 0 });
    else {
      lines.push({ id: 'wheels-f', category: 'wheels', label: `${wLabel} ${fmtSize(wheels.front)} x2`, price: wheels.front.price * 2, estPrice: !!wheels.front.estPrice, src: wheels.front.src, laborH: 0 });
      lines.push({ id: 'wheels-r', category: 'wheels', label: `${wLabel} ${fmtSize(wheels.rear)} x2`, price: wheels.rear.price * 2, estPrice: !!wheels.rear.estPrice, src: wheels.rear.src, laborH: 0 });
    }
    if (wheels.def.hubRings) lines.push({ id: 'hubrings', category: 'wheels', label: 'Hub-centric rings (set of 4)', price: 25, estPrice: true, src: 'typical price', laborH: 0 });
  }
  if (!tires.factory) {
    const m = cat.tires[tires.model];
    const pf = tirePrice(tires.model, tires.front), pr = tirePrice(tires.model, tires.rear);
    lines.push({ id: 'tires', category: 'wheels', label: `${m.brand} ${m.name} ${tires.front}${tires.rear !== tires.front ? ` / ${tires.rear}` : ''} x4`, price: 2 * pf.price + 2 * pr.price, estPrice: pf.est || pr.est, src: pf.src, laborH: 1.0, estLabor: true });
  }
  const sp = (b.setup.spacerF ? 1 : 0) + (b.setup.spacerR ? 1 : 0);
  if (sp) lines.push({ id: 'spacers', category: 'wheels', label: `Hub-centric spacers with bolts (${sp} pair${sp > 1 ? 's' : ''})`, price: 120 * sp, estPrice: true, src: 'typical H&R DRA pair price', laborH: 0.5 * sp, estLabor: true });
  let partsTotal = 0, laborTotal = 0, laborH = 0, tax = 0;
  const byCat = {};
  for (const l of lines) {
    const lab = l.laborH * rate;
    l.labor = lab;
    partsTotal += l.price;
    laborTotal += lab;
    laborH += l.laborH;
    if (!l.service) tax += l.price * b.shop.taxRate;
    byCat[l.category] = (byCat[l.category] || 0) + l.price + lab;
  }
  const total = partsTotal + laborTotal + tax;
  return { lines, partsTotal, laborTotal, laborH, tax, total, byCat, rate, anyEstimate: lines.some((l) => l.estPrice || l.estLabor) };
}

export const fmtSize = (s) => `${s.d}x${s.w} ET${s.et}`;
