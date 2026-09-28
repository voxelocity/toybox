// Lamps and other surface decals: a textured inner layer plus a glossy lens,
// both lying on the body surface (via endPatch / sidePatch).
import * as THREE from 'three';
import { endPatch, sidePatch } from './surface.js';

/**
 * Canvas painter in millimetre coordinates.
 * region: { u0, u1, z0, z1 } ; returns { canvas, g, X, Y, S } where X/Y map mm to px.
 */
export function mmCanvas(region, pxPerMm = 4) {
  const W = Math.ceil((region.u1 - region.u0) * pxPerMm), H = Math.ceil((region.z1 - region.z0) * pxPerMm);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = (u) => (u - region.u0) * pxPerMm;
  const Y = (z) => H - (z - region.z0) * pxPerMm;
  return { canvas: c, g, X, Y, S: pxPerMm, W, H };
}

export function pathMM(g, X, Y, pts, close = true) {
  g.beginPath();
  pts.forEach(([u, z], i) => (i ? g.lineTo(X(u), Y(z)) : g.moveTo(X(u), Y(z))));
  if (close) g.closePath();
}

/** Smooth closed path through points (Catmull-Rom -> Bezier). */
export function smoothPathMM(g, X, Y, pts) {
  const P = pts.map(([u, z]) => [X(u), Y(z)]);
  const n = P.length;
  g.beginPath();
  g.moveTo(P[0][0], P[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    g.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
  }
  g.closePath();
}

function tex(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Build a lamp on one end of the body.
 * @param field SurfaceField
 * @param o { end, region:{u0,u1,z0,z1}, offsetX, paint(api) -> draws colour+alpha, emissive(api) optional,
 *            lens: { color, opacity, tintColor }, lensLift (mm), mirror }
 */
export function buildEndLamp(field, o) {
  const group = new THREE.Group();
  const reg = o.region;
  const base = mmCanvas(reg, o.pxPerMm || 4);
  o.paint(base);
  let emis = null;
  if (o.emissive) { emis = mmCanvas(reg, o.pxPerMm || 4); emis.g.fillStyle = '#000'; emis.g.fillRect(0, 0, emis.W, emis.H); o.emissive(emis); }
  const geoIn = endPatch(field, { end: o.end, u0: reg.u0, u1: reg.u1, z0: reg.z0, z1: reg.z1, nu: 48, nz: 16, offset: o.inset ?? 0.8, offsetX: o.offsetX, xLimit: o.xLimit, mirror: o.mirror !== false });
  const geoLens = endPatch(field, { end: o.end, u0: reg.u0, u1: reg.u1, z0: reg.z0, z1: reg.z1, nu: 48, nz: 16, offset: o.lensLift ?? 4, offsetX: o.offsetX, xLimit: o.xLimit, mirror: o.mirror !== false });
  const inner = new THREE.MeshPhysicalMaterial({
    map: tex(base.canvas), transparent: true, alphaTest: 0.02, metalness: o.innerMetal ?? 0.6, roughness: o.innerRough ?? 0.28,
    emissiveMap: emis ? tex(emis.canvas) : null, emissive: emis ? new THREE.Color(o.emissiveColor || '#ffffff') : new THREE.Color(0), emissiveIntensity: 0,
    clearcoat: 0.3,
  });
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: o.lens?.color || '#ffffff', roughness: 0.02, metalness: 0, transparent: true, opacity: o.lens?.opacity ?? 0.16,
    clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 1.6, alphaMap: alphaFromCanvas(base.canvas), depthWrite: false,
  });
  const mi = new THREE.Mesh(geoIn, inner); mi.renderOrder = 1;
  const ml = new THREE.Mesh(geoLens, lensMat); ml.renderOrder = 3;
  group.add(mi, ml);
  group.userData = { inner, lens: lensMat, setLit(on, level = 2.2) { inner.emissiveIntensity = on ? level : 0; } };
  return group;
}

/** Alpha map texture from a canvas's alpha channel (lens only where the lamp is). */
export function alphaFromCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  const d = src.getContext('2d').getImageData(0, 0, src.width, src.height);
  for (let i = 0; i < d.data.length; i += 4) { const a = d.data[i + 3]; d.data[i] = d.data[i + 1] = d.data[i + 2] = a; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0);
  return tex(c, false);
}

/** Side-mounted decal/lamp (x, z region). */
export function buildSideDecal(field, o) {
  const reg = o.region; // {u0: x0, u1: x1, z0, z1} with u = x
  const base = mmCanvas(reg, o.pxPerMm || 6);
  o.paint(base);
  const geo = sidePatch(field, { x0: reg.u0, x1: reg.u1, z0: reg.z0, z1: reg.z1, nx: 16, nz: 6, offset: o.offset ?? 0.8, offsetX: o.offsetX, mirror: o.mirror !== false });
  const mat = new THREE.MeshPhysicalMaterial({ map: tex(base.canvas), transparent: true, alphaTest: 0.02, metalness: o.metal ?? 0.3, roughness: o.rough ?? 0.25, clearcoat: 1 });
  return new THREE.Mesh(geo, mat);
}

export { tex as canvasTexture };
