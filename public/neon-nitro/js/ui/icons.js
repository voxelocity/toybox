// Comic-style SVG icons for items and UI.
const ink = '#140818';
const wrap = (inner, vb = '0 0 64 64') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" stroke-linejoin="round" stroke-linecap="round">${inner}</svg>`;

const canister = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">
  <rect x="-9" y="-16" width="18" height="30" rx="5" fill="#2a8cff" stroke="${ink}" stroke-width="3"/>
  <rect x="-9" y="-6" width="18" height="8" fill="#ffffff" stroke="${ink}" stroke-width="2"/>
  <text x="0" y="1" font-size="7" text-anchor="middle" font-family="Bangers,Impact" fill="${ink}">N2O</text>
  <rect x="-4" y="-21" width="8" height="6" fill="#c9ccd6" stroke="${ink}" stroke-width="2.5"/>
  <path d="M-6 14 Q0 26 6 14 Q3 20 0 30 Q-3 20 -6 14Z" fill="#ffb21e" stroke="${ink}" stroke-width="2"/></g>`;

export const ICONS = {
  nitro: wrap(canister(32, 30, 1.25)),
  nitro3: wrap(canister(18, 34, 0.85) + canister(46, 34, 0.85) + canister(32, 26, 0.95)),
  oil: wrap(`<path d="M8 40 Q6 30 18 30 Q20 20 32 24 Q44 18 50 28 Q60 30 56 40 Q58 50 44 50 Q34 56 22 50 Q8 52 8 40Z" fill="#0c0a12" stroke="${ink}" stroke-width="3"/>
    <path d="M20 36 Q30 30 42 36" fill="none" stroke="#ff5ccf" stroke-width="3"/><path d="M22 41 Q32 36 44 41" fill="none" stroke="#20d8ff" stroke-width="3"/>
    <path d="M30 8 Q38 20 30 24 Q22 20 30 8Z" fill="#0c0a12" stroke="${ink}" stroke-width="3"/>`),
  shuriken: wrap(`<g transform="translate(32 32) rotate(12)"><path d="M0 -28 L7 -7 L28 0 L7 7 L0 28 L-7 7 L-28 0 L-7 -7Z" fill="#dfe3ee" stroke="${ink}" stroke-width="3"/>
    <circle r="6" fill="#ff2d6f" stroke="${ink}" stroke-width="3"/></g>`),
  missile: wrap(`<g transform="translate(32 32) rotate(-35)"><path d="M-22 -7 L12 -7 Q26 -7 30 0 Q26 7 12 7 L-22 7Z" fill="#ff2d45" stroke="${ink}" stroke-width="3"/>
    <path d="M-22 -7 L-30 -16 L-16 -7Z M-22 7 L-30 16 L-16 7Z" fill="#2b2f3a" stroke="${ink}" stroke-width="3"/>
    <circle cx="16" cy="-2" r="3" fill="#fff" stroke="${ink}" stroke-width="1.5"/><path d="M-24 -4 Q-36 0 -24 4" fill="#ffe23b" stroke="${ink}" stroke-width="2"/></g>`),
  daruma: wrap(`<ellipse cx="32" cy="36" rx="22" ry="24" fill="#e81e32" stroke="${ink}" stroke-width="3"/>
    <ellipse cx="32" cy="32" rx="13" ry="12" fill="#fff4e6" stroke="${ink}" stroke-width="2.5"/>
    <circle cx="27" cy="31" r="2.6" fill="${ink}"/><circle cx="37" cy="31" r="2.6" fill="${ink}"/>
    <path d="M26 26 L30 27 M38 26 L34 27" stroke="${ink}" stroke-width="2"/><path d="M32 12 L32 4" stroke="${ink}" stroke-width="3"/><circle cx="32" cy="4" r="3" fill="#ffb21e" stroke="${ink}" stroke-width="2"/>`),
  shield: wrap(`<path d="M32 6 L54 18 L54 44 L32 58 L10 44 L10 18Z" fill="#20d8ff" fill-opacity="0.55" stroke="${ink}" stroke-width="3"/>
    <path d="M32 16 L44 23 L44 38 L32 46 L20 38 L20 23Z" fill="#c9f6ff" stroke="${ink}" stroke-width="2.5"/>`),
  emp: wrap(`<circle cx="32" cy="32" r="24" fill="none" stroke="#20d8ff" stroke-width="5"/><circle cx="32" cy="32" r="24" fill="none" stroke="${ink}" stroke-width="2"/>
    <path d="M36 8 L22 34 L32 34 L26 56 L44 26 L34 26 L40 8Z" fill="#ffe23b" stroke="${ink}" stroke-width="3"/>`),
  ryu: wrap(`<path d="M6 40 Q10 22 28 20 L40 12 L38 22 Q54 22 58 34 Q50 34 48 40 Q40 36 36 44 Q26 50 14 48 Q10 54 6 40Z" fill="#1ee89c" stroke="${ink}" stroke-width="3"/>
    <path d="M28 20 L22 6 L34 16" fill="#ffe23b" stroke="${ink}" stroke-width="2.5"/><circle cx="40" cy="28" r="3.2" fill="#ff2d6f" stroke="${ink}" stroke-width="2"/>
    <path d="M56 36 Q62 44 54 52" fill="none" stroke="#fff" stroke-width="2.5"/><path d="M14 44 L20 40 L22 46" fill="#fff" stroke="${ink}" stroke-width="1.5"/>`),
  glitch: wrap(`<rect x="10" y="12" width="44" height="40" rx="4" fill="#111216" stroke="${ink}" stroke-width="3"/>
    <rect x="14" y="18" width="16" height="6" fill="#56f06b"/><rect x="24" y="28" width="22" height="5" fill="#ff2d6f"/><rect x="16" y="38" width="12" height="6" fill="#20d8ff"/>
    <path d="M36 14 L28 30 L36 30 L30 50" fill="none" stroke="#ffe23b" stroke-width="4"/>`),
};
export const ITEM_ORDER = ['nitro', 'oil', 'shuriken', 'missile', 'daruma', 'shield', 'emp', 'ryu', 'glitch', 'nitro3'];

export const UI_ICONS = {
  pause: wrap(`<rect x="16" y="12" width="11" height="40" rx="3" fill="#fff" stroke="${ink}" stroke-width="3"/><rect x="37" y="12" width="11" height="40" rx="3" fill="#fff" stroke="${ink}" stroke-width="3"/>`),
  coin: wrap(`<circle cx="32" cy="32" r="24" fill="#ffe23b" stroke="${ink}" stroke-width="4"/><text x="32" y="42" font-size="28" text-anchor="middle" font-family="Bangers,Impact" fill="${ink}">¥</text>`),
  lock: wrap(`<rect x="14" y="28" width="36" height="28" rx="5" fill="#ffe23b" stroke="${ink}" stroke-width="3"/><path d="M22 28 V20 Q22 8 32 8 Q42 8 42 20 V28" fill="none" stroke="${ink}" stroke-width="5"/>`),
  trophy: wrap(`<path d="M18 8 H46 V22 Q46 38 32 40 Q18 38 18 22Z" fill="currentColor" stroke="${ink}" stroke-width="3"/><path d="M18 12 H8 Q8 26 20 28 M46 12 H56 Q56 26 44 28" fill="none" stroke="${ink}" stroke-width="3"/><rect x="28" y="40" width="8" height="10" fill="currentColor" stroke="${ink}" stroke-width="3"/><rect x="18" y="50" width="28" height="8" rx="2" fill="currentColor" stroke="${ink}" stroke-width="3"/>`),
};
