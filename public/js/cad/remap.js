// Re-map a geometry's positions/normals through an axis permutation plus
// optional per-vertex position tweak; flips triangle winding when the map is
// a reflection so faces keep pointing outward.
import * as THREE from 'three';

/**
 * @param geo    BufferGeometry (indexed or not)
 * @param axes   [ix, iy, iz, sx, sy, sz]: output axis k takes input axis axes[k] times sign s_k
 * @param tweak  optional (out: [x,y,z], in: [x,y,z]) => void  (mutates out; for small shears)
 * @param scale  multiply positions (e.g. 0.001 for mm -> m)
 * @param offset [x,y,z] added after scaling
 */
export function remapGeometry(geo, axes, { tweak = null, scale = 1, offset = [0, 0, 0] } = {}) {
  const [ix, iy, iz, sx, sy, sz] = axes;
  const p = geo.attributes.position, n = geo.attributes.normal;
  const inp = [0, 0, 0], out = [0, 0, 0];
  for (let i = 0; i < p.count; i++) {
    inp[0] = p.getX(i); inp[1] = p.getY(i); inp[2] = p.getZ(i);
    out[0] = inp[ix] * sx; out[1] = inp[iy] * sy; out[2] = inp[iz] * sz;
    if (tweak) tweak(out, inp);
    p.setXYZ(i, out[0] * scale + offset[0], out[1] * scale + offset[1], out[2] * scale + offset[2]);
    if (n) {
      const a = [n.getX(i), n.getY(i), n.getZ(i)];
      n.setXYZ(i, a[ix] * sx, a[iy] * sy, a[iz] * sz);
    }
  }
  // determinant of the signed permutation
  const perm = [ix, iy, iz];
  let inversions = 0;
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) if (perm[a] > perm[b]) inversions++;
  const det = (inversions % 2 ? -1 : 1) * sx * sy * sz;
  if (det < 0) flipWinding(geo);
  p.needsUpdate = true;
  if (n) n.needsUpdate = true;
  geo.computeBoundingSphere();
  return geo;
}

export function flipWinding(geo) {
  if (geo.index) {
    const a = geo.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    geo.index.needsUpdate = true;
  } else {
    for (const name of Object.keys(geo.attributes)) {
      const attr = geo.attributes[name], s = attr.itemSize, arr = attr.array;
      for (let i = 0; i < attr.count; i += 3) {
        for (let k = 0; k < s; k++) { const t = arr[(i + 1) * s + k]; arr[(i + 1) * s + k] = arr[(i + 2) * s + k]; arr[(i + 2) * s + k] = t; }
      }
      attr.needsUpdate = true;
    }
  }
}

export { THREE };
