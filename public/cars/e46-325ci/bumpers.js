// Front and rear bumper variants for the E46 coupe.
//
// A variant can: deform the loft in its region (deform), cut openings and draw
// trims on the paint (frontMask / rearMask, drawn in front-projection mm),
// and add parts (features) such as grille backings, fog lamps and lips.
import * as THREE from 'three';
import { endPatch } from '../../js/cad/surface.js';
import { mmCanvas, canvasTexture } from '../../js/cad/lamp.js';
import { buildFogLamp, buildFrontMarkers } from './details.js';
import { clamp, smoothstep } from '../../js/cad/interp.js';

const TAU = Math.PI * 2;

/** Black grille backing that sits inside a bumper opening. */
function grilleBacking(field, offsetX, { end = 'front', u0, u1, z0, z1, depth = 38, pattern = 'slats', xLimit }) {
  const reg = { u0, u1, z0, z1 };
  const { canvas, g, X, Y, S, W, H } = mmCanvas(reg, 3);
  g.fillStyle = '#060606'; g.fillRect(0, 0, W, H);
  if (pattern === 'slats') {
    g.fillStyle = '#1c1c1d';
    for (let z = z0 + 14; z < z1 - 6; z += 20) g.fillRect(0, Y(z + 4), W, 7 * S);
  } else if (pattern === 'mesh') {
    g.strokeStyle = '#202122'; g.lineWidth = 2.2 * S;
    for (let k = -H; k < W + H; k += 14 * S) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + H, H); g.stroke(); g.beginPath(); g.moveTo(k + H, 0); g.lineTo(k, H); g.stroke(); }
  } else if (pattern === 'honeycomb') {
    g.strokeStyle = '#1e1f20'; g.lineWidth = 1.8 * S;
    const r = 7 * S;
    for (let y = 0, row = 0; y < H + r; y += r * 1.5, row++) for (let x = (row % 2) * r * 0.866; x < W + r; x += r * 1.732) {
      g.beginPath(); for (let i = 0; i <= 6; i++) { const a = (i / 6) * TAU + Math.PI / 6; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.stroke();
    }
  }
  const geo = endPatch(field, { end, u0, u1, z0, z1, nu: 30, nz: 6, offset: -depth, offsetX, xLimit: xLimit ?? (end === 'front' ? 150 : -3100) });
  const t = canvasTexture(canvas);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, roughness: 0.75, metalness: 0.1, side: THREE.DoubleSide }));
  m.name = 'grilleBacking';
  return m;
}

// Front bumper region for deformations: forward of the arch, below the lamps.
const inFrontRegion = (x, z) => smoothstep(290, 360, x) * (1 - smoothstep(470, 500, z));
const inRearRegion = (x, z) => smoothstep(-3040, -3110, x) * (1 - smoothstep(570, 600, z));

export const FRONT_BUMPERS = {
  stock: {
    label: 'OEM pre-facelift coupe bumper',
    frontMask: ({ ctx, rrect, circle }) => {
      // lower intake band with the fog lamps at its ends
      rrect(ctx[0], -2, 206, 612, 292, 38); ctx[0].fill();
      // plate area outline and bumper parting groove (drawn as shut lines)
      ctx[3].lineWidth = 2; rrect(ctx[3], -2, 196, 622, 302, 44); ctx[3].stroke();
      void circle;
    },
    features: (field, offsetX) => {
      const g = new THREE.Group(); g.name = 'frontBumperParts';
      g.add(grilleBacking(field, offsetX, { u0: 0, u1: 640, z0: 204, z1: 294, pattern: 'slats' }));
      g.add(buildFogLamp(field, offsetX, { w: 560, z: 249, r: 38 }));
      g.add(buildFrontMarkers(field, offsetX));
      return g;
    },
  },
  mtech2: {
    label: 'M-Tech II / ZHP-style front bumper',
    // deeper, squarer lower bumper with a lip that juts ~18 mm and drops ~12 mm
    deform: (x, w, z, row) => {
      const k = inFrontRegion(x, z);
      if (k <= 0) return null;
      const low = 1 - smoothstep(180, 330, z);
      return [w + 6 * k * low, z - 12 * k * low * (row.seg === 'floor' ? 1 : 0.4)];
    },
    frontMask: ({ ctx, rrect, poly }) => {
      // large centre intake and two side intakes with fog lamps
      rrect(ctx[0], -2, 180, 330, 300, 24); ctx[0].fill();
      poly(ctx[0], [[440, 190], [690, 196], [705, 250], [690, 300], [470, 300], [430, 250]]); ctx[0].fill();
      ctx[3].lineWidth = 2;
    },
    features: (field, offsetX) => {
      const g = new THREE.Group(); g.name = 'frontBumperParts';
      g.add(grilleBacking(field, offsetX, { u0: 0, u1: 350, z0: 176, z1: 304, pattern: 'mesh' }));
      g.add(grilleBacking(field, offsetX, { u0: 420, u1: 760, z0: 186, z1: 304, pattern: 'mesh', depth: 44 }));
      g.add(buildFogLamp(field, offsetX, { w: 600, z: 246, r: 36 }));
      return g;
    },
  },
  m3: {
    label: 'M3-style front bumper (non-M fenders)',
    deform: (x, w, z, row) => {
      const k = inFrontRegion(x, z);
      if (k <= 0) return null;
      const low = 1 - smoothstep(170, 360, z);
      return [w + 8 * k * low, z - 18 * k * low * (row.seg === 'floor' || row.seg === 'sill' ? 1 : 0.35)];
    },
    frontMask: ({ ctx, rrect, poly }) => {
      // big trapezoid centre intake, side intakes with round fogs, brake ducts
      poly(ctx[0], [[-2, 168], [360, 172], [388, 238], [360, 312], [-2, 312]]); ctx[0].fill();
      poly(ctx[0], [[470, 176], [700, 182], [724, 246], [700, 318], [488, 312], [452, 246]]); ctx[0].fill();
    },
    features: (field, offsetX) => {
      const g = new THREE.Group(); g.name = 'frontBumperParts';
      g.add(grilleBacking(field, offsetX, { u0: 0, u1: 400, z0: 164, z1: 316, pattern: 'honeycomb' }));
      g.add(grilleBacking(field, offsetX, { u0: 450, u1: 780, z0: 172, z1: 322, pattern: 'honeycomb', depth: 46 }));
      g.add(buildFogLamp(field, offsetX, { w: 620, z: 290, r: 30 }));
      return g;
    },
  },
};

export const REAR_BUMPERS = {
  stock: {
    label: 'OEM pre-facelift coupe bumper',
    rearMask: ({ ctx, rrect }) => {
      // red reflectors low in the corners
      ctx[3].lineWidth = 2; rrect(ctx[3], -2, 300, 740, 590, 30); void ctx;
    },
    features: (field, offsetX) => {
      const g = new THREE.Group(); g.name = 'rearBumperParts';
      g.add(reflectors(field, offsetX, { u0: 640, u1: 760, z0: 318, z1: 332 }));
      return g;
    },
  },
  mtech2: {
    label: 'M-Tech II rear bumper',
    deform: (x, w, z, row) => {
      const k = inRearRegion(x, z);
      if (k <= 0) return null;
      const low = 1 - smoothstep(230, 360, z);
      return [w + 4 * k * low, z - 10 * k * low * (row.seg === 'floor' ? 1 : 0.4)];
    },
    rearMask: ({ ctx, poly }) => {
      // black lower diffuser insert
      poly(ctx[1], [[-2, 228], [620, 232], [700, 262], [680, 300], [-2, 296]]); ctx[1].fill();
    },
    features: (field, offsetX) => {
      const g = new THREE.Group(); g.name = 'rearBumperParts';
      g.add(reflectors(field, offsetX, { u0: 700, u1: 800, z0: 330, z1: 344 }));
      return g;
    },
  },
};

function reflectors(field, offsetX, reg) {
  const { canvas, g, X, Y, S } = mmCanvas(reg, 6);
  g.fillStyle = '#7a0a0e'; g.beginPath(); g.roundRect(0, 0, canvas.width, canvas.height, 5 * S); g.fill();
  g.fillStyle = 'rgba(255,90,90,0.25)'; for (let u = reg.u0; u < reg.u1; u += 4) g.fillRect(X(u), 0, 1.2 * S, canvas.height);
  void Y;
  const geo = endPatch(field, { end: 'rear', ...reg, nu: 12, nz: 2, offset: 1.2, offsetX, xLimit: -3000 });
  return new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ map: canvasTexture(canvas), roughness: 0.2, clearcoat: 1 }));
}

export { clamp };
