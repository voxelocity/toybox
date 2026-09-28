// Wheel corners: wheel + tyre + brake placed from real fitment numbers.
import * as THREE from 'three';
import { buildWheel } from '../cad/wheel.js';
import { buildTire, tireDims } from '../cad/tire.js';
import { buildBrake } from '../cad/brakes.js';

/**
 * @param spec {
 *   axleX (mm, car coords), hubW (mm, lateral position of the hub face at stock),
 *   wheel {design, diameter, width, offset, color, finish}, spacer (mm),
 *   tire {width, aspect, rim, style}, brake {...}, camberDeg, side: +1 right / -1 left,
 *   caliperAngle (radians in the right-side frame)
 * }
 * @returns { group, dims }
 */
export function buildCorner(spec) {
  const group = new THREE.Group();
  group.name = `corner-${spec.name}`;
  const pivot = new THREE.Group(); // camber pivots here (hub centre)
  group.add(pivot);

  const w = spec.wheel;
  const wheel = buildWheel(w);
  const zc = -w.offset; // rim centre relative to hub face (mm)
  const tire = buildTire(spec.tire, w.width, zc, spec.tire.style);
  const brake = buildBrake({ ...spec.brake, position: spec.side > 0 ? spec.caliperAngle : Math.PI - spec.caliperAngle });

  const hubShift = (spec.spacer || 0) / 1000;
  const inner = new THREE.Group();
  inner.position.z = hubShift;
  inner.add(wheel, tire);
  pivot.add(inner, brake);

  if (spec.side < 0) group.rotation.y = Math.PI;
  const dims = tireDims(spec.tire, w.width);
  pivot.rotation.x = (spec.side > 0 ? 1 : -1) * 0; // camber applied by caller at group level
  group.userData = { dims, wheel, tire, brake, pivot, inner, spec };
  return { group, dims };
}

/** Apply negative camber (top of tyre leans inboard) about the contact patch. */
export function applyCamber(corner, deg, side) {
  const r = (corner.userData.dims.loadedRadius) / 1000;
  const a = THREE.MathUtils.degToRad(deg);
  // rotate pivot about the local X axis through the hub; right side (+Z outboard): top in = rotate +a about X
  const pivot = corner.userData.pivot;
  pivot.rotation.x = side > 0 ? -a : -a;
  // keep the contact patch in place: shift by r * sin(a) laterally
  pivot.position.z = 0;
  pivot.position.y = 0;
  void r;
}
