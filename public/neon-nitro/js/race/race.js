// One race: track, racers, AI, items, props, hazards, effects, HUD and the
// intro -> countdown -> race -> finish flow.
import * as THREE from 'three';
import { Track } from '../track/track.js';
import { CarModel } from '../cars/car.js';
import { statsFor, BODIES } from '../cars/catalog.js';
import { Vehicle } from './vehicle.js';
import { AIDriver } from './ai.js';
import { ChaseCam } from './camera.js';
import { FX, SHAPE } from './fx.js';
import { Items } from './items.js';
import { Props } from './props.js';
import { BoostPads } from './pads.js';
import { HUD } from '../ui/hud.js';
import { G } from '../render/toon.js';

const DRIFT_COLORS = [[1, 1, 1], [0.3, 0.75, 1], [1, 0.62, 0.15], [0.85, 0.35, 1]];
const PLACE_TEXT = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH'];

export class Race {
  /**
   * opts: { def, laps, mode: 'gp'|'quick'|'tt', cls: {id, pace}, player: {cfg, name}, rivals: [{cfg, name, pace, skill}], gp, onFinish }
   */
  constructor(game, opts) {
    this.game = game;
    this.opts = opts;
    this.view = game.view;
    this.input = game.input;
    this.audio = game.audio;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, game.view.cssW / game.view.cssH, 0.3, 2600);
    this.state = 'loading';
    this.time = 0;
    this.raceTime = 0;
    this.cars = [];
    this.ai = [];
    this.laps = opts.laps ?? opts.def.laps ?? 3;
    this.results = null;
    this.glitchFlash = 0;
    this.focus = 0;
    this.paused = false;
    this.itemsNoRare = opts.mode === 'tt';
  }

  async load() {
    const def = this.opts.def;
    this.track = new Track(def, { quality: this.view.qualityName }).build(this.scene);
    this.fx = new FX(this.scene, this.view);
    const path = this.track.path;
    // racers
    const entries = [{ ...this.opts.player, isPlayer: true }, ...(this.opts.rivals || [])];
    const n = entries.length;
    const playerSlot = this.opts.mode === 'tt' ? 0 : Math.min(n - 1, this.opts.playerSlot ?? n - 2);
    const order = entries.map((_, i) => i);
    // player goes to playerSlot on the grid, rivals fill the rest
    order.splice(0, 1);
    order.splice(playerSlot, 0, 0);
    entries.forEach((e, idx) => {
      const model = new CarModel({ ...e.cfg, number: e.number ?? (idx * 7 + 3) % 100 });
      this.scene.add(model.root);
      const v = new Vehicle({ id: idx, name: e.name, model, stats: statsFor(e.cfg), cfg: e.cfg, track: this.track, race: this, isPlayer: !!e.isPlayer, color: e.cfg.paint });
      v.takeyari = model.takeyari;
      v.entry = e;
      const slot = order.indexOf(idx);
      const row = Math.floor(slot / 2), col = slot % 2;
      const s = path.length - 10 - row * 10 - col * 5;
      const hw = path.w[path.indexAt(s)] / 2;
      v.place0(s, (col ? 1 : -1) * Math.min(4, hw * 0.35));
      v.lap = 0; v.cp = 3; v.progress = s - path.length; v.lastS = v.s;
      this.cars.push(v);
      if (e.isPlayer) this.player = v;
      else this.ai.push(new AIDriver(v, this, { pace: e.pace ?? 0.95, skill: e.skill ?? 0.6, aggr: e.aggr ?? 0.5, lane: ((slot % 2) ? 0.3 : -0.3) + (Math.random() - 0.5) * 0.2 }));
    });
    if (this.opts.autoPlayer) this.ai.push(new AIDriver(this.player, this, { pace: 1, skill: 0.85, aggr: 0.6 }));
    this._laps();
    this.items = new Items(this);
    this.props = new Props(this);
    this.pads = new BoostPads(this);
    this.chase = new ChaseCam(this.camera);
    this.hud = new HUD(this);
    this.player.model.material.uniforms.uLiveryOn.value = this.player.model.material.uniforms.uLiveryOn.value; // keep
    // warm up: compile shaders by rendering once
    this.view.render(this.scene, this.camera, 0);
    this.state = 'intro';
    this.introT = 0;
    this.introDur = this.opts.skipIntro ? 0.01 : 5.2;
    this.hud.showTitle(def);
    this.audio?.music(def.music || 'citypop');
    return this;
  }

  // ------------------------------------------------------------ queries
  carAhead(v) { return this.cars.find((c) => c.place === v.place - 1) || null; }
  carBehind(v) { return this.cars.find((c) => c.place === v.place + 1) || null; }

  hitCar(c, kind, from, text, quiet = false) {
    const ok = c.hit(kind, from);
    if (!ok) {
      if (c.shieldT <= 0 && c.events.some((e) => e.type === 'shieldPop')) this.fx.pop('BLOCK!', { world: c.pos.clone().setY(c.pos.y + 2.5), cls: 'small', color: '#20d8ff' });
      return false;
    }
    if (!quiet) this.fx.burst(c.pos.x, c.pos.y + 1, c.pos.z, 16, { color: [1, 0.9, 0.4], shape: SHAPE.STAR, size: 1.1, life: 0.5, speed: 10 });
    if (text) this.fx.pop(text, { world: c.pos.clone().setY(c.pos.y + 2.6), cls: c.isPlayer ? 'big' : '' });
    if (c.isPlayer) { this.chase.shake(0.7); this.focus = 1; this.audio?.sfx('hit'); }
    else if (from === this.player) { this.audio?.sfx('hitOther'); this.hud.flashHit(c); }
    return true;
  }

  onEvent(v, e) {
    const pl = v.isPlayer;
    const a = this.audio;
    switch (e.type) {
      case 'itembox': if (pl) a?.sfx('itembox'); break;
      case 'itemGot': if (pl) { a?.sfx('itemgot'); this.hud.itemGot(e.item); } break;
      case 'itemUsed': if (pl || v.pos.distanceTo(this.player.pos) < 60) a?.sfx('item_' + e.item, { vol: pl ? 1 : 0.4 }); break;
      case 'explosion': {
        const d = new THREE.Vector3(e.x, e.y, e.z).distanceTo(this.player.pos);
        a?.sfx('explosion', { vol: Math.max(0.15, 1 - d / 120) });
        if (d < 30) this.chase.shake(0.6 * (1 - d / 30));
        break;
      }
      default: break;
    }
  }

  // ------------------------------------------------------------ loop
  update(dt) {
    if (this.paused) return;
    this.time += dt;
    G.uTime.value = this.time;
    const input = this.input.state;
    if (input.pause && (this.state === 'race' || this.state === 'countdown')) { this.game.pauseRace(); return; }

    if (this.state === 'intro') {
      this.introT += dt;
      this._introCam(dt);
      if (this.introT > this.introDur || input.item || input.driftPressed || this._skip) this._startCountdown();
    } else if (this.state === 'countdown') {
      this.countT -= dt;
      const n = Math.ceil(this.countT);
      if (n !== this._lastCount && n >= 1 && n <= 3) { this.hud.count(n); this.audio?.sfx('count'); this._lastCount = n; }
      // rocket start: throttle window during the last 0.9s
      if (input.throttle > 0.5) { if (this._throttleSince == null) this._throttleSince = this.countT; } else this._throttleSince = null;
      this.player.input.throttle = 0;
      this._revs = input.throttle;
      if (this.countT <= 0) this._go();
      for (const c of this.cars) c.update(0.0001);
      this.chase.update(dt, this.player);
    } else if (this.state === 'race' || this.state === 'finish') {
      this.raceTime += dt;
      this._simulate(dt, input);
      if (this.state === 'finish') {
        this.finishT += dt;
        if (this.finishT > 6.5 || this.cars.every((c) => c.finished) && this.finishT > 3) this._results();
      }
    }
    this.fx.update(dt, this.camera);
    this.hud.update(dt);
    // post fx
    const f = this.view.post.fx;
    const pl = this.player;
    const boosting = pl.boostT > 0 && this.state !== 'intro';
    f.uSpeed.value += ((boosting ? 1 : pl.speed > pl.vmax * 0.92 ? 0.25 : 0) - f.uSpeed.value) * Math.min(1, dt * 6);
    this.focus = Math.max(0, this.focus - dt * 2.2);
    f.uFocus.value = this.focus * 0.8;
    this.glitchFlash = Math.max(0, this.glitchFlash - dt * 1.5);
    const glitchMe = (pl.glitchT || 0) > 0;
    if (glitchMe) pl.glitchT -= dt;
    f.uGlitch.value = Math.max(glitchMe ? 0.8 : 0, this.glitchFlash * 0.4);
    f.uAberr.value = Math.max(this.focus * 1.5, glitchMe ? 2 : 0, boosting ? 0.6 : 0);
    f.uFlash.value = Math.max(0, f.uFlash.value - dt * 3);
  }

  _introCam(dt) {
    const path = this.track.path;
    const k = this.introT / this.introDur;
    // sweep along the last stretch toward the grid, rising then settling behind the player
    const s = path.length * (0.72 + 0.26 * k);
    const p = path.at(s);
    const side = Math.sin(k * Math.PI) * 14;
    const h = 22 - k * 16;
    this.camera.position.set(p.x + p.rx * side, p.y + h, p.z + p.rz * side);
    const t = path.at(s + 30 + k * 20);
    this.camera.lookAt(t.x, t.y + 2, t.z);
    this.camera.fov = 62; this.camera.updateProjectionMatrix();
    for (const c of this.cars) c.update(0.0001);
    void dt;
  }

  _startCountdown() {
    this.state = 'countdown';
    this.countT = 3.6;
    this._lastCount = 4;
    this.hud.hideTitle();
    this.chase.snap();
    this.input.enabled = true;
  }

  _go() {
    this.state = 'race';
    this.hud.go();
    this.audio?.sfx('go');
    // rocket start for the player
    const since = this._throttleSince;
    if (since != null && since <= 0.95) { this.player.boost(1.1, 1.35, 'start'); this.fx.pop('ROCKET START!', { cls: 'big', y: 30 }); this.audio?.sfx('boost'); }
    else if (since != null && since > 1.6) { this.player.speed = -1; this.player.spinT = 0; this._stall = 0.6; this.fx.pop('STALL!', { cls: 'small', y: 34, color: '#aaa' }); }
    // AIs: random start quality
    for (const d of this.ai) if (Math.random() < d.skill * 0.6) d.v.boost(0.8, 1.3, 'start');
  }

  _simulate(dt, input) {
    const pl = this.player;
    // ---- player input
    if (!pl.finished && !this.opts.autoPlayer) {
      Object.assign(pl.input, input);
      if (this._stall > 0) { this._stall -= dt; pl.input.throttle = 0; }
      if (input.item && pl.item && pl.rolling <= 0) this.items.use(pl, input.itemBack);
      if (input.respawn) pl.startRespawn();
    } else if (pl.finished) {
      pl.input.throttle = 0.35; pl.input.brake = 0; pl.input.drift = false; pl.input.steer = this._autoSteer(pl);
    }
    for (const d of this.ai) { if (d.v.finished && d.v.isPlayer) continue; d.update(dt); if (d.v.isPlayer) d.v.rubber = 1; }
    // ---- physics
    for (const c of this.cars) {
      c.update(dt);
      this.items.tickRoulette(c, dt);
      // rescue drone for anything wedged or lost (players can also press R)
      if (!c.finished && (c.slowT > 4.5 || c.wrongWayT > 6 || (c.isPlayer && c.stuckT > 3.5))) { c.slowT = 0; c.wrongWayT = 0; c.stuckT = 0; c.startRespawn(); }
    }
    this._carCollisions();
    for (const c of this.cars) { this.items.checkBoxes(c); this.pads.check(c); this.props.check(c); }
    this.items.update(dt, this.time);
    this.props.update(dt);
    this.pads.update(dt, this.time);
    this.track.update(dt, this.time, this);
    // ---- laps / places
    this._laps();
    // ---- per-car effects & audio
    for (const c of this.cars) this._carFx(c, dt);
    this.audio?.engine(pl.speed / pl.vmax, pl.input.throttle, pl.boostT > 0, pl.drift.on, pl.grounded, pl.offroad);
    // ---- camera
    this.chase.update(dt, pl, { lookBack: input.look && !pl.finished });
    // wrong way
    this.hud.wrongWay(pl.wrongWayT > 1.2 && !pl.finished);
  }

  _autoSteer(v) {
    const p = this.track.path.at(v.s + 16);
    let e = Math.atan2(-(p.z - v.pos.z), p.x - v.pos.x) - v.yaw;
    while (e > Math.PI) e -= Math.PI * 2; while (e < -Math.PI) e += Math.PI * 2;
    return Math.max(-1, Math.min(1, -e * 2));
  }

  _carCollisions() {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if (a.respawnT > 0 || b.respawnT > 0) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        const R = 2.6;
        if (d2 > R * R || Math.abs(a.pos.y - b.pos.y) > 2) continue;
        const d = Math.sqrt(d2) || 0.01;
        const nx = dx / d, nz = dz / d;
        const pen = R - d;
        const ma = a.mass * (a.ryuT > 0 ? 20 : 1), mb = b.mass * (b.ryuT > 0 ? 20 : 1);
        const wa = mb / (ma + mb), wb = ma / (ma + mb);
        a.pos.x -= nx * pen * wa; a.pos.z -= nz * pen * wa;
        b.pos.x += nx * pen * wb; b.pos.z += nz * pen * wb;
        // relative velocity along the normal
        const va = a.vel, vb = b.vel;
        const rv = (vb.x - va.x) * nx + (vb.z - va.z) * nz;
        if (rv < 0) {
          const jimp = -(1.3) * rv / (1 / ma + 1 / mb);
          this._impulse(a, -nx * jimp / ma, -nz * jimp / ma);
          this._impulse(b, nx * jimp / mb, nz * jimp / mb);
          if (-rv > 7) {
            const mx = (a.pos.x + b.pos.x) / 2, mz = (a.pos.z + b.pos.z) / 2, my = (a.pos.y + b.pos.y) / 2 + 0.8;
            this.fx.burst(mx, my, mz, 10, { color: [1, 0.85, 0.4], shape: SHAPE.STAR, size: 0.9, life: 0.35, speed: 9 });
            if (a.isPlayer || b.isPlayer) {
              this.audio?.sfx('bump');
              this.chase.shake(0.25);
              if (-rv > 13 && Math.random() < 0.6) this.fx.pop(['BONK!', 'WHAM!', 'THUD!', 'BASH!'][Math.floor(Math.random() * 4)], { world: new THREE.Vector3(mx, my + 1.5, mz), cls: 'small' });
            }
          }
        }
      }
    }
  }

  _impulse(c, ix, iz) {
    const fx = Math.cos(c.yaw), fz = -Math.sin(c.yaw);
    const rx = Math.sin(c.yaw), rz = Math.cos(c.yaw);
    c.speed += ix * fx + iz * fz;
    c.latVel += (ix * rx + iz * rz) * 0.7;
    c.latVel = Math.max(-14, Math.min(14, c.latVel));
  }

  _laps() {
    const L = this.track.length;
    for (const c of this.cars) {
      if (c.finished) { c.progress = this.laps * L + 1000 - c.finishOrder; continue; }
      const s = c.s, ls = c.lastS;
      const q = Math.floor((s / L) * 4);
      if (c.lap > 0 && q === c.cp + 1) c.cp = q;
      if (ls > L * 0.75 && s < L * 0.25) {
        if (c.cp >= 2 || c.lap === 0) {
          c.lap++; c.cp = 0;
          if (c.lap > this.laps) this._finishCar(c);
          else if (c.isPlayer && c.lap > 1) {
            if (c.lap === this.laps) { this.hud.banner('FINAL LAP!', 'final'); this.audio?.sfx('finallap'); this.audio?.musicIntensity(1); }
            else { this.hud.banner(`LAP ${c.lap}`, 'lap'); this.audio?.sfx('lap'); }
          }
          if (c.isPlayer && c.lap >= 1) c.lapStart = this.raceTime;
        }
      } else if (ls < L * 0.25 && s > L * 0.75) {
        if (c.lap > 0) { c.lap--; c.cp = 3; }
      }
      c.lastS = s;
      c.progress = (c.lap - 1) * L + s;
    }
    // places
    const sorted = [...this.cars].sort((a, b) => b.progress - a.progress);
    sorted.forEach((c, i) => {
      const np = i + 1;
      if (c.isPlayer && c.place && np !== c.place && this.state === 'race') this.hud.placeChange(np < c.place);
      c.place = np;
    });
  }

  _finishCar(c) {
    c.finished = true;
    c.finishTime = this.raceTime;
    this._finishCount = (this._finishCount || 0) + 1;
    c.finishOrder = this._finishCount;
    c.finalPlace = this._finishCount;
    if (c.isPlayer) {
      this.state = 'finish';
      this.finishT = 0;
      this.chase.mode = 'orbit';
      this.hud.finish(c.finalPlace);
      this.audio?.sfx(c.finalPlace <= 3 ? 'win' : 'finish');
      this.audio?.musicIntensity(0);
      this.fx.pop(c.finalPlace === 1 ? 'VICTORY!' : PLACE_TEXT[c.finalPlace - 1] + '!', { cls: 'huge', y: 30, rot: -6 });
      for (let i = 0; i < 80; i++) this.fx.spawn({ x: c.pos.x + (Math.random() - 0.5) * 10, y: c.pos.y + 6 + Math.random() * 6, z: c.pos.z + (Math.random() - 0.5) * 10, vx: (Math.random() - 0.5) * 6, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 6, life: 3, size: 0.6, color: [[1, 0.2, 0.5], [0.2, 0.9, 1], [1, 0.9, 0.2], [0.5, 1, 0.4]][i % 4], shape: SHAPE.SQUARE, drag: 1.2, grav: 4, spin: 6 });
    }
  }

  _results() {
    if (this.results) return;
    const L = this.track.length;
    // unfinished cars: estimate finish time from remaining distance
    const list = this.cars.map((c) => {
      let time = c.finishTime;
      if (!c.finished) {
        const remain = this.laps * L - c.progress;
        time = this.raceTime + remain / Math.max(20, c.vmax * 0.8);
      }
      return { car: c, time };
    }).sort((a, b) => a.time - b.time);
    this.results = list.map((r, i) => ({ place: i + 1, name: r.car.name, time: r.time, isPlayer: r.car.isPlayer, cfg: r.car.cfg, bestLap: r.car.bestLap }));
    this.state = 'done';
    this.opts.onFinish?.(this.results, this);
  }

  // ------------------------------------------------------------ car effects
  _carFx(c, dt) {
    const fx = this.fx;
    const m = c.model;
    const near = c.pos.distanceToSquared(this.camera.position) < 140 * 140;
    if (!near) { c.events.length = 0; return; }
    const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw);
    const W = (lx, ly, lz) => { // local (car) -> world using physics yaw + visual drift
      const a = c.yaw + c.driftVis;
      const ca = Math.cos(a), sa = Math.sin(a);
      return [c.pos.x + lx * ca + lz * sa, c.pos.y + ly, c.pos.z - lx * sa + lz * ca];
    };
    // drift sparks + smoke from the rear wheels
    if (c.drift.on && c.grounded) {
      const lvl = c.drift.level;
      const col = DRIFT_COLORS[lvl];
      for (const side of [-1, 1]) {
        const p = W(-m.dims.wb / 2 - 0.2, 0.15, side * (m.dims.track / 2 + 0.1));
        if (Math.random() < 0.9) fx.spawn({ x: p[0], y: p[1], z: p[2], vx: (Math.random() - 0.5) * 4 - cos * 6, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 4 + sin * 6, life: 0.28, size: lvl ? 0.8 + lvl * 0.15 : 0.45, color: col, shape: lvl ? SHAPE.STAR : SHAPE.DOT, drag: 2, grav: 12, spin: 10 });
        if (Math.random() < 0.3) fx.spawn({ x: p[0], y: p[1] + 0.2, z: p[2], vx: -cos * 3 + c.vel.x * 0.4, vy: 1, vz: sin * 3 + c.vel.z * 0.4, life: 0.7, size: 1.0, grow: 1.4, color: [0.82, 0.8, 0.9], alpha: 0.7, shape: SHAPE.PUFF, drag: 2.5 });
      }
    }
    // offroad dust
    if (c.offroad && Math.abs(c.speed) > 8 && Math.random() < 0.5) {
      const p = W(-m.dims.wb / 2, 0.2, (Math.random() - 0.5) * 1.6);
      fx.spawn({ x: p[0], y: p[1], z: p[2], vx: -cos * 4, vy: 1.5, vz: sin * 4, life: 0.9, size: 1.6, grow: 1.6, color: this.track.theme.dust || [0.7, 0.62, 0.5], alpha: 0.7, shape: SHAPE.PUFF, drag: 2 });
    }
    // boost flames at exhausts
    if (c.boostT > 0 || (c === this.player && this._revs > 0.5 && this.state === 'countdown')) {
      const big = c.boostKind === 'nitro' || c.boostKind === 'mt3';
      for (const e of m.exhausts) {
        const p = W(e.pos[0], e.pos[1] + m.heightOff, e.pos[2]);
        const dl = [e.dir[0] * cos + e.dir[2] * sin, e.dir[1], -e.dir[0] * sin + e.dir[2] * cos];
        const sp = 7 + Math.random() * 4;
        fx.spawn({ x: p[0], y: p[1], z: p[2], vx: dl[0] * sp + c.vel.x * 0.8, vy: dl[1] * sp, vz: dl[2] * sp + c.vel.z * 0.8, life: 0.16 + Math.random() * 0.08, size: (e.big ? 1.1 : 0.8) * (big ? 1.4 : 1), grow: 0.6, color: c.boostKind === 'nitro' ? [0.35, 0.75, 1] : c.boostKind === 'mt3' ? [0.8, 0.35, 1] : [1, 0.55, 0.12], shape: SHAPE.FLAME, drag: 3 });
      }
    }
    // events
    for (const e of c.events) {
      switch (e.type) {
        case 'driftStart':
          if (c.isPlayer) { this.audio?.sfx('hop'); if (Math.random() < 0.35) fx.pop('SKRRT!', { x: 50 + e.dir * 18, y: 62, cls: 'small', rot: e.dir * 10 }); }
          break;
        case 'driftLevel':
          if (c.isPlayer) { this.audio?.sfx('spark' + e.level); this.hud.driftLevel(e.level); }
          break;
        case 'boost':
          if (c.isPlayer) {
            this.audio?.sfx(e.kind === 'pad' ? 'pad' : 'boost');
            const txt = { mt1: 'BOOST!', mt2: 'SUPER BOOST!', mt3: 'ULTRA BOOST!!', nitro: 'NITRO!', trick: 'STYLE!', pad: 'ZOOM!', slip: 'SLIPSTREAM!' }[e.kind];
            if (txt) fx.pop(txt, { cls: e.kind === 'mt3' || e.kind === 'nitro' ? 'big' : '', y: 30 + Math.random() * 6, color: e.kind === 'mt1' ? '#35c8ff' : e.kind === 'mt2' ? '#ff9a1e' : e.kind === 'mt3' ? '#d05cff' : undefined });
            this.view.post.fx.uFlash.value = 0.12;
            this.view.post.fx.uFlashColor.value.setRGB(1, 1, 1);
          }
          break;
        case 'wall': {
          fx.burst(e.x, e.y, e.z, 10 + Math.min(14, e.impact), { color: [1, 0.85, 0.45], shape: SHAPE.STAR, size: 0.8, life: 0.35, speed: 7 + e.impact * 0.3, grav: 10 });
          if (c.isPlayer) {
            this.audio?.sfx('wall', { vol: Math.min(1, e.impact / 25) });
            this.chase.shake(Math.min(0.5, e.impact / 45));
            if (e.impact > 18 && Math.random() < 0.5) fx.pop(['CLANG!', 'KRUNCH!', 'SCRAPE!'][Math.floor(Math.random() * 3)], { world: new THREE.Vector3(e.x, e.y + 1.4, e.z), cls: 'small' });
          }
          break;
        }
        case 'land':
          if (e.v > 8) fx.burst(c.pos.x, c.pos.y + 0.2, c.pos.z, 8, { color: [0.8, 0.78, 0.9], shape: SHAPE.PUFF, size: 1.4, grow: 1.5, life: 0.6, speed: 5, up: 0.5 });
          if (c.isPlayer) this.audio?.sfx('land');
          break;
        case 'trick':
          if (c.isPlayer) { this.audio?.sfx('trick'); fx.pop('TRICK!', { cls: '', y: 36 }); }
          break;
        case 'hit':
          if (c.isPlayer) this.hud.hurt();
          break;
        case 'respawn':
          if (c.isPlayer) { this.audio?.sfx('respawn'); fx.pop('RESCUE DRONE!', { cls: 'small', y: 40 }); }
          break;
        default: break;
      }
    }
    // slipstream: tucked in behind another car
    if (c.grounded && c.speed > 30 && c.boostT <= 0) {
      let drafting = false;
      for (const o of this.cars) {
        if (o === c) continue;
        const dx = o.pos.x - c.pos.x, dz = o.pos.z - c.pos.z;
        const along = dx * cos + dz * -sin;
        const lat = dx * sin + dz * cos;
        if (along > 3 && along < 16 && Math.abs(lat) < 1.8) { drafting = true; break; }
      }
      c.slipstream = drafting ? c.slipstream + dt : Math.max(0, c.slipstream - dt * 2);
      if (drafting && c.isPlayer && Math.random() < 0.4) {
        const p = W(3 + Math.random() * 4, 0.8 + Math.random(), (Math.random() - 0.5) * 2.5);
        fx.spawn({ x: p[0], y: p[1], z: p[2], vx: -c.vel.x * 0.3, vy: 0, vz: -c.vel.z * 0.3, life: 0.25, size: 0.5, color: [0.8, 0.9, 1], alpha: 0.6, shape: SHAPE.DOT });
      }
      if (c.slipstream > 1.6) { c.boost(0.9, 1.25, 'slip'); c.slipstream = 0; }
    } else c.slipstream = 0;
  }

  render() {
    this.camera.aspect = this.view.cssW / this.view.cssH;
    this.view.render(this.scene, this.camera, this.time);
  }

  dispose() {
    this.hud.dispose();
    this.items.dispose();
    this.props.dispose();
    this.pads.dispose();
    this.fx.dispose();
    for (const c of this.cars) { c.model.dispose(); }
    this.track.dispose();
    this.scene.clear();
    const f = this.view.post.fx;
    f.uSpeed.value = 0; f.uFocus.value = 0; f.uGlitch.value = 0; f.uAberr.value = 0; f.uFlash.value = 0;
  }
}
