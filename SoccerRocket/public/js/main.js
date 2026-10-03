// Soccer Rocket: app bootstrap, main loop and glue between simulation,
// rendering, audio and UI.
import * as THREE from 'three';
import { loadSettings, saveSettings, QUALITY_PRESETS, detectQuality, isTouchDevice } from './settings.js';
import { Renderer } from './render/renderer.js';
import { SceneView } from './render/scene-view.js';
import { ChaseCamera } from './render/camera.js';
import { Match } from './game/match.js';
import { Input } from './game/input.js';
import { makeCarState, captureCar, lerpCar, makeBallState, captureBall, lerpBall } from './game/snapshot.js';
import { Hud, esc } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { TouchControls } from './ui/touch.js';
import { AudioEngine } from './audio/audio.js';
import { DT, BALL_RADIUS } from './physics/constants.js';
import { V3 } from './physics/math.js';
import { BODY_STYLES, PAINTS, ACCENTS } from './render/car-model.js';
import { TEAM_RGB } from './render/effects.js';

const ORDER = ['low', 'medium', 'high', 'ultra'];
const $ = (id) => document.getElementById(id);
const toThree = (p) => new THREE.Vector3(p.x * 0.01, p.z * 0.01, -p.y * 0.01);

class App {
  async boot() {
    this.settings = loadSettings();
    const canvas = $('game');
    this.renderer = new Renderer(canvas, QUALITY_PRESETS.low);
    this.detected = detectQuality(this.renderer.renderer);
    this.isTouch = isTouchDevice() || this.detected.mobile;
    this.qName = this.resolveQualityName();
    this.renderer.applyQuality(this.qualityPreset());
    this.progress(0.05, 'Preparing stadium…');

    this.input = new Input(this.settings, canvas);
    this.hud = new Hud();
    this.menu = new Menu(this);
    this.audio = new AudioEngine(this.settings);
    if (this.isTouch) {
      this.touch = new TouchControls($('touch'), this.settings);
      this.input.touch = this.touch;
    }
    this.cam = new ChaseCamera(this.renderer.camera, this.renderer, this.settings);

    await this.renderer.loadSky('assets/hdri/', (f) => this.progress(0.05 + f * 0.55, 'Loading sky…')).catch((e) => {
      console.warn('sky failed, using procedural', e);
      return this.renderer.loadSky('', null);
    });
    this.progress(0.62, 'Building arena…');
    await nextFrame();
    this.view = new SceneView(this.renderer, this.qualityPreset());
    this.progress(0.7, 'Synthesising sound…');
    await this.audio.init((f) => this.progress(0.7 + f * 0.28, 'Synthesising sound…'));
    this.progress(1, 'Ready');

    this.acc = 0;
    this.time = 0;
    this.paused = false;
    this.frameTimes = [];
    this.fpsAcc = 0; this.fpsFrames = 0;
    this.perfTimer = 0; this.perfFrames = 0; this.perfSum = 0;
    const unlock = () => { this.audio.unlock(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('gamepadconnected', unlock);
    window.addEventListener('blur', () => { if (this.mode === 'match' && !this.paused && !this.match.freeplay) this.pause(); });
    window.addEventListener('resize', () => this.checkOrientation());
    this.checkOrientation();

    this.toMainMenu();
    $('loading').classList.add('fade');
    setTimeout(() => $('loading').remove(), 700);
    window.__ready = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  progress(f, text) {
    const fill = $('loadfill'), t = $('loadtext');
    if (fill) fill.style.width = `${Math.round(f * 100)}%`;
    if (t && text) t.textContent = text;
  }

  // ---- quality ----------------------------------------------------------------
  resolveQualityName() {
    const forced = new URLSearchParams(location.search).get('q');
    if (forced && QUALITY_PRESETS[forced]) return forced;
    const q = this.settings.quality;
    return q === 'auto' ? (this.autoQuality || this.detected.preset) : q;
  }
  qualityPreset() {
    const base = QUALITY_PRESETS[this.qName] || QUALITY_PRESETS.medium;
    return { ...base, renderScale: base.renderScale * (this.settings.renderScale || 1) };
  }
  qualityLabel() { return (this.settings.quality === 'auto' ? 'Auto · ' : '') + (QUALITY_PRESETS[this.qName] || {}).label; }

  async applyQuality() {
    const name = this.resolveQualityName();
    if (name === this.qName && this.view) return;
    this.qName = name;
    const q = this.qualityPreset();
    this.view.dispose();
    this.renderer.applyQuality(q);
    await this.renderer.loadSky('assets/hdri/').catch(() => this.renderer.loadSky('', null));
    this.view = new SceneView(this.renderer, q);
    if (this.match) this.view.setPlayers(this.decoratedPlayers(), this.settings);
    this.toast(`Graphics: ${QUALITY_PRESETS[name].label}`);
  }
  applyRenderScale() { this.renderer.q = this.qualityPreset(); this.renderer.resize(); }

  // ---- match management ---------------------------------------------------------
  decoratedPlayers() {
    const styles = Object.keys(BODY_STYLES);
    for (const p of this.match.players) {
      if (p.human) {
        p.style = this.settings.player.body; p.paint = this.settings.player.color; p.accent = this.settings.player.accent || 0;
      } else if (!p.style) {
        p.style = styles[Math.floor(Math.random() * styles.length)];
        p.paint = Math.floor(Math.random() * PAINTS.length);
        p.accent = Math.floor(Math.random() * ACCENTS.length);
      }
    }
    return this.match.players;
  }

  setMatch(match) {
    this.match = match;
    this.acc = 0;
    this.view.effects.clear();
    this.view.setPlayers(this.decoratedPlayers(), this.settings);
    this.prevCars = match.world.cars.map((c) => captureCar(c, makeCarState()));
    this.curCars = match.world.cars.map((c) => captureCar(c, makeCarState()));
    this.renderCars = match.world.cars.map(() => makeCarState());
    this.prevBall = captureBall(match.world.ball, makeBallState());
    this.curBall = captureBall(match.world.ball, makeBallState());
    this.renderBall = makeBallState();
    this.replayState = null;
    this.audio.setCars(match.players);
    this.view.ball.setTouchTeam(-1);
  }

  startMatch() {
    const s = this.settings;
    this.menu.hide();
    const m = new Match({
      mode: s.match.mode, minutes: s.match.minutes, difficulty: s.match.difficulty,
      humanTeam: s.player.team, humanName: s.player.name,
    });
    this.setMatch(m);
    this.mode = 'match';
    this.paused = false;
    this.cam.ballCam = s.camera.ballCamDefault;
    this.cam.camDir = null;
    this.hud.show(true);
    this.hud.setFreeplay(false);
    this.showTouch(true);
    this.enterFullscreen();
  }

  startFreeplay() {
    this.menu.hide();
    const s = this.settings;
    const m = new Match({ freeplay: true, humanTeam: s.player.team, humanName: s.player.name, unlimitedBoost: true });
    this.setMatch(m);
    this.mode = 'match';
    this.paused = false;
    this.cam.ballCam = s.camera.ballCamDefault;
    this.cam.camDir = null;
    this.hud.show(true);
    this.hud.setFreeplay(true);
    this.showTouch(true);
    this.enterFullscreen();
  }

  toMainMenu() {
    this.paused = false;
    const m = new Match({ attract: true, mode: this.qName === 'low' ? 2 : 3, minutes: 0, difficulty: 'allstar', humanTeam: -1 });
    this.setMatch(m);
    this.mode = 'menu';
    this.hud.show(false);
    this.hud.setReplay(false);
    this.showTouch(false);
    this.menu.show('main');
  }

  pause() {
    if (this.mode !== 'match' || this.paused) return;
    this.paused = true;
    this.showTouch(false);
    this.menu.show('pause');
    this.audio.pause(true);
  }
  resume() {
    this.paused = false;
    this.menu.hide();
    this.showTouch(true);
    this.audio.pause(false);
  }

  showTouch(v) { if (this.touch) this.touch.show(v && this.mode === 'match' && !this.paused); }

  enterFullscreen() {
    if (!this.isTouch) return;
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
    }
  }

  checkOrientation() {
    const portrait = this.isTouch && window.innerHeight > window.innerWidth;
    $('rotate-hint').classList.toggle('hidden', !portrait);
  }

  toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---- main loop ------------------------------------------------------------------
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    if (this.frozen) return;
    const dt = Math.min(0.1, Math.max(0.0001, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.input.poll(dt);
    this.menu.pollPad(this.input.menuNav);
    const m = this.match;
    const pr = this.input.pressed;

    if (this.mode === 'match') {
      if ((pr.pause || this.input.menuNav.start) && m.state !== 'ended') { if (this.paused) this.resume(); else this.pause(); }
      if (!this.paused) this.hud.showBoard(m, this.input.actions.scoreboard && m.state !== 'ended');
      if (pr.ballCam && this.settings.camera.toggleBallCam) this.cam.toggleBallCam();
      if (!this.settings.camera.toggleBallCam) this.cam.ballCam = this.settings.camera.ballCamDefault !== !!this.input.actions.ballCam;
      if (m.freeplay) this.freeplayKeys();
    }

    // simulation
    const running = !(this.mode === 'match' && this.paused) && m.state !== 'replay';
    if (running) {
      if (m.human) {
        const c = m.human.car.controls;
        Object.assign(c, this.input.controls);
        if (m.state === 'ended') Object.assign(c, { throttle: 0, boost: false, jump: false });
      }
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 12) {
        const tmp = this.prevCars; this.prevCars = this.curCars; this.curCars = tmp;
        const tb = this.prevBall; this.prevBall = this.curBall; this.curBall = tb;
        m.tick(DT);
        m.world.cars.forEach((c, i) => captureCar(c, this.curCars[i]));
        captureBall(m.world.ball, this.curBall);
        this.acc -= DT;
        steps++;
      }
      if (steps >= 12) this.acc = 0;
    }
    this.handleEvents();

    // build render states
    let carStates = this.renderCars, ballState = this.renderBall;
    if (this.replayState) {
      this.updateReplay(dt);
    } else {
      const a = Math.min(1, this.acc / DT);
      for (let i = 0; i < this.curCars.length; i++) lerpCar(this.prevCars[i], this.curCars[i], a, carStates[i]);
      lerpBall(this.prevBall, this.curBall, a, ballState);
      ballState.visible = !(m.world.ball.frozen && (m.state === 'goal' || m.state === 'ended'));
    }

    this.updateCamera(dt);
    this.view.update(dt, carStates, ballState, m.world.lastTouch ? m.world.lastTouch.team : -1);
    this.syncPads();
    if (this.mode === 'match') {
      this.hud.update(m, m.human, dt, this.cam);
      if (this.touch && m.human) this.touch.setBoost(m.human.car.boost);
    }
    this.audio.update(dt, this.renderer.camera, carStates, m, ballState, this.mode === 'match' && !this.paused, !!this.replayState);
    this.renderer.render(dt);
    this.perf(dt);
  }

  updateCamera(dt) {
    const m = this.match, cam = this.cam;
    if (this.debugCam) { cam.setStatic(new THREE.Vector3(...this.debugCam.pos), new THREE.Vector3(...this.debugCam.look)); return; }
    if (this.replayState) {
      const rs = this.replayState;
      const focus = rs.focusIndex >= 0 ? this.renderCars[rs.focusIndex].pos : null;
      cam.updateCinematic(dt, this.renderBall.pos, this.renderBall.vel, focus);
      return;
    }
    if (this.mode === 'menu' || m.state === 'ended' || !m.human) {
      const b = this.renderBall.pos;
      cam.updateBroadcast(dt, new THREE.Vector3(b.x, b.y, b.z));
      return;
    }
    const s = this.renderCars[m.players.indexOf(m.human)];
    if (s.demoed) {
      cam.updateOrbit(dt, new THREE.Vector3(s.pos.x, s.pos.y, 200), 900, 500);
      return;
    }
    const R = new THREE.Quaternion(s.quat.x, s.quat.y, s.quat.z, s.quat.w);
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(R);
    const up = new THREE.Vector3(0, 0, 1).applyQuaternion(R);
    cam.swivelX += ((this.input.swivel.x || 0) - cam.swivelX) * Math.min(1, dt * 8);
    cam.swivelY += ((this.input.swivel.y || 0) - cam.swivelY) * Math.min(1, dt * 8);
    const ballPos = new THREE.Vector3(this.renderBall.pos.x, this.renderBall.pos.y, this.renderBall.pos.z);
    cam.updateChase(dt, new THREE.Vector3(s.pos.x, s.pos.y, s.pos.z), fwd, up, new THREE.Vector3(s.vel.x, s.vel.y, s.vel.z), s.onGround, ballPos, s.supersonic);
  }

  syncPads() {
    const pads = this.match.world.pads;
    for (let i = 0; i < pads.length; i++) this.view.arena.setPadState(i, pads[i].active);
  }

  freeplayKeys() {
    const k = this.input.keys, w = this.match.world, car = this.match.human.car;
    const edge = (code) => { const was = this._fk && this._fk[code]; this._fk = this._fk || {}; this._fk[code] = k.has(code); return k.has(code) && !was; };
    if (edge('KeyR')) {
      w.ball.reset((Math.random() - 0.5) * 4000, (Math.random() - 0.5) * 6000, 300 + Math.random() * 900);
      w.ball.vel.set((Math.random() - 0.5) * 800, (Math.random() - 0.5) * 800, 300 + Math.random() * 500);
      w.ball.frozen = false;
      if (this.match.state !== 'play') this.match.state = 'play';
    }
    if (edge('KeyT')) {
      const f = car.forward;
      const target = new V3(car.pos.x + f.x * 900, car.pos.y + f.y * 900, 600 + Math.random() * 500);
      w.ball.reset(target.x + (Math.random() - 0.5) * 2500, target.y + 2200 * Math.sign(target.y - car.pos.y || 1), 200);
      const t = 1.6;
      w.ball.vel.set((target.x - w.ball.pos.x) / t, (target.y - w.ball.pos.y) / t, (target.z - w.ball.pos.z) / t + 325 * t);
      w.ball.frozen = false;
      if (this.match.state !== 'play') this.match.state = 'play';
    }
    if (edge('KeyU')) { w.unlimitedBoost = !w.unlimitedBoost; this.toast(`Unlimited boost ${w.unlimitedBoost ? 'on' : 'off'}`); }
  }

  // ---- events --------------------------------------------------------------------
  handleEvents() {
    const m = this.match, view = this.view, fx = view.effects, hud = this.hud;
    const evs = m.events;
    if (!evs.length) return;
    m.events = [];
    const humanCar = m.human ? m.human.car : null;
    const isHumanMatch = this.mode === 'match';
    for (const e of evs) {
      switch (e.type) {
        case 'count': if (isHumanMatch) hud.message(String(e.n), { cls: 'count', time: 0.95 }); this.audio.event(e); break;
        case 'go': if (isHumanMatch) hud.message('GO!', { cls: 'go', time: 0.8 }); this.audio.event(e); break;
        case 'kickoff': fx.clear(); view.ball.setTouchTeam(-1); for (const c of view.cars) for (const r of c.ribbons) r.clear(); this.audio.event(e); break;
        case 'ballHit': {
          const p = toThree(e.point), n = new THREE.Vector3(e.normal.x, e.normal.z, -e.normal.y);
          fx.ballHit(p, n, e.dv, e.car.team);
          view.ball.setTouchTeam(e.car.team);
          this.audio.event(e, p);
          if (e.car === humanCar) this.input.rumble(Math.min(1, e.dv / 2500), 0.4, 90);
          if (e.dv > 2000) this.cam.addShake(0.25);
          break;
        }
        case 'ballBounce': {
          const p = toThree(e.point), n = new THREE.Vector3(e.normal.x, e.normal.z, -e.normal.y);
          fx.ballBounce(p, n, e.speed);
          this.audio.event(e, p);
          break;
        }
        case 'jump': case 'doubleJump': case 'flip': case 'autoflip': {
          const p = toThree(e.car.pos);
          if (e.type === 'jump' && e.car.pos.z < 60) { p.y = 0.05; fx.puff(p, 5, [0.5, 0.55, 0.45], 0.4); }
          this.audio.event(e, p, e.car === humanCar);
          break;
        }
        case 'land': {
          if (e.car.lastLandSpeed > 450) {
            const p = toThree(e.car.pos); p.y = Math.max(0.05, p.y - 0.15);
            if (e.car.up.z > 0.8) fx.puff(p, Math.min(14, e.car.lastLandSpeed / 70), [0.45, 0.5, 0.38], 0.5);
            this.audio.event(e, p, e.car === humanCar);
            if (e.car === humanCar) this.input.rumble(0.3, 0.2, 60);
          }
          break;
        }
        case 'pad': {
          const p = new THREE.Vector3(e.pad.x * 0.01, 0.05, -e.pad.y * 0.01);
          fx.padPickup(p, e.pad.big);
          this.audio.event(e, p, e.car === humanCar);
          break;
        }
        case 'demo': {
          const p = toThree(e.victim.pos);
          fx.demolition(p, e.victim.team);
          this.audio.event(e, p);
          const a = m.playerOf(e.attacker), v = m.playerOf(e.victim);
          if (isHumanMatch) hud.feedItem(`<b>${esc(a ? a.name : '?')}</b> 💥 <b>${esc(v ? v.name : '?')}</b>`, e.attacker.team);
          if (e.victim === humanCar || e.attacker === humanCar) { this.cam.addShake(0.6); this.input.rumble(1, 1, 400); }
          break;
        }
        case 'bump': case 'carCar': {
          const p = toThree(e.point);
          if (e.speed > 700) fx.sparks(p, Math.min(30, e.speed / 60));
          this.audio.event(e, p);
          if (e.type === 'bump' && (e.victim === humanCar || e.attacker === humanCar)) this.input.rumble(0.6, 0.5, 160);
          break;
        }
        case 'carWorld': {
          const p = toThree(e.car.pos);
          if (e.speed > 900) fx.sparks(p, Math.min(24, e.speed / 80), [1, 0.7, 0.3]);
          this.audio.event(e, p, e.car === humanCar);
          break;
        }
        case 'supersonic': this.audio.event(e, toThree(e.car.pos), e.car === humanCar); break;
        case 'boostStart': case 'boostEnd': this.audio.event(e, null, e.car === humanCar); break;
        case 'flipReset': if (e.car === humanCar) { hud.feedItem('Flip reset!', e.car.team); this.audio.ui('select'); } break;
        case 'goalScored': this.onGoalScored(e); break;
        case 'stat': this.onStat(e); break;
        case 'replay': this.startReplay(e.frames, e.goal); break;
        case 'overtime': if (isHumanMatch) hud.message('OVERTIME', { cls: 'go', time: 2.2 }); this.audio.event(e); break;
        case 'matchEnd': this.onMatchEnd(e); break;
        default: break;
      }
    }
  }

  onGoalScored(e) {
    const m = this.match, view = this.view;
    const p = toThree(e.pos);
    view.effects.goalExplosion(p, e.team);
    view.arena.flash(e.team);
    view.stadium.cheer(1.2, e.team);
    this.cam.addShake(1.0);
    this.audio.event({ type: 'goal', team: e.team, humanTeam: m.human ? m.human.team : -1 }, p);
    const kmh = Math.round(e.speed * 0.036);
    const scorerName = e.scorer ? esc(e.scorer.name) : 'Own goal';
    view.stadium.drawScreen({ score: m.score, time: m.clockText(), message: `GOAL! ${e.scorer ? e.scorer.name.toUpperCase() : ''}`, messageColor: e.team === 0 ? '#7fb6ff' : '#ffb27a' });
    if (this.mode === 'match') {
      this.hud.message('GOAL!', { cls: 'goal ' + (e.team === 0 ? 'blue' : 'orange'), time: 2.6, sub: `${scorerName}${e.assist ? ` <small>assist ${esc(e.assist.name)}</small>` : ''} · ${kmh} KM/H` });
      if (m.human) this.input.rumble(1, 1, 600);
    }
  }

  onStat(e) {
    if (this.mode !== 'match') return;
    const labels = { shot: 'Shot on goal', save: 'Save!', assist: 'Assist', demo: 'Demolition' };
    if (e.kind === 'goal' || !labels[e.kind]) return;
    if (e.kind === 'save') this.view.stadium.cheer(0.6, e.player.team);
    this.hud.feedItem(`<b>${esc(e.player.name)}</b> ${labels[e.kind]} <i>+${({ shot: 20, save: 50, assist: 50, demo: 25 })[e.kind]}</i>`, e.player.team);
  }

  onMatchEnd(e) {
    const m = this.match;
    this.audio.event({ type: 'matchEnd', win: m.human ? m.human.team === e.winner : true });
    this.view.stadium.cheer(1, e.winner);
    this.view.stadium.drawScreen({ score: m.score, time: 'FINAL', message: `${e.winner === 0 ? 'BLUE' : 'ORANGE'} WINS`, messageColor: e.winner === 0 ? '#7fb6ff' : '#ffb27a' });
    if (this.mode === 'match') {
      this.hud.message(e.winner === 0 ? 'BLUE WINS' : 'ORANGE WINS', { cls: 'goal ' + (e.winner === 0 ? 'blue' : 'orange'), time: 2.5 });
      this.showTouch(false);
      setTimeout(() => { if (this.match === m) { this.hud.show(false); this.menu.show('postgame', m); } }, 2600);
    }
  }

  // ---- replays --------------------------------------------------------------------
  startReplay(frames, goal) {
    if (!frames.length || this.mode !== 'match') { this.match.afterReplay(); return; }
    const end = goal.time + 1.1;
    const start = Math.max(frames[0].time, goal.time - 5.5);
    const scorerIdx = goal.scorer ? this.match.players.indexOf(goal.scorer) : -1;
    this.replayState = { frames, t: start, start, end, goalTime: goal.time, exploded: false, focusIndex: scorerIdx, team: goal.team, pos: goal.pos };
    this.view.effects.clear();
    this.hud.setReplay(true);
    this.showTouch(false);
    this.audio.event({ type: 'replayStart' });
  }

  updateReplay(dt) {
    const rs = this.replayState;
    const slow = rs.t > rs.goalTime - 0.6 && rs.t < rs.goalTime + 0.1 ? 0.45 : 1;
    rs.t += dt * slow;
    const f = rs.frames;
    let i = 0;
    while (i < f.length - 2 && f[i + 1].time < rs.t) i++;
    const a = f[i], b = f[Math.min(i + 1, f.length - 1)];
    const k = b.time > a.time ? Math.min(1, Math.max(0, (rs.t - a.time) / (b.time - a.time))) : 0;
    for (let c = 0; c < this.renderCars.length; c++) if (a.cars[c] && b.cars[c]) lerpCar(a.cars[c], b.cars[c], k, this.renderCars[c]);
    lerpBall(a.ball, b.ball, k, this.renderBall);
    this.renderBall.visible = !b.ballFrozen || rs.t < rs.goalTime;
    // replay touches / bounces for effects
    for (const e of a.events || []) {
      if (e._played === rs) continue;
      e._played = rs;
      if (e.type === 'ballHit') { this.view.effects.ballHit(toThree(e.point), new THREE.Vector3(e.normal.x, e.normal.z, -e.normal.y), e.dv, e.car.team); this.view.ball.setTouchTeam(e.car.team); this.audio.event(e, toThree(e.point)); }
      if (e.type === 'ballBounce') this.audio.event(e, toThree(e.point));
    }
    if (!rs.exploded && rs.t >= rs.goalTime) {
      rs.exploded = true;
      this.view.effects.goalExplosion(toThree(rs.pos), rs.team);
      this.audio.event({ type: 'goal', team: rs.team, replay: true, humanTeam: -1 }, toThree(rs.pos));
      this.cam.addShake(0.8);
    }
    const skip = this.input.pressed.jump || this.input.menuNav.accept || (this.touch && this.touch.state.jump);
    if (rs.t >= rs.end || (skip && rs.t > rs.start + 0.4)) this.endReplay();
  }

  endReplay() {
    this.replayState = null;
    this.hud.setReplay(false);
    this.view.effects.clear();
    this.audio.event({ type: 'replayEnd' });
    this.match.afterReplay();
    this.showTouch(true);
    // resync interpolation buffers after kickoff reset
    this.match.world.cars.forEach((c, i) => { captureCar(c, this.prevCars[i]); captureCar(c, this.curCars[i]); });
    captureBall(this.match.world.ball, this.prevBall); captureBall(this.match.world.ball, this.curBall);
    this.view.stadium.drawScreen({ score: this.match.score, time: this.match.clockText(), message: this.match.overtime ? 'OVERTIME' : 'KICKOFF' });
  }

  // ---- performance ------------------------------------------------------------------
  perf(dt) {
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      const fps = this.fpsFrames / this.fpsAcc;
      if (this.settings.showFps) this.hud.setFps(fps); else this.hud.hideFps();
      this.fpsAcc = 0; this.fpsFrames = 0;
    }
    // automatic quality step-down when struggling (auto quality only)
    if (this.settings.quality !== 'auto' || !this.settings.autoAdjust || this.mode !== 'match' || this.paused) { this.perfTimer = 0; this.perfFrames = 0; return; }
    this.perfTimer += dt; this.perfFrames++;
    if (this.perfTimer > 6) {
      const fps = this.perfFrames / this.perfTimer;
      this.perfTimer = 0; this.perfFrames = 0;
      const idx = ORDER.indexOf(this.qName);
      if (fps < 38 && idx > 0) {
        this.autoQuality = ORDER[idx - 1];
        this.applyQuality();
      }
    }
  }
}

function nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }

const app = new App();
window.app = app;
app.boot().catch((e) => {
  console.error(e);
  const t = $('loadtext');
  if (t) t.textContent = 'Failed to start: ' + e.message;
});
