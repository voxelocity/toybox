// Match flow: kickoff countdown, clock (starts on the first touch), goals,
// goal replays, overtime, ending when time is up and the ball touches the
// ground, plus scoring stats (goals, assists, saves, shots, demos).
import { World } from '../physics/world.js';
import * as K from '../physics/constants.js';
import { Bot, BallPrediction, BOT_NAMES } from './ai.js';
import { ReplayRecorder } from './snapshot.js';

export const POINTS = { goal: 100, assist: 50, save: 50, shot: 20, demo: 25, touch: 2 };

function newStats() { return { score: 0, goals: 0, assists: 0, saves: 0, shots: 0, demos: 0, touches: 0 }; }

export class Match {
  /**
   * opts: { mode: 1|2|3, minutes (0 = unlimited), difficulty, humanTeam (-1 none),
   *         humanName, freeplay, attract, seed, playerStyles }
   */
  constructor(opts) {
    this.opts = opts;
    this.world = new World({ seed: opts.seed || ((Math.random() * 1e9) | 0) });
    this.players = [];
    this.prediction = new BallPrediction();
    this.replay = new ReplayRecorder(8, 60);
    this.score = [0, 0];
    this.minutes = opts.minutes ?? 5;
    this.timeLeft = this.minutes > 0 ? this.minutes * 60 : Infinity;
    this.overtime = false;
    this.otTime = 0;
    this.clockRunning = false;
    this.zeroReached = false;
    this.state = 'init';
    this.events = [];
    this.kickoffActive = true;
    this.cachedThreat = null;
    this.predTimer = 0;
    this.goalTimer = 0;
    this.lastGoal = null;
    this.winner = -1;
    this.freeplay = !!opts.freeplay;
    this.attract = !!opts.attract;
    this.world.unlimitedBoost = !!opts.unlimitedBoost;

    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    let ni = 0;
    const perTeam = this.freeplay ? 0 : opts.mode || 3;
    if (opts.humanTeam >= 0) this.addPlayer(opts.humanTeam, opts.humanName || 'Player', null);
    for (const team of [0, 1]) {
      const have = this.players.filter((p) => p.team === team).length;
      for (let i = have; i < perTeam; i++) this.addPlayer(team, names[ni++ % names.length], opts.difficulty || 'pro');
    }
    this.human = this.players.find((p) => p.human) || null;
    if (this.freeplay) {
      this.world.goalsEnabled = true;
      this.state = 'play';
      this.world.setupKickoff();
      if (this.human) this.human.car.reset(0, -2500, K.CAR_SPAWN_REST_Z, Math.PI / 2);
      this.clockRunning = false;
      this.kickoffActive = false;
    } else this.startKickoff();
  }

  addPlayer(team, name, difficulty) {
    const car = this.world.addCar(team, name);
    const p = { car, name, team, human: !difficulty, bot: difficulty ? new Bot(car, difficulty, this.players.length + 1) : null, stats: newStats(), style: null };
    this.players.push(p);
    return p;
  }

  emit(e) { this.events.push(e); }

  startKickoff() {
    const w = this.world;
    w.setupKickoff(true);
    w.ball.frozen = true;
    w.carsFrozen = true;
    this.state = 'countdown';
    this.countdown = this.attract ? 1.2 : 3.0;
    this.lastCount = 4;
    this.kickoffActive = true;
    this.clockRunning = false;
    this.replay.reset();
    for (const p of this.players) if (p.bot) p.bot.resetKickoff();
    // kicker per team: closest to ball, left side breaks ties
    this.kickers = [0, 1].map((team) => {
      let best = null, bd = 1e9;
      for (const p of this.players) if (p.team === team) {
        const d = Math.hypot(p.car.pos.x, p.car.pos.y) + (p.car.pos.x * (team === 0 ? 1 : -1) > 0 ? 1 : 0);
        if (d < bd) { bd = d; best = p.car; }
      }
      return best;
    });
    this.emit({ type: 'kickoff' });
  }

  get playing() { return this.state === 'play' || this.state === 'goal'; }

  /** One 120 Hz tick. Human controls must already be set on the car. */
  tick(dt) {
    const w = this.world;
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount && n > 0 && n <= 3) { this.lastCount = n; this.emit({ type: 'count', n }); }
      if (this.countdown <= 0) {
        this.state = 'play';
        w.carsFrozen = false;
        w.ball.frozen = false;
        this.emit({ type: 'go' });
      }
    }
    if (this.state === 'replay' || this.state === 'ended' || this.state === 'init') return;

    // prediction for bots + shot/save detection
    this.predTimer -= dt;
    if (this.predTimer <= 0) {
      this.predTimer = 1 / 30;
      this.prediction.update(w);
      this.cachedThreat = this.prediction.goalThreat();
    }
    const ctx = { world: w, prediction: this.prediction, kickoff: this.kickoffActive && this.state !== 'goal', kicker: null, teammates: null };
    for (const p of this.players) {
      if (!p.bot) continue;
      ctx.teammates = this.players.filter((q) => q.team === p.team).map((q) => q.car);
      ctx.kicker = this.kickers ? this.kickers[p.team] : null;
      if (this.state === 'countdown') { Object.assign(p.car.controls, { throttle: 0, boost: false, jump: false }); continue; }
      p.bot.think(ctx, dt);
    }

    const ev = w.step(dt);
    for (const e of ev) this.handleEvent(e);
    if (!this.attract && this.state !== 'countdown') this.replay.record(w, dt, ev);

    // clock
    if (this.state === 'play' && this.clockRunning && !this.freeplay) {
      if (this.overtime) this.otTime += dt;
      else if (this.timeLeft !== Infinity) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          if (!this.zeroReached) { this.zeroReached = true; this.emit({ type: 'zero' }); }
        }
      }
    }
    if (this.zeroReached && this.state === 'play' && !this.overtime) {
      const onGround = w.ball.pos.z < K.BALL_RADIUS + 8 || ev.some((e) => e.type === 'ballBounce' && e.normal.z > 0.7);
      if (onGround) this.endOrOvertime();
    }

    if (this.state === 'goal') {
      this.goalTimer -= dt;
      if (this.goalTimer <= 0) {
        if (this.attract || this.freeplay) this.afterReplay();
        else { this.state = 'replay'; this.emit({ type: 'replay', frames: this.replay.snapshot(), goal: this.lastGoal }); }
      }
    }
  }

  handleEvent(e) {
    const w = this.world;
    this.emit(e);
    if (e.type === 'ballHit') {
      const p = this.playerOf(e.car);
      if (this.kickoffActive) { this.kickoffActive = false; }
      if (!this.clockRunning) this.clockRunning = true;
      if (!p || this.state !== 'play') return;
      p.stats.touches++;
      const before = this.cachedThreat;
      this.prediction.update(w);
      const after = this.prediction.goalThreat();
      this.cachedThreat = after;
      if (after && after.team !== p.team && !(before && before.team !== p.team)) this.award(p, 'shot');
      if (before && before.team === p.team && (!after || after.team !== p.team)) this.award(p, 'save');
    } else if (e.type === 'demo') {
      const p = this.playerOf(e.attacker);
      if (p && this.state === 'play') this.award(p, 'demo', { victim: this.playerOf(e.victim) });
    } else if (e.type === 'goal' && this.state === 'play') {
      this.onGoal(e);
    }
  }

  playerOf(car) { return this.players.find((p) => p.car === car) || null; }

  award(p, kind, extra = {}) {
    if (kind === 'goal') p.stats.goals++;
    else if (kind === 'assist') p.stats.assists++;
    else if (kind === 'save') p.stats.saves++;
    else if (kind === 'shot') p.stats.shots++;
    else if (kind === 'demo') p.stats.demos++;
    p.stats.score += POINTS[kind] || 0;
    this.emit({ type: 'stat', player: p, kind, ...extra });
  }

  onGoal(e) {
    const w = this.world;
    const team = e.team;
    this.score[team]++;
    // scorer: latest toucher on the scoring team, assist: teammate's touch before that
    const hist = w.touchHistory.slice().reverse();
    let scorer = null, assist = null;
    for (const h of hist) { const p = this.playerOf(h.car); if (p && p.team === team) { scorer = p; break; } }
    if (scorer) {
      const idx = hist.findIndex((h) => h.car === scorer.car);
      for (let i = idx + 1; i < hist.length; i++) {
        const p = this.playerOf(hist[i].car);
        if (w.time - hist[i].time > 6) break;
        if (p && p.team === team && p !== scorer) { assist = p; break; }
        if (p && p.team !== team) break;
      }
      this.award(scorer, 'goal');
      if (!scorer.stats.shotsCounted) { /* goals always count as shots too */ }
      if (assist) this.award(assist, 'assist');
    }
    this.lastGoal = { team, scorer, assist, speed: e.speed, pos: e.ball.clone(), time: w.time, ownGoal: !scorer };
    // explosion knocks nearby cars away
    for (const c of w.cars) {
      if (c.isDemoed) continue;
      const dx = c.pos.x - e.ball.x, dy = c.pos.y - e.ball.y, dz = c.pos.z - e.ball.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 1600) {
        const k = (1 - d / 1600) * 2400 / Math.max(1, d);
        c.vel.x += dx * k; c.vel.y += dy * k; c.vel.z += Math.abs(dz) * k + (1 - d / 1600) * 600;
        c.angVel.x += (Math.random() - 0.5) * 6; c.angVel.y += (Math.random() - 0.5) * 6;
        c.clampVelocities();
      }
    }
    w.ball.frozen = true;
    w.ball.vel.set(0, 0, 0);
    this.state = 'goal';
    this.goalTimer = this.attract ? 2.2 : (this.freeplay ? 1.6 : 2.6);
    this.clockRunning = false;
    this.emit({ type: 'goalScored', ...this.lastGoal });
  }

  /** Called when the replay finishes (or is skipped). */
  afterReplay() {
    if (this.freeplay) {
      this.world.ball.reset(0, 0, K.BALL_REST_Z + 250);
      this.world.ball.frozen = false;
      this.state = 'play';
      return;
    }
    const ended = this.overtime || (this.zeroReached && this.timeLeft <= 0);
    if (ended && !this.attract) { this.finish(); return; }
    this.startKickoff();
  }

  endOrOvertime() {
    if (this.score[0] === this.score[1]) {
      this.overtime = true;
      this.otTime = 0;
      this.emit({ type: 'overtime' });
      this.startKickoff();
    } else this.finish();
  }

  finish() {
    this.state = 'ended';
    this.winner = this.score[0] > this.score[1] ? 0 : 1;
    const winners = this.players.filter((p) => p.team === this.winner);
    let mvp = winners[0] || null;
    for (const p of winners) if (p.stats.score > mvp.stats.score) mvp = p;
    this.mvp = mvp;
    this.world.carsFrozen = false;
    this.emit({ type: 'matchEnd', winner: this.winner, mvp });
  }

  clockText() {
    if (this.freeplay) return '∞';
    if (this.overtime) { const t = Math.floor(this.otTime); return `+${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
    if (this.timeLeft === Infinity) return '∞';
    const t = Math.ceil(this.timeLeft);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }
}
