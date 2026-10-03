// On-screen controls for phones / tablets. Left half: floating joystick
// (steer + throttle on the ground, pitch / yaw in the air). Right side:
// BOOST, JUMP, DRIFT (powerslide / air roll), brake, ball cam and pause.
export class TouchControls {
  constructor(root, settings) {
    this.root = root;
    this.settings = settings;
    this.state = { active: false, stickX: 0, stickY: 0, jump: false, boost: false, drift: false, brake: false, ballCam: false, pause: false };
    this.stickId = null;
    this.buttons = {};
    this.build();
  }

  build() {
    const r = this.root;
    r.innerHTML = `
      <div class="t-zone" id="t-zone"><div class="t-base" id="t-base"><div class="t-knob" id="t-knob"></div></div></div>
      <button class="t-btn t-boost" data-k="boost">BOOST</button>
      <button class="t-btn t-jump" data-k="jump">JUMP</button>
      <button class="t-btn t-drift" data-k="drift">DRIFT</button>
      <button class="t-btn t-brake small" data-k="brake">BRAKE</button>
      <button class="t-btn t-cam small" data-k="ballCam">CAM</button>
      <button class="t-btn t-pause small" data-k="pause">II</button>`;
    const scale = this.settings.controls.touchSize || 1;
    r.style.setProperty('--tscale', scale);
    const zone = r.querySelector('#t-zone');
    this.base = r.querySelector('#t-base');
    this.knob = r.querySelector('#t-knob');
    const R = 60 * scale;
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.cx = e.clientX; this.cy = e.clientY;
      this.base.style.left = `${e.clientX}px`; this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('on');
      this.state.active = true;
      this.moveStick(e.clientX, e.clientY, R);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) { this.moveStick(e.clientX, e.clientY, R); e.preventDefault(); } });
    const end = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.state.stickX = 0; this.state.stickY = 0;
      this.knob.style.transform = 'translate(-50%,-50%)';
      this.base.classList.remove('on');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    for (const b of r.querySelectorAll('.t-btn')) {
      const k = b.dataset.k;
      this.buttons[k] = b;
      const on = (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); this.state[k] = true; this.state.active = true; b.classList.add('down'); };
      const off = (e) => { e.preventDefault(); this.state[k] = false; b.classList.remove('down'); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  moveStick(x, y, R) {
    let dx = x - this.cx, dy = y - this.cy;
    const m = Math.hypot(dx, dy);
    if (m > R) { dx *= R / m; dy *= R / m; }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const dz = 0.12;
    let sx = dx / R, sy = dy / R;
    const mm = Math.hypot(sx, sy);
    if (mm < dz) { sx = 0; sy = 0; } else { const k = Math.min(1, (mm - dz) / (1 - dz)) / mm; sx *= k; sy *= k; }
    this.state.stickX = sx; this.state.stickY = sy;
  }

  setBoost(v) { if (this.buttons.boost) this.buttons.boost.style.setProperty('--fill', `${v}%`); }

  show(v) {
    this.root.classList.toggle('hidden', !v);
    if (!v) for (const k of Object.keys(this.state)) if (typeof this.state[k] === 'boolean') this.state[k] = false;
  }
}
