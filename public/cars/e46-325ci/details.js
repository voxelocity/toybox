// E46 Coupe exterior details: lamps, kidney grilles, mirrors, handles, badges.
// Dimensions in millimetres (car coordinates, see body.js), measured from the
// CC BY 4.0 blueprint and the pre-facelift coupe reference photos.
import * as THREE from 'three';
import { buildEndLamp, buildSideDecal, smoothPathMM, pathMM, canvasTexture, mmCanvas } from '../../js/cad/lamp.js';
import { topPatch } from '../../js/cad/surface.js';
import { remapGeometry } from '../../js/cad/remap.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- headlights
// Arc coordinates u (mm around the front face from the centreline) and z.
const HL_REGION = { u0: 250, u1: 740, z0: 494, z1: 620 };
const HL_OUTLINE = [[262, 509], [262, 600], [300, 608], [420, 614], [540, 612], [640, 604], [705, 588], [733, 562], [732, 540], [712, 522], [640, 512], [520, 507], [380, 505], [290, 505]];
const HL_LAMPS = [{ u: 393, z: 559, r: 47 }, { u: 551, z: 559, r: 53 }];

function reflector(g, X, Y, S, c, kind) {
  const cx = X(c.u), cy = Y(c.z), r = c.r * S;
  if (kind === 'projector') {
    const gr = g.createRadialGradient(cx - r * 0.2, cy - r * 0.25, r * 0.05, cx, cy, r);
    gr.addColorStop(0, '#9aa1a6'); gr.addColorStop(0.35, '#2a2d31'); gr.addColorStop(0.72, '#121416'); gr.addColorStop(0.86, '#b9bcc0'); gr.addColorStop(1, '#4b4e52');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    // projector lens
    const lg = g.createRadialGradient(cx - r * 0.15, cy - r * 0.2, r * 0.02, cx, cy, r * 0.5);
    lg.addColorStop(0, '#e8f0ff'); lg.addColorStop(0.25, '#5a6570'); lg.addColorStop(1, '#0c0e10');
    g.fillStyle = lg; g.beginPath(); g.arc(cx, cy, r * 0.5, 0, TAU); g.fill();
  } else {
    // halogen free-form reflector: chrome bowl with ribbed rim
    const gr = g.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.05, cx, cy, r);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, '#c9cdd1'); gr.addColorStop(0.8, '#7f8488'); gr.addColorStop(1, '#3a3d40');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.2;
    for (let i = 0; i < 64; i++) { const a = (i / 64) * TAU; g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82); g.lineTo(cx + Math.cos(a) * r * 0.98, cy + Math.sin(a) * r * 0.98); g.stroke(); }
    g.fillStyle = '#2b2d30'; g.beginPath(); g.arc(cx, cy, r * 0.16, 0, TAU); g.fill();
    g.fillStyle = '#d9dde0'; g.beginPath(); g.arc(cx, cy, r * 0.09, 0, TAU); g.fill();
  }
}

export function buildHeadlights(field, offsetX, variant = 'halogen') {
  const black = variant === 'depo-ae';
  const lamp = buildEndLamp(field, {
    end: 'front', region: HL_REGION, offsetX, xLimit: 200, lensLift: 5,
    paint: ({ g, X, Y, S, W, H }) => {
      g.save();
      smoothPathMM(g, X, Y, HL_OUTLINE); g.clip();
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, black ? '#0b0c0d' : '#3a3e42'); bg.addColorStop(0.5, black ? '#17191b' : '#8d9296'); bg.addColorStop(1, black ? '#0b0c0d' : '#2a2d30');
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      // parking / side lamp reflector at the outer tip
      const pg = g.createLinearGradient(X(640), 0, X(735), 0);
      pg.addColorStop(0, black ? '#1b1d1f' : '#b8bcc0'); pg.addColorStop(1, black ? '#2c2f33' : '#e6e8ea');
      g.fillStyle = pg; g.fillRect(X(640), 0, X(740) - X(640), H);
      for (const [i, c] of HL_LAMPS.entries()) {
        const kind = variant === 'halogen' ? 'reflector' : (variant === 'xenon' && i === 0 ? 'reflector' : 'projector');
        reflector(g, X, Y, S, c, kind);
      }
      if (variant !== 'halogen') {
        g.strokeStyle = '#f4f6f8'; g.lineWidth = 3.2 * S;
        for (const c of HL_LAMPS) { g.beginPath(); g.arc(X(c.u), Y(c.z), (c.r + 3) * S, 0, TAU); g.stroke(); }
      }
      // housing edge shading
      g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 6 * S; smoothPathMM(g, X, Y, HL_OUTLINE); g.stroke();
      g.restore();
    },
    emissive: ({ g, X, Y, S }) => {
      g.fillStyle = '#fff';
      if (variant !== 'halogen') {
        g.strokeStyle = '#fff'; g.lineWidth = 3.5 * S;
        for (const c of HL_LAMPS) { g.beginPath(); g.arc(X(c.u), Y(c.z), (c.r + 3) * S, 0, TAU); g.stroke(); }
      } else {
        for (const c of HL_LAMPS) { g.beginPath(); g.arc(X(c.u), Y(c.z), c.r * 0.35 * S, 0, TAU); g.fill(); }
      }
    },
    emissiveColor: variant === 'halogen' ? '#fff3dc' : '#eef4ff',
  });
  lamp.name = 'headlights';
  return lamp;
}

// ---------------------------------------------------------------- kidney grilles
export function buildKidneys(field, offsetX, finish = 'chrome') {
  const group = new THREE.Group(); group.name = 'kidneys';
  const outline = [[16, 507], [16, 604], [40, 610], [120, 609], [200, 603], [236, 592], [249, 570], [247, 535], [236, 514], [210, 507]];
  const frameMat = finish === 'chrome'
    ? new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.06 })
    : new THREE.MeshPhysicalMaterial({ color: 0x050505, metalness: 0.2, roughness: 0.15, clearcoat: 1 });
  const slatMat = new THREE.MeshPhysicalMaterial({ color: 0x080808, metalness: 0.1, roughness: finish === 'chrome' ? 0.45 : 0.2, clearcoat: finish === 'chrome' ? 0 : 1 });
  const backMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 });
  const shape = (pts, inset = 0) => {
    const cx = 132, cz = 558;
    const s = new THREE.Shape();
    pts.forEach(([w, z], i) => {
      const dw = w - cx, dz = z - cz, l = Math.hypot(dw, dz) || 1;
      const p = [w - (dw / l) * inset, z - (dz / l) * inset];
      i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1]);
    });
    s.closePath();
    return s;
  };
  const outer = shape(outline);
  const hole = shape(outline, 11);
  const frameShape = outer.clone(); frameShape.holes.push(hole);
  const xFace = field.loft.planLimit ? null : null; void xFace;
  // face position: sample the front surface at the kidney centre
  const xAt = (w, z) => {
    // march stations forward from x = 400 until the width at z drops below w
    let lo = 400, hi = 780;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (field.widthAt(m, z) > w) lo = m; else hi = m; }
    return lo;
  };
  const x0 = xAt(130, 556) + 6;
  const toCar = (geo, side, xBase) => remapGeometry(geo, [2, 1, 0, 1, 1, side], {
    tweak: (o, i) => { o[0] += xBase - (i[0] / 250) * 10; },
    scale: 0.001, offset: [offsetX / 1000, 0, 0],
  });
  for (const side of [1, -1]) {
    const fg = new THREE.ExtrudeGeometry(frameShape, { depth: 16, bevelEnabled: true, bevelThickness: 3, bevelSize: 2.5, bevelSegments: 3, curveSegments: 12 });
    group.add(new THREE.Mesh(toCar(fg, side, x0 - 4), frameMat));
    // slats
    const nS = 10;
    for (let i = 0; i < nS; i++) {
      const w = 30 + (i * (228 - 30)) / (nS - 1);
      const slat = new THREE.ExtrudeGeometry((() => { const s = new THREE.Shape(); s.moveTo(w - 3.2, 512); s.lineTo(w + 3.2, 512); s.lineTo(w + 3.2, 606 - Math.max(0, (w - 180)) * 0.35); s.lineTo(w - 3.2, 606 - Math.max(0, (w - 180)) * 0.35); s.closePath(); return s; })(), { depth: 14, bevelEnabled: true, bevelThickness: 1, bevelSize: 1, bevelSegments: 1 });
      group.add(new THREE.Mesh(toCar(slat, side, x0 - 10), slatMat));
    }
    const back = new THREE.ShapeGeometry(outer);
    back.translate(0, 0, 0);
    group.add(new THREE.Mesh(toCar(back, side, x0 - 30), backMat));
  }
  group.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return group;
}

// ---------------------------------------------------------------- tail lamps
const TL_REGION = { u0: 318, u1: 990, z0: 786, z1: 962 };
export function buildTaillights(field, offsetX, variant = 'oem') {
  const inner = [[330, 816], [330, 930], [350, 938], [560, 942], [566, 936], [566, 818], [550, 812], [345, 810]];
  const outer = [[575, 818], [575, 940], [700, 946], [820, 950], [920, 952], [968, 945], [985, 915], [972, 862], [930, 820], [860, 800], [700, 797], [590, 800]];
  const lamp = buildEndLamp(field, {
    end: 'rear', region: TL_REGION, offsetX, xLimit: -3150, lensLift: 4,
    innerMetal: 0.2, innerRough: 0.35,
    paint: ({ g, X, Y, S }) => {
      const fill = (pts, fn) => { g.save(); smoothPathMM(g, X, Y, pts); g.clip(); fn(); g.restore(); };
      const smoke = variant === 'smoke' || variant === 'lci-led';
      fill(outer, () => {
        g.fillStyle = smoke ? '#3a0a0c' : '#9e0f14'; g.fillRect(0, 0, 9999, 9999);
        if (!smoke) {
          // amber turn signal band across the upper inner part (US spec)
          g.fillStyle = '#d87a12'; pathMM(g, X, Y, [[575, 905], [760, 910], [760, 944], [575, 940]]); g.fill();
          // reflector optics texture
          g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
          for (let u = 580; u < 990; u += 6) { g.beginPath(); g.moveTo(X(u), 0); g.lineTo(X(u), 9999); g.stroke(); }
        } else {
          // LED "L" light guides and dot matrix
          g.fillStyle = '#ff3b3b';
          for (let u = 600; u < 950; u += 18) for (let z = 818; z < 900; z += 16) { g.beginPath(); g.arc(X(u), Y(z), 3.2 * S, 0, TAU); g.fill(); }
          g.fillStyle = variant === 'lci-led' ? '#d9d9d9' : '#8b8b8b';
          pathMM(g, X, Y, [[590, 918], [930, 925], [930, 935], [590, 930]]); g.fill();
        }
      });
      fill(inner, () => {
        g.fillStyle = smoke ? '#3a0a0c' : '#9e0f14'; g.fillRect(0, 0, 9999, 9999);
        // white reversing lamp near the plate
        g.fillStyle = smoke ? '#6a6c70' : '#eceef0'; pathMM(g, X, Y, [[330, 816], [430, 816], [430, 880], [330, 880]]); g.fill();
        if (smoke) { g.fillStyle = '#ff3b3b'; for (let u = 450; u < 560; u += 16) for (let z = 822; z < 930; z += 16) { g.beginPath(); g.arc(X(u), Y(z), 3 * S, 0, TAU); g.fill(); } }
      });
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 3 * S;
      smoothPathMM(g, X, Y, outer); g.stroke(); smoothPathMM(g, X, Y, inner); g.stroke();
    },
    emissive: ({ g, X, Y }) => {
      g.fillStyle = '#ff2020';
      g.save(); smoothPathMM(g, X, Y, outer); g.fill(); smoothPathMM(g, X, Y, inner); g.fill(); g.restore();
    },
    emissiveColor: '#ff2a2a',
    lens: { color: variant === 'smoke' || variant === 'lci-led' ? '#2a1010' : '#ffffff', opacity: variant === 'oem' ? 0.14 : 0.35 },
  });
  lamp.name = 'taillights';
  return lamp;
}

// ---------------------------------------------------------------- front bumper lamps (stock)
export function buildFrontMarkers(field, offsetX) {
  // US-spec amber turn signal / side marker in the bumper corner
  return buildEndLamp(field, {
    end: 'front', region: { u0: 700, u1: 905, z0: 398, z1: 434 }, offsetX, xLimit: 200, lensLift: 2,
    innerMetal: 0.2, innerRough: 0.3,
    paint: ({ g, X, Y, S }) => {
      g.fillStyle = '#e07b10';
      g.beginPath(); g.roundRect(X(760), Y(428), X(880) - X(760), Y(404) - Y(428), 6 * S); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
      for (let u = 764; u < 878; u += 5) { g.beginPath(); g.moveTo(X(u), Y(426)); g.lineTo(X(u), Y(406)); g.stroke(); }
    },
    emissive: ({ g, X, Y, S }) => { g.fillStyle = '#ffa030'; g.beginPath(); g.roundRect(X(760), Y(428), X(880) - X(760), Y(404) - Y(428), 6 * S); g.fill(); },
    emissiveColor: '#ff9a20',
    lens: { opacity: 0.2 },
  });
}

/** Round fog lamp: reflector disc + clear lens, facing forward. */
export function buildFogLamp(field, offsetX, { w, z, r }) {
  const group = new THREE.Group(); group.name = 'fogs';
  const { canvas, g, X, Y, S } = mmCanvas({ u0: -r, u1: r, z0: -r, z1: r }, 8);
  const gr = g.createRadialGradient(X(-r * 0.2), Y(r * 0.25), 2, X(0), Y(0), r * S);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#b9bdc1'); gr.addColorStop(0.9, '#55595d'); gr.addColorStop(1, '#1a1b1c');
  g.fillStyle = gr; g.beginPath(); g.arc(X(0), Y(0), r * S, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
  for (let i = -r; i < r; i += 4) { g.beginPath(); g.moveTo(X(i), Y(-r)); g.lineTo(X(i), Y(r)); g.stroke(); }
  const discMat = new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), metalness: 0.9, roughness: 0.2, emissive: 0xffffff, emissiveIntensity: 0, emissiveMap: canvasTexture(canvas) });
  const lensMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.15, roughness: 0.02, clearcoat: 1, envMapIntensity: 1.5, depthWrite: false });
  const xAt = (ww, zz) => { let lo = 200, hi = 780; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (field.widthAt(m, zz) > ww) lo = m; else hi = m; } return lo; };
  for (const side of [1, -1]) {
    const x = xAt(w, z);
    const x2 = xAt(w + 10, z);
    const yaw = Math.atan2(10, x - x2); // surface slope in plan
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r / 1000, 40), discMat);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(r / 1000, 32, 12, 0, TAU, 0, 0.5), lensMat);
    lens.rotation.x = Math.PI / 2; lens.scale.set(1, 0.12, 1);
    const holder = new THREE.Group();
    holder.add(disc); lens.position.z = 0.001; holder.add(lens);
    holder.position.set((x - 14 + offsetX) / 1000, z / 1000, side * w / 1000);
    holder.rotation.y = Math.PI / 2 + side * (Math.PI / 2 - yaw) * 0.6;
    group.add(holder);
  }
  group.userData.setLit = (on, l = 2) => { discMat.emissiveIntensity = on ? l : 0; };
  return group;
}

// ---------------------------------------------------------------- mirrors
export function buildMirrors(field, offsetX, style = 'oem', paintMat) {
  const group = new THREE.Group(); group.name = 'mirrors';
  const blackMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ec, metalness: 1, roughness: 0.02 });
  // housing: loft of rounded sections along lateral w
  const secs = style === 'm3'
    ? [{ w: 18, dx: 95, dz: 52, x: -895, z: 930 }, { w: 90, dx: 150, dz: 70, x: -890, z: 952 }, { w: 170, dx: 172, dz: 82, x: -880, z: 958 }, { w: 205, dx: 150, dz: 74, x: -872, z: 958 }]
    : [{ w: 10, dx: 150, dz: 70, x: -880, z: 912 }, { w: 70, dx: 175, dz: 88, x: -880, z: 935 }, { w: 150, dx: 196, dz: 104, x: -872, z: 948 }, { w: 200, dx: 176, dz: 96, x: -866, z: 948 }];
  const shellPts = (s, n) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const c = Math.cos(a), sn = Math.sin(a);
      // superellipse, flatter at the back (mirror face side = -x)
      const e = 2.8;
      const px = Math.sign(c) * Math.pow(Math.abs(c), 2 / e) * (c < 0 ? s.dx * 0.42 : s.dx * 0.58);
      const pz = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / e) * s.dz / 2;
      pts.push([s.x + px, s.z + pz]);
    }
    return pts;
  };
  const N = 40;
  for (const side of [1, -1]) {
    const bodyW = field.widthAt(-880, 900);
    const pos = [], idx = [];
    secs.forEach((s) => { for (const [x, z] of shellPts(s, N)) pos.push((x + offsetX) / 1000, z / 1000, side * (bodyW - 8 + s.w) / 1000); });
    for (let j = 0; j < secs.length - 1; j++) for (let i = 0; i < N; i++) {
      const a = j * N + i, b = j * N + ((i + 1) % N), c = (j + 1) * N + i, d = (j + 1) * N + ((i + 1) % N);
      if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    // cap
    const last = secs[secs.length - 1], capC = pos.length / 3;
    pos.push((last.x + offsetX) / 1000, last.z / 1000, side * (bodyW - 8 + last.w + 6) / 1000);
    for (let i = 0; i < N; i++) { const a = (secs.length - 1) * N + i, b = (secs.length - 1) * N + ((i + 1) % N); if (side > 0) idx.push(a, b, capC); else idx.push(a, capC, b); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const housing = new THREE.Mesh(geo, paintMat); housing.castShadow = true;
    group.add(housing);
    // glass on the rear face
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 1), glassMat);
    const face = secs[2];
    const glass = new THREE.Mesh(new THREE.CircleGeometry(1, 32), glassMat);
    glass.scale.set((secs[3].w - secs[1].w) / 2000, face.dz * 0.42 / 1000, 1);
    glass.position.set((face.x - face.dx * 0.42 + 2 + offsetX) / 1000, face.z / 1000, side * (bodyW - 8 + (secs[1].w + secs[3].w) / 2) / 1000);
    glass.rotation.y = -Math.PI / 2;
    group.add(glass); void gl;
    // base / sail
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 0.03), blackMat);
    base.position.set((-890 + offsetX) / 1000, 0.905, side * (bodyW + 4) / 1000);
    group.add(base);
  }
  return group;
}

// ---------------------------------------------------------------- handles, markers, badges
export function buildSideHardware(field, offsetX, paintMat) {
  const group = new THREE.Group(); group.name = 'sideHardware';
  // door pull handle (body colour) with dark recess
  for (const side of [1, -1]) {
    const x0 = -1540, x1 = -1700, z = 793;
    const w = field.widthAt((x0 + x1) / 2, z);
    const recess = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.036, 0.004), new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.8 }));
    recess.position.set(((x0 + x1) / 2 + offsetX) / 1000, (z - 2) / 1000, side * (w + 0.5) / 1000);
    const hs = new THREE.Shape(); hs.moveTo(0, 0); hs.lineTo(150, 0); hs.quadraticCurveTo(160, 0, 160, 10); hs.lineTo(155, 22); hs.lineTo(8, 22); hs.quadraticCurveTo(0, 20, 0, 10); hs.closePath();
    const hg = new THREE.ExtrudeGeometry(hs, { depth: 12, bevelEnabled: true, bevelThickness: 3, bevelSize: 3, bevelSegments: 3 });
    hg.translate(-80, -11, 0); hg.scale(0.001, 0.001, 0.001);
    const handle = new THREE.Mesh(hg, paintMat);
    handle.position.set(((x0 + x1) / 2 + offsetX) / 1000, z / 1000, side * (w + 1) / 1000);
    if (side < 0) handle.rotation.y = Math.PI;
    handle.castShadow = true;
    group.add(recess, handle);
  }
  // fender side repeater (clear lens, chrome rim) behind the front wheel
  group.add(buildSideDecal(field, {
    region: { u0: -430, u1: -490, z0: 612, z1: 634 }, offsetX, offset: 1.2,
    paint: ({ g, X, Y, S }) => {
      g.fillStyle = '#d7dadd'; g.beginPath(); g.ellipse((X(-430) + X(-490)) / 2, (Y(612) + Y(634)) / 2, 29 * S, 10 * S, 0, 0, TAU); g.fill();
      g.fillStyle = '#e8a040'; g.beginPath(); g.ellipse((X(-430) + X(-490)) / 2, (Y(612) + Y(634)) / 2, 25 * S, 7.5 * S, 0, 0, TAU); g.fill();
    },
  }));
  return group;
}

let roundelTex = null;
function roundelCanvas() {
  if (roundelTex) return roundelTex;
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), cx = n / 2;
  g.fillStyle = '#c9ccd0'; g.beginPath(); g.arc(cx, cx, cx, 0, TAU); g.fill();
  g.fillStyle = '#0c0c0d'; g.beginPath(); g.arc(cx, cx, cx * 0.93, 0, TAU); g.fill();
  const q = (a0, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(cx, cx); g.arc(cx, cx, cx * 0.62, a0, a0 + Math.PI / 2); g.closePath(); g.fill(); };
  q(-Math.PI / 2, '#f4f4f4'); q(0, '#1c69d4'); q(Math.PI / 2, '#f4f4f4'); q(Math.PI, '#1c69d4');
  g.strokeStyle = '#c9ccd0'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cx, cx * 0.62, 0, TAU); g.stroke();
  roundelTex = canvasTexture(c);
  return roundelTex;
}

export function buildBadges(field, offsetX) {
  const group = new THREE.Group(); group.name = 'badges';
  const mat = new THREE.MeshPhysicalMaterial({ map: roundelCanvas(), transparent: true, alphaTest: 0.1, metalness: 0.3, roughness: 0.2, clearcoat: 1 });
  // hood roundel (82 mm) near the front of the hood
  const hood = topPatch(field, { x0: 646, x1: 564, w0: -41, w1: 41, nx: 6, nw: 6, offset: 1.5, offsetX });
  group.add(new THREE.Mesh(hood, mat));
  // trunk roundel (70 mm) near the rear edge
  const trunk = topPatch(field, { x0: -3560, x1: -3630, w0: -35, w1: 35, nx: 6, nw: 6, offset: 1.5, offsetX });
  group.add(new THREE.Mesh(trunk, mat));
  return group;
}

/** Windshield wipers resting on the cowl. */
export function buildWipers(field, offsetX) {
  const group = new THREE.Group(); group.name = 'wipers';
  const mat = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.6 });
  const arms = [{ pivot: [-420, -470], tip: [-560, 250], len: 600 }, { pivot: [-420, 60], tip: [-545, 620], len: 560 }];
  for (const a of arms) {
    const [x0, w0] = a.pivot, [x1, w1] = a.tip;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, x = x0 + (x1 - x0) * t, w = w0 + (w1 - w0) * t;
      pts.push(new THREE.Vector3((x + offsetX) / 1000, (field.topZ(x, Math.abs(w)) + 14) / 1000, w / 1000));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.006, 6), mat));
  }
  return group;
}
