// Builds the painted body shell, glass, arch lips and liners from a body definition.
import * as THREE from 'three';
import { BodyLoft, gridGeometry, SEGMENTS } from '../cad/body-loft.js';
import { buildSideMask, buildPlanMask, buildEndMask, maskTexture } from '../cad/body-masks.js';
import { SurfaceField } from '../cad/surface.js';
import { bodyUniforms, makePaintMaterial, makeGlassMaterial, makeBodyDepthMaterial, sharedMaterials } from '../render/materials.js';

export const ROW = (() => {
  // first row index of each segment
  const o = {}; let r = 0;
  for (const s of SEGMENTS) { o[s.key] = r; r += s.n; }
  o.bottom = r;
  return o;
})();

/**
 * @param def   body definition (cars/<id>/body.js)
 * @param opts  { zScale, offsetX (mm, puts the car origin mid-wheelbase), paint: {color, finish}, tint }
 */
export function buildBody(def, opts = {}) {
  const zScale = opts.zScale ?? 1;
  const offsetX = opts.offsetX ?? def.wheelbase / 2;
  const loft = new BodyLoft(def, { zScale });
  const deforms = [opts.deform, opts.front?.deform, opts.rear?.deform, opts.side?.deform].filter(Boolean);
  if (deforms.length) {
    loft.deform = (x, w, z, row) => {
      let cur = null;
      for (const d of deforms) { const r = d(x, cur ? cur[0] : w, cur ? cur[1] : z, row); if (r) cur = r; }
      return cur;
    };
  }
  const grid = loft.buildGrid();
  const field = new SurfaceField(loft, grid);
  const group = new THREE.Group();
  group.name = 'body';

  const masks = {
    sideL: maskTexture(buildSideMask(def, { zScale, side: 'left' })),
    sideR: maskTexture(buildSideMask(def, { zScale, side: 'right' })),
    plan: maskTexture(buildPlanMask(def)),
    front: maskTexture(buildEndMask(opts.front?.frontMask)),
    rear: maskTexture(buildEndMask(opts.rear?.rearMask)),
  };
  const arches = def.arches.map((a) => ({ x: a.x, z: a.z * zScale, r: a.r, innerW: 430 }));
  const uniforms = bodyUniforms({ ...masks, offsetX, arches });
  const paint = makePaintMaterial(uniforms, opts.paint || {});
  const M = sharedMaterials();

  // --- painted shell
  const shellGeo = gridGeometry(grid, { offsetX, creaseRows: [ROW.upper] });
  const shell = new THREE.Mesh(shellGeo, paint);
  shell.name = 'shell';
  shell.castShadow = true; shell.receiveShadow = true;
  shell.customDepthMaterial = makeBodyDepthMaterial(uniforms);
  group.add(shell);

  // --- glass: crown + glass rows over the greenhouse, pushed in 4 mm
  const s0 = grid.xs.findIndex((x) => x < -430), s1 = grid.xs.findIndex((x) => x < -3230);
  const glassGeo = gridGeometry(grid, {
    offsetX,
    filter: (s, r) => s >= s0 && s < s1 && r < ROW.ledge,
  });
  insetAlongNormals(glassGeo, 0.004);
  const glassMat = makeGlassMaterial(uniforms, { tint: opts.tint ?? 0.3 });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.name = 'glass';
  glass.renderOrder = 2;
  group.add(glass);

  // --- cabin: a dark inner shell so the windows show an interior, not the sky
  const cabinGeo = gridGeometry(grid, {
    offsetX,
    filter: (s, r) => s >= s0 - 4 && s < s1 + 4 && r < ROW.mid,
  });
  insetAlongNormals(cabinGeo, 0.045);
  const cabin = new THREE.Mesh(cabinGeo, new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.9, side: THREE.BackSide }));
  cabin.name = 'cabin';
  group.add(cabin);

  // --- arch lips and liners
  for (const a of arches) {
    const { lip, liner } = archGeometry(loft, a, offsetX);
    const lipMesh = new THREE.Mesh(lip, paint.userData.plain || (paint.userData.plain = plainPaint(paint)));
    lipMesh.castShadow = true; lipMesh.receiveShadow = true;
    lipMesh.name = 'archLip';
    group.add(lipMesh);
    const linerMesh = new THREE.Mesh(liner, M.liner);
    linerMesh.receiveShadow = true;
    linerMesh.name = 'archLiner';
    group.add(linerMesh);
  }

  // --- bumper parts (grilles, fogs, markers)
  for (const v of [opts.front, opts.rear, opts.side]) if (v?.features) group.add(v.features(field, offsetX, paint));

  return { group, loft, grid, field, uniforms, paint, glass: glassMat, masks, arches, offsetX };
}

/** A plain copy of the paint (no masks) for small painted parts. Kept in sync by syncPlain(). */
export function plainPaint(paint) {
  const m = new THREE.MeshPhysicalMaterial();
  syncPlain(paint, m);
  return m;
}
export function syncPlain(paint, m) {
  for (const k of ['metalness', 'roughness', 'clearcoat', 'clearcoatRoughness', 'iridescence', 'iridescenceIOR', 'normalMap', 'envMapIntensity']) m[k] = paint[k];
  if (paint.normalScale) m.normalScale = paint.normalScale.clone();
  m.color.copy(paint.color);
  m.needsUpdate = true;
}

function insetAlongNormals(geo, d) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) - n.getX(i) * d, p.getY(i) - n.getY(i) * d, p.getZ(i) - n.getZ(i) * d);
  }
  p.needsUpdate = true;
  geo.computeBoundingSphere();
}

/**
 * Rolled fender lip following the arch circle on the body surface, plus a
 * wheel-well liner (partial cylinder with an inner wall).
 */
function archGeometry(loft, arch, offsetX) {
  const { x: ax, z: az, r, innerW } = arch;
  // find the angular range where the circle is on the body (above its bottom edge)
  const N = 90;
  const samples = [];
  for (let i = 0; i <= N; i++) {
    const phi = -Math.PI * 0.62 + (Math.PI * 1.24 * i) / N; // around the top of the arch
    const x = ax + r * Math.sin(phi), z = az + r * Math.cos(phi);
    const zb = loft.zBot(x);
    if (z < zb + 4) continue;
    const w = loft.widthAt(x, z);
    if (w < innerW + 40) continue;
    samples.push({ phi, x, z, w });
  }
  // lip profile in (radial offset, inward offset) mm
  const prof = [[0, 0], [2.5, -2], [5, -6], [7, -12], [8.5, -22], [9.5, -34]];
  const pos = [], idx = [];
  const toM = (x, y, zl) => [(x + offsetX) / 1000, y / 1000, zl / 1000];
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (const s of samples) {
      for (const [dr, dw] of prof) {
        const rr = r + dr;
        const x = ax + rr * Math.sin(s.phi), z = az + rr * Math.cos(s.phi);
        pos.push(...toM(x, z, side * (s.w + dw)));
      }
    }
    const P = prof.length;
    for (let i = 0; i < samples.length - 1; i++) for (let j = 0; j < P - 1; j++) {
      const a = base + i * P + j, b = base + (i + 1) * P + j, c = a + 1, d = b + 1;
      if (side > 0) idx.push(a, b, c, c, b, d); else idx.push(a, c, b, c, d, b);
    }
  }
  const lip = new THREE.BufferGeometry();
  lip.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  lip.setIndex(idx);
  lip.computeVertexNormals();

  // liner: cylinder of radius r+10 between innerW and the lip, and an inner wall disc
  const lp = [], li = [];
  const rr = r + 10;
  for (const side of [1, -1]) {
    const base = lp.length / 3;
    for (const s of samples) {
      const x = ax + rr * Math.sin(s.phi), z = az + rr * Math.cos(s.phi);
      lp.push(...toM(x, z, side * (s.w - 30)), ...toM(x, z, side * innerW));
    }
    for (let i = 0; i < samples.length - 1; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      li.push(a, c, b, b, c, d);
    }
    // inner wall fan
    const cIdx = lp.length / 3;
    lp.push(...toM(ax, az - 60, side * innerW));
    for (let i = 0; i < samples.length - 1; i++) li.push(cIdx, base + i * 2 + 1, base + (i + 1) * 2 + 1);
  }
  const liner = new THREE.BufferGeometry();
  liner.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  liner.setIndex(li);
  liner.computeVertexNormals();
  return { lip, liner };
}
