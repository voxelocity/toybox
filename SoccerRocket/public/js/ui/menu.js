// Menus: main, match setup, settings (video / camera / audio / controls),
// how to play, pause and post-match. Fully usable with mouse, touch,
// keyboard (arrows / enter / esc) and gamepad (d-pad / A / B).
import { QUALITY_PRESETS, BINDING_LABELS, DEFAULT_BINDINGS, saveSettings, CAMERA_LIMITS, CAMERA_PRESETS, cameraPresetOf } from '../settings.js';
import { BODY_STYLES, PAINTS, ACCENTS } from '../render/car-model.js';
import { DIFFICULTY } from '../game/ai.js';
import { scoreTable, esc } from './hud.js';

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export class Menu {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('menu-root');
    this.stack = [];
    this.focus = 0;
    this.visible = false;
    this.settingsTab = 'video';
    window.addEventListener('keydown', (e) => {
      if (!this.visible || this.app.input.rebindCallback) return;
      if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'text') { if (e.code === 'Enter' || e.code === 'Escape') e.target.blur(); return; }
      if (e.code === 'ArrowDown') { this.move(1); e.preventDefault(); }
      else if (e.code === 'ArrowUp') { this.move(-1); e.preventDefault(); }
      else if (e.code === 'ArrowLeft') { this.adjust(-1); e.preventDefault(); }
      else if (e.code === 'ArrowRight') { this.adjust(1); e.preventDefault(); }
      else if (e.code === 'Enter') { this.activate(); e.preventDefault(); }
      else if (e.code === 'Escape' || e.code === 'Backspace') { this.back(); e.preventDefault(); }
    });
  }

  get s() { return this.app.settings; }
  save() { saveSettings(this.s); }

  // ---- navigation -------------------------------------------------------------
  navs() { return [...this.root.querySelectorAll('.nav')].filter((e) => e.offsetParent !== null); }
  setFocus(i) {
    const n = this.navs();
    if (!n.length) return;
    this.focus = (i + n.length) % n.length;
    n.forEach((e, k) => e.classList.toggle('focus', k === this.focus));
    n[this.focus].scrollIntoView({ block: 'nearest' });
  }
  move(d) { this.setFocus(this.focus + d); this.app.audio && this.app.audio.ui('move'); }
  adjust(d) { const e = this.navs()[this.focus]; if (e && e._adjust) { e._adjust(d); this.app.audio && this.app.audio.ui('move'); } }
  activate() { const e = this.navs()[this.focus]; if (e) e.click(); }
  back() {
    if (this.stack.length > 1) { this.stack.pop(); this.render(); this.app.audio && this.app.audio.ui('back'); }
    else if (this.onBackAtRoot) this.onBackAtRoot();
  }
  pollPad(nav) {
    if (!this.visible || this.app.input.rebindCallback) return;
    if (nav.up) this.move(-1);
    if (nav.down) this.move(1);
    if (nav.left) this.adjust(-1);
    if (nav.right) this.adjust(1);
    if (nav.accept) this.activate();
    if (nav.back) this.back();
  }

  show(screen, ...args) {
    this.stack = [[screen, args]];
    this.visible = true;
    this.render();
  }
  push(screen, ...args) { this.stack.push([screen, args]); this.render(); this.app.audio && this.app.audio.ui('select'); }
  hide() { this.visible = false; this.root.innerHTML = ''; this.root.className = ''; this.stack = []; }

  render() {
    const [screen, args] = this.stack[this.stack.length - 1];
    this.root.innerHTML = '';
    this.root.className = 'menu ' + screen;
    const panel = this[screen](...args);
    this.root.appendChild(panel);
    this.focus = 0;
    requestAnimationFrame(() => this.setFocus(0));
  }

  // ---- widgets --------------------------------------------------------------
  button(text, fn, cls = '') {
    const b = h('button', 'mbtn nav ' + cls, text);
    b.addEventListener('click', () => { this.app.audio && this.app.audio.ui('select'); fn(); });
    b.addEventListener('mouseenter', () => { const i = this.navs().indexOf(b); if (i >= 0) this.setFocus(i); });
    return b;
  }
  cycle(label, values, current, onChange) {
    const row = h('div', 'opt nav');
    let idx = Math.max(0, values.findIndex((v) => v[0] === current));
    const render = () => { row.innerHTML = `<span class="lbl">${label}</span><span class="val"><i>‹</i><b>${values[idx][1]}</b><i>›</i></span>`; };
    row._adjust = (d) => { idx = (idx + d + values.length) % values.length; render(); onChange(values[idx][0]); };
    row.addEventListener('click', (e) => {
      const r = row.getBoundingClientRect();
      row._adjust(e.clientX && e.clientX < r.left + r.width * 0.55 ? -1 : 1);
      this.app.audio && this.app.audio.ui('move');
    });
    row.addEventListener('mouseenter', () => { const i = this.navs().indexOf(row); if (i >= 0) this.setFocus(i); });
    render();
    return row;
  }
  slider(label, min, max, step, current, fmt, onChange) {
    const row = h('div', 'opt nav slider');
    row.innerHTML = `<span class="lbl">${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${current}"><span class="num">${fmt(current)}</span>`;
    const inp = row.querySelector('input'), num = row.querySelector('.num');
    const upd = () => { num.textContent = fmt(+inp.value); onChange(+inp.value); };
    inp.addEventListener('input', upd);
    row._adjust = (d) => { inp.value = Math.min(max, Math.max(min, +inp.value + d * step)); upd(); };
    row.addEventListener('mouseenter', () => { const i = this.navs().indexOf(row); if (i >= 0) this.setFocus(i); });
    return row;
  }
  toggle(label, current, onChange) {
    return this.cycle(label, [[true, 'ON'], [false, 'OFF']], current, onChange);
  }
  panel(title, cls = '') {
    const p = h('div', 'panel ' + cls);
    if (title) p.appendChild(h('div', 'ptitle', title));
    return p;
  }

  // ---- screens ----------------------------------------------------------------
  main() {
    const p = h('div', 'mainmenu');
    p.appendChild(h('div', 'logo', '<span class="b1">SOCCER</span><span class="b2">ROCKET</span><div class="tag">rocket-powered car soccer</div>'));
    const col = h('div', 'mcol');
    col.appendChild(this.button('PLAY', () => this.push('play'), 'big'));
    col.appendChild(this.button('FREE PLAY', () => this.app.startFreeplay()));
    col.appendChild(this.button('SETTINGS', () => this.push('settings')));
    col.appendChild(this.button('HOW TO PLAY', () => this.push('howto')));
    p.appendChild(col);
    const dev = this.app.input.lastDevice;
    p.appendChild(h('div', 'mfoot', `${this.app.qualityLabel()} graphics · ${dev === 'gamepad' ? 'Controller connected' : dev === 'touch' ? 'Touch controls' : 'Keyboard & mouse'} · Arrow keys / D-pad to navigate`));
    this.onBackAtRoot = null;
    return p;
  }

  play() {
    const s = this.s, m = s.match, pl = s.player;
    const p = this.panel('EXHIBITION', 'wide');
    const grid = h('div', 'cols');
    const left = h('div', 'col'), right = h('div', 'col');
    left.appendChild(h('div', 'sect', 'MATCH'));
    left.appendChild(this.cycle('Mode', [[1, '1 v 1 Duel'], [2, '2 v 2 Doubles'], [3, '3 v 3 Standard']], m.mode, (v) => { m.mode = v; this.save(); }));
    left.appendChild(this.cycle('Bot difficulty', Object.entries(DIFFICULTY).map(([k, d]) => [k, d.label]), m.difficulty, (v) => { m.difficulty = v; this.save(); }));
    left.appendChild(this.cycle('Match length', [[3, '3 minutes'], [5, '5 minutes'], [10, '10 minutes'], [0, 'Unlimited']], m.minutes, (v) => { m.minutes = v; this.save(); }));
    left.appendChild(this.cycle('Your team', [[0, 'Blue'], [1, 'Orange']], pl.team, (v) => { pl.team = v; this.save(); this.app.previewCar && this.app.previewCar(); }));
    right.appendChild(h('div', 'sect', 'YOUR CAR'));
    const nameRow = h('div', 'opt');
    nameRow.innerHTML = `<span class="lbl">Name</span><input type="text" maxlength="16" value="${esc(pl.name)}">`;
    nameRow.querySelector('input').addEventListener('input', (e) => { pl.name = e.target.value.trim() || 'Player'; this.save(); });
    right.appendChild(nameRow);
    const customCar = this.app.custom && this.app.custom.car;
    if (customCar) right.appendChild(h('div', 'opt', `<span class="lbl">Car</span><b>${esc(customCar.name)}</b>`));
    else right.appendChild(this.cycle('Body', Object.entries(BODY_STYLES).map(([k, b]) => [k, b.label]), pl.body, (v) => { pl.body = v; this.save(); this.app.previewCar && this.app.previewCar(); }));
    right.appendChild(this.cycle('Paint', PAINTS.map((x, i) => [i, x.name]), pl.color, (v) => { pl.color = v; this.save(); this.app.previewCar && this.app.previewCar(); }));
    const accNames = ['Carbon', 'White', 'Silver', 'Gold', 'Emerald', 'Violet'];
    if (!customCar) right.appendChild(this.cycle('Accent', ACCENTS.map((x, i) => [i, accNames[i]]), pl.accent || 0, (v) => { pl.accent = v; this.save(); this.app.previewCar && this.app.previewCar(); }));
    grid.append(left, right);
    p.appendChild(grid);
    const row = h('div', 'brow');
    row.appendChild(this.button('START MATCH', () => this.app.startMatch(), 'big go'));
    row.appendChild(this.button('BACK', () => this.back()));
    p.appendChild(row);
    return p;
  }

  settings() {
    const p = this.panel('SETTINGS', 'wide');
    const tabs = h('div', 'tabs');
    for (const [k, label] of [['video', 'VIDEO'], ['camera', 'CAMERA'], ['audio', 'AUDIO'], ['controls', 'CONTROLS']]) {
      const t = this.button(label, () => { this.settingsTab = k; this.render(); }, 'tab' + (this.settingsTab === k ? ' on' : ''));
      tabs.appendChild(t);
    }
    p.appendChild(tabs);
    const body = h('div', 'tabbody');
    this['tab_' + this.settingsTab](body);
    p.appendChild(body);
    const row = h('div', 'brow');
    row.appendChild(this.button('BACK', () => this.back()));
    p.appendChild(row);
    return p;
  }

  tab_video(b) {
    const s = this.s;
    const q = [['auto', 'Auto'], ...Object.entries(QUALITY_PRESETS).map(([k, v]) => [k, v.label])];
    b.appendChild(this.cycle('Graphics quality', q, s.quality, (v) => { s.quality = v; this.save(); this.app.applyQuality(); }));
    b.appendChild(h('div', 'hint', 'Low is built for phones and older computers: no shadows, flat grass, no bloom, fewer particles.'));
    b.appendChild(this.toggle('Auto-lower quality if FPS drops', s.autoAdjust, (v) => { s.autoAdjust = v; this.save(); }));
    b.appendChild(this.slider('Render scale', 50, 100, 5, Math.round((s.renderScale || 1) * 100), (v) => `${v}%`, (v) => { s.renderScale = v / 100; this.save(); this.app.applyRenderScale(); }));
    b.appendChild(this.toggle('Show FPS', s.showFps, (v) => { s.showFps = v; this.save(); }));
    b.appendChild(this.toggle('Show car hitboxes', !!s.showHitbox, (v) => { s.showHitbox = v; this.save(); this.app.view && this.app.view.showHitboxes(v); }));
  }

  tab_camera(b) {
    // Rocket League's Settings > Camera: its presets, slider ranges and steps
    const c = this.s.camera, sv = () => this.save();
    const presets = [...Object.entries(CAMERA_PRESETS).map(([k, p]) => [k, p.label]), ['custom', 'Custom']];
    const label = () => presets.find((p) => p[0] === cameraPresetOf(c))[1];
    const rows = {};
    const presetRow = this.cycle('Preset', presets, cameraPresetOf(c), (v) => {
      if (v === 'custom') return;
      for (const k of Object.keys(CAMERA_LIMITS)) {
        c[k] = CAMERA_PRESETS[v][k];
        rows[k].querySelector('input').value = c[k];
        rows[k].querySelector('.num').textContent = rows[k]._fmt(c[k]);
      }
      sv();
    });
    b.appendChild(presetRow);
    const slider = (k, name, fmt) => {
      const [lo, hi, step] = CAMERA_LIMITS[k];
      const row = this.slider(name, lo, hi, step, c[k], fmt, (v) => { c[k] = +v.toFixed(2); sv(); presetRow.querySelector('b').textContent = label(); });
      row._fmt = fmt;
      rows[k] = row;
      b.appendChild(row);
    };
    slider('fov', 'Field of view', (v) => `${v}°`);
    slider('distance', 'Distance', (v) => v);
    slider('height', 'Height', (v) => v);
    slider('angle', 'Angle', (v) => `${v}°`);
    slider('stiffness', 'Stiffness', (v) => v.toFixed(2));
    slider('swivel', 'Swivel speed', (v) => v.toFixed(1));
    slider('transition', 'Transition speed', (v) => v.toFixed(1));
    b.appendChild(this.toggle('Camera shake', c.shake, (v) => { c.shake = v; sv(); }));
    b.appendChild(this.toggle('Invert swivel pitch', !!c.invertSwivel, (v) => { c.invertSwivel = v; sv(); }));
    b.appendChild(this.toggle('Ball cam on by default', c.ballCamDefault, (v) => { c.ballCamDefault = v; sv(); }));
    b.appendChild(this.cycle('Ball cam button', [[true, 'Toggle'], [false, 'Hold']], c.toggleBallCam, (v) => { c.toggleBallCam = v; sv(); }));
    b.appendChild(h('div', 'hint', 'Field of view is horizontal at 16:9; wider screens see more at the sides. Common pro settings: FOV 110, Distance 260–280, Height 90–110, Angle −3 to −5, Stiffness 0.35–0.50, Swivel 4–5.5, Transition 1.0–1.5.'));
  }

  tab_audio(b) {
    const a = this.s.audio;
    const pct = (v) => `${Math.round(v * 100)}%`;
    const upd = () => { this.save(); this.app.audio && this.app.audio.applyVolumes(); };
    b.appendChild(this.slider('Master', 0, 1, 0.05, a.master, pct, (v) => { a.master = v; upd(); }));
    b.appendChild(this.slider('Effects', 0, 1, 0.05, a.sfx, pct, (v) => { a.sfx = v; upd(); }));
    b.appendChild(this.slider('Engines & boost', 0, 1, 0.05, a.engine, pct, (v) => { a.engine = v; upd(); }));
    b.appendChild(this.slider('Crowd', 0, 1, 0.05, a.crowd, pct, (v) => { a.crowd = v; upd(); }));
    b.appendChild(this.slider('Menus', 0, 1, 0.05, a.ui, pct, (v) => { a.ui = v; upd(); }));
  }

  tab_controls(b) {
    const c = this.s.controls, sv = () => this.save();
    b.appendChild(this.slider('Stick deadzone', 0, 0.4, 0.01, c.deadzone, (v) => v.toFixed(2), (v) => { c.deadzone = v; sv(); }));
    b.appendChild(this.slider('Dodge deadzone', 0.2, 0.9, 0.05, c.dodgeDeadzone, (v) => v.toFixed(2), (v) => { c.dodgeDeadzone = v; sv(); }));
    b.appendChild(this.toggle('Invert pitch (controller)', c.invertPitch, (v) => { c.invertPitch = v; sv(); }));
    b.appendChild(this.toggle('Vibration', c.vibration, (v) => { c.vibration = v; sv(); }));
    b.appendChild(this.toggle('Touch: auto-accelerate', c.autoThrottleTouch, (v) => { c.autoThrottleTouch = v; sv(); }));
    b.appendChild(this.slider('Touch button size', 0.7, 1.4, 0.05, c.touchSize, (v) => `${Math.round(v * 100)}%`, (v) => { c.touchSize = v; sv(); this.app.touch && this.app.touch.root.style.setProperty('--tscale', v); }));
    b.appendChild(h('div', 'sect', 'KEYBOARD & MOUSE BINDINGS'));
    const binds = this.s.bindings;
    for (const action of Object.keys(DEFAULT_BINDINGS)) {
      const row = h('div', 'opt bind');
      row.appendChild(h('span', 'lbl', BINDING_LABELS[action]));
      for (let slot = 0; slot < 2; slot++) {
        const btn = h('button', 'key nav', esc(this.app.input.keyName((binds[action] || [])[slot])));
        btn.addEventListener('click', () => {
          btn.textContent = 'press…';
          btn.classList.add('wait');
          this.app.input.rebindCallback = (code) => {
            const list = (binds[action] || []).slice();
            if (code === 'Escape') list[slot] = undefined; else list[slot] = code;
            binds[action] = list.filter(Boolean);
            this.save();
            setTimeout(() => this.render(), 0);
          };
        });
        btn.addEventListener('mouseenter', () => { const i = this.navs().indexOf(btn); if (i >= 0) this.setFocus(i); });
        row.appendChild(btn);
      }
      b.appendChild(row);
    }
    b.appendChild(this.button('RESET BINDINGS', () => { this.s.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS)); this.save(); this.render(); }));
  }

  howto() {
    const p = this.panel('HOW TO PLAY', 'wide');
    p.appendChild(h('div', 'howto', `
      <div class="hcol"><h3>Keyboard &amp; mouse</h3>
        <p><b>W / S</b> drive, reverse · pitch in the air</p>
        <p><b>A / D</b> steer · yaw in the air</p>
        <p><b>Space</b> or <b>Right mouse</b> jump · press again in the air to double jump or (with a direction) dodge</p>
        <p><b>Shift</b> or <b>Left mouse</b> boost</p>
        <p><b>Ctrl</b> / <b>C</b> powerslide · hold in the air to air roll with A/D</p>
        <p><b>Q / E</b> air roll left / right</p>
        <p><b>F</b> or <b>Middle mouse</b> ball cam · <b>Tab</b> scoreboard · <b>Esc</b> pause</p></div>
      <div class="hcol"><h3>Controller</h3>
        <p><b>RT / LT</b> throttle / reverse · <b>Left stick</b> steer &amp; aim</p>
        <p><b>A</b> jump · <b>B</b> boost · <b>X</b> powerslide / air roll</p>
        <p><b>LB / RB</b> air roll · <b>Y</b> ball cam · <b>Right stick</b> look around</p>
        <h3>Touch</h3>
        <p><b>Left thumb</b> joystick: drive and aim · <b>right side</b> buttons: Boost, Jump, Drift</p></div>
      <div class="hcol"><h3>Tips</h3>
        <p>Big boost pads (glowing orbs) fill your tank, small pads give 12.</p>
        <p>Jump then flick a direction and jump again to dodge: a front flip is the fastest way to hit the ball hard.</p>
        <p>Hitting someone while supersonic (white trails) demolishes them.</p>
        <p>Drive straight up the curved walls. Let go of throttle and you'll slide off.</p>
        <p>Land all four wheels on the ball in the air to reset your dodge.</p></div>`));
    const row = h('div', 'brow');
    row.appendChild(this.button('BACK', () => this.back()));
    p.appendChild(row);
    return p;
  }

  pause() {
    const p = this.panel('PAUSED');
    const col = h('div', 'mcol');
    col.appendChild(this.button('RESUME', () => this.app.resume(), 'big'));
    if (!this.app.match.freeplay) col.appendChild(this.button('RESTART MATCH', () => this.app.startMatch()));
    col.appendChild(this.button('SETTINGS', () => this.push('settings')));
    col.appendChild(this.button('HOW TO PLAY', () => this.push('howto')));
    col.appendChild(this.button('LEAVE TO MENU', () => this.app.toMainMenu()));
    p.appendChild(col);
    this.onBackAtRoot = () => this.app.resume();
    return p;
  }

  postgame(match) {
    const p = this.panel('', 'wide post');
    const w = match.winner;
    const human = match.human;
    const won = human && human.team === w;
    p.appendChild(h('div', `winner ${w === 0 ? 'blue' : 'orange'}`, `${w === 0 ? 'BLUE' : 'ORANGE'} WINS`));
    p.appendChild(h('div', 'finalscore', `<span class="blue">${match.score[0]}</span> – <span class="orange">${match.score[1]}</span>${human ? `<div class="res">${won ? 'VICTORY' : 'DEFEAT'}</div>` : ''}`));
    if (match.mvp) p.appendChild(h('div', 'mvp', `MVP · ${esc(match.mvp.name)} · ${match.mvp.stats.score} pts`));
    p.appendChild(h('div', 'sbwrap', scoreTable(match)));
    const row = h('div', 'brow');
    row.appendChild(this.button('PLAY AGAIN', () => this.app.startMatch(), 'big go'));
    row.appendChild(this.button('MAIN MENU', () => this.app.toMainMenu()));
    p.appendChild(row);
    this.onBackAtRoot = () => this.app.toMainMenu();
    return p;
  }
}
