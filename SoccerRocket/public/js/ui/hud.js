// In-game HUD: score bug, clock, boost gauge, centre messages, event feed,
// scoreboard and replay / camera tags.
const $ = (id) => document.getElementById(id);
// centre-message pop-in; animate() restarts it without forcing a layout
const POP = [{ transform: 'translate(-50%, -50%) scale(2.2)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }];
const POP_TIMING = { duration: 450, easing: 'cubic-bezier(.2, 1.6, .4, 1)' };

export class Hud {
  constructor() {
    this.el = $('hud');
    this.score = [$('score0'), $('score1')];
    this.time = $('time');
    this.ot = $('ot');
    this.boostArc = $('boostarc');
    this.boostNum = $('boostnum');
    this.center = $('center-msg');
    this.sub = $('sub-msg');
    this.feed = $('feed');
    this.camTag = $('camtag');
    this.fps = $('fps');
    this.replayTag = $('replay-tag');
    this.board = $('scoreboard');
    this.freeplayHelp = $('freeplay-help');
    this.circ = 2 * Math.PI * 50;
    this.boostArc.style.strokeDasharray = `${this.circ}`;
    this.msgTimer = 0;
    this.last = { s0: null, s1: null, clock: null, ot: null, boost: null, cam: null };
    this.boardShown = false;
    this.boardHtml = '';
  }

  show(v) { this.el.classList.toggle('hidden', !v); if (!v) { this.board.classList.add('hidden'); this.boardShown = false; } }

  setFreeplay(v) { this.freeplayHelp.classList.toggle('hidden', !v); }

  /** Per frame; touches the DOM only when a value changed. */
  update(match, human, dt, cam) {
    const L = this.last;
    if (L.s0 !== match.score[0]) { L.s0 = match.score[0]; this.score[0].textContent = L.s0; }
    if (L.s1 !== match.score[1]) { L.s1 = match.score[1]; this.score[1].textContent = L.s1; }
    const clock = match.clockText();
    if (L.clock !== clock) { L.clock = clock; this.time.textContent = clock; }
    if (L.ot !== match.overtime) { L.ot = match.overtime; this.ot.classList.toggle('hidden', !L.ot); }
    const boost = human ? Math.round(match.world.unlimitedBoost ? 100 : human.car.boost) : 0;
    if (L.boost !== boost) {
      L.boost = boost;
      this.boostNum.textContent = boost;
      this.boostArc.style.strokeDashoffset = `${this.circ * (1 - boost / 100) * 0.75 + this.circ * 0.25}`;
      this.boostArc.classList.toggle('low', boost < 15);
    }
    if (L.cam !== cam.ballCam) { L.cam = cam.ballCam; this.camTag.textContent = L.cam ? 'BALL CAM' : 'CAR CAM'; }
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) { this.center.className = ''; this.center.textContent = ''; this.sub.textContent = ''; }
    }
  }

  message(text, opts = {}) {
    this.center.textContent = text;
    this.center.className = 'show ' + (opts.cls || '');
    if (this.center.animate) this.center.animate(POP, POP_TIMING);
    this.sub.innerHTML = opts.sub || '';
    this.msgTimer = opts.time || 1.2;
  }

  feedItem(html, team) {
    const d = document.createElement('div');
    d.className = 'fitem ' + (team === 0 ? 'blue' : team === 1 ? 'orange' : '');
    d.innerHTML = html;
    this.feed.prepend(d);
    while (this.feed.children.length > 5) this.feed.lastChild.remove();
    setTimeout(() => d.classList.add('out'), 3500);
    setTimeout(() => d.remove(), 4200);
  }

  setFps(v) { this.fps.classList.remove('hidden'); this.fps.textContent = `${v.toFixed(0)} FPS`; }
  hideFps() { this.fps.classList.add('hidden'); }

  setReplay(v) { this.replayTag.classList.toggle('hidden', !v); this.camTag.classList.toggle('hidden', v); }

  /** Called every frame; rebuilds the table only when its contents change. */
  showBoard(match, v) {
    if (v !== this.boardShown) { this.boardShown = v; this.board.classList.toggle('hidden', !v); }
    if (!v) return;
    const html = scoreTable(match);
    if (html !== this.boardHtml) { this.boardHtml = html; this.board.innerHTML = html; }
  }
}

export function scoreTable(match) {
  const rows = (team) => match.players.filter((p) => p.team === team).sort((a, b) => b.stats.score - a.stats.score).map((p) => `
    <tr class="${p.human ? 'me' : ''}"><td class="nm">${esc(p.name)}${p.human ? '' : ' <span class="bot">BOT</span>'}</td>
    <td>${p.stats.score}</td><td>${p.stats.goals}</td><td>${p.stats.assists}</td><td>${p.stats.saves}</td><td>${p.stats.shots}</td><td>${p.stats.demos}</td></tr>`).join('');
  const head = '<tr><th></th><th>SCORE</th><th>GOALS</th><th>ASSISTS</th><th>SAVES</th><th>SHOTS</th><th>DEMOS</th></tr>';
  return `<div class="sb-team blue"><div class="sb-title">BLUE <b>${match.score[0]}</b></div><table>${head}${rows(0)}</table></div>
    <div class="sb-team orange"><div class="sb-title">ORANGE <b>${match.score[1]}</b></div><table>${head}${rows(1)}</table></div>`;
}

export function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
