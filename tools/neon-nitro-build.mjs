// Static build of Neon Nitro for any plain file host (GitHub Pages, Netlify,
// an S3 bucket...). Copies public/neon-nitro (minus the dev pages) into
// dist/neon-nitro, vendors three.js next to it and points the import map at
// the local copy, so the folder works from any sub-path.
//
//   node tools/neon-nitro-build.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public', 'neon-nitro');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'neon-nitro'));
const THREE = path.join(ROOT, 'node_modules', 'three', 'build');

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true, filter: (p) => !p.startsWith(path.join(SRC, 'dev')) });
fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });
for (const f of ['three.module.js', 'three.core.js']) fs.copyFileSync(path.join(THREE, f), path.join(OUT, 'vendor', f));

const index = path.join(OUT, 'index.html');
const html = fs.readFileSync(index, 'utf8').replace(
  /<script type="importmap">[\s\S]*?<\/script>/,
  '<script type="importmap">{"imports":{"three":"./vendor/three.module.js"}}</script>',
);
fs.writeFileSync(index, html);

let bytes = 0, files = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { bytes += fs.statSync(p).size; files++; } } };
walk(OUT);
console.log(`built ${OUT} (${files} files, ${(bytes / 1024 / 1024).toFixed(2)} MB)`);
