// Generates tools/rocketsim/scenarios/*.json (the oracle scenario suite).
//   node tools/rocketsim/make-scenarios.mjs
// Edit this file to add scenarios, then re-run it. Conventions: README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'scenarios');
const PI = Math.PI;
const NORTH = PI / 2; // facing +y

const scenarios = [];
const add = (s) => scenarios.push(s);

// Metric helpers (see compare.mjs METRICS for definitions).
const at = (obj, field, tick, tol, label) => ({ fn: 'at', obj, field, tick, tol, label: label || `${obj}.${field}@${tick}` });
const max = (obj, field, from, to, tol, label) => ({ fn: 'max', obj, field, from, to, tol, label: label || `max ${obj}.${field}[${from ?? 0}..${to ?? 'end'}]` });
const min = (obj, field, from, to, tol, label) => ({ fn: 'min', obj, field, from, to, tol, label: label || `min ${obj}.${field}[${from ?? 0}..${to ?? 'end'}]` });
const argmax = (obj, field, from, to, tol, label) => ({ fn: 'argmax', obj, field, from, to, tol, label: label || `tick of max ${obj}.${field}` });
const when = (obj, field, op, value, from, tol, label) => ({ fn: 'when', obj, field, op, value, from, tol, label: label || `tick ${obj}.${field}${op}${value}` });
const avg = (obj, field, from, to, tol, label) => ({ fn: 'avg', obj, field, from, to, tol, label: label || `avg ${obj}.${field}[${from}..${to}]` });
const yawRate = (car, from, to, tol) => ({ fn: 'yawRate', obj: car, from, to, tol, label: `${car} yaw rate [${from}..${to}] (rad/s)` });
const turnRadius = (car, from, to, tol) => ({ fn: 'turnRadius', obj: car, from, to, tol, label: `${car} turn radius [${from}..${to}] (uu)` });
const apexes = (n, tol) => ({ fn: 'ballApexes', n, tol, label: `ball bounce apex z x${n}` });
const evTick = (type, tol, label) => ({ fn: 'eventTick', type, tol, label: label || `first ${type} tick` });
const evCount = (type, label) => ({ fn: 'eventCount', type, tol: 0, label: label || `${type} count` });
const afterEv = (type, obj, field, dt, tol, label) => ({ fn: 'afterEvent', type, obj, field, dt, tol, label: label || `${obj}.${field} ${dt}t after ${type}` });
const landTick = (car, from, tol) => ({ fn: 'when', obj: car, field: 'onGround', op: '>=', value: 1, from, tol, label: `${car} lands (tick, after ${from})` });

const car = (o) => ({ team: 0, pos: [0, 0, 17], yaw: NORTH, boost: 100, ...o });

// ---------------------------------------------------------------- sanity / rest
add({
  name: 'car_rest_settle', desc: 'Car dropped from z=30 settles on 4 wheels (RL rest z ~17.01, nose -0.55 deg).',
  ticks: 240, cars: [car({ pos: [0, 0, 30] })],
  metrics: [at('car0', 'z', 240, 0.3), at('car0', 'wheels', 240, 0), at('car0', 'pitchDeg', 240, 0.1), min('car0', 'z', 0, 240, 0.5)],
});
add({
  name: 'ball_rest_settle', desc: 'Ball dropped from z=150 comes to rest (RL rest z 93.15).',
  ticks: 480, ball: { pos: [0, 0, 150], vel: [0, 0, -1] },
  metrics: [at('ball', 'z', 480, 0.2), apexes(2, 2)],
});

// ---------------------------------------------------------------- ground driving
add({
  name: 'throttle_rest', desc: 'Full throttle from rest for 3 s (no boost).',
  ticks: 360, cars: [car({ pos: [0, -4000, 17], controls: [{ tick: 0, throttle: 1 }] })],
  metrics: [15, 30, 60, 120, 240, 360].map((t) => at('car0', 'fwdSpeed', t, 15))
    .concat([when('car0', 'speed', '>=', 1000, 0, 2), at('car0', 'pitchDeg', 30, 0.3, 'pitch (deg) @30 under throttle'), at('car0', 'z', 360, 0.5)]),
});
add({
  name: 'boost_rest', desc: 'Throttle + boost from rest with 100 boost (runs out at 3 s).',
  ticks: 480, cars: [car({ pos: [0, -4800, 17], controls: [{ tick: 0, throttle: 1, boost: true }] })],
  metrics: [30, 60, 120, 180, 240].map((t) => at('car0', 'speed', t, 15))
    .concat([when('car0', 'speed', '>=', 2200, 0, 2), when('car0', 'supersonic', '>=', 1, 0, 2), when('car0', 'speed', '>=', 2295, 0, 3), at('car0', 'boost', 120, 0.5), when('car0', 'boost', '<=', 0, 0, 1)]),
});
add({
  name: 'coast_1400', desc: 'Moving at 1400 uu/s, release throttle (coast brake 0.15 -> ~525 uu/s^2).',
  ticks: 360, cars: [car({ pos: [0, -4000, 17], vel: [0, 1400, 0] })],
  metrics: [30, 60, 120, 240].map((t) => at('car0', 'fwdSpeed', t, 15)).concat([when('car0', 'speed', '<=', 5, 0, 3)]),
});
add({
  name: 'brake_1400', desc: 'Moving at 1400 uu/s, full reverse throttle (brake ~3500 uu/s^2), then reverse.',
  ticks: 240, cars: [car({ pos: [0, -2000, 17], vel: [0, 1400, 0], controls: [{ tick: 0, throttle: -1 }] })],
  metrics: [when('car0', 'fwdSpeed', '<=', 0, 0, 2), at('car0', 'fwdSpeed', 15, 20), at('car0', 'fwdSpeed', 120, 20), at('car0', 'fwdSpeed', 240, 20)],
});
add({
  name: 'reverse_rest', desc: 'Full reverse throttle from rest for 3 s.',
  ticks: 360, cars: [car({ pos: [0, 2000, 17], controls: [{ tick: 0, throttle: -1 }] })],
  metrics: [30, 60, 120, 360].map((t) => at('car0', 'fwdSpeed', t, 15)),
});
for (const v of [500, 1000, 1500, 2300]) {
  const boost = v > 2000;
  add({
    name: `turn_${v}`, desc: `Full steer right at ${v} uu/s (cruise control${boost ? ' + boost' : ''}); steady-state turn radius.`,
    ticks: 240, unlimitedBoost: boost,
    cars: [car({ pos: [1200, -1000, 17], vel: [0, v, 0], controls: [boost ? { tick: 0, steer: 1, throttle: 1, boost: true } : { tick: 0, steer: 1, targetSpeed: v }] })],
    metrics: [avg('car0', 'speed', 120, 240, 10), yawRate('car0', 120, 240, 0.03), turnRadius('car0', 120, 240, 10), avg('car0', 'slipDeg', 120, 240, 1), at('car0', 'rollDeg', 180, 0.5, 'body roll (deg) @180')],
  });
}
add({
  name: 'powerslide_1400', desc: 'Handbrake + full steer + throttle at 1400 uu/s.',
  ticks: 120, cars: [car({ pos: [1200, -1000, 17], vel: [0, 1400, 0], controls: [{ tick: 0, steer: 1, throttle: 1, handbrake: true }] })],
  metrics: [at('car0', 'handbrake', 6, 0.01), yawRate('car0', 30, 120, 0.05), at('car0', 'speed', 60, 20), at('car0', 'speed', 120, 20), at('car0', 'slipDeg', 60, 2), at('car0', 'slipDeg', 120, 2)],
});
add({
  name: 'powerslide_release', desc: 'Powerslide 0.5 s at 1400 then release handbrake (recovery of grip).',
  ticks: 180, cars: [car({ pos: [1200, -1000, 17], vel: [0, 1400, 0], controls: [{ tick: 0, steer: 1, throttle: 1, handbrake: true }, { tick: 60, handbrake: false, steer: 0 }] })],
  metrics: [at('car0', 'slipDeg', 60, 2), at('car0', 'slipDeg', 90, 2), at('car0', 'slipDeg', 180, 2), at('car0', 'speed', 180, 20), at('car0', 'handbrake', 90, 0.01)],
});

// ---------------------------------------------------------------- jumps / flips
const jumpMetrics = (to = 300) => [max('car0', 'z', 0, to, 2), argmax('car0', 'z', 0, to, 2), landTick('car0', 20, 2), max('car0', 'vz', 0, to, 5)];
add({ name: 'jump_tap', desc: 'Jump pressed for exactly 1 tick (minimum jump).', ticks: 180,
  cars: [car({ controls: [{ tick: 0, jump: true }, { tick: 1, jump: false }] })], metrics: jumpMetrics(180) });
add({ name: 'jump_full', desc: 'Jump held 0.3 s (> 0.2 s max hold).', ticks: 240,
  cars: [car({ controls: [{ tick: 0, jump: true }, { tick: 36, jump: false }] })], metrics: jumpMetrics(240) });
add({ name: 'double_jump', desc: 'Full first jump (0.2 s), release, second jump at 0.3 s.', ticks: 340,
  cars: [car({ controls: [{ tick: 0, jump: true }, { tick: 24, jump: false }, { tick: 36, jump: true }, { tick: 40, jump: false }] })],
  metrics: jumpMetrics(340).concat([at('car0', 'vz', 37, 5, 'vz right after 2nd jump')]) });

const flip = (name, desc, stick, extra = [], over = {}) => add({
  name, desc, ticks: 240, ...over,
  cars: [car({ ...(over.car || {}), controls: [{ tick: 0, jump: true }, { tick: 6, jump: false }, { tick: 12, jump: true, ...stick }, { tick: 14, jump: false }, ...extra] })],
  metrics: [max('car0', 'hspeed', 12, 200, 10), at('car0', 'hspeed', 20, 10), at('car0', 'vz', 30, 10), at('car0', 'angSpeed', 20, 0.1), at('car0', 'angSpeed', 60, 0.2),
    at('car0', 'upz', 40, 0.05), at('car0', 'upz', 70, 0.05), landTick('car0', 20, 3), at('car0', 'upz', 240, 0.05), max('car0', 'z', 0, 240, 3), max('car0', 'z', 14, 240, 3, 'max z after dodge')],
});
flip('flip_front', 'Short jump then forward dodge (pitch -1).', { pitch: -1 });
flip('flip_back', 'Short jump then backward dodge (pitch +1).', { pitch: 1 });
flip('flip_side', 'Short jump then right side dodge (yaw +1).', { yaw: 1 });
flip('flip_diag', 'Short jump then diagonal dodge (pitch -1, yaw +1).', { pitch: -1, yaw: 1 });
flip('flip_cancel', 'Forward dodge then pitch +1 from 6 ticks later (flip cancel).', { pitch: -1 }, [{ tick: 18, pitch: 1 }]);
flip('flip_front_moving', 'Forward dodge while driving at 1000 uu/s (throttle held).', { pitch: -1 }, [{ tick: 0, throttle: 1 }], { car: { vel: [0, 1000, 0], pos: [0, -3000, 17] } });

// ---------------------------------------------------------------- air control
const airStep = (name, input) => add({
  name, desc: `In the air at rest: ${Object.keys(input)[0]} +1 for 0.5 s then release (step response).`, ticks: 100,
  cars: [car({ pos: [0, 0, 1000], isOnGround: false, controls: [{ tick: 0, ...input }, { tick: 60, pitch: 0, yaw: 0, roll: 0 }] })],
  metrics: [at('car0', 'angSpeed', 6, 0.05), at('car0', 'angSpeed', 15, 0.05), at('car0', 'angSpeed', 60, 0.05), at('car0', 'angSpeed', 66, 0.05), at('car0', 'angSpeed', 90, 0.05), at('car0', 'orientErrRef', 60, 2, 'orientation (deg rotated) @60')],
});
airStep('air_roll_step', { roll: 1 });
airStep('air_pitch_step', { pitch: 1 });
airStep('air_yaw_step', { yaw: 1 });
add({
  name: 'air_boost', desc: 'Airborne, level, boost for 0.5 s (air boost accel 1058.33).', ticks: 90,
  cars: [car({ pos: [0, -2000, 1000], isOnGround: false, controls: [{ tick: 0, boost: true }, { tick: 60, boost: false }] })],
  metrics: [at('car0', 'hspeed', 60, 5), at('car0', 'hspeed', 90, 5), at('car0', 'boost', 60, 0.3)],
});
add({
  name: 'air_throttle', desc: 'Airborne, throttle 1 for 0.5 s (66.67 uu/s^2).', ticks: 60,
  cars: [car({ pos: [0, -2000, 1000], isOnGround: false, controls: [{ tick: 0, throttle: 1 }] })],
  metrics: [at('car0', 'hspeed', 60, 2)],
});

// ---------------------------------------------------------------- landing / walls
add({
  name: 'land_drop_300', desc: 'Upright car dropped from z=300 (landing impact, suspension bounce, settle).', ticks: 240,
  cars: [car({ pos: [0, 0, 300], isOnGround: false })],
  metrics: [landTick('car0', 0, 1), min('car0', 'z', 0, 240, 1), max('car0', 'z', 70, 240, 1, 'max z after landing (bounce)'), at('car0', 'z', 240, 0.5), min('car0', 'vz', 0, 240, 5)],
});
add({
  name: 'land_drop_tilted', desc: 'Car rolled 0.6 rad and pitched 0.3 rad dropped from z=200 (landing on two wheels).', ticks: 240,
  cars: [car({ pos: [0, 0, 200], roll: 0.6, pitch: 0.3, isOnGround: false })],
  metrics: [landTick('car0', 0, 2), at('car0', 'upz', 120, 0.02), at('car0', 'upz', 240, 0.01), at('car0', 'z', 240, 0.5), max('car0', 'angSpeed', 0, 240, 0.3)],
});
add({
  name: 'wall_drive', desc: 'Drive at the +x side wall with throttle+boost 0.75 s then throttle only; up the ramp and onto the wall.', ticks: 360,
  cars: [car({ pos: [2800, 0, 17], yaw: 0, controls: [{ tick: 0, throttle: 1, boost: true }, { tick: 90, boost: false }] })],
  metrics: [max('car0', 'z', 0, 360, 20), when('car0', 'upx', '<=', -0.9, 0, 3, 'tick car is on wall (up.x<=-0.9)'), at('car0', 'z', 180, 20), at('car0', 'wheels', 180, 0), at('car0', 'speed', 120, 30), when('car0', 'onGround', '<=', 0, 30, 3, 'tick car leaves surface')],
});
add({
  name: 'turtle_autoflip', desc: 'Upside down on the floor, press jump (auto-flip recovery).', ticks: 300,
  cars: [car({ pos: [0, 0, 60], roll: PI, isOnGround: false, controls: [{ tick: 90, jump: true }, { tick: 92, jump: false }] })],
  metrics: [at('car0', 'upz', 90, 0.05), max('car0', 'angSpeed', 90, 300, 0.3), at('car0', 'upz', 200, 0.1), at('car0', 'upz', 300, 0.05)],
});

// ---------------------------------------------------------------- ball vs world
add({
  name: 'ball_drop_1000', desc: 'Ball dropped from z=1000 (5 bounces).', ticks: 720,
  ball: { pos: [0, 0, 1000], vel: [0, 0, -1] },
  metrics: [apexes(5, 2), min('ball', 'vz', 0, 120, 3, 'impact vz (first)'), when('ball', 'vz', '>=', 1, 0, 1, 'first bounce tick')],
});
add({
  name: 'ball_roll_1500', desc: 'Ball on the floor rolling at 1500 uu/s (drag + friction; slide to roll).', ticks: 480,
  ball: { pos: [0, -3000, 93.15], vel: [0, 1500, 0] },
  metrics: [at('ball', 'speed', 30, 5), at('ball', 'speed', 120, 5), at('ball', 'speed', 480, 5), at('ball', 'angSpeed', 30, 0.1), at('ball', 'angSpeed', 120, 0.1), max('ball', 'z', 0, 480, 1)],
});
add({
  name: 'ball_wall_2000', desc: 'Ball thrown into the +x side wall at 2000 uu/s.', ticks: 150,
  ball: { pos: [2500, 0, 400], vel: [2000, 0, 0] },
  metrics: [when('ball', 'vx', '<=', 0, 0, 1, 'wall bounce tick'), at('ball', 'vx', 120, 10), at('ball', 'vz', 120, 10), at('ball', 'angSpeed', 120, 0.1), max('ball', 'x', 0, 150, 1)],
});
add({
  name: 'ball_wall_angled', desc: 'Ball hits the side wall at 45 deg (2000 uu/s in, 1000 along).', ticks: 150,
  ball: { pos: [2800, -600, 600], vel: [2000, 1000, 300] },
  metrics: [at('ball', 'vx', 120, 10), at('ball', 'vy', 120, 10), at('ball', 'vz', 120, 10), at('ball', 'angSpeed', 120, 0.1)],
});
add({
  name: 'ball_spin_land', desc: 'Ball with 6 rad/s backspin dropped from z=300 (spin -> velocity on bounce).', ticks: 150,
  ball: { pos: [0, 0, 300], vel: [0, 0, -1], angVel: [6, 0, 0] },
  metrics: [at('ball', 'vy', 60, 5), at('ball', 'vz', 60, 5), at('ball', 'angSpeed', 60, 0.1), at('ball', 'vy', 150, 5), max('ball', 'z', 50, 150, 2)],
});
add({
  name: 'ball_floor_angled', desc: 'Ball hits the floor at 45 deg (1000 along, 1000 down) without spin.', ticks: 120,
  ball: { pos: [0, -2000, 500], vel: [0, 1000, -1000] },
  metrics: [at('ball', 'vy', 60, 5), at('ball', 'vz', 60, 5), at('ball', 'angSpeed', 60, 0.1)],
});
add({
  name: 'ball_ceiling', desc: 'Ball fired straight up into the ceiling at 3000 uu/s.', ticks: 120,
  ball: { pos: [0, 0, 500], vel: [0, 0, 3000] },
  metrics: [max('ball', 'z', 0, 120, 1), at('ball', 'vz', 60, 10)],
});

// ---------------------------------------------------------------- car vs ball
for (const v of [500, 1000, 1400, 2300]) {
  for (const off of [0, 45]) {
    const boost = v > 1450;
    add({
      name: `hit_${v}_${off ? 'offset' : 'center'}`, desc: `Car at ${v} uu/s drives into a resting ball${off ? ` offset ${off} uu to the car's left (x=+${off})` : ' head-on'}.`,
      ticks: 150, unlimitedBoost: boost,
      ball: { pos: [off, 0, 93.15] },
      cars: [car({ pos: [0, -450 - Math.min(v, 1400) * 0.2, 17], vel: [0, v, 0], controls: [boost ? { tick: 0, throttle: 1, boost: true } : { tick: 0, targetSpeed: v }] })],
      metrics: [evTick('ballHit', 1), afterEv('ballHit', 'ball', 'speed', 20, 20), afterEv('ballHit', 'ball', 'vz', 20, 15), afterEv('ballHit', 'ball', 'vx', 20, 15),
        afterEv('ballHit', 'car0', 'fwdSpeed', 20, 20), afterEv('ballHit', 'ball', 'angSpeed', 20, 0.2), evCount('ballHit')],
    });
  }
}
add({
  name: 'dribble_push', desc: 'Car at 300 uu/s pushes a resting ball along the floor for 2.5 s.', ticks: 300,
  ball: { pos: [0, -600, 93.15] },
  cars: [car({ pos: [0, -900, 17], vel: [0, 300, 0], controls: [{ tick: 0, targetSpeed: 300 }] })],
  metrics: [evTick('ballHit', 2), evCount('ballHit'), at('ball', 'speed', 120, 20), at('ball', 'y', 300, 30), max('ball', 'z', 0, 300, 5), at('car0', 'fwdSpeed', 300, 20)],
});
add({
  name: 'ball_on_roof', desc: 'Ball dropped onto a stationary car roof from z=300 (car-ball restitution 0, friction 2).', ticks: 150,
  ball: { pos: [10, 0, 300], vel: [0, 0, -1] },
  cars: [car({ pos: [0, 0, 17] })],
  metrics: [evTick('ballHit', 1), max('ball', 'z', 30, 150, 3, 'ball rebound apex'), at('ball', 'z', 150, 5), at('car0', 'z', 60, 1)],
});

// ---------------------------------------------------------------- car vs car
add({
  name: 'bump_head_on_1400', desc: 'Two cars (blue, orange) head-on at 1400 uu/s each.', ticks: 150,
  cars: [
    car({ pos: [0, -700, 17], vel: [0, 1400, 0], controls: [{ tick: 0, throttle: 1 }] }),
    car({ team: 1, pos: [0, 700, 17], yaw: -NORTH, vel: [0, -1400, 0], controls: [{ tick: 0, throttle: 1 }] }),
  ],
  metrics: [evTick('bump', 1), evCount('bump'), evCount('demo'), afterEv('bump', 'car0', 'vy', 30, 30), afterEv('bump', 'car1', 'vy', 30, 30), max('car0', 'z', 0, 150, 10), max('car1', 'z', 0, 150, 10)],
});
add({
  name: 'bump_side_1400', desc: 'Blue at 1400 uu/s T-bones a stationary orange car.', ticks: 150,
  cars: [
    car({ pos: [0, -800, 17], vel: [0, 1400, 0], controls: [{ tick: 0, targetSpeed: 1400 }] }),
    car({ team: 1, pos: [0, 0, 17], yaw: 0 }),
  ],
  metrics: [evTick('bump', 1), evCount('bump'), afterEv('bump', 'car1', 'speed', 10, 30), afterEv('bump', 'car1', 'vz', 10, 30), max('car1', 'z', 0, 150, 10), afterEv('bump', 'car0', 'speed', 10, 30)],
});
add({
  name: 'demo_supersonic', desc: 'Supersonic blue car (2300) hits a stationary orange car: demolition.', ticks: 120, unlimitedBoost: true,
  cars: [
    car({ pos: [0, -1200, 17], vel: [0, 2300, 0], controls: [{ tick: 0, throttle: 1, boost: true }] }),
    car({ team: 1, pos: [0, 0, 17], yaw: 0 }),
  ],
  metrics: [evTick('demo', 1), evCount('demo'), at('car1', 'demoed', 120, 0), afterEv('demo', 'car0', 'speed', 10, 30)],
});

// ---------------------------------------------------------------- kickoff
// Diagonal kickoff spots (RocketSim CAR_SPAWN_LOCATIONS_SOCCAR[0], mirrored for
// orange). The real spawn yaw is pi/4, which points 512 uu short of the ball,
// so these scenarios aim the car straight at the ball instead (no steering).
const KO_YAW = Math.atan2(2560, 2048);
add({
  name: 'kickoff_diagonal', desc: 'Both cars from the diagonal kickoff spots aimed at the ball, throttle + boost (33.3 spawn boost) for 3 s.', ticks: 360,
  ball: { pos: [0, 0, 93.15] },
  cars: [
    car({ pos: [-2048, -2560, 17], yaw: KO_YAW, boost: 100 / 3, controls: [{ tick: 0, throttle: 1, boost: true }] }),
    car({ team: 1, pos: [2048, 2560, 17], yaw: KO_YAW + PI, boost: 100 / 3, controls: [{ tick: 0, throttle: 1, boost: true }] }),
  ],
  metrics: [evTick('ballHit', 2), at('car0', 'speed', 120, 20), at('car0', 'boost', 120, 0.5), afterEv('ballHit', 'ball', 'speed', 30, 50), afterEv('ballHit', 'ball', 'z', 30, 30),
    afterEv('ballHit', 'car0', 'speed', 30, 50), afterEv('ballHit', 'car1', 'speed', 30, 50), max('ball', 'z', 0, 360, 30)],
});
add({
  name: 'kickoff_single', desc: 'One car from the diagonal spot aimed at the ball, throttle + boost, hits the ball alone.', ticks: 300,
  ball: { pos: [0, 0, 93.15] },
  cars: [car({ pos: [-2048, -2560, 17], yaw: KO_YAW, boost: 100 / 3, controls: [{ tick: 0, throttle: 1, boost: true }] })],
  metrics: [evTick('ballHit', 2), afterEv('ballHit', 'ball', 'speed', 20, 30), afterEv('ballHit', 'ball', 'vz', 20, 20), afterEv('ballHit', 'car0', 'speed', 20, 30), at('car0', 'speed', 90, 15)],
});
add({
  name: 'kickoff_spawn_yaw', desc: 'Diagonal kickoff with the real spawn yaw pi/4 and steer +0.3 toward the ball for 0.5 s.', ticks: 300,
  ball: { pos: [0, 0, 93.15] },
  cars: [car({ pos: [-2048, -2560, 17], yaw: PI / 4, boost: 100 / 3, controls: [{ tick: 0, throttle: 1, boost: true, steer: -0.3 }, { tick: 60, steer: 0 }] })],
  metrics: [evTick('ballHit', 2), at('car0', 'x', 60, 10), at('car0', 'heading', 60, 0.02, 'heading (rad) @60'), afterEv('ballHit', 'ball', 'speed', 20, 30)],
});

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.json')) fs.unlinkSync(path.join(OUT, f));
scenarios.forEach((s, i) => {
  const file = path.join(OUT, `${String(i + 1).padStart(2, '0')}_${s.name}.json`);
  fs.writeFileSync(file, JSON.stringify(s, null, 1) + '\n');
});
console.error(`[make-scenarios] wrote ${scenarios.length} scenarios to ${OUT}`);
