// AI drivers produce the same inputs a player would. They follow a racing
// line (inside on corners), brake by upcoming curvature, drift tight bends
// for mini-turbos, dodge hazards, overtake and use items tactically.

export class AIDriver {
  constructor(v, race, o = {}) {
    this.v = v;
    this.race = race;
    this.pace = o.pace ?? 0.95;
    this.skill = o.skill ?? 0.7;        // 0..1 line precision + drifting
    this.aggr = o.aggr ?? 0.5;
    this.lane = o.lane ?? (Math.random() - 0.5) * 0.6;
    this.itemDelay = 1 + Math.random() * 3;
    this.holdT = 0;
    this.noise = 0; this.noiseT = 0;
    this.driftHold = 0;
    this.avoid = 0;
    this.laneT = 0;
    this.recoverT = 0;
    this.recoverSteer = 0;
  }

  maxCurvature(s0, s1) {
    const path = this.race.track.path;
    let k = 0, sgn = 0;
    for (let s = s0; s < s1; s += 3) {
      const i = path.indexAt(s);
      const a = Math.abs(path.k[i]);
      if (a > k) { k = a; sgn = Math.sign(path.k[i]); }
    }
    return { k, sgn };
  }

  update(dt) {
    const v = this.v;
    const race = this.race;
    const tr = race.track;
    const path = tr.path;
    const inp = v.input;
    inp.driftPressed = false; inp.driftReleased = false;
    if (v.finished && race.state !== 'race') { inp.throttle = 0.4; }
    const spd = Math.max(0, v.speed);
    const i = path.indexAt(v.s);
    const hw = path.w[i] / 2;

    // ---- lane choice: base lane, inside of corners, avoid hazards / cars
    this.laneT -= dt;
    if (this.laneT <= 0) { this.lane += (Math.random() - 0.5) * 0.25; this.lane = Math.max(-0.55, Math.min(0.55, this.lane)); this.laneT = 3 + Math.random() * 4; }
    const look = 10 + spd * 0.55;
    const ahead = this.maxCurvature(v.s + 4, v.s + 30 + spd * 1.2);
    const kNear = path.k[path.indexAt(v.s + look * 0.8)];
    let latT = this.lane * hw;
    latT += -Math.sign(kNear) * Math.min(1, Math.abs(kNear) * 28) * hw * 0.55 * (0.5 + this.skill * 0.5);
    // hazards
    this.avoid *= Math.pow(0.1, dt);
    for (const o of race.items.objs) {
      if (o.kind !== 'oil' && o.kind !== 'daruma') continue;
      const S = tr.surface(o.x, o.z, o.hint ?? -1, {}, o.y);
      const ds = path.delta(v.s, S.s);
      if (ds > 4 && ds < 45 && Math.abs(S.lat - latT) < 4.5) this.avoid = S.lat > latT ? -6 : 6;
    }
    // other racers directly ahead -> pick a side to pass
    for (const c of race.cars) {
      if (c === v) continue;
      const ds = path.delta(v.s, c.s);
      if (ds > 2 && ds < 16 && Math.abs((c.lat ?? 0) - (v.lat ?? 0)) < 2.6 && c.speed < spd + 3) {
        this.avoid += ((c.lat ?? 0) > (v.lat ?? 0) ? -1 : 1) * 3.5 * dt * 4;
      }
    }
    latT += this.avoid;
    // hazard lanes defined by the track (e.g. level crossing gates)
    if (tr.aiLaneBias) latT += tr.aiLaneBias(v.s, latT) || 0;
    // stay on the tarmac (sidewalks have lamp posts and trees); open plazas allow more
    const eL = tr.edges.L[i], eR = tr.edges.R[i];
    const limLo = eL.kind === 'open' ? tr.limL[i] - 2.5 : hw - 1.7;
    const limHi = eR.kind === 'open' ? tr.limR[i] - 2.5 : hw - 1.7;
    latT = Math.max(-limLo, Math.min(limHi, latT));

    // ---- pure pursuit
    const p = path.point(v.s + look, latT);
    const dx = p.px - v.pos.x, dz = p.pz - v.pos.z;
    const want = Math.atan2(-dz, dx);
    let err = want - v.yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    const L = Math.hypot(dx, dz) || 1;
    const omega = (2 * Math.max(spd, 8) * Math.sin(err)) / L; // + = turn left (yaw increasing)
    this.noiseT -= dt;
    if (this.noiseT <= 0) { this.noise = (Math.random() - 0.5) * (1 - this.skill) * 0.5; this.noiseT = 0.4 + Math.random(); }

    // ---- drift decision
    const vf = Math.min(1, spd / 9) * (1 - 0.3 * Math.pow(Math.min(1, spd / v.vmax), 2));
    const gripK = (v.yawRate * vf) / Math.max(spd, 1);
    const tight = ahead.k > gripK * 0.8 && spd > 22;
    if (!v.drift.on && tight && this.skill > 0.2 && v.grounded && v.spinT <= 0 && Math.random() < dt * 8 * this.skill) {
      inp.drift = true; inp.driftPressed = true;
      inp.steer = -ahead.sgn === 0 ? 0 : ahead.sgn; // right turn (k>0) -> steer right
      this.driftHold = 0.5;
    }
    if (v.drift.on) {
      this.driftHold -= dt;
      const dir = v.drift.dir;
      const base = v.yawRate * v.driftTurn * Math.min(1, spd / 14);
      // desired yaw rate = omega; drift gives -dir * base * (0.72 + 0.55k)
      let k = (-omega / (dir * base) - 0.72) / 0.55;
      k = Math.max(-1, Math.min(1, k));
      inp.steer = k * dir;
      const straightAhead = this.maxCurvature(v.s + 2, v.s + 22).k < gripK * 0.45;
      const wrongDir = Math.sign(kNear) !== 0 && Math.sign(kNear) !== dir && Math.abs(kNear) > 0.01;
      const levelOk = v.drift.level >= Math.min(3, 1 + Math.floor(this.skill * 2.5));
      inp.drift = !((straightAhead && this.driftHold <= 0) || wrongDir || (levelOk && straightAhead));
    } else if (!inp.driftPressed) {
      inp.drift = false;
      inp.steer = Math.max(-1, Math.min(1, -omega / Math.max(0.3, v.yawRate * vf) + this.noise));
    }

    // ---- throttle / brake by curvature
    const aLat = (v.drift.on ? 34 : 24) * (0.85 + this.skill * 0.2);
    const vCorner = ahead.k > 1e-4 ? Math.sqrt(aLat / ahead.k) : 999;
    const canDrift = this.skill > 0.2;
    inp.throttle = 1; inp.brake = 0;
    if (spd > vCorner * (canDrift ? 1.35 : 1.1) + 4) { inp.throttle = 0; if (spd > vCorner * 1.55 + 8) inp.brake = 0.6; }
    // recovery: back out for a moment when wedged against something
    if (this.recoverT > 0) {
      this.recoverT -= dt;
      inp.throttle = 0; inp.brake = 1; inp.drift = false;
      inp.steer = this.recoverSteer;
    } else if (v.stuckT > 0.9 && v.respawnT <= 0) {
      this.recoverT = 0.9;
      this.recoverSteer = (v.lat ?? 0) > 0 ? 1 : -1;
    }
    if (v.wrongWayT > 1.2) { inp.steer = 1; }

    // ---- rubber band & pace
    const pl = race.player;
    let rb = this.pace;
    if (pl && race.state === 'race' && !pl.finished) {
      const gap = v.progress - pl.progress;
      if (gap > 50) rb *= 1 - Math.min(0.14, (gap - 50) / 700);
      else if (gap < -30) rb *= 1 + Math.min(0.14, (-gap - 30) / 500);
    }
    v.rubber = rb;

    // ---- items
    if (v.item && v.rolling <= 0) {
      this.itemDelay -= dt;
      if (this.itemDelay <= 0) this.useItem();
    }
  }

  useItem() {
    const v = this.v, race = this.race;
    const path = race.track.path;
    const id = v.item;
    const ahead = race.carAhead(v), behind = race.carBehind(v);
    const dA = ahead ? path.delta(v.s, ahead.s) + (ahead.lap - v.lap) * path.length : 1e9;
    const dB = behind ? path.delta(behind.s, v.s) + (v.lap - behind.lap) * path.length : 1e9;
    const straight = this.maxCurvature(v.s, v.s + 60).k < 0.012;
    let go = false, back = false;
    switch (id) {
      case 'nitro': case 'nitro3': go = straight || v.place > 4; break;
      case 'oil': go = dB < 30 || Math.random() < 0.004; back = false; break;
      case 'shuriken':
        if (dA < 55 && Math.abs((ahead.lat ?? 0) - (v.lat ?? 0)) < 3) go = true;
        else if (dB < 20) { go = true; back = true; }
        break;
      case 'missile': go = !!ahead && dA < 250; break;
      case 'daruma': if (dA < 45) go = true; else if (dB < 18) { go = true; back = true; } break;
      case 'shield': go = race.items.objs.some((o) => o.kind === 'missile' && o.target === v) || Math.random() < 0.003; break;
      case 'emp': go = race.cars.filter((c) => c !== v && c.pos.distanceTo(v.pos) < 25).length >= 2; break;
      case 'ryu': case 'glitch': go = true; break;
      default: go = true;
    }
    if (!go && Math.random() < 0.0015 * (1 + this.aggr)) go = true;
    if (go) {
      race.items.use(v, back);
      this.itemDelay = 0.8 + Math.random() * 2.5;
    }
  }
}
