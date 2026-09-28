// Node-side catalogue loader (the browser one uses dynamic imports relative to js/core).
import { ENGINES } from '../public/data/engines.js';
import { TURBOS, KIT_TURBOS } from '../public/data/turbos.js';
import { WHEEL_DESIGNS } from '../public/data/wheels.js';
import { TIRE_MODELS, TIRE_SIZES } from '../public/data/tires.js';
export async function loadCatalogNode(id) {
  const { car } = await import(`../public/cars/${id}/car.js`);
  const parts = await import(`../public/cars/${id}/parts.js`);
  const list = parts.PARTS.map((p) => {
    if (!p.turboRef) return p;
    const t = TURBOS[p.turboRef];
    return { ...p, brand: t.brand, name: t.name, pn: t.pn, price: t.price, src: t.priceSource, turbo: t, engine: { turbo: t } };
  });
  return { car, categories: parts.CATEGORIES, slots: parts.SLOTS, slotById: new Map(parts.SLOTS.map((s) => [s.id, s])), parts: list, byId: new Map(list.map((p) => [p.id, p])), engines: ENGINES, turbos: TURBOS, kitTurbos: KIT_TURBOS, wheels: WHEEL_DESIGNS, tires: TIRE_MODELS, tireSizes: TIRE_SIZES };
}
