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

export const DEFAULT_BINDINGS = {
  throttle: ['KeyW', 'ArrowUp'],
  reverse: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space', 'Mouse2'],
  boost: ['ShiftLeft', 'Mouse0'],
  powerslide: ['ControlLeft', 'KeyC'],
  rollLeft: ['KeyQ'],
  rollRight: ['KeyE'],
  ballCam: ['KeyF', 'Mouse1'],
  scoreboard: ['Tab'],
  pause: ['Escape', 'KeyP'],
};

export const BINDING_LABELS = {
  throttle: 'Throttle / Pitch down', reverse: 'Reverse / Pitch up', left: 'Steer / Yaw left', right: 'Steer / Yaw right',
  jump: 'Jump', boost: 'Boost', powerslide: 'Powerslide / Air roll', rollLeft: 'Air roll left', rollRight: 'Air roll right',
  ballCam: 'Ball cam', scoreboard: 'Scoreboard', pause: 'Pause',
};

// ---- camera (Rocket League: Settings > Camera) ----------------------------------
// Slider ranges [min, max, step] are the game's (Camera_TA FOVLimits, HeightLimits,
// AngleLimits, DistanceLimits, StiffnessLimits, SwivelSpeedLimits,
// TransitionSpeedLimits). FOV is horizontal at 16:9.
export const CAMERA_LIMITS = {
  fov: [60, 110, 1], distance: [100, 400, 10], height: [40, 200, 10], angle: [-15, 0, 1],
  stiffness: [0, 1, 0.05], swivel: [1, 10, 0.1], transition: [1, 2, 0.1],
};
// The game's presets (ECameraSettingsPreset; values from Camera_TA.CameraPresetSettings).
export const CAMERA_PRESETS = {
  default: { label: 'Default', fov: 90, distance: 270, height: 100, angle: -3, stiffness: 0.5, swivel: 2.5, transition: 1 },
  balanced: { label: 'Balanced', fov: 100, distance: 270, height: 100, angle: -3, stiffness: 0.5, swivel: 2.5, transition: 1.2 },
  wide: { label: 'Wide', fov: 110, distance: 280, height: 110, angle: -3, stiffness: 0.5, swivel: 5, transition: 1.5 },
  legacy: { label: 'Legacy', fov: 90, distance: 260, height: 100, angle: -3, stiffness: 0.3, swivel: 2.5, transition: 1 },
};
const CAMERA_KEYS = Object.keys(CAMERA_LIMITS);

/** Clamps every camera slider to the game's range and step (in place). */
export function sanitizeCamera(c) {
  for (const k of CAMERA_KEYS) {
    const [lo, hi, step] = CAMERA_LIMITS[k], d = CAMERA_PRESETS.default[k];
    const v = Number.isFinite(+c[k]) ? Math.min(hi, Math.max(lo, +c[k])) : d;
    c[k] = +(lo + Math.round((v - lo) / step) * step).toFixed(2);
  }
  return c;
}

/** The preset whose values the camera settings match, or 'custom'. */
export function cameraPresetOf(c) {
  for (const [name, p] of Object.entries(CAMERA_PRESETS)) if (CAMERA_KEYS.every((k) => p[k] === c[k])) return name;
  return 'custom';
}

const DEFAULTS = {
  quality: 'auto',          // auto | low | medium | high | ultra
  autoAdjust: true,         // drop quality if the frame rate is poor
  showFps: false,
  // v2: Rocket League's ranges and its Default preset (v1 had its own ranges)
  camera: { v: 2, fov: 90, distance: 270, height: 100, angle: -3, stiffness: 0.5, swivel: 2.5, transition: 1, invertSwivel: false, ballCamDefault: true, toggleBallCam: true, shake: true },
  audio: { master: 0.8, sfx: 0.9, engine: 0.7, crowd: 0.7, ui: 0.7 },
  controls: { deadzone: 0.12, dodgeDeadzone: 0.5, invertPitch: false, vibration: true, autoThrottleTouch: true, touchSize: 1, mouseSteer: false },
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
  const s = merge(DEFAULTS, stored || {});
  // Camera from before v2: keep the player's values, moved onto the game's
  // slider ranges and steps (e.g. Transition Speed below 1, Swivel steps).
  sanitizeCamera(s.camera);
  s.camera.v = 2;
  return s;
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
