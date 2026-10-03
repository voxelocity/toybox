// Keyboard / mouse, gamepad and touch input merged into car controls plus
// UI actions. Gamepads use the standard mapping:
//   RT throttle, LT reverse, left stick steer/pitch/yaw, A jump, B boost,
//   X powerslide / air roll, Y ball cam, LB/RB air roll left/right,
//   Start pause, Back scoreboard, right stick camera swivel.
// These are Rocket League's controller defaults (its air roll left / right are
// unbound; LB / RB are spare there, so they roll here). The left stick goes
// through the game's Controls settings: Controller Deadzone (0.10), Deadzone
// Shape (Cross / Circle), Steering Sensitivity and Aerial Sensitivity (1.00);
// Dodge Deadzone (0.50) is applied by the car (CarConfig::dodgeDeadzone).

import { migrateControls } from '../settings.js';

const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const QUARTER = Math.PI / 4;
const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
const axisDz = (v, dz) => { const a = Math.abs(v); return a <= dz ? 0 : Math.sign(v) * Math.min(1, (a - dz) / (1 - dz)); };

// Circle: a round dead area; the stick's magnitude past it is rescaled to 0..1.
function radial(x, y, dz, out) {
  const m = Math.hypot(x, y);
  if (m <= dz) { out[0] = 0; out[1] = 0; return out; }
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  out[0] = x * k; out[1] = y * k;
  return out;
}

// Cross: the deflection's angle is mapped onto the square (45 degrees reads as
// full on both axes, so diagonals reach (1, 1) like a keyboard), then each axis
// gets its own dead band, so the dead area is a cross along the axes.
function cross(x, y, dz, out) {
  const m = Math.min(1, Math.hypot(x, y));
  if (m === 0) { out[0] = 0; out[1] = 0; return out; }
  const ax = Math.abs(x), ay = Math.abs(y);
  let sx, sy;
  if (ax >= ay) { sx = m; sy = m * Math.atan2(ay, ax) / QUARTER; } else { sy = m; sx = m * Math.atan2(ax, ay) / QUARTER; }
  out[0] = axisDz(Math.sign(x) * sx, dz);
  out[1] = axisDz(Math.sign(y) * sy, dz);
  return out;
}

/** Applies Deadzone Shape + Controller Deadzone to a stick (out = [x, y]). */
export function stick(x, y, dz, shape, out = [0, 0]) {
  return shape === 'circle' ? radial(x, y, dz, out) : cross(x, y, dz, out);
}

export class Input {
  constructor(settings, canvas) {
    this.settings = migrateControls(settings);
    this.keys = new Set();
    this.prevActions = {};
    this.actions = {};
    this.controls = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false };
    this.swivel = { x: 0, y: 0 };
    this.lastDevice = 'keyboard';
    this.touch = null; // set by TouchControls
    this.padIndex = -1;
    this.padPrev = [];
    this.menuNav = { up: false, down: false, left: false, right: false, accept: false, back: false };
    this.rebindCallback = null;
    this.padRepeat = 0;
    this.isPlaying = null; // set by the App: () => true while a match is being played
    this._ls = [0, 0]; this._rs = [0, 0];

    const down = (code, e) => {
      if (this.rebindCallback) { e && e.preventDefault(); const cb = this.rebindCallback; this.rebindCallback = null; cb(code); return; }
      this.keys.add(code);
      this.lastDevice = 'keyboard';
    };
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.code !== 'Escape') return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      // Ctrl / Cmd + a bound key mid-match (e.g. throttle while a Ctrl powerslide
      // is held) must not reach the browser: Ctrl+S / F / D / E / P open dialogs or
      // steal focus. Ctrl+W / T / N can't be cancelled; the App's beforeunload
      // guard turns a tab close into a 'Leave site?' prompt instead.
      if ((e.ctrlKey || e.metaKey) && this.playing() && this.isBound(e.code)) e.preventDefault();
      down(e.code, e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => { down('Mouse' + e.button, e); });
    window.addEventListener('mouseup', (e) => {
      this.keys.delete('Mouse' + e.button);
      // the thumb buttons navigate back / forward on mouseup
      if (e.button > 2 && this.playing() && this.isBound('Mouse' + e.button)) e.preventDefault();
    });
    // Rebinding from the menu: the menu covers the canvas, so take the next
    // mouse button anywhere and swallow the click it would otherwise make.
    window.addEventListener('mousedown', (e) => {
      if (!this.rebindCallback || e.target === canvas) return;
      e.preventDefault(); e.stopPropagation();
      this.swallowClick = true;
      down('Mouse' + e.button, e);
    }, true);
    window.addEventListener('click', (e) => { if (this.swallowClick) { this.swallowClick = false; e.preventDefault(); e.stopPropagation(); } }, true);
    window.addEventListener('auxclick', (e) => { if (this.swallowClick) { this.swallowClick = false; e.preventDefault(); e.stopPropagation(); } }, true);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; this.onPadConnect && this.onPadConnect(e.gamepad); });
    window.addEventListener('gamepaddisconnected', (e) => { if (this.padIndex === e.gamepad.index) this.padIndex = -1; });
  }

  playing() { return !!(this.isPlaying && this.isPlaying()); }

  isBound(code) {
    const b = this.settings.bindings;
    for (const k in b) if (b[k] && b[k].includes(code)) return true;
    return false;
  }

  bound(action) {
    const b = this.settings.bindings[action] || [];
    for (const c of b) if (this.keys.has(c)) return true;
    return false;
  }

  getPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.padIndex >= 0 && pads[this.padIndex]) return pads[this.padIndex];
    for (const p of pads) if (p && p.connected) { this.padIndex = p.index; return p; }
    return null;
  }

  poll(dt) {
    const s = this.settings.controls;
    const c = this.controls;
    // keyboard
    const kThrottle = (this.bound('throttle') ? 1 : 0) - (this.bound('reverse') ? 1 : 0);
    const kSteer = (this.bound('right') ? 1 : 0) - (this.bound('left') ? 1 : 0);
    let throttle = kThrottle, steer = kSteer, pitch = -kThrottle;
    let jump = this.bound('jump'), boost = this.bound('boost'), slide = this.bound('powerslide');
    let rollL = this.bound('rollLeft'), rollR = this.bound('rollRight');
    let ballCam = this.bound('ballCam'), scoreboard = this.bound('scoreboard'), pause = this.bound('pause');
    this.swivel.x = 0; this.swivel.y = 0;

    // gamepad
    const pad = this.getPad();
    const nav = { up: false, down: false, left: false, right: false, accept: false, back: false };
    if (pad) {
      const b = (i) => !!(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5));
      const v = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      const [lx, ly] = stick(pad.axes[0] || 0, pad.axes[1] || 0, s.deadzone, s.deadzoneShape, this._ls);
      const [rx, ry] = radial(pad.axes[2] || 0, pad.axes[3] || 0, Math.max(0.2, s.deadzone), this._rs);
      const rt = v(PAD.RT), lt = v(PAD.LT);
      const any = Math.abs(lx) + Math.abs(ly) + rt + lt > 0.05 || pad.buttons.some((x) => x && x.pressed);
      if (any) this.lastDevice = 'gamepad';
      if (this.lastDevice === 'gamepad') {
        throttle = rt - lt;
        steer = lx;
        pitch = ly * (s.invertPitch ? -1 : 1);
        jump = jump || b(PAD.A); boost = boost || b(PAD.B); slide = slide || b(PAD.X);
        rollL = rollL || b(PAD.LB); rollR = rollR || b(PAD.RB);
        ballCam = ballCam || b(PAD.Y); scoreboard = scoreboard || b(PAD.BACK); pause = pause || b(PAD.START);
        this.swivel.x = rx; this.swivel.y = ry;
      }
      // menu navigation with repeat
      const up = b(PAD.UP) || ly < -0.6, dn = b(PAD.DOWN) || ly > 0.6, lf = b(PAD.LEFT) || lx < -0.6, rg = b(PAD.RIGHT) || lx > 0.6;
      this.padRepeat -= dt;
      const prev = this.padPrev;
      const edge = (name, now) => {
        const was = prev[name];
        prev[name] = now;
        if (now && (!was || this.padRepeat <= 0)) { this.padRepeat = was ? 0.12 : 0.35; return true; }
        return false;
      };
      nav.up = edge('up', up); nav.down = edge('down', dn); nav.left = edge('left', lf); nav.right = edge('right', rg);
      nav.accept = b(PAD.A) && !prev.a; prev.a = b(PAD.A);
      nav.back = b(PAD.B) && !prev.bb; prev.bb = b(PAD.B);
      nav.start = b(PAD.START) && !prev.st; prev.st = b(PAD.START);
    }
    this.menuNav = nav;

    // touch
    const t = this.touch && this.touch.state;
    if (t && t.active) {
      this.lastDevice = 'touch';
      const auto = this.settings.controls.autoThrottleTouch;
      const sx = t.stickX, sy = t.stickY;
      steer = sx;
      pitch = sy;
      if (auto) throttle = t.brake ? -1 : 1;
      else throttle = Math.max(-1, Math.min(1, -sy * 1.6));
      jump = jump || t.jump; boost = boost || t.boost; slide = slide || t.drift;
      ballCam = ballCam || t.ballCam;
      pause = pause || t.pause;
    }

    // Steering / Aerial Sensitivity scale the analog input, clamped to full
    // (keys are digital full scale, so they are left as they are).
    const analog = this.lastDevice !== 'keyboard';
    const steerSens = analog && s.steeringSensitivity || 1, airSens = analog && s.aerialSensitivity || 1;
    const air = steer * airSens;
    c.throttle = clamp1(throttle);
    c.steer = clamp1(steer * steerSens);
    c.pitch = clamp1(pitch * airSens);
    c.jump = jump; c.boost = boost; c.handbrake = slide;
    // air roll: powerslide converts yaw into roll; dedicated buttons roll directly
    if (rollL || rollR) { c.roll = (rollR ? 1 : 0) - (rollL ? 1 : 0); c.yaw = clamp1(air); }
    else if (slide) { c.roll = clamp1(air); c.yaw = 0; }
    else { c.roll = 0; c.yaw = clamp1(air); }

    const a = { ballCam, scoreboard, pause, jump, boost };
    this.pressed = {};
    for (const k of Object.keys(a)) this.pressed[k] = a[k] && !this.prevActions[k];
    this.actions = a;
    this.prevActions = a;
  }

  rumble(strong, weak, ms) {
    if (!this.settings.controls.vibration) return;
    const pad = this.getPad();
    if (pad && pad.vibrationActuator && this.lastDevice === 'gamepad') {
      try { pad.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch { /* unsupported */ }
    } else if (this.lastDevice === 'touch' && navigator.vibrate) {
      try { navigator.vibrate(Math.min(ms, 60)); } catch { /* unsupported */ }
    }
  }

  keyName(code) {
    if (!code) return '—';
    if (code.startsWith('Mouse')) return ['Left mouse', 'Middle mouse', 'Right mouse', 'Mouse 4', 'Mouse 5'][+code.slice(5)] || code;
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/(Left|Right)$/, ' $1').replace('Arrow', 'Arrow ');
  }
}
