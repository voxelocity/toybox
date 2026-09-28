// Parametric tyre from its size designation (e.g. 225/45R17 on a 8.0" rim).
import * as THREE from 'three';
import { lerp } from './interp.js';

const IN = 25.4;

/** Tire & Rim Association style measuring rim (inches) for a section width. */
export function measuringRim(widthMm) {
  return Math.round((6.5 + ((widthMm - 205) / 20) * 0.9) * 2) / 2;
}

/** Actual mounted section width: roughly 5 mm per half inch of rim away from the measuring rim. */
export function mountedWidth(widthMm, rimWidthIn) {
  return widthMm + (rimWidthIn - measuringRim(widthMm)) * 10;
}

export function tireDims(size, rimWidthIn) {
  const h = (size.width * size.aspect) / 100;
  const Rb = (size.rim * IN) / 2;
  const R = Rb + h;
  const S = mountedWidth(size.width, rimWidthIn ?? measuringRim(size.width));
  return { h, Rb, R, D: 2 * R, S, circumference: 2 * Math.PI * R, loadedRadius: R - Math.min(14, h * 0.12) };
}

const treadCache = new Map();
function treadNormalMap(style) {
  if (treadCache.has(style)) return treadCache.get(style);
  const W = 2048, H = 256, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // height field drawn in grey, converted to normals below
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#000';
  const band = (v0, v1) => g.fillRect(0, v0 * H, W, (v1 - v0) * H);
  if (style === 'track') {
    band(0.47, 0.49); band(0.58, 0.6);
    for (let i = 0; i < 70; i++) { const u = (i / 70) * W; g.fillRect(u, 0.30 * H, 6, 0.1 * H); g.fillRect(u + 12, 0.72 * H, 6, 0.08 * H); }
  } else if (style === 'allseason') {
    band(0.39, 0.41); band(0.49, 0.51); band(0.59, 0.61);
    for (let i = 0; i < 120; i++) {
      const u = (i / 120) * W;
      g.save(); g.translate(u, 0); g.transform(1, 0, -0.35, 1, 0, 0);
      g.fillRect(0, 0.3 * H, 5, 0.09 * H); g.fillRect(8, 0.41 * H, 3, 0.08 * H); g.fillRect(4, 0.51 * H, 3, 0.08 * H); g.fillRect(0, 0.61 * H, 5, 0.1 * H);
      g.restore();
    }
  } else { // uhp summer, asymmetric
    band(0.40, 0.425); band(0.51, 0.535); band(0.6, 0.62);
    for (let i = 0; i < 90; i++) {
      const u = (i / 90) * W;
      g.save(); g.translate(u, 0); g.transform(1, 0, -0.2, 1, 0, 0);
      g.fillRect(0, 0.3 * H, 6, 0.1 * H); g.fillRect(10, 0.62 * H, 4, 0.1 * H); g.fillRect(3, 0.54 * H, 2, 0.06 * H);
      g.restore();
    }
  }
  // sidewall rings
  g.fillStyle = '#b8b8b8'; g.fillRect(0, 0.09 * H, W, 2); g.fillRect(0, 0.9 * H, W, 2);
  const src = g.getImageData(0, 0, W, H).data;
  const out = g.createImageData(W, H);
  const hgt = (x, y) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (hgt(x + 1, y) - hgt(x - 1, y)) * 2.0, dy = (hgt(x, y + 1) - hgt(x, y - 1)) * 2.0;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * W + x) * 4;
    out.data[i] = (-dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  treadCache.set(style, t);
  return t;
}

/**
 * @param size { width, aspect, rim }
 * @param rimWidthIn rim width in inches
 * @param zc  rim centre plane (mm, wheel frame)
 * @param style 'uhp' | 'allseason' | 'track'
 */
export function buildTire(size, rimWidthIn, zc, style = 'uhp') {
  const { h, Rb, R, S } = tireDims(size, rimWidthIn);
  const rimW = rimWidthIn * IN;
  const T = S * 0.82; // tread width
  const half = S / 2;
  const beadZ = rimW / 2 + 2;
  // profile from the outboard bead around the tread to the inboard bead
  const pts = [];
  const side = (sgn) => [
    [Rb + 3, sgn * (beadZ - 1)],
    [Rb + 0.12 * h, sgn * lerp(beadZ + 3, half * 0.97, 0.6)],
    [Rb + 0.3 * h, sgn * lerp(beadZ, half, 0.92)],
    [Rb + 0.52 * h, sgn * half],
    [Rb + 0.72 * h, sgn * half * 0.985],
    [Rb + 0.88 * h, sgn * lerp(half, T / 2 + 6, 0.55)],
    [R - 6, sgn * (T / 2 + 4)],
    [R - 1.5, sgn * (T / 2 - 1)],
  ];
  const out = side(1), inb = side(-1).reverse();
  pts.push(...out, [R, T * 0.2], [R, 0], [R, -T * 0.2], ...inb);
  const v2 = pts.map(([r, z]) => new THREE.Vector2(r, z + zc));
  const geo = new THREE.LatheGeometry(v2, 128);
  geo.rotateX(Math.PI / 2);
  // lathe uv: u around, v along profile index. Stretch tread texture across the profile.
  const mat = new THREE.MeshStandardMaterial({
    color: 0x151515, roughness: 0.88, metalness: 0,
    normalMap: treadNormalMap(style), normalScale: new THREE.Vector2(1.2, 1.2),
  });
  const tex = mat.normalMap;
  tex.repeat.set(4, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.scale.setScalar(0.001);
  mesh.name = 'tire';
  mesh.userData = { R, S, h, Rb, T };
  return mesh;
}
