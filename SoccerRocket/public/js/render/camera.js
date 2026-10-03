// Chase camera with car-cam / ball-cam, swivel (free look), stiffness and
// smooth transitions, plus a cinematic orbit used by menus and replays.
// Works in physics space (uu) and writes the three.js camera.
import * as THREE from 'three';
import { S } from './convert.js';

const _v = new THREE.Vector3();

function toThree(x, y, z, out) { return out.set(x * S, z * S, -y * S); }

export class ChaseCamera {
  constructor(camera, renderer, settings) {
    this.camera = camera;
    this.renderer = renderer;
    this.settings = settings;
    this.ballCam = settings.camera.ballCamDefault;
    this.ballCamBlend = this.ballCam ? 1 : 0;
    this.pos = new THREE.Vector3(0, -800, 300);     // physics uu
    this.look = new THREE.Vector3(0, 0, 100);
    this.up = new THREE.Vector3(0, 0, 1);
    this.yaw = 0;            // smoothed camera heading (rad, physics)
    this.swivelX = 0; this.swivelY = 0;
    this.shake = 0;
    this.mode = 'chase';     // chase | orbit | goal | spectate | free
    this.orbitT = 0;
    this.fovKick = 0;
  }

  toggleBallCam() { this.ballCam = !this.ballCam; }

  addShake(a) { if (this.settings.camera.shake) this.shake = Math.min(1.2, this.shake + a); }

  /** car / ball are physics objects (interpolated positions passed in). */
  updateChase(dt, carPos, carFwd, carUp, carVel, onGround, ballPos, supersonic) {
    const cs = this.settings.camera;
    const target = this.ballCam ? 1 : 0;
    const tSpeed = 1 / Math.max(0.05, 0.5 / cs.transition);
    this.ballCamBlend += Math.sign(target - this.ballCamBlend) * Math.min(Math.abs(target - this.ballCamBlend), dt * tSpeed);

    // camera "up" follows the surface when driving, world up in the air
    const upTarget = onGround ? carUp : new THREE.Vector3(0, 0, 1);
    this.up.lerp(upTarget, 1 - Math.exp(-dt * (onGround ? 6 : 3))).normalize();

    // heading for car cam: car forward projected on the camera plane
    const fwd = _v.copy(carFwd).addScaledVector(this.up, -carFwd.dot(this.up));
    if (fwd.lengthSq() < 1e-4) fwd.copy(carVel).addScaledVector(this.up, -carVel.dot(this.up));
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 1, 0);
    fwd.normalize();
    const carDir = fwd.clone();

    // ball cam direction: from ball to car, flattened on the camera plane
    const toCar = new THREE.Vector3().subVectors(carPos, ballPos);
    const ballDir = toCar.clone().addScaledVector(this.up, -toCar.dot(this.up));
    if (ballDir.lengthSq() < 1) ballDir.copy(carDir).negate();
    ballDir.normalize().negate(); // direction the camera looks (car -> ball)

    const dir = carDir.clone().lerp(ballDir, this.ballCamBlend);
    if (dir.lengthSq() < 1e-4) dir.copy(carDir);
    dir.normalize();

    // smooth heading
    const swivelAng = this.swivelX * Math.PI;
    if (swivelAng !== 0) dir.applyAxisAngle(this.up, -swivelAng);
    if (!this.camDir) this.camDir = dir.clone();
    const k = 1 - Math.exp(-dt * (this.ballCamBlend > 0.5 ? 10 : 7 + cs.swivel));
    this.camDir.lerp(dir, k).normalize();

    // distance grows a little with speed (lower stiffness = more stretch)
    const speed = carVel.length();
    const stretch = (1 - cs.stiffness) * Math.min(speed, 2300) / 2300 * 70;
    const dist = cs.distance + stretch;
    const height = cs.height + this.swivelY * 150;
    const desired = new THREE.Vector3().copy(carPos).addScaledVector(this.camDir, -dist).addScaledVector(this.up, height);

    // look point: above the car for car cam, toward the ball for ball cam
    const lookCar = new THREE.Vector3().copy(carPos).addScaledVector(this.up, 40).addScaledVector(this.camDir, 120);
    const lookBall = new THREE.Vector3().copy(ballPos);
    // keep the car in the lower part of the screen in ball cam
    const ballLook = lookCar.clone().lerp(lookBall, 0.75);
    const look = lookCar.clone().lerp(ballLook, this.ballCamBlend);

    // keep camera inside the arena roughly
    desired.z = Math.max(desired.z, 30);
    desired.z = Math.min(desired.z, 2010);
    desired.x = Math.max(-4060, Math.min(4060, desired.x));
    if (Math.abs(desired.x) > 893) desired.y = Math.max(-5080, Math.min(5080, desired.y));
    else desired.y = Math.max(-5950, Math.min(5950, desired.y));

    const posK = 1 - Math.exp(-dt * 30);
    this.pos.lerp(desired, posK);
    this.look.lerp(look, 1 - Math.exp(-dt * 25));
    this.fovKick += ((supersonic ? 4 : 0) - this.fovKick) * Math.min(1, dt * 3);
    this._apply(dt, cs.angle);
  }

  /** Slow orbit around a point (menus). */
  updateOrbit(dt, center, radius = 5200, height = 1500) {
    this.orbitT += dt * 0.05;
    const a = this.orbitT;
    this.pos.set(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius * 0.9, height + Math.sin(a * 0.7) * 300);
    this.look.copy(center);
    this.up.set(0, 0, 1);
    this.fovKick = 0;
    this._apply(dt, 0, 75);
  }

  /** TV-style sideline camera that tracks the ball (menus, end of match). */
  updateBroadcast(dt, ballPos) {
    this.orbitT += dt * 0.04;
    const side = Math.sin(this.orbitT) > 0 ? 1 : -1;
    const desired = new THREE.Vector3(side * 3500, ballPos.y * 0.75, 1350);
    if (!this._bcInit) { this.pos.copy(desired); this._bcInit = true; }
    this.pos.lerp(desired, 1 - Math.exp(-dt * (Math.abs(this.pos.x - desired.x) > 3000 ? 0.6 : 1.5)));
    const look = new THREE.Vector3(ballPos.x * 0.5, ballPos.y, Math.min(ballPos.z, 600) * 0.5 + 60);
    this.look.lerp(look, 1 - Math.exp(-dt * 2.5));
    this.up.set(0, 0, 1);
    this.fovKick = 0;
    this._apply(dt, 0, 70);
  }

  /** Cinematic follow for replays: trails the ball from a dramatic angle. */
  updateCinematic(dt, ballPos, ballVel, focusCarPos) {
    const v = ballVel.clone(); v.z = 0;
    if (v.lengthSq() < 100) v.set(0, 1, 0);
    v.normalize();
    const side = new THREE.Vector3(-v.y, v.x, 0);
    const desired = ballPos.clone().addScaledVector(v, -900).addScaledVector(side, 500);
    desired.z = Math.max(250, ballPos.z + 260);
    desired.x = Math.max(-3900, Math.min(3900, desired.x));
    desired.y = Math.max(-4950, Math.min(4950, desired.y));
    this.pos.lerp(desired, 1 - Math.exp(-dt * 3));
    const look = focusCarPos ? ballPos.clone().lerp(focusCarPos, 0.25) : ballPos;
    this.look.lerp(look, 1 - Math.exp(-dt * 8));
    this.up.set(0, 0, 1);
    this._apply(dt, 0, 80);
  }

  /** Fixed camera looking at a point from a position. */
  setStatic(pos, look) { this.pos.copy(pos); this.look.copy(look); this.up.set(0, 0, 1); this._apply(0, 0, 80); }

  _apply(dt, angleDeg, fovOverride) {
    const cam = this.camera;
    toThree(this.pos.x, this.pos.y, this.pos.z, cam.position);
    const lookT = toThree(this.look.x, this.look.y, this.look.z, new THREE.Vector3());
    cam.up.set(this.up.x, this.up.z, -this.up.y);
    cam.lookAt(lookT);
    if (angleDeg) cam.rotateX(angleDeg * Math.PI / 180);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.02;
      cam.rotateX((Math.random() - 0.5) * s);
      cam.rotateY((Math.random() - 0.5) * s);
      this.shake = Math.max(0, this.shake - dt * 1.8);
    }
    const hfov = fovOverride || (this.settings.camera.fov + this.fovKick);
    this.renderer.setHorizontalFov(fovOverride ? fovOverride * Math.max(1, cam.aspect / 1.7) : hfov);
  }
}
