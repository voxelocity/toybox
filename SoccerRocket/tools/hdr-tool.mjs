// Radiance .hdr helper: finds the sun direction in an equirect sky and writes
// downsampled copies. Run: node tools/hdr-tool.mjs <in.hdr> <outdir>
import fs from 'node:fs';
import path from 'node:path';

export function readHDR(buf) {
  let pos = 0;
  const line = () => { let s = ''; while (buf[pos] !== 0x0a) s += String.fromCharCode(buf[pos++]); pos++; return s; };
  let l;
  while ((l = line()) !== '') { /* header */ }
  const m = line().match(/-Y (\d+) \+X (\d+)/);
  const h = +m[1], w = +m[2];
  const data = new Float32Array(w * h * 3);
  const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (buf[pos] === 2 && buf[pos + 1] === 2) {
      pos += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < w) {
          let n = buf[pos++];
          if (n > 128) { n -= 128; const v = buf[pos++]; for (let k = 0; k < n; k++) scan[(x++) * 4 + c] = v; }
          else for (let k = 0; k < n; k++) scan[(x++) * 4 + c] = buf[pos++];
        }
      }
    } else { for (let x = 0; x < w * 4; x++) scan[x] = buf[pos++]; }
    for (let x = 0; x < w; x++) {
      const e = scan[x * 4 + 3];
      const f = e ? Math.pow(2, e - 136) : 0;
      const o = (y * w + x) * 3;
      data[o] = scan[x * 4] * f; data[o + 1] = scan[x * 4 + 1] * f; data[o + 2] = scan[x * 4 + 2] * f;
    }
  }
  return { w, h, data };
}

export function writeHDR({ w, h, data }) {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'ascii');
  const chunks = [head];
  const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const v = Math.max(r, g, b);
      if (v < 1e-32) { scan[x * 4] = scan[x * 4 + 1] = scan[x * 4 + 2] = scan[x * 4 + 3] = 0; continue; }
      const e = Math.ceil(Math.log2(v) + 1e-9);
      const f = 256 / Math.pow(2, e);
      scan[x * 4] = Math.min(255, r * f); scan[x * 4 + 1] = Math.min(255, g * f); scan[x * 4 + 2] = Math.min(255, b * f);
      scan[x * 4 + 3] = e + 128;
    }
    // RLE per channel
    const out = [2, 2, (w >> 8) & 255, w & 255];
    for (let c = 0; c < 4; c++) {
      let x = 0;
      while (x < w) {
        let run = 1;
        while (x + run < w && run < 127 && scan[(x + run) * 4 + c] === scan[x * 4 + c]) run++;
        if (run >= 3) { out.push(128 + run, scan[x * 4 + c]); x += run; continue; }
        const start = x;
        let n = 0;
        while (x < w && n < 128) {
          let r2 = 1;
          while (x + r2 < w && r2 < 3 && scan[(x + r2) * 4 + c] === scan[x * 4 + c]) r2++;
          if (r2 >= 3) break;
          x++; n++;
        }
        out.push(n);
        for (let k = 0; k < n; k++) out.push(scan[(start + k) * 4 + c]);
      }
    }
    chunks.push(Buffer.from(out));
  }
  return Buffer.concat(chunks);
}

export function downsample(img, factor) {
  const w = img.w / factor, h = img.h / factor, data = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < factor; j++) for (let i = 0; i < factor; i++) {
      const o = ((y * factor + j) * img.w + x * factor + i) * 3;
      r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2];
    }
    const o = (y * w + x) * 3, n = factor * factor;
    data[o] = r / n; data[o + 1] = g / n; data[o + 2] = b / n;
  }
  return { w, h, data };
}

if (process.argv[2]) {
  const img = readHDR(fs.readFileSync(process.argv[2]));
  let best = 0, bx = 0, by = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const o = (y * img.w + x) * 3, L = img.data[o] * 0.2126 + img.data[o + 1] * 0.7152 + img.data[o + 2] * 0.0722;
    if (L > best) { best = L; bx = x; by = y; }
  }
  // equirect: u -> azimuth, v -> elevation (three.js convention)
  const u = (bx + 0.5) / img.w, v = (by + 0.5) / img.h;
  const phi = (u - 0.5) * 2 * Math.PI, elev = (0.5 - v) * Math.PI;
  console.log(`sun pixel ${bx},${by} lum ${best.toFixed(1)} -> u ${u.toFixed(4)} v ${v.toFixed(4)} elevation ${(elev * 180 / Math.PI).toFixed(1)} deg azimuth(u) ${(phi * 180 / Math.PI).toFixed(1)}`);
  const outdir = process.argv[3];
  if (outdir) {
    fs.mkdirSync(outdir, { recursive: true });
    fs.writeFileSync(path.join(outdir, 'sky_2k.hdr'), writeHDR(img));
    fs.writeFileSync(path.join(outdir, 'sky_1k.hdr'), writeHDR(downsample(img, 2)));
    fs.writeFileSync(path.join(outdir, 'sky_512.hdr'), writeHDR(downsample(img, 4)));
    for (const f of ['sky_2k.hdr', 'sky_1k.hdr', 'sky_512.hdr']) console.log(f, (fs.statSync(path.join(outdir, f)).size / 1024).toFixed(0) + ' KB');
  }
}
