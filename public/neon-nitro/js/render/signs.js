// Neon sign atlas: horizontal shop signs, vertical banners and comic
// billboard ads, drawn once into a canvas and shared by all scenery.
import * as THREE from 'three';
import { FONT_COMIC, FONT_JP } from '../cars/livery.js';

const SIZE = 2048;
const H = { w: 256, h: 96, cols: 8, rows: 10, y: 0 };
const V = { w: 96, h: 320, cols: 21, rows: 2, y: 960 };
const B = { w: 512, h: 224, cols: 4, rows: 2, y: 1600 };

export const H_TEXT = [
  'ラーメン', 'カラオケ', 'ゲーム', '寿司', '居酒屋', 'ホテル', 'パチンコ', '電気', 'ネオン', 'タクシー',
  '薬', 'コーヒー', 'NITRO', 'KAIJU', 'OPEN 24H', 'BAR', 'CYBER', 'アニメ', 'たこ焼き', 'ロボット',
  '東京', '未来', '夜', 'メイド', 'NEO TOKYO', '焼肉', '本屋', 'マンガ', '酒', 'ドリフト',
  'ARCADE', '喫茶', 'HOTEL', '電脳', 'RAMEN', '牛丼', 'DENKI', 'ネコ', '宇宙', 'ガチャ',
];
export const V_TEXT = ['居酒屋', 'ラーメン', 'カラオケ', '焼鳥', '漫画喫茶', '電脳', '夜の街', '銭湯', '走り屋', '新宿', '渋谷', '秋葉原', 'ホテル', '寿司', '麻雀', 'スナック', '鬼', '龍', '風', '雷', '夢'];
const NEON = ['#ff2d6f', '#20d8ff', '#ffe23b', '#56f06b', '#ff8a1e', '#c93dff', '#ff5ccf', '#2a8cff', '#ffffff'];
const BG = ['#150a24', '#0c1428', '#24081a', '#0a1a14', '#1a1024', '#ff2d6f', '#ffe23b', '#20d8ff', '#ffffff', '#111216'];

let atlas = null;

function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

function neonText(ctx, str, x, y, size, color, font, vertical = false) {
  ctx.save();
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const draw = () => {
    if (!vertical) { ctx.fillText(str, x, y); return; }
    const chars = [...str];
    const step = size * 1.02;
    const y0 = y - ((chars.length - 1) * step) / 2;
    chars.forEach((c, i) => ctx.fillText(c, x, y0 + i * step));
  };
  ctx.shadowColor = color; ctx.shadowBlur = size * 0.35;
  ctx.fillStyle = color; draw();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.55;
  ctx.font = `${size}px ${font}`;
  draw();
  ctx.restore();
}

function panel(ctx, x, y, w, h, bg, border, r = 10) {
  ctx.save();
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(x + 3, y + 3, w - 6, h - 6, r); ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = border; ctx.shadowColor = border; ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.restore();
}

// ---- billboard ads (comic style)
const ADS = [
  (c, w, h) => { // NITRO COLA
    grad(c, w, h, '#ff2d6f', '#ffb21e'); burst(c, w * 0.28, h * 0.5, 90, '#ffe23b');
    c.fillStyle = '#20d8ff'; c.strokeStyle = '#140818'; c.lineWidth = 6; c.beginPath(); c.roundRect(w * 0.2, h * 0.18, 70, 150, 16); c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.fillRect(w * 0.2 + 8, h * 0.18 + 50, 54, 40);
    comic(c, 'NITRO', w * 0.66, h * 0.36, 64, '#fff'); comic(c, 'COLA!', w * 0.66, h * 0.7, 72, '#ffe23b');
  },
  (c, w, h) => { // cat mascot
    grad(c, w, h, '#20d8ff', '#8a3dff');
    const cx = w * 0.3, cy = h * 0.55;
    c.fillStyle = '#fff'; c.strokeStyle = '#140818'; c.lineWidth = 6;
    c.beginPath(); c.moveTo(cx - 60, cy - 40); c.lineTo(cx - 50, cy - 95); c.lineTo(cx - 15, cy - 55); c.lineTo(cx + 15, cy - 55); c.lineTo(cx + 50, cy - 95); c.lineTo(cx + 60, cy - 40); c.arc(cx, cy, 65, -0.3, Math.PI + 0.3); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#140818'; c.beginPath(); c.arc(cx - 24, cy - 5, 8, 0, 7); c.arc(cx + 24, cy - 5, 8, 0, 7); c.fill();
    c.strokeStyle = '#ff2d6f'; c.beginPath(); c.arc(cx, cy + 12, 12, 0.2, Math.PI - 0.2); c.stroke();
    jp(c, 'ネコ', w * 0.7, h * 0.35, 64, '#ffe23b'); comic(c, 'MEOW MART', w * 0.7, h * 0.72, 48, '#fff');
  },
  (c, w, h) => { // ramen
    grad(c, w, h, '#ffb21e', '#ff4f2e');
    c.fillStyle = '#fff'; c.strokeStyle = '#140818'; c.lineWidth = 6;
    c.beginPath(); c.arc(w * 0.3, h * 0.45, 80, 0, Math.PI); c.closePath(); c.fill(); c.stroke();
    c.strokeStyle = '#ffe23b'; c.lineWidth = 5; for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(w * 0.3 - 50 + i * 25, h * 0.45); c.quadraticCurveTo(w * 0.3 - 30 + i * 25, h * 0.2, w * 0.3 - 40 + i * 20, h * 0.08); c.stroke(); }
    jp(c, 'ラーメン', w * 0.7, h * 0.4, 58, '#fff'); comic(c, 'SLURP!', w * 0.7, h * 0.75, 52, '#ffe23b');
  },
  (c, w, h) => { // mecha
    grad(c, w, h, '#10254f', '#2a8cff'); burst(c, w * 0.3, h * 0.5, 100, '#20d8ff');
    c.fillStyle = '#c9ccd6'; c.strokeStyle = '#140818'; c.lineWidth = 6;
    c.beginPath(); c.moveTo(w * 0.3 - 50, h * 0.8); c.lineTo(w * 0.3 - 40, h * 0.3); c.lineTo(w * 0.3, h * 0.15); c.lineTo(w * 0.3 + 40, h * 0.3); c.lineTo(w * 0.3 + 50, h * 0.8); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#ff2d6f'; c.fillRect(w * 0.3 - 30, h * 0.35, 60, 14);
    jp(c, 'ロボット', w * 0.7, h * 0.35, 54, '#fff'); comic(c, 'MECHA WARS', w * 0.7, h * 0.72, 44, '#20d8ff');
  },
  (c, w, h) => { // race poster
    grad(c, w, h, '#140818', '#8a3dff');
    for (let i = 0; i < 12; i++) { c.fillStyle = i % 2 ? '#fff' : '#140818'; c.fillRect(i * (w / 12), h - 30, w / 12, 15); c.fillStyle = i % 2 ? '#140818' : '#fff'; c.fillRect(i * (w / 12), h - 15, w / 12, 15); }
    comic(c, 'NEON NITRO', w * 0.5, h * 0.33, 78, '#ff2d6f'); jp(c, 'ネオン・ニトロ', w * 0.5, h * 0.62, 44, '#20d8ff');
  },
  (c, w, h) => { // sushi
    grad(c, w, h, '#0f3d2e', '#1ee89c');
    for (let i = 0; i < 3; i++) { const x = w * 0.14 + i * 60, y = h * 0.6; c.fillStyle = '#fff'; c.strokeStyle = '#140818'; c.lineWidth = 5; c.beginPath(); c.roundRect(x, y - 20, 50, 30, 10); c.fill(); c.stroke(); c.fillStyle = i === 1 ? '#ffb21e' : '#ff4f2e'; c.beginPath(); c.roundRect(x - 4, y - 36, 58, 22, 10); c.fill(); c.stroke(); }
    jp(c, '寿司', w * 0.72, h * 0.38, 80, '#fff'); comic(c, 'FRESH!', w * 0.72, h * 0.76, 48, '#ffe23b');
  },
  (c, w, h) => { // kaiju movie
    grad(c, w, h, '#24081a', '#ff4f2e'); burst(c, w * 0.72, h * 0.3, 70, '#ffe23b');
    c.fillStyle = '#1a3a2a'; c.strokeStyle = '#140818'; c.lineWidth = 6;
    c.beginPath(); c.moveTo(w * 0.1, h); c.lineTo(w * 0.15, h * 0.4); c.lineTo(w * 0.22, h * 0.15); c.lineTo(w * 0.34, h * 0.2); c.lineTo(w * 0.38, h * 0.45); c.lineTo(w * 0.45, h); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#ffe23b'; c.beginPath(); c.arc(w * 0.28, h * 0.27, 6, 0, 7); c.fill();
    comic(c, 'KAIJU', w * 0.7, h * 0.52, 76, '#fff'); jp(c, '怪獣', w * 0.7, h * 0.8, 44, '#ffe23b');
  },
  (c, w, h) => { // drift club
    grad(c, w, h, '#111216', '#3e4dff');
    c.strokeStyle = '#fff'; c.lineWidth = 4; for (let i = 0; i < 8; i++) { c.beginPath(); c.moveTo(0, h * 0.2 + i * 18); c.lineTo(w * 0.45, h * 0.2 + i * 14 + 20); c.stroke(); }
    jp(c, '走り屋', w * 0.68, h * 0.38, 62, '#ff2d6f'); comic(c, 'DRIFT CLUB', w * 0.68, h * 0.74, 46, '#fff');
  },
];

function grad(c, w, h, a, b) { const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, a); g.addColorStop(1, b); c.fillStyle = g; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 8) for (let x = (y / 8) % 2 * 4; x < w; x += 8) { c.fillStyle = 'rgba(0,0,0,0.12)'; c.beginPath(); c.arc(x, y, 1.6, 0, 7); c.fill(); } }
function burst(c, x, y, r, col) { c.save(); c.fillStyle = col; c.beginPath(); for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2, rr = i % 2 ? r * 0.6 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); c.fill(); c.restore(); }
function comic(c, s, x, y, size, col) { c.save(); c.font = `${size}px ${FONT_COMIC}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.lineWidth = size * 0.16; c.strokeStyle = '#140818'; c.strokeText(s, x, y); c.fillStyle = col; c.fillText(s, x, y); c.restore(); }
function jp(c, s, x, y, size, col) { c.save(); c.font = `${size}px ${FONT_JP}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.lineWidth = size * 0.16; c.strokeStyle = '#140818'; c.strokeText(s, x, y); c.fillStyle = col; c.fillText(s, x, y); c.restore(); }

export function signAtlas() {
  if (atlas) return atlas;
  const cv = document.createElement('canvas');
  cv.width = SIZE; cv.height = SIZE;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  const r = rng(42);
  // horizontal
  for (let k = 0; k < H.cols * H.rows; k++) {
    const x = (k % H.cols) * H.w, y = H.y + Math.floor(k / H.cols) * H.h;
    const t = H_TEXT[k % H_TEXT.length];
    const neon = NEON[Math.floor(r() * NEON.length)];
    const bgi = Math.floor(r() * BG.length);
    const bg = BG[bgi];
    const solid = bgi >= 5 && bgi <= 8; // dark #111216 panels get neon text
    panel(ctx, x, y, H.w, H.h, bg, solid ? '#140818' : neon);
    const isJp = /[^\x00-\x7f]/.test(t);
    const size = Math.min(isJp ? 60 : 64, (H.w - 30) / Math.max(1, [...t].length) * (isJp ? 1 : 1.7));
    if (solid) { ctx.save(); ctx.fillStyle = '#140818'; ctx.font = `${size}px ${isJp ? FONT_JP : FONT_COMIC}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x + H.w / 2, y + H.h / 2 + 2); ctx.restore(); }
    else neonText(ctx, t, x + H.w / 2, y + H.h / 2 + 2, size, neon, isJp ? FONT_JP : FONT_COMIC);
  }
  // vertical
  for (let k = 0; k < V.cols * V.rows; k++) {
    const x = (k % V.cols) * V.w, y = V.y + Math.floor(k / V.cols) * V.h;
    const t = V_TEXT[k % V_TEXT.length];
    const neon = NEON[Math.floor(r() * NEON.length)];
    const bgi = Math.floor(r() * BG.length);
    const bg = BG[bgi];
    const solid = bgi >= 5 && bgi <= 8; // dark #111216 panels get neon text
    panel(ctx, x, y, V.w, V.h, bg, solid ? '#140818' : neon, 8);
    const n = [...t].length;
    const size = Math.min(70, (V.h - 30) / n / 1.05);
    if (solid) {
      ctx.save(); ctx.fillStyle = '#140818'; ctx.font = `${size}px ${FONT_JP}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      [...t].forEach((c, i) => ctx.fillText(c, x + V.w / 2, y + V.h / 2 - ((n - 1) * size * 1.02) / 2 + i * size * 1.02)); ctx.restore();
    } else neonText(ctx, t, x + V.w / 2, y + V.h / 2, size, neon, FONT_JP, true);
  }
  // billboards
  for (let k = 0; k < B.cols * B.rows; k++) {
    const x = (k % B.cols) * B.w, y = B.y + Math.floor(k / B.cols) * B.h;
    ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.rect(0, 0, B.w, B.h); ctx.clip();
    ADS[k % ADS.length](ctx, B.w, B.h);
    ctx.lineWidth = 10; ctx.strokeStyle = '#140818'; ctx.strokeRect(5, 5, B.w - 10, B.h - 10);
    ctx.restore();
  }
  atlas = new THREE.CanvasTexture(cv);
  atlas.colorSpace = THREE.NoColorSpace;
  atlas.anisotropy = 4;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.generateMipmaps = true;
  return atlas;
}

/** UV rect [u0, v0, u1, v1] (flipY-aware) for a cell. kind: 'h' | 'v' | 'b' */
export function signUV(kind, index) {
  const R = kind === 'h' ? H : kind === 'v' ? V : B;
  const n = R.cols * R.rows;
  const k = ((index % n) + n) % n;
  const x = (k % R.cols) * R.w, y = R.y + Math.floor(k / R.cols) * R.h;
  const pad = 2;
  return [(x + pad) / SIZE, 1 - (y + R.h - pad) / SIZE, (x + R.w - pad) / SIZE, 1 - (y + pad) / SIZE];
}
export const SIGN_COUNTS = { h: H.cols * H.rows, v: V.cols * V.rows, b: B.cols * B.rows };

/**
 * Emit a sign quad into a Geo (with a dark backing box). c: centre, n: facing normal (xz),
 * w,h: size, uv: rect, emit: 0..1
 */
export function addSign(g, c, nx, nz, w, h, uv, emit = 1, depth = 0.25, backing = [0.08, 0.06, 0.12]) {
  const len = Math.hypot(nx, nz) || 1; nx /= len; nz /= len;
  // right vector (seen from the front): r = up x n -> (nz, 0, -nx)
  const rx = nz, rz = -nx;
  const P = (a, b, d) => [c[0] + rx * a + nx * d, c[1] + b, c[2] + rz * a + nz * d];
  const hw = w / 2, hh = h / 2;
  g.set([1, 1, 1], 0, emit);
  g.quad(P(-hw, -hh, 0.01), P(hw, -hh, 0.01), P(hw, hh, 0.01), P(-hw, hh, 0.01), [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]]);
  void backing; void depth;
}
