// Garage & shop: configure first (live 3D preview), then pay for the whole
// cart at once. Owned parts are free to swap back to.
import {
  BODIES, BODY_ORDER, CATEGORIES, FINISHES, PAINT_COLORS, ACCENT_COLORS, RIM_COLORS, RECOLOR_PRICE,
  STAT_KEYS, STAT_LABELS, partsFor, findPart, statsFor, defaultConfig,
} from '../cars/catalog.js';
import { money } from '../core/data.js';
import { UI_ICONS } from './icons.js';

const h = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };

export class Garage {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.save = game.save;
    this.body = this.save.d.current;
    this.cat = 'front';
    game.showroom.frame('garage');
    this.el = h(`<div class="garage"><div class="topbar"><button class="btn back small" data-nav data-a="back">◀ BACK</button><h1>GARAGE<small>ガレージ</small></h1><div class="spacer"></div>${ui.moneyHTML()}</div>
      <div class="g-body"><div class="g-left"><div class="g-cars"></div><div class="g-tabs"></div><div class="g-list"></div></div>
      <div class="g-right"><div class="g-hint">Drag the car to spin it</div><div class="g-stats"></div><div class="g-cart"></div></div></div></div>`);
    this.el.querySelector('[data-a=back]').addEventListener('click', () => this.leave());
    this.selectBody(this.body);
  }

  saved(body = this.body) { return { ...defaultConfig(body), ...this.save.d.cars[body].cfg, body }; }

  selectBody(body) {
    if (this.pending && this.cartTotal().items.length && body !== this.body) {
      this.ui.modal('confirm', { text: 'Discard the unpaid changes in your cart?', yesLabel: 'DISCARD', noLabel: 'KEEP', yes: () => { this.pending = null; this.selectBody(body); } });
      return;
    }
    this.body = body;
    this.pending = this.saved(body);
    this.game.showroom.setCar(body, this.pending);
    this.render();
  }

  owned(body = this.body) { return this.save.d.cars[body].owned; }

  // ------------------------------------------------------------ cart
  cartTotal() {
    const s = this.saved(), p = this.pending, b = this.body;
    const items = [];
    if (!this.owned(b)) items.push({ label: `${BODIES[b].name} (car)`, price: BODIES[b].price, key: 'car' });
    for (const cat of ['front', 'rear', 'side', 'aero', 'wheels', 'height', 'camber', 'livery']) {
      if (p[cat] === s[cat]) continue;
      const part = findPart(cat, b, p[cat]);
      if (!part || part.price === 0 || this.save.owns(b, cat, p[cat])) continue;
      items.push({ label: `${CATEGORIES.find((c) => c.id === cat).name}: ${part.name}`, price: part.price, key: cat });
    }
    if (p.paint.toLowerCase() !== s.paint.toLowerCase() || p.finish !== s.finish) {
      const f = FINISHES.find((x) => x.id === p.finish);
      items.push({ label: `Respray (${f.name})`, price: f.price, key: 'paint' });
    }
    if (p.livery !== 'none' && p.liveryColor.toLowerCase() !== s.liveryColor.toLowerCase() && (p.livery === s.livery || true)) items.push({ label: 'Vinyl colour', price: RECOLOR_PRICE.livery, key: 'liveryColor' });
    if (p.rimColor.toLowerCase() !== s.rimColor.toLowerCase()) items.push({ label: 'Rim powder-coat', price: RECOLOR_PRICE.rim, key: 'rimColor' });
    return { items, total: items.reduce((a, i) => a + i.price, 0) };
  }

  buy() {
    const { items, total } = this.cartTotal();
    const d = this.save.d;
    if (!items.length) {
      if (this.body !== d.current && this.owned()) { d.current = this.body; this.save.write(); this.ui.toast(`${BODIES[this.body].name} is now your ride`); this.game.audio.sfx('ui'); this.render(); }
      return;
    }
    if (d.money < total) { this.game.audio.sfx('deny'); this.ui.toast(`Need ${money(total - d.money)} more — go win some races!`); return; }
    d.money -= total;
    const b = this.body;
    const car = d.cars[b];
    car.owned = true;
    for (const cat of ['front', 'rear', 'side', 'aero', 'wheels', 'height', 'camber', 'livery']) this.save.grant(b, cat, this.pending[cat]);
    const { body, ...cfg } = this.pending;
    car.cfg = { ...cfg };
    d.current = b;
    this.save.write();
    this.game.audio.sfx('buy');
    this.ui.toast(items.some((i) => i.key === 'car') ? `${BODIES[b].name} is yours!` : 'INSTALLED!');
    this.ui.bumpMoney();
    this.render();
    void body;
  }

  revert() { this.pending = this.saved(); this.game.showroom.preview(this.pending); this.render(); this.game.audio.sfx('uiBack'); }

  leave() {
    if (this.cartTotal().items.length) {
      this.ui.modal('confirm', { text: 'You have unpaid parts in the cart. Leave and discard them?', yesLabel: 'DISCARD', noLabel: 'STAY', yes: () => { this.pending = null; this.game.showroom.setCar(this.save.d.current); this.ui.show('main'); } });
      return;
    }
    this.game.showroom.setCar(this.save.d.current);
    this.ui.show('main');
  }

  tab(d) {
    const i = CATEGORIES.findIndex((c) => c.id === this.cat);
    this.cat = CATEGORIES[(i + d + CATEGORIES.length) % CATEGORIES.length].id;
    this.render();
  }

  set(key, val) {
    this.pending = { ...this.pending, [key]: val };
    this.game.showroom.preview(this.pending);
    this.game.audio.sfx('ui', { vol: 0.4 });
    this.render(false);
  }

  // ------------------------------------------------------------ render
  render(full = true) {
    const b = this.body;
    const els = { cars: this.el.querySelector('.g-cars'), tabs: this.el.querySelector('.g-tabs'), list: this.el.querySelector('.g-list'), stats: this.el.querySelector('.g-stats'), cart: this.el.querySelector('.g-cart') };
    // cars
    els.cars.innerHTML = '';
    for (const id of BODY_ORDER) {
      const own = this.owned(id);
      const btn = h(`<button class="${id === b ? 'on' : ''} ${own ? '' : 'locked'}" data-nav><span class="jp">${BODIES[id].jp}</span>${BODIES[id].name}${own ? (id === this.save.d.current ? ' ★' : '') : '<br><small>' + money(BODIES[id].price) + '</small>'}</button>`);
      btn.addEventListener('click', () => this.selectBody(id));
      els.cars.appendChild(btn);
    }
    // tabs
    const cart = this.cartTotal();
    els.tabs.innerHTML = '';
    for (const c of CATEGORIES) {
      const dirty = cart.items.some((i) => i.key === c.id || (c.id === 'paint' && i.key === 'paint') || (c.id === 'livery' && i.key === 'liveryColor') || (c.id === 'wheels' && i.key === 'rimColor'));
      const t = h(`<button class="${c.id === this.cat ? 'on' : ''} ${dirty ? 'dirty' : ''}" data-nav>${c.name}</button>`);
      t.addEventListener('click', () => { this.cat = c.id; this.render(); });
      els.tabs.appendChild(t);
    }
    // list
    const keepScroll = els.list.scrollTop;
    els.list.innerHTML = '';
    const p = this.pending, s = this.saved();
    const base = statsFor(p);
    const statDelta = (patch) => {
      const n = statsFor({ ...p, ...patch });
      return STAT_KEYS.map((k) => { const dd = Math.round((n[k] - base[k]) * 10) / 10; return dd ? `<span class="${dd > 0 ? (k === 'wgt' ? 'up' : 'up') : 'dn'}">${STAT_LABELS[k].split(' ')[0].toUpperCase()} ${dd > 0 ? '+' : ''}${dd}</span>` : ''; }).join('');
    };
    const priceTag = (cat, part) => {
      if (s[cat] === part.id) return '<span class="pp owned">FITTED</span>';
      if (part.price === 0 || this.save.owns(b, cat, part.id)) return '<span class="pp owned">OWNED</span>';
      return `<span class="pp">${money(part.price)}</span>`;
    };
    const cat = this.cat;
    if (['front', 'rear', 'side', 'aero', 'wheels', 'height', 'camber', 'livery'].includes(cat)) {
      for (const part of partsFor(cat, b)) {
        const row = h(`<div class="part ${p[cat] === part.id ? 'sel' : ''}" data-nav><span class="pn">${part.name}</span>${priceTag(cat, part)}<span class="pd">${part.desc}</span><span class="ps">${p[cat] === part.id ? '' : statDelta({ [cat]: part.id })}</span></div>`);
        row.addEventListener('click', () => this.set(cat, part.id));
        els.list.appendChild(row);
      }
    }
    const swatchGrid = (colors, cur, key, label, price) => {
      els.list.appendChild(h(`<div class="sublabel">${label}${price ? ` <span style="color:var(--yellow);font-size:16px">${price}</span>` : ''}</div>`));
      const grid = h('<div class="swatches"></div>');
      for (const c of colors) {
        const sw = h(`<div class="sw ${cur.toLowerCase() === c.toLowerCase() ? 'sel' : ''}" style="background:${c}" data-nav title="${c}"></div>`);
        sw.addEventListener('click', () => this.set(key, c));
        grid.appendChild(sw);
      }
      els.list.appendChild(grid);
    };
    if (cat === 'wheels') swatchGrid(RIM_COLORS, p.rimColor, 'rimColor', 'RIM COLOUR', money(RECOLOR_PRICE.rim));
    if (cat === 'livery' && p.livery !== 'none') swatchGrid(ACCENT_COLORS.concat(PAINT_COLORS.slice(0, 12)).filter((v, i, a) => a.indexOf(v) === i), p.liveryColor, 'liveryColor', 'VINYL & ACCENT COLOUR', money(RECOLOR_PRICE.livery));
    if (cat === 'paint') {
      els.list.appendChild(h('<div class="sublabel">FINISH</div>'));
      for (const f of FINISHES) {
        const row = h(`<div class="part ${p.finish === f.id ? 'sel' : ''}" data-nav><span class="pn">${f.name}</span><span class="pp">${s.finish === f.id && s.paint === p.paint ? '<span class="owned" style="color:inherit">ON CAR</span>' : 'respray ' + money(f.price)}</span></div>`);
        row.addEventListener('click', () => this.set('finish', f.id));
        els.list.appendChild(row);
      }
      swatchGrid(PAINT_COLORS, p.paint, 'paint', 'COLOUR');
    }
    if (full) els.list.scrollTop = 0; else els.list.scrollTop = keepScroll;
    // stats
    const cur = statsFor(s);
    els.stats.innerHTML = `<h3>${BODIES[b].name} <span style="font-family:var(--jp);color:var(--pink);font-size:.8em">${BODIES[b].jp}</span></h3>` + STAT_KEYS.map((k) => {
      const a = cur[k], n = base[k];
      const lo = Math.min(a, n), hi = Math.max(a, n);
      return `<div class="statrow"><span>${STAT_LABELS[k]}</span><div class="bar"><i style="width:${lo * 10}%"></i>${hi > lo ? `<i class="${n > a ? 'delta-up' : 'delta-down'}" style="left:${lo * 10}%;width:${(hi - lo) * 10}%"></i>` : ''}</div></div>`;
    }).join('');
    // cart
    const { items, total } = cart;
    const short = total > this.save.d.money;
    const isCur = b === this.save.d.current;
    els.cart.innerHTML = `<h3>${items.length ? 'CART' : 'NO CHANGES'}</h3>${items.length ? items.map((i) => `<div class="line"><span>${i.label}</span><b>${money(i.price)}</b></div>`).join('') : `<div class="empty">${this.owned() ? 'Pick parts on the left to try them on. Nothing is charged until you buy.' : 'Configure this car, then buy it with its parts in one go.'}</div>`}
      ${items.length ? `<div class="total ${short ? 'short' : ''}"><span>TOTAL</span><b>${money(total)}</b></div>` : ''}
      <div class="row-btns">${items.length ? `<button class="btn pink small" data-nav data-a="buy">${short ? 'NOT ENOUGH ¥' : 'BUY & FIT'}</button><button class="btn small back" data-nav data-a="revert">REVERT</button>` : (!isCur && this.owned() ? '<button class="btn cyan small" data-nav data-a="buy">DRIVE THIS CAR</button>' : (isCur ? '<span style="font-family:var(--comic);letter-spacing:1px;color:var(--green)">★ YOUR CURRENT RIDE</span>' : ''))}</div>`;
    els.cart.querySelector('[data-a=buy]')?.addEventListener('click', () => this.buy());
    els.cart.querySelector('[data-a=revert]')?.addEventListener('click', () => this.revert());
    this.ui._focus();
    void UI_ICONS;
  }

  destroy() {}
}
