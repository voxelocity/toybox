// Draw-call compaction for imported models.
//
// Exporters (FBX especially) split a mesh into hundreds of material groups,
// one per run of faces, and every group is a separate draw call - drawn again
// in the shadow pass. The player's Fennec comes in as 5 meshes with 249
// groups but only 7 materials: ~500 draws per car per frame, ~3000 in a 3v3.
// Reordering the triangles so each material is one contiguous range keeps
// the picture identical and costs one draw per material.
import * as THREE from 'three';

/** Compacts the material groups of every mesh under root (geometries are changed in place, once). */
export function compactDrawGroups(root) {
  root.traverse((o) => { if (o.isMesh && Array.isArray(o.material)) compactGeometry(o.geometry); });
}

function compactGeometry(geo) {
  const groups = geo.groups;
  if (geo.userData.compacted || !groups || groups.length < 2) return;
  geo.userData.compacted = true;
  if (Object.keys(geo.morphAttributes).length) return;
  for (const k in geo.attributes) if (geo.attributes[k].isInterleavedBufferAttribute) return;
  const byMat = new Map();
  for (const g of groups) {
    if (!byMat.has(g.materialIndex)) byMat.set(g.materialIndex, []);
    byMat.get(g.materialIndex).push(g);
  }
  if (byMat.size === groups.length) return;
  // element order: all ranges of material 0, then material 1, ...
  let total = 0;
  for (const g of groups) total += g.count;
  const order = new Uint32Array(total), out = [];
  let n = 0;
  for (const [materialIndex, list] of byMat) {
    const start = n;
    for (const g of list) for (let i = g.start, e = g.start + g.count; i < e; i++) order[n++] = i;
    out.push({ start, count: n - start, materialIndex });
  }
  if (geo.index) {
    const src = geo.index.array, dst = new src.constructor(total);
    for (let i = 0; i < total; i++) dst[i] = src[order[i]];
    geo.setIndex(new THREE.BufferAttribute(dst, 1));
  } else {
    // non-indexed: groups address vertices, so reorder every attribute
    for (const k of Object.keys(geo.attributes)) {
      const a = geo.attributes[k], s = a.itemSize, src = a.array, dst = new src.constructor(total * s);
      for (let i = 0; i < total; i++) for (let c = 0; c < s; c++) dst[i * s + c] = src[order[i] * s + c];
      geo.setAttribute(k, new THREE.BufferAttribute(dst, s, a.normalized));
    }
  }
  geo.clearGroups();
  for (const g of out) geo.addGroup(g.start, g.count, g.materialIndex);
  if (geo.boundingSphere) geo.computeBoundingSphere();
  if (geo.boundingBox) geo.computeBoundingBox();
}
