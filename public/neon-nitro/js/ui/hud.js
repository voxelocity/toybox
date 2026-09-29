// In-race HUD (DOM overlay): place, laps, timer, item slot with roulette,
// speedometer + drift/boost meter, minimap, rival tags and banners.
import * as THREE from 'three';
import { ICONS, ITEM_ORDER, UI_ICONS } from './icons.js';
import { ITEMS } from '../race/items.js';
import { isTouch } from '../render/view.js';

const ORD = (n) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
export const fmtTime = (t) => { if (t == null || !isFinite(t)) return '--:--.--'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`; };

export class HUD {
  constructor(race) {
    this.race = race;
    const root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = `
      <div class="hud-place"><span class="num">8</span><span class="suf">th</span><span class="of">/8</span></div>
      <div class="hud-lap"><div class="lap">LAP <b>1</b>/<i>3</i></div><div class="time">0:00.00</div><div class="best"></div></div>
      <div class="hud-item"><div class="slot"><div class="reel"></div></div><div class="count"></div><div class="iname"></div></div>
      <canvas class="hud-map" width="220" height="220"></canvas>
      <div class="hud-speed"><svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="50"/><circle class="drift" cx="60" cy="60" r="50"/><circle class="boost" cx="60" cy="60" r="42"/></svg><div class="kmh"><b>0</b><span>km/h</span></div></div>
      <div class="hud-banner"></div>
      <div class="hud-count"></div>
      <div class="hud-title"></div>
      <div class="hud-wrong">WRONG WAY!</div>
      <div class="hud-tags"></div>
      <div class="hud-hurt"></div>
      ${isTouch ? `<div class="touch">
        <div class="tc-steer"></div><div class="tc-stick"><div class="tc-knob"></div></div>
        <button class="tc-btn tc-drift">DRIFT</button><button class="tc-btn tc-item">ITEM</button><button class="tc-btn tc-brake">BRAKE</button>
        <button class="tc-btn tc-back">BACK</button><button class="tc-pause">${UI_ICONS.pause}</button></div>` : '<button class="hud-pausebtn">' + UI_ICONS.pause + '</button>'}
    `;
    document.getElementById('app').appendChild(root);
    this.root = root;
    const $ = (s) => root.querySelector(s);
    this.el = {
      place: $('.hud-place'), num: $('.hud-place .num'), suf: $('.hud-place .suf'), of: $('.hud-place .of'),
      lap: $('.hud-lap b'), laps: $('.hud-lap i'), time: $('.hud-lap .time'), best: $('.hud-lap .best'),
      item: $('.hud-item'), reel: $('.hud-item .reel'), count: $('.hud-item .count'), iname: $('.hud-item .iname'),
      map: $('.hud-map'), kmh: $('.hud-speed b'), drift: $('.hud-speed .drift'), boost: $('.hud-speed .boost'), speed: $('.hud-speed'),
      banner: $('.hud-banner'), countEl: $('.hud-count'), title: $('.hud-title'), wrong: $('.hud-wrong'), tags: $('.hud-tags'), hurtEl: $('.hud-hurt'),
    };
    this.el.laps.textContent = race.laps;
    this.el.of.textContent = '/' + race.cars.length;
    if (race.opts.mode === 'tt') { this.el.place.style.display = 'none'; this.el.item.classList.add('tt'); }
    if (isTouch) race.input.bindTouch(root.querySelector('.touch'));
    const pb = root.querySelector('.hud-pausebtn');
    if (pb) pb.addEventListener('click', () => race.game.pauseRace());
    this.itemShown = null;
    this.mapCtx = this.el.map.getContext('2d');
    this._buildMap();
    this.tagEls = new Map();
    this._v = new THREE.Vector3();
    this.circ = 2 * Math.PI * 50;
    this.el.drift.style.strokeDasharray = `${this.circ} ${this.circ}`;
    this.el.boost.style.strokeDasharray = `${2 * Math.PI * 42} ${2 * Math.PI * 42}`;
    this.lastPlace = 0;
  }

  _buildMap() {
    const p = this.race.track.path;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < p.N; i++) { minX = Math.min(minX, p.px[i]); maxX = Math.max(maxX, p.px[i]); minZ = Math.min(minZ, p.pz[i]); maxZ = Math.max(maxZ, p.pz[i]); }
    const size = Math.max(maxX - minX, maxZ - minZ);
    const W = 220, pad = 18;
    this.mapT = { s: (W - pad * 2) / size, ox: pad - minX * ((W - pad * 2) / size) + ((size - (maxX - minX)) / 2) * ((W - pad * 2) / size), oz: pad - minZ * ((W - pad * 2) / size) + ((size - (maxZ - minZ)) / 2) * ((W - pad * 2) / size) };
    const off = document.createElement('canvas'); off.width = off.height = W;
    const c = off.getContext('2d');
    const T = this.mapT;
    const line = (w, col) => { c.beginPath(); for (let i = 0; i <= p.N; i += 3) { const k = i % p.N; const x = p.px[k] * T.s + T.ox, y = p.pz[k] * T.s + T.oz; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath(); c.lineWidth = w; c.strokeStyle = col; c.lineJoin = 'round'; c.stroke(); };
    line(13, '#140818'); line(8, '#f4f0ff'); line(3, '#8a7ad8');
    const s0x = p.px[0] * T.s + T.ox, s0y = p.pz[0] * T.s + T.oz;
    c.fillStyle = '#ffe23b'; c.strokeStyle = '#140818'; c.lineWidth = 2; c.fillRect(s0x - 4, s0y - 4, 8, 8); c.strokeRect(s0x - 4, s0y - 4, 8, 8);
    this.mapBg = off;
  }

  showTitle(def) {
    this.el.title.innerHTML = `<div class="t-jp">${def.jp || ''}</div><div class="t-name">${def.name}</div><div class="t-sub">${this.race.laps} LAPS${this.race.opts.gp ? ` · ROUND ${this.race.opts.gp.round}/${this.race.opts.gp.total}` : ''}${this.race.opts.cls ? ' · ' + this.race.opts.cls.name.toUpperCase() : ''}</div>${this.race.opts.skipIntro ? '' : `<div class="t-skip">${isTouch ? 'TAP ITEM' : 'PRESS ITEM / SPACE'} TO SKIP</div>`}`;
    this.el.title.classList.add('on');
  }
  hideTitle() { this.el.title.classList.remove('on'); }

  count(n) {
    const el = this.el.countEl;
    el.textContent = n;
    el.className = 'hud-count c' + n;
    void el.offsetWidth;
    el.classList.add('on');
  }
  go() {
    const el = this.el.countEl;
    el.textContent = 'GO!';
    el.className = 'hud-count go';
    void el.offsetWidth;
    el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), 900);
  }
  banner(text, cls = '') {
    const el = this.el.banner;
    el.textContent = text;
    el.className = 'hud-banner ' + cls;
    void el.offsetWidth;
    el.classList.add('on');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => el.classList.remove('on'), 2200);
  }
  finish(place) {
    this.banner('FINISH!', 'finish');
    this.root.classList.add('finished');
    void place;
  }
  wrongWay(on) { this.el.wrong.classList.toggle('on', on); }
  placeChange(up) { this.el.place.classList.remove('up', 'down'); void this.el.place.offsetWidth; this.el.place.classList.add(up ? 'up' : 'down'); }
  hurt() { const e = this.el.hurtEl; e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); }
  flashHit() {}
  smash() {}
  driftLevel(l) { this.el.speed.classList.remove('l1', 'l2', 'l3'); this.el.speed.classList.add('l' + l); }
  itemGot(id) { this.el.item.classList.add('got'); setTimeout(() => this.el.item.classList.remove('got'), 300); void id; }

  update(dt) {
    const r = this.race, pl = r.player;
    if (!pl) return;
    // place
    const place = pl.finished ? pl.finalPlace : pl.place;
    if (place !== this.lastPlace) {
      this.el.num.textContent = place;
      this.el.suf.textContent = ORD(place).slice(-2);
      this.el.place.dataset.p = place;
      this.lastPlace = place;
    }
    this.el.lap.textContent = Math.max(1, Math.min(r.laps, pl.lap));
    this.el.time.textContent = fmtTime(r.state === 'race' || r.state === 'finish' ? (pl.finished ? pl.finishTime : r.raceTime) : 0);
    if (pl.bestLap) this.el.best.textContent = 'BEST ' + fmtTime(pl.bestLap);
    // speed + meters
    this.el.kmh.textContent = Math.round(Math.max(0, pl.speed) * 4.2);
    const d = pl.drift;
    const lvlT = [0.5, 1.15, 1.95];
    const frac = d.on ? Math.min(1, d.t / lvlT[2]) : 0;
    this.el.drift.style.strokeDashoffset = this.circ * (1 - frac);
    this.el.drift.style.stroke = ['#ffffff', '#35c8ff', '#ff9a1e', '#d05cff'][d.on ? d.level : 0];
    const bc = 2 * Math.PI * 42;
    this.el.boost.style.strokeDashoffset = bc * (1 - Math.min(1, pl.boostT / 1.5));
    if (!d.on) this.el.speed.classList.remove('l1', 'l2', 'l3');
    this.el.speed.classList.toggle('boosting', pl.boostT > 0);
    // item slot
    let showId = null, rolling = false;
    if (pl.rolling > 0) { rolling = true; }
    else if (pl.item) showId = pl.item;
    if (rolling) {
      if (!this._rollT || (this._rollT -= dt) <= 0) {
        this._rollI = ((this._rollI || 0) + 1) % ITEM_ORDER.length;
        this.el.reel.innerHTML = ICONS[ITEM_ORDER[this._rollI]];
        this._rollT = 0.07;
        r.audio?.sfx('tick', { vol: 0.35 });
      }
      this.el.item.classList.add('rolling');
      this.el.iname.textContent = '';
      this.itemShown = '__roll';
    } else if (showId !== this.itemShown || (showId && this._cnt !== pl.itemCount)) {
      this.el.item.classList.remove('rolling');
      this.el.reel.innerHTML = showId ? ICONS[showId] : '';
      this.el.iname.textContent = showId ? ITEMS[showId].name : '';
      this.itemShown = showId;
      this._cnt = pl.itemCount;
      this.el.count.textContent = showId && pl.itemCount > 1 ? '×' + pl.itemCount : '';
      this.el.item.classList.toggle('has', !!showId);
    }
    // minimap
    const c = this.mapCtx, T = this.mapT;
    c.clearRect(0, 0, 220, 220);
    c.drawImage(this.mapBg, 0, 0);
    for (const car of [...r.cars].sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0))) {
      const x = car.pos.x * T.s + T.ox, y = car.pos.z * T.s + T.oz;
      c.beginPath(); c.arc(x, y, car.isPlayer ? 7 : 5, 0, Math.PI * 2);
      c.fillStyle = car.isPlayer ? '#ffe23b' : car.color; c.fill();
      c.lineWidth = 2.5; c.strokeStyle = '#140818'; c.stroke();
    }
    for (const o of r.items.objs) {
      if (o.kind !== 'missile') continue;
      const x = o.x * T.s + T.ox, y = o.z * T.s + T.oz;
      c.fillStyle = '#ff2d45'; c.fillRect(x - 3, y - 3, 6, 6);
    }
    // rival tags (cars ahead & close)
    const cam = r.camera;
    const W = r.view.cssW, H = r.view.cssH;
    for (const car of r.cars) {
      if (car.isPlayer) continue;
      let el = this.tagEls.get(car);
      const dist = car.pos.distanceTo(cam.position);
      const show = dist < 70 && r.state !== 'intro';
      if (!el) { el = document.createElement('div'); el.className = 'tag'; this.el.tags.appendChild(el); this.tagEls.set(car, el); }
      if (!show) { el.style.display = 'none'; continue; }
      this._v.set(car.pos.x, car.pos.y + 2.6, car.pos.z).project(cam);
      if (this._v.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${(this._v.x * 0.5 + 0.5) * W}px, ${(-this._v.y * 0.5 + 0.5) * H}px) translate(-50%, -100%) scale(${Math.max(0.6, 1.2 - dist / 70)})`;
      const txt = `${car.place} ${car.name}`;
      if (el.textContent !== txt) el.textContent = txt;
    }
  }

  dispose() { clearTimeout(this._bt); this.root.remove(); }
}
