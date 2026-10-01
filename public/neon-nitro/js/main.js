// Neon Nitro — game shell: boot, main loop, menus <-> races, GP flow, economy.
import * as THREE from 'three';
import { View, isTouch } from './render/view.js';
import { G } from './render/toon.js';
import { Input } from './core/input.js';
import { Save } from './core/save.js';
import { Audio } from './core/audio.js';
import { Race } from './race/race.js';
import { Showroom } from './render/showroom.js';
import { UI } from './ui/ui.js';
import { CLASSES, CUPS, TRACKS, RIVALS, POINTS, PAYOUT, CUP_BONUS, TT_REWARD, TT_PAR } from './core/data.js';
import { BODIES, randomConfig, defaultConfig } from './cars/catalog.js';

const bootBar = document.querySelector('#boot .boot-bar i');
const bootMsg = document.querySelector('#boot .boot-msg');
const progress = (f, msg) => { if (bootBar) bootBar.style.width = Math.round(f * 100) + '%'; if (msg && bootMsg) bootMsg.textContent = msg; };


class Game {
  constructor() {
    this.mode = 'boot';
    this.race = null;
    this.gp = null;
    this.last = performance.now();
    this.time = 0;
  }

  async boot() {
    progress(0.05, 'Inking the panels…');
    if (isTouch) document.body.classList.add('touch');
    try { await Promise.race([Promise.all([document.fonts.load('40px Bangers'), document.fonts.load('40px "Dela Gothic One"', '風雷鬼走り屋渋谷'), document.fonts.load('800 16px "Neon Nitro JP"', '渋谷')]), new Promise((r) => setTimeout(r, 2500))]); } catch { /* fallback fonts */ }
    this.save = new Save();
    progress(0.2, 'Charging neon…');
    this.view = new View(document.getElementById('gl'));
    this.applySettings();
    this.input = new Input();
    this.audio = new Audio(this);
    progress(0.4, 'Polishing chrome…');
    this.showroom = new Showroom(this);
    await this.showroom.build();
    progress(0.8, 'Tuning turbos…');
    this.ui = new UI(this);
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: false });
    window.addEventListener('keydown', () => this.audio.unlock(), { once: false });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.audio.suspend(); if (this.mode === 'race' && this.race?.state === 'race') this.pauseRace(); } else this.audio.resume(); });
    progress(1, 'GO!');
    const q = new URLSearchParams(location.search);
    this.mode = 'menu';
    this.loop();
    setTimeout(() => document.getElementById('boot').classList.add('hide'), 250);
    if (q.get('race')) {
      if (!this.save.d.starterChosen) { this.save.d.starterChosen = true; this.save.d.cars.kaze.owned = true; }
      this.startRace({ trackId: q.get('race'), mode: q.get('mode') || 'quick', cls: q.get('cls') || 'street', skipIntro: q.has('skip'), autoPlayer: q.has('autoplay') });
    } else if (q.get('screen')) this.ui.show(q.get('screen'));
    else this.ui.show('title');
    window.__game = this;
    window.__ready = true;
  }

  applySettings() {
    const s = this.save.d.settings;
    let qn = s.quality;
    if (qn === 'auto') qn = isTouch ? 'medium' : 'high';
    this.view.setQuality(qn, s.quality === 'auto');
    this.audio?.setVolumes(s);
    if (this.input) { this.input.autoAccel = s.autoAccel; this.input.tilt = s.tilt; this.input.sensitivity = s.sens; }
    let fps = document.getElementById('fps');
    if (s.fps && !fps) { fps = document.createElement('div'); fps.id = 'fps'; document.getElementById('app').appendChild(fps); }
    if (!s.fps && fps) fps.remove();
  }

  loop() {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.0005, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.view.tick(dt);
    this.ui.frame(dt);
    this.input.poll(dt);
    if (this.mode === 'race' && this.race) {
      this.race.update(dt);
      this.race.render();
    } else if (this.mode === 'menu') {
      G.uTime.value = this.time;
      this.showroom.update(dt);
      this.view.render(this.showroom.scene, this.showroom.camera, this.time);
    }
    const fps = document.getElementById('fps');
    if (fps) fps.textContent = `${this.view.fpsAvg.toFixed(0)} fps · ${this.view.post.stats?.calls ?? 0} calls · ${((this.view.post.stats?.tris ?? 0) / 1000).toFixed(0)}k tris · scale ${this.view.dynScale.toFixed(2)}`;
    requestAnimationFrame(() => this.loop());
  }

  // ------------------------------------------------------------ races
  playerEntry() {
    const d = this.save.d;
    return { name: d.name || 'YOU', cfg: { ...this.save.car(d.current).cfg, body: d.current } };
  }

  pickRivals(n, cls) {
    const pool = [...RIVALS].sort(() => Math.random() - 0.5).slice(0, n);
    return pool.map((r, i) => {
      const cfg = { ...defaultConfig(r.body), ...r.cfg, body: r.body };
      return { name: r.name, cfg, pace: cls.pace * (0.965 + Math.random() * 0.05) * (i === 0 ? 1.015 : 1), skill: Math.min(1, cls.skill + (Math.random() - 0.3) * 0.2), aggr: 0.3 + Math.random() * 0.6, number: 10 + ((i * 37) % 89) };
    });
  }

  async startRace(o) {
    const cls = CLASSES.find((c) => c.id === (o.cls || 'street')) || CLASSES[0];
    this.ui.loading(TRACKS[o.trackId]);
    await new Promise((r) => setTimeout(r, 30));
    let def;
    try { def = (await import(`./track/tracks/${o.trackId}.js`)).default; }
    catch (e) { console.error(e); this.ui.toast('Track failed to load'); this.ui.show('main'); return; }
    this.disposeRace();
    const player = this.playerEntry();
    const rivals = o.mode === 'tt' ? [] : (o.rivals || this.pickRivals(7, cls));
    this.lastRaceOpts = { ...o, rivals };
    const race = new Race(this, {
      def, laps: o.mode === 'tt' ? 3 : this.save.d.settings.laps || def.laps || 3, mode: o.mode, cls, player, rivals, gp: o.gp, skipIntro: o.skipIntro, autoPlayer: o.autoPlayer,
      playerSlot: o.mode === 'gp' && o.gp ? Math.max(0, 7 - (o.gp.lastPlace ? 8 - o.gp.lastPlace : 1)) : 6,
      onFinish: (res) => this.onRaceFinish(res, o, cls),
    });
    this.race = race;
    await race.load();
    this.mode = 'race';
    document.body.classList.add('racing');
    this.ui.clear();
    this.input.enabled = true;
    try { if (isTouch && document.documentElement.requestFullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { /* optional */ }
    try { await screen.orientation?.lock?.('landscape'); } catch { /* optional */ }
  }

  disposeRace() {
    if (this.race) { this.race.dispose(); this.race = null; }
    document.body.classList.remove('racing');
  }

  onRaceFinish(results, o, cls) {
    const d = this.save.d;
    const me = results.find((r) => r.isPlayer);
    const place = me.place;
    let earned = 0;
    const report = { results, place, cls, mode: o.mode, trackId: o.trackId, lines: [] };
    if (o.mode === 'tt') {
      const par = TT_PAR[o.trackId] || [60, 66, 72];
      const t = me.time;
      const prev = d.tt[o.trackId];
      if (!prev || t < prev) d.tt[o.trackId] = t;
      const medal = t <= par[0] ? 'gold' : t <= par[1] ? 'silver' : t <= par[2] ? 'bronze' : null;
      report.medal = medal; report.par = par; report.best = d.tt[o.trackId];
      d.ttMedals = d.ttMedals || {};
      const had = d.ttMedals[o.trackId];
      const rank = { gold: 3, silver: 2, bronze: 1 };
      if (medal && (!had || rank[medal] > rank[had])) { earned += TT_REWARD[medal] - (had ? TT_REWARD[had] : 0); d.ttMedals[o.trackId] = medal; report.lines.push([`New ${medal} medal`, TT_REWARD[medal] - (had ? TT_REWARD[had] : 0)]); }
    } else {
      earned = Math.round(PAYOUT[place - 1] * cls.pay);
      report.lines.push([`${place}${['st', 'nd', 'rd'][place - 1] || 'th'} place prize`, earned]);
      d.stats.races++;
      if (place === 1) d.stats.wins++;
      if (place <= 3) d.stats.podiums++;
    }
    if (o.mode === 'gp' && this.gp) {
      const gp = this.gp;
      for (const r of results) gp.points[r.name] = (gp.points[r.name] || 0) + POINTS[r.place - 1];
      gp.round++;
      gp.lastPlace = place;
      report.gp = gp;
      if (gp.round >= gp.cup.tracks.length) {
        const standings = Object.entries(gp.points).sort((a, b) => b[1] - a[1]);
        const pos = standings.findIndex(([n]) => n === (d.name || 'YOU')) + 1;
        const trophy = pos === 1 ? 3 : pos === 2 ? 2 : pos === 3 ? 1 : 0;
        report.final = { standings, pos, trophy };
        if (trophy) {
          const bonus = Math.round(CUP_BONUS[trophy] * cls.pay);
          earned += bonus;
          report.lines.push([`${['', 'Bronze', 'Silver', 'Gold'][trophy]} trophy bonus`, bonus]);
          const before = { pro: this.classOpen('pro'), legend: this.classOpen('legend'), kaiju: this.cupOpen('kaiju') };
          this.save.setTrophy(gp.cup.id, cls.id, trophy);
          report.unlocks = [];
          if (!before.kaiju && this.cupOpen('kaiju')) report.unlocks.push('KAIJU CUP UNLOCKED!');
          if (!before.pro && this.classOpen('pro')) report.unlocks.push('PRO CLASS UNLOCKED!');
          if (!before.legend && this.classOpen('legend')) report.unlocks.push('LEGEND CLASS UNLOCKED!');
        }
      }
    }
    d.money += earned;
    d.stats.earned += earned;
    report.earned = earned;
    this.save.write();
    this.lastReport = report;
    setTimeout(() => { this.ui.show('results', report); }, 400);
  }

  classOpen(id) { return CLASSES.find((c) => c.id === id) && (id === 'street' || CUPS.every((c) => this.save.trophy(c.id, id === 'pro' ? 'street' : 'pro') > 0)); }
  cupOpen(id) { return id === 'neon' || ['street', 'pro', 'legend'].some((cl) => this.save.trophy('neon', cl) > 0); }

  startGP(cupId, clsId) {
    const cup = CUPS.find((c) => c.id === cupId);
    const cls = CLASSES.find((c) => c.id === clsId);
    this.gp = { cup, cls, round: 0, points: {}, rivals: this.pickRivals(7, cls), lastPlace: 0 };
    this.nextGPRace();
  }

  nextGPRace() {
    const gp = this.gp;
    const trackId = gp.cup.tracks[gp.round];
    this.startRace({ trackId, mode: 'gp', cls: gp.cls.id, rivals: gp.rivals, gp: { round: gp.round + 1, total: gp.cup.tracks.length, lastPlace: gp.lastPlace } });
  }

  retryRace() {
    const o = this.lastRaceOpts;
    if (o.mode === 'gp' && this.gp) {
      // undo last round's points
      const last = this.lastReport?.results;
      if (last) for (const r of last) this.gp.points[r.name] -= POINTS[r.place - 1];
      this.gp.round--;
    }
    this.startRace({ ...o, skipIntro: true });
  }

  pauseRace() {
    if (!this.race || this.race.paused) return;
    this.race.paused = true;
    this.audio.pauseMusic(true);
    this.ui.modal('pause');
  }
  resumeRace() {
    if (!this.race) return;
    this.race.paused = false;
    this.last = performance.now();
    this.audio.pauseMusic(false);
    this.ui.closeModal();
  }
  quitToMenu(screen = 'main') {
    this.disposeRace();
    this.gp = null;
    this.mode = 'menu';
    this.audio.music('menu');
    this.showroom.setCar(this.save.d.current);
    this.ui.closeModal();
    this.ui.show(screen);
  }
}

const game = new Game();
game.boot().catch((e) => {
  console.error(e);
  const m = document.querySelector('#boot .boot-msg');
  if (m) m.textContent = 'Could not start: ' + (e.message || e) + ' (WebGL2 required)';
});
export { game, BODIES, randomConfig, THREE };
