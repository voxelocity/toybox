// High level effects driven by simulation events: hits, bounces, explosions,
// pickups, landings, sonic booms. Uses two particle pools (additive + alpha),
// expanding shockwave meshes and short-lived point lights.
import * as THREE from 'three';
import { ParticleSystem, Ribbon } from './particles.js';
import { S } from './convert.js';

export const TEAM_RGB = [[0.25, 0.55, 1.0], [1.0, 0.5, 0.12]];
const rand = (a, b) => a + Math.random() * (b - a);

function shockMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vV;
      void main(){ float f = 1.0 - abs(dot(vN, vV)); f = pow(f, 2.5); gl_FragColor = vec4(uColor * f * uAlpha * 3.0, 1.0); }`,
    toneMapped: false,
  });
}

export class Effects {
  constructor(scene, quality, renderer) {
    this.scene = scene;
    this.q = quality;
    this.renderer = renderer;
    const scale = quality.particles;
    this.add = new ParticleSystem(scene, Math.round(4000 * scale) + 200, 'add');
    this.alpha = new ParticleSystem(scene, Math.round(2500 * scale) + 150, 'alpha');
    this.budget = scale;
    this.shocks = [];
    this.lights = [];
    this.shockGeo = new THREE.SphereGeometry(1, 32, 16);
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 64);
    this.time = 0;
    // pooled flash lights
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 30, 2);
      l.visible = false;
      scene.add(l);
      this.lights.push({ light: l, t: 0, dur: 0, peak: 0 });
    }
  }

  n(count) { return Math.max(1, Math.round(count * this.budget)); }

  flashLight(pos, color, peak, dur, range = 30) {
    const L = this.lights.find((l) => l.t >= l.dur) || this.lights[0];
    L.light.position.copy(pos);
    L.light.color.setRGB(color[0], color[1], color[2]);
    L.light.distance = range;
    L.t = 0; L.dur = dur; L.peak = peak;
    L.light.visible = true;
  }

  shockwave(pos, color, maxScale, dur, ring = false) {
    const mat = shockMaterial();
    mat.uniforms.uColor.value.setRGB(color[0], color[1], color[2]);
    const m = new THREE.Mesh(ring ? this.ringGeo : this.shockGeo, mat);
    m.position.copy(pos);
    if (ring) m.rotation.x = -Math.PI / 2;
    m.renderOrder = 25;
    this.scene.add(m);
    this.shocks.push({ m, t: 0, dur, maxScale });
  }

  // ---- events -------------------------------------------------------------
  ballHit(p, normal, dv, team) {
    const c = TEAM_RGB[team] || [1, 1, 1];
    const strength = Math.min(1, dv / 3000);
    const n = this.n(6 + strength * 40);
    for (let i = 0; i < n; i++) {
      const sp = rand(2, 14) * (0.4 + strength);
      const dx = normal.x + rand(-0.8, 0.8), dy = normal.y + rand(-0.8, 0.8), dz = normal.z + rand(-0.8, 0.8);
      this.add.emit({ x: p.x, y: p.y, z: p.z, vx: dx * sp, vy: dy * sp, vz: dz * sp, life: rand(0.2, 0.5), size0: rand(0.05, 0.09), size1: 0.02,
        c0: [1, 0.95, 0.8, 1], c1: [c[0], c[1], c[2], 0.8], drag: 2.5, gravity: 6, type: 2 });
    }
    this.add.emit({ x: p.x, y: p.y, z: p.z, life: 0.18, size0: 0.6 + strength * 2.2, size1: 1.5 + strength * 3, c0: [1, 1, 1, 0.9], c1: [c[0], c[1], c[2], 0], type: 7 });
    if (dv > 1300) {
      this.shockwave(p, c, 2.5 + strength * 4, 0.35);
      this.flashLight(p, c, 25 * strength, 0.25, 15);
    }
  }

  ballBounce(p, normal, speed) {
    if (speed < 450) return;
    const floor = normal.y > 0.7;
    const n = this.n(Math.min(30, speed / 60));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(1, 4) * speed / 1500;
      if (floor) {
        this.alpha.emit({ x: p.x, y: p.y + 0.05, z: p.z, vx: Math.cos(a) * sp * 2, vy: rand(0.5, 2.5), vz: Math.sin(a) * sp * 2, life: rand(0.4, 0.9), size0: 0.08, size1: 0.05,
          c0: [0.15, 0.32, 0.08, 1], c1: [0.2, 0.3, 0.1, 0.8], drag: 1.5, gravity: 9.8, type: 5, spin: rand(-8, 8) });
      } else {
        this.add.emit({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * sp + normal.x * 3, vy: Math.sin(a) * sp + normal.y * 3, vz: normal.z * 3 + rand(-2, 2), life: rand(0.2, 0.4), size0: 0.06, size1: 0.02,
          c0: [0.8, 0.9, 1, 1], c1: [0.4, 0.6, 1, 0], drag: 3, gravity: 5, type: 2 });
      }
    }
    if (floor && speed > 900) {
      for (let i = 0; i < this.n(6); i++) {
        const a = Math.random() * Math.PI * 2;
        this.alpha.emit({ x: p.x, y: p.y + 0.1, z: p.z, vx: Math.cos(a) * 2, vy: rand(0.2, 0.8), vz: Math.sin(a) * 2, life: rand(0.6, 1.1), size0: 0.4, size1: 1.4,
          c0: [0.55, 0.55, 0.5, 0.25], c1: [0.6, 0.6, 0.55, 0], drag: 2, type: 1 });
      }
    }
  }

  explosion(p, color, big) {
    const k = big ? 1 : 0.45;
    const c = color;
    this.flashLight(p, [c[0] * 0.8 + 0.2, c[1] * 0.8 + 0.2, c[2] * 0.8 + 0.2], big ? 400 : 120, big ? 0.9 : 0.5, big ? 70 : 30);
    this.shockwave(p, c, big ? 26 : 9, big ? 0.75 : 0.45);
    this.shockwave(new THREE.Vector3(p.x, 0.15, p.z), c, big ? 34 : 12, big ? 1.1 : 0.6, true);
    // fireballs
    for (let i = 0; i < this.n(140 * k); i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize();
      const sp = rand(4, 22) * (big ? 1 : 0.6);
      this.add.emit({ x: p.x, y: p.y, z: p.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, life: rand(0.5, 1.3), size0: rand(0.8, 1.6) * k + 0.4, size1: rand(2.0, 3.6) * k + 0.6,
        c0: [1, 0.95, 0.85, 1], c1: [c[0] * 0.7, c[1] * 0.5, c[2] * 0.5, 0], drag: 2.2, gravity: -1.2, type: Math.random() < 0.5 ? 4 : 0, spin: rand(-2, 2) });
    }
    // sparks
    for (let i = 0; i < this.n(180 * k); i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1.2), rand(-1, 1)).normalize();
      const sp = rand(14, 42) * (big ? 1 : 0.6);
      this.add.emit({ x: p.x, y: p.y, z: p.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, life: rand(0.7, 1.8), size0: rand(0.08, 0.14), size1: 0.03,
        c0: [1, 1, 0.9, 1], c1: [c[0], c[1], c[2], 1], drag: 1.2, gravity: 9.8, type: 2 });
    }
    // smoke
    for (let i = 0; i < this.n(70 * k); i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize();
      const sp = rand(2, 9) * (big ? 1 : 0.6);
      this.alpha.emit({ x: p.x, y: p.y, z: p.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, life: rand(1.8, 3.4), size0: rand(1.2, 2.2) * k + 0.5, size1: rand(4, 7) * k + 1,
        c0: [0.25, 0.24, 0.24, 0.55], c1: [0.45, 0.45, 0.45, 0], drag: 1.6, gravity: -0.6, type: 1, spin: rand(-0.5, 0.5) });
    }
    // debris
    for (let i = 0; i < this.n(50 * k); i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(0.3, 1.5), rand(-1, 1)).normalize();
      const sp = rand(6, 20) * (big ? 1 : 0.7);
      const shade = rand(0.08, 0.2);
      this.alpha.emit({ x: p.x, y: p.y, z: p.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, life: rand(1.5, 2.8), size0: rand(0.1, 0.28), size1: 0.12,
        c0: [shade, shade, shade * 1.1, 1], c1: [shade, shade, shade, 1], drag: 0.4, gravity: 12, type: 3, spin: rand(-12, 12) });
    }
  }

  goalExplosion(p, team) {
    const c = TEAM_RGB[team];
    this.explosion(p, c, true);
    // confetti shower
    for (let i = 0; i < this.n(260); i++) {
      const a = Math.random() * Math.PI * 2, r = rand(0, 1);
      const col = Math.random() < 0.6 ? c : [1, 1, 1];
      this.alpha.emit({ x: p.x + Math.cos(a) * r * 6, y: p.y + rand(4, 14), z: p.z + Math.sin(a) * r * 6, vx: rand(-3, 3), vy: rand(2, 9), vz: rand(-3, 3),
        life: rand(2.5, 4.5), size0: 0.12, size1: 0.12, c0: [col[0], col[1], col[2], 1], c1: [col[0], col[1], col[2], 1], drag: 1.8, gravity: 3.5, type: 3, spin: rand(-15, 15) });
    }
    this.renderer.doFlash(new THREE.Color(c[0], c[1], c[2]), 0.55);
  }

  demolition(p, team) {
    this.explosion(p, [1, 0.55, 0.15], false);
    const c = TEAM_RGB[team];
    for (let i = 0; i < this.n(30); i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).normalize(), sp = rand(5, 14);
      this.alpha.emit({ x: p.x, y: p.y, z: p.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, life: rand(1.2, 2.2), size0: rand(0.1, 0.25), size1: 0.1,
        c0: [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8, 1], c1: [c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 1], drag: 0.4, gravity: 12, type: 3, spin: rand(-12, 12) });
    }
  }

  padPickup(p, big) {
    const n = this.n(big ? 60 : 14);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = big ? rand(2, 7) : rand(1, 3);
      this.add.emit({ x: p.x, y: p.y + (big ? 1 : 0.15), z: p.z, vx: Math.cos(a) * sp, vy: rand(1, big ? 7 : 3), vz: Math.sin(a) * sp, life: rand(0.3, 0.7), size0: big ? 0.25 : 0.12, size1: 0.02,
        c0: [1, 0.85, 0.35, 1], c1: [1, 0.45, 0.05, 0], drag: 3, gravity: 2, type: big ? 0 : 2 });
    }
    if (big) this.shockwave(new THREE.Vector3(p.x, p.y + 1, p.z), [1, 0.6, 0.15], 3, 0.35);
  }

  puff(p, count, color = [0.6, 0.6, 0.55], up = 0.6) {
    for (let i = 0; i < this.n(count); i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(0.5, 2.5);
      this.alpha.emit({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * sp, vy: rand(0.1, up), vz: Math.sin(a) * sp, life: rand(0.4, 0.9), size0: 0.25, size1: rand(0.7, 1.3),
        c0: [color[0], color[1], color[2], 0.28], c1: [color[0], color[1], color[2], 0], drag: 2.5, type: 1, spin: rand(-1, 1) });
    }
  }

  grassSpray(p, dir, amount) {
    for (let i = 0; i < this.n(amount); i++) {
      this.alpha.emit({ x: p.x + rand(-0.1, 0.1), y: p.y + 0.05, z: p.z + rand(-0.1, 0.1),
        vx: dir.x * rand(1, 4) + rand(-1, 1), vy: rand(1, 3.5), vz: dir.z * rand(1, 4) + rand(-1, 1), life: rand(0.4, 0.8), size0: rand(0.05, 0.08), size1: 0.04,
        c0: [0.12, 0.3, 0.06, 1], c1: [0.18, 0.28, 0.08, 0.9], drag: 1.2, gravity: 9.8, type: 5, spin: rand(-10, 10) });
    }
  }

  sparks(p, n, color = [1, 0.8, 0.4]) {
    for (let i = 0; i < this.n(n); i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize(), sp = rand(3, 10);
      this.add.emit({ x: p.x, y: p.y, z: p.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, life: rand(0.2, 0.5), size0: 0.07, size1: 0.02,
        c0: [1, 1, 0.9, 1], c1: [color[0], color[1], color[2], 0], drag: 2, gravity: 9.8, type: 2 });
    }
  }

  sonicBoom(p, color) {
    this.shockwave(p, color, 3.2, 0.3);
  }

  update(dt) {
    this.time += dt;
    this.add.update(dt);
    this.alpha.update(dt);
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      s.t += dt;
      const t = s.t / s.dur;
      if (t >= 1) { this.scene.remove(s.m); s.m.material.dispose(); this.shocks.splice(i, 1); continue; }
      const e = 1 - Math.pow(1 - t, 3);
      s.m.scale.setScalar(0.2 + e * s.maxScale);
      s.m.material.uniforms.uAlpha.value = (1 - t) * (1 - t);
    }
    for (const L of this.lights) {
      if (L.t >= L.dur) { L.light.visible = false; continue; }
      L.t += dt;
      const t = Math.min(1, L.t / L.dur);
      L.light.intensity = L.peak * (1 - t) * (1 - t);
    }
  }

  clear() {
    this.add.clear(); this.alpha.clear();
    for (const s of this.shocks) this.scene.remove(s.m);
    this.shocks.length = 0;
  }
}

export { Ribbon, S };
