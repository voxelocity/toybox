// Championship structure, rivals and economy.

export const CLASSES = [
  { id: 'street', name: 'Street', jp: '街', pace: 0.9, skill: 0.4, pay: 1, desc: 'Learn the lines. Rivals are hungry but beatable.' },
  { id: 'pro', name: 'Pro', jp: '猛者', pace: 0.97, skill: 0.62, pay: 1.7, desc: 'Faster rivals who drift every corner and fight back.', unlock: 'Win a trophy in every Street cup' },
  { id: 'legend', name: 'Legend', jp: '伝説', pace: 1.03, skill: 0.85, pay: 2.6, desc: 'Midnight legends. Perfect lines, ruthless items.', unlock: 'Win a trophy in every Pro cup' },
];

export const TRACKS = {
  shibuya: { id: 'shibuya', name: 'Shibuya Scramble', jp: '渋谷', blurb: 'Neon canyons, the famous crossing and a dive under the rail yard.' },
  wangan: { id: 'wangan', name: 'Wangan Midnight', jp: '湾岸', blurb: 'Flat-out expressway, a figure-eight flyover, traffic and the bay bridge.' },
  haruna: { id: 'haruna', name: 'Haruna Touge', jp: '榛名峠', blurb: 'Sakura hairpins, a torii tunnel and gutter-hooking mountain drifts.' },
  harbor: { id: 'harbor', name: 'Kaiju Harbor', jp: '怪獣港', blurb: 'Container canyons, crane drops and a drawbridge jump. Something is in the bay.' },
  akiba: { id: 'akiba', name: 'Akiba Overdrive', jp: '秋葉原', blurb: 'Electric Town madness: a spiral car park climb and a rooftop leap.' },
  skytree: { id: 'skytree', name: 'Neo Tokyo Tower', jp: '新東京塔', blurb: 'Mag-lev skyways spiralling around the megatower. The final battle.' },
};

export const CUPS = [
  { id: 'neon', name: 'Neon Cup', jp: 'ネオン杯', tracks: ['shibuya', 'wangan', 'haruna'], color: '#20d8ff' },
  { id: 'kaiju', name: 'Kaiju Cup', jp: '怪獣杯', tracks: ['harbor', 'akiba', 'skytree'], color: '#ff2d6f', unlock: 'Win a trophy in the Neon Cup' },
];

export const POINTS = [15, 12, 10, 8, 6, 4, 2, 1];
export const PAYOUT = [3200, 2400, 1800, 1300, 1000, 800, 600, 450];
export const CUP_BONUS = { 3: 6000, 2: 3500, 1: 2000 };
export const TT_REWARD = { gold: 3000, silver: 1500, bronze: 800 };
// time-trial par times in seconds: gold, silver, bronze (3 laps, three nitros)
export const TT_PAR = {
  shibuya: [120, 130, 142], wangan: [130, 141, 155], haruna: [125, 136, 150], harbor: [122, 133, 146], akiba: [118, 129, 142], skytree: [130, 141, 155],
};

// Rivals keep a signature ride so you learn who's who.
export const RIVALS = [
  { name: 'KIRA', body: 'raiden', cfg: { front: 'hyper', rear: 'lightbar', side: 'widebody', aero: 'swan', wheels: 'six', height: 'lowered', camber: 'mild', paint: '#8a3dff', finish: 'chameleon', livery: 'circuit', liveryColor: '#20d8ff', rimColor: '#1a1b20' } },
  { name: 'BOSO BEN', body: 'kaze', cfg: { front: 'kaido', rear: 'takeyari', side: 'works', aero: 'boso', wheels: 'dish', height: 'slammed', camber: 'onikyan', paint: '#ffe23b', finish: 'gloss', livery: 'kanji', liveryColor: '#ff2d6f', rimColor: '#d7d9de' } },
  { name: 'MOMO', body: 'raiden', cfg: { front: 'popup', rear: 'stock', side: 'skirts', aero: 'lip', wheels: 'mesh', height: 'sport', camber: 'aggro', paint: '#ff5ccf', finish: 'pearl', livery: 'sakura', liveryColor: '#ffffff', rimColor: '#f2c14e' } },
  { name: 'DEKO-JI', body: 'oni', cfg: { front: 'deko', rear: 'deko', side: 'stock', aero: 'none', wheels: 'star', height: 'stock', camber: 'stock', paint: '#20d8ff', finish: 'chrome', livery: 'wave', liveryColor: '#10254f', rimColor: '#d7d9de' } },
  { name: 'ZERO', body: 'kaze', cfg: { front: 'gtr', rear: 'quad', side: 'silhouette', aero: 'gt', wheels: 'six', height: 'lowered', camber: 'mild', paint: '#2b2f3a', finish: 'matte', livery: 'stripes', liveryColor: '#ff4f2e', rimColor: '#ff8a1e' } },
  { name: 'RAIJIN', body: 'oni', cfg: { front: 'baja', rear: 'baja', side: 'works', aero: 'roof', wheels: 'steel', height: 'lifted', camber: 'stock', paint: '#56f06b', finish: 'gloss', livery: 'bolt', liveryColor: '#111216', rimColor: '#1a1b20' } },
  { name: 'YUKI', body: 'kaze', cfg: { front: 'euro', rear: 'ducktail', side: 'skirts', aero: 'lip', wheels: 'fan', height: 'sport', camber: 'mild', paint: '#ffffff', finish: 'pearl', livery: 'sticker', liveryColor: '#2a8cff', rimColor: '#20d8ff' } },
  { name: 'HOTROD HANA', body: 'oni', cfg: { front: 'blower', rear: 'stacks', side: 'sidepipes', aero: 'none', wheels: 'dish', height: 'slammed', camber: 'aggro', paint: '#ff4f2e', finish: 'metallic', livery: 'flames', liveryColor: '#ffe23b', rimColor: '#d7d9de' } },
  { name: 'SHIN', body: 'raiden', cfg: { front: 'attack', rear: 'venturi', side: 'widebody', aero: 'gt', wheels: 'star', height: 'lowered', camber: 'stance', paint: '#ff2d6f', finish: 'metallic', livery: 'checker', liveryColor: '#ffffff', rimColor: '#1a1b20' } },
  { name: 'TOFU TAKU', body: 'kaze', cfg: { front: 'stock', rear: 'stock', side: 'stock', aero: 'none', wheels: 'steel', height: 'stock', camber: 'stock', paint: '#f4f4f4', finish: 'gloss', livery: 'split', liveryColor: '#111216', rimColor: '#c9ccd6' } },
];

/** fmt money: internal units * 100 as yen */
export function money(n) { return '¥' + Math.round(n * 100).toLocaleString('en-US'); }

export function classUnlocked(save, cls) {
  if (cls === 'street') return true;
  const prev = cls === 'pro' ? 'street' : 'pro';
  return CUPS.every((c) => save.trophy(c.id, prev) > 0);
}
export function cupUnlocked(save, cup) {
  if (cup === 'neon') return true;
  return ['street', 'pro', 'legend'].some((cl) => save.trophy('neon', cl) > 0);
}
export function unlockedTracks(save) {
  return CUPS.filter((c) => cupUnlocked(save, c.id)).flatMap((c) => c.tracks);
}
