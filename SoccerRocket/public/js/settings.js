// User settings (persisted to localStorage) and graphics quality presets.

export const QUALITY_PRESETS = {
  low: {
    label: 'Low', maxPixelRatio: 1, renderScale: 0.8, shadowSize: 0, grassShells: 0, bloom: 0,
    crowd: 0, particles: 0.35, sky: 'procedural', msaa: 0, physicalMaterials: false, trails: true, envSize: 0,
    flares: false, stadiumDetail: 0,
  },
  medium: {
    label: 'Medium', maxPixelRatio: 1.25, renderScale: 1, shadowSize: 1024, grassShells: 8, bloom: 1,
    crowd: 0.45, particles: 0.6, sky: 'sky_1k.hdr', msaa: 0, physicalMaterials: true, trails: true, envSize: 128,
    flares: true, stadiumDetail: 1,
  },
  high: {
    label: 'High', maxPixelRatio: 1.5, renderScale: 1, shadowSize: 2048, grassShells: 16, bloom: 2,
    crowd: 1, particles: 1, sky: 'sky_2k.hdr', msaa: 4, physicalMaterials: true, trails: true, envSize: 256,
    flares: true, stadiumDetail: 2,
  },
  ultra: {
    label: 'Ultra', maxPixelRatio: 2, renderScale: 1, shadowSize: 4096, grassShells: 26, bloom: 2,
    crowd: 1, particles: 1, sky: 'sky_2k.hdr', msaa: 4, physicalMaterials: true, trails: true, envSize: 256,
    flares: true, stadiumDetail: 2,
  },
};

// Rocket League's default keyboard & mouse bindings (primary slot); the second
// slot holds extras the game leaves free. Powerslide is Left Shift, not Ctrl:
// on Windows, Ctrl + W / S / F... are browser shortcuts (Ctrl+W closes the tab).
export const DEFAULT_BINDINGS = {
  throttle: ['KeyW', 'ArrowUp'],
  reverse: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Mouse2'],
  boost: ['Mouse0'],
  powerslide: ['ShiftLeft'],
  rollLeft: ['KeyQ'],
  rollRight: ['KeyE'],
  ballCam: ['Space'],
  scoreboard: ['Tab'],
  pause: ['Escape', 'KeyP'],
};

// Defaults before controls v2; stored bindings still equal to these move to
// the new defaults, anything the player rebound is kept.
const OLD_BINDINGS = {
  jump: ['Space', 'Mouse2'], boost: ['ShiftLeft', 'Mouse0'], powerslide: ['ControlLeft', 'KeyC'], ballCam: ['KeyF', 'Mouse1'],
};

/** Moves settings stored before controls v2 to the new defaults (in place). */
export function migrateControls(s) {
  const c = s.controls;
  if (c.v >= 2) return s; // (not in DEFAULTS, so it is only set once stored)
  if (c.deadzone === 0.12) c.deadzone = DEFAULTS.controls.deadzone;
  const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
  for (const k of Object.keys(OLD_BINDINGS)) if (same(s.bindings[k], OLD_BINDINGS[k])) s.bindings[k] = DEFAULT_BINDINGS[k].slice();
  c.v = 2;
  return s;
}

export const BINDING_LABELS = {
  throttle: 'Throttle / Pitch down', reverse: 'Reverse / Pitch up', left: 'Steer / Yaw left', right: 'Steer / Yaw right',
  jump: 'Jump', boost: 'Boost', powerslide: 'Powerslide / Air roll', rollLeft: 'Air roll left', rollRight: 'Air roll right',
  ballCam: 'Ball cam', scoreboard: 'Scoreboard', pause: 'Pause',
};

const DEFAULTS = {
  quality: 'auto',          // auto | low | medium | high | ultra
  autoAdjust: true,         // drop quality if the frame rate is poor
  showFps: false,
  camera: { fov: 110, distance: 270, height: 100, angle: -3, stiffness: 0.45, swivel: 4.5, transition: 1.2, ballCamDefault: true, toggleBallCam: true, shake: true },
  audio: { master: 0.8, sfx: 0.9, engine: 0.7, crowd: 0.7, ui: 0.7 },
  // Rocket League's Controls defaults: Controller Deadzone 0.10, Deadzone Shape
  // Cross, Dodge Deadzone 0.50, Steering / Aerial Sensitivity 1.00.
  controls: {
    deadzone: 0.1, deadzoneShape: 'cross', dodgeDeadzone: 0.5, steeringSensitivity: 1, aerialSensitivity: 1,
    invertPitch: false, vibration: true, autoThrottleTouch: true, touchSize: 1, mouseSteer: false,
  },
  bindings: DEFAULT_BINDINGS,
  player: { name: 'Player', body: 'striker', color: 0, team: 0 },
  match: { mode: 3, difficulty: 'pro', minutes: 5 },
};

const KEY = 'soccer-rocket-settings-v1';

function merge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over.slice() : base.slice();
  if (base && typeof base === 'object') {
    const out = {};
    for (const k of Object.keys(base)) out[k] = merge(base[k], over ? over[k] : undefined);
    if (over) for (const k of Object.keys(over)) if (!(k in out)) out[k] = over[k];
    return out;
  }
  return over === undefined ? base : over;
}

export function loadSettings() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { stored = null; }
  return merge(DEFAULTS, stored || {});
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export function resetSettings() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return merge(DEFAULTS, {});
}

/** Guess a sensible preset from the device. */
export function detectQuality(renderer) {
  const ua = navigator.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  let gpu = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch { /* ignore */ }
  gpu = String(gpu);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;
  if (/SwiftShader|llvmpipe|Software|Microsoft Basic/i.test(gpu)) return { preset: 'low', mobile, gpu };
  if (mobile) {
    const strong = /Apple GPU|Adreno \(TM\) (7[3-9]\d|8\d\d)|Mali-G7[1-9]|Mali-G[1-9]\d\d|Immortalis/i.test(gpu) && mem >= 6;
    return { preset: strong ? 'medium' : 'low', mobile, gpu };
  }
  if (/Intel.*(HD|UHD) Graphics( [2-6]\d\d)?\b/i.test(gpu) || cores <= 2 || mem <= 4) return { preset: 'medium', mobile, gpu };
  if (/RTX [34]0[6-9]0|RTX 50|RX 7[89]00|RX 9070|Apple M[2-9] (Pro|Max|Ultra)/i.test(gpu)) return { preset: 'ultra', mobile, gpu };
  return { preset: 'high', mobile, gpu };
}

export function isTouchDevice() {
  return (navigator.maxTouchPoints || 0) > 0 && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
}
