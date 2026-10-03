// Loads the player's own car / ball models (FBX, glTF/GLB or OBJ) from the
// project's assets/ folder (served by server.js) or public/assets/models/.
//
// - Textures are resolved by file name wherever they live in the folder,
//   whatever absolute path the exporter baked into the file.
// - Materials that came without a colour map get one matched by name
//   (e.g. "Fennec Chassis" -> *chassis*.png, "Alpha Rim" -> *alpha*.png).
// - Swizzled (DXT5nm style, X in alpha) normal maps are converted.
// - The car is oriented from its wheel names (FL/FR/BL/BR), scaled so its
//   wheelbase matches the physics car and placed so its wheels sit exactly
//   on the simulated wheels; wheels become separate spinning/steering pivots.
// - Optional assets/soccerrocket.json can override any of the guesses:
//   { "car": "Fennec.fbx", "ball": "rocket_ball.fbx",
//     "textures": { "<material name>": "file.png" }, "carShadow": "x.png",
//     "ballShadow": "y.png", "mirror": false, "yaw": 0, "offset": [0,0,0],
//     "paintMaterials": ["Paint"], "nozzles": [[x,y,z],...] }
import * as THREE from 'three';
import { CAR_PRESETS, BALL_RADIUS } from '../physics/constants.js';
import { S } from './convert.js';

const P = CAR_PRESETS.octane;
const GROUND_Z = -17;
const NORMAL_RE = /(_n|_nrm|_norm|normal|normalmap)(\.|_|$)/i;

let loaders = null;
async function getLoaders(manager) {
  if (!loaders) {
    const [{ FBXLoader }, { GLTFLoader }, { OBJLoader }, { DRACOLoader }, { MeshoptDecoder }, { TGALoader }] = await Promise.all([
      import('three/addons/loaders/FBXLoader.js'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/loaders/OBJLoader.js'),
      import('three/addons/loaders/DRACOLoader.js'), import('three/addons/libs/meshopt_decoder.module.js'), import('three/addons/loaders/TGALoader.js'),
    ]);
    loaders = { FBXLoader, GLTFLoader, OBJLoader, DRACOLoader, MeshoptDecoder, TGALoader };
  }
  manager.addHandler(/\.tga$/i, new loaders.TGALoader(manager));
  return loaders;
}

const baseName = (u) => decodeURIComponent(String(u).split(/[\\/]/).pop().split('?')[0]).toLowerCase();
const stem = (n) => n.replace(/\.[a-z0-9]+$/i, '');

async function listAssets() {
  try {
    const r = await fetch('api/models', { cache: 'no-cache' });
    if (r.ok) { const j = await r.json(); if (j && j.models) return j; }
  } catch { /* static hosting */ }
  // static hosting: probe a few conventional names
  const models = [];
  for (const n of ['fennec.fbx', 'Fennec.fbx', 'car.glb', 'car.fbx', 'fennec.glb', 'rocket_ball.fbx', 'ball.glb', 'ball.fbx']) {
    try { const r = await fetch('assets/models/' + n, { method: 'HEAD' }); if (r.ok) models.push({ url: 'assets/models/' + n, name: n }); } catch { /* ignore */ }
  }
  return { models, images: [] };
}

async function loadConfig(list) {
  // the server says where the config is (or that there is none); static hosting has to probe
  if ('config' in list) {
    if (!list.config) return {};
    try { const r = await fetch(list.config, { cache: 'no-cache' }); if (r.ok) return await r.json(); } catch (e) { console.warn('[assets] bad soccerrocket.json', e); }
    return {};
  }
  for (const base of ['project-assets/', 'assets/models/']) {
    try { const r = await fetch(base + 'soccerrocket.json', { cache: 'no-cache' }); if (r.ok) return await r.json(); } catch { /* none */ }
  }
  return {};
}

function makeManager(images, report) {
  const byName = new Map(), byStem = new Map();
  for (const im of images) { byName.set(im.name.toLowerCase(), im.url); byStem.set(stem(im.name.toLowerCase()), im.url); }
  const mgr = new THREE.LoadingManager();
  mgr.setURLModifier((url) => {
    if (/^(blob:|data:)/.test(url)) return url;
    const b = baseName(url);
    if (/\.(fbx|glb|gltf|obj|mtl|bin)$/i.test(b)) return url;
    const hit = byName.get(b) || byStem.get(stem(b));
    if (hit) { report.found.push(b); return hit; }
    report.missing.push(b);
    return url;
  });
  return mgr;
}

/** Decide which image best fits a material by keyword overlap. */
function matchImage(images, keywords, exclude = []) {
  let best = null, bestScore = 0;
  for (const im of images) {
    const n = im.name.toLowerCase();
    if (NORMAL_RE.test(n) || /shadow|_ao|_rough|_spec|_mask|_e\.|emiss/.test(n) || exclude.includes(im.url)) continue;
    let s = 0;
    for (const k of keywords) if (n.includes(k)) s += k.length;
    if (s === 0) continue; // needs at least one keyword in common
    if (/(_d|_diff|_diffuse|_albedo|_basecolor|_col|_color|_c)\./.test(n)) s += 1;
    if (s > bestScore) { bestScore = s; best = im; }
  }
  return best;
}

function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = rej; im.src = url; });
}

function downscale(img, max) {
  const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
  if (!max || Math.max(w, h) <= max) return img;
  const k = max / Math.max(w, h), c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** Converts DXT5nm-style normal maps (X in alpha, Y in green) to RGB normals. */
function fixNormalImage(img) {
  const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h), p = d.data;
  let r = 0, b = 0, a = 0, n = 0;
  for (let i = 0; i < p.length; i += 4 * 97) { r += p[i]; b += p[i + 2]; a += p[i + 3]; n++; }
  r /= n; b /= n; a /= n;
  if (!(r > 215 && b > 215 && a > 60 && a < 200)) return img; // already a standard map
  for (let i = 0; i < p.length; i += 4) {
    const x = p[i + 3] / 127.5 - 1, y = p[i + 1] / 127.5 - 1;
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    p[i] = (x * 0.5 + 0.5) * 255; p[i + 2] = (z * 0.5 + 0.5) * 255; p[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  return c;
}

function texFrom(img, srgb) {
  const t = img instanceof HTMLCanvasElement ? new THREE.CanvasTexture(img) : new THREE.Texture(img);
  t.needsUpdate = true;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.flipY = img instanceof HTMLCanvasElement ? true : true;
  return t;
}

async function loadModel(entry, images, report, quality) {
  const mgr = makeManager(images, report);
  const L = await getLoaders(mgr);
  const url = entry.url;
  const ext = url.split('.').pop().toLowerCase();
  const dir = url.slice(0, url.lastIndexOf('/') + 1);
  let root;
  if (ext === 'fbx') {
    const loader = new L.FBXLoader(mgr);
    loader.setResourcePath(dir);
    root = await loader.loadAsync(url);
  } else if (ext === 'glb' || ext === 'gltf') {
    const loader = new L.GLTFLoader(mgr);
    const draco = new L.DRACOLoader(mgr);
    draco.setDecoderPath('vendor/three/addons/libs/draco/');
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(L.MeshoptDecoder);
    root = (await loader.loadAsync(url)).scene;
  } else {
    root = await new L.OBJLoader(mgr).loadAsync(url);
  }
  // wait for textures referenced by the file
  await new Promise((res) => { if (!mgr.itemsLoaded || mgr.itemsLoaded >= mgr.itemsTotal) setTimeout(res, 50); mgr.onLoad = () => res(); setTimeout(res, 15000); });
  root.traverse((o) => { if (o.isLight || o.isCamera) o.removeFromParent(); });
  return root;
}

/** Upgrade a loaded material to PBR and sanitise its maps. */
function toStandard(m, kind, physical) {
  const map = m.map && m.map.image ? m.map : null;
  const normalMap = m.normalMap && m.normalMap.image ? m.normalMap : null;
  const base = { name: m.name, map, normalMap, side: m.side, transparent: m.transparent && m.opacity < 1, opacity: m.opacity };
  let mat;
  if (!physical) {
    mat = new THREE.MeshLambertMaterial({ name: m.name, map, color: map ? 0xffffff : (m.color || new THREE.Color(0x888888)), side: m.side });
  } else if (kind === 'paint') {
    mat = new THREE.MeshPhysicalMaterial({ ...base, color: 0xffffff, metalness: 0.25, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  } else if (kind === 'glass') {
    mat = new THREE.MeshPhysicalMaterial({ ...base, color: 0x0b0f16, metalness: 0.3, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.06 });
  } else if (kind === 'light') {
    mat = new THREE.MeshStandardMaterial({ ...base, color: 0xffffff, emissive: new THREE.Color(1.1, 1.1, 1.05), roughness: 0.2 });
  } else if (kind === 'rim') {
    mat = new THREE.MeshStandardMaterial({ ...base, color: 0xffffff, metalness: 0.75, roughness: 0.32 });
  } else if (kind === 'tire') {
    mat = new THREE.MeshStandardMaterial({ ...base, color: map ? 0xffffff : 0x1b1b1d, metalness: 0, roughness: 0.88 });
  } else {
    const col = map ? new THREE.Color(0xffffff) : (m.color ? m.color.clone() : new THREE.Color(0x808080));
    mat = new THREE.MeshStandardMaterial({ ...base, color: col, metalness: 0.35, roughness: 0.5 });
  }
  if (mat.normalMap) mat.normalScale = new THREE.Vector2(1, -1); // DirectX-style maps from Unreal
  if (map) map.colorSpace = THREE.SRGBColorSpace;
  return mat;
}

function classify(name) {
  const n = name.toLowerCase();
  if (/paint|^body$|- body/.test(n)) return 'paint';
  if (/window|glass|windscreen|windshield/.test(n)) return 'glass';
  if (/headlight|light|lamp|emiss/.test(n)) return 'light';
  if (/rim|wheel|hub/.test(n)) return 'rim';
  if (/tread|tire|tyre|rubber/.test(n)) return 'tire';
  return 'other';
}

// ---------------------------------------------------------------------------
export async function loadCustomAssets(quality, onProgress) {
  const out = { car: null, ball: null, carShadow: null, ballShadow: null, report: { found: [], missing: [], assigned: {} } };
  let list;
  try { list = await listAssets(); } catch { return out; }
  if (!list.models.length && !list.images.length) return out;
  const cfg = await loadConfig(list);
  const images = list.images || [];
  const byFile = (n) => n && (list.models.find((m) => m.name.toLowerCase() === String(n).toLowerCase()) || images.find((m) => m.name.toLowerCase() === String(n).toLowerCase()));
  const carEntry = byFile(cfg.car) || list.models.find((m) => !/ball/i.test(m.name));
  const ballEntry = byFile(cfg.ball) || list.models.find((m) => /ball/i.test(m.name));
  const maxTex = quality.physicalMaterials ? (quality.stadiumDetail >= 2 ? 4096 : 2048) : 1024;
  const physical = quality.physicalMaterials;
  const used = [];

  // shadows
  const shadowImgs = images.filter((i) => /shadow/i.test(i.name));
  const carShadowImg = byFile(cfg.carShadow) || shadowImgs.find((i) => !/ball/i.test(i.name));
  const ballShadowImg = byFile(cfg.ballShadow) || shadowImgs.find((i) => /ball/i.test(i.name));
  try { if (carShadowImg) out.carShadow = texFrom(downscale(await loadImage(carShadowImg.url), 512), false); } catch { /* ignore */ }
  try { if (ballShadowImg) out.ballShadow = texFrom(downscale(await loadImage(ballShadowImg.url), 512), false); } catch { /* ignore */ }

  if (carEntry) {
    try {
      onProgress && onProgress(0.1, `Loading ${carEntry.name}…`);
      const root = await loadModel(carEntry, images, out.report, quality);
      onProgress && onProgress(0.6, 'Preparing car textures…');
      out.car = await prepareCar(root, images, cfg, out.report, { maxTex, physical, used });
      out.car.name = carEntry.name.replace(/\.[^.]+$/, '');
    } catch (e) { console.warn('custom car failed to load', e); out.report.error = String(e); }
  }
  if (ballEntry) {
    try {
      onProgress && onProgress(0.8, `Loading ${ballEntry.name}…`);
      const root = await loadModel(ballEntry, images, out.report, quality);
      out.ball = await prepareBall(root, images, cfg, { maxTex, physical });
    } catch (e) { console.warn('custom ball failed to load', e); }
  }
  console.info('[assets]', JSON.stringify({ car: carEntry && carEntry.name, ball: ballEntry && ballEntry.name, textures: out.report.assigned, missing: [...new Set(out.report.missing)] }));
  return out;
}

async function assignTextures(meshes, images, cfg, report, opts) {
  const mats = new Map();
  for (const m of meshes) for (const mat of [].concat(m.material)) mats.set(mat.name || mat.uuid, mat);
  for (const [name, mat] of mats) {
    // explicit mapping wins
    const want = cfg.textures && cfg.textures[name];
    let img = want ? images.find((i) => i.name.toLowerCase() === String(want).toLowerCase()) : null;
    if (!img && !(mat.map && mat.map.image)) {
      const words = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !['the', 'mat', 'material'].includes(w));
      // reuse the stem of the normal map the file references (e.g. Alpha_N -> alpha)
      if (mat.normalMap && mat.normalMap.name) words.push(...mat.normalMap.name.toLowerCase().replace(/(_n|normal).*$/, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2));
      if (words.length) img = matchImage(images, [...new Set(words)], []);
      if (img && classify(name) === 'paint') img = null; // paint stays a flat team colour unless mapped explicitly
    }
    if (img) {
      try {
        const im = await loadImage(img.url);
        if (mat.map) mat.map.dispose();
        mat.map = texFrom(downscale(im, opts.maxTex), true);
        report.assigned[name] = img.name;
      } catch { /* missing */ }
    }
    if (mat.map && !mat.map.image) mat.map = null;
    if (mat.normalMap) {
      if (!mat.normalMap.image) mat.normalMap = null;
      else {
        const fixed = fixNormalImage(downscale(mat.normalMap.image, opts.maxTex));
        if (fixed !== mat.normalMap.image) { mat.normalMap = texFrom(fixed, false); }
        report.assigned[name + ' (normal)'] = 'ok';
      }
    }
  }
}

async function prepareCar(root, images, cfg, report, opts) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  await assignTextures(meshes, images, cfg, report, opts);

  // wheels by name
  const wheelRe = /(^|[^a-z])(fl|fr|bl|br|rl|rr)([^a-z]|$)|front.?left|front.?right|rear.?left|rear.?right|back.?left|back.?right/i;
  const wheels = meshes.filter((m) => wheelRe.test(m.name) || /wheel|tire|tyre/i.test(m.name));
  const centre = (o) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  const body = meshes.filter((m) => !wheels.includes(m));
  const bb = new THREE.Box3();
  for (const m of body.length ? body : meshes) bb.expandByObject(m);
  const size = bb.getSize(new THREE.Vector3());

  // frame from wheel layout, else longest horizontal axis
  let fwd = new THREE.Vector3(1, 0, 0), left = new THREE.Vector3(0, 0, -1);
  const tag = (m) => {
    const n = m.name.toLowerCase();
    const front = /(^|[^a-z])f[lr]([^a-z]|$)|front/.test(n), back = /(^|[^a-z])(b|r)[lr]([^a-z]|$)|rear|back/.test(n);
    const l = /(^|[^a-z])[fbr]l([^a-z]|$)|left/.test(n), r = /(^|[^a-z])[fbr]r([^a-z]|$)|right/.test(n);
    return { front, back, l, r };
  };
  const W = wheels.map((m) => ({ m, c: centre(m), t: tag(m) }));
  const fr = W.filter((w) => w.t.front), bk = W.filter((w) => w.t.back);
  if (fr.length && bk.length) {
    const cf = fr.reduce((a, w) => a.add(w.c), new THREE.Vector3()).multiplyScalar(1 / fr.length);
    const cb = bk.reduce((a, w) => a.add(w.c), new THREE.Vector3()).multiplyScalar(1 / bk.length);
    fwd = cf.clone().sub(cb); fwd.y = 0; fwd.normalize();
    const ls = W.filter((w) => w.t.l), rs = W.filter((w) => w.t.r);
    if (ls.length && rs.length) {
      const cl = ls.reduce((a, w) => a.add(w.c), new THREE.Vector3()).multiplyScalar(1 / ls.length);
      const cr = rs.reduce((a, w) => a.add(w.c), new THREE.Vector3()).multiplyScalar(1 / rs.length);
      left = cl.sub(cr); left.y = 0; left.normalize();
    } else left = new THREE.Vector3(0, 1, 0).cross(fwd).normalize().negate();
  } else if (size.z > size.x) { fwd.set(0, 0, 1); left.set(1, 0, 0); }

  // build the basis that maps model space -> car space (fwd -> +X, up -> +Y, left -> -Z)
  const up = new THREE.Vector3(0, 1, 0);
  const mBasis = new THREE.Matrix4().makeBasis(fwd, up, left.clone().negate()); // columns: model dirs for car X, Y, Z
  const toCar = mBasis.clone().invert();
  if (cfg.yaw) toCar.premultiply(new THREE.Matrix4().makeRotationY(cfg.yaw * Math.PI / 180));
  if (cfg.mirror) toCar.premultiply(new THREE.Matrix4().makeScale(1, 1, -1));

  // Placement. Default "hitbox" fit: scale uniformly so the body spans the
  // hitbox like in the real game (bumper ~3 uu ahead of the hitbox front,
  // tail flush with its rear), wheels on the ground. "wheels" fit: native
  // wheelbase matched to the physics wheels (front 51.25, rear -33.75).
  const fit = cfg.fit || 'hitbox';
  const HB_FRONT = P.offset[0] + P.hitbox[0] / 2, HB_REAR = P.offset[0] - P.hitbox[0] / 2;
  const toCarPts = (objs) => {
    const b = new THREE.Box3();
    for (const m of objs) {
      const mb = new THREE.Box3().setFromObject(m);
      for (const x of [mb.min.x, mb.max.x]) for (const y of [mb.min.y, mb.max.y]) for (const z of [mb.min.z, mb.max.z]) b.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(toCar));
    }
    return b;
  };
  const bodyB = toCarPts(body.length ? body : meshes), allB = toCarPts(meshes);
  const wc = W.map((w) => w.c.clone().applyMatrix4(toCar));
  const fwc = wc.filter((_, i) => W[i].t.front), bwc = wc.filter((_, i) => W[i].t.back);
  const avgX = (a) => a.reduce((t, c) => t + c.x, 0) / a.length;
  let scale, tx;
  if (fit === 'wheels' && fwc.length && bwc.length) {
    scale = (P.front.x - P.back.x) / Math.max(1e-6, avgX(fwc) - avgX(bwc));
    tx = ((P.front.x - avgX(fwc) * scale) + (P.back.x - avgX(bwc) * scale)) / 2;
  } else {
    const bodyLen = bodyB.max.x - bodyB.min.x;
    scale = (HB_FRONT - HB_REAR + 3) / bodyLen;
    tx = HB_FRONT + 3 - bodyB.max.x * scale;
  }
  if (cfg.scale) scale *= cfg.scale;
  let ty = GROUND_Z - allB.min.y * scale;
  let tz = -(bodyB.min.z + bodyB.max.z) / 2 * scale;
  if (cfg.offset) { tx += cfg.offset[0]; ty += cfg.offset[1]; tz += cfg.offset[2]; }
  const xform = new THREE.Matrix4().makeTranslation(tx * S, ty * S, tz * S).multiply(new THREE.Matrix4().makeScale(scale * S, scale * S, scale * S)).multiply(toCar);

  // container in car space; re-parent every mesh keeping its world transform
  const container = new THREE.Group();
  const holder = new THREE.Group();
  holder.matrixAutoUpdate = false;
  holder.matrix.copy(xform);
  container.add(holder);
  container.updateMatrixWorld(true);
  const paintNames = cfg.paintMaterials ? cfg.paintMaterials.map((s) => s.toLowerCase()) : null;
  const upgraded = new Map();
  const upgrade = (mat) => {
    if (upgraded.has(mat)) return upgraded.get(mat);
    let kind = classify(mat.name || '');
    if (paintNames) kind = paintNames.includes((mat.name || '').toLowerCase()) ? 'paint' : (kind === 'paint' ? 'other' : kind);
    const nm = toStandard(mat, kind, opts.physical);
    nm.userData.kind = kind;
    upgraded.set(mat, nm);
    return nm;
  };
  for (const m of meshes) {
    m.material = Array.isArray(m.material) ? m.material.map(upgrade) : upgrade(m.material);
    m.castShadow = true; m.receiveShadow = true;
    // move into the holder keeping its *model-space* transform so the
    // holder's model->car matrix applies to it
    const wm = m.matrixWorld.clone();
    holder.add(m);
    wm.decompose(m.position, m.quaternion, m.scale);
  }
  container.updateMatrixWorld(true);

  // wheel pivots at physics wheel positions (order: FL, FR, BL, BR)
  const pivots = [];
  if (W.length >= 4) {
    const order = [['front', 'l'], ['front', 'r'], ['back', 'l'], ['back', 'r']];
    for (const [fb, lr] of order) {
      const w = W.find((x) => x.t[fb] && x.t[lr]);
      if (!w) continue;
      const c = new THREE.Box3().setFromObject(w.m).getCenter(new THREE.Vector3());
      const pivot = new THREE.Group(), spin = new THREE.Group();
      pivot.name = 'wheelPivot'; spin.name = 'wheelSpin';
      pivot.position.copy(c);
      container.add(pivot);
      pivot.add(spin);
      container.updateMatrixWorld(true);
      spin.attach(w.m);
      pivots.push({ pivot, spin, baseY: c.y, radius: new THREE.Box3().setFromObject(w.m).getSize(new THREE.Vector3()).y / 2 / S });
    }
  }
  // boost nozzle guesses: rear of the body, low-ish, either side of centre
  const cbox = new THREE.Box3();
  for (const m of body) cbox.expandByObject(m);
  const nz = cfg.nozzles
    ? cfg.nozzles.map((v) => new THREE.Vector3(v[0] * S, v[1] * S, -v[2] * S))
    : [1, -1].map((sd) => new THREE.Vector3(cbox.min.x + 0.03, cbox.min.y + (cbox.max.y - cbox.min.y) * 0.38, sd * (cbox.max.z - cbox.min.z) * 0.13));
  return { container, pivots: pivots.length === 4 ? pivots : null, nozzles: nz, bodyBox: cbox };
}

async function prepareBall(root, images, cfg, opts) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  await assignTextures(meshes, images, cfg, { assigned: {}, missing: [], found: [] }, opts);
  const bb = new THREE.Box3().setFromObject(root);
  const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
  const r = (sz.x + sz.y + sz.z) / 6;
  const k = (BALL_RADIUS * S) / r;
  const container = new THREE.Group();
  const holder = new THREE.Group();
  holder.matrixAutoUpdate = false;
  holder.matrix.makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  container.add(holder);
  container.updateMatrixWorld(true);
  const upgraded = new Map();
  for (const m of meshes) {
    const up = (mat) => {
      if (!upgraded.has(mat)) {
        const nm = opts.physical
          ? new THREE.MeshPhysicalMaterial({ name: mat.name, map: mat.map && mat.map.image ? mat.map : null, normalMap: mat.normalMap && mat.normalMap.image ? mat.normalMap : null, color: mat.map && mat.map.image ? 0xffffff : (mat.color || new THREE.Color(0x777777)), roughness: 0.45, metalness: 0.15, clearcoat: 0.6, clearcoatRoughness: 0.25 })
          : new THREE.MeshLambertMaterial({ name: mat.name, map: mat.map && mat.map.image ? mat.map : null, color: mat.map && mat.map.image ? 0xffffff : (mat.color || new THREE.Color(0x777777)) });
        if (nm.map) nm.map.colorSpace = THREE.SRGBColorSpace;
        upgraded.set(mat, nm);
      }
      return upgraded.get(mat);
    };
    m.material = Array.isArray(m.material) ? m.material.map(up) : up(m.material);
    m.castShadow = true; m.receiveShadow = true;
    const wm = m.matrixWorld.clone();
    holder.add(m);
    wm.decompose(m.position, m.quaternion, m.scale);
  }
  return { container };
}

/** A per-car copy of the prepared car with team paint. */
export function instantiateCar(tpl, paintColor) {
  const group = tpl.container.clone(true);
  const paintMats = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const swap = (m) => {
      if (m.userData.kind !== 'paint') return m;
      if (!paintMats.has(m)) { const c = m.clone(); c.color = paintColor.clone(); paintMats.set(m, c); }
      return paintMats.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  let wheels = null;
  if (tpl.pivots) {
    const pv = [];
    group.traverse((o) => { if (o.name === 'wheelPivot') pv.push(o); });
    wheels = pv.map((pivot, i) => ({ pivot, spin: pivot.children[0], radius: tpl.pivots[i].radius, baseY: tpl.pivots[i].baseY }));
  }
  return { group, wheels, nozzles: tpl.nozzles.map((v) => v.clone()) };
}
