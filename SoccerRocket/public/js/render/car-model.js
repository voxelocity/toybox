// Procedural car models. Bodies are lofted superellipse cross-sections, so
// shapes are defined by a few profile tables. Built in car-local physics
// units (uu: x forward, y left, z up, origin = centre of mass) and converted
// to three.js space (x forward, y up, z right) with scale 0.01.
import * as THREE from 'three';
import { S } from './convert.js';
import { CAR_PRESETS } from '../physics/constants.js';

const P = CAR_PRESETS.octane;
export const GROUND_Z = -17; // car origin sits 17 uu above the ground at rest

function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      let t = (x - x0) / (x1 - x0);
      t = t * t * (3 - 2 * t) * 0.6 + t * 0.4; // softened
      return y0 + (y1 - y0) * t;
    }
  }
  return table[table.length - 1][1];
}

/**
 * Loft along x. spec: { x0, x1, w, zb, zt, yc?, nTop, nBot, tumble?, cap? }
 * tables are [[x, value], ...]. Returns BufferGeometry in three space.
 */
export function loft(spec, segX = 48, segR = 40) {
  const pos = [], uv = [], idx = [];
  const nTop = spec.nTop || 2.6, nBot = spec.nBot || 5;
  for (let i = 0; i <= segX; i++) {
    const t = i / segX;
    const x = spec.x0 + (spec.x1 - spec.x0) * t;
    const w = Math.max(0.01, interp(spec.w, x));
    const zb = interp(spec.zb, x), zt = interp(spec.zt, x);
    const yc = spec.yc ? interp(spec.yc, x) : 0;
    const zc = (zt + zb) / 2, h = Math.max(0.01, (zt - zb) / 2);
    const tumble = spec.tumble || 0;
    for (let j = 0; j <= segR; j++) {
      const a = (j / segR) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const n = s >= 0 ? nTop : nBot;
      const ey = Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const ez = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      const wy = w * (1 - tumble * Math.max(0, ez));
      const py = yc + ey * wy, pz = zc + ez * h;
      pos.push(x * S, pz * S, -py * S);
      uv.push(t, j / segR);
    }
  }
  const row = segR + 1;
  for (let i = 0; i < segX; i++) for (let j = 0; j < segR; j++) {
    const a = i * row + j, b = a + row;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  // end caps
  for (const [i, flip] of [[0, true], [segX, false]]) {
    const center = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < segR; j++) { const k = (i * row + j) * 3; cx += pos[k]; cy += pos[k + 1]; cz += pos[k + 2]; }
    pos.push(cx / segR, cy / segR, cz / segR); uv.push(i ? 1 : 0, 0.5);
    for (let j = 0; j < segR; j++) {
      const a = i * row + j, b = a + 1;
      if (flip) idx.push(center, a, b); else idx.push(center, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Body styles. All share the same hitbox and wheel layout.
export const BODY_STYLES = {
  striker: {
    label: 'Striker',
    body: {
      x0: -47, x1: 74, nTop: 3.2, nBot: 7, tumble: 0.18,
      w: [[-47, 29], [-40, 35], [-28, 37], [-14, 35], [0, 32], [20, 30], [42, 30], [56, 29], [66, 24], [74, 13]],
      zb: [[-47, -2], [-36, -8], [0, -10], [55, -9], [74, -3]],
      zt: [[-47, 21], [-38, 24], [-24, 23], [-6, 20], [20, 15], [45, 10], [62, 6], [74, 1]],
    },
    canopy: {
      x0: -30, x1: 30, nTop: 2.4, nBot: 4, tumble: 0.2,
      w: [[-30, 10], [-22, 20], [-6, 23], [10, 21], [22, 14], [30, 4]],
      zb: [[-30, 18], [0, 16], [30, 12]],
      zt: [[-30, 24], [-16, 36.5], [0, 38], [14, 33], [24, 24], [30, 15]],
    },
    spoiler: { x: -43, z: 34, span: 74, chord: 13, struts: 18 },
    fenders: 'pods',
    nozzleY: 10, nozzleZ: 8,
  },
  brawler: {
    label: 'Brawler',
    body: {
      x0: -49, x1: 76, nTop: 4.5, nBot: 8, tumble: 0.1,
      w: [[-49, 34], [-40, 37], [-10, 37], [30, 35], [60, 34], [70, 31], [76, 24]],
      zb: [[-49, -4], [-38, -9], [0, -10], [60, -9], [76, -4]],
      zt: [[-49, 22], [-40, 25], [-10, 24], [20, 19], [55, 17], [70, 14], [76, 8]],
    },
    canopy: {
      x0: -30, x1: 22, nTop: 4, nBot: 4, tumble: 0.22,
      w: [[-30, 20], [-20, 25], [0, 25], [15, 22], [22, 12]],
      zb: [[-30, 20], [22, 16]],
      zt: [[-30, 27], [-24, 38], [6, 39], [16, 33], [22, 20]],
    },
    spoiler: { x: -45, z: 30, span: 70, chord: 10, struts: 22 },
    fenders: 'flares',
    nozzleY: 13, nozzleZ: 9,
  },
  phantom: {
    label: 'Phantom',
    body: {
      x0: -48, x1: 77, nTop: 2.6, nBot: 6, tumble: 0.25,
      w: [[-48, 26], [-40, 36], [-25, 38], [-5, 33], [25, 29], [50, 31], [64, 27], [77, 10]],
      zb: [[-48, 0], [-36, -8], [0, -10], [60, -9], [77, -4]],
      zt: [[-48, 18], [-38, 20], [-22, 19], [0, 15], [30, 11], [55, 8], [70, 4], [77, 0]],
    },
    canopy: {
      x0: -36, x1: 34, nTop: 2.2, nBot: 3, tumble: 0.25,
      w: [[-36, 6], [-24, 18], [-4, 22], [16, 19], [28, 10], [34, 3]],
      zb: [[-36, 15], [0, 12], [34, 9]],
      zt: [[-36, 19], [-20, 32], [-2, 34], [16, 28], [28, 18], [34, 11]],
    },
    spoiler: { x: -46, z: 25, span: 78, chord: 15, struts: 26 },
    fenders: 'pods',
    nozzleY: 9, nozzleZ: 6,
  },
};

export const PAINTS = [
  { name: 'Team', blue: 0x1d5cff, orange: 0xff6a12 },
  { name: 'Deep', blue: 0x0b2f9e, orange: 0xc2410c },
  { name: 'Pastel', blue: 0x5fa8ff, orange: 0xffa45c },
  { name: 'Neon', blue: 0x00b7ff, orange: 0xff4d00 },
];
export const ACCENTS = [0x14161b, 0xf2f2f2, 0x8a8f99, 0xffd23f, 0x18c37e, 0xb43cff];

let _tireTex = null;
function tireTexture() {
  if (_tireTex) return _tireTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#202020';
  for (let i = 0; i < 32; i++) { const x = i * 8; g.beginPath(); g.moveTo(x, 4); g.lineTo(x + 4, 16); g.lineTo(x, 28); g.lineTo(x + 2, 28); g.lineTo(x + 6, 16); g.lineTo(x + 2, 4); g.fill(); }
  _tireTex = new THREE.CanvasTexture(c);
  _tireTex.wrapS = _tireTex.wrapT = THREE.RepeatWrapping;
  return _tireTex;
}

function makeWheel(radius, width, mats, detail) {
  const g = new THREE.Group();
  // tyre: lathe around the axle (three z axis after rotation)
  const prof = [];
  const r0 = radius * 0.66, hw = width / 2, bev = Math.min(3, width * 0.25);
  prof.push(new THREE.Vector2(r0 * S, -hw * S));
  prof.push(new THREE.Vector2((radius - bev) * S, -hw * S));
  for (let k = 0; k <= 6; k++) {
    const a = -Math.PI / 2 + (k / 6) * Math.PI / 2;
    prof.push(new THREE.Vector2((radius - bev + Math.cos(a) * bev) * S, (-hw + bev + Math.sin(a) * bev) * S));
  }
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * Math.PI / 2;
    prof.push(new THREE.Vector2((radius - bev + Math.cos(a) * bev) * S, (hw - bev + Math.sin(a) * bev) * S));
  }
  prof.push(new THREE.Vector2(r0 * S, hw * S));
  const tg = new THREE.LatheGeometry(prof, detail ? 40 : 18);
  tg.rotateX(Math.PI / 2);
  const tire = new THREE.Mesh(tg, mats.tire);
  tire.castShadow = true;
  g.add(tire);
  // rim
  const rimR = radius * 0.68;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(rimR * S, rimR * S, (width - 1) * S, detail ? 32 : 14, 1, true), mats.rim);
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const face = new THREE.Mesh(new THREE.CircleGeometry(rimR * 0.98 * S, detail ? 32 : 14), mats.rimDark);
  face.position.z = (width / 2 - 1.5) * S;
  g.add(face);
  const face2 = face.clone(); face2.position.z = -(width / 2 - 1.5) * S; face2.rotation.y = Math.PI; g.add(face2);
  if (detail) {
    const spokeGeo = new THREE.BoxGeometry(rimR * 0.95 * S, 2.2 * S, 1.6 * S);
    for (const side of [1, -1]) {
      for (let k = 0; k < 5; k++) {
        const sp = new THREE.Mesh(spokeGeo, mats.rim);
        const a = (k / 5) * Math.PI * 2;
        sp.position.set(Math.cos(a) * rimR * 0.48 * S, Math.sin(a) * rimR * 0.48 * S, side * (width / 2 - 0.6) * S);
        sp.rotation.z = a;
        g.add(sp);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(2.6 * S, 2.6 * S, 1.6 * S, 12), mats.accent);
      hub.rotation.x = Math.PI / 2; hub.position.z = side * (width / 2 - 0.2) * S;
      g.add(hub);
    }
  }
  return g;
}

/**
 * Build a car. Returns { group, body, wheels[4] (pivot groups), nozzles[2]
 * (three-space local positions), materials }.
 */
export function buildCarModel({ style = 'striker', team = 0, paint = 0, accent = 0, quality }) {
  const st = BODY_STYLES[style] || BODY_STYLES.striker;
  const physical = quality ? quality.physicalMaterials : true;
  const detail = quality ? quality.stadiumDetail >= 1 : true;
  const pc = PAINTS[paint] || PAINTS[0];
  const paintColor = new THREE.Color(team === 0 ? pc.blue : pc.orange);
  const accentColor = new THREE.Color(ACCENTS[accent] || ACCENTS[0]);
  const mats = {
    paint: physical
      ? new THREE.MeshPhysicalMaterial({ color: paintColor, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.1 })
      : new THREE.MeshLambertMaterial({ color: paintColor }),
    accent: physical ? new THREE.MeshPhysicalMaterial({ color: accentColor, metalness: 0.6, roughness: 0.35, clearcoat: 0.6 }) : new THREE.MeshLambertMaterial({ color: accentColor }),
    glass: physical ? new THREE.MeshPhysicalMaterial({ color: 0x0a0e16, metalness: 0.2, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.6 }) : new THREE.MeshLambertMaterial({ color: 0x0c1018 }),
    dark: physical ? new THREE.MeshStandardMaterial({ color: 0x0e0f12, roughness: 0.7, metalness: 0.2 }) : new THREE.MeshLambertMaterial({ color: 0x0e0f12 }),
    tire: physical ? new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.88, metalness: 0, bumpMap: tireTexture(), bumpScale: 1.2 }) : new THREE.MeshLambertMaterial({ color: 0x18191b }),
    rim: physical ? new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.22, metalness: 1 }) : new THREE.MeshLambertMaterial({ color: 0x9aa0aa }),
    rimDark: physical ? new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.4, metalness: 0.8 }) : new THREE.MeshLambertMaterial({ color: 0x24262b }),
    head: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.2, 3.0), toneMapped: false }),
    tail: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.15, 0.1), toneMapped: false }),
    nozzle: physical ? new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.3, metalness: 1 }) : new THREE.MeshLambertMaterial({ color: 0x3a3d44 }),
    nozzleGlow: new THREE.MeshBasicMaterial({ color: team === 0 ? new THREE.Color(0.25, 0.5, 1.4) : new THREE.Color(1.4, 0.5, 0.12), toneMapped: false }),
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const add = (geo, mat, parent = body) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };

  const seg = detail ? 1 : 0.5;
  add(loft(st.body, Math.round(56 * seg), Math.round(44 * seg)), mats.paint);
  add(loft(st.canopy, Math.round(32 * seg), Math.round(32 * seg)), mats.glass);
  // roof stripe in accent colour
  add(loft({ ...st.canopy, w: st.canopy.w.map(([x, w]) => [x, w * 0.28]), zt: st.canopy.zt.map(([x, z]) => [x, z + 0.6]), zb: st.canopy.zt.map(([x, z]) => [x, z - 3]), nBot: 2 }, 24, 16), mats.accent);
  // lower skirt / underbody in dark
  add(loft({
    x0: st.body.x0 + 4, x1: st.body.x1 - 6, nTop: 6, nBot: 6,
    w: st.body.w.map(([x, w]) => [x, w * 0.92]), zb: st.body.zb.map(([x, z]) => [x, z - 0.5]), zt: st.body.zb.map(([x, z]) => [x, z + 5]),
  }, 24, 20), mats.dark);

  // fenders
  const F = P.front, Bk = P.back;
  const wheelZF = GROUND_Z + F.radius, wheelZB = GROUND_Z + Bk.radius;
  for (const side of [1, -1]) {
    if (st.fenders === 'pods') {
      add(loft({ x0: Bk.x - 21, x1: Bk.x + 19, nTop: 2.4, nBot: 6, w: [[Bk.x - 21, 4], [Bk.x - 14, 9], [Bk.x + 10, 9], [Bk.x + 19, 3]], zb: [[0, wheelZB - 3]], zt: [[Bk.x - 21, wheelZB + 8], [Bk.x, wheelZB + Bk.radius + 4], [Bk.x + 19, wheelZB + 8]], yc: [[0, side * (Bk.y + 2.5)]] }, 20, 20), mats.paint);
      add(loft({ x0: F.x - 17, x1: F.x + 17, nTop: 2.4, nBot: 6, w: [[F.x - 17, 3], [F.x - 10, 7.5], [F.x + 9, 7.5], [F.x + 17, 3]], zb: [[0, wheelZF - 2]], zt: [[F.x - 17, wheelZF + 6], [F.x, wheelZF + F.radius + 3.5], [F.x + 17, wheelZF + 6]], yc: [[0, side * (F.y + 2)]] }, 20, 20), mats.paint);
    } else {
      for (const [W, len, wd] of [[Bk, 20, 10], [F, 16, 8]]) {
        const z0 = GROUND_Z + W.radius;
        add(loft({ x0: W.x - len, x1: W.x + len, nTop: 5, nBot: 5, w: [[0, wd]], zb: [[W.x - len, z0 + 2], [W.x, z0 + W.radius - 1], [W.x + len, z0 + 2]], zt: [[W.x - len, z0 + 7], [W.x, z0 + W.radius + 5], [W.x + len, z0 + 7]], yc: [[0, side * (W.y + 3)]] }, 16, 16), mats.accent);
      }
    }
    // side intake
    const intake = add(new THREE.BoxGeometry(20 * S, 7 * S, 3 * S), mats.dark);
    intake.position.set(-8 * S, 4 * S, -side * (interp(st.body.w, -8) - 0.5) * S);
    // headlight strip
    const hx = st.body.x1 - 9;
    const hl = add(new THREE.BoxGeometry(9 * S, 1.6 * S, 7 * S), mats.head);
    hl.position.set(hx * S, (interp(st.body.zt, hx) + interp(st.body.zb, hx)) * 0.5 * S + 1 * S, -side * (interp(st.body.w, hx) * 0.62) * S);
    hl.rotation.y = side * 0.35;
    hl.castShadow = false;
    // taillight
    const tx = st.body.x0 + 1.5;
    const tl = add(new THREE.BoxGeometry(1.5 * S, 2.4 * S, 14 * S), mats.tail);
    tl.position.set(tx * S, (interp(st.body.zt, tx) - 4) * S, -side * (interp(st.body.w, tx) * 0.55) * S);
    tl.castShadow = false;
  }
  // front splitter
  const spl = add(new THREE.BoxGeometry(10 * S, 1.5 * S, 56 * S), mats.accent);
  spl.position.set((st.body.x1 - 4) * S, (interp(st.body.zb, st.body.x1 - 4) + 1) * S, 0);
  // spoiler
  const sp = st.spoiler;
  const wing = add(loft({ x0: sp.x - sp.chord / 2, x1: sp.x + sp.chord / 2, nTop: 2, nBot: 3, w: [[0, sp.span / 2]], zb: [[sp.x - sp.chord / 2, sp.z - 0.6], [sp.x + sp.chord / 2, sp.z - 1.5]], zt: [[sp.x - sp.chord / 2, sp.z + 1.4], [sp.x, sp.z + 2.0], [sp.x + sp.chord / 2, sp.z - 0.8]] }, 10, 20), mats.accent);
  wing.castShadow = true;
  for (const side of [1, -1]) {
    const strut = add(new THREE.BoxGeometry(5 * S, (sp.z - 18) * S, 1.6 * S), mats.dark);
    strut.position.set((sp.x + 1) * S, ((sp.z + 18) / 2) * S, -side * sp.struts * S);
    const end = add(new THREE.BoxGeometry((sp.chord + 3) * S, 7 * S, 1 * S), mats.paint);
    end.position.set(sp.x * S, (sp.z - 1) * S, -side * (sp.span / 2) * S);
  }
  // boost nozzles
  const nozzles = [];
  const nozGeo = new THREE.CylinderGeometry(4.6 * S, 5.6 * S, 9 * S, detail ? 20 : 10, 1, true);
  nozGeo.rotateZ(Math.PI / 2);
  for (const side of [1, -1]) {
    const nz = add(nozGeo, mats.nozzle);
    const nx = st.body.x0 - 1;
    nz.position.set(nx * S, st.nozzleZ * S, -side * st.nozzleY * S);
    const glow = add(new THREE.CircleGeometry(4.2 * S, 16), mats.nozzleGlow);
    glow.position.set((nx + 2) * S, st.nozzleZ * S, -side * st.nozzleY * S);
    glow.rotation.y = -Math.PI / 2;
    glow.castShadow = false;
    nozzles.push(new THREE.Vector3((nx - 4.5) * S, st.nozzleZ * S, -side * st.nozzleY * S));
  }
  // antenna with a little topper
  const ant = add(new THREE.CylinderGeometry(0.35 * S, 0.35 * S, 22 * S, 5), mats.dark);
  ant.position.set(-30 * S, 34 * S, 16 * S);
  const top = add(new THREE.SphereGeometry(2.4 * S, 12, 8), mats.accent);
  top.position.set(-30 * S, 45 * S, 16 * S);

  // wheels: pivot (steer) -> spin -> mesh
  const wheels = [];
  for (const [i, W, width] of [[0, F, 10], [1, F, 10], [2, Bk, 13], [3, Bk, 13]]) {
    const side = i % 2 === 0 ? 1 : -1; // even = left (+y physics) = -z three
    const pivot = new THREE.Group();
    pivot.position.set(W.x * S, (GROUND_Z + W.radius) * S, -side * W.y * S);
    const spin = new THREE.Group();
    const wheel = makeWheel(W.radius, width, mats, detail);
    if (side < 0) wheel.rotation.y = Math.PI;
    spin.add(wheel);
    pivot.add(spin);
    root.add(pivot);
    wheels.push({ pivot, spin, radius: W.radius, baseY: pivot.position.y });
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: root, body, wheels, nozzles, materials: mats, style: st };
}
