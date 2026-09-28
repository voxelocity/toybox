// Interpolation helpers used by the CAD generators.

/**
 * Monotone cubic (PCHIP / Fritsch–Carlson) interpolator over [x, y] pairs.
 * Points may be given in any x order; they are sorted ascending.
 * Outside the range the end values are held (no extrapolation surprises).
 */
export function pchip(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  // collapse duplicate x
  const xs = [], ys = [];
  for (const [x, y] of pts) {
    if (xs.length && Math.abs(x - xs[xs.length - 1]) < 1e-9) { ys[ys.length - 1] = y; continue; }
    xs.push(x); ys.push(y);
  }
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  const m = new Array(n);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  const f = (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] > x) hi = mid; else lo = mid; }
    const t = (x - xs[lo]) / h[lo], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h[lo] * m[lo]
      + (-2 * t3 + 3 * t2) * ys[lo + 1] + (t3 - t2) * h[lo] * m[lo + 1];
  };
  f.domain = [xs[0], xs[n - 1]];
  return f;
}

/** Piecewise-linear interpolator (held at ends). */
export function lerpTable(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1];
    const last = pts[pts.length - 1];
    if (x >= last[0]) return last[1];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      if (x >= x0 && x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
    return last[1];
  };
}

/** Build a pchip for each column of rows like [x, a, b, ...]. */
export function pchipColumns(rows) {
  const cols = rows[0].length - 1;
  const out = [];
  for (let c = 1; c <= cols; c++) out.push(pchip(rows.map((r) => [r[0], r[c]])));
  return out;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Polynomial smooth minimum (k = blend width in the same units). */
export function smin(a, b, k) {
  if (!isFinite(a)) return b;
  if (!isFinite(b)) return a;
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}

/** Quadratic Bezier point. */
export function qbez(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}

/** Cubic Bezier point. */
export function cbez(p0, p1, p2, p3, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** Inverse of a monotone table given as [w, x] pairs: returns w for a given x. */
export function inverseTable(pairs) {
  // pairs: [w, x] with x decreasing as w increases (nose) or increasing (tail)
  const pts = [...pairs].sort((a, b) => a[0] - b[0]);
  const f = pchip(pts);
  const wMax = pts[pts.length - 1][0];
  const xAt0 = pts[0][1], xAtMax = pts[pts.length - 1][1];
  const decreasing = xAtMax < xAt0;
  return (x) => {
    // returns Infinity when the whole width is available at this x
    if (decreasing) { if (x <= xAtMax) return Infinity; if (x >= xAt0) return 0; }
    else { if (x >= xAtMax) return Infinity; if (x <= xAt0) return 0; }
    let lo = 0, hi = wMax;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2, xm = f(mid);
      if (decreasing ? xm > x : xm < x) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
}

/** Point in polygon (even-odd), polygon as [[x, y], ...]. */
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
