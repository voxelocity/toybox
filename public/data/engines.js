// Engine definitions shared by every car that can use them.
//
// torqueCurve: crank torque [rpm, Nm] as rated for the US market (SAE J1349).
// The shapes are BMW's published full-load curves (BMW NA training module
// "E85 M54 Engine", figure 45-03-02, which plots both M54B25 and M54B30),
// scaled to the US ratings: M54B25 184 hp @ 6000 / 175 lb-ft @ 3500,
// M54B30 (330Ci) 225 hp @ 5900 / 214 lb-ft @ 3500.
//
// stock*LossKPa are the calibration assumptions for how restrictive the
// factory induction and exhaust are at peak-power airflow. They are
// engineering estimates for a catalysed 2.5-3.0 L six and are what the
// bolt-on predictions are measured against; they are shown in the app.

const DIN_TO_US_B25 = 237 / 245; // 175 lb-ft SAE vs 245 Nm DIN
const DIN_TO_US_B30 = 0.978;

const scale = (pts, k) => pts.map(([r, t]) => [r, +(t * k).toFixed(1)]);

export const ENGINES = {
  m54b25: {
    id: 'm54b25',
    name: 'BMW M54B25',
    layout: 'Inline 6, DOHC 24v, double VANOS, DISA',
    displacementL: 2.494,
    boreMm: 84, strokeMm: 75, cr: 10.5, cylinders: 6,
    idle: 700, limiter: 6500, redline: 6500, maxSafeRpm: 7000,
    dme: 'Siemens MS43',
    torqueCurve: scale([[1000, 178], [1500, 220], [2000, 226], [2500, 232], [3000, 239], [3500, 245], [4000, 245],
      [4500, 245], [4750, 245], [5000, 241], [5500, 234], [5800, 229], [6000, 224], [6250, 213], [6500, 199]], DIN_TO_US_B25),
    ratedUS: { hp: 184, hpRpm: 6000, lbft: 175, lbftRpm: 3500 },
    ratedEU: { kw: 141, ps: 192, nm: 245 },
    stockInjectorCc: 208, stockInjectorRefBar: 3.0, fuelPressureBar: 3.5,
    stockPumpLph: 130,
    stockMafLimitGs: 185,
    stockIntakeLossKPa: 3.4,
    stockManifoldBackpressureKPa: 14,
    stockCatbackBackpressureKPa: 12,
    // community-reported comfort limits of the cast pistons / stock rods
    internals: { stockSafeNm: 400, stockRiskNm: 480, forgedSafeNm: 700 },
    massKg: 170,
    sources: [
      'BMW NA technical training, E85 M54 Engine (2002), technical data and fig. 45-03-02',
      'BMW NA 2002 3 Series press kit (US ratings)',
    ],
  },
  m54b30: {
    id: 'm54b30',
    name: 'BMW M54B30',
    layout: 'Inline 6, DOHC 24v, double VANOS, DISA',
    displacementL: 2.979,
    boreMm: 84, strokeMm: 89.6, cr: 10.2, cylinders: 6,
    idle: 700, limiter: 6500, redline: 6500, maxSafeRpm: 7000,
    dme: 'Siemens MS43',
    torqueCurve: scale([[1000, 229], [1500, 270], [2000, 277], [2500, 284], [3000, 292], [3500, 300], [4000, 300],
      [4500, 300], [4750, 300], [5000, 297], [5500, 289], [5900, 275], [6250, 259], [6500, 243]], DIN_TO_US_B30),
    ratedUS: { hp: 225, hpRpm: 5900, lbft: 214, lbftRpm: 3500 },
    ratedEU: { kw: 170, ps: 231, nm: 300 },
    stockInjectorCc: 236, stockInjectorRefBar: 3.0, fuelPressureBar: 3.5,
    stockPumpLph: 130,
    stockMafLimitGs: 200,
    stockIntakeLossKPa: 3.6,
    stockManifoldBackpressureKPa: 14,
    stockCatbackBackpressureKPa: 12,
    internals: { stockSafeNm: 430, stockRiskNm: 520, forgedSafeNm: 750 },
    massKg: 175,
    sources: [
      'BMW NA technical training, E85 M54 Engine (2002), technical data and fig. 45-03-02',
      'US 330Ci rating 225 hp / 214 lb-ft',
    ],
  },
};
