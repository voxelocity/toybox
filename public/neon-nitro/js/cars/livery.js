// Livery textures. 1024x1024 canvas split into three projections sampled by
// the car shader: right side (rows 0-255), left side (256-511) and top view
// (512-1023). x runs rear (0) -> front (1024) in every region. Shapes are drawn
// identically on both sides; text is flipped on the left so it always reads.
import * as THREE from 'three';

const W = 1024;
const cache = new Map();

export const FONT_COMIC = '"Bangers", "Impact", "Arial Black", sans-serif';
export const FONT_JP = '"Dela Gothic One", "Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", "Arial Black", sans-serif';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  if (k > 0) c.lerp(new THREE.Color(1, 1, 1), k); else c.multiplyScalar(1 + k);
  return '#' + c.getHexString();
}

function lum(hex) { const c = new THREE.Color(hex); return c.r * 0.3 + c.g * 0.59 + c.b * 0.11; }

/** Draw fn into both side regions; fn(ctx, mirrored). */
function sides(ctx, fn) {
  for (const [oy, mir] of [[0, false], [256, true]]) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, oy, W, 256); ctx.clip();
    ctx.translate(0, oy);
    fn(ctx, mir);
    ctx.restore();
  }
}
function top(ctx, fn) {
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 512, W, 512); ctx.clip();
  ctx.translate(0, 512);
  fn(ctx);
  ctx.restore();
}

function text(ctx, str, x, y, mir, { font, size, fill, stroke, lw = 6, rot = 0, align = 'center' }) {
  ctx.save();
  ctx.translate(x, y);
  if (mir) ctx.scale(-1, 1);
  ctx.rotate(rot);
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeText(str, 0, 0); }
  ctx.fillStyle = fill;
  ctx.fillText(str, 0, 0);
  ctx.restore();
}

/** Top-view text reads left-to-right when looking down with the car pointing up the screen. */
function topText(ctx, str, x, y, o) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 2);
  text(ctx, str, 0, 0, false, o);
  ctx.restore();
}

function flameShape(ctx, x0, y0, len, h, rnd, tongues = 5) {
  ctx.beginPath();
  ctx.moveTo(x0, y0 - h / 2);
  const step = h / tongues;
  for (let i = 0; i < tongues; i++) {
    const ya = y0 - h / 2 + i * step, yb = ya + step;
    const tipX = x0 - len * (0.55 + rnd() * 0.45);
    const tipY = ya + step * (0.2 + rnd() * 0.6);
    ctx.bezierCurveTo(x0 - len * 0.3, ya, tipX + len * 0.25, tipY - step * 0.8, tipX, tipY);
    ctx.bezierCurveTo(tipX + len * 0.3, tipY + step * 0.3, x0 - len * 0.25, yb, x0 - len * 0.12, yb);
  }
  ctx.lineTo(x0 + 40, y0 + h / 2);
  ctx.lineTo(x0 + 40, y0 - h / 2);
  ctx.closePath();
}

function star(ctx, x, y, r, n = 5, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * inner : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function sakuraFlower(ctx, x, y, r, col, rot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = col; ctx.strokeStyle = 'rgba(40,10,30,0.8)'; ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    ctx.rotate((Math.PI * 2) / 5);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(r * 0.5, -r * 0.3, r * 0.9, -r * 0.2, r, 0);
    ctx.lineTo(r * 0.85, r * 0.08); ctx.lineTo(r, r * 0.18);
    ctx.bezierCurveTo(r * 0.9, r * 0.3, r * 0.5, r * 0.35, 0, 0);
    ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = '#ffe23b';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

const SPONSORS = ['NITRO-X', 'KAIJU OIL', 'NEKO GRIP', 'TOFU SHOP', 'ZEN PIPES', 'OKAMI', 'SHOGUN', 'DENKI', 'RAMEN RACING', 'HYPER-G', 'MOCHI', 'ONIBI'];

const DESIGNS = {
  stripes(ctx, lc, o) {
    const hw = o.bounds.halfW;
    const zY = (z) => 256 - 256 * (z / hw);
    top(ctx, (c) => {
      c.fillStyle = lc;
      for (const s of [-1, 1]) c.fillRect(0, zY(s * 0.17) - 22, W, 44);
      c.fillStyle = 'rgba(0,0,0,0.85)';
      for (const s of [-1, 1]) { c.fillRect(0, zY(s * 0.17) - 26, W, 4); c.fillRect(0, zY(s * 0.17) + 22, W, 4); }
    });
    sides(ctx, (c) => {
      const y = o.Y(o.rocker + 0.2);
      c.fillStyle = lc; c.fillRect(0, y - 8, W, 16);
      c.fillStyle = 'rgba(0,0,0,0.85)'; c.fillRect(0, y + 12, W, 5);
    });
  },
  flames(ctx, lc, o) {
    const r = rng(o.seed * 31 + 7);
    sides(ctx, (c) => {
      const y0 = o.Y((o.rocker + o.belt) / 2) + 6;
      const h = (o.Y(o.rocker + 0.05) - o.Y(o.belt - 0.04));
      const rr = rng(o.seed * 31 + 7);
      c.save();
      flameShape(c, o.X(o.nose - 0.35), y0, 560, h, rr, 5);
      c.fillStyle = lc; c.fill();
      c.lineWidth = 8; c.strokeStyle = '#140818'; c.stroke();
      c.clip();
      const rr2 = rng(o.seed * 31 + 7);
      flameShape(c, o.X(o.nose - 0.35), y0 + 4, 420, h * 0.62, rr2, 4);
      c.fillStyle = shade(lc, 0.55); c.fill();
      c.restore();
    });
    top(ctx, (c) => {
      c.save();
      c.translate(0, 256);
      flameShape(c, W + 10, 0, 330, 300, r, 6);
      c.fillStyle = lc; c.fill(); c.lineWidth = 8; c.strokeStyle = '#140818'; c.stroke();
      c.restore();
    });
  },
  kanji(ctx, lc, o) {
    const dark = lum(lc) > 0.55 ? '#140818' : '#ffffff';
    sides(ctx, (c, mir) => {
      const y = o.Y((o.rocker + o.belt) / 2 + 0.03);
      // speed slashes
      c.fillStyle = lc;
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        const x = o.X(o.nose - 0.9) - i * 90, yy = y - 40 + i * 18;
        c.moveTo(x, yy); c.lineTo(x - 260 + i * 30, yy + 6); c.lineTo(x - 250 + i * 30, yy + 14); c.lineTo(x + 10, yy + 10); c.fill();
      }
      text(c, o.jp, o.X(-0.3), y, mir, { font: o.fontJP, size: 150, fill: lc, stroke: dark, lw: 12 });
      text(c, '走り屋', o.X(-1.35), y + 36, mir, { font: o.fontJP, size: 44, fill: lc, stroke: dark, lw: 6 });
    });
    top(ctx, (c) => {
      topText(c, o.jp, o.X(o.nose - 0.6), 256, { font: o.fontJP, size: 230, fill: lc, stroke: dark, lw: 14 });
      c.fillStyle = lc;
      c.fillRect(0, 250, o.X(o.nose - 1.1), 12);
    });
  },
  sakura(ctx, lc, o) {
    const r = rng(o.seed * 13 + 5);
    sides(ctx, (c) => {
      const g = c.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, lc); g.addColorStop(0.45, shade(lc, 0.3) + '00');
      c.fillStyle = g; c.fillRect(0, 0, W, 256);
      const rr = rng(o.seed * 13 + 5);
      for (let i = 0; i < 26; i++) {
        const x = Math.pow(rr(), 1.6) * W * 0.9, y = o.Y(o.belt) + rr() * (o.Y(o.rocker) - o.Y(o.belt));
        sakuraFlower(c, x, y, 10 + rr() * 16, i % 3 ? '#ffd1e8' : '#ffffff', rr() * 6);
      }
    });
    top(ctx, (c) => {
      const g = c.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, lc); g.addColorStop(0.5, shade(lc, 0.3) + '00');
      c.fillStyle = g; c.fillRect(0, 0, W, 512);
      for (let i = 0; i < 30; i++) sakuraFlower(c, Math.pow(r(), 1.5) * W, r() * 512, 12 + r() * 18, i % 3 ? '#ffd1e8' : '#ffffff', r() * 6);
    });
  },
  tiger(ctx, lc, o) {
    const r = rng(o.seed * 7 + 3);
    const stripe = (c, x, y0, y1, w) => {
      c.beginPath();
      c.moveTo(x, y0);
      const n = 4;
      for (let i = 1; i <= n; i++) c.lineTo(x + (i % 2 ? w : -w * 0.3) + (r() - 0.5) * 20, y0 + ((y1 - y0) * i) / n);
      c.lineTo(x - w * 0.8, y1);
      for (let i = n - 1; i >= 0; i--) c.lineTo(x - w * 0.5 + (i % 2 ? w * 0.6 : -w * 0.2), y0 + ((y1 - y0) * i) / n);
      c.closePath(); c.fill();
    };
    sides(ctx, (c) => {
      c.fillStyle = lc;
      for (let x = 40; x < W; x += 85 + r() * 30) stripe(c, x, o.Y(o.roof) - 10, o.Y(o.rocker) + 10, 34 + r() * 16);
    });
    top(ctx, (c) => {
      c.fillStyle = lc;
      for (let x = 30; x < W; x += 80 + r() * 30) { stripe(c, x, -10, 200, 30); stripe(c, x + 20, 522, 312, 30); }
    });
  },
  bolt(ctx, lc, o) {
    sides(ctx, (c) => {
      const yT = o.Y(o.belt - 0.02), yB = o.Y(o.rocker + 0.08);
      const xs = [o.X(o.nose - 0.25), o.X(0.6), o.X(0.25), o.X(-0.45), o.X(-0.8), o.X(-1.6), o.X(o.tail + 0.2)];
      c.beginPath();
      c.moveTo(xs[0], yT + 10);
      c.lineTo(xs[1], yB - 20); c.lineTo(xs[2], yT + 40); c.lineTo(xs[3], yB - 10); c.lineTo(xs[4], yT + 30); c.lineTo(xs[5], yB - 30); c.lineTo(xs[6], (yT + yB) / 2);
      c.lineTo(xs[5] - 30, yB - 60); c.lineTo(xs[4] - 20, yT + 60); c.lineTo(xs[3] - 20, yB - 40); c.lineTo(xs[2] - 10, yT + 70); c.lineTo(xs[1] - 10, yB - 50);
      c.closePath();
      c.fillStyle = lc; c.fill(); c.lineWidth = 7; c.strokeStyle = '#140818'; c.stroke();
    });
    top(ctx, (c) => {
      c.beginPath();
      c.moveTo(W, 236); c.lineTo(700, 300); c.lineTo(520, 210); c.lineTo(250, 300); c.lineTo(0, 250);
      c.lineTo(0, 270); c.lineTo(250, 330); c.lineTo(520, 240); c.lineTo(700, 330); c.lineTo(W, 276); c.closePath();
      c.fillStyle = lc; c.fill(); c.lineWidth = 7; c.strokeStyle = '#140818'; c.stroke();
    });
  },
  sticker(ctx, lc, o) {
    const r = rng(o.seed * 17 + 11);
    const num = String(o.seed % 100).padStart(2, '0');
    const dark = '#140818';
    const cols = [lc, '#ffffff', '#ffe23b', '#20d8ff', '#ff2d6f', '#111216'];
    sides(ctx, (c, mir) => {
      const cy = o.Y((o.rocker + o.belt) / 2 + 0.02);
      const cx = o.X(-0.25);
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(cx, cy, 58, 0, Math.PI * 2); c.fill();
      c.lineWidth = 8; c.strokeStyle = lc; c.stroke();
      text(c, num, cx, cy + 4, mir, { font: o.fontComic, size: 86, fill: dark });
      const rr = rng(o.seed * 17 + 11);
      let x = o.X(o.nose - 0.35);
      for (let i = 0; i < 4; i++) {
        const w = 110 + rr() * 70, h = 32 + rr() * 10, y = o.Y(o.belt - 0.08) + i * 7 + (i % 2) * 20;
        const bg = cols[(i + o.seed) % cols.length];
        c.fillStyle = bg; c.strokeStyle = dark; c.lineWidth = 4;
        c.beginPath(); c.roundRect(x - w, y, w, h, 8); c.fill(); c.stroke();
        text(c, SPONSORS[(i * 3 + o.seed) % SPONSORS.length], x - w / 2, y + h / 2 + 2, mir, { font: o.fontComic, size: 26, fill: lum(bg) > 0.5 ? dark : '#ffffff' });
        x -= w + 12;
        if (i === 1) x = o.X(-0.9);
      }
      for (let i = 0; i < 3; i++) {
        const w = 90 + rr() * 50, y = o.Y(o.rocker + 0.2);
        const xx = o.X(o.tail + 0.6) + i * (w + 10) - 80;
        const bg = cols[(i + 2 + o.seed) % cols.length];
        c.fillStyle = bg; c.beginPath(); c.roundRect(xx, y - 14, w, 28, 6); c.fill(); c.lineWidth = 3; c.strokeStyle = dark; c.stroke();
        text(c, SPONSORS[(i * 5 + 4 + o.seed) % SPONSORS.length], xx + w / 2, y + 1, mir, { font: o.fontComic, size: 20, fill: lum(bg) > 0.5 ? dark : '#fff' });
      }
    });
    top(ctx, (c) => {
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(o.X(-0.2), 256, 80, 0, Math.PI * 2); c.fill();
      c.lineWidth = 10; c.strokeStyle = lc; c.stroke();
      topText(c, num, o.X(-0.2), 262, { font: o.fontComic, size: 120, fill: dark });
      topText(c, SPONSORS[o.seed % SPONSORS.length], o.X(o.nose - 0.45), 256, { font: o.fontComic, size: 64, fill: lc, stroke: dark, lw: 8 });
      void r;
    });
  },
  circuit(ctx, lc, o) {
    const r = rng(o.seed * 19 + 1);
    const trace = (c, x, y, n) => {
      c.beginPath(); c.moveTo(x, y);
      for (let i = 0; i < n; i++) {
        if (i % 2) x += (r() - 0.5) * 220; else y += (r() - 0.5) * 70;
        c.lineTo(x, y);
      }
      c.stroke();
      c.beginPath(); c.arc(x, y, 8, 0, Math.PI * 2); c.fill();
    };
    const draw = (c, y0, y1) => {
      c.strokeStyle = lc; c.fillStyle = lc; c.lineWidth = 6; c.lineCap = 'square'; c.lineJoin = 'miter';
      c.shadowColor = lc; c.shadowBlur = 10;
      for (let i = 0; i < 16; i++) trace(c, r() * W, y0 + r() * (y1 - y0), 6);
      c.shadowBlur = 0;
    };
    sides(ctx, (c) => draw(c, o.Y(o.belt), o.Y(o.rocker)));
    top(ctx, (c) => draw(c, 20, 490));
  },
  wave(ctx, lc, o) {
    const foam = '#f4f7ff', ink = '#101a3a';
    const drawWave = (c, x, base, h, w) => {
      c.beginPath();
      c.moveTo(x - w, base);
      c.bezierCurveTo(x - w * 0.6, base, x - w * 0.5, base - h * 1.1, x, base - h);
      c.bezierCurveTo(x + w * 0.35, base - h * 0.95, x + w * 0.45, base - h * 0.45, x + w * 0.2, base - h * 0.38);
      c.bezierCurveTo(x + w * 0.05, base - h * 0.35, x + w * 0.08, base - h * 0.6, x + w * 0.2, base - h * 0.62);
      c.bezierCurveTo(x - w * 0.1, base - h * 0.8, x - w * 0.25, base - h * 0.2, x + w * 0.5, base);
      c.closePath();
      c.fillStyle = lc; c.fill(); c.lineWidth = 6; c.strokeStyle = ink; c.stroke();
      // foam claws
      c.fillStyle = foam;
      for (let i = 0; i < 5; i++) {
        const a = -0.2 + i * 0.35;
        const fx = x + Math.cos(a) * w * 0.28, fy = base - h + Math.sin(a) * h * 0.25;
        c.beginPath(); c.arc(fx, fy, 10 - i, 0, Math.PI * 2); c.fill(); c.stroke();
      }
      // stripes inside
      c.strokeStyle = shade(lc, 0.45); c.lineWidth = 4;
      for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(x - w * (0.9 - i * 0.15), base - 4); c.quadraticCurveTo(x - w * 0.3, base - h * (0.3 + i * 0.15), x - w * 0.05, base - h * (0.55 + i * 0.1)); c.stroke(); }
    };
    sides(ctx, (c) => {
      const base = o.Y(o.rocker - 0.05);
      const h = base - o.Y(o.belt - 0.05);
      drawWave(c, o.X(-0.3), base, h * 0.95, 300);
      drawWave(c, o.X(o.nose - 0.7), base, h * 0.7, 220);
      drawWave(c, o.X(o.tail + 0.35), base, h * 0.6, 200);
    });
    top(ctx, (c) => {
      for (const y of [110, 400]) drawWave(c, o.X(0), y + 60, 120, 250);
    });
  },
  split(ctx, lc, o) {
    sides(ctx, (c) => {
      const yT = o.Y(o.rocker + (o.belt - o.rocker) * 0.45);
      c.fillStyle = lc;
      c.beginPath(); c.moveTo(0, yT + 20); c.lineTo(W, yT - 20); c.lineTo(W, 256); c.lineTo(0, 256); c.closePath(); c.fill();
      c.fillStyle = '#140818'; c.beginPath(); c.moveTo(0, yT + 12); c.lineTo(W, yT - 28); c.lineTo(W, yT - 20); c.lineTo(0, yT + 20); c.closePath(); c.fill();
    });
  },
  checker(ctx, lc, o) {
    const draw = (c, h) => {
      for (let x = 0; x < W * 0.55; x += 1) {
        const col = Math.floor(x / 36);
        if (x % 36) continue;
        const k = 1 - x / (W * 0.55);
        const size = 36 * (0.25 + 0.75 * k);
        for (let y = 0; y < h; y += 36) {
          if ((col + y / 36) % 2) continue;
          c.fillStyle = lc;
          c.fillRect(x + (36 - size) / 2, y + (36 - size) / 2, size, size);
        }
      }
    };
    sides(ctx, (c) => draw(c, 256));
    top(ctx, (c) => draw(c, 512));
  },
};

/** Build (and cache) a CanvasTexture for a livery. */
export function liveryTexture(id, color, o) {
  const key = [id, color, o.body, o.seed, o.paint, o.bounds.minX.toFixed(2), o.bounds.maxX.toFixed(2)].join('|');
  if (cache.has(key)) { const t = cache.get(key); t.userData.refs++; return t; }
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = W;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, W);
  const b = o.bounds;
  const dims = { kaze: { rocker: 0.27, belt: 0.975, roof: 1.36 }, oni: { rocker: 0.4, belt: 1.2, roof: 1.8 }, raiden: { rocker: 0.25, belt: 0.85, roof: 1.2 } }[o.body] || { rocker: 0.27, belt: 0.95, roof: 1.3 };
  const opts = {
    ...o, ...dims, nose: b.maxX, tail: b.minX,
    X: (xm) => (W * (xm - b.minX)) / (b.maxX - b.minX),
    Y: (h) => 256 * (1 - (h - b.minY) / (b.maxY - b.minY)),
    fontComic: FONT_COMIC, fontJP: FONT_JP,
  };
  (DESIGNS[id] || (() => {}))(ctx, color, opts);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.userData.refs = 1;
  const dispose = tex.dispose.bind(tex);
  tex.dispose = () => { if (--tex.userData.refs <= 0) { cache.delete(key); dispose(); } };
  cache.set(key, tex);
  return tex;
}
