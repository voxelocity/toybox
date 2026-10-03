// High level effects driven by simulation events: hits, bounces, explosions,
// pickups, landings, sonic booms. Uses two particle pools (additive + alpha),
// pooled shockwave meshes and pooled point lights.
//
// Nothing here may change a shader program key at runtime: three.js builds a
// program per (material, light count, shadow state, ...) and compiles it
// synchronously the first time it is drawn, which costs hundreds of ms per
// lit material on Windows (ANGLE -> D3D) and stalls the whole game. So every
// object an effect needs is created up front, stays in the scene, and idles
// invisibly: lights at intensity 0 (a hidden light changes the light count of
// every lit material), shock meshes hidden, and no material is ever created or
// disposed while playing.
import * as THREE from 'three';
import { ParticleSystem, Ribbon } from './particles.js';
import { S } from './convert.js';

export const TEAM_RGB = [[0.25, 0.55, 1.0], [1.0, 0.5, 0.12]];
const WHITE = [1, 1, 1], PUFF = [0.6, 0.6, 0.55], SPARK = [1, 0.8, 0.4], PAD = [1, 0.6, 0.15], DEMO = [1, 0.55, 0.15];
const rand = (a, b) => a + Math.random() * (b - a);
const SHOCKS = 12; // concurrent shockwaves (a pile-up needs ~8)

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
    this.time = 0;
    this.shockGeo = new THREE.SphereGeometry(1, 32, 16);
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 64);
    this.shocks = [];
    for (let i = 0; i < SHOCKS; i++) {
      const m = new THREE.Mesh(this.shockGeo, shockMaterial());
      m.visible = false;
      m.renderOrder = 25;
      scene.add(m);
      this.shocks.push({ m, t: 0, dur: 0, maxScale: 0, live: false });
    }
    // Explosion light (and the local car's boost glow), both only with real
    // lighting (medium and up): always visible, dark when idle.
    this.lights = [];
    if (quality.shadowSize > 0) {
      const l = new THREE.PointLight(0xffffff, 0, 30, 2);
      scene.add(l);
      this.lights.push({ light: l, t: 0, dur: 0, peak: 0 });
      this.boostLight = new THREE.PointLight(0xffffff, 0, 9, 2);
      scene.add(this.boostLight);
    } else this.boostLight = null;
  }

  n(count) { return Math.max(1, Math.round(count * this.budget)); }

  /** Takes the light whose flash is dimmest now, if the new flash is brighter. */
  flashLight(pos, color, peak, dur, range = 30) {
    let L = null, low = Infinity;
    for (const l of this.lights) {
      const k = l.t >= l.dur ? 0 : 1 - l.t / l.dur, now = l.peak * k * k;
      if (now < low) { low = now; L = l; }
    }
    if (!L || low > peak) return;
    L.light.position.copy(pos);
    L.light.color.setRGB(color[0], color[1], color[2]);
    L.light.distance = range;
    L.light.intensity = peak;
    L.t = 0; L.dur = dur; L.peak = peak;
  }

  shockwave(x, y, z, color, maxScale, dur, ring = false) {
    let s = this.shocks[0];
    for (const c of this.shocks) {
      if (!c.live) { s = c; break; }
      if (c.t / c.dur > s.t / s.dur) s = c; // all busy: recycle the most faded one
    }
    const m = s.m;
    m.geometry = ring ? this.ringGeo : this.shockGeo;
    m.rotation.set(ring ? -Math.PI / 2 : 0, 0, 0);
    m.position.set(x, y, z);
    m.scale.setScalar(0.2);
    m.material.uniforms.uColor.value.setRGB(color[0], color[1], color[2]);
    m.material.uniforms.uAlpha.value = 1;
    m.visible = true;
    s.t = 0; s.dur = dur; s.maxScale = maxScale; s.live = true;
  }

  // ---- events -------------------------------------------------------------
  ballHit(p, normal, dv, team) {
    const c = TEAM_RGB[team] || WHITE, A = this.add;
    const strength = Math.min(1, dv / 3000);
    const n = this.n(6 + strength * 40);
    for (let i = 0; i < n; i++) {
      const sp = rand(2, 14) * (0.4 + strength);
      const dx = normal.x + rand(-0.8, 0.8), dy = normal.y + rand(-0.8, 0.8), dz = normal.z + rand(-0.8, 0.8);
      A.color(A.spawn(p.x, p.y, p.z, dx * sp, dy * sp, dz * sp, rand(0.2, 0.5), rand(0.05, 0.09), 0.02, 2.5, 6, 2), 1, 0.95, 0.8, 1, c[0], c[1], c[2], 0.8);
    }
    A.color(A.spawn(p.x, p.y, p.z, 0, 0, 0, 0.18, 0.6 + strength * 2.2, 1.5 + strength * 3, 0, 0, 7), 1, 1, 1, 0.9, c[0], c[1], c[2], 0);
    if (dv > 1300) {
      this.shockwave(p.x, p.y, p.z, c, 2.5 + strength * 4, 0.35);
      this.flashLight(p, c, 25 * strength, 0.25, 15);
    }
  }

  ballBounce(p, normal, speed) {
    if (speed < 450) return;
    const floor = normal.y > 0.7, A = this.add, B = this.alpha;
    const n = this.n(Math.min(30, speed / 60));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(1, 4) * speed / 1500;
      if (floor) {
        B.color(B.spawn(p.x, p.y + 0.05, p.z, Math.cos(a) * sp * 2, rand(0.5, 2.5), Math.sin(a) * sp * 2, rand(0.4, 0.9), 0.08, 0.05, 1.5, 9.8, 5, rand(-8, 8)),
          0.15, 0.32, 0.08, 1, 0.2, 0.3, 0.1, 0.8);
      } else {
        A.color(A.spawn(p.x, p.y, p.z, Math.cos(a) * sp + normal.x * 3, Math.sin(a) * sp + normal.y * 3, normal.z * 3 + rand(-2, 2), rand(0.2, 0.4), 0.06, 0.02, 3, 5, 2),
          0.8, 0.9, 1, 1, 0.4, 0.6, 1, 0);
      }
    }
    if (floor && speed > 900) {
      for (let i = 0, m = this.n(6); i < m; i++) {
        const a = Math.random() * Math.PI * 2;
        B.color(B.spawn(p.x, p.y + 0.1, p.z, Math.cos(a) * 2, rand(0.2, 0.8), Math.sin(a) * 2, rand(0.6, 1.1), 0.4, 1.4, 2, 0, 1),
          0.55, 0.55, 0.5, 0.25, 0.6, 0.6, 0.55, 0);
      }
    }
  }

  explosion(p, color, big) {
    const k = big ? 1 : 0.45, sk = big ? 1 : 0.6;
    const c = color, A = this.add, B = this.alpha;
    this.flashLight(p, [c[0] * 0.8 + 0.2, c[1] * 0.8 + 0.2, c[2] * 0.8 + 0.2], big ? 400 : 120, big ? 0.9 : 0.5, big ? 70 : 30);
    this.shockwave(p.x, p.y, p.z, c, big ? 26 : 9, big ? 0.75 : 0.45);
    this.shockwave(p.x, 0.15, p.z, c, big ? 34 : 12, big ? 1.1 : 0.6, true);
    // fireballs
    for (let i = 0, n = this.n(140 * k); i < n; i++) {
      const dx = rand(-1, 1), dy = rand(-0.4, 1), dz = rand(-1, 1), sp = rand(4, 22) * sk / (Math.hypot(dx, dy, dz) || 1);
      A.color(A.spawn(p.x, p.y, p.z, dx * sp, dy * sp, dz * sp, rand(0.5, 1.3), rand(0.8, 1.6) * k + 0.4, rand(2.0, 3.6) * k + 0.6, 2.2, -1.2, Math.random() < 0.5 ? 4 : 0, rand(-2, 2)),
        1, 0.95, 0.85, 1, c[0] * 0.7, c[1] * 0.5, c[2] * 0.5, 0);
    }
    // sparks
    for (let i = 0, n = this.n(180 * k); i < n; i++) {
      const dx = rand(-1, 1), dy = rand(-0.2, 1.2), dz = rand(-1, 1), sp = rand(14, 42) * sk / (Math.hypot(dx, dy, dz) || 1);
      A.color(A.spawn(p.x, p.y, p.z, dx * sp, dy * sp, dz * sp, rand(0.7, 1.8), rand(0.08, 0.14), 0.03, 1.2, 9.8, 2), 1, 1, 0.9, 1, c[0], c[1], c[2], 1);
    }
    // smoke
    for (let i = 0, n = this.n(70 * k); i < n; i++) {
      const dx = rand(-1, 1), dy = rand(0, 1), dz = rand(-1, 1), sp = rand(2, 9) * sk / (Math.hypot(dx, dy, dz) || 1);
      B.color(B.spawn(p.x, p.y, p.z, dx * sp, dy * sp, dz * sp, rand(1.8, 3.4), rand(1.2, 2.2) * k + 0.5, rand(4, 7) * k + 1, 1.6, -0.6, 1, rand(-0.5, 0.5)),
        0.25, 0.24, 0.24, 0.55, 0.45, 0.45, 0.45, 0);
    }
    // debris
    for (let i = 0, n = this.n(50 * k); i < n; i++) {
      const dx = rand(-1, 1), dy = rand(0.3, 1.5), dz = rand(-1, 1), sp = rand(6, 20) * (big ? 1 : 0.7) / (Math.hypot(dx, dy, dz) || 1);
      const shade = rand(0.08, 0.2);
      B.color(B.spawn(p.x, p.y, p.z, dx * sp, dy * sp, dz * sp, rand(1.5, 2.8), rand(0.1, 0.28), 0.12, 0.4, 12, 3, rand(-12, 12)),
        shade, shade, shade * 1.1, 1, shade, shade, shade, 1);
    }
  }

  goalExplosion(p, team) {
    const c = TEAM_RGB[team] || WHITE, B = this.alpha;
    this.explosion(p, c, true);
    // confetti shower
    for (let i = 0, n = this.n(260); i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(0, 1);
      const col = Math.random() < 0.6 ? c : WHITE;
      B.color(B.spawn(p.x + Math.cos(a) * r * 6, p.y + rand(4, 14), p.z + Math.sin(a) * r * 6, rand(-3, 3), rand(2, 9), rand(-3, 3), rand(2.5, 4.5), 0.12, 0.12, 1.8, 3.5, 3, rand(-15, 15)),
        col[0], col[1], col[2], 1, col[0], col[1], col[2], 1);
    }
    this.renderer.doFlash(c, 0.55);
  }

  demolition(p, team) {
    this.explosion(p, DEMO, false);
    const c = TEAM_RGB[team] || WHITE, B = this.alpha;
    for (let i = 0, n = this.n(30); i < n; i++) {
      const dx = rand(-1, 1), dy = rand(0.2, 1.4), dz = rand(-1, 1), sp = rand(5, 14) / (Math.hypot(dx, dy, dz) || 1);
      B.color(B.spawn(p.x, p.y, p.z, dx * sp, dy * sp, dz * sp, rand(1.2, 2.2), rand(0.1, 0.25), 0.1, 0.4, 12, 3, rand(-12, 12)),
        c[0] * 0.8, c[1] * 0.8, c[2] * 0.8, 1, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 1);
    }
  }

  padPickup(p, big) {
    const A = this.add;
    for (let i = 0, n = this.n(big ? 60 : 14); i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = big ? rand(2, 7) : rand(1, 3);
      A.color(A.spawn(p.x, p.y + (big ? 1 : 0.15), p.z, Math.cos(a) * sp, rand(1, big ? 7 : 3), Math.sin(a) * sp, rand(0.3, 0.7), big ? 0.25 : 0.12, 0.02, 3, 2, big ? 0 : 2),
        1, 0.85, 0.35, 1, 1, 0.45, 0.05, 0);
    }
    if (big) this.shockwave(p.x, p.y + 1, p.z, PAD, 3, 0.35);
  }

  puff(p, count, color = PUFF, up = 0.6) {
    const B = this.alpha;
    for (let i = 0, n = this.n(count); i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(0.5, 2.5);
      B.color(B.spawn(p.x, p.y, p.z, Math.cos(a) * sp, rand(0.1, up), Math.sin(a) * sp, rand(0.4, 0.9), 0.25, rand(0.7, 1.3), 2.5, 0, 1, rand(-1, 1)),
        color[0], color[1], color[2], 0.28, color[0], color[1], color[2], 0);
    }
  }

  grassSpray(p, dir, amount) {
    const B = this.alpha;
    for (let i = 0, n = this.n(amount); i < n; i++) {
      B.color(B.spawn(p.x + rand(-0.1, 0.1), p.y + 0.05, p.z + rand(-0.1, 0.1), dir.x * rand(1, 4) + rand(-1, 1), rand(1, 3.5), dir.z * rand(1, 4) + rand(-1, 1),
        rand(0.4, 0.8), rand(0.05, 0.08), 0.04, 1.2, 9.8, 5, rand(-10, 10)), 0.12, 0.3, 0.06, 1, 0.18, 0.28, 0.08, 0.9);
    }
  }

  sparks(p, n, color = SPARK) {
    const A = this.add;
    for (let i = 0, m = this.n(n); i < m; i++) {
      const dx = rand(-1, 1), dy = rand(-0.2, 1), dz = rand(-1, 1), sp = rand(3, 10) / (Math.hypot(dx, dy, dz) || 1);
      A.color(A.spawn(p.x, p.y, p.z, dx * sp, dy * sp, dz * sp, rand(0.2, 0.5), 0.07, 0.02, 2, 9.8, 2), 1, 1, 0.9, 1, color[0], color[1], color[2], 0);
    }
  }

  sonicBoom(p, color) {
    this.shockwave(p.x, p.y, p.z, color, 3.2, 0.3);
  }

  /** The local car's boost glow (world position, metres). */
  setBoostLight(x, y, z, color, intensity) {
    const l = this.boostLight;
    if (!l) return;
    l.position.set(x, y, z);
    l.color.setHex(color);
    l.intensity = intensity;
  }

  update(dt) {
    this.time += dt;
    this.add.update(dt);
    this.alpha.update(dt);
    for (const s of this.shocks) {
      if (!s.live) continue;
      s.t += dt;
      const t = s.t / s.dur;
      if (t >= 1) { s.live = false; s.m.visible = false; continue; }
      const e = 1 - Math.pow(1 - t, 3);
      s.m.scale.setScalar(0.2 + e * s.maxScale);
      s.m.material.uniforms.uAlpha.value = (1 - t) * (1 - t);
    }
    for (const L of this.lights) {
      if (L.t >= L.dur) { L.light.intensity = 0; continue; }
      L.t += dt;
      const t = Math.min(1, L.t / L.dur);
      L.light.intensity = L.peak * (1 - t) * (1 - t);
    }
  }

  /**
   * Shows one of everything (each particle sprite, both shock shapes, lit
   * lights) so a warm-up frame draws every effect variant once; the
   * returned function puts everything back.
   */
  prime(at) {
    for (let type = 0; type < 8; type++) {
      this.add.color(this.add.spawn(at.x, at.y, at.z, 0, 0, 0, 1, 0.5, 0.5, 0, 0, type), 1, 1, 1, 1, 1, 1, 1, 1);
      this.alpha.color(this.alpha.spawn(at.x, at.y, at.z, 0, 0, 0, 1, 0.5, 0.5, 0, 0, type), 1, 1, 1, 1, 1, 1, 1, 1);
    }
    this.add.update(0); this.alpha.update(0);
    this.shockwave(at.x, at.y, at.z, WHITE, 1, 1);
    this.shockwave(at.x, at.y, at.z, WHITE, 1, 1, true);
    for (const s of this.shocks) s.m.frustumCulled = false;
    for (const L of this.lights) L.light.intensity = 1;
    if (this.boostLight) this.boostLight.intensity = 1;
    return () => {
      for (const s of this.shocks) s.m.frustumCulled = true;
      if (this.boostLight) this.boostLight.intensity = 0;
      this.clear();
    };
  }

  clear() {
    this.add.clear(); this.alpha.clear();
    for (const s of this.shocks) { s.live = false; s.m.visible = false; }
    for (const L of this.lights) { L.t = L.dur = 0; L.light.intensity = 0; }
  }
}

export { Ribbon, S };
