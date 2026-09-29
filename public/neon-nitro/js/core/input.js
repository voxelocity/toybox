// Unified input: keyboard, gamepad and touch -> one control state per frame.
// Touch layout: left half = steering stick (drag), right side buttons for
// drift / item / brake. Accelerate is automatic on touch (configurable).

const KEYS = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
  drift: ['Space', 'ShiftLeft', 'ShiftRight', 'KeyK'], item: ['KeyE', 'KeyJ', 'ControlLeft', 'ControlRight', 'KeyX', 'Enter'],
  pause: ['Escape', 'KeyP'], look: ['KeyC', 'KeyQ'], respawn: ['KeyR'],
};

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.state = { steer: 0, throttle: 0, brake: 0, drift: false, driftPressed: false, driftReleased: false, item: false, itemBack: false, look: false, pause: false, respawn: false };
    this.touch = { active: false, steer: 0, drift: false, item: false, brake: false, gas: false, stickId: null, x0: 0, y0: 0 };
    this.autoAccel = true;
    this.tilt = false;
    this.tiltSteer = 0;
    this.sensitivity = 1;
    this.enabled = true;
    this._prevDrift = false;
    this._prevPad = {};
    this.lastDevice = 'keyboard';
    this._kSteer = 0;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (this._isGameKey(e.code)) e.preventDefault(); return; }
      this.down.add(e.code); this.pressed.add(e.code);
      this.lastDevice = 'keyboard';
      if (this._isGameKey(e.code) && !(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.down.delete(e.code); });
    window.addEventListener('blur', () => { this.down.clear(); });
    window.addEventListener('deviceorientation', (e) => {
      if (!this.tilt || e.gamma == null) return;
      const landscape = Math.abs(window.orientation ?? screen.orientation?.angle ?? 0) === 90;
      let v = landscape ? (e.beta ?? 0) : (e.gamma ?? 0);
      const ang = window.orientation ?? screen.orientation?.angle ?? 0;
      if (ang === -90 || ang === 270) v = -v;
      this.tiltSteer = Math.max(-1, Math.min(1, v / 22));
    });
  }

  _isGameKey(code) { for (const k in KEYS) if (KEYS[k].includes(code)) return true; return false; }
  any(name) { return KEYS[name].some((c) => this.down.has(c)); }
  hit(name) { return KEYS[name].some((c) => this.pressed.has(c)); }

  /** Attach touch controls to a container element. */
  bindTouch(root) {
    const stick = root.querySelector('.tc-stick');
    const knob = root.querySelector('.tc-knob');
    const zone = root.querySelector('.tc-steer');
    const btn = (sel, key) => {
      const el = root.querySelector(sel);
      if (!el) return;
      const on = (e) => { e.preventDefault(); this.touch[key] = true; el.classList.add('on'); this.lastDevice = 'touch'; if (key === 'item') this._touchItem = true; if (key === 'pause') this._touchPause = true; };
      const off = (e) => { e.preventDefault(); this.touch[key] = false; el.classList.remove('on'); };
      el.addEventListener('touchstart', on, { passive: false });
      el.addEventListener('touchend', off, { passive: false });
      el.addEventListener('touchcancel', off, { passive: false });
      el.addEventListener('mousedown', on); el.addEventListener('mouseup', off); el.addEventListener('mouseleave', off);
    };
    btn('.tc-drift', 'drift'); btn('.tc-item', 'item'); btn('.tc-brake', 'brake'); btn('.tc-gas', 'gas'); btn('.tc-pause', 'pause'); btn('.tc-back', 'back');
    if (!zone) return;
    const R = 60;
    const start = (e) => {
      for (const t of e.changedTouches) {
        if (this.touch.stickId != null) break;
        this.touch.stickId = t.identifier; this.touch.x0 = t.clientX; this.touch.y0 = t.clientY;
        stick.style.left = t.clientX + 'px'; stick.style.top = t.clientY + 'px';
        stick.classList.add('on');
        this.touch.active = true; this.lastDevice = 'touch';
      }
      e.preventDefault();
    };
    const move = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.touch.stickId) continue;
        const dx = t.clientX - this.touch.x0;
        const dy = t.clientY - this.touch.y0;
        const cl = Math.max(-R, Math.min(R, dx));
        this.touch.steer = cl / R;
        this.touch.stickDown = dy > R * 0.6;
        knob.style.transform = `translate(${cl}px, ${Math.max(-R, Math.min(R, dy)) * 0.4}px)`;
      }
      e.preventDefault();
    };
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.touch.stickId) continue;
        this.touch.stickId = null; this.touch.steer = 0; this.touch.stickDown = false;
        knob.style.transform = ''; stick.classList.remove('on');
      }
      e.preventDefault();
    };
    zone.addEventListener('touchstart', start, { passive: false });
    zone.addEventListener('touchmove', move, { passive: false });
    zone.addEventListener('touchend', end, { passive: false });
    zone.addEventListener('touchcancel', end, { passive: false });
  }

  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Call once per frame. */
  poll(dt) {
    const s = this.state;
    const pad = this._pad();
    let steer = 0, throttle = 0, brake = 0, drift = false, item = false, back = false, pause = false, look = false, respawn = false;
    // keyboard (smoothed steering)
    const kl = this.any('left'), kr = this.any('right');
    const target = (kr ? 1 : 0) - (kl ? 1 : 0);
    const rate = target === 0 ? 10 : (Math.sign(target) !== Math.sign(this._kSteer) ? 12 : 6);
    this._kSteer += Math.max(-rate * dt, Math.min(rate * dt, target - this._kSteer));
    steer = this._kSteer;
    if (this.any('up')) throttle = 1;
    if (this.any('down')) brake = 1;
    if (this.any('drift')) drift = true;
    if (this.hit('item')) item = true;
    if (this.any('down')) back = true;
    if (this.hit('pause')) pause = true;
    if (this.any('look')) look = true;
    if (this.hit('respawn')) respawn = true;
    // gamepad
    if (pad) {
      const ax = pad.axes[0] || 0;
      const dz = 0.15;
      const a = Math.abs(ax) < dz ? 0 : Math.sign(ax) * (Math.abs(ax) - dz) / (1 - dz);
      const b = (i) => pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4);
      const val = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      const edge = (i) => { const v = b(i); const was = this._prevPad[i]; this._prevPad[i] = v; return v && !was; };
      if (a !== 0 || b(0) || b(7)) this.lastDevice = 'pad';
      if (a !== 0) steer = a;
      if (b(14)) steer = -1; if (b(15)) steer = 1;
      throttle = Math.max(throttle, b(0) ? 1 : 0, val(7));
      brake = Math.max(brake, b(1) ? 1 : 0, val(6) > 0.5 ? 1 : 0);
      if (b(5) || b(4) && false) drift = true;
      if (val(6) > 0.5 && b(0)) { brake = 0; drift = true; }
      const itemEdge = edge(2) | edge(3) | edge(4);
      if (itemEdge) item = true;
      if ((pad.axes[1] || 0) > 0.5) back = true;
      if (edge(9)) pause = true;
      if (b(11) || b(10)) look = true;
      if (edge(8)) respawn = true;
    }
    // touch
    const T = this.touch;
    if (this.lastDevice === 'touch') {
      const ts = this.tilt ? this.tiltSteer : T.steer;
      if (Math.abs(ts) > Math.abs(steer)) steer = Math.sign(ts) * Math.min(1, Math.abs(ts) * this.sensitivity);
      if (this.autoAccel && !T.brake) throttle = 1;
      if (T.gas) throttle = 1;
      if (T.brake) { brake = 1; throttle = 0; }
      if (T.drift) drift = true;
      if (this._touchItem) { item = true; this._touchItem = false; }
      if (T.back || T.stickDown) back = true;
      if (this._touchPause) { pause = true; this._touchPause = false; }
    }
    if (!this.enabled) { steer = 0; throttle = 0; brake = 0; drift = false; item = false; }
    s.steer = Math.max(-1, Math.min(1, steer));
    s.throttle = throttle;
    s.brake = brake;
    s.driftPressed = drift && !this._prevDrift;
    s.driftReleased = !drift && this._prevDrift;
    s.drift = drift;
    this._prevDrift = drift;
    s.item = item;
    s.itemBack = back;
    s.pause = pause;
    s.look = look;
    s.respawn = respawn;
    this.pressed.clear();
    return s;
  }

  /** Menu navigation helpers (edge-triggered). */
  menuKeys() {
    return { up: this.hit('up'), down: this.hit('down'), left: this.hit('left'), right: this.hit('right'), ok: this.pressed.has('Enter') || this.pressed.has('Space'), back: this.pressed.has('Escape') || this.pressed.has('Backspace') };
  }
}
