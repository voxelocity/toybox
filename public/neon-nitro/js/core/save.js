// Persistent progress in localStorage (money, garage, trophies, settings).
import { BODY_ORDER, defaultConfig } from '../cars/catalog.js';

const KEY = 'neonNitro.save.v1';

export const DEFAULT_SETTINGS = {
  master: 0.8, music: 0.6, sfx: 0.85, quality: 'auto', autoAccel: true, tilt: false, sens: 1, shake: true, fps: false, laps: 3,
};

function fresh() {
  const cars = {};
  for (const b of BODY_ORDER) cars[b] = { owned: false, cfg: defaultConfig(b), parts: {}, liveryColors: [], rimColors: [] };
  return {
    v: 1, money: 2500, starterChosen: false, current: 'kaze', cars,
    cups: {}, unlocked: { pro: false, legend: false, kaiju: false },
    tt: {}, settings: { ...DEFAULT_SETTINGS },
    stats: { races: 0, wins: 0, podiums: 0, earned: 0 }, name: 'YOU',
  };
}

export class Save {
  constructor() {
    this.data = fresh();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.v === 1) this.data = { ...fresh(), ...d, settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) } };
        for (const b of BODY_ORDER) if (!this.data.cars[b]) this.data.cars[b] = fresh().cars[b];
      }
    } catch { /* private mode / corrupt: start fresh */ }
  }
  get d() { return this.data; }
  write() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ } }
  reset() { this.data = fresh(); this.write(); }

  car(id = this.data.current) { return this.data.cars[id]; }
  owns(body, cat, part) {
    const c = this.data.cars[body];
    if (!c) return false;
    if (cat === 'paint') return false;
    return (c.parts[cat] || []).includes(part);
  }
  grant(body, cat, part) {
    const c = this.data.cars[body];
    c.parts[cat] = c.parts[cat] || [];
    if (!c.parts[cat].includes(part)) c.parts[cat].push(part);
  }
  trophy(cup, cls) { return this.data.cups[cup]?.[cls] || 0; }
  setTrophy(cup, cls, t) {
    this.data.cups[cup] = this.data.cups[cup] || {};
    this.data.cups[cup][cls] = Math.max(this.data.cups[cup][cls] || 0, t);
  }
}
