// Parametric wheel CAD.
//
// A wheel is built in its own frame: the axle is +Z (outboard), z = 0 is the
// hub mounting face, units are millimetres (scaled to metres at the end).
// Rim geometry follows the real conventions:
//   - rim diameter = bead-seat diameter (inches)
//   - rim width    = bead-seat to bead-seat (inches); flanges add ~0.5" each side
//   - offset (ET)  = distance from the rim centre plane to the mounting face,
//                    positive when the face is outboard of centre
// Face concavity is not a free parameter: it falls out of where the hub pad
// (at the mounting face) sits relative to the outer flange, exactly like a
// real wheel, so a wide low-offset size gets a deep dish automatically.

import * as THREE from 'three';
import { clamp, lerp } from './interp.js';

const IN = 25.4;
export const PCD_E46 = { lugs: 5, pcd: 120, bore: 72.56 };

// ---------- design library -------------------------------------------------
// Each design returns spoke outlines in polar form relative to t in [0, 1]
// (0 = hub pad edge, 1 = barrel). Widths are tangential millimetres at the
// face. Optional: split (Y-spokes), pairs (double spokes), cross (mesh).
//
//  spokes:   [{ a0, width(t) -> mm, bend(t) -> radians offset, from, to, depth }]
//  hubR:     hub pad radius, mm
//  pad:      hub pad thickness proud of the mounting face, mm
//  lip:      'flush' | 'step' (two/three-piece style polished lip) | 'deep'
//  dishDepth: extra inboard setback of the spoke ends for step lips (mm)
//  profile:  exponent of the face curve (1 = straight cone)
//  thick:    spoke thickness [hub, rim] mm
//  cap:      'bmw' | 'plain' | 'bbs' | 'apex' | 'none'

const TAU = Math.PI * 2;
const spokeSet = (n, fn) => Array.from({ length: n }, (_, i) => fn((i / n) * TAU, i));

export const DESIGNS = {
  // BMW Style 43 "Five Spoke" 16x7 (325Ci standard 2001-2003)
  'bmw-43': () => ({
    hubR: 82, pad: 30, lip: 'flush', profile: 1.2, thick: [30, 18], cap: 'bmw',
    spokes: spokeSet(5, (a) => [
      { a0: a, width: (t) => lerp(62, 26, t), bend: (t) => 0.10 * t * t, from: 0, to: 1 },
    ]).flat(),
    grooves: spokeSet(5, (a) => ({ a0: a + 0.012, from: 0.18, to: 0.92, width: 3.5, bend: (t) => 0.10 * t * t })),
  }),
  // BMW Style 44 "Star Spoke" 17x8 (Sport Package 1999-2003) - seven straight tapered spokes
  'bmw-44': () => ({
    hubR: 84, pad: 28, lip: 'flush', profile: 1.1, thick: [30, 18], cap: 'bmw',
    spokes: spokeSet(7, (a) => [{ a0: a, width: (t) => lerp(48, 30, t), bend: () => 0, from: 0, to: 1 }]).flat(),
  }),
  // BMW Style 68 M "M Double Spoke" 17" - five pairs of parallel spokes
  'bmw-68m': () => ({
    hubR: 80, pad: 28, lip: 'flush', profile: 1.15, thick: [28, 16], cap: 'bmw',
    spokes: spokeSet(5, (a) => [
      { a0: a, width: () => 18, bend: (t) => 0.105 * (1 - t) + 0.035, from: 0, to: 1, parallel: 14 },
      { a0: a, width: () => 18, bend: (t) => -(0.105 * (1 - t) + 0.035), from: 0, to: 1, parallel: -14 },
    ]).flat(),
  }),
  // BMW Style 135 M "M Double Spoke" 18" (330 ZHP) - seven V pairs opening toward the rim
  'bmw-135m': () => ({
    hubR: 82, pad: 30, lip: 'flush', profile: 1.25, thick: [30, 16], cap: 'bmw',
    spokes: spokeSet(7, (a) => [
      { a0: a, width: (t) => lerp(26, 14, t), bend: (t) => 0.13 * t, from: 0, to: 1 },
      { a0: a, width: (t) => lerp(26, 14, t), bend: (t) => -0.13 * t, from: 0, to: 1 },
    ]).flat(),
  }),
  // BMW Style 67 M3 "M Double Spoke" 18" - ten parallel double spokes
  'bmw-67': () => ({
    hubR: 84, pad: 30, lip: 'flush', profile: 1.2, thick: [28, 15], cap: 'bmw',
    spokes: spokeSet(10, (a) => [
      { a0: a, width: () => 12, bend: () => 0, from: 0, to: 1, parallel: 9 },
      { a0: a, width: () => 12, bend: () => 0, from: 0, to: 1, parallel: -9 },
    ]).flat(),
  }),
  // Apex EC-7 (flow formed) - seven Y spokes
  'apex-ec7': () => ({
    hubR: 78, pad: 32, lip: 'flush', profile: 0.9, thick: [34, 18], cap: 'apex',
    spokes: spokeSet(7, (a) => [
      { a0: a, width: (t) => lerp(34, 22, t), bend: () => 0, from: 0, to: 0.52 },
      { a0: a, width: () => 17, bend: (t) => 0.16 * clamp((t - 0.45) / 0.55, 0, 1), from: 0.42, to: 1 },
      { a0: a, width: () => 17, bend: (t) => -0.16 * clamp((t - 0.45) / 0.55, 0, 1), from: 0.42, to: 1 },
    ]).flat(),
  }),
  // Apex ARC-8 (flow formed) - ten split spokes whose branches meet at the rim
  'apex-arc8': () => ({
    hubR: 78, pad: 32, lip: 'flush', profile: 0.95, thick: [32, 16], cap: 'apex',
    spokes: spokeSet(10, (a) => [
      { a0: a, width: (t) => lerp(24, 18, t), bend: () => 0, from: 0, to: 0.55 },
      { a0: a, width: () => 13, bend: (t) => (TAU / 40) * clamp((t - 0.5) / 0.5, 0, 1), from: 0.46, to: 1 },
      { a0: a, width: () => 13, bend: (t) => -(TAU / 40) * clamp((t - 0.5) / 0.5, 0, 1), from: 0.46, to: 1 },
    ]).flat(),
  }),
  // Enkei RPF1 - twin five-spoke, pairs spread at the rim
  'enkei-rpf1': () => ({
    hubR: 74, pad: 26, lip: 'flush', profile: 1.0, thick: [26, 17], cap: 'plain',
    spokes: spokeSet(5, (a) => [
      { a0: a, width: (t) => lerp(20, 16, t), bend: (t) => 0.035 + 0.155 * t, from: 0, to: 1 },
      { a0: a, width: (t) => lerp(20, 16, t), bend: (t) => -0.035 - 0.155 * t, from: 0, to: 1 },
    ]).flat(),
  }),
  // BBS LM (two-piece) - cross-laced mesh with polished step lip
  'bbs-lm': () => ({
    hubR: 76, pad: 30, lip: 'step', dishDepth: 22, profile: 1.0, thick: [26, 14], cap: 'bbs', rivets: 20,
    spokes: spokeSet(10, (a) => [
      { a0: a, width: (t) => lerp(18, 10, t), bend: (t) => 0.30 * t, from: 0, to: 1 },
      { a0: a, width: (t) => lerp(18, 10, t), bend: (t) => -0.30 * t, from: 0, to: 1 },
    ]).flat(),
  }),
  // BBS CH-R - seven split spokes, hub pad reads like a star
  'bbs-chr': () => ({
    hubR: 80, pad: 34, lip: 'flush', profile: 0.85, thick: [34, 18], cap: 'bbs',
    spokes: spokeSet(7, (a) => [
      { a0: a, width: (t) => lerp(38, 24, t), bend: () => 0, from: 0, to: 0.48 },
      { a0: a, width: () => 18, bend: (t) => 0.17 * clamp((t - 0.42) / 0.58, 0, 1), from: 0.38, to: 1 },
      { a0: a, width: () => 18, bend: (t) => -0.17 * clamp((t - 0.42) / 0.58, 0, 1), from: 0.38, to: 1 },
    ]).flat(),
  }),
  // OZ Ultraleggera - twelve thin spokes in six pairs that join at the rim
  'oz-ultraleggera': () => ({
    hubR: 72, pad: 28, lip: 'flush', profile: 1.05, thick: [24, 14], cap: 'plain',
    spokes: spokeSet(6, (a) => [
      { a0: a, width: (t) => lerp(15, 11, t), bend: (t) => 0.22 * (1 - t) + 0.02, from: 0, to: 1 },
      { a0: a, width: (t) => lerp(15, 11, t), bend: (t) => -(0.22 * (1 - t) + 0.02), from: 0, to: 1 },
    ]).flat(),
  }),
  // Work Meister S1 3P - five broad spokes, deep polished lip, rivets
  'work-s1': () => ({
    hubR: 90, pad: 30, lip: 'step', dishDepth: 48, profile: 1.4, thick: [34, 22], cap: 'plain', rivets: 40,
    spokes: spokeSet(5, (a) => [
      { a0: a, width: (t) => lerp(70, 56, t) + 40 * t * t, bend: (t) => 0.06 * t, from: 0, to: 1, window: true },
    ]).flat(),
  }),
  // Rays Volk TE37 - six straight wide spokes, flat face
  'volk-te37': () => ({
    hubR: 76, pad: 30, lip: 'flush', profile: 1.0, thick: [30, 20], cap: 'plain',
    spokes: spokeSet(6, (a) => [{ a0: a, width: (t) => lerp(40, 46, t), bend: () => 0, from: 0, to: 1 }]).flat(),
  }),
};

// ---------- helpers --------------------------------------------------------

function latheFromProfile(pts, segments = 96) {
  // pts: [[r, z]] ; LatheGeometry revolves around Y, we map Y->Z afterwards
  const v2 = pts.map(([r, z]) => new THREE.Vector2(Math.max(0.001, r), z));
  const g = new THREE.LatheGeometry(v2, segments);
  g.rotateX(Math.PI / 2); // lathe axis Y -> Z
  return g;
}

/** Spoke outline polygon (THREE.Shape) in the face plane. */
function spokeShape(sp, rHub, rRim) {
  const pts = [];
  const N = 22;
  const r0 = lerp(rHub, rRim, sp.from) - (sp.from === 0 ? 14 : 0);
  const r1 = lerp(rHub, rRim, sp.to) + (sp.to === 1 ? 10 : 0);
  const at = (i) => {
    const t = i / N;
    const r = lerp(r0, r1, t);
    const tt = clamp((r - rHub) / (rRim - rHub), 0, 1);
    const w = sp.width(tt);
    let a = sp.a0 + sp.bend(tt);
    if (sp.parallel) a += Math.asin(clamp(sp.parallel / Math.max(r, 1), -1, 1));
    return { r, a, half: w / 2 };
  };
  for (let i = 0; i <= N; i++) { const { r, a, half } = at(i); const da = half / r; pts.push([r * Math.cos(a + da), r * Math.sin(a + da)]); }
  for (let i = N; i >= 0; i--) { const { r, a, half } = at(i); const da = half / r; pts.push([r * Math.cos(a - da), r * Math.sin(a - da)]); }
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
}

/**
 * Build a wheel.
 * @param {object} o { design, diameter (in), width (in), offset (mm), color, lipColor, finish }
 * @returns THREE.Group in metres; axle = +Z outboard, origin at the hub face.
 */
export function buildWheel(o) {
  const d = (DESIGNS[o.design] || DESIGNS['bmw-44'])();
  const W = o.width * IN, Rb = (o.diameter * IN) / 2; // bead seat radius
  const ET = o.offset;
  const zc = -ET; // rim centre plane relative to hub face
  const zo = zc + W / 2, zi = zc - W / 2; // bead seats
  const flangeH = 17.5, flangeT = 7;
  const group = new THREE.Group();
  group.name = 'wheel';

  const faceMat = new THREE.MeshPhysicalMaterial({
    color: o.color || '#c7c9cc', metalness: o.finish === 'gloss' ? 0.2 : 0.75,
    roughness: o.finish === 'gloss' ? 0.18 : o.finish === 'satin' ? 0.42 : 0.3,
    clearcoat: 1, clearcoatRoughness: o.finish === 'satin' ? 0.3 : 0.05,
  });
  const lipMat = o.lip === 'polished' || d.lip === 'step'
    ? new THREE.MeshPhysicalMaterial({ color: o.lipColor || '#e9eaec', metalness: 1, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02 })
    : faceMat;
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x9da1a6, metalness: 0.8, roughness: 0.45, side: THREE.DoubleSide });

  // ----- barrel (inboard part, dull) and outer lip (visible)
  const step = d.lip === 'step';
  const dish = step ? (d.dishDepth || 30) : 0;
  const barrelProfile = [
    [Rb + flangeH - 2, zi - flangeT + 1], [Rb + flangeH, zi - flangeT + 4], [Rb + 6, zi - 1], [Rb, zi + 3],
    [Rb - 1, zi + 14], [Rb - 3, zi + 18], [Rb - 24, zi + 30], [Rb - 27, zi + 38],
    [Rb - 27, zo - 42 - dish * 0.3], [Rb - 22, zo - 30 - dish * 0.3], [Rb - 2, zo - 18], [Rb, zo - 4],
    // inner skin back to the inboard flange
    [Rb - 6, zo - 6], [Rb - 8, zo - 20], [Rb - 31, zo - 36 - dish * 0.3], [Rb - 32, zi + 36],
    [Rb - 28, zi + 26], [Rb - 6, zi + 12], [Rb - 6, zi - flangeT + 3], [Rb + flangeH - 2, zi - flangeT + 1],
  ];
  const barrel = new THREE.Mesh(latheFromProfile(barrelProfile, 72), barrelMat);
  group.add(barrel);

  // outer lip: flange + (for step lips) a polished dish going inboard to the spoke ring
  const lipProfile = step
    ? [[Rb - 4, zo - dish - 6], [Rb - 2, zo - dish], [Rb - 1, zo - 6], [Rb + 3, zo + 1], [Rb + flangeH - 3, zo + flangeT - 2],
       [Rb + flangeH, zo + flangeT - 5], [Rb + flangeH - 1, zo + 1], [Rb + 6, zo - 2], [Rb + 1, zo - 6]]
    : [[Rb - 4, zo - 10], [Rb - 1, zo - 4], [Rb + 3, zo + 1], [Rb + flangeH - 3, zo + flangeT - 2],
       [Rb + flangeH, zo + flangeT - 5], [Rb + flangeH - 1, zo + 1], [Rb + 6, zo - 2], [Rb + 1, zo - 6]];
  const lip = new THREE.Mesh(latheFromProfile(lipProfile, 96), lipMat);
  group.add(lip);

  // ----- face
  const rHub = d.hubR;
  const rRim = Rb - (step ? 10 : 6);
  const zHub = d.pad; // hub pad face, proud of the mounting face
  const zRim = zo - (step ? dish + 4 : 7); // where spoke faces meet the barrel
  const faceZ = (r) => {
    const t = clamp((r - rHub) / (rRim - rHub), 0, 1);
    return zHub + (zRim - zHub) * Math.pow(t, d.profile);
  };
  const thick = (r) => {
    const t = clamp((r - rHub) / (rRim - rHub), 0, 1);
    return lerp(d.thick[0], d.thick[1], t);
  };

  // hub pad (with lug pockets) as a lathe disc; pockets are separate dark cylinders
  const hubProfile = [[0.1, zHub + 2], [rHub - 12, zHub + 1], [rHub - 2, zHub - 3], [rHub + 6, zHub - 12], [rHub + 8, 4], [rHub - 4, 0], [PCD_E46.bore / 2 + 4, 0], [PCD_E46.bore / 2, 6], [PCD_E46.bore / 2, zHub - 6], [0.1, zHub - 6]];
  const hub = new THREE.Mesh(latheFromProfile(hubProfile, 64), faceMat);
  group.add(hub);

  const faceParts = [];
  const bevel = { bevelEnabled: true, bevelThickness: 2.2, bevelSize: 2.4, bevelSegments: 3, curveSegments: 4, steps: 1 };
  const depth = 10;
  for (const sp of d.spokes) {
    const shape = spokeShape(sp, rHub, rRim);
    const g = new THREE.ExtrudeGeometry(shape, { depth, ...bevel });
    // bend onto the face surface and give it thickness that tapers with radius
    const p = g.attributes.position;
    const zMin = -bevel.bevelThickness, zMax = depth + bevel.bevelThickness;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const r = Math.hypot(x, y);
      const rel = (z - zMin) / (zMax - zMin);
      p.setZ(i, faceZ(r) - (1 - rel) * thick(r));
    }
    g.computeVertexNormals();
    faceParts.push(g);
  }
  // decorative grooves (Style 43)
  const grooveMat = new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.6, roughness: 0.5 });
  for (const gr of d.grooves || []) {
    const sp = { a0: gr.a0, width: () => gr.width, bend: gr.bend, from: gr.from, to: gr.to };
    const g = new THREE.ExtrudeGeometry(spokeShape(sp, rHub, rRim), { depth: 1, bevelEnabled: false });
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getY(i)); p.setZ(i, faceZ(r) + 0.6 + p.getZ(i) * 0.2); }
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, grooveMat));
  }
  for (const g of faceParts) {
    const m = new THREE.Mesh(g, faceMat);
    m.castShadow = true;
    group.add(m);
  }

  // spoke ring where spokes meet the barrel (hides the joins)
  const ringProfile = [[rRim - 8, zRim - 2], [rRim + 12, zRim + 2], [rRim + 14, zRim - 20], [rRim - 6, zRim - 24]];
  group.add(new THREE.Mesh(latheFromProfile(ringProfile, 96), faceMat));

  // rivets for two/three-piece designs
  if (d.rivets) {
    const rv = new THREE.CylinderGeometry(3.2, 3.6, 3, 10);
    rv.rotateX(Math.PI / 2);
    const rivetMat = new THREE.MeshStandardMaterial({ color: o.rivetColor || 0xd7d9dc, metalness: 1, roughness: 0.25 });
    const inst = new THREE.InstancedMesh(rv, rivetMat, d.rivets);
    const mm = new THREE.Matrix4();
    for (let i = 0; i < d.rivets; i++) {
      const a = (i / d.rivets) * TAU;
      const r = rRim - 1;
      mm.makeTranslation(r * Math.cos(a), r * Math.sin(a), zRim + 1.2);
      inst.setMatrixAt(i, mm);
    }
    group.add(inst);
  }

  // lug bolts in pockets
  const pocket = new THREE.CylinderGeometry(11, 11, 8, 20); pocket.rotateX(Math.PI / 2);
  const bolt = new THREE.CylinderGeometry(8.5, 8.5, 9, 6); bolt.rotateX(Math.PI / 2);
  const pocketMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
  const boltMat = new THREE.MeshStandardMaterial({ color: 0xb4b7ba, metalness: 1, roughness: 0.28 });
  for (let i = 0; i < PCD_E46.lugs; i++) {
    const a = (i / PCD_E46.lugs) * TAU + Math.PI / 2;
    const x = (PCD_E46.pcd / 2) * Math.cos(a), y = (PCD_E46.pcd / 2) * Math.sin(a);
    const pk = new THREE.Mesh(pocket, pocketMat); pk.position.set(x, y, zHub - 1.5); group.add(pk);
    const b = new THREE.Mesh(bolt, boltMat); b.position.set(x, y, zHub - 2); group.add(b);
  }

  // centre cap
  group.add(centreCap(d.cap, zHub));

  // metres
  group.scale.setScalar(0.001);
  group.userData = { rimRadius: Rb, flangeRadius: Rb + flangeH, zo, zi, zc, W, faceZ, rRim, rHub, zHub, zRim, design: o.design };
  return group;
}

let roundelTex = null;
function roundel() {
  if (roundelTex) return roundelTex;
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), cx = n / 2;
  g.fillStyle = '#111'; g.beginPath(); g.arc(cx, cx, cx, 0, TAU); g.fill();
  g.fillStyle = '#d9dcdf'; g.beginPath(); g.arc(cx, cx, cx * 0.97, 0, TAU); g.fill();
  g.fillStyle = '#0b0b0c'; g.beginPath(); g.arc(cx, cx, cx * 0.93, 0, TAU); g.fill();
  const q = (a0, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(cx, cx); g.arc(cx, cx, cx * 0.6, a0, a0 + Math.PI / 2); g.closePath(); g.fill(); };
  q(-Math.PI / 2, '#f2f2f2'); q(0, '#1c69d4'); q(Math.PI / 2, '#f2f2f2'); q(Math.PI, '#1c69d4');
  g.strokeStyle = '#c9ccd0'; g.lineWidth = n * 0.012; g.beginPath(); g.arc(cx, cx, cx * 0.6, 0, TAU); g.stroke();
  roundelTex = new THREE.CanvasTexture(c); roundelTex.colorSpace = THREE.SRGBColorSpace;
  return roundelTex;
}

function centreCap(kind, zHub) {
  const grp = new THREE.Group();
  if (kind === 'none') return grp;
  const R = kind === 'bmw' ? 34 : 30;
  const body = new THREE.CylinderGeometry(R, R + 1.5, 6, 40); body.rotateX(Math.PI / 2);
  const capMat = new THREE.MeshStandardMaterial({ color: kind === 'bbs' ? 0x111111 : 0x1b1b1b, metalness: 0.3, roughness: 0.35 });
  const b = new THREE.Mesh(body, capMat); b.position.z = zHub + 3; grp.add(b);
  const faceGeo = new THREE.CircleGeometry(R - 1.5, 48);
  let faceMat;
  if (kind === 'bmw') faceMat = new THREE.MeshPhysicalMaterial({ map: roundel(), metalness: 0.2, roughness: 0.25, clearcoat: 1 });
  else {
    const ringColor = kind === 'bbs' ? 0xc8a24a : kind === 'apex' ? 0x9aa0a6 : 0xb0b3b6;
    faceMat = new THREE.MeshStandardMaterial({ color: 0x101010, metalness: 0.4, roughness: 0.3 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(R - 7, R - 4, 48), new THREE.MeshStandardMaterial({ color: ringColor, metalness: 1, roughness: 0.25 }));
    ring.position.z = zHub + 6.2; grp.add(ring);
  }
  const f = new THREE.Mesh(faceGeo, faceMat); f.position.z = zHub + 6.1; grp.add(f);
  return grp;
}
