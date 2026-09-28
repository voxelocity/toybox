// Wheels available in 5x120 / 72.56 mm hub fitments (E46, E36, E9x ...).
// Each size: d (inch), w (inch), et (mm), price (USD each), lb (weight each),
// estWeight true when the maker does not publish that size's weight.
// Prices checked 27 Sep 2026 at the listed store; weights are the maker's
// published figures unless marked estimated.

export const WHEEL_DESIGNS = {
  'bmw-style-43': {
    brand: 'BMW', name: 'Style 43 "Five Spoke"', cad: 'bmw-43', construction: 'Cast', oem: true,
    finishes: [{ id: 'silver', label: 'Factory silver', color: '#c4c7ca', finish: 'metallic' }],
    cap: 'bmw', bore: 72.56,
    note: 'Standard wheel on the 2001-2003 US 325Ci (BMW NA 2002 press kit).',
    sizes: [{ d: 16, w: 7, et: 47, price: 99.99, lb: 20.57, pn: '36111094505', src: 'Turner Motorsport (MSRP $106, back-ordered)' }],
  },
  'bmw-style-44': {
    brand: 'BMW', name: 'Style 44 "Star Spoke"', cad: 'bmw-44', construction: 'Cast', oem: true,
    finishes: [{ id: 'silver', label: 'Factory silver', color: '#c4c7ca', finish: 'metallic' }],
    cap: 'bmw', bore: 72.56,
    note: '325Ci Sport Package wheel, 225/45R17 all round.',
    sizes: [{ d: 17, w: 8, et: 47, price: 379.0, lb: 23.13, pn: '36111094506', src: 'BimmerWorld' }],
  },
  'bmw-style-68m': {
    brand: 'BMW', name: 'Style 68 M "M Double Spoke" (two-piece)', cad: 'bmw-68m', construction: 'Two-piece cast', oem: true,
    finishes: [{ id: 'silver', label: 'Factory silver', color: '#c9ccd0', finish: 'metallic' }],
    cap: 'bmw', bore: 72.56,
    note: 'Factory staggered set: 17x7.5 ET41 front, 17x8.5 ET50 rear.',
    sizes: [
      { d: 17, w: 7.5, et: 41, price: 715.84, lb: 21.5, pn: '36112229180', src: 'getBMWparts (MSRP $795.37)' },
      { d: 17, w: 8.5, et: 50, price: 715.84, lb: 21.87, pn: '36112229181', src: 'price assumed equal to the front wheel', estPrice: true },
    ],
  },
  'bmw-style-135m': {
    brand: 'BMW', name: 'Style 135 M "M Double Spoke" (330 ZHP)', cad: 'bmw-135m', construction: 'Cast', oem: true,
    finishes: [{ id: 'silver', label: 'Factory silver', color: '#c9ccd0', finish: 'metallic' }],
    cap: 'bmw', bore: 72.56,
    note: 'ZHP staggered set: 18x8 ET47 front, 18x8.5 ET50 rear.',
    sizes: [
      { d: 18, w: 8, et: 47, price: 551.05, lb: 27.78, pn: '36117896470', src: 'BimmerWorld' },
      { d: 18, w: 8.5, et: 50, price: 627.98, lb: 28.77, pn: '36117896490', src: 'BimmerWorld' },
    ],
  },
  'apex-ec7': {
    brand: 'Apex', name: 'EC-7 (flow formed)', cad: 'apex-ec7', construction: 'Flow formed',
    finishes: [
      { id: 'race-silver', label: 'Race Silver', color: '#c8cbce', finish: 'metallic' },
      { id: 'anthracite', label: 'Anthracite', color: '#3b3e42', finish: 'metallic' },
      { id: 'satin-black', label: 'Satin Black', color: '#1a1a1b', finish: 'satin' },
    ],
    cap: 'apex', bore: 72.56,
    sizes: [
      { d: 18, w: 8.5, et: 35, price: 389, lb: 20.1, src: 'apexwheels.com' },
      { d: 18, w: 8.5, et: 45, price: 389, lb: 20.1, estWeight: true, src: 'apexwheels.com' },
      { d: 18, w: 9, et: 31, price: 399, lb: 20.9, estWeight: true, src: 'apexwheels.com' },
      { d: 18, w: 9.5, et: 22, price: 409, lb: 21.9, estWeight: true, src: 'apexwheels.com' },
      { d: 18, w: 9.5, et: 35, price: 409, lb: 21.7, src: 'apexwheels.com' },
      { d: 18, w: 10, et: 25, price: 419, lb: 22.6, estWeight: true, src: 'apexwheels.com' },
    ],
  },
  'apex-arc8': {
    brand: 'Apex', name: 'ARC-8 (flow formed)', cad: 'apex-arc8', construction: 'Flow formed',
    finishes: [
      { id: 'hyper-silver', label: 'Hyper Silver', color: '#b9bcbf', finish: 'metallic' },
      { id: 'anthracite', label: 'Anthracite', color: '#3b3e42', finish: 'metallic' },
      { id: 'satin-black', label: 'Satin Black', color: '#1a1a1b', finish: 'satin' },
    ],
    cap: 'apex', bore: 72.56,
    sizes: [
      { d: 17, w: 8.5, et: 40, price: 329, lb: 17.2, src: 'apexwheels.com' },
      { d: 17, w: 9, et: 30, price: 339, lb: 17.3, src: 'apexwheels.com' },
      { d: 17, w: 9, et: 42, price: 339, lb: 17.8, src: 'apexwheels.com' },
      { d: 17, w: 9.5, et: 35, price: 349, lb: 18.1, estWeight: true, src: 'apexwheels.com' },
      { d: 18, w: 8.5, et: 35, price: 379, lb: 18.7, estWeight: true, src: 'apexwheels.com' },
      { d: 18, w: 8.5, et: 38, price: 379, lb: 18.7, estWeight: true, src: 'apexwheels.com' },
      { d: 18, w: 9, et: 30, price: 389, lb: 19.0, estWeight: true, src: 'apexwheels.com' },
      { d: 18, w: 9, et: 42, price: 389, lb: 19.2, src: 'apexwheels.com' },
    ],
  },
  'enkei-rpf1': {
    brand: 'Enkei', name: 'RPF1', cad: 'enkei-rpf1', construction: 'MAT cast',
    finishes: [
      { id: 'f1-silver', label: 'F1 Silver', color: '#c6c8ca', finish: 'metallic' },
      { id: 'matte-black', label: 'Matte Black', color: '#161616', finish: 'satin' },
    ],
    cap: 'plain', bore: 72.5,
    sizes: [{ d: 18, w: 8.5, et: 40, price: 372.6, lb: 18.85, src: 'BimmerNetwork sale ($414 list); weight from Enkei spec sheet' }],
  },
  'oz-ultraleggera': {
    brand: 'OZ Racing', name: 'Ultraleggera', cad: 'oz-ultraleggera', construction: 'Cast',
    finishes: [
      { id: 'matt-graphite', label: 'Matt Graphite Silver', color: '#6e7277', finish: 'satin' },
      { id: 'matt-black', label: 'Matt Black', color: '#151515', finish: 'satin' },
    ],
    cap: 'plain', bore: 79, hubRings: true,
    sizes: [{ d: 18, w: 8, et: 34, price: 537.0, lb: 21.2, src: 'EUR 471.99 (DriftShop) at 1.1377 USD/EUR; 9.6 kg net' }],
  },
  'bbs-lm': {
    brand: 'BBS', name: 'LM (two-piece forged)', cad: 'bbs-lm', construction: 'Two-piece forged',
    finishes: [
      { id: 'diamond-silver', label: 'Diamond Silver / polished lip', color: '#c9ccce', finish: 'metallic' },
      { id: 'diamond-black', label: 'Diamond Black / polished lip', color: '#1b1c1e', finish: 'gloss' },
      { id: 'gold', label: 'Gold / polished lip', color: '#b89545', finish: 'metallic' },
    ],
    cap: 'bbs', bore: 82, hubRings: true,
    sizes: [{ d: 18, w: 8.5, et: 38, price: 1345.5, lb: 22.4, estWeight: true, src: 'ThreePiece.us 18x8.5+38 listing (5x112); 5x120 is built to the same size/price' }],
  },
  'volk-te37-saga-sl': {
    brand: 'Rays', name: 'Volk Racing TE37 Saga SL (forged)', cad: 'volk-te37', construction: 'Forged',
    finishes: [
      { id: 'pressed-graphite', label: 'Pressed Graphite', color: '#44474b', finish: 'metallic' },
      { id: 'bronze', label: 'Bronze', color: '#8a6a3a', finish: 'metallic' },
    ],
    cap: 'plain', bore: 73,
    sizes: [{ d: 18, w: 9.5, et: 38, price: 918.65, lb: 19.2, estWeight: true, src: 'APG Performance; weight is the 18x9.5 +38 TE37 Saga figure' }],
  },
  'work-meister-s1-3p': {
    brand: 'Work', name: 'Meister S1 3P (three-piece, built to order)', cad: 'work-s1', construction: 'Three-piece forged',
    finishes: [
      { id: 'silver', label: 'Silver / polished lip', color: '#c3c6c9', finish: 'metallic' },
      { id: 'black', label: 'Black / polished lip', color: '#141414', finish: 'gloss' },
    ],
    cap: 'plain', bore: 73,
    note: 'Built to order: Work machines the disk and lip for the offset you specify.',
    sizes: [
      { d: 18, w: 9, et: 30, price: 950, lb: 23.5, estWeight: true, src: 'System Motorsports ("from $950" per 18" wheel)' },
      { d: 18, w: 9.5, et: 35, price: 950, lb: 24.0, estWeight: true, src: 'System Motorsports ("from $950" per 18" wheel)' },
      { d: 18, w: 10, et: 25, price: 950, lb: 24.8, estWeight: true, src: 'System Motorsports ("from $950" per 18" wheel)' },
    ],
  },
};

export const SPACERS = [0, 5, 8, 10, 12, 15, 20];
// Hub-centric bolt-on spacers need longer bolts; H&R DR/DRA pricing varies by size.
