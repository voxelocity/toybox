// Renders every synthesised sound to WAV (+ spectrogram PNGs) for review.
// Run: node tools/audio-preview.mjs [outdir] [name-filter]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SOUND_LIST } from '../public/js/audio/sounds.js';

const out = process.argv[2] || '.shots/audio';
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
fs.mkdirSync(out, { recursive: true });

function wav(r) {
  const n = r.ch[0].length, c = r.ch.length;
  const b = Buffer.alloc(44 + n * c * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * c * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(c, 22); b.writeUInt32LE(r.sr, 24);
  b.writeUInt32LE(r.sr * c * 2, 28); b.writeUInt16LE(c * 2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * c * 2, 40);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(r.ch[k][i] * 32767))), 44 + (i * c + k) * 2);
  return b;
}

let total = 0;
for (const [name, fn] of SOUND_LIST) {
  if (filter && !filter.test(name)) continue;
  const t0 = performance.now();
  const r = fn();
  const ms = performance.now() - t0;
  total += ms;
  let peak = 0, rms = 0, nan = 0;
  for (const ch of r.ch) for (const v of ch) { if (!Number.isFinite(v)) nan++; else { peak = Math.max(peak, Math.abs(v)); rms += v * v; } }
  rms = Math.sqrt(rms / (r.ch.length * r.ch[0].length));
  const f = path.join(out, name + '.wav');
  fs.writeFileSync(f, wav(r));
  console.log(`${name.padEnd(14)} ${ms.toFixed(0).padStart(6)} ms  ${(r.ch[0].length / r.sr).toFixed(2)}s x${r.ch.length} @${r.sr}  peak ${peak.toFixed(2)} rms ${(20 * Math.log10(rms + 1e-9)).toFixed(1)} dB${nan ? '  NaN:' + nan : ''}${r.loop ? '  loop' : ''}`);
  try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f, '-lavfi', 'showspectrumpic=s=640x240:legend=0:scale=log', path.join(out, name + '.png')]); } catch { /* ffmpeg optional */ }
}
console.log(`total ${total.toFixed(0)} ms`);
