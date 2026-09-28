// Turbochargers and forced-induction hardware shared across cars.
//
// Compressor / turbine wheel sizes and power ranges are Garrett's and
// BorgWarner's published figures. maxFlowLbMin is the compressor's choke flow;
// where the maker does not publish it we estimate it from their power rating
// at ~10.5 hp per lb/min (marked flowEstimated). peakEff is the published or
// typical peak island efficiency. backpressure is the modelled exhaust-to-
// intake pressure ratio penalty for the listed turbine housing.
// Prices: USD retail, checked 27 Sep 2026 at the listed store.

const USD = (v, src) => ({ price: v, priceSource: src });

export const TURBOS = {
  'garrett-gt2860rs': {
    brand: 'Garrett', name: 'GT2860RS (0.64 A/R)', pn: '836026-5014S',
    hp: [250, 360], dispL: [1.8, 3.0],
    compInducer: 47, compExducer: 60, turbineMm: 54, ar: 0.64, flange: 'T25 in / 5-bolt out, internal wastegate',
    maxFlowLbMin: 34, flowEstimated: true, peakEff: 0.76, backpressure: 0.42, bearing: 'Dual ball bearing',
    internalWastegate: true,
    ...USD(1217.99, 'Summit Racing'),
  },
  'garrett-g25-550': {
    brand: 'Garrett', name: 'G25-550 (0.72 A/R)', pn: '877895-5003S',
    hp: [300, 550], dispL: [1.4, 3.0],
    compInducer: 48, compExducer: 60, turbineMm: 54, ar: 0.72, flange: 'V-band in/out, internal wastegate',
    maxFlowLbMin: 52, flowEstimated: true, peakEff: 0.80, backpressure: 0.34, bearing: 'Dual ball bearing',
    internalWastegate: true,
    ...USD(2636.66, 'ATP Turbo'),
  },
  'garrett-g25-660': {
    brand: 'Garrett', name: 'G25-660 (0.72 A/R)', pn: '877895-5005S',
    hp: [350, 660], dispL: [1.4, 3.0],
    compInducer: 54, compExducer: 67, turbineMm: 54, ar: 0.72, flange: 'V-band in/out, internal wastegate',
    maxFlowLbMin: 63, flowEstimated: true, peakEff: 0.79, backpressure: 0.36, bearing: 'Dual ball bearing',
    internalWastegate: true,
    ...USD(2847.59, 'ATP Turbo'),
  },
  'borgwarner-efr6758': {
    brand: 'BorgWarner', name: 'EFR 6758 (0.64 A/R)', pn: '179388',
    hp: [275, 450], dispL: [1.6, 3.0],
    compInducer: 53.9, compExducer: 67, turbineMm: 58, ar: 0.64, flange: 'T25, internal wastegate',
    maxFlowLbMin: 49, flowEstimated: false, peakEff: 0.80, backpressure: 0.36, bearing: 'Dual ball bearing, gamma-Ti turbine',
    internalWastegate: true,
    ...USD(1699.0, 'Himni Racing'),
  },
  'garrett-gtx3076r-g2': {
    brand: 'Garrett', name: 'GTX3076R Gen II (0.82 A/R T3)', pn: '856801-5026S',
    hp: [400, 750], dispL: [1.8, 3.0],
    compInducer: 58, compExducer: 76, turbineMm: 60, ar: 0.82, flange: 'T3 in / V-band out, external wastegate',
    maxFlowLbMin: 64, flowEstimated: true, peakEff: 0.78, backpressure: 0.28, bearing: 'Dual ceramic ball bearing',
    internalWastegate: false,
    ...USD(2377.49, 'Real Street Performance'),
  },
  'garrett-g30-770': {
    brand: 'Garrett', name: 'G30-770 (0.83 A/R T3)', pn: '880704 series (T3 0.83)',
    hp: [475, 770], dispL: [2.0, 3.5],
    compInducer: 58, compExducer: 71, turbineMm: 60, ar: 0.83, flange: 'T3 in / 3" V-band out, external wastegate',
    maxFlowLbMin: 72, flowEstimated: true, peakEff: 0.76, backpressure: 0.27, bearing: 'Dual ball bearing',
    internalWastegate: false,
    ...USD(2642.37, 'ATP Turbo'),
  },
};

// Superchargers inside the complete kits (the kit carries the price).
export const SUPERCHARGERS = {
  'vortech-v3-si': { brand: 'Vortech', name: 'V-3 Si-trim', type: 'centrifugal', maxFlowLbMin: 36, peakEff: 0.76 },
  'rotrex-c30-94': { brand: 'Rotrex', name: 'C30-94', type: 'centrifugal', maxFlowLbMin: 40, peakEff: 0.78 },
};

// Turbos that only come inside complete kits.
export const KIT_TURBOS = {
  'gt3582-jb': {
    brand: 'Hopwood kit', name: 'GT3582-type journal-bearing turbo (0.62 A/R)',
    compInducer: 61, compExducer: 82, turbineMm: 68, ar: 0.62, maxFlowLbMin: 62, flowEstimated: true,
    peakEff: 0.75, backpressure: 0.42, bearing: 'Journal bearing', internalWastegate: false,
  },
  'gtx3076-g2-type': {
    brand: 'BE Racing kit', name: 'Pulsar GTX3076 Gen II-type (0.82 A/R T3)',
    compInducer: 58, compExducer: 76, turbineMm: 60, ar: 0.82, maxFlowLbMin: 62, flowEstimated: true,
    peakEff: 0.76, backpressure: 0.3, bearing: 'Ball bearing, water cooled', internalWastegate: false,
  },
};

export const INTERCOOLERS = {
  'treadstone-tr8': { brand: 'Treadstone', name: 'TR8 bar-and-plate core 22" x 7.8" x 3.5" (500 hp)', pn: 'TR8', effectiveness: 0.72, dropPsi: 1.3, ...USD(350.0, 'CW Turbochargers') },
  'hopwood-600': { brand: 'Hopwood kit', name: '600 x 300 x 76 mm front-mount', effectiveness: 0.78, dropPsi: 1.0 },
  'aa-fmic': { brand: 'Active Autowerke kit', name: 'Front-mount air-to-air', effectiveness: 0.74, dropPsi: 1.1 },
};
