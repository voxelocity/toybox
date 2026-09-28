import { ENGINES } from '../public/data/engines.js';
import { engineCurve, combineMods, peak, kwToHp, nmToLbft } from '../public/js/sim/engine.js';
import { simulate, muLongFromTreadwear } from '../public/js/sim/vehicle.js';
const eng = ENGINES[process.argv[2] || 'm54b25'];
const mods = combineMods([]);
const c = engineCurve(process.env.EU ? { ...eng, torqueCurve: eng.torqueCurve.map(([r, t]) => [r, t * 245 / 237]) } : eng, mods, {});
const pk = peak(c);
console.log('peak', kwToHp(pk.powerKw).toFixed(1), 'hp @', pk.powerRpm, '|', nmToLbft(pk.torqueNm).toFixed(1), 'lb-ft @', pk.torqueRpm);
const r = 0.307;
const base = { curve: c, limiter: c.limiter, idle: 700, ratios: [4.23, 2.52, 1.66, 1.22, 1.00], finalDrive: 3.15, driveEff: +(process.env.EFF || 0.86), shiftTimeS: +(process.env.SHIFT || 0.4),
  massKg: +(process.env.MASS || 1450 + 90), frontFrac: 0.505, cgHeightM: 0.51, wheelbaseM: 2.725, cd: 0.30, areaM2: +(process.env.AREA || 2.12), crr: 0.012,
  tireRadiusM: r, muLong: muLongFromTreadwear(+(process.env.TW || 500)), lsd: false, launchRpm: +(process.env.LAUNCH || 3500), engineInertia: +(process.env.IE || 0.13), cgHeightM: +(process.env.CGH || 0.51) };
const s = simulate(base);
console.log('0-60', s.t60.toFixed(2), '0-100k', s.t100k.toFixed(2), '1/4', s.quarter.toFixed(2), '@', (s.trap / 0.44704).toFixed(1), 'mph', 'top', (s.topSpeed.speed * 3.6).toFixed(1), 'km/h', s.topSpeed.limitedBy, 'gear', s.topSpeed.gear + 1);
console.log('rollout: 0-60', s.t60Rollout.toFixed(2), '1/4', s.quarterRollout.toFixed(2));
console.log('shift mph', s.shiftAt.map((v) => (v / 0.44704).toFixed(1)).join(' '));
if (process.env.TRACE) for (const [t, v, x, g, rpm] of s.trace.filter((_, i) => i % 5 === 0).slice(0, 40)) console.log(t.toFixed(2), (v / 0.44704).toFixed(1), 'mph', x.toFixed(1), 'm', 'g', g + 1, 'rpm', rpm.toFixed(0));
