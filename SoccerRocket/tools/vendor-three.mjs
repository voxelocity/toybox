// Copies the parts of three.js the game uses into public/vendor/three,
// minified, so public/ is a fully static site (no bundler, no node_modules).
// Run: node tools/vendor-three.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'node_modules', 'three');
const OUT = path.join(ROOT, 'public', 'vendor', 'three');

const ADDONS = [
  'postprocessing/EffectComposer.js',
  'postprocessing/RenderPass.js',
  'postprocessing/UnrealBloomPass.js',
  'postprocessing/OutputPass.js',
  'postprocessing/ShaderPass.js',
  'postprocessing/SMAAPass.js',
  'loaders/HDRLoader.js',
  'loaders/GLTFLoader.js',
  'loaders/DRACOLoader.js',
  'loaders/FBXLoader.js',
  'loaders/OBJLoader.js',
  'loaders/MTLLoader.js',
  'loaders/TGALoader.js',
  'libs/meshopt_decoder.module.js',
  'utils/BufferGeometryUtils.js',
  'utils/SkeletonUtils.js',
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

function minify(file, dest) {
  const code = fs.readFileSync(file, 'utf8');
  const out = transformSync(code, { minify: true, format: 'esm', target: 'es2020', legalComments: 'none' }).code;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
  return code;
}

// core: three.module.js imports ./three.core.js
minify(path.join(SRC, 'build', 'three.core.js'), path.join(OUT, 'three.core.js'));
minify(path.join(SRC, 'build', 'three.module.js'), path.join(OUT, 'three.module.js'));

const seen = new Set();
const queue = [...ADDONS];
while (queue.length) {
  const rel = queue.shift();
  if (seen.has(rel)) continue;
  seen.add(rel);
  const code = minify(path.join(SRC, 'examples', 'jsm', rel), path.join(OUT, 'addons', rel));
  for (const m of code.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
  }
}
// Draco decoder (wasm + js fallback), copied as-is
const dracoSrc = path.join(SRC, 'examples', 'jsm', 'libs', 'draco', 'gltf');
const dracoOut = path.join(OUT, 'addons', 'libs', 'draco');
fs.mkdirSync(dracoOut, { recursive: true });
for (const f of fs.readdirSync(dracoSrc)) fs.copyFileSync(path.join(dracoSrc, f), path.join(dracoOut, f));
fs.copyFileSync(path.join(SRC, 'LICENSE'), path.join(OUT, 'LICENSE'));
const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`vendored three r${JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'))).version}: ${seen.size} addons, ${(size(OUT) / 1024).toFixed(0)} KB`);
