// Keyboard / mouse, gamepad and touch input merged into car controls plus
// UI actions. Gamepads use the standard mapping:
//   RT throttle, LT reverse, left stick steer/pitch/yaw, A jump, B boost,
//   X powerslide / air roll, Y ball cam, LB/RB air roll left/right,
//   Start pause, Back scoreboard, right stick camera swivel.

const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

function radial(x, y, dz) {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k];
}

export class Input {
  constructor(settings, canvas) {
    this.settings = settings;
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

    const down = (code, e) => {
      if (this.rebindCallback) { e && e.preventDefault(); const cb = this.rebindCallback; this.rebindCallback = null; cb(code); return; }
      this.keys.add(code);
      this.lastDevice = 'keyboard';
    };
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.code !== 'Escape') return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      down(e.code, e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => { down('Mouse' + e.button, e); });
    window.addEventListener('mouseup', (e) => this.keys.delete('Mouse' + e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; this.onPadConnect && this.onPadConnect(e.gamepad); });
    window.addEventListener('gamepaddisconnected', (e) => { if (this.padIndex === e.gamepad.index) this.padIndex = -1; });
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
      const [lx, ly] = radial(pad.axes[0] || 0, pad.axes[1] || 0, s.deadzone);
      const [rx, ry] = radial(pad.axes[2] || 0, pad.axes[3] || 0, 0.2);
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

    c.throttle = throttle;
    c.steer = steer;
    c.pitch = Math.max(-1, Math.min(1, pitch));
    c.jump = jump; c.boost = boost; c.handbrake = slide;
    // air roll: powerslide converts yaw into roll; dedicated buttons roll directly
    if (rollL || rollR) { c.roll = (rollR ? 1 : 0) - (rollL ? 1 : 0); c.yaw = steer; }
    else if (slide) { c.roll = steer; c.yaw = 0; }
    else { c.roll = 0; c.yaw = steer; }

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
