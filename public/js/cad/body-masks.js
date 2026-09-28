// Projected mask textures for the body paint shader.
//
// Two canvases are drawn from the body definition:
//   side  - projected on the car's side plane (x, z)
//   plan  - projected from above (x, |w|)
// Channels: R = glass, G = black trim, B = chrome trim, A = shut-line darkness.
// The paint shader samples whichever projection faces the fragment best.

import * as THREE from 'three';

export const SIDE_BOUNDS = { x0: -3800, x1: 850, z0: 0, z1: 1450 };
export const PLAN_BOUNDS = { x0: -3800, x1: 850, w0: 0, w1: 920 };

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/**
 * Draw one channel at a time: each channel is a separate greyscale canvas,
 * packed into RGBA at the end so strokes can overlap without colour mixing.
 */
function packChannels(chs, w, h) {
  const out = canvas(w, h), octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const data = chs.map((c) => c.getContext('2d').getImageData(0, 0, w, h).data);
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = data[0][i * 4];
    img.data[i * 4 + 1] = data[1][i * 4];
    img.data[i * 4 + 2] = data[2][i * 4];
    img.data[i * 4 + 3] = 255 - data[3][i * 4]; // alpha channel stores (1 - line)
  }
  octx.putImageData(img, 0, 0);
  return out;
}

export function buildSideMask(def, { zScale = 1, side = 'left', extra = null } = {}) {
  const W = 4096, H = 1280, B = SIDE_BOUNDS;
  const sx = (x) => ((x - B.x0) / (B.x1 - B.x0)) * W;
  const sy = (z) => H - ((z * zScale - B.z0) / (B.z1 - B.z0)) * H;
  const pxPerMm = W / (B.x1 - B.x0);
  const chs = [0, 1, 2, 3].map(() => { const c = canvas(W, H); const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); return c; });
  const ctx = chs.map((c) => c.getContext('2d'));
  const poly = (g, pts) => { g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sy(z)) : g.moveTo(sx(x), sy(z)))); g.closePath(); };
  const line = (g, pts, widthMm) => { g.lineWidth = widthMm * pxPerMm; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sy(z)) : g.moveTo(sx(x), sy(z)))); g.stroke(); };

  // glass
  ctx[0].fillStyle = '#fff';
  poly(ctx[0], def.doorGlass); ctx[0].fill();
  poly(ctx[0], def.quarterGlass); ctx[0].fill();

  // chrome surround (E46 coupe: chrome side-window trim is standard)
  ctx[2].strokeStyle = '#fff';
  const surround = [...def.doorGlass.slice(0, 11), ...def.quarterGlass.slice(1, 7)];
  line(ctx[2], [def.doorGlass[0], ...def.doorGlass.slice(1, 10), [-2098, 1222], ...def.quarterGlass.slice(2, 8)], 14);
  ctx[2].globalCompositeOperation = 'destination-out';
  poly(ctx[2], def.doorGlass); ctx[2].fill(); poly(ctx[2], def.quarterGlass); ctx[2].fill();
  ctx[2].globalCompositeOperation = 'source-over';
  void surround;

  // black trim: B-pillar strip between the door glass and quarter glass, mirror sail,
  // belt seal under the glass
  ctx[1].fillStyle = '#fff'; ctx[1].strokeStyle = '#fff';
  poly(ctx[1], [[-1968, 1243], [-2098, 1222], [-2030, 908], [-1893, 888], [-1930, 1080]]); ctx[1].fill();
  poly(ctx[1], [[-760, 880], [-905, 862], [-920, 945], [-980, 1030], [-850, 960], [-770, 905]]); ctx[1].fill();
  line(ctx[1], [[-905, 861], [-1893, 887]], 7);
  line(ctx[1], [[-2030, 907], [-2596, 911], [-2640, 935]], 7);

  // shut lines (A = darkness)
  ctx[3].strokeStyle = '#fff';
  const L = def.sideLines;
  for (const k of ['door', 'fenderRear', 'bumperFront', 'bumperRear']) line(ctx[3], L[k], 2.2);
  // door handle: recess outline and pull
  line(ctx[3], L.handle, 2.0);
  ctx[1].lineWidth = 0;
  // side moulding strip (body colour with a thin dark edge top and bottom)
  const M = def.moulding;
  line(ctx[3], [[M.xFront, M.zTop], [M.xRear, M.zTop + 18]], 1.6);
  line(ctx[3], [[M.xFront, M.zBot], [M.xRear, M.zBot + 18]], 1.6);
  // fuel door (right side only on the E46)
  if (def.fuelDoor && def.fuelDoor.side === side) {
    const f = def.fuelDoor;
    ctx[3].lineWidth = 2.2 * pxPerMm;
    ctx[3].beginPath(); ctx[3].ellipse(sx(f.x), sy(f.z), f.r * pxPerMm, f.r * pxPerMm * (1 / zScale), 0, 0, Math.PI * 2); ctx[3].stroke();
  }
  // side repeater on the front fender (amber/clear lens, drawn as black trim ring + chrome)
  if (def.sideMarker) {
    const s = def.sideMarker;
    ctx[1].beginPath(); ctx[1].ellipse(sx(s.x), sy(s.z), (s.len / 2) * pxPerMm, (s.h / 2) * pxPerMm, 0, 0, Math.PI * 2); ctx[1].fill();
  }
  if (extra) extra({ ctx, sx, sy, pxPerMm, poly, line });
  return packChannels(chs, W, H);
}

export function buildPlanMask(def, { extra = null } = {}) {
  const W = 4096, H = 820, B = PLAN_BOUNDS;
  const sx = (x) => ((x - B.x0) / (B.x1 - B.x0)) * W;
  const sy = (w) => H - ((w - B.w0) / (B.w1 - B.w0)) * H;
  const pxPerMm = W / (B.x1 - B.x0);
  const chs = [0, 1, 2, 3].map(() => { const c = canvas(W, H); const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); return c; });
  const ctx = chs.map((c) => c.getContext('2d'));
  const poly = (g, pts) => { g.beginPath(); pts.forEach(([x, w], i) => (i ? g.lineTo(sx(x), sy(w)) : g.moveTo(sx(x), sy(w)))); g.closePath(); };
  const line = (g, pts, widthMm) => { g.lineWidth = widthMm * pxPerMm; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath(); pts.forEach(([x, w], i) => (i ? g.lineTo(sx(x), sy(w)) : g.moveTo(sx(x), sy(w)))); g.stroke(); };

  // Windshield: between base and top edge curves, inside the A-pillars (ue line minus the pillar trim)
  const ue = def.ue;
  const ueW = (x) => { // piecewise-linear on the table
    for (let i = 0; i < ue.length - 1; i++) {
      const a = ue[i], b = ue[i + 1];
      if ((x <= a[0] && x >= b[0])) return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    }
    return ue[ue.length - 1][1];
  };
  const curve = (tbl) => (w) => { // tbl: [[w, x]...] piecewise-linear
    for (let i = 0; i < tbl.length - 1; i++) { const [w0, x0] = tbl[i], [w1, x1] = tbl[i + 1]; if (w >= w0 && w <= w1) return x0 + (x1 - x0) * (w - w0) / (w1 - w0); }
    return tbl[tbl.length - 1][1];
  };
  const glassRegion = (xFrontEdge, xRearEdge, inset) => {
    // sample the pillar edge from front to rear
    const pts = [];
    const n = 60;
    for (let i = 0; i <= n; i++) {
      const x = xFrontEdge + (xRearEdge - xFrontEdge) * (i / n);
      pts.push([x, Math.max(0, ueW(x) - inset)]);
    }
    return pts;
  };
  const ws = def.windshield;
  const wsBase = curve(ws.base), wsTop = curve(ws.top);
  {
    const inset = 38;
    // outline: base edge from centre outwards, pillar edge from base to top, top edge back to centre
    const pts = [];
    const pillar = glassRegion(wsBase(700) - 10, wsTop(620) + 10, inset);
    for (let w = 0; w <= pillar[0][1]; w += 20) pts.push([wsBase(w), w]);
    pts.push(...pillar);
    for (let w = pillar[pillar.length - 1][1]; w >= 0; w -= 20) pts.push([wsTop(w), w]);
    // mirror to negative w is unnecessary: the texture stores |w|
    ctx[0].fillStyle = '#fff'; poly(ctx[0], pts); ctx[0].fill();
    // black frit / seal band around the windshield
    ctx[1].strokeStyle = '#fff'; line(ctx[1], [...pts, pts[0]], 16);
    ctx[1].globalCompositeOperation = 'destination-out'; const inner = pts.map(([x, w]) => [x, w]); poly(ctx[1], inner); ctx[1].fill(); ctx[1].globalCompositeOperation = 'source-over';
    ctx[1].strokeStyle = '#fff'; line(ctx[1], [...pts, pts[0]], 6);
  }
  const bl = def.backlight;
  const blTop = curve(bl.top), blBase = curve(bl.base);
  {
    const inset = 52;
    const pts = [];
    const pillar = glassRegion(blTop(600) - 10, blBase(700) + 10, inset);
    for (let w = 0; w <= pillar[0][1]; w += 20) pts.push([blTop(w), w]);
    pts.push(...pillar);
    for (let w = pillar[pillar.length - 1][1]; w >= 0; w -= 20) pts.push([blBase(w), w]);
    ctx[0].fillStyle = '#fff'; poly(ctx[0], pts); ctx[0].fill();
    ctx[1].strokeStyle = '#fff'; line(ctx[1], [...pts, pts[0]], 14);
  }
  // cowl panel (black plastic between hood and windshield)
  ctx[1].fillStyle = '#fff';
  poly(ctx[1], [[-395, 0], [-400, 520], [-412, 700], [-440, 760], [wsBase(760) + 5, 760], [wsBase(400), 400], [wsBase(0), 0]]); ctx[1].fill();

  // shut lines: hood edges and front, trunk lid
  ctx[3].strokeStyle = '#fff';
  const hoodEdge = def.hoodPlan;
  if (hoodEdge) line(ctx[3], hoodEdge, 2.4);
  const trunk = def.trunkPlan;
  if (trunk) line(ctx[3], trunk, 2.4);
  if (def.roofTrim) { ctx[3].lineWidth = 1.5; line(ctx[3], def.roofTrim, 1.6); }
  if (extra) extra({ ctx, sx, sy, pxPerMm, poly, line });
  return packChannels(chs, W, H);
}

export function maskTexture(canvasEl) {
  const t = new THREE.CanvasTexture(canvasEl);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.flipY = true;
  t.needsUpdate = true;
  return t;
}
