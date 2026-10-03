// The simulation world: cars, ball, boost pads, goals. Fixed 120 Hz ticks.
import { V3, rng } from './math.js';
import * as K from './constants.js';
import { Car } from './car.js';
import { Ball } from './ball.js';
import { getCollisionMesh } from './arena.js';
import { collideCarWorld, collideCarBall, collideCarCar } from './collisions.js';

export class World {
  constructor(opts = {}) {
    this.mesh = opts.mesh || getCollisionMesh();
    this.cars = [];
    this.ball = new Ball();
    this.tick = 0;
    this.time = 0;
    this.events = [];
    this.unlimitedBoost = false;
    this.carsFrozen = false;
    this.goalsEnabled = true;
    this.random = rng(opts.seed || 1234);
    this.pads = K.BOOST_PADS.map(([x, y, big], i) => ({
      id: i, x, y, z: big ? 73 : 70, big: !!big, active: true, timer: 0,
    }));
    this.lastTouch = null;   // car
    this.touchHistory = [];  // recent touches { car, time }
    this._hit = { car: null, point: new V3(), normal: new V3(), dv: 0, impulse: 0, newTouch: false };
  }

  addCar(team, name = '') {
    const car = new Car(this.cars.length, team);
    car.name = name;
    this.cars.push(car);
    return car;
  }

  removeCar(car) {
    this.cars = this.cars.filter((c) => c !== car);
    this.cars.forEach((c, i) => { c.id = i; });
  }

  resetPads() { for (const p of this.pads) { p.active = true; p.timer = 0; } }

  /** Place cars on kickoff spots and the ball at centre. Returns spot indices. */
  setupKickoff(seedRandom = true) {
    const ball = this.ball;
    ball.reset(0, 0, K.BALL_REST_Z);
    this.lastTouch = null;
    this.touchHistory.length = 0;
    const blue = this.cars.filter((c) => c.team === 0), orange = this.cars.filter((c) => c.team === 1);
    const n = Math.max(blue.length, orange.length);
    // choose kickoff spots like the real thing: random distinct spots,
    // mirrored for the other team.
    const order = [0, 1, 2, 3, 4];
    if (seedRandom) for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]];
    }
    // prefer diagonal / offset / centre combos that exist in standard modes
    let spots;
    if (n === 1) spots = [order[0]];
    else if (n === 2) spots = this.random() < 0.5 ? [0, 1] : (this.random() < 0.5 ? [2, 3] : [0, 4]);
    else spots = order.slice(0, n);
    const place = (cars, team) => {
      cars.forEach((car, i) => {
        const s = K.KICKOFF_SPAWNS[spots[i % spots.length]] || K.KICKOFF_SPAWNS[i % 5];
        const sx = team === 0 ? 1 : -1;
        car.reset(s.x * sx, s.y * sx, K.CAR_SPAWN_REST_Z, team === 0 ? s.yaw : s.yaw + Math.PI);
        car.kickoffSpot = spots[i % spots.length];
      });
    };
    place(blue, 0); place(orange, 1);
    this.resetPads();
    return spots;
  }

  respawn(car) {
    const spots = K.RESPAWN_SPOTS;
    const s = spots[Math.floor(this.random() * spots.length)];
    const sx = car.team === 0 ? 1 : -1;
    car.reset(s.x * sx, s.y * sx, K.CAR_RESPAWN_Z, car.team === 0 ? s.yaw : s.yaw + Math.PI);
    this.events.push({ type: 'respawn', car });
  }

  step(dt = K.DT) {
    const ev = this.events;
    ev.length = 0;
    const ball = this.ball;

    for (const car of this.cars) {
      if (car.isDemoed) {
        car.respawnTimer -= dt;
        if (car.respawnTimer <= 0) this.respawn(car);
        continue;
      }
      if (this.carsFrozen) { car.events.length = 0; continue; }
      car.preStep(this, dt);
      for (const e of car.events) ev.push({ type: e, car });
    }
    ball.preStep(dt);

    for (const car of this.cars) if (!this.carsFrozen) car.integrate(dt);
    ball.integrate(dt);

    // collisions
    const impact = ball.collideWorld(this.mesh);
    if (impact > 120) ev.push({ type: 'ballBounce', speed: impact, point: ball.pos.clone().addScaled(ball.lastNormal, -ball.radius), normal: ball.lastNormal.clone() });
    for (const car of this.cars) {
      if (this.carsFrozen || car.isDemoed) continue;
      const hit = collideCarWorld(car, this.mesh);
      if (hit > 250) ev.push({ type: 'carWorld', car, speed: hit });
    }
    for (const car of this.cars) {
      if (this.carsFrozen) break;
      const h = this._hit;
      if (collideCarBall(car, ball, this.tick, h)) {
        if (h.newTouch) {
          this.lastTouch = car;
          this.touchHistory.push({ car, time: this.time });
          if (this.touchHistory.length > 8) this.touchHistory.shift();
          ev.push({ type: 'ballHit', car, point: h.point.clone(), normal: h.normal.clone(), dv: h.dv, speed: ball.vel.len() });
        }
      }
    }
    if (!this.carsFrozen) {
      for (let i = 0; i < this.cars.length; i++) for (let j = i + 1; j < this.cars.length; j++) {
        collideCarCar(this.cars[i], this.cars[j], ev);
      }
    }

    // boost pads
    for (const p of this.pads) {
      if (!p.active) { p.timer -= dt; if (p.timer <= 0) { p.active = true; ev.push({ type: 'padRespawn', pad: p }); } continue; }
      const rad = p.big ? K.BOOST_PAD.BIG_RADIUS : K.BOOST_PAD.SMALL_RADIUS;
      for (const car of this.cars) {
        if (car.isDemoed || car.boost >= K.BOOST_MAX) continue;
        const dx = car.pos.x - p.x, dy = car.pos.y - p.y;
        if (dx * dx + dy * dy < rad * rad && car.pos.z - p.z < K.BOOST_PAD.HEIGHT) {
          car.boost = Math.min(K.BOOST_MAX, car.boost + (p.big ? K.BOOST_PAD.BIG_AMOUNT : K.BOOST_PAD.SMALL_AMOUNT));
          p.active = false;
          p.timer = p.big ? K.BOOST_PAD.BIG_COOLDOWN : K.BOOST_PAD.SMALL_COOLDOWN;
          ev.push({ type: 'pad', pad: p, car });
          break;
        }
      }
    }

    // goals
    if (this.goalsEnabled && !ball.frozen) {
      const lim = K.GOAL_SCORE_Y + ball.radius;
      if (ball.pos.y > lim) ev.push({ type: 'goal', team: 0, ball: ball.pos.clone(), speed: ball.vel.len() });
      else if (ball.pos.y < -lim) ev.push({ type: 'goal', team: 1, ball: ball.pos.clone(), speed: ball.vel.len() });
    }

    this.tick++;
    this.time += dt;
    return ev;
  }
}
