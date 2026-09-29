// Screen manager + menus. DOM-based, comic styled, keyboard/gamepad/touch.
import { CLASSES, CUPS, TRACKS, money, POINTS, TT_PAR } from '../core/data.js';
import { BODIES, BODY_ORDER, STAT_KEYS, STAT_LABELS, statsFor } from '../cars/catalog.js';
import { UI_ICONS } from './icons.js';
import { fmtTime } from './hud.js';
import { Garage } from './garage.js';
import { Path } from '../track/path.js';
import { isTouch } from '../render/view.js';

const h = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const trackPreviewCache = new Map();
async function trackPreview(id, w = 220, hgt = 130) {
  const key = id + w + 'x' + hgt;
  if (trackPreviewCache.has(key)) return trackPreviewCache.get(key);
  const def = (await import(`../track/tracks/${id}.js`)).default;
  const p = new Path(def.points, { width: def.width ?? 18 });
  const c = document.createElement('canvas'); c.width = w * 2; c.height = hgt * 2;
  const x = c.getContext('2d');
  let a = 1e9, b = -1e9, cmin = 1e9, cmax = -1e9;
  for (let i = 0; i < p.N; i++) { a = Math.min(a, p.px[i]); b = Math.max(b, p.px[i]); cmin = Math.min(cmin, p.pz[i]); cmax = Math.max(cmax, p.pz[i]); }
  const s = Math.min((c.width - 40) / (b - a), (c.height - 40) / (cmax - cmin));
  const ox = (c.width - (b - a) * s) / 2 - a * s, oz = (c.height - (cmax - cmin) * s) / 2 - cmin * s;
  const draw = (lw, col) => { x.beginPath(); for (let i = 0; i <= p.N; i += 3) { const k = i % p.N; const X = p.px[k] * s + ox, Y = p.pz[k] * s + oz; i ? x.lineTo(X, Y) : x.moveTo(X, Y); } x.closePath(); x.lineWidth = lw; x.strokeStyle = col; x.lineJoin = 'round'; x.stroke(); };
  draw(16, '#140818'); draw(9, '#fff8ea'); draw(3, def.theme?.rim || '#ff2d6f');
  x.fillStyle = '#ffe23b'; x.strokeStyle = '#140818'; x.lineWidth = 3; x.beginPath(); x.arc(p.px[0] * s + ox, p.pz[0] * s + oz, 9, 0, 7); x.fill(); x.stroke();
  trackPreviewCache.set(key, c);
  return c;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    this.cur = null;
    this.modalEl = null;
    this.focusIdx = 0;
    this._padPrev = {};
    this.garage = null;
  }

  // ------------------------------------------------------------ plumbing
  clear() {
    if (this.cur?.destroy) this.cur.destroy();
    this.cur = null;
    this.root.querySelectorAll('.screen').forEach((e) => e.remove());
  }

  show(name, arg) {
    this.clear();
    const fn = this['s_' + name];
    if (!fn) return;
    const s = fn.call(this, arg) || {};
    this.cur = { name, ...s };
    document.body.classList.toggle('post-race', name === 'results' || name === 'ceremony');
    if (s.el) { s.el.classList.add('screen'); this.root.appendChild(s.el); }
    this.focusIdx = 0;
    this._focus();
    this.game.audio?.sfx('ui', { vol: 0.5 });
  }

  navEls() {
    const scope = this.modalEl || this.cur?.el;
    if (!scope) return [];
    return [...scope.querySelectorAll('[data-nav]')].filter((e) => !e.disabled && e.offsetParent !== null);
  }
  _focus() {
    const els = this.navEls();
    els.forEach((e, i) => e.classList.toggle('focus', i === this.focusIdx && this.kbd));
    if (this.kbd && els[this.focusIdx]) els[this.focusIdx].scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  frame() {
    const inp = this.game.input;
    const k = inp.menuKeys();
    // gamepad
    const pad = navigator.getGamepads ? [...navigator.getGamepads()].find((p) => p && p.connected) : null;
    const pe = (i) => { const v = !!(pad && pad.buttons[i] && pad.buttons[i].pressed); const was = this._padPrev[i]; this._padPrev[i] = v; return v && !was; };
    if (pad) {
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      const dir = Math.abs(ax) > 0.6 ? (ax > 0 ? 'r' : 'l') : Math.abs(ay) > 0.6 ? (ay > 0 ? 'd' : 'u') : null;
      if (dir && dir !== this._padDir) { k[{ r: 'right', l: 'left', u: 'up', d: 'down' }[dir]] = true; }
      this._padDir = dir;
      if (pe(12)) k.up = true; if (pe(13)) k.down = true; if (pe(14)) k.left = true; if (pe(15)) k.right = true;
      if (pe(0)) k.ok = true; if (pe(1)) k.back = true;
      if (pe(4) && this.cur?.prevTab) this.cur.prevTab(); if (pe(5) && this.cur?.nextTab) this.cur.nextTab();
    }
    if (this.game.mode === 'race' && !this.modalEl) return;
    if (this.cur?.name === 'title' && !this.modalEl && (k.ok || k.back || inp.pressed.size)) { this.cur.go?.(); return; }
    const els = this.navEls();
    if (k.up || k.down || k.left || k.right) {
      this.kbd = true;
      if (!els.length) return;
      const d = k.up || k.left ? -1 : 1;
      if ((k.left || k.right) && this.cur?.lr && !this.modalEl) { this.cur.lr(k.left ? -1 : 1); return; }
      this.focusIdx = (this.focusIdx + d + els.length) % els.length;
      this._focus();
      els[this.focusIdx]?.scrollIntoView?.({ block: 'nearest' });
      this.game.audio?.sfx('ui', { vol: 0.35 });
    }
    if (k.ok && els[this.focusIdx] && this.kbd) { els[this.focusIdx].click(); }
    if (k.back) {
      if (this.modalEl) { this.modalEl._onBack ? this.modalEl._onBack() : this.closeModal(); }
      else this.cur?.back?.();
    }
  }

  toast(msg) {
    const t = h(`<div class="toast">${esc(msg)}</div>`);
    document.getElementById('app').appendChild(t);
    setTimeout(() => t.remove(), 2300);
  }

  bumpMoney() { this.root.querySelectorAll('.money').forEach((m) => { m.classList.remove('bump'); void m.offsetWidth; m.classList.add('bump'); m.querySelector('b').textContent = money(this.game.save.d.money); }); }
  moneyHTML() { return `<div class="money">${UI_ICONS.coin}<b>${money(this.game.save.d.money)}</b></div>`; }

  loading(meta) {
    this.clear();
    const el = h(`<div class="screen fill halftone" style="align-items:center;justify-content:center;text-align:center">
      <div style="font-family:var(--jp);font-size:34px;color:var(--pink);text-shadow:3px 3px 0 var(--ink)">${esc(meta?.jp || '')}</div>
      <div class="logo"><span class="l1" style="font-size:clamp(46px,9vw,110px)">${esc(meta?.name || 'Loading')}</span></div>
      <div class="press" style="animation-duration:.5s">LOADING…</div></div>`);
    this.root.appendChild(el);
    this.cur = { name: 'loading', el };
  }

  modal(name, arg) {
    this.closeModal();
    const fn = this['m_' + name];
    if (!fn) return;
    const box = fn.call(this, arg);
    const bg = h('<div class="modal-bg"></div>');
    bg.appendChild(box);
    this.root.appendChild(bg);
    this.modalEl = bg;
    bg._onBack = box._onBack;
    this.focusIdx = 0;
    this._focus();
  }
  closeModal() { if (this.modalEl) { this.modalEl.remove(); this.modalEl = null; this.focusIdx = 0; } }

  // ------------------------------------------------------------ screens
  s_title() {
    const g = this.game;
    g.showroom.frame('title');
    g.audio.music('menu');
    const el = h(`<div class="title-screen"><div class="logo"><span class="l1">NEON</span><span class="l2">NITRO</span><span class="l3">ネオン・ニトロ　ドリフトバトル</span></div>
      <div class="press">${isTouch ? 'TAP TO START' : 'PRESS ANY KEY'}</div>
      <div class="title-foot">Neo-Tokyo drift battle · ${isTouch ? 'best in landscape' : 'keyboard, gamepad or touch'}</div></div>`);
    const go = () => { g.audio.unlock(); g.audio.music('menu'); this.show(g.save.d.starterChosen ? 'main' : 'starter'); };
    el.addEventListener('click', go);
    return { el, go };
  }

  s_starter() {
    const g = this.game;
    g.showroom.frame('menu');
    const el = h(`<div class="dim"><div class="topbar"><h1>CHOOSE YOUR RIDE<small>最初の一台</small></h1></div>
      <p style="max-width:520px;color:#cfc6ff;margin:4px 0 0">Your first car is on the house. Win races to earn yen, then buy and build the others.</p>
      <div class="cards" style="margin:auto 0;justify-content:flex-start"></div></div>`);
    const cards = el.querySelector('.cards');
    for (const id of BODY_ORDER) {
      const b = BODIES[id];
      const st = b.base;
      const c = h(`<div class="card" data-nav><h2>${b.name}</h2><div class="jp">${b.jp} · ${b.kind.toUpperCase()}</div><p>${b.blurb}</p>
        <div class="stats">${STAT_KEYS.map((k) => `<div class="statrow"><span>${STAT_LABELS[k]}</span><div class="bar"><i style="width:${st[k] * 10}%"></i></div></div>`).join('')}</div>
        <button class="btn pink small" style="margin-top:12px">TAKE IT!</button></div>`);
      c.addEventListener('mouseenter', () => g.showroom.setCar(id));
      c.addEventListener('click', () => {
        if (c.dataset.pick) {
          g.save.d.cars[id].owned = true; g.save.d.current = id; g.save.d.starterChosen = true; g.save.write();
          g.audio.sfx('buy'); this.toast(`${b.name} is yours!`); this.show('main');
        } else { cards.querySelectorAll('.card').forEach((x) => delete x.dataset.pick); c.dataset.pick = 1; g.showroom.setCar(id); if (isTouch || this.kbd) c.click(); }
      });
      cards.appendChild(c);
    }
    g.showroom.setCar(BODY_ORDER[0]);
    return { el };
  }

  s_main() {
    const g = this.game;
    g.showroom.frame('menu');
    g.showroom.setCar(g.save.d.current);
    g.audio.music('menu');
    const car = BODIES[g.save.d.current];
    const el = h(`<div class="dim"><div class="topbar"><h1>NEON NITRO<small>ネオン・ニトロ</small></h1><div class="spacer"></div>${this.moneyHTML()}</div>
      <div class="menu-main">
        <button class="btn primary" data-nav data-a="gp">GRAND PRIX<span class="jp">グランプリ</span></button>
        <button class="btn" data-nav data-a="quick">QUICK RACE<span class="jp">フリー走行</span></button>
        <button class="btn" data-nav data-a="tt">TIME TRIAL<span class="jp">タイムアタック</span></button>
        <button class="btn cyan" data-nav data-a="garage">GARAGE &amp; SHOP<span class="jp">ガレージ</span></button>
        <div style="display:flex;gap:12px"><button class="btn small" data-nav data-a="settings">SETTINGS</button><button class="btn small" data-nav data-a="howto">HOW TO PLAY</button></div>
      </div>
      <div class="carinfo"><div class="nm"><span class="jp">${car.jp}</span>${car.name}</div><div class="sub">${g.save.d.stats.wins} wins · ${g.save.d.stats.races} races</div></div></div>`);
    el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'settings' || a === 'howto') this.modal(a); else this.show(a);
    }));
    return { el, back: () => this.show('title') };
  }

  s_gp() {
    const g = this.game;
    let clsId = this._gpCls || 'street';
    if (!g.classOpen(clsId)) clsId = 'street';
    const el = h(`<div class="fill halftone"><div class="topbar"><button class="btn back small" data-nav data-a="back">◀ BACK</button><h1>GRAND PRIX<small>グランプリ</small></h1><div class="spacer"></div>${this.moneyHTML()}</div>
      <div class="seg classes" style="justify-content:center;margin-top:10px"></div><div class="cards"></div></div>`);
    const segs = el.querySelector('.classes'), cards = el.querySelector('.cards');
    const render = () => {
      segs.innerHTML = '';
      for (const c of CLASSES) {
        const open = g.classOpen(c.id);
        const b = h(`<button class="${c.id === clsId ? 'on' : ''}" data-nav ${open ? '' : 'disabled'} style="font-size:22px;padding:4px 18px">${open ? '' : '🔒 '}${c.name.toUpperCase()} <span style="font-family:var(--jp);font-size:14px">${c.jp}</span></button>`);
        if (!open) b.title = c.unlock;
        b.addEventListener('click', () => { clsId = c.id; this._gpCls = c.id; render(); });
        segs.appendChild(b);
      }
      cards.innerHTML = '';
      for (const cup of CUPS) {
        const open = g.cupOpen(cup.id);
        const tro = CLASSES.map((c) => `<span class="tr${g.save.trophy(cup.id, c.id)}">${UI_ICONS.trophy}${c.name}</span>`).join('');
        const card = h(`<div class="card ${open ? '' : 'locked'}" ${open ? 'data-nav' : ''} style="width:300px"><h2 style="color:${cup.color};-webkit-text-stroke:1.5px var(--ink)">${cup.name}</h2><div class="jp">${cup.jp}</div>
          <p>${cup.tracks.map((t, i) => `<b style="font-family:var(--comic);font-size:17px;letter-spacing:.5px">${i + 1}. ${TRACKS[t].name}</b>`).join('<br>')}</p>
          <p style="font-size:12px;opacity:.7">${CLASSES.find((c) => c.id === clsId).desc}</p>
          ${open ? `<div class="trophies">${tro}</div><div class="badge">${CLASSES.find((c) => c.id === clsId).name.toUpperCase()}</div>` : `<p class="unlock-req">${cup.unlock}</p><div class="lockicon">${UI_ICONS.lock}</div>`}</div>`);
        if (open) card.addEventListener('click', () => { g.audio.sfx('go'); g.startGP(cup.id, clsId); });
        cards.appendChild(card);
      }
      this._focus();
    };
    render();
    el.querySelector('[data-a=back]').addEventListener('click', () => this.show('main'));
    return { el, back: () => this.show('main') };
  }

  s_quick(mode = 'quick') {
    const g = this.game;
    const tt = mode === 'tt';
    let clsId = this._qCls || 'street';
    if (!g.classOpen(clsId)) clsId = 'street';
    const el = h(`<div class="fill halftone"><div class="topbar"><button class="btn back small" data-nav data-a="back">◀ BACK</button><h1>${tt ? 'TIME TRIAL<small>タイムアタック</small>' : 'QUICK RACE<small>フリー走行</small>'}</h1><div class="spacer"></div>${this.moneyHTML()}</div>
      ${tt ? '<p style="text-align:center;color:#cfc6ff;margin:6px 0 0">Solo, three laps, three nitros. Beat the par times for medal bonuses.</p>' : '<div class="seg classes" style="justify-content:center;margin-top:10px"></div>'}
      <div class="cards tracks"></div></div>`);
    const cards = el.querySelector('.cards');
    const segs = el.querySelector('.classes');
    const renderCls = () => {
      if (!segs) return;
      segs.innerHTML = '';
      for (const c of CLASSES) {
        const open = g.classOpen(c.id);
        const b = h(`<button class="${c.id === clsId ? 'on' : ''}" ${open ? '' : 'disabled'} style="font-size:20px;padding:3px 16px">${open ? '' : '🔒 '}${c.name.toUpperCase()}</button>`);
        b.addEventListener('click', () => { clsId = c.id; this._qCls = c.id; renderCls(); });
        segs.appendChild(b);
      }
    };
    renderCls();
    for (const cup of CUPS) for (const id of cup.tracks) {
      const open = g.cupOpen(cup.id);
      const t = TRACKS[id];
      const best = g.save.d.tt[id];
      const medal = g.save.d.ttMedals?.[id];
      const par = TT_PAR[id];
      const card = h(`<div class="card ${open ? '' : 'locked'}" ${open ? 'data-nav' : ''}><h2>${t.name}</h2><div class="jp">${t.jp} · ${cup.name}</div>
        <div class="preview"></div><p style="margin-top:0">${t.blurb}</p>
        ${tt ? `<p style="font-family:var(--comic);font-size:17px;letter-spacing:.5px">BEST ${best ? fmtTime(best) : '--'} ${medal ? `<span class="tr${{ gold: 3, silver: 2, bronze: 1 }[medal]}" style="display:inline-block;width:22px;vertical-align:middle">${UI_ICONS.trophy}</span>` : ''}<br><span style="font-size:13px;opacity:.75">GOLD ${fmtTime(par[0])} · SILVER ${fmtTime(par[1])} · BRONZE ${fmtTime(par[2])}</span></p>` : ''}
        ${open ? '' : `<div class="lockicon">${UI_ICONS.lock}</div>`}</div>`);
      trackPreview(id).then((cv) => { const img = new Image(); img.src = cv.toDataURL(); card.querySelector('.preview').appendChild(img); });
      if (open) card.addEventListener('click', () => { g.audio.sfx('go'); g.startRace({ trackId: id, mode, cls: clsId }); });
      cards.appendChild(card);
    }
    el.querySelector('[data-a=back]').addEventListener('click', () => this.show('main'));
    return { el, back: () => this.show('main') };
  }
  s_tt() { return this.s_quick('tt'); }

  s_garage() {
    this.garage = new Garage(this.game, this);
    const el = this.garage.el;
    return { el, back: () => this.garage.leave(), destroy: () => this.garage.destroy(), lr: null, prevTab: () => this.garage.tab(-1), nextTab: () => this.garage.tab(1) };
  }

  s_results(r) {
    const g = this.game;
    g.audio.engineOff();
    const pl = r.results.find((x) => x.isPlayer);
    const gp = r.gp;
    const rows = r.results.map((x) => `<tr class="${x.isPlayer ? 'me' : ''}"><td class="pl">${x.place}</td><td><span class="swatch" style="background:${x.cfg.paint}"></span>${esc(x.name)}</td><td class="tm">${fmtTime(x.time)}</td>${gp ? `<td class="pts">+${POINTS[x.place - 1]}</td>` : `<td class="cash">${r.mode === 'tt' ? '' : money(Math.round([3200, 2400, 1800, 1300, 1000, 800, 600, 450][x.place - 1] * r.cls.pay))}</td>`}</tr>`).join('');
    const title = r.mode === 'tt' ? (r.medal ? `${r.medal.toUpperCase()} MEDAL!` : 'TIME TRIAL') : pl.place === 1 ? 'YOU WIN!' : pl.place <= 3 ? 'PODIUM!' : `${pl.place}${['st', 'nd', 'rd'][pl.place - 1] || 'th'} PLACE`;
    const lines = r.lines.map(([t, v]) => `<div class="line" style="display:flex;justify-content:space-between;font-size:15px"><span>${esc(t)}</span><b>+${money(v)}</b></div>`).join('');
    const el = h(`<div class="fill" style="background:rgba(11,6,22,.6)"><div class="results">
      <h2>${title}</h2>
      ${pl.bestLap ? `<p class="bestlap">FASTEST LAP ${fmtTime(pl.bestLap)}</p>` : ''}
      ${r.mode === 'tt' ? `<p style="font-family:var(--comic);font-size:24px;letter-spacing:1px;margin:0">TIME ${fmtTime(pl.time)} · BEST ${fmtTime(r.best)}</p><p style="margin:2px 0">Par: gold ${fmtTime(r.par[0])} · silver ${fmtTime(r.par[1])} · bronze ${fmtTime(r.par[2])}</p>` : `<table>${rows}</table>`}
      ${lines}
      <div class="earn"><span>EARNED</span><b>+${money(r.earned)}</b></div>
      <div class="row-btns"></div></div></div>`);
    const btns = el.querySelector('.row-btns');
    const add = (label, cls, fn) => { const b = h(`<button class="btn ${cls}" data-nav>${label}</button>`); b.addEventListener('click', fn); btns.appendChild(b); return b; };
    if (gp && !r.final) {
      add('NEXT RACE ▶', 'pink', () => { g.audio.sfx('go'); g.nextGPRace(); });
      add('STANDINGS', '', () => this.modal('standings', r));
      add('RETRY', 'small', () => g.retryRace());
      add('QUIT CUP', 'small back', () => g.quitToMenu('main'));
    } else if (gp && r.final) {
      add('TROPHY ▶', 'pink', () => this.show('ceremony', r));
    } else {
      add('RETRY', 'pink', () => g.retryRace());
      add('GARAGE', 'cyan', () => g.quitToMenu('garage'));
      add('MENU', 'back', () => g.quitToMenu('main'));
    }
    g.save.write();
    return { el, back: () => g.quitToMenu('main') };
  }

  s_ceremony(r) {
    const g = this.game;
    const f = r.final;
    const tname = ['NO TROPHY', 'BRONZE', 'SILVER', 'GOLD'][f.trophy];
    const top3 = f.standings.slice(0, 3);
    const el = h(`<div class="fill halftone" style="align-items:center;justify-content:center;text-align:center"><div class="results" style="text-align:center;max-width:620px">
      <h2>${esc(r.gp.cup.name.toUpperCase())} · ${esc(r.cls.name.toUpperCase())}</h2>
      <svg class="bigtrophy tr${f.trophy}" viewBox="0 0 64 64">${UI_ICONS.trophy.replace(/<\/?svg[^>]*>/g, '')}</svg>
      <div style="font-family:var(--comic);font-size:44px;letter-spacing:2px">${f.trophy ? tname + ' TROPHY!' : 'FINISHED ' + f.pos + 'TH'}</div>
      <div class="podium">${[1, 0, 2].map((i) => top3[i] ? `<div class="p${i + 1}">${i + 1}<br>${esc(top3[i][0])}<br>${top3[i][1]} pts</div>` : '').join('')}</div>
      ${(r.unlocks || []).map((u) => `<div class="money" style="display:inline-flex;margin:4px;transform:rotate(-2deg)">${esc(u)}</div>`).join('')}
      <div class="earn"><span>TOTAL EARNED</span><b>+${money(r.earned)}</b></div>
      <div class="row-btns" style="justify-content:center"><button class="btn pink" data-nav>CONTINUE</button></div></div></div>`);
    el.querySelector('.btn').addEventListener('click', () => g.quitToMenu('main'));
    g.audio.sfx(f.trophy ? 'win' : 'finish');
    return { el, back: () => g.quitToMenu('main') };
  }

  // ------------------------------------------------------------ modals
  m_pause() {
    const g = this.game;
    const box = h(`<div class="modal"><h2>PAUSED</h2><div class="stack">
      <button class="btn pink" data-nav data-a="resume">RESUME</button>
      <button class="btn" data-nav data-a="restart">RESTART</button>
      <button class="btn" data-nav data-a="settings">SETTINGS</button>
      <button class="btn" data-nav data-a="howto">HOW TO PLAY</button>
      <button class="btn back" data-nav data-a="quit">QUIT</button></div></div>`);
    box.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'resume') g.resumeRace();
      else if (a === 'restart') { this.closeModal(); g.retryRace(); }
      else if (a === 'settings') this.modal('settings', { fromPause: true });
      else if (a === 'howto') this.modal('howto', { fromPause: true });
      else if (a === 'quit') g.quitToMenu('main');
    }));
    box._onBack = () => g.resumeRace();
    return box;
  }

  m_settings(o = {}) {
    const g = this.game;
    const s = g.save.d.settings;
    const box = h(`<div class="modal"><h2>SETTINGS</h2>
      <div class="setting"><span>Master</span><input type="range" min="0" max="1" step="0.05" value="${s.master}" data-k="master"></div>
      <div class="setting"><span>Music</span><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-k="music"></div>
      <div class="setting"><span>Effects</span><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-k="sfx"></div>
      <div class="setting"><span>Graphics</span><div class="seg" data-seg="quality">${['auto', 'low', 'medium', 'high'].map((q) => `<button data-v="${q}" class="${s.quality === q ? 'on' : ''}">${q.toUpperCase()}</button>`).join('')}</div></div>
      <div class="setting"><span>Laps</span><div class="seg" data-seg="laps">${[2, 3, 4, 5].map((q) => `<button data-v="${q}" class="${s.laps === q ? 'on' : ''}">${q}</button>`).join('')}</div></div>
      <div class="setting"><span>Touch gas</span><div class="seg" data-seg="autoAccel"><button data-v="true" class="${s.autoAccel ? 'on' : ''}">AUTO</button><button data-v="false" class="${!s.autoAccel ? 'on' : ''}">MANUAL</button></div></div>
      <div class="setting"><span>Tilt steer</span><div class="seg" data-seg="tilt"><button data-v="false" class="${!s.tilt ? 'on' : ''}">OFF</button><button data-v="true" class="${s.tilt ? 'on' : ''}">ON</button></div></div>
      <div class="setting"><span>Steer sens.</span><input type="range" min="0.6" max="1.6" step="0.05" value="${s.sens}" data-k="sens"></div>
      <div class="setting"><span>Show FPS</span><div class="seg" data-seg="fps"><button data-v="false" class="${!s.fps ? 'on' : ''}">OFF</button><button data-v="true" class="${s.fps ? 'on' : ''}">ON</button></div></div>
      <div class="stack" style="margin-top:10px"><button class="btn pink" data-nav data-a="done">DONE</button>${o.fromPause ? '' : '<button class="btn small back" data-nav data-a="reset">RESET SAVE DATA</button>'}</div></div>`);
    box.querySelectorAll('input[type=range]').forEach((inp) => inp.addEventListener('input', () => { s[inp.dataset.k] = +inp.value; g.applySettings(); }));
    box.querySelectorAll('[data-seg]').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const k = seg.dataset.seg; let v = b.dataset.v;
      if (v === 'true') v = true; else if (v === 'false') v = false; else if (!isNaN(+v)) v = +v;
      s[k] = v;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      if (k === 'tilt' && v && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) DeviceOrientationEvent.requestPermission().catch(() => {});
      g.applySettings(); g.audio.sfx('ui', { vol: 0.5 });
    })));
    const done = () => { g.save.write(); if (o.fromPause) this.modal('pause'); else this.closeModal(); };
    box.querySelector('[data-a=done]').addEventListener('click', done);
    box.querySelector('[data-a=reset]')?.addEventListener('click', () => this.modal('confirm', { text: 'Erase ALL progress, cars and money?', yes: () => { g.save.reset(); location.reload(); } }));
    box._onBack = done;
    return box;
  }

  m_howto(o = {}) {
    const box = h(`<div class="modal help" style="max-width:640px"><h2>HOW TO PLAY</h2>
      <p><b>DRIVE</b> ${isTouch ? 'Drag on the left half to steer. Gas is automatic (change in Settings). BRAKE slows / reverses.' : '<kbd>←</kbd><kbd>→</kbd> or <kbd>A</kbd><kbd>D</kbd> steer · <kbd>↑</kbd>/<kbd>W</kbd> gas · <kbd>↓</kbd>/<kbd>S</kbd> brake &amp; reverse · Gamepad: stick, <kbd>A</kbd>/<kbd>RT</kbd> gas, <kbd>B</kbd> brake.'}</p>
      <p><b>DRIFT</b> Hold ${isTouch ? 'DRIFT' : '<kbd>SPACE</kbd>/<kbd>SHIFT</kbd> (pad <kbd>RB</kbd>)'} while turning to power-slide. You can't spin out. Hold it and sparks charge <span style="color:#1e9ad6">blue</span> → <span style="color:#e07a00">orange</span> → <span style="color:#b03ee0">purple</span>; let go for a mini-turbo. Steer into the drift to tighten it and charge faster.</p>
      <p><b>ITEMS</b> Smash the <b style="color:#8a3dff">?</b> boxes. Use with ${isTouch ? 'ITEM (hold BACK or pull the stick down to throw backwards)' : '<kbd>E</kbd>/<kbd>J</kbd>/<kbd>CTRL</kbd> (hold <kbd>↓</kbd> to throw backwards, pad <kbd>X</kbd>/<kbd>LB</kbd>)'}. Racers at the back get the wildest ones.</p>
      <p><b>TRICKS &amp; BOOSTS</b> Press drift in mid-air off a ramp for a trick boost. Hit chevron pads. Tuck in behind a rival for a slipstream. Hold gas just as the countdown hits 1 for a rocket start.</p>
      <p><b>GARAGE</b> Earn yen from races. In the shop, try parts on first: your build previews live, then BUY &amp; FIT pays for everything in the cart at once. Parts tweak your stats too.</p>
      <p><b>OTHER</b> ${isTouch ? 'Pause button top right.' : '<kbd>ESC</kbd>/<kbd>P</kbd> pause · <kbd>C</kbd> look back · <kbd>R</kbd> call the rescue drone.'}</p>
      <div class="stack"><button class="btn pink" data-nav>GOT IT</button></div></div>`);
    const done = () => { if (o.fromPause) this.modal('pause'); else this.closeModal(); };
    box.querySelector('.btn').addEventListener('click', done);
    box._onBack = done;
    return box;
  }

  m_standings(r) {
    const gp = r.gp;
    const rows = Object.entries(gp.points).sort((a, b) => b[1] - a[1]).map(([n, p], i) => `<tr class="${n === (this.game.save.d.name || 'YOU') ? 'me' : ''}"><td class="pl">${i + 1}</td><td>${esc(n)}</td><td class="pts">${p}</td></tr>`).join('');
    const box = h(`<div class="modal"><h2>STANDINGS · ${gp.round}/${gp.cup.tracks.length}</h2><div class="results" style="transform:none;box-shadow:none;border:0;padding:0"><table>${rows}</table></div><div class="stack" style="margin-top:12px"><button class="btn pink" data-nav>OK</button></div></div>`);
    box.querySelector('.btn').addEventListener('click', () => this.closeModal());
    return box;
  }

  m_confirm(o) {
    const box = h(`<div class="modal"><h2>SURE?</h2><p style="font-size:17px">${esc(o.text)}</p><div class="row-btns"><button class="btn pink" data-nav data-a="y">${esc(o.yesLabel || 'YES')}</button><button class="btn back" data-nav data-a="n">${esc(o.noLabel || 'NO')}</button></div></div>`);
    box.querySelector('[data-a=y]').addEventListener('click', () => { this.closeModal(); o.yes?.(); });
    box.querySelector('[data-a=n]').addEventListener('click', () => { this.closeModal(); o.no?.(); });
    return box;
  }
}

export { h, esc, statsFor };
