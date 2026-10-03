// In-game HUD: score bug, clock, boost gauge, centre messages, event feed,
// scoreboard and replay / camera tags.
const $ = (id) => document.getElementById(id);

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
    this.last = {};
  }

  show(v) { this.el.classList.toggle('hidden', !v); if (!v) this.board.classList.add('hidden'); }

  setFreeplay(v) { this.freeplayHelp.classList.toggle('hidden', !v); }

  update(match, human, dt, cam) {
    const set = (k, v, fn) => { if (this.last[k] !== v) { this.last[k] = v; fn(v); } };
    set('s0', match.score[0], (v) => { this.score[0].textContent = v; });
    set('s1', match.score[1], (v) => { this.score[1].textContent = v; });
    set('clock', match.clockText(), (v) => { this.time.textContent = v; });
    set('ot', match.overtime, (v) => this.ot.classList.toggle('hidden', !v));
    const boost = human ? Math.round(match.world.unlimitedBoost ? 100 : human.car.boost) : 0;
    set('boost', boost, (v) => {
      this.boostNum.textContent = v;
      this.boostArc.style.strokeDashoffset = `${this.circ * (1 - v / 100) * 0.75 + this.circ * 0.25}`;
      this.boostArc.classList.toggle('low', v < 15);
    });
    set('cam', cam.ballCam, (v) => { this.camTag.textContent = v ? 'BALL CAM' : 'CAR CAM'; });
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) { this.center.className = ''; this.center.textContent = ''; this.sub.textContent = ''; }
    }
  }

  message(text, opts = {}) {
    this.center.textContent = text;
    this.center.className = 'show ' + (opts.cls || '');
    void this.center.offsetWidth; // restart animation
    this.center.classList.add('anim');
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

  showBoard(match, v) {
    this.board.classList.toggle('hidden', !v);
    if (!v) return;
    this.board.innerHTML = scoreTable(match);
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
