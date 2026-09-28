// Build state: the user's choices, plus encode/decode for share links and
// local saves. A build only stores choices; everything else is derived.

export const STATE_VERSION = 1;

export function defaultBuild(cat) {
  const c = cat.car;
  return {
    v: STATE_VERSION,
    car: c.id,
    name: 'Stock 325Ci',
    factory: { year: 2002, transmission: c.stock.transmission, sportPackage: false, xenon: false, moonroof: false },
    paint: { code: '364' },
    parts: {},
    wheels: null,   // null = factory wheels for the chosen options
    tires: null,    // null = factory tyres
    setup: { dropF: 0, dropR: 0, camberF: null, camberR: null, boostPsi: null, fuel: '93', fenders: 'stock', spacerF: 0, spacerR: 0, lights: false },
    shop: { laborRate: c.shop.laborRate, taxRate: c.shop.taxRate, diy: false },
  };
}

/** Fill any missing fields from the defaults (older links / saves keep working). */
export function normalize(cat, b) {
  const d = defaultBuild(cat);
  if (!b || b.car !== cat.car.id) return d;
  return {
    ...d, ...b,
    factory: { ...d.factory, ...(b.factory || {}) },
    paint: { ...d.paint, ...(b.paint || {}) },
    parts: { ...(b.parts || {}) },
    setup: { ...d.setup, ...(b.setup || {}) },
    shop: { ...d.shop, ...(b.shop || {}) },
  };
}

// ---- share links: compact JSON -> base64url in the hash
export function encodeBuild(b) {
  const json = JSON.stringify(b);
  const bytes = new TextEncoder().encode(json);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeBuild(str) {
  try {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const s = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

// ---- local saves (per-viewer convenience only)
const KEY = 'buildsheet.saves.v1';
export function listSaves() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
export function saveBuild(b) {
  try {
    const all = listSaves().filter((x) => x.id !== b.id);
    const entry = { id: b.id || `b${Date.now().toString(36)}`, savedAt: new Date().toISOString(), build: { ...b } };
    entry.build.id = entry.id;
    all.unshift(entry);
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 40)));
    return entry;
  } catch {
    return null;
  }
}
export function deleteSave(id) {
  try { localStorage.setItem(KEY, JSON.stringify(listSaves().filter((x) => x.id !== id))); } catch { /* storage unavailable */ }
}

/** Parts selected in a slot as an array. */
export function slotParts(b, slot) {
  const v = b.parts[slot];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}
