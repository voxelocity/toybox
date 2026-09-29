// Parametric wheels. Built around the local X axis (outer face at +x), then
// baked so the axle runs along Z. The spin group rotates about Z.
import * as THREE from 'three';
import { Geo } from '../geo/builder.js';
import { MAT, C } from './hull.js';

const TAU = Math.PI * 2;

function spokeBox(g, a, r0, r1, x0, x1, w0, w1, thick = 0.02) {
  // a radial wedge spoke from r0 to r1 at angle a, face at x1 (outer) sloping to x0 at r0
  const ca = Math.cos(a), sa = Math.sin(a);
  const px = -sa, pz = ca; // perpendicular in (y,z) plane
  const P = (r, w, x) => [x, ca * r + px * w, sa * r + pz * w];
  const A = P(r0, -w0 / 2, x0), B = P(r0, w0 / 2, x0), Cc = P(r1, w1 / 2, x1), D = P(r1, -w1 / 2, x1);
  const back = (p) => [p[0] - thick, p[1], p[2]];
  // corners listed CCW seen from +x (the outer face)
  g.hexa([back(A), back(D), back(Cc), back(B)], [A, D, Cc, B], { bottom: true });
}

function hubAndLugs(g, x, hubR, lugs = 5, capColor = C.chrome, capMat = MAT.CHROME) {
  g.set(capColor, capMat);
  g.at([x, 0, 0], [0, 0, 0], 1, () => {
    g.lathe([[hubR, -0.02], [hubR, 0.0], [hubR * 0.7, 0.012], [0.0001, 0.016]], 10, false);
  });
  g.set(C.chrome, MAT.CHROME);
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * TAU + 0.3;
    const r = hubR * 1.35;
    g.cyl([x - 0.01, Math.cos(a) * r, Math.sin(a) * r], [x + 0.012, Math.cos(a) * r, Math.sin(a) * r], 0.011, 0.009, 6);
  }
}

/**
 * @param design id
 * @param o { R, W, rimR, side: 1 right / -1 left, neon }
 */
export function buildWheelGeometry(design, o) {
  const g = new Geo();
  const { R, W } = o;
  const rimR = o.rimR ?? R * 0.66;
  const hw = W / 2;
  // ---- tyre
  g.set([0.09, 0.09, 0.11], MAT.RUBBER);
  g.lathe([
    [rimR * 0.98, -hw + 0.012], [R * 0.9, -hw], [R * 0.985, -hw + W * 0.14], [R, -hw + W * 0.3],
    [R, hw - W * 0.3], [R * 0.985, hw - W * 0.14], [R * 0.9, hw], [rimR * 0.98, hw - 0.012],
  ], 22, true);
  // sidewall letters band (subtle lighter ring on the outer wall)
  g.set([0.22, 0.22, 0.26], MAT.RUBBER);
  g.at([hw + 0.001, 0, 0], [0, 0, 0], 1, () => g.ring(0, R * 0.8, R * 0.84, 22));

  const faceX = {
    stock5: hw - 0.03, six: hw - 0.05, mesh: hw - 0.045, dish: hw - 0.1, fan: hw - 0.025, star: hw - 0.04, steel: hw - 0.035, neon: hw - 0.03,
  }[design] ?? hw - 0.04;

  // ---- barrel (inside, seen through the spokes)
  g.set([0.2, 0.2, 0.23], design === 'neon' ? MAT.TRIM : MAT.RIM);
  // inward-facing barrel: reverse profile order so normals point to the axle
  g.lathe([[rimR, hw - 0.01], [rimR, -hw + 0.02]], 18, true);
  // barrel back wall (dark disc deep inside)
  g.set([0.05, 0.05, 0.06], MAT.TRIM);
  g.at([-hw + 0.03, 0, 0], [0, 0, 0], 1, () => g.disc(0, rimR, 14));

  // ---- lip
  const lipMat = design === 'dish' || design === 'mesh' ? MAT.CHROME : (design === 'neon' ? MAT.NEON : MAT.RIM);
  g.set(design === 'dish' || design === 'mesh' ? C.chrome : C.white, lipMat);
  const lipIn = design === 'dish' ? rimR * 0.78 : rimR * 0.9;
  g.at([hw - 0.004, 0, 0], [0, 0, 0], 1, () => g.ring(0, lipIn, rimR * 1.02, 22));
  if (design === 'dish') {
    // the dish: a cone from the lip down to the recessed face
    g.lathe([[lipIn, hw - 0.004], [rimR * 0.74, faceX + 0.004]], 22, true);
  }

  // ---- face
  const hubR = rimR * 0.2;
  switch (design) {
    case 'stock5': {
      g.set(C.white, MAT.RIM);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        spokeBox(g, a, hubR * 0.9, rimR * 0.92, faceX - 0.01, faceX, 0.1, 0.2, 0.03);
      }
      hubAndLugs(g, faceX + 0.004, hubR, 5, C.white, MAT.RIM);
      break;
    }
    case 'six': {
      g.set(C.white, MAT.RIM);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        spokeBox(g, a, hubR * 0.9, rimR * 0.95, faceX - 0.02, faceX + 0.03, 0.07, 0.085, 0.03);
        // rib
        g.set(C.white, MAT.RIM);
        spokeBox(g, a, hubR * 1.2, rimR * 0.85, faceX - 0.0, faceX + 0.04, 0.02, 0.02, 0.015);
      }
      hubAndLugs(g, faceX + 0.0, hubR, 5, C.black, MAT.TRIM);
      break;
    }
    case 'mesh': {
      g.set(C.white, MAT.RIM);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        spokeBox(g, a + 0.18, hubR * 1.1, rimR * 0.95, faceX - 0.01, faceX + 0.01, 0.02, 0.022, 0.02);
        spokeBox(g, a - 0.18, hubR * 1.1, rimR * 0.95, faceX - 0.012, faceX + 0.008, 0.02, 0.022, 0.02);
      }
      g.set(C.white, MAT.RIM);
      g.at([faceX + 0.012, 0, 0], [0, 0, 0], 1, () => g.ring(0, rimR * 0.52, rimR * 0.58, 20));
      hubAndLugs(g, faceX + 0.01, hubR, 5, C.chrome, MAT.CHROME);
      break;
    }
    case 'dish': {
      g.set(C.white, MAT.RIM);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        spokeBox(g, a, hubR * 0.9, rimR * 0.76, faceX, faceX + 0.006, 0.07, 0.1, 0.02);
      }
      g.set(C.chrome, MAT.CHROME);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        g.sphere(hw - 0.006, Math.cos(a) * rimR * 0.84, Math.sin(a) * rimR * 0.84, 0.008, 0.008, 0.008, 4, 3);
      }
      hubAndLugs(g, faceX + 0.006, hubR, 5, C.chrome, MAT.CHROME);
      break;
    }
    case 'fan': {
      g.set(C.white, MAT.RIM);
      g.at([faceX - 0.004, 0, 0], [0, 0, 0], 1, () => g.disc(0, rimR * 0.95, 18));
      g.set([0.85, 0.85, 0.9], MAT.RIM);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        spokeBox(g, a, hubR * 1.4, rimR * 0.9, faceX + 0.02, faceX + 0.005, 0.03, 0.09, 0.025);
      }
      hubAndLugs(g, faceX + 0.022, hubR * 1.3, 4, C.black, MAT.TRIM);
      break;
    }
    case 'star': {
      g.set(C.white, MAT.RIM);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        spokeBox(g, a, hubR, rimR * 0.94, faceX - 0.01, faceX + 0.008, 0.03, 0.045, 0.025);
      }
      hubAndLugs(g, faceX + 0.006, hubR, 5, C.chrome, MAT.CHROME);
      break;
    }
    case 'steel': {
      g.set(C.white, MAT.RIM);
      g.at([faceX, 0, 0], [0, 0, 0], 1, () => g.disc(0, rimR * 0.93, 20));
      g.set(C.black, MAT.TRIM);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        g.at([faceX + 0.002, Math.cos(a) * rimR * 0.62, Math.sin(a) * rimR * 0.62], [0, 0, 0], 1, () => g.disc(0, rimR * 0.1, 8));
      }
      g.set(C.chrome, MAT.CHROME);
      g.at([faceX + 0.003, 0, 0], [0, 0, 0], 1, () => g.lathe([[rimR * 0.42, 0], [rimR * 0.38, 0.02], [rimR * 0.2, 0.035], [0.0001, 0.04]], 14, true));
      break;
    }
    case 'neon': {
      g.set(C.black, MAT.TRIM);
      g.at([faceX - 0.02, 0, 0], [0, 0, 0], 1, () => g.disc(0, rimR * 0.9, 18));
      g.set(C.white, MAT.NEON);
      g.at([hw - 0.008, 0, 0], [0, 0, 0], 1, () => g.torus(0, rimR * 0.95, 0.018, 24, 5));
      g.set(C.white, MAT.NEON);
      g.at([faceX - 0.012, 0, 0], [0, 0, 0], 1, () => g.ring(0, rimR * 0.5, rimR * 0.56, 18));
      g.set([0.2, 0.2, 0.22], MAT.RIM);
      for (let i = 0; i < 3; i++) spokeBox(g, (i / 3) * TAU + 0.5, hubR, rimR * 0.52, faceX - 0.02, faceX - 0.01, 0.03, 0.02, 0.01);
      hubAndLugs(g, faceX - 0.01, hubR, 3, C.black, MAT.TRIM);
      break;
    }
    default: break;
  }

  // bake: local +x (outer face) -> +z for right, -z for left; axle along z
  const geom = g.build({ color: true, mat: true });
  const m = new THREE.Matrix4().makeRotationY(o.side > 0 ? -Math.PI / 2 : Math.PI / 2);
  geom.applyMatrix4(m);
  geom.computeBoundingSphere();
  return geom;
}

/** Brake caliper + rotor face (does not spin). Built for the right side; mirror for left. */
export function buildCaliperGeometry(o) {
  const g = new Geo();
  const { R, W } = o;
  const rimR = o.rimR ?? R * 0.66;
  const x = W / 2 - 0.09;
  // rotor disc
  g.set([0.45, 0.46, 0.5], MAT.CHROME);
  g.at([x - 0.03, 0, 0], [0, 0, 0], 1, () => g.disc(0, rimR * 0.8, 16));
  // caliper at the rear-top
  g.set(o.color || [0.9, 0.1, 0.15], MAT.TRIM);
  g.at([x - 0.01, rimR * 0.55, -rimR * 0.3], [0.5, 0, 0], 1, () => g.box(0, 0, 0, 0.05, rimR * 0.35, rimR * 0.2));
  const geom = g.build({ color: true, mat: true });
  geom.applyMatrix4(new THREE.Matrix4().makeRotationY(o.side > 0 ? -Math.PI / 2 : Math.PI / 2));
  return geom;
}
