// Evaluate a set of reference builds in Node and print headline numbers.
import { loadCatalogNode } from './node-catalog.mjs';
import { evaluate } from '../public/js/sim/build.js';
import { defaultBuild } from '../public/js/core/state.js';
const cat = await loadCatalogNode('e46-325ci');
const mk = (name, parts, extra = {}) => { const b = defaultBuild(cat); b.name = name; b.parts = parts; Object.assign(b.setup, extra.setup || {}); if (extra.factory) Object.assign(b.factory, extra.factory); if (extra.wheels) b.wheels = extra.wheels; if (extra.tires) b.tires = extra.tires; return b; };
const builds = [
  mk('stock', {}),
  mk('stock sport pkg', {}, { factory: { sportPackage: true } }),
  mk('aFe intake', { intake: 'afe-54-20442' }),
  mk('headers', { headers: 'supersprint-787401' }),
  mk('tune', { tune: 'be-ms43-b25-na' }),
  mk('full NA bolt-ons', { intake: 'afe-54-20442', headers: 'supersprint-787401', exhaust: 'magnaflow-16748', tune: 'be-ms43-b25-na' }),
  mk('bolt-ons + cams', { intake: 'afe-54-20442', headers: 'supersprint-787401', exhaust: 'magnaflow-16748', tune: 'be-ms43-b25-na', cams: 'schrick-264-248' }),
  mk('M54B30 swap + tune', { engineSwap: 'swap-m54b30', tune: 'be-ms43-b30-na' }),
  mk('VF supercharger', { fiKit: 'vf-vfk22-01' }),
  mk('AA supercharger', { fiKit: 'aa-e46325-l2' }),
  mk('Hopwood 12psi', { fiKit: 'hopwood-m54-turbo' }),
  mk('BE turbo 12psi', { fiKit: 'be-e46-turbo', clutch: 'spec-sb802' }),
  mk('BE turbo 18psi E85', { fiKit: 'be-e46-turbo', clutch: 'spec-sb803f', injectors: 'id1050x', fuelPump: 'aem-50-1200', internals: ['arp-201-m54', 'forged-internals'] }, { setup: { boostPsi: 18, fuel: 'E85' } }),
  mk('custom GT2860RS 10psi', { fiKit: 'custom-turbo', turbo: 'turbo-garrett-gt2860rs', turboManifold: 'spa-e46-tubular-top', bov: 'tial-q-50', intercooler: 'treadstone-tr8', injectors: 'id1050x', fuelPump: 'aem-50-1200', management: 'maxxecu-race', clutch: 'spec-sb802' }, { setup: { boostPsi: 10 } }),
  mk('custom G30-770 20psi', { fiKit: 'custom-turbo', turbo: 'turbo-garrett-g30-770', turboManifold: 'spa-e46-tubular-top', wastegate: 'tial-mvs-38', bov: 'tial-q-50', intercooler: 'treadstone-tr8', injectors: 'id1050x', fuelPump: 'aem-50-1200', management: 'maxxecu-race', clutch: 'spec-sb803f', internals: ['arp-201-m54', 'forged-internals'] }, { setup: { boostPsi: 20, fuel: 'E85' } }),
  mk('wheels apex 18x9.5 et35', {}, { wheels: { design: 'apex-ec7', front: 4, rear: 4, finish: 'race-silver' }, tires: { model: 'michelin-ps4s', front: '255/35R18', rear: '255/35R18' } }),
];
for (const b of builds) {
  const e = evaluate(cat, b);
  const p = e.perf;
  console.log(`${b.name.padEnd(26)} ${e.hp.toFixed(0).padStart(4)} hp @${e.peak.powerRpm} ${e.lbft.toFixed(0).padStart(4)} lb-ft @${e.peak.torqueRpm}  whp ${e.whp.toFixed(0)}  boost ${e.peak.maxBoostPsi.toFixed(1)}  0-60 ${p.t60Rollout?.toFixed(2)}s  1/4 ${p.quarterRollout?.toFixed(2)}@${(p.trap / 0.44704).toFixed(1)}  top ${(p.topSpeed.speed * 2.237).toFixed(0)}mph(${p.topSpeed.limitedBy})  ${e.massKg.toFixed(0)}kg  $${e.cost.total.toFixed(0)}  duty ${(e.duty * 100).toFixed(0)}%  full@${e.curve.rpmFull?.toFixed(0) || '-'}`);
  for (const w of e.warnings.filter((w) => w.level !== 'info')) console.log('     ', w.level, w.text);
}
