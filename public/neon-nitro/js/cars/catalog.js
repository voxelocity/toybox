// Car bodies, parts, prices and stat effects. Every visual option in the shop
// lives here; geometry generators key off these ids.

export const STAT_KEYS = ['spd', 'acc', 'hnd', 'drf', 'wgt'];
export const STAT_LABELS = { spd: 'Top Speed', acc: 'Acceleration', hnd: 'Handling', drf: 'Drift', wgt: 'Weight' };

export const BODIES = {
  kaze: {
    id: 'kaze', name: 'KAZE GT-S', jp: '風', kind: 'sedan', price: 10000,
    blurb: 'Balanced JDM street coupe. Long hood, crisp shoulder, born for the touge.',
    base: { spd: 6, acc: 6, hnd: 6, drf: 7, wgt: 5 },
    defaultPaint: { color: '#ff2d6f', finish: 'gloss' },
  },
  oni: {
    id: 'oni', name: 'ONI HAULER', jp: '鬼', kind: 'truck', price: 14000,
    blurb: 'Mini-truck muscle. Heavy hitter with a big top end and a bigger attitude.',
    base: { spd: 7, acc: 4, hnd: 4, drf: 5, wgt: 9 },
    defaultPaint: { color: '#ffb21e', finish: 'gloss' },
  },
  raiden: {
    id: 'raiden', name: 'RAIDEN RS', jp: '雷', kind: 'coupe', price: 16000,
    blurb: 'Low, wide fastback. Explosive launch and scalpel handling.',
    base: { spd: 6, acc: 8, hnd: 8, drf: 5, wgt: 3 },
    defaultPaint: { color: '#20d8ff', finish: 'metallic' },
  },
};
export const BODY_ORDER = ['kaze', 'oni', 'raiden'];

// part: { id, name, price, stats, desc, only?: [bodies] }
const P = (id, name, price, stats = {}, desc = '', only = null) => ({ id, name, price, stats, desc, only });

export const CATEGORIES = [
  { id: 'front', name: 'Front', icon: '▶', desc: 'Nose, lights, grille and bumper' },
  { id: 'rear', name: 'Rear', icon: '◀', desc: 'Tail, lights, bumper and exhaust' },
  { id: 'side', name: 'Side', icon: '▮', desc: 'Kits, flares and side exits' },
  { id: 'aero', name: 'Aero', icon: '▲', desc: 'Wings and spoilers' },
  { id: 'wheels', name: 'Wheels', icon: '◉', desc: 'Rim design and colour' },
  { id: 'height', name: 'Ride Height', icon: '↕', desc: 'Suspension drop or lift' },
  { id: 'camber', name: 'Camber', icon: '⟋', desc: 'Wheel tilt, from stock to oni-kyan' },
  { id: 'paint', name: 'Paint', icon: '●', desc: 'Colour and finish' },
  { id: 'livery', name: 'Livery', icon: '✦', desc: 'Vinyl designs and colour' },
];

export const PARTS = {
  front: {
    kaze: [
      P('stock', 'Stock S-Nose', 0, {}, 'Slim angry headlights and a clean bumper.'),
      P('gtr', 'Midnight GT', 4200, { spd: 0.4, wgt: 0.3 }, 'Blunt boxer nose, twin square lamps, gaping grille.'),
      P('euro', 'Euro Kidney', 3800, { hnd: 0.4 }, 'Twin kidney grille, angel-eye halos, triple intakes.'),
      P('kaido', 'Kaido Racer', 5600, { wgt: 0.8, spd: -0.2 }, 'Bosozoku deppa chin, exposed oil cooler, yellow fogs.'),
      P('attack', 'Time Attack', 7800, { hnd: 0.9, spd: -0.2 }, 'Barn-door splitter, canards and a louvred hood.'),
      P('missile', 'Drift Missile', 1500, { acc: 0.4, wgt: -0.5, drf: 0.4 }, 'Bumper? Where we\'re going we don\'t need bumpers.'),
    ],
    oni: [
      P('stock', 'Work Grille', 0, {}, 'Honest chrome bars and square lamps.'),
      P('deko', 'Dekotora', 7400, { wgt: 1, acc: -0.2 }, 'Chrome fortress bumper, visor and forty marker lamps.'),
      P('baja', 'Baja Runner', 4600, { hnd: 0.3, wgt: 0.4 }, 'Bull bar, spot lamps, skid plate and a roof light bar.'),
      P('lowrider', 'Minitrucker', 3900, { spd: 0.4 }, 'Billet grille, shaved roll pan and frenched lamps.'),
      P('blower', 'Blown Hot Rod', 8800, { acc: 0.9, spd: 0.2, hnd: -0.3 }, 'A supercharger punched straight through the hood.'),
      P('kaido', 'Kaido Hauler', 5200, { wgt: 0.8 }, 'Deppa chin and oil cooler on a work truck. Why not.'),
    ],
    raiden: [
      P('stock', 'Stock Nose', 0, {}, 'Smooth fascia and teardrop lamps.'),
      P('popup', 'Pop-Up Retro', 5200, { drf: 0.4 }, 'Knife-edge wedge with flip-up headlights.'),
      P('hyper', 'Hyper LED', 6400, { spd: 0.5 }, 'Floating nose, LED slits and cavernous intakes.'),
      P('shark', 'Shark Nose', 4800, { spd: 0.3, hnd: 0.2 }, 'Long canted snout and a round mouth.'),
      P('attack', 'Time Attack', 7800, { hnd: 0.9, spd: -0.2 }, 'Barn-door splitter, canards and a louvred hood.'),
      P('kaido', 'Kaido Racer', 5600, { wgt: 0.8, spd: -0.2 }, 'Bosozoku deppa chin, exposed oil cooler, yellow fogs.'),
    ],
  },
  rear: {
    kaze: [
      P('stock', 'Stock Tail', 0, {}, 'Slim wraparound lamps, single tip.'),
      P('quad', 'Quad Rounds', 3400, { spd: 0.3 }, 'Four round lamps and twin tips.'),
      P('ducktail', 'Ducktail Bar', 4200, { hnd: 0.4 }, 'Integrated ducktail and a full-width light bar.'),
      P('takeyari', 'Takeyari Spears', 6600, { acc: 0.4, wgt: 0.2 }, 'Bamboo-spear exhausts past the roofline. Boost flames last longer.'),
      P('diffuser', 'Race Diffuser', 7200, { hnd: 0.7, spd: 0.2 }, 'Carbon diffuser, centre exit and a blinking rain light.'),
      P('missile', 'Drift Missile', 1200, { acc: 0.3, wgt: -0.4 }, 'Crash bar, straight pipe, tow strap.'),
    ],
    oni: [
      P('stock', 'Open Bed', 0, {}, 'Tailgate and work lamps.'),
      P('deko', 'Deko Shell', 7600, { wgt: 1.2, spd: 0.2, acc: -0.3 }, 'Chrome-trimmed bed box ablaze with lamps.'),
      P('baja', 'Baja Cage', 4400, { hnd: 0.3 }, 'Sport bar, spot lamps and a spare in the bed.'),
      P('stacks', 'Smoke Stacks', 5800, { acc: 0.5, wgt: 0.3 }, 'Twin chrome big-rig stacks behind the cab.'),
      P('tonneau', 'Race Tonneau', 5200, { spd: 0.6 }, 'Flat cover, bed spoiler and diffuser.'),
      P('takeyari', 'Takeyari Spears', 6600, { acc: 0.4, wgt: 0.2 }, 'Bamboo-spear exhausts. Boost flames last longer.'),
    ],
    raiden: [
      P('stock', 'Round Tail', 0, {}, 'Twin round lamps each side, centre tip.'),
      P('lightbar', 'Light Blade', 3800, { spd: 0.3 }, 'Edge-to-edge light blade.'),
      P('ducktail', 'Ducktail', 4200, { hnd: 0.4 }, 'Kicked-up ducktail with slotted lamps.'),
      P('venturi', 'Venturi Tunnel', 7400, { hnd: 0.6, spd: 0.3 }, 'Open rear, mesh and a massive venturi.'),
      P('takeyari', 'Takeyari Spears', 6600, { acc: 0.4, wgt: 0.2 }, 'Bamboo-spear exhausts. Boost flames last longer.'),
      P('missile', 'Drift Missile', 1200, { acc: 0.3, wgt: -0.4 }, 'Crash bar, straight pipe, tow strap.'),
    ],
  },
  side: {
    all: [
      P('stock', 'Stock Sides', 0, {}, 'Factory doors and sills.'),
      P('skirts', 'Street Skirts', 1800, { hnd: 0.3 }, 'Deep skirts, side splitters, aero mirrors.'),
      P('widebody', 'Bolt-On Widebody', 9400, { hnd: 1, wgt: 0.4, spd: -0.2 }, 'Riveted overfenders, wider track, pure attitude.'),
      P('sidepipes', 'Side Exit Pipes', 4200, { acc: 0.6 }, 'Twin side-exit exhausts that spit flame on boost.'),
      P('works', 'Works Fenders', 6800, { hnd: 0.6, wgt: 0.3, drf: 0.3 }, 'Boxy bolt-on works flares and mud flaps.'),
      P('silhouette', 'Silhouette GT', 11500, { hnd: 1.1, spd: 0.3, wgt: 0.3 }, 'Race silhouette pods, vents, side exits. The full monty.'),
    ],
  },
  aero: {
    all: [
      P('none', 'No Wing', 0, { spd: 0.2 }, 'Clean deck, less drag.'),
      P('lip', 'Duck Lip', 1200, { hnd: 0.2 }, 'Small bolt-on lip spoiler.'),
      P('gt', 'GT Wing', 4800, { hnd: 0.7, spd: -0.2 }, 'Big wing on end-plate stands.'),
      P('swan', 'Swan Neck', 6200, { hnd: 0.9, spd: -0.2 }, 'Top-mounted swan-neck wing with huge end plates.'),
      P('boso', 'Boso Tower', 5400, { hnd: 0.4, wgt: 0.2, drf: 0.3 }, 'Sky-high bosozoku wing. Visible from orbit.'),
      P('roof', 'Roof Fin Kit', 3200, { spd: 0.3, hnd: 0.2 }, 'Roof spoiler, shark fin and vortex generators.'),
    ],
  },
  wheels: {
    all: [
      P('stock5', 'Stock 5-Spoke', 0, {}, 'Five fat spokes.'),
      P('six', 'Forged Six', 3600, { acc: 0.5 }, 'Forged six-spoke. Featherlight.'),
      P('mesh', 'Cross Mesh', 3200, { hnd: 0.3, acc: 0.2 }, 'Classic cross-spoke mesh.'),
      P('dish', 'Deep Dish', 4200, { drf: 0.5, wgt: 0.2 }, 'Three-piece with a lip you could eat soup from.'),
      P('fan', 'Turbofan', 3900, { spd: 0.5 }, 'Aero discs with fan blades.'),
      P('star', 'Star 10', 2800, { hnd: 0.3 }, 'Ten-spoke star.'),
      P('steel', 'Steelies', 900, { wgt: 0.3 }, 'Painted steelies and a dog-dish cap.'),
      P('neon', 'Neon Ring', 6500, { spd: 0.3, acc: 0.3 }, 'Hub-less glowing rim ring. Very 2099.'),
    ],
  },
  height: {
    all: [
      P('lifted', 'Lifted', 1800, { hnd: -0.6, wgt: 0.2 }, 'Raised up. Ignores rough ground better.'),
      P('stock', 'Stock', 0, {}, 'Factory ride height.'),
      P('sport', 'Sport Springs', 900, { hnd: 0.3 }, 'A tasteful drop.'),
      P('lowered', 'Coilovers', 2200, { hnd: 0.6 }, 'Proper low.'),
      P('slammed', 'Bagged & Slammed', 3400, { hnd: 0.8, drf: 0.2 }, 'Frame on the floor.'),
    ],
  },
  camber: {
    all: [
      P('stock', 'Stock', 0, {}, '0°. Sensible.'),
      P('mild', 'Mild', 600, { hnd: 0.2 }, '-3°. Track alignment.'),
      P('aggro', 'Aggressive', 1200, { drf: 0.4 }, '-7°. Stance bro approved.'),
      P('stance', 'Flush Stance', 1900, { drf: 0.7, hnd: -0.2 }, '-12°. Pokes, stretched, proud.'),
      P('onikyan', 'Oni-Kyan', 2600, { drf: 1.2, hnd: -0.5 }, '-22°. Demon camber. Physics weeps.'),
    ],
  },
  livery: {
    all: [
      P('none', 'Solid', 0, {}, 'Just paint.'),
      P('stripes', 'Twin Stripes', 1200, {}, 'Bonnet-to-boot racing stripes.'),
      P('flames', 'Hot Flames', 2200, {}, 'Hand-licked hot-rod flames.'),
      P('kanji', 'Kanji Storm', 2600, {}, 'Brush-stroke kanji and speed slashes.'),
      P('sakura', 'Sakura Drift', 2400, {}, 'Falling cherry blossoms and a fade.'),
      P('tiger', 'Tora Stripes', 2000, {}, 'Tiger stripes, full wrap.'),
      P('bolt', 'Thunder Bolt', 1800, {}, 'Lightning slash down each side.'),
      P('sticker', 'Sticker Bomb', 3200, {}, 'Racing roundel and a wall of sponsor decals.'),
      P('circuit', 'Cyber Circuit', 3600, {}, 'Glowing neon circuit traces.'),
      P('wave', 'Great Wave', 4500, {}, 'Curling ukiyo-e waves along the flanks.'),
      P('split', 'Two-Tone', 1400, {}, 'Lower half in the livery colour.'),
      P('checker', 'Checker Rush', 1600, {}, 'Checkered flag fade.'),
    ],
  },
};

export const FINISHES = [
  { id: 'gloss', name: 'Gloss', price: 500, finish: [0.9, 0, 0, 0], kind: 0 },
  { id: 'metallic', name: 'Metallic', price: 900, finish: [0.9, 0.9, 0, 0], kind: 1 },
  { id: 'pearl', name: 'Pearl', price: 1500, finish: [1.0, 0.4, 0.6, 0], kind: 2 },
  { id: 'matte', name: 'Matte', price: 1200, finish: [0, 0, 0, 1], kind: 3 },
  { id: 'chrome', name: 'Chrome', price: 4500, finish: [1, 0, 0, 0], kind: 4 },
  { id: 'chameleon', name: 'Chameleon', price: 6000, finish: [1, 0.5, 1, 0], kind: 5 },
  { id: 'neon', name: 'Neon Glow', price: 5000, finish: [0.6, 0, 0, 0], kind: 6 },
];

export const PAINT_COLORS = [
  '#ff2d6f', '#ff4f2e', '#ff8a1e', '#ffb21e', '#ffe23b', '#c6ff3a', '#56f06b', '#1ee89c',
  '#20d8ff', '#2a8cff', '#3e4dff', '#8a3dff', '#c93dff', '#ff5ccf', '#ffffff', '#c9ccd6',
  '#7c8190', '#2b2f3a', '#111216', '#7a1030', '#0f3d2e', '#10254f', '#6b4b2a', '#e8d2a6',
];

export const ACCENT_COLORS = ['#ffffff', '#111216', '#ffe23b', '#ff2d6f', '#20d8ff', '#56f06b', '#ff8a1e', '#8a3dff', '#c9ccd6', '#ff5ccf', '#2a8cff', '#e8d2a6'];
export const RIM_COLORS = ['#d7d9de', '#1a1b20', '#f2c14e', '#ffffff', '#ff2d6f', '#20d8ff', '#56f06b', '#8a3dff', '#c47a3a', '#ff8a1e'];

export const RECOLOR_PRICE = { livery: 300, rim: 250 };

export const HEIGHTS = { lifted: 0.13, stock: 0, sport: -0.035, lowered: -0.07, slammed: -0.11 };
export const CAMBERS = { stock: 0, mild: 3, aggro: 7, stance: 12, onikyan: 22 };

export function partsFor(cat, body) {
  const c = PARTS[cat];
  if (!c) return [];
  return c[body] || c.all || [];
}

export function findPart(cat, body, id) {
  return partsFor(cat, body).find((p) => p.id === id) || partsFor(cat, body)[0];
}

export function defaultConfig(body) {
  const b = BODIES[body];
  return {
    body,
    front: 'stock', rear: 'stock', side: 'stock', aero: 'none', wheels: 'stock5',
    height: 'stock', camber: 'stock', livery: 'none',
    paint: b.defaultPaint.color, finish: b.defaultPaint.finish,
    liveryColor: '#ffffff', rimColor: '#d7d9de',
  };
}

/** Final 1-10 stats for a config. */
export function statsFor(cfg) {
  const s = { ...BODIES[cfg.body].base };
  for (const cat of ['front', 'rear', 'side', 'aero', 'wheels', 'height', 'camber']) {
    const p = findPart(cat, cfg.body, cfg[cat]);
    for (const k of STAT_KEYS) s[k] += p?.stats?.[k] || 0;
  }
  for (const k of STAT_KEYS) s[k] = Math.max(1, Math.min(10, s[k]));
  return s;
}

/** Random but coherent config for AI rivals. */
export function randomConfig(rng, body) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const cfg = defaultConfig(body);
  for (const cat of ['front', 'rear', 'side', 'aero', 'wheels', 'height', 'camber', 'livery']) cfg[cat] = pick(partsFor(cat, body)).id;
  cfg.paint = pick(PAINT_COLORS.slice(0, 22));
  cfg.finish = pick(['gloss', 'gloss', 'metallic', 'pearl', 'matte', 'chameleon', 'neon']);
  cfg.liveryColor = pick(ACCENT_COLORS);
  if (cfg.liveryColor.toLowerCase() === cfg.paint.toLowerCase()) cfg.liveryColor = '#ffffff';
  cfg.rimColor = pick(RIM_COLORS);
  return cfg;
}
