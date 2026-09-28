// Tyres. Each model has a published UTQG treadwear rating (drives the grip
// estimate) and a retail price for one reference size. Prices for other sizes
// are scaled from that reference by section width and rim diameter and are
// labelled as estimates in the app.

export const TIRE_MODELS = {
  'factory-allseason': {
    brand: 'Factory fit', name: 'H-rated all-season (as delivered)', category: 'All-season', utqg: 500, style: 'allseason',
    note: 'BMW NA listed 205/55R16 H-rated all-season tyres as standard; treadwear class typical of that fitment.',
    ref: null,
  },
  'factory-performance': {
    brand: 'Factory fit', name: 'W-rated summer performance (Sport Package, as delivered)', category: 'Summer performance', utqg: 280, style: 'uhp',
    note: 'BMW NA listed 225/45R17 W-rated performance tyres with the Sport Package; treadwear class typical of that fitment.',
    ref: null,
  },
  'conti-dws06plus': {
    brand: 'Continental', name: 'ExtremeContact DWS06 Plus', category: 'Ultra-high-performance all-season', utqg: 560, style: 'allseason',
    ref: { size: '225/45R17', price: 174.99, src: '1010Tires.com' },
  },
  'michelin-psas4': {
    brand: 'Michelin', name: 'Pilot Sport All Season 4', category: 'Ultra-high-performance all-season', utqg: 540, style: 'allseason',
    ref: { size: '225/45R17', price: 199.99, src: 'Walmart.com' },
  },
  'michelin-ps4s': {
    brand: 'Michelin', name: 'Pilot Sport 4S', category: 'Max-performance summer', utqg: 300, style: 'uhp',
    ref: { size: '245/40R18', price: 317.35, src: 'Wheelership' },
  },
  'yokohama-ad09': {
    brand: 'Yokohama', name: 'Advan Neova AD09', category: 'Extreme-performance summer', utqg: 200, style: 'uhp',
    ref: { size: '245/40R17', price: 283.99, src: 'Salinas Tires & Wheels' },
  },
  'bridgestone-re71rs': {
    brand: 'Bridgestone', name: 'Potenza RE-71RS', category: 'Extreme-performance summer', utqg: 200, style: 'uhp',
    ref: { size: '245/40R18', price: 285.0, src: 'tiresize.com price range $265-301', estPrice: true },
  },
  'falken-rt660': {
    brand: 'Falken', name: 'Azenis RT660', category: 'Extreme-performance summer', utqg: 200, style: 'uhp',
    ref: { size: '245/40R17', price: 308.61, src: 'PMCtire' },
  },
  'toyo-r888r': {
    brand: 'Toyo', name: 'Proxes R888R', category: 'DOT competition (track)', utqg: 100, style: 'track',
    ref: { size: '245/40R17', price: 257.29, src: 'Phastek Performance' },
  },
};

/** Common sizes that suit E46 wheel diameters (width, aspect, rim). */
export const TIRE_SIZES = {
  16: ['205/55R16', '225/50R16'],
  17: ['225/45R17', '235/45R17', '245/40R17', '255/40R17'],
  18: ['225/40R18', '235/40R18', '245/40R18', '245/35R18', '255/35R18', '265/35R18'],
  19: ['225/35R19', '235/35R19', '255/30R19', '265/30R19'],
};

export function parseSize(s) {
  const m = /^(\d{3})\/(\d{2})R(\d{2})$/.exec(s);
  if (!m) return null;
  return { width: +m[1], aspect: +m[2], rim: +m[3], label: s };
}

/** Overall diameter, inches. */
export function tireDiameterIn(size) {
  return size.rim + (2 * size.width * size.aspect) / 100 / 25.4;
}

/** Price scaled from the reference size (estimate unless it is the reference). */
export function tirePrice(modelId, sizeLabel) {
  const m = TIRE_MODELS[modelId];
  if (!m?.ref) return { price: 0, est: false, src: 'on car' };
  if (m.ref.size === sizeLabel) return { price: m.ref.price, est: !!m.ref.estPrice, src: m.ref.src };
  const a = parseSize(m.ref.size), b = parseSize(sizeLabel);
  const k = Math.pow(b.width / a.width, 1.4) * Math.pow(b.rim / a.rim, 1.6);
  return { price: Math.round(m.ref.price * k * 100) / 100, est: true, src: `scaled from ${m.ref.size} at ${m.ref.src}` };
}

/** Weight estimate (lb): ~0.0039 lb per mm of width per inch of diameter for UHP tyres. */
export function tireWeightLb(sizeLabel, style = 'uhp') {
  const s = parseSize(sizeLabel);
  const k = style === 'track' ? 0.0041 : 0.0039;
  return +(k * s.width * tireDiameterIn(s)).toFixed(1);
}
