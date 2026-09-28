// Loads a car's data and the shared catalogues into one resolved catalogue.
import { ENGINES } from '../../data/engines.js';
import { TURBOS, KIT_TURBOS } from '../../data/turbos.js';
import { WHEEL_DESIGNS } from '../../data/wheels.js';
import { TIRE_MODELS, TIRE_SIZES } from '../../data/tires.js';

export const CARS = {
  'e46-325ci': {
    id: 'e46-325ci',
    label: 'BMW 325Ci Coupe (E46)',
    years: '2001-2003',
    load: async () => {
      const [{ car }, parts, { body, BLUEPRINT_Z_SCALE }] = await Promise.all([
        import('../../cars/e46-325ci/car.js'),
        import('../../cars/e46-325ci/parts.js'),
        import('../../cars/e46-325ci/body.js'),
      ]);
      return { car, parts, body, zScale: BLUEPRINT_Z_SCALE, modules: {
        details: () => import('../../cars/e46-325ci/details.js'),
        bumpers: () => import('../../cars/e46-325ci/bumpers.js'),
      } };
    },
  },
};

export async function loadCatalog(carId) {
  const entry = CARS[carId];
  if (!entry) throw new Error(`Unknown car ${carId}`);
  const loaded = await entry.load();
  const { car, parts } = loaded;
  const list = parts.PARTS.map((p) => resolvePart(p));
  const byId = new Map(list.map((p) => [p.id, p]));
  const bySlot = new Map();
  for (const s of parts.SLOTS) bySlot.set(s.id, []);
  for (const p of list) {
    bySlot.get(p.slot)?.push(p);
  }
  return {
    car, body: loaded.body, zScale: loaded.zScale, modules: loaded.modules,
    categories: parts.CATEGORIES, slots: parts.SLOTS, slotById: new Map(parts.SLOTS.map((s) => [s.id, s])),
    parts: list, byId, bySlot,
    engines: ENGINES, turbos: TURBOS, kitTurbos: KIT_TURBOS,
    wheels: WHEEL_DESIGNS, tires: TIRE_MODELS, tireSizes: TIRE_SIZES,
  };
}

function resolvePart(p) {
  if (p.turboRef) {
    const t = TURBOS[p.turboRef];
    return {
      ...p, brand: t.brand, name: t.name, pn: t.pn, price: t.price, src: t.priceSource,
      turbo: t,
      note: `${t.hp[0]}-${t.hp[1]} hp rating, ${t.dispL[0]}-${t.dispL[1]} L. Compressor ${t.compInducer}/${t.compExducer} mm, turbine ${t.turbineMm} mm, ${t.ar} A/R. ${t.flange}.`,
      engine: { turbo: t },
    };
  }
  return p;
}
