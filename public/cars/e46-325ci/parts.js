// Parts catalogue for the E46 325Ci.
//
// Prices are USD retail, checked 27-28 Sep 2026 at the store named in `src`.
// `estPrice` / `estWeight` / `estLabor` flag values that are estimates rather
// than published figures; the app shows those with an "est." badge.
// `claim` repeats the manufacturer's own performance claim word for word in
// spirit so the prediction can be compared with it.
//
// Effects:
//   engine.*   consumed by js/sim/engine.js (see combineMods for fields)
//   vehicle.*  consumed by the vehicle model (suspension, brakes, driveline)
//   visual.*   consumed by the 3D assembly
//
// Labour hours are typical shop times for the E46 (estimates; flat-rate
// guides and forum reports vary).

const GBP = 1.325; // USD per GBP, 27 Sep 2026
const EUR = 1.1377; // USD per EUR, 27 Sep 2026

export const CATEGORIES = [
  { id: 'engine', label: 'Engine', icon: 'engine' },
  { id: 'induction', label: 'Forced induction', icon: 'turbo' },
  { id: 'drivetrain', label: 'Drivetrain', icon: 'gear' },
  { id: 'chassis', label: 'Suspension', icon: 'spring' },
  { id: 'brakes', label: 'Brakes', icon: 'brake' },
  { id: 'wheels', label: 'Wheels & tyres', icon: 'wheel' },
  { id: 'exterior', label: 'Exterior', icon: 'car' },
  { id: 'interior', label: 'Interior & weight', icon: 'seat' },
];

// A slot holds one part (or several when multi). `none` is the stock state.
export const SLOTS = [
  { id: 'engineSwap', category: 'engine', label: 'Engine', none: 'M54B25 (stock)' },
  { id: 'intake', category: 'engine', label: 'Intake', none: 'Factory airbox' },
  { id: 'headers', category: 'engine', label: 'Exhaust manifolds', none: 'Factory cast manifolds with pre-cats' },
  { id: 'exhaust', category: 'engine', label: 'Exhaust (cat-back)', none: 'Factory exhaust, twin round tips' },
  { id: 'resonator', category: 'engine', label: 'Resonator', none: 'Factory centre resonator' },
  { id: 'cams', category: 'engine', label: 'Camshafts', none: 'Factory camshafts' },
  { id: 'tune', category: 'engine', label: 'Engine software', none: 'Factory MS43 calibration' },

  { id: 'fiKit', category: 'induction', label: 'Forced induction', none: 'Naturally aspirated' },
  { id: 'turbo', category: 'induction', label: 'Turbocharger', none: 'None', customOnly: true },
  { id: 'turboManifold', category: 'induction', label: 'Turbo manifold', none: 'None', customOnly: true },
  { id: 'wastegate', category: 'induction', label: 'External wastegate', none: 'None / internal', customOnly: true },
  { id: 'bov', category: 'induction', label: 'Blow-off valve', none: 'None', customOnly: true },
  { id: 'intercooler', category: 'induction', label: 'Intercooler', none: 'None', customOnly: true },
  { id: 'injectors', category: 'induction', label: 'Fuel injectors', none: 'Factory 208 cc/min' },
  { id: 'fuelPump', category: 'induction', label: 'Fuel pump', none: 'Factory in-tank pump' },
  { id: 'management', category: 'induction', label: 'Boost management', none: 'Factory DME (no boost support)', customOnly: true },
  { id: 'internals', category: 'induction', label: 'Engine internals', none: 'Factory head bolts, gasket, pistons', multi: true },

  { id: 'clutch', category: 'drivetrain', label: 'Clutch', none: 'Factory 228 mm clutch' },
  { id: 'flywheel', category: 'drivetrain', label: 'Flywheel', none: 'Factory dual-mass flywheel' },
  { id: 'lsd', category: 'drivetrain', label: 'Differential', none: 'Factory open differential (3.15)' },
  { id: 'shifter', category: 'drivetrain', label: 'Shifter', none: 'Factory shifter' },

  { id: 'suspension', category: 'chassis', label: 'Springs / coilovers', none: 'Factory sport suspension' },
  { id: 'alignment', category: 'chassis', label: 'Alignment', none: 'Factory alignment' },

  { id: 'brakesFront', category: 'brakes', label: 'Front brakes', none: '300 mm single-piston (stock)' },
  { id: 'caliperPaint', category: 'brakes', label: 'Caliper finish', none: 'Factory bare / natural' },

  { id: 'frontBumper', category: 'exterior', label: 'Front bumper', none: 'Factory bumper' },
  { id: 'sideSkirts', category: 'exterior', label: 'Side skirts', none: 'Factory sills' },
  { id: 'rearBumper', category: 'exterior', label: 'Rear bumper', none: 'Factory bumper' },
  { id: 'spoiler', category: 'exterior', label: 'Spoiler / wing', none: 'None' },
  { id: 'hood', category: 'exterior', label: 'Hood', none: 'Factory steel hood' },
  { id: 'trunk', category: 'exterior', label: 'Trunk lid', none: 'Factory trunk lid' },
  { id: 'mirrors', category: 'exterior', label: 'Mirrors', none: 'Factory mirrors' },
  { id: 'headlights', category: 'exterior', label: 'Headlights', none: 'Factory halogen' },
  { id: 'taillights', category: 'exterior', label: 'Tail lights', none: 'Factory red / amber' },
  { id: 'grilles', category: 'exterior', label: 'Kidney grilles', none: 'Factory chrome' },
  { id: 'tint', category: 'exterior', label: 'Window tint', none: 'Factory glass' },
  { id: 'refinish', category: 'exterior', label: 'Colour change', none: 'Factory paint' },

  { id: 'weight', category: 'interior', label: 'Weight reduction', none: 'Nothing removed', multi: true },
];

const P = (o) => ({ laborH: 0, weightKg: 0, ...o });

export const PARTS = [
  // ------------------------------------------------------------------ ENGINE
  P({
    id: 'swap-m54b30', slot: 'engineSwap', brand: 'BMW', name: 'M54B30 swap (used 330i engine)',
    price: 1650, estPrice: true, src: 'Used market: eBay listings $1,245-2,064 (Sep 2026)', laborH: 18,
    engineSwap: 'm54b30',
    requires: [{ slot: 'tune', ids: ['be-ms43-b30-na'], msg: 'The 325Ci DME needs a 3.0 L calibration (or a matched 330i DME/EWS pair).' }],
    note: 'Same block family, mounts and wiring; the 84 x 89.6 mm crank is the whole difference. Replace the clutch while it is out.',
    visual: { engineCover: 'm54' },
  }),
  P({
    id: 'afe-54-20442', slot: 'intake', brand: 'aFe Power', name: 'Magnum FORCE Stage-2 cold air intake, Pro 5R', pn: '54-20442',
    price: 387.0, src: 'BimmerWorld', laborH: 0.8, weightKg: -0.6, estWeight: true,
    engine: { intakeLossMult: 0.55 },
    claim: 'aFe dyno: +6 whp, +12 lb-ft',
    note: 'Open cone filter with a heat shield that seals to the factory duct.',
    visual: { intake: 'cone-shielded' },
  }),
  P({
    id: 'supersprint-787401', slot: 'headers', brand: 'Supersprint', name: 'Tubolare stainless headers (replace pre-cats)', pn: '787401',
    price: 1470.95, src: 'Turner Motorsport', laborH: 5, weightKg: -4, estWeight: true,
    engine: { manifoldLossMult: 0.3, headerScavenge: 0.02, headerCenter: 5400 },
    flags: { removesPreCats: true, needsO2Fix: true },
    claim: 'Supersprint: 20-25 hp with no cats and a race exhaust',
    legal: 'Deletes the manifold pre-catalysts: not emissions-legal for street use in the US.',
    note: 'Secondary O2 sensors need simulators, metallic-cat front pipes or a tune.',
    visual: { headers: 'tubular' },
  }),
  P({
    id: 'magnaflow-16748', slot: 'exhaust', brand: 'MagnaFlow', name: 'Touring cat-back, stainless, 2.5"', pn: '16748',
    price: 1396.0, src: 'Real Street Performance', laborH: 1.5, weightKg: -5, estWeight: true,
    engine: { catbackLossMult: 0.62 },
    note: 'Dual pipes merging to a single driver-side exit, polished 3" tip.',
    visual: { tips: 'single-3in-left' },
  }),
  P({
    id: 'supersprint-787406', slot: 'exhaust', brand: 'Supersprint', name: 'Rear muffler, 2 round tips', pn: '787406',
    price: 849.6, src: 'ModBargains', laborH: 1, weightKg: -3, estWeight: true,
    engine: { catbackLossMult: 0.8 },
    visual: { tips: 'twin-round-80-left' },
  }),
  P({
    id: 'remus-089000-0500', slot: 'exhaust', brand: 'Remus', name: 'Sport axle-back, twin tips', pn: '089000 0500',
    price: 1068.8, src: 'ModBargains', laborH: 1, weightKg: -3, estWeight: true,
    engine: { catbackLossMult: 0.82 },
    visual: { tips: 'twin-round-84-left' },
  }),
  P({
    id: 'eisenmann-sport-76', slot: 'exhaust', brand: 'Eisenmann', name: 'Sport rear muffler, 2 x 76 mm tips', pn: 'B5304.00760',
    price: 1110.99, src: 'BimmerWorld', laborH: 1, weightKg: -4, estWeight: true,
    engine: { catbackLossMult: 0.78 },
    note: 'Eisenmann notes the 2 x 76 mm tips need the rear bumper trimmed.',
    visual: { tips: 'twin-round-76-left' },
  }),
  P({
    id: 'eisenmann-race-quad', slot: 'exhaust', brand: 'Eisenmann', name: 'Race rear muffler, quad 70 mm tips', pn: 'B5304.22320',
    price: 1650.99, src: 'BimmerWorld', laborH: 1.5, weightKg: -4, estWeight: true,
    engine: { catbackLossMult: 0.68 },
    note: 'Quad-exit: requires a rear bumper with right-side cut-outs or trimming.',
    visual: { tips: 'quad-70' },
  }),
  P({
    id: 'eisenmann-res-delete', slot: 'resonator', brand: 'Eisenmann', name: 'Rear pipes without resonator (full sound)',
    price: 215.99, src: 'BimmerWorld', laborH: 1, weightKg: -3, estWeight: true,
    engine: { catbackLossMult: 0.9 },
    note: 'Louder with more drone at cruise.',
  }),
  P({
    id: 'schrick-264-248', slot: 'cams', brand: 'Schrick', name: 'Camshaft set 264° / 248°', pn: 'E46-M54-SCHRICK',
    price: 1779.99, src: 'BimmerWorld', laborH: 6,
    engine: { camGain: 0.05, camCenter: 5700, camLowLoss: 0.005 },
    claim: 'Schrick: more power in the mid and high rpm range with no loss of low-end torque, no software change needed',
    note: 'Fits M54B25 and M54B30 with double VANOS.',
  }),
  P({
    id: 'be-ms43-b25-na', slot: 'tune', brand: 'BE Racing Tuning', name: 'MS43 M54B25 naturally aspirated Stage 1 tune',
    price: 400.0, src: 'beracingtuning.com', laborH: 0.5,
    engine: { tuneGain: 0.035, tuneMidGain: 0.025, revLimit: 7000, speedLimiterRemoved: true },
    fits: ['m54b25'],
    note: 'Flash over OBD; can delete EWS and raise the limiter. Requires stock injectors and MAF.',
  }),
  P({
    id: 'be-ms43-b30-na', slot: 'tune', brand: 'BE Racing Tuning', name: 'MS43 M54B30 naturally aspirated Stage 1 tune',
    price: 400.0, src: 'beracingtuning.com', laborH: 0.5,
    engine: { tuneGain: 0.035, tuneMidGain: 0.025, revLimit: 7000, speedLimiterRemoved: true },
    fits: ['m54b30'],
  }),

  // ------------------------------------------------------------ INDUCTION: kits
  P({
    id: 'vf-vfk22-01', slot: 'fiKit', brand: 'VF Engineering', name: 'Supercharger kit (Vortech V-3 Si), 6 psi', pn: 'VFK22-01',
    price: 4995.0, src: 'UroTuning', laborH: 8, weightKg: 18, estWeight: true,
    engine: {
      fi: { type: 'centrifugal', compressor: { maxFlowLbMin: 36, peakEff: 0.76 }, defaultBoostPsi: 6, maxBoostPsi: 6, driveEff: 0.95, fixedBoost: true },
      management: { name: 'VF flash calibration', boostCalQuality: 0.99, maxBoostPsi: 8 },
      injectorsCc: 330,
    },
    kitIncludes: ['Vortech V-3 Si-trim', 'High-capacity injectors', 'VF ECU flash', 'K&N filter', 'Bosch bypass valve'],
    claim: 'VF Engineering: over 40% more power in most applications',
    note: 'Not intercooled; boost fixed by the pulley. VF quotes about 8 hours to fit.',
    visual: { fi: 'centrifugal' },
  }),
  P({
    id: 'aa-e46325-l2', slot: 'fiKit', brand: 'Active Autowerke', name: 'E46 325 supercharger kit Level 2 (Rotrex C30-94), 8 psi', pn: 'AARSC-E46325L2',
    price: 5195.0, src: 'The Parts Machine', laborH: 12, weightKg: 24, estWeight: true,
    engine: {
      fi: { type: 'centrifugal', compressor: { maxFlowLbMin: 40, peakEff: 0.78 }, defaultBoostPsi: 8, maxBoostPsi: 8, driveEff: 0.95, fixedBoost: true },
      intercooler: { effectiveness: 0.74, dropPsi: 1.1 },
      management: { name: 'Active Autowerke calibration', boostCalQuality: 0.99, maxBoostPsi: 9 },
      injectorsCc: 380,
    },
    kitIncludes: ['Rotrex C30-94 with self-contained oil system', 'Front-mount intercooler', '6 higher-flow injectors', 'AA software', 'Bypass valve', 'K&N filter'],
    claim: 'Active Autowerke: over 100 flywheel hp increase at 8 psi on 91-93 octane',
    visual: { fi: 'centrifugal', intercooler: 'fmic' },
  }),
  P({
    id: 'hopwood-m54-turbo', slot: 'fiKit', brand: 'Hopwood Motorsport', name: 'M52TU/M54 full turbo kit (GT3582-type, top-mount)',
    price: Math.round(3499 * GBP), src: `hopwoodmotorsport.com, from £3,499 at ${GBP} USD/GBP`, laborH: 28, weightKg: 32, estWeight: true,
    engine: {
      fi: { type: 'turbo', turboKit: 'gt3582-jb', defaultBoostPsi: 12, maxBoostPsi: 20 },
      intercooler: { effectiveness: 0.78, dropPsi: 1.0 },
      management: { name: 'MS43 MAP-sensor conversion', boostCalQuality: 0.98, maxBoostPsi: 22 },
      injectorsCc: 630, pumpLph: 255, headStuds: true,
    },
    vehicle: { clutchNm: 540, flywheelInertiaMult: 0.6 },
    kitIncludes: ['Top-mount T3 manifold, 50 mm wastegate', 'GT3582 0.62 A/R (2.5 L)', '600x300x76 intercooler', 'Bosch 630 cc injectors', '255 lph pump', 'Head studs + gasket', '540 Nm clutch + billet flywheel'],
    claim: 'Hopwood: reliably over 450 hp with no other supporting modifications',
    note: 'Ships from the UK (up to 28 days). Price converted from GBP; import duty and shipping extra.',
    visual: { fi: 'turbo-top', intercooler: 'fmic' },
  }),
  P({
    id: 'be-e46-turbo', slot: 'fiKit', brand: 'BE Racing Tuning', name: 'E46 non-M bolt-on turbo kit (GTX3076-type, .82 T3)',
    price: 5510.0, src: 'beracingtuning.com (base configuration)', laborH: 26, weightKg: 30, estWeight: true,
    engine: {
      fi: { type: 'turbo', turboKit: 'gtx3076-g2-type', defaultBoostPsi: 12, maxBoostPsi: 22 },
      intercooler: { effectiveness: 0.72, dropPsi: 1.3 },
      management: { name: 'BE Racing MS43 turbo tune + HPX MAF', boostCalQuality: 0.98, maxBoostPsi: 24 },
      injectorsCc: 650, mafLimitGs: 520,
    },
    kitIncludes: ['Pulsar GTX3076 Gen 2-type turbo, 0.82 T3', 'SPA cast manifold, ceramic coated', 'Treadstone intercooler', 'Bosch 62 lb injectors', 'TiAL/Precision/GFB wastegate', 'MS4x turbo tune + PMAS HPX MAF'],
    claim: 'BE Racing: 350-800 whp depending on engine and turbo configuration',
    note: 'Keeps the A/C lines. Requires drilling the oil pan for the drain. MS45 cars are not supported (the 2001-2003 325Ci uses MS43).',
    visual: { fi: 'turbo-low', intercooler: 'fmic' },
  }),
  P({
    id: 'custom-turbo', slot: 'fiKit', brand: 'Custom', name: 'Custom turbo build (choose every component)',
    price: 650, estPrice: true, src: 'Fabrication materials: downpipe, charge pipes, oil feed/return (shop estimate)', laborH: 40, estLabor: true,
    weightKg: 28, estWeight: true,
    engine: { fi: { type: 'turbo', custom: true, defaultBoostPsi: 10, maxBoostPsi: 26 } },
    custom: true,
    note: 'Pick the turbo, manifold, wastegate, intercooler, fuel system and management below. Labour includes fabrication and install; dyno tuning is part of the management line.',
    visual: { fi: 'turbo-top', intercooler: 'fmic' },
  }),

  // ------------------------------------------------------ INDUCTION: components
  ...['garrett-gt2860rs', 'garrett-g25-550', 'garrett-g25-660', 'borgwarner-efr6758', 'garrett-gtx3076r-g2', 'garrett-g30-770']
    .map((t) => P({ id: `turbo-${t}`, slot: 'turbo', turboRef: t, laborH: 0 })),
  P({
    id: 'spa-e46-tubular-top', slot: 'turboManifold', brand: 'SPA Turbo', name: 'Tubular top-mount manifold for E46, T3/T4',
    price: 599.9, src: 'spaturbousa.com', flange: 'T3', mount: 'top',
    visual: { manifold: 'tubular-top' },
  }),
  P({
    id: 'spa-m5x-cast', slot: 'turboManifold', brand: 'SPA Turbo', name: 'M5x cast turbo manifold + wastegate flange (T3)',
    price: 489.9, src: 'spaturbousa.com', flange: 'T3', mount: 'low',
    note: 'Listed for the M50/M52/M54 family head flange; routing on the E46 needs a custom downpipe.',
    visual: { manifold: 'cast-log' },
  }),
  P({ id: 'tial-mvs-38', slot: 'wastegate', brand: 'TiAL Sport', name: 'MVS 38 mm two-bolt wastegate', price: 308.97, src: 'BE Racing Tuning', engine: { wastegateMaxPsi: 30 } }),
  P({ id: 'precision-39', slot: 'wastegate', brand: 'Precision Turbo', name: 'PW39 39 mm wastegate', price: 360.0, src: 'BE Racing Tuning (sale, $395 list)', engine: { wastegateMaxPsi: 30 } }),
  P({ id: 'tial-q-50', slot: 'bov', brand: 'TiAL Sport', name: 'Q 50 mm blow-off valve', price: 278.95, src: 'Full-Race' }),
  P({ id: 'turbosmart-raceport', slot: 'bov', brand: 'Turbosmart', name: 'GenV RacePort blow-off valve', price: 355.99, src: 'turbosmart.com' }),
  P({
    id: 'treadstone-tr8', slot: 'intercooler', brand: 'Treadstone', name: 'TR8 front-mount core 22 x 7.8 x 3.5" (500 hp)', pn: 'TR8',
    price: 350.0, src: 'CW Turbochargers', laborH: 3,
    engine: { intercooler: { effectiveness: 0.72, dropPsi: 1.3 } },
    visual: { intercooler: 'fmic' },
  }),
  P({
    id: 'id1050x', slot: 'injectors', brand: 'Injector Dynamics', name: 'ID1050X (set of 6)', pn: '1050.60.11.14.6',
    price: Math.round(147.84 * 6 * 100) / 100, src: 'Full-Race ($147.84 each)', laborH: 1.5,
    engine: { injectorsCc: 1050 },
    note: 'E85-capable; needs injector data in the calibration.',
  }),
  P({
    id: 'aem-50-1200', slot: 'fuelPump', brand: 'AEM', name: '340 lph E85-compatible in-tank pump', pn: '50-1200',
    price: 149.95, src: 'AEM / SMY Performance', laborH: 1.5,
    engine: { pumpLph: 340 },
  }),
  P({
    id: 'be-ms43-turbo', slot: 'management', brand: 'BE Racing Tuning', name: 'MS43 turbo tune (MAF-based)',
    price: 595.0, src: 'beracingtuning.com', laborH: 1,
    engine: { management: { name: 'MS43 turbo tune', boostCalQuality: 0.97, maxBoostPsi: 20 }, mafLimitGs: 360 },
    note: 'Keeps the factory DME; pair with a larger MAF housing for high airflow.',
  }),
  P({
    id: 'maxxecu-race', slot: 'management', brand: 'MaxxECU', name: 'RACE standalone ECU + dyno tuning',
    price: 1645.75 + 600, estPrice: true, src: 'maxxecu.us ($1,645.75) + dyno session ~4 h at $150/h (est)', laborH: 8,
    engine: { management: { name: 'MaxxECU standalone (MAP)', boostCalQuality: 1.0, maxBoostPsi: 40 } },
    note: 'Speed-density calibration: no MAF limit. Wiring adapter or loom work included in the labour.',
  }),
  P({
    id: 'haltech-elite-2500', slot: 'management', brand: 'Haltech', name: 'Elite 2500 standalone ECU + dyno tuning', pn: 'HT-151300',
    price: 1995 + 600, estPrice: true, src: 'haltech.com ($1,995) + dyno session ~4 h at $150/h (est)', laborH: 8,
    engine: { management: { name: 'Haltech Elite 2500 (MAP)', boostCalQuality: 1.0, maxBoostPsi: 40 } },
  }),
  P({
    id: 'arp-201-m54', slot: 'internals', brand: 'ARP', name: 'Cylinder head stud kit', pn: '201-M54',
    price: 303.0, src: 'Sportignition', laborH: 10,
    engine: { headStuds: true },
    note: 'Head-off job: pair with a new head gasket.',
  }),
  P({
    id: 'forged-internals', slot: 'internals', brand: 'Engine builder', name: 'Forged pistons (8.8:1) and H-beam rods, machine work',
    price: 3200, estPrice: true, src: 'Typical cost of a forged M54 short-block refresh (shop estimate)', laborH: 22, estLabor: true,
    engine: { forgedInternals: true, compression: 8.8 },
    note: 'Lower compression buys knock margin for boost; costs a little efficiency off-boost.',
  }),

  // --------------------------------------------------------------- DRIVETRAIN
  P({ id: 'spec-sb801', slot: 'clutch', brand: 'SPEC', name: 'Stage 1 clutch (OE dual-mass)', pn: 'SB801', price: 749, src: 'specclutch.com', laborH: 6, vehicle: { clutchNm: Math.round(430 * 1.3558) }, note: 'SPEC rating: 430 lb-ft.' }),
  P({ id: 'spec-sb802', slot: 'clutch', brand: 'SPEC', name: 'Stage 2 clutch (OE dual-mass)', pn: 'SB802', price: 847, src: 'specclutch.com', laborH: 6, vehicle: { clutchNm: Math.round(485 * 1.3558) }, note: 'SPEC rating: 485 lb-ft.' }),
  P({ id: 'spec-sb803f', slot: 'clutch', brand: 'SPEC', name: 'Stage 3+ clutch (OE dual-mass)', pn: 'SB803F', price: 879, src: 'specclutch.com', laborH: 6, vehicle: { clutchNm: Math.round(671 * 1.3558) }, note: 'SPEC rating: 671 lb-ft. Heavier pedal, more chatter.' }),
  P({
    id: 'spec-sb64a', slot: 'flywheel', brand: 'SPEC', name: 'Aluminium single-mass flywheel', pn: 'SB64A',
    price: 649, src: 'specclutch.com', laborH: 0.5, weightKg: -6, estWeight: true,
    vehicle: { flywheelInertiaMult: 0.5 },
    requiresNote: 'Needs a single-mass clutch (SPEC SB80xS versions); a dual-mass clutch will not fit.',
    note: 'Revs pick up faster; more gear rattle at idle.',
  }),
  P({
    id: 'bw-smf-kit', slot: 'flywheel', brand: 'BimmerWorld', name: 'Single-mass flywheel conversion kit (street)', pn: '835101',
    price: 1079.99, src: 'BimmerWorld', laborH: 6, weightKg: -4, estWeight: true,
    vehicle: { flywheelInertiaMult: 0.7, clutchNm: 450 },
    includesClutch: true,
    note: 'Replaces the dual-mass flywheel and clutch together.',
  }),
  P({
    id: 'racingdiffs-lsd-188', slot: 'lsd', brand: 'RacingDiffs', name: 'LSD conversion set, 188 mm (keeps 3.15 ratio)',
    price: Math.round(359 * EUR), src: `racingdiffs.com, EUR 359 list at ${EUR} USD/EUR (listed sold out)`, laborH: 4,
    vehicle: { lsd: true },
    note: 'Clutch-type, progressive ramps, ~25% lock. Installed into your own differential.',
  }),
  P({ id: 'uuc-evo3', slot: 'shifter', brand: 'UUC Motorwerks', name: 'EVO3 short shifter', pn: 'USSE3-L', price: 408.25, src: 'store.uucmotorwerks.com', laborH: 2, vehicle: { shiftTimeDelta: -0.03 }, note: '35% shorter throw.' }),
  P({ id: 'uuc-evo3-dssr', slot: 'shifter', brand: 'UUC Motorwerks', name: 'EVO3 short shifter + DSSR232 selector rod', pn: 'USSE3-L + DSSR232', price: 573.85, src: 'store.uucmotorwerks.com', laborH: 2.5, vehicle: { shiftTimeDelta: -0.04 } }),
  P({ id: 'cae-ultra', slot: 'shifter', brand: 'CAE', name: 'Ultra Shifter (aluminium, black knob)', price: 1103.2, src: 'BE Racing Tuning', laborH: 3, vehicle: { shiftTimeDelta: -0.05 }, note: '~65 mm shift and selector travel.' }),

  // ---------------------------------------------------------------- SUSPENSION
  P({
    id: 'eibach-2067140', slot: 'suspension', brand: 'Eibach', name: 'Pro-Kit lowering springs', pn: '2067.140',
    price: 395.0, src: 'UroTuning', laborH: 4,
    vehicle: { drop: { front: [30, 30], rear: [30, 30] }, roll: 1.12, adjustable: false },
    note: 'About 1.2" lower front and rear on the coupe. Uses the factory dampers.',
  }),
  P({
    id: 'bilstein-b14', slot: 'suspension', brand: 'Bilstein', name: 'B14 (PSS) coilovers', pn: '47-249134',
    price: 1299.0, src: 'BimmerWorld', laborH: 5,
    vehicle: { drop: { front: [35, 50], rear: [25, 40] }, roll: 1.25, adjustable: true, reducesInnerClearance: false },
  }),
  P({
    id: 'bilstein-b16', slot: 'suspension', brand: 'Bilstein', name: 'B16 (PSS10) coilovers, 10-way damping', pn: '48-126380',
    price: 2299.0, src: 'BimmerWorld', laborH: 5,
    vehicle: { drop: { front: [35, 50], rear: [25, 40] }, roll: 1.3, adjustable: true, reducesInnerClearance: true },
    note: 'Apex lists the PSS10 among coilovers that reduce front inner wheel clearance.',
  }),
  P({
    id: 'bc-br-i02', slot: 'suspension', brand: 'BC Racing', name: 'BR series coilovers, 30-way, front camber plates', pn: 'I-02-BR-RA',
    price: 1215.0, src: 'shop.bcracing-na.com', laborH: 5,
    vehicle: { drop: { front: [25, 75], rear: [25, 75] }, roll: 1.35, adjustable: true, camberPlates: true, springs: '6 kg/mm F, 8 kg/mm R' },
    note: 'About 1" to 3" below stock height. Camber plates allow up to ~-3° front.',
  }),
  P({
    id: 'kw-v1', slot: 'suspension', brand: 'KW', name: 'Variant 1 (V1) coilovers', pn: '10220022',
    price: 1564.0, src: 'ModBargains', laborH: 5,
    vehicle: { drop: { front: [38, 74], rear: [30, 58] }, roll: 1.3, adjustable: true, reducesInnerClearance: true },
    note: 'Lowering range taken from the KW V3 on the same thread body.',
  }),
  P({
    id: 'kw-v3', slot: 'suspension', brand: 'KW', name: 'Variant 3 (V3) coilovers, separate bump / rebound', pn: '35220022',
    price: 2954.0, src: 'BimmerWorld', laborH: 5,
    vehicle: { drop: { front: [38, 74], rear: [30, 58] }, roll: 1.35, adjustable: true, reducesInnerClearance: true },
  }),
  P({
    id: 'align-performance', slot: 'alignment', brand: 'Shop service', name: 'Performance alignment (set camber / toe)',
    price: 180, estPrice: true, src: 'Typical independent-shop price (est)', laborH: 0,
    vehicle: { alignment: true },
    note: 'Front camber beyond the factory range needs camber plates.',
  }),

  // -------------------------------------------------------------------- BRAKES
  P({
    id: 'stoptech-st40', slot: 'brakesFront', brand: 'StopTech', name: 'ST40 big brake kit, 332 x 32 mm, 4-piston',
    price: 2698.2, src: 'BimmerWorld', laborH: 3, weightKg: -2, estWeight: true,
    vehicle: { brakes: { rotorD: 332, rotorT: 32, vented: true, twoPiece: true, face: 'slotted', caliper: { type: 'fixed', pistons: 4, color: '#c01a1a' } }, minWheel: 17, fade: 0.55 },
    note: 'Check the wheel against StopTech\'s caliper template; most 17" wheels clear.',
  }),
  P({
    id: 'stoptech-st40r', slot: 'brakesFront', brand: 'StopTech', name: 'Trophy ST40R big brake kit, 332 mm, 4-piston',
    price: 3599.1, src: 'BimmerWorld', laborH: 3, weightKg: -3, estWeight: true,
    vehicle: { brakes: { rotorD: 332, rotorT: 32, vented: true, twoPiece: true, face: 'slotted', caliper: { type: 'fixed', pistons: 4, color: '#141414' } }, minWheel: 17, fade: 0.5 },
  }),
  P({
    id: 'brembo-gt-355', slot: 'brakesFront', brand: 'Brembo', name: 'GT front kit, 355 mm, 4-piston',
    price: 3795.25, src: 'BimmerWorld', laborH: 3, weightKg: -2, estWeight: true,
    vehicle: { brakes: { rotorD: 355, rotorT: 32, vented: true, twoPiece: true, face: 'drilled', caliper: { type: 'fixed', pistons: 4, color: '#c01a1a' } }, minWheel: 18, fade: 0.45 },
    note: 'Needs 18" wheels.',
  }),
  P({ id: 'caliper-red', slot: 'caliperPaint', brand: 'Finish', name: 'Caliper paint, red', price: 0, src: 'DIY paint kit cost not included', laborH: 2, visual: { caliperColor: '#c01a1a' } }),
  P({ id: 'caliper-yellow', slot: 'caliperPaint', brand: 'Finish', name: 'Caliper paint, yellow', price: 0, src: 'DIY paint kit cost not included', laborH: 2, visual: { caliperColor: '#e8b40e' } }),
  P({ id: 'caliper-blue', slot: 'caliperPaint', brand: 'Finish', name: 'Caliper paint, M blue', price: 0, src: 'DIY paint kit cost not included', laborH: 2, visual: { caliperColor: '#1c5bb5' } }),

  // ------------------------------------------------------------------ EXTERIOR
  P({
    id: 'garagistic-mtech2-kit', slot: 'frontBumper', alsoSlots: ['sideSkirts', 'rearBumper'], brand: 'Garagistic', name: 'ZHP / M-Tech II complete body kit (front, skirts, rear)',
    price: 765.0, src: 'garagistic.com', laborH: 6 + 16, estLabor: true, paintPanels: 4,
    note: 'ABS; trim and diffusers pre-painted black, body panels bare. Labour includes paint and fit (est).',
    visual: { frontBumper: 'mtech2', sideSkirts: 'mtech2', rearBumper: 'mtech2' },
  }),
  P({
    id: 'bw-zhp-front', slot: 'frontBumper', brand: 'BimmerWorld', name: 'ZHP / M-Tech II replica front bumper with fogs',
    price: 369.99, src: 'BimmerWorld', laborH: 2 + 6, estLabor: true, paintPanels: 1,
    note: '2003-on coupes need the early bumper supports. Unpainted polypropylene.',
    visual: { frontBumper: 'mtech2' },
  }),
  P({
    id: 'bw-m3-front', slot: 'frontBumper', brand: 'BimmerWorld', name: 'M3-style front bumper with fogs (non-M fenders)',
    price: 349.99, src: 'BimmerWorld', laborH: 2.5 + 6, estLabor: true, paintPanels: 1,
    note: 'Fog lights need two wires each; not plug-and-play on non-M cars.',
    visual: { frontBumper: 'm3' },
  }),
  P({
    id: 'bw-zhp-rear', slot: 'rearBumper', brand: 'BimmerWorld', name: 'ZHP / M-Tech II replica rear bumper',
    price: 499.99, src: 'BimmerWorld', laborH: 2 + 6, estLabor: true, paintPanels: 1,
    visual: { rearBumper: 'mtech2' },
  }),
  P({
    id: 'acs-wing-516246320', slot: 'spoiler', brand: 'AC Schnitzer', name: 'Rear wing for E46 coupe', pn: '516246320',
    price: 980.0, src: 'Horsepower Freaks', laborH: 2 + 4, estLabor: true, paintPanels: 0.5, weightKg: 3, estWeight: true,
    visual: { spoiler: 'acs-wing' },
  }),
  P({
    id: 'seibon-hood-oe', slot: 'hood', brand: 'Seibon', name: 'OE-style carbon fibre hood (00-03 coupe)', pn: 'HD9902BMWE462D-OE',
    price: 1400.0, src: 'seiboncarbon.com', laborH: 2.5, weightKg: -9, estWeight: true,
    note: 'Seibon advises hood pins or keeping the factory latches with care; clear-coated gloss carbon.',
    visual: { hood: 'carbon' },
  }),
  P({
    id: 'seibon-csl-trunk', slot: 'trunk', brand: 'Seibon', name: 'CSL-style carbon fibre trunk lid', pn: 'TL9904BMWE462D-C',
    price: 1400.0, src: 'seiboncarbon.com', laborH: 2.5, weightKg: -6, estWeight: true,
    note: 'Integrated ducktail. Seibon: do not reuse the factory struts, the lighter lid may not stay shut.',
    visual: { trunk: 'csl-carbon' },
  }),
  P({
    id: 'm3-style-mirrors', slot: 'mirrors', brand: 'Aftermarket', name: 'M3-style heated power mirrors (99-03 coupe)',
    price: 199.99, src: 'eBay (Sep 2026 listing)', laborH: 1.5 + 3, estLabor: true, paintPanels: 0.4,
    visual: { mirrors: 'm3' },
  }),
  P({
    id: 'depo-ae-projectors', slot: 'headlights', brand: 'DEPO', name: 'Projector headlights with angel eyes (00-03 coupe)',
    price: 380.0, src: 'Unique Style Racing (around $380/pair)', laborH: 1.5,
    visual: { headlights: 'depo-ae' },
  }),
  P({
    id: 'depo-led-tails', slot: 'taillights', brand: 'DEPO', name: 'LED tail lights, red / smoke (00-03 coupe, 4 pc)',
    price: 183.95, src: 'Unique Style Racing', laborH: 0.8,
    visual: { taillights: 'lci-led' },
  }),
  P({
    id: 'black-kidneys', slot: 'grilles', brand: 'Aftermarket', name: 'Gloss black kidney grilles (pre-facelift coupe)',
    price: 94.99, src: 'eBay (Sep 2026 listing)', laborH: 0.3,
    visual: { grilles: 'black' },
  }),
  P({ id: 'tint-carbon-35', slot: 'tint', brand: 'Shop service', name: 'Carbon film tint, 35% (sides + rear)', price: 325, estPrice: true, src: 'Typical US range $250-400 (tint pricing guides, 2026)', visual: { tint: 0.55 } }),
  P({ id: 'tint-ceramic-20', slot: 'tint', brand: 'Shop service', name: 'Ceramic film tint, 20% (sides + rear)', price: 600, estPrice: true, src: 'Typical US range $400-800 (tint pricing guides, 2026)', visual: { tint: 0.75 }, legal: '20% VLT on front side windows is below the legal limit in many US states.' }),
  P({ id: 'refinish-respray', slot: 'refinish', brand: 'Shop service', name: 'Full respray in the chosen colour', price: 4750, estPrice: true, src: 'Typical metallic respray $3,000-6,500 (2026 cost guides)', note: 'Pick the colour in the paint panel.' }),
  P({ id: 'refinish-wrap', slot: 'refinish', brand: 'Shop service', name: 'Full vinyl wrap in the chosen colour', price: 2750, estPrice: true, src: 'Typical coupe wrap $2,000-3,500 gloss (2026 cost guides)', note: 'Satin and matte wraps typically cost $2,500-4,500.' }),

  // ------------------------------------------------------------ INTERIOR / WEIGHT
  P({ id: 'rear-seat-delete', slot: 'weight', brand: 'DIY', name: 'Remove rear bench and seatbacks', price: 0, src: '', laborH: 1, weightKg: -23, note: 'Measured by owners at about 23 kg (50.7 lb). Makes the car a two-seater.' }),
  P({ id: 'spare-delete', slot: 'weight', brand: 'DIY', name: 'Remove full-size spare and jack', price: 0, src: '', laborH: 0.2, weightKg: -23.6, note: 'Coupe full-size spare, reported 52 lb. Carry a repair kit instead.' }),
  P({
    id: 'recaro-pp-pair', slot: 'weight', brand: 'Recaro', name: 'Pole Position (ABE) seats, pair, Ambla',
    price: 3990, src: 'recaro-automotive.com ($1,995 each)', laborH: 3,
    weightKg: -2 * (29.8 - 7.0 - 4.5), estWeight: true,
    note: 'Replaces two ~29.8 kg power sport seats with 7.0 kg shells plus about 4.5 kg of base and sliders each (base/sliders not included in the price).',
  }),
];

export const CUSTOM_ONLY_SLOTS = SLOTS.filter((s) => s.customOnly).map((s) => s.id);
