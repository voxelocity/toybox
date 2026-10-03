// Render-state snapshots of the simulation, interpolation between ticks and
// a ring-buffer replay recorder.
import { V3, Quat } from '../physics/math.js';

export function makeCarState() {
  return {
    pos: new V3(), quat: new Quat(), vel: new V3(), up: new V3(0, 0, 1),
    boosting: false, supersonic: false, demoed: false, onGround: true, handbrake: 0, speed: 0, boost: 0,
    wheels: [0, 1, 2, 3].map(() => ({ steer: 0, spin: 0, susLen: 25, rest: 26, contact: true })),
  };
}

export function captureCar(car, s) {
  s.pos.copy(car.pos); s.quat.copy(car.quat); s.vel.copy(car.vel);
  car.R.col(2, s.up);
  s.boosting = car.isBoosting; s.supersonic = car.isSupersonic; s.demoed = car.isDemoed;
  s.onGround = car.isOnGround; s.handbrake = car.handbrakeVal; s.speed = car.vel.len(); s.boost = car.boost;
  for (let i = 0; i < 4; i++) {
    const w = car.wheels[i], o = s.wheels[i];
    o.steer = w.steer; o.spin = w.spin; o.susLen = w.susLen; o.rest = w.rest; o.contact = w.contact;
  }
  return s;
}

export function lerpCar(a, b, t, out) {
  out.pos.set(a.pos.x + (b.pos.x - a.pos.x) * t, a.pos.y + (b.pos.y - a.pos.y) * t, a.pos.z + (b.pos.z - a.pos.z) * t);
  out.quat.copy(a.quat).slerp(b.quat, t);
  out.vel.copy(b.vel); out.up.copy(b.up);
  out.boosting = b.boosting; out.supersonic = b.supersonic; out.demoed = b.demoed; out.onGround = b.onGround;
  out.handbrake = b.handbrake; out.speed = b.speed; out.boost = b.boost;
  // teleports (respawn/kickoff): don't interpolate across
  if (Math.abs(b.pos.x - a.pos.x) + Math.abs(b.pos.y - a.pos.y) + Math.abs(b.pos.z - a.pos.z) > 400) { out.pos.copy(b.pos); out.quat.copy(b.quat); }
  for (let i = 0; i < 4; i++) {
    const wa = a.wheels[i], wb = b.wheels[i], o = out.wheels[i];
    o.steer = wa.steer + (wb.steer - wa.steer) * t;
    o.spin = wa.spin + (wb.spin - wa.spin) * t;
    o.susLen = wa.susLen + (wb.susLen - wa.susLen) * t;
    o.rest = wb.rest; o.contact = wb.contact;
  }
  return out;
}

export function makeBallState() { return { pos: new V3(), quat: new Quat(), vel: new V3(), visible: true }; }
export function captureBall(ball, s) { s.pos.copy(ball.pos); s.quat.copy(ball.quat); s.vel.copy(ball.vel); return s; }
export function lerpBall(a, b, t, out) {
  out.pos.set(a.pos.x + (b.pos.x - a.pos.x) * t, a.pos.y + (b.pos.y - a.pos.y) * t, a.pos.z + (b.pos.z - a.pos.z) * t);
  if (Math.abs(b.pos.x - a.pos.x) + Math.abs(b.pos.y - a.pos.y) + Math.abs(b.pos.z - a.pos.z) > 600) out.pos.copy(b.pos);
  out.quat.copy(a.quat).slerp(b.quat, t);
  out.vel.copy(b.vel);
  return out;
}

/** Records the last `seconds` of play at `hz` for goal replays. */
export class ReplayRecorder {
  constructor(seconds = 7, hz = 60) {
    this.hz = hz;
    this.cap = Math.ceil(seconds * hz);
    this.frames = [];
    this.head = 0;
    this.count = 0;
    this.acc = 0;
  }

  // Frames are reused ring slots; only snapshot() gives them away.
  reset() { this.head = 0; this.count = 0; this.acc = 0; }

  record(world, dt, events) {
    this.acc += dt;
    if (this.acc < 1 / this.hz - 1e-6) { if (events.length && this.count) this._lastFrame().events.push(...events); return; }
    this.acc = 0;
    let f = this.frames[this.head];
    if (!f || f.cars.length !== world.cars.length) {
      f = { time: 0, ball: makeBallState(), ballFrozen: false, cars: world.cars.map(() => makeCarState()), events: [] };
      this.frames[this.head] = f;
    }
    f.time = world.time;
    captureBall(world.ball, f.ball);
    f.ballFrozen = world.ball.frozen;
    for (let i = 0; i < world.cars.length; i++) captureCar(world.cars[i], f.cars[i]);
    f.events.length = 0;
    for (let i = 0; i < events.length; i++) f.events.push(events[i]);
    this.head = (this.head + 1) % this.cap;
    this.count = Math.min(this.cap, this.count + 1);
  }

  _lastFrame() { return this.frames[(this.head - 1 + this.cap) % this.cap]; }

  /**
   * Frames from oldest to newest. The recorded frames are handed over rather
   * than deep-copied (8 s of 6 cars is ~30k objects: a 10-50 ms hitch as the
   * goal replay starts) and the recorder starts over with fresh storage.
   */
  snapshot() {
    const out = [];
    for (let i = 0; i < this.count; i++) out.push(this.frames[(this.head - this.count + i + this.cap * 2) % this.cap]);
    this.frames = [];
    this.head = 0; this.count = 0; this.acc = 0;
    return out;
  }
}
