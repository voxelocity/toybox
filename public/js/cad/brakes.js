// Brake rotor and caliper CAD. Wheel frame: axle +Z outboard, z = 0 hub face, mm.
import * as THREE from 'three';

const TAU = Math.PI * 2;

const rotorTexCache = new Map();
function rotorFaceTexture(kind) {
  if (rotorTexCache.has(kind)) return rotorTexCache.get(kind);
  const n = 512, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), cx = n / 2;
  g.fillStyle = '#8d8f92'; g.fillRect(0, 0, n, n);
  // machining rings
  for (let i = 0; i < 120; i++) {
    g.strokeStyle = `rgba(${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},0.06)`;
    g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cx, cx * (0.35 + 0.65 * i / 120), 0, TAU); g.stroke();
  }
  if (kind === 'slotted' || kind === 'drilled') {
    g.strokeStyle = 'rgba(20,20,20,0.85)'; g.fillStyle = 'rgba(15,15,15,0.9)';
    const count = kind === 'slotted' ? 12 : 36;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU;
      if (kind === 'slotted') {
        g.lineWidth = 5; g.beginPath();
        const r0 = cx * 0.62, r1 = cx * 0.95;
        g.moveTo(cx + r0 * Math.cos(a), cx + r0 * Math.sin(a));
        g.lineTo(cx + r1 * Math.cos(a + 0.22), cx + r1 * Math.sin(a + 0.22)); g.stroke();
      } else {
        for (const rr of [0.66, 0.78, 0.9]) { g.beginPath(); g.arc(cx + cx * rr * Math.cos(a + rr), cx + cx * rr * Math.sin(a + rr), 5, 0, TAU); g.fill(); }
      }
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  rotorTexCache.set(kind, t);
  return t;
}

/**
 * @param o { rotorD, rotorT, vented, face: 'plain'|'slotted'|'drilled', twoPiece, caliper: {type:'floating'|'fixed', pistons, color, width}, position (radians, 0 = forward), zRotor (mm) }
 */
export function buildBrake(o) {
  const g = new THREE.Group();
  g.name = 'brake';
  const R = o.rotorD / 2, T = o.rotorT;
  const z0 = o.zRotor ?? -38; // rotor mid-plane relative to hub face
  const faceMat = new THREE.MeshStandardMaterial({ map: rotorFaceTexture(o.face || 'plain'), metalness: 0.85, roughness: 0.42 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x4a4b4d, metalness: 0.7, roughness: 0.6 });
  // rotor ring (friction faces) as a lathe with an inner radius
  const inner = o.twoPiece ? R * 0.58 : R * 0.52;
  const ring = new THREE.RingGeometry(inner, R, 72, 1);
  const uv = ring.attributes.uv, pos = ring.attributes.position;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (2 * R) + 0.5, pos.getY(i) / (2 * R) + 0.5);
  const front = new THREE.Mesh(ring, faceMat); front.position.z = z0 + T / 2; g.add(front);
  const back = new THREE.Mesh(ring.clone(), faceMat); back.rotation.y = Math.PI; back.position.z = z0 - T / 2; g.add(back);
  const edge = new THREE.CylinderGeometry(R, R, T, 72, 1, true); edge.rotateX(Math.PI / 2);
  const edgeMesh = new THREE.Mesh(edge, edgeMat); edgeMesh.position.z = z0; g.add(edgeMesh);
  if (o.vented) {
    // dark gap between the two friction plates, visible at the edge
    const gap = new THREE.CylinderGeometry(R - 0.5, R - 0.5, T * 0.45, 72, 1, true); gap.rotateX(Math.PI / 2);
    const gm = new THREE.Mesh(gap, new THREE.MeshBasicMaterial({ color: 0x0d0d0d }));
    gm.position.z = z0; g.add(gm);
  }
  // hat (steel on OE, anodised alloy on two-piece)
  const hatMat = o.twoPiece
    ? new THREE.MeshStandardMaterial({ color: 0x2a2b2e, metalness: 0.6, roughness: 0.35 })
    : new THREE.MeshStandardMaterial({ color: 0x5e6064, metalness: 0.6, roughness: 0.55 });
  const hatProfile = [[40, 2], [inner + 2, 2], [inner + 4, 0], [inner + 4, z0 + T / 2 - 2], [inner, z0], [inner - 6, z0], [inner - 6, -2], [40, -2]];
  const hat = new THREE.LatheGeometry(hatProfile.map(([r, z]) => new THREE.Vector2(r, z)), 48); hat.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(hat, hatMat));

  // caliper
  const c = o.caliper || { type: 'floating', pistons: 1, color: '#3a3a3a' };
  g.add(buildCaliper(c, R, T, z0, o.position ?? 0));
  g.scale.setScalar(0.001);
  g.userData = { R, z0 };
  return g;
}

function annularSector(r0, r1, a0, a1, round = 8) {
  const s = new THREE.Shape();
  const n = 24;
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; const p = [r1 * Math.cos(a), r1 * Math.sin(a)]; i ? s.lineTo(...p) : s.moveTo(...p); }
  for (let i = n; i >= 0; i--) { const a = a0 + (a1 - a0) * i / n; s.lineTo(r0 * Math.cos(a), r0 * Math.sin(a)); }
  s.closePath();
  return s;
}

function buildCaliper(c, R, T, z0, angle) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({ color: c.color || '#3a3a3a', metalness: c.type === 'fixed' ? 0.2 : 0.45, roughness: c.type === 'fixed' ? 0.25 : 0.55, clearcoat: c.type === 'fixed' ? 1 : 0.2 });
  const pistons = c.pistons || 1;
  const span = c.type === 'fixed' ? (pistons >= 6 ? 1.2 : 0.98) * (180 / (R * 1.0)) * 0.9 : 0.72; // radians
  const a0 = angle - span / 2, a1 = angle + span / 2;
  const pad = c.type === 'fixed' ? 14 : 10;
  const bevel = { bevelEnabled: true, bevelThickness: 5, bevelSize: 5, bevelSegments: 3, curveSegments: 16 };
  if (c.type === 'fixed') {
    // two halves either side of the rotor plus a bridge over the edge
    const halfT = 22 + pistons * 1.5;
    const outer = new THREE.ExtrudeGeometry(annularSector(R - 44, R + pad, a0, a1), { depth: halfT, ...bevel });
    const mo = new THREE.Mesh(outer, mat); mo.position.z = z0 + T / 2 + 4; grp.add(mo);
    const innerG = new THREE.ExtrudeGeometry(annularSector(R - 40, R + pad, a0, a1), { depth: halfT, ...bevel });
    const mi = new THREE.Mesh(innerG, mat); mi.position.z = z0 - T / 2 - 4 - halfT; grp.add(mi);
    const bridge = new THREE.ExtrudeGeometry(annularSector(R + 3, R + pad + 2, a0 + 0.06, a1 - 0.06), { depth: T + 12, ...bevel });
    const mb = new THREE.Mesh(bridge, mat); mb.position.z = z0 - T / 2 - 6; grp.add(mb);
    // bridge window
    const win = new THREE.ExtrudeGeometry(annularSector(R + 2, R + pad - 4, a0 + span * 0.25, a1 - span * 0.25), { depth: 2, bevelEnabled: false });
    const mw = new THREE.Mesh(win, new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 }));
    mw.position.z = z0 + T / 2 + halfT + 4 + 5.2; grp.add(mw);
    grp.userData.outerZ = z0 + T / 2 + 4 + halfT + 5;
  } else {
    // floating: single piston body on the inboard side, fingers outboard, carrier behind
    const body = new THREE.ExtrudeGeometry(annularSector(R - 36, R + pad, a0, a1), { depth: 40, ...bevel });
    const mb = new THREE.Mesh(body, mat); mb.position.z = z0 - T / 2 - 44; grp.add(mb);
    const fingers = new THREE.ExtrudeGeometry(annularSector(R - 30, R + pad, a0 + 0.08, a1 - 0.08), { depth: 12, ...bevel });
    const mf = new THREE.Mesh(fingers, mat); mf.position.z = z0 + T / 2 + 3; grp.add(mf);
    const bridge = new THREE.ExtrudeGeometry(annularSector(R + 2, R + pad + 1, a0 + 0.1, a1 - 0.1), { depth: T + 14, ...bevel });
    const mbr = new THREE.Mesh(bridge, mat); mbr.position.z = z0 - T / 2 - 6; grp.add(mbr);
    grp.userData.outerZ = z0 + T / 2 + 3 + 12 + 5;
  }
  grp.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return grp;
}
