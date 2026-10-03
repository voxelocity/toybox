// Drives the player camera (public/js/render/camera.js) with scripted car states
// and prints where it ends up relative to the car. No browser needed.
//   node tools/camera-probe.mjs            all scenarios, Default preset
//   node tools/camera-probe.mjs pro        same with FOV 110 / 270 / 100 / -3 / 0.45 / 4.5 / 1.2
import { ChaseCamera } from '../public/js/render/camera.js';
import { CAMERA_PRESETS } from '../public/js/settings.js';

const DT = 1 / 60, D = 180 / Math.PI;
const pro = process.argv[2] === 'pro';
const camSettings = pro
  ? { fov: 110, distance: 270, height: 100, angle: -3, stiffness: 0.45, swivel: 4.5, transition: 1.2 }
  : { ...CAMERA_PRESETS.default };
delete camSettings.label;

function fakeCamera(aspect = 16 / 9) {
  const vec = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
  return { position: vec(), up: vec(), fov: 50, aspect, lookAt() {}, rotateX() {}, rotateY() {}, updateProjectionMatrix() {} };
}
function makeCam(extra = {}, aspect) {
  const settings = { camera: { ...camSettings, invertSwivel: false, ballCamDefault: false, toggleBallCam: true, shake: false, ...extra } };
  return new ChaseCamera(fakeCamera(aspect), null, settings);
}
// quaternion from yaw (about z), then pitch (about car y = left; positive = nose down), then roll
function quat(yaw = 0, pitch = 0, roll = 0) {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2), cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  return { w: cr * cp * cy + sr * sp * sy, x: sr * cp * cy - cr * sp * sy, y: cr * sp * cy + sr * cp * sy, z: cr * cp * sy - sr * sp * cy };
}
function quatFromBasis(f, l, u) { // rows of R^T: columns f, l, u
  const m00 = f.x, m01 = l.x, m02 = u.x, m10 = f.y, m11 = l.y, m12 = u.y, m20 = f.z, m21 = l.z, m22 = u.z;
  const tr = m00 + m11 + m22;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; return { w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s }; }
  if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; return { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s }; }
  if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; return { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s }; }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2; return { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s };
}
function carState(pos, vel, q, extra = {}) {
  return { pos: { ...pos }, vel: { ...vel }, quat: q, supersonic: false, boosting: false, demoed: false, onGround: true, ...extra };
}
function physCar(onGround, normal = { x: 0, y: 0, z: 1 }, jumping = false) {
  return { isOnGround: onGround, isJumping: jumping, wheels: [0, 1, 2, 3].map(() => ({ contact: onGround, normal })) };
}
const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);
/** Camera relative to the car in car-local axes (forward, left, up), plus pitch/yaw/roll in degrees. */
function rel(cam, s) {
  const q = s.quat, x = q.x, y = q.y, z = q.z, w = q.w;
  const F = { x: 1 - 2 * (y * y + z * z), y: 2 * (x * y + w * z), z: 2 * (x * z - w * y) };
  const L = { x: 2 * (x * y - w * z), y: 1 - 2 * (x * x + z * z), z: 2 * (y * z + w * x) };
  const U = { x: 2 * (x * z + w * y), y: 2 * (y * z - w * x), z: 1 - 2 * (x * x + y * y) };
  const d = { x: cam.pos.x - s.pos.x, y: cam.pos.y - s.pos.y, z: cam.pos.z - s.pos.z };
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  return `cam rel car (fwd ${f1(dot(d, F))}, left ${f1(dot(d, L))}, up ${f1(dot(d, U))}) world z ${f1(cam.pos.z)} | pitch ${f1(cam.rot.p * D)} yaw ${f1(cam.rot.y * D)} roll ${f2(cam.rot.r * D)} | dist ${f1(cam.dist)} hfov ${f2(cam.hfov)} vfov ${f2(cam.camera.fov)}`;
}
function run(cam, s, car, ball, frames, swivel = { x: 0, y: 0 }, each, still = false) {
  for (let i = 0; i < frames; i++) {
    cam.updateCar(DT, s, car, ball, swivel);
    if (each) each(i, cam);
    if (!still) { s.pos.x += s.vel.x * DT; s.pos.y += s.vel.y * DT; s.pos.z += s.vel.z * DT; }
  }
}
const ballFar = { x: 0, y: 3000, z: 93 };
const out = (name, text) => console.log(`${name.padEnd(30)} ${text}`);

console.log(`settings: ${JSON.stringify(camSettings)}`);
// 1. at rest on the floor, facing +x
{
  const cam = makeCam(); const s = carState({ x: 0, y: 0, z: 17 }, { x: 0, y: 0, z: 0 }, quat(0));
  run(cam, s, physCar(true), ballFar, 300);
  out('rest (floor)', rel(cam, s));
  for (const [name, a] of [['16:9', 16 / 9], ['21:9', 64 / 27], ['32:9', 32 / 9], ['4:3', 4 / 3], ['9:19.5 portrait', 9 / 19.5]]) {
    const c2 = makeCam({}, a); run(c2, carState({ x: 0, y: 0, z: 17 }, { x: 0, y: 0, z: 0 }, quat(0)), physCar(true), ballFar, 2);
    const v = c2.camera.fov, h = 2 * Math.atan(Math.tan(v / 2 / D) * a) * D;
    out(`  fov at ${name}`, `vertical ${f2(v)}  horizontal ${f2(h)}`);
  }
}
// 2. driving straight at speed (+x)
for (const [speed, ss] of [[1410, false], [2200, false], [2300, true]]) {
  const cam = makeCam(); const s = carState({ x: -3000, y: 0, z: 17 }, { x: speed, y: 0, z: 0 }, quat(0), { supersonic: ss });
  run(cam, s, physCar(true), ballFar, 600);
  out(`straight ${speed}${ss ? ' supersonic' : ''}`, rel(cam, s));
}
// 3. stiffness: steady circle at 1400 uu/s, radius 600 (turning left)
for (const st of [0, 0.5, 1]) {
  const cam = makeCam({ stiffness: st }); const R = 600, w = 1400 / R;
  const s = carState({ x: R, y: 0, z: 17 }, { x: 0, y: 1400, z: 0 }, quat(Math.PI / 2));
  let tt = 0;
  for (let i = 0; i < 600; i++) {
    tt += DT; const a = w * tt;
    s.pos.x = R * Math.cos(a); s.pos.y = R * Math.sin(a); s.vel.x = -1400 * Math.sin(a); s.vel.y = 1400 * Math.cos(a);
    s.quat = quat(a + Math.PI / 2);
    cam.updateCar(DT, s, physCar(true), ballFar, { x: 0, y: 0 });
  }
  const carYaw = ((w * tt + Math.PI / 2) * D) % 360, camYaw = (cam.rot.y * D + 360) % 360;
  out(`circle r600 stiffness ${st}`, `yaw lag ${f1(((carYaw - camYaw + 540) % 360) - 180)} deg | ${rel(cam, s)}`);
}
// 4. jump and spin in the air: camera ignores the car's rotation
{
  const cam = makeCam(); const s = carState({ x: 0, y: 0, z: 17 }, { x: 1000, y: 0, z: 0 }, quat(0));
  run(cam, s, physCar(true), ballFar, 120);
  const before = cam.rot.y * D;
  s.vel.z = 800;
  let maxYaw = 0, maxRoll = 0;
  for (let i = 0; i < 90; i++) {
    s.quat = quat(i * 0.4, i * 0.7, i * 0.9);
    s.vel.z -= 650 * DT;
    cam.updateCar(DT, s, physCar(false), ballFar, { x: 0, y: 0 });
    s.pos.x += s.vel.x * DT; s.pos.z += s.vel.z * DT;
    if (cam.car.airGroundBlend === 0) { maxYaw = Math.max(maxYaw, Math.abs(cam.rot.y * D - before)); maxRoll = Math.max(maxRoll, Math.abs(cam.rot.r * D)); }
  }
  out('air, car spinning', `max yaw change ${f1(maxYaw)} deg, max roll ${f2(maxRoll)} deg, air/ground blend ${f2(cam.car.airGroundBlend)}`);
  // landing back on the floor
  s.quat = quat(0); s.pos.z = 17; s.vel.z = 0;
  let t90 = -1;
  for (let i = 0; i < 120; i++) { cam.updateCar(DT, s, physCar(true), ballFar, { x: 0, y: 0 }); if (t90 < 0 && cam.car.airGroundBlend >= 1) t90 = (i + 1) * DT; }
  out('landing', `ground camera fully back after ${f2(t90)} s | ${rel(cam, s)}`);
}
// 5. flying sideways: camera turns to the direction of travel
{
  const cam = makeCam(); const s = carState({ x: 0, y: 0, z: 17 }, { x: 0, y: 0, z: 0 }, quat(0));
  run(cam, s, physCar(true), ballFar, 60);
  s.pos.z = 500; s.vel.y = 1500;
  run(cam, s, physCar(false), ballFar, 240);
  out('air, flying +y (left)', `camera yaw ${f1(cam.rot.y * D)} deg (travel 90) | pitch ${f1(cam.rot.p * D)}`);
}
// 6. driving up the +x side wall (normal -x), nose up
{
  const cam = makeCam(); const n = { x: -1, y: 0, z: 0 };
  const s = carState({ x: 4079, y: 0, z: 600 }, { x: 0, y: 0, z: 1000 }, quatFromBasis({ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, n));
  run(cam, s, physCar(true, n), ballFar, 600, undefined, undefined, true);
  out('wall, driving straight up', rel(cam, s) + ` | up.z ${f2(cam.up.z)}`);
  const s2 = carState({ x: 4079, y: 0, z: 600 }, { x: 0, y: 1000, z: 0 }, quatFromBasis({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, n));
  const cam2 = makeCam(); run(cam2, s2, physCar(true, n), ballFar, 600, undefined, undefined, true);
  out('wall, driving along (+y)', rel(cam2, s2) + ` | up.z ${f2(cam2.up.z)}`);
}
// 7. upside down on the ceiling, driving +x
{
  const cam = makeCam(); const n = { x: 0, y: 0, z: -1 };
  const s = carState({ x: 0, y: 0, z: 2027 }, { x: 1000, y: 0, z: 0 }, quatFromBasis({ x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, n));
  run(cam, s, physCar(true, n), ballFar, 600, undefined, undefined, true);
  out('ceiling, driving +x', rel(cam, s) + ` | up.z ${f2(cam.up.z)}`);
}
// 8. ball cam
for (const [name, ball] of [['ahead far, ground', { x: 3000, y: 0, z: 93 }], ['ahead 1500, 1500 up', { x: 1500, y: 0, z: 1600 }], ['ahead 800, 1800 up', { x: 800, y: 0, z: 1900 }], ['overhead 1000 up', { x: 20, y: 0, z: 1100 }], ['on the roof (dribble)', { x: 30, y: 0, z: 150 }], ['behind 1500', { x: -1500, y: 0, z: 93 }], ['to the left 1500', { x: 0, y: 1500, z: 93 }]]) {
  const cam = makeCam(); cam.ballCam = true;
  const s = carState({ x: 0, y: 0, z: 17 }, { x: 0, y: 0, z: 0 }, quat(0));
  run(cam, s, physCar(true), ball, 300);
  // where the car and the ball land on screen (16:9): vertical position 0 = centre, +-1 = edge
  const scr = (p) => {
    const dx = p.x - cam.pos.x, dy = p.y - cam.pos.y, dz = p.z - cam.pos.z, f = cam.fwd, u = cam.up;
    const r = { x: f.y * u.z - f.z * u.y, y: f.z * u.x - f.x * u.z, z: f.x * u.y - f.y * u.x };
    const zf = dx * f.x + dy * f.y + dz * f.z; if (zf <= 0) return 'behind';
    const tv = Math.tan(cam.camera.fov / 2 / D), th = tv * 16 / 9;
    return `(${f2((dx * r.x + dy * r.y + dz * r.z) / zf / th)}, ${f2((dx * u.x + dy * u.y + dz * u.z) / zf / tv)})`;
  };
  out(`ball cam: ${name}`, `${rel(cam, s)} | screen car ${scr(s.pos)} ball ${scr(ball)}`);
}
// 9. transition: ball to the left, toggle ball cam on, then off
for (const tr of [1, 1.5, 2]) {
  const cam = makeCam({ transition: tr }); const s = carState({ x: 0, y: 0, z: 17 }, { x: 0, y: 0, z: 0 }, quat(0));
  const ball = { x: 0, y: 2000, z: 93 };
  run(cam, s, physCar(true), ball, 120);
  cam.ballCam = true;
  const marks = [];
  run(cam, s, physCar(true), ball, 120, { x: 0, y: 0 }, (i, c) => { marks.push(c.rot.y * D); });
  const at = (v) => { const i = marks.findIndex((y) => y >= v); return i < 0 ? '-' : f2((i + 1) * DT); };
  out(`transition speed ${tr}`, `car->ball cam yaw 0->90: 10% ${at(9)} s, 50% ${at(45)} s, 90% ${at(81)} s, 99% ${at(89.1)} s`);
}
// 9b. demolished: the camera stays put, turns to follow the demolisher and zooms in; respawn starts over
{
  const cam = makeCam(); const s = carState({ x: 0, y: 0, z: 17 }, { x: 1000, y: 0, z: 0 }, quat(0));
  run(cam, s, physCar(true), ballFar, 120);
  const at = { ...cam.pos };
  const attacker = { pos: { x: 300, y: 0, z: 17 }, isDemoed: false };
  cam.demolisher = attacker; s.demoed = true;
  for (let i = 0; i < 120; i++) { attacker.pos.y += 1500 * DT; cam.updateCar(DT, s, null, ballFar, { x: 0, y: 0 }); }
  const moved = Math.hypot(cam.pos.x - at.x, cam.pos.y - at.y, cam.pos.z - at.z);
  const toAtt = Math.atan2(attacker.pos.y - cam.pos.y, attacker.pos.x - cam.pos.x) * D;
  out('demolished (2 s)', `camera moved ${f1(moved)} uu, yaw ${f1(cam.rot.y * D)} (attacker at ${f1(toAtt)}), hfov ${f2(cam.hfov)}`);
  s.demoed = false; s.pos = { x: -2048, y: -2560, z: 17 }; s.vel = { x: 0, y: 0, z: 0 }; s.quat = quat(Math.PI / 4);
  run(cam, s, physCar(true), ballFar, 1);
  out('respawn (first frame)', rel(cam, s));
}
// 10. swivel: full right stick at rest and at speed, then release
for (const speed of [0, 2300]) {
  const cam = makeCam(); const s = carState({ x: -3000, y: 0, z: 17 }, { x: speed, y: 0, z: 0 }, quat(0));
  run(cam, s, physCar(true), ballFar, 60);
  const ys = [];
  run(cam, s, physCar(true), ballFar, 600, { x: 1, y: 0 }, (i, c) => ys.push(-c.rot.y * D));
  const max = ys[ys.length - 1], half = ys.findIndex((y) => y >= max / 2);
  run(cam, s, physCar(true), ballFar, 30, { x: 0, y: 0 });
  out(`swivel right, speed ${speed}`, `max ${f1(max)} deg (half after ${f2((half + 1) * DT)} s) | 0.5 s after release ${f1(-cam.rot.y * D)} deg`);
}
{
  const cam = makeCam(); const s = carState({ x: 0, y: 0, z: 17 }, { x: 0, y: 0, z: 0 }, quat(0));
  run(cam, s, physCar(true), ballFar, 600, { x: 0, y: -1 });
  const up = cam.rot.p * D;
  run(cam, s, physCar(true), ballFar, 600, { x: 0, y: 1 });
  out('swivel up / down', `pitch up ${f1(up)} deg, down ${f1(cam.rot.p * D)} deg | z ${f1(cam.pos.z)}`);
}
// 11. rear view
{
  const cam = makeCam(); cam.rearView = true; const s = carState({ x: 0, y: 0, z: 17 }, { x: 0, y: 0, z: 0 }, quat(0));
  run(cam, s, physCar(true), ballFar, 120);
  out('rear view', rel(cam, s));
}
// 12. per-frame cost
{
  const cam = makeCam(); cam.ballCam = true; const s = carState({ x: 0, y: 0, z: 17 }, { x: 1000, y: 300, z: 0 }, quat(0.3));
  const car = physCar(true); const t0 = performance.now(); const N = 200000;
  for (let i = 0; i < N; i++) { s.pos.x = (i % 1000); cam.updateCar(DT, s, car, ballFar, { x: 0.3, y: 0 }); }
  out('cost', `${f2((performance.now() - t0) * 1000 / N)} us per update`);
}
