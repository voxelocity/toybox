// Wheel and tyre fitment geometry.
// All lateral positions are millimetres from the hub mounting face, + outboard.
import { mountedWidth, tireDims } from '../cad/tire.js';

const IN = 25.4;

/**
 * @param axle 'front' | 'rear'
 * @param w    { d, w, et }  wheel size
 * @param tire { width, aspect, rim }
 * @param opts { spacer, camberDeg (negative = top in), fenders: 'stock'|'rolled'|'pulled',
 *               reducedInner, dropMm, brakeMinWheel, fit (car.fitment) }
 */
export function checkCorner(axle, w, tire, opts) {
  const fit = opts.fit;
  const spacer = opts.spacer || 0;
  const S = mountedWidth(tire.width, w.w);
  const rimW = w.w * IN;
  const dims = tireDims(tire, w.w);
  const et = w.et - spacer; // a spacer is equivalent to lower offset
  const outerTire = S / 2 - et;
  const innerTire = S / 2 + et;
  const outerLip = rimW / 2 + 12 - et;
  // camber pulls the top of the tyre inboard at fender-lip height
  const camber = Math.abs(Math.min(0, opts.camberDeg ?? 0));
  const outerAtLip = outerTire - dims.R * Math.sin((camber * Math.PI) / 180);
  const lim = axle === 'front'
    ? { stock: fit.outer.front, rolled: fit.outer.frontRolled, pulled: fit.outer.frontPulled }
    : { stock: fit.outer.rear, rolled: fit.outer.rearRolled, pulled: fit.outer.rearPulled };
  const limOuter = lim[opts.fenders || 'stock'];
  const limInner = axle === 'front' ? (opts.reducedInner ? fit.inner.frontReducedByCoilovers : fit.inner.front) : fit.inner.rear;
  const issues = [];
  const over = outerAtLip - limOuter;
  if (over > 6) issues.push({ level: 'error', text: `${cap(axle)} tyre sits ${over.toFixed(0)} mm beyond the ${opts.fenders === 'stock' ? 'unrolled' : opts.fenders} fender lip: it will rub.`, fix: opts.fenders === 'pulled' ? 'Use a higher offset, a narrower tyre, or more negative camber.' : opts.fenders === 'rolled' ? 'Pull the fenders, add negative camber, or choose a higher offset.' : 'Roll the fenders and/or add negative camber, or choose a higher offset.' });
  else if (over > 0) issues.push({ level: 'warn', text: `${cap(axle)} tyre is ${over.toFixed(0)} mm past the ${opts.fenders === 'stock' ? 'unrolled' : opts.fenders} fender lip: expect light rubbing over bumps.`, fix: axle === 'front' ? 'About -1° more front camber or a rolled lip cures this.' : 'Roll the rear fender lips.' });
  const innerOver = innerTire - limInner;
  if (innerOver > 3) issues.push({ level: 'error', text: `${cap(axle)} tyre inner edge is ${innerOver.toFixed(0)} mm into the ${axle === 'front' ? 'strut / spring perch' : 'inner arch'}.`, fix: `A ${Math.ceil(innerOver / 5) * 5} mm hub-centric spacer would clear it.` });
  else if (innerOver > -3) issues.push({ level: 'warn', text: `${cap(axle)} inner clearance is only ${(-innerOver + 3).toFixed(0)} mm${opts.reducedInner ? ' with these coilovers' : ''}.`, fix: 'A 5 mm spacer adds margin.' });
  // diameter vs arch with lowering
  const maxD = fit.maxDiameterMm - Math.max(0, (opts.dropMm || 0) - 25) * 0.8;
  if (dims.D > maxD + 4) issues.push({ level: 'warn', text: `${cap(axle)} tyre is ${dims.D.toFixed(0)} mm tall; at this ride height it can touch the arch liner on full compression.`, fix: 'Raise the car slightly or use a lower-profile size.' });
  // rim width vs tyre width (TRA approved range, roughly 70-100% of section width in inches)
  const secIn = tire.width / IN;
  if (w.w < secIn * 0.68) issues.push({ level: 'warn', text: `${cap(axle)} ${tire.width} mm tyre on a ${w.w}" rim bulges past the rim's approved range.`, fix: 'Use a narrower tyre or wider wheel.' });
  if (w.w > secIn * 0.98) issues.push({ level: 'warn', text: `${cap(axle)} ${tire.width} mm tyre on a ${w.w}" rim is stretched beyond the approved range.`, fix: 'Use a wider tyre.' });
  // brake clearance
  if (opts.brakeMinWheel && w.d < opts.brakeMinWheel) issues.push({ level: 'error', text: `The ${axle} brakes need at least ${opts.brakeMinWheel}" wheels.`, fix: `Choose a ${opts.brakeMinWheel}" or larger wheel.` });
  return {
    axle, mountedWidth: S, outerTire, innerTire, outerLip, outerAtLip, limOuter, limInner, diameter: dims.D,
    poke: outerAtLip - limOuter, // + means past the lip
    issues,
  };
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** Speedometer error from rolling diameter vs the factory size. */
export function speedoError(stockDia, newDia) {
  return (newDia / stockDia - 1) * 100;
}
