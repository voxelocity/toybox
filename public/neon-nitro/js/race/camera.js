// Chase camera: follows the direction of travel (so drifts show the car's
// angle), widens FOV with speed, shakes on impacts, and supports look-back,
// intro fly-bys and a finish orbit.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _t = new THREE.Vector3();

export class ChaseCam {
  constructor(camera) {
    this.cam = camera;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.yaw = 0;
    this.trauma = 0;
    this.fovBase = 70;
    this.mode = 'chase';
    this.orbitT = 0;
    this.first = true;
    this.dist = 6.3;
    this.height = 2.45;
  }

  shake(a) { this.trauma = Math.min(1, this.trauma + a); }

  snap() { this.first = true; }

  update(dt, v, opts = {}) {
    const cam = this.cam;
    if (this.mode === 'orbit') {
      this.orbitT += dt;
      const a = this.orbitT * 0.35;
      _v.set(v.pos.x + Math.cos(a) * 9, v.pos.y + 3.2, v.pos.z + Math.sin(a) * 9);
      cam.position.lerp(_v, Math.min(1, dt * 3));
      cam.lookAt(v.pos.x, v.pos.y + 1, v.pos.z);
      return;
    }
    // follow travel direction (physics yaw), smoothed
    let dy = v.yaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    if (this.first) { this.yaw = v.yaw; dy = 0; }
    this.yaw += dy * Math.min(1, dt * (v.drift.on ? 4.5 : 6));
    const back = opts.lookBack ? -1 : 1;
    const spd = Math.max(0, v.speed);
    const k = Math.min(1, spd / 50);
    const dist = (this.dist + k * 1.1 + (v.boostT > 0 ? 0.8 : 0)) * back;
    const fx = Math.cos(this.yaw), fz = -Math.sin(this.yaw);
    const h = this.height + k * 0.3;
    _v.set(v.pos.x - fx * dist, v.pos.y + h, v.pos.z - fz * dist);
    // keep the camera above the road surface it hovers over
    if (this.first) { this.pos.copy(_v); }
    else {
      const f = Math.min(1, dt * 11);
      this.pos.x += (_v.x - this.pos.x) * f;
      this.pos.z += (_v.z - this.pos.z) * f;
      this.pos.y += (_v.y - this.pos.y) * Math.min(1, dt * 5);
    }
    _t.set(v.pos.x + fx * 6 * back, v.pos.y + 1.2, v.pos.z + fz * 6 * back);
    if (this.first) this.look.copy(_t); else this.look.lerp(_t, Math.min(1, dt * 12));
    this.first = false;
    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const sh = this.trauma * this.trauma;
    const t = performance.now() * 0.001;
    cam.position.set(
      this.pos.x + Math.sin(t * 37.1) * sh * 0.35,
      this.pos.y + Math.sin(t * 41.7 + 1) * sh * 0.3,
      this.pos.z + Math.sin(t * 29.3 + 2) * sh * 0.35,
    );
    cam.lookAt(this.look);
    // FOV
    const fov = this.fovBase + k * 8 + (v.boostT > 0 ? 9 : 0) + (opts.fovKick || 0);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();
  }
}
