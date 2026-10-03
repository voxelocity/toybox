// Exports SoccerRocket's arena collision mesh (public/js/physics/arena.js) to
// RocketSim's .cmf collision-mesh format so RocketSim simulates our arena.
//
//   node tools/rocketsim/export-cmf.mjs [outDir]   (default .build/meshes/soccar)
//
// .cmf layout (src/CollisionMeshFile/CollisionMeshFile.cpp, little endian):
//   int32 numTris, int32 numVerts, numTris x int32[3], numVerts x float32[3]
//
// Units: RocketSim feeds .cmf vertices straight into a btTriangleMesh
// (CollisionMeshFile::MakeBulletMesh) and adds the shape at the origin with no
// scaling (Arena::_SetupArenaCollisionShapes), so vertices are in Bullet units:
// 1 BT = 50 uu (BulletLink.h BT_TO_UU). We divide uu by 50.
//
// Static planes: for SOCCAR RocketSim always adds its own infinite planes
// (Arena.cpp, "Add arena collision planes"): floor z=0 (+z), ceiling z=2048
// (-z) and side walls x=-4096 (+x) / x=+4096 (-x). Coplanar duplicates would
// double the contacts, so we drop our floor / goal floor (z=0) and the flat
// side-wall triangles lying on x=+-4096. Our ceiling sits at z=2044, in front
// of RocketSim's 2048 plane, so it is kept (the plane is never reached).
// Back walls (y=+-5120), corners, ramps, goals are only in the mesh.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArenaSurfaces } from '../../public/js/physics/arena.js';
import { ARENA } from '../../public/js/physics/constants.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.argv[2] || path.join(HERE, '.build/meshes/soccar'));
const UU_TO_BT = 1 / 50;
const EPS = 0.01;

// Same tessellation as getCollisionMesh() in arena.js.
const surfaces = buildArenaSurfaces({ filletSteps: 16, arcSteps: 6, maxSeg: 1024 });

const verts = [];
const vmap = new Map();
const tris = [];
const stats = { kept: 0, droppedFloor: 0, droppedSideWall: 0 };
const weld = (x, y, z) => {
  const k = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
  let i = vmap.get(k);
  if (i === undefined) { i = verts.length / 3; verts.push(x, y, z); vmap.set(k, i); }
  return i;
};

for (const s of surfaces) {
  const p = s.positions, id = s.indices;
  if (s.tag === 'floor' || s.tag === 'goalfloor') { stats.droppedFloor += id.length / 3; continue; }
  for (let i = 0; i < id.length; i += 3) {
    const v = [id[i], id[i + 1], id[i + 2]].map((k) => [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]]);
    const onSide = (sx) => v.every((q) => Math.abs(q[0] - sx * ARENA.X) < EPS);
    if (onSide(1) || onSide(-1)) { stats.droppedSideWall++; continue; }
    const onFloor = v.every((q) => Math.abs(q[2]) < EPS);
    if (onFloor) { stats.droppedFloor++; continue; }
    tris.push(weld(...v[0]), weld(...v[1]), weld(...v[2]));
    stats.kept++;
  }
}

// Optional spatial split into chunks (CHUNK=<uu cell size>), like the game's
// 16 separate arena meshes. Default: one mesh (exact internal-edge info).
const CHUNK = +(process.env.CHUNK || 0);
const groups = new Map();
for (let i = 0; i < tris.length; i += 3) {
  let key = 'all';
  if (CHUNK > 0) {
    const c = [0, 1, 2].map((a) => (verts[tris[i] * 3 + a] + verts[tris[i + 1] * 3 + a] + verts[tris[i + 2] * 3 + a]) / 3);
    key = `${Math.floor(c[0] / CHUNK)},${Math.floor(c[1] / CHUNK)},${Math.floor(c[2] / CHUNK)}`;
  }
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(tris[i], tris[i + 1], tris[i + 2]);
}

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) if (f.endsWith('.cmf')) fs.unlinkSync(path.join(outDir, f));
let gi = 0, totalT = 0;
for (const gt of groups.values()) {
  const remap = new Map(), gv = [];
  const idx = gt.map((v) => { if (!remap.has(v)) { remap.set(v, gv.length / 3); gv.push(verts[v * 3], verts[v * 3 + 1], verts[v * 3 + 2]); } return remap.get(v); });
  const nt = idx.length / 3, nv = gv.length / 3;
  const buf = Buffer.alloc(8 + nt * 12 + nv * 12);
  let o = 0;
  buf.writeInt32LE(nt, o); o += 4;
  buf.writeInt32LE(nv, o); o += 4;
  for (const t of idx) { buf.writeInt32LE(t, o); o += 4; }
  for (const c of gv) { buf.writeFloatLE(c * UU_TO_BT, o); o += 4; }
  const name = groups.size === 1 ? 'soccerrocket_arena.cmf' : `soccerrocket_arena_${String(gi).padStart(3, '0')}.cmf`;
  fs.writeFileSync(path.join(outDir, name), buf);
  gi++; totalT += nt;
}
console.error(`[export-cmf] ${outDir}: ${totalT} tris, ${verts.length / 3} verts in ${groups.size} mesh file(s) (dropped ${stats.droppedFloor} floor, ${stats.droppedSideWall} side-wall tris covered by RocketSim planes)`);
