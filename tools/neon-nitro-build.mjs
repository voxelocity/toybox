// Builds Neon Nitro for hosting outside this repo's dev server.
//
//   node tools/neon-nitro-build.mjs [outDir]
//     Plain static bundle for any file host (GitHub Pages, Netlify, a bucket...):
//     copies public/neon-nitro (minus dev pages), vendors three.js next to it and
//     points the import map at the local copy, so the folder works from any sub-path.
//
//   node tools/neon-nitro-build.mjs --hosted [outDir]
//     Single page for sandboxed hosts that only allow scripts from public CDNs:
//     the page body is written without its own <html>/<head> (the host wraps it),
//     CSS and fonts are inlined (fonts as data: URIs), three.js comes from
//     jsDelivr pinned to the installed version, and only js/ ships alongside.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public', 'neon-nitro');
const THREE = path.join(ROOT, 'node_modules', 'three');
const args = process.argv.slice(2);
const hosted = args.includes('--hosted');
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'dist', hosted ? 'neon-nitro-hosted' : 'neon-nitro'));

fs.rmSync(OUT, { recursive: true, force: true });
const index = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

if (!hosted) {
  fs.cpSync(SRC, OUT, { recursive: true, filter: (p) => !p.startsWith(path.join(SRC, 'dev')) && !p.endsWith('README.md') });
  fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });
  for (const f of ['three.module.js', 'three.core.js']) fs.copyFileSync(path.join(THREE, 'build', f), path.join(OUT, 'vendor', f));
  fs.writeFileSync(path.join(OUT, 'index.html'), index.replace(
    /<script type="importmap">[\s\S]*?<\/script>/,
    '<script type="importmap">{"imports":{"three":"./vendor/three.module.js"}}</script>',
  ));
} else {
  fs.cpSync(path.join(SRC, 'js'), path.join(OUT, 'js'), { recursive: true });
  fs.copyFileSync(path.join(SRC, 'assets', 'fonts', 'OFL.txt'), path.join(OUT, 'OFL.txt')); // licence travels with the inlined fonts
  const version = JSON.parse(fs.readFileSync(path.join(THREE, 'package.json'), 'utf8')).version;
  // fonts.css with every url(...) swapped for a data: URI, then the game stylesheet
  const fontsCss = fs.readFileSync(path.join(SRC, 'css', 'fonts.css'), 'utf8').replace('../assets/fonts/OFL.txt', 'OFL.txt').replace(/url\('\.\.\/([^']+)'\)/g, (m, rel) => {
    const b64 = fs.readFileSync(path.join(SRC, rel)).toString('base64');
    return `url('data:font/woff2;base64,${b64}')`;
  });
  const gameCss = fs.readFileSync(path.join(SRC, 'css', 'game.css'), 'utf8');
  const title = index.match(/<title>[^<]*<\/title>/)[0];
  const body = index.match(/<body>([\s\S]*)<\/body>/)[1].trim();
  const page = [
    title,
    `<style>\n${fontsCss}\n${gameCss}\n</style>`,
    `<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@${version}/build/three.module.js"}}</script>`,
    body,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'index.html'), page);
}

let bytes = 0, files = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { bytes += fs.statSync(p).size; files++; } } };
walk(OUT);
console.log(`built ${OUT} (${files} files, ${(bytes / 1024 / 1024).toFixed(2)} MB)`);
