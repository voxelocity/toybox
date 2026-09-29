// Rebuilds the Japanese display-font subset used by Neon Nitro.
// Scans the game's sources for non-ASCII glyphs and asks Google Fonts for a
// woff2 containing only those characters (Dela Gothic One, SIL OFL 1.1).
// Usage: node tools/neon-nitro-fonts.mjs   (needs network access)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'neon-nitro');
const OUT = path.join(ROOT, 'assets', 'fonts', 'DelaGothicOne-subset.woff2');
const chars = new Set('0123456789!?・ー');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(ROOT).filter((f) => /\.(js|html|css)$/.test(f))) {
  for (const ch of fs.readFileSync(f, 'utf8')) if (ch.codePointAt(0) > 0x2e7f) chars.add(ch);
}
const text = [...chars].sort().join('');
console.log(`${chars.size} glyphs`);
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Dela+Gothic+One&text=${encodeURIComponent(text)}`, { headers: { 'user-agent': ua } })).text();
const url = css.match(/url\((https:[^)]+)\)/)?.[1];
if (!url) throw new Error('No font URL in response:\n' + css);
const buf = Buffer.from(await (await fetch(url, { headers: { 'user-agent': ua } })).arrayBuffer());
fs.writeFileSync(OUT, buf);
console.log(`wrote ${OUT} (${buf.length} bytes)`);
