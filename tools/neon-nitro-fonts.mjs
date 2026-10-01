// Rebuilds the Japanese font subsets used by Neon Nitro.
// Scans the game's sources for non-ASCII glyphs and asks Google Fonts for
// woff2 files containing only those characters (both SIL OFL 1.1):
//   - Dela Gothic One: heavy display face for titles and signs
//   - Noto Sans JP (800): small labels, which the display face turns into blobs
// Usage: node tools/neon-nitro-fonts.mjs   (needs network access)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'neon-nitro');
const FONTS = [
  { family: 'Dela+Gothic+One', file: 'DelaGothicOne-subset.woff2' },
  { family: 'Noto+Sans+JP:wght@800', file: 'NotoSansJP-800-subset.woff2' },
];
const chars = new Set('0123456789!?・ー');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(ROOT).filter((f) => /\.(js|html|css)$/.test(f))) {
  for (const ch of fs.readFileSync(f, 'utf8')) if (ch.codePointAt(0) > 0x2e7f) chars.add(ch);
}
const text = [...chars].sort().join('');
console.log(`${chars.size} glyphs`);
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
for (const { family, file } of FONTS) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`, { headers: { 'user-agent': ua } })).text();
  const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]);
  if (urls.length !== 1) throw new Error(`Expected one font URL for ${family}, got ${urls.length}:\n${css}`);
  const buf = Buffer.from(await (await fetch(urls[0], { headers: { 'user-agent': ua } })).arrayBuffer());
  const out = path.join(ROOT, 'assets', 'fonts', file);
  fs.writeFileSync(out, buf);
  console.log(`wrote ${out} (${buf.length} bytes)`);
}
