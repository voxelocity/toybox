// Comic-book effects: an inked particle system (smoke puffs with ink rims,
// four-point spark stars, flames, confetti, debris), shockwave rings and
// DOM onomatopoeia bursts ("SKRRT!", "KABOOM!") anchored to the world.
import * as THREE from 'three';

const MAX = 2400;
export const SHAPE = { PUFF: 0, STAR: 1, FLAME: 2, SQUARE: 3, RING: 4, DOT: 5 };

const VERT = /* glsl */`
attribute float aSize;
attribute vec4 aCol;
attribute float aShape;
attribute float aRot;
varying vec4 vCol;
varying float vShape;
varying float vRot;
uniform float uScale;
uniform float uMax;
void main() {
  vCol = aCol; vShape = aShape; vRot = aRot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSize * uScale / max(0.5, -mv.z), uMax);
  vCol.a *= smoothstep(2.0, 6.0, -mv.z);
}`;

const FRAG = /* glsl */`
varying vec4 vCol;
varying float vShape;
varying float vRot;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float r = length(p);
  int sh = int(vShape + 0.5);
  vec3 col = vCol.rgb;
  float a = vCol.a;
  vec3 ink = vec3(0.06, 0.02, 0.1);
  if (sh == 0) {            // puff with ink rim and a lit cap
    if (r > 1.0) discard;
    float rim = smoothstep(0.78, 0.86, r);
    float lit = smoothstep(0.2, -0.5, p.y + p.x * 0.3);
    col = mix(col * 0.8, col * 1.15, lit);
    col = mix(col, ink, rim);
  } else if (sh == 1) {     // four point star
    float d = abs(p.x) * abs(p.y) * 6.0 + r * 0.55;
    if (d > 0.6) discard;
    col = mix(col, vec3(1.0), smoothstep(0.35, 0.0, d));
  } else if (sh == 2) {     // flame blob, hot core
    if (r > 1.0) discard;
    col = mix(col, vec3(1.0, 0.98, 0.8), smoothstep(0.7, 0.0, r));
    a *= smoothstep(1.0, 0.6, r);
  } else if (sh == 3) {     // square debris / confetti
    if (max(abs(p.x), abs(p.y) * 1.6) > 0.8) discard;
    if (max(abs(p.x), abs(p.y) * 1.6) > 0.66) col = ink;
  } else if (sh == 4) {     // ring
    if (r > 1.0 || r < 0.72) discard;
    if (r > 0.92) col = ink;
  } else {                  // soft dot (sparkles, glows)
    if (r > 1.0) discard;
    a *= smoothstep(1.0, 0.0, r);
  }
  gl_FragColor = vec4(col, a);
}`;

export class FX {
  constructor(scene, view) {
    this.scene = scene;
    this.view = view;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 4);
    this.size = new Float32Array(MAX);
    this.shape = new Float32Array(MAX);
    this.rot = new Float32Array(MAX);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aShape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geom = g;
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uScale: { value: 300 }, uMax: { value: 200 } }, transparent: true, depthWrite: false });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    // additive layer for glows / flames
    this.addMat = this.mat.clone();
    this.addMat.blending = THREE.AdditiveBlending;
    this.p = [];
    this.pa = [];
    this.rings = [];
    this.layer = document.getElementById('fx-layer');
    this.popups = [];
    this.tmp = new THREE.Vector3();
  }

  /** Spawn a particle. o: {x,y,z, vx,vy,vz, life, size, grow, color:[r,g,b], alpha, shape, drag, grav, spin} */
  spawn(o) {
    if (this.p.length >= MAX) this.p.shift();
    this.p.push({
      x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: o.life || 1, t: 0,
      size: o.size || 1, grow: o.grow ?? 0, c: o.color || [1, 1, 1], a: o.alpha ?? 1, shape: o.shape ?? 0,
      drag: o.drag ?? 1.5, grav: o.grav ?? 0, rot: o.rot ?? Math.random() * 6.28, spin: o.spin ?? 0, fade: o.fade ?? 0.6,
    });
  }

  burst(x, y, z, n, o) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * Math.PI * 0.6;
      const sp = (o.speed ?? 8) * (0.4 + Math.random() * 0.8);
      this.spawn({ ...o, x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + (o.up ?? 2), vz: Math.sin(a) * Math.cos(e) * sp, rot: Math.random() * 6 });
    }
  }

  explosion(x, y, z, scale = 1, color = [1, 0.55, 0.15]) {
    for (let i = 0; i < 14 * scale; i++) this.spawn({ x, y: y + 0.5, z, vx: (Math.random() - 0.5) * 14 * scale, vy: 3 + Math.random() * 9 * scale, vz: (Math.random() - 0.5) * 14 * scale, life: 0.8 + Math.random() * 0.6, size: 3 + Math.random() * 3 * scale, grow: 2.5, color: i % 3 ? color : [1, 0.9, 0.3], shape: SHAPE.PUFF, drag: 2.5, grav: -2 });
    for (let i = 0; i < 10 * scale; i++) this.spawn({ x, y: y + 1, z, vx: (Math.random() - 0.5) * 22, vy: 5 + Math.random() * 12, vz: (Math.random() - 0.5) * 22, life: 0.5 + Math.random() * 0.4, size: 1.2 + Math.random(), color: [1, 1, 0.6], shape: SHAPE.STAR, drag: 1, grav: 18, spin: 8 });
    this.ring(x, y + 0.3, z, 7 * scale, [1, 0.9, 0.4]);
    for (let i = 0; i < 6; i++) this.spawn({ x, y: y + 1, z, vx: (Math.random() - 0.5) * 6, vy: 6 + Math.random() * 4, vz: (Math.random() - 0.5) * 6, life: 1.6, size: 4 + Math.random() * 2, grow: 1.5, color: [0.25, 0.2, 0.3], shape: SHAPE.PUFF, drag: 1.8, grav: -1.5 });
  }

  ring(x, y, z, r, color) {
    const geo = new THREE.RingGeometry(0.8, 1, 32);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...color), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    this.scene.add(m);
    this.rings.push({ m, t: 0, life: 0.45, r });
  }

  /** Comic onomatopoeia. world: Vector3 or null for screen-centre style. */
  pop(text, o = {}) {
    if (!this.layer) return;
    const el = document.createElement('div');
    el.className = 'pop ' + (o.cls || '');
    el.innerHTML = `<span>${text}</span>`;
    el.style.setProperty('--rot', ((o.rot ?? (Math.random() - 0.5) * 16)) + 'deg');
    if (o.color) el.style.setProperty('--c', o.color);
    if (o.size) el.style.setProperty('--s', o.size);
    this.layer.appendChild(el);
    const rec = { el, world: o.world ? o.world.clone() : null, t: 0, life: o.life ?? 0.9, x: o.x ?? 50, y: o.y ?? 38 };
    if (!rec.world) { el.style.left = rec.x + '%'; el.style.top = rec.y + '%'; }
    this.popups.push(rec);
    while (this.popups.length > 10) { const r = this.popups.shift(); r.el.remove(); }
  }

  update(dt, camera) {
    const P = this.p;
    let n = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      q.t += dt;
      if (q.t >= q.life) continue;
      const dr = Math.exp(-q.drag * dt);
      q.vx *= dr; q.vy = q.vy * dr - q.grav * dt; q.vz *= dr;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.rot += q.spin * dt;
      P[n++] = q;
    }
    P.length = n;
    const k = Math.min(n, MAX);
    for (let i = 0; i < k; i++) {
      const q = P[i];
      const f = q.t / q.life;
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      this.col[i * 4] = q.c[0]; this.col[i * 4 + 1] = q.c[1]; this.col[i * 4 + 2] = q.c[2];
      this.col[i * 4 + 3] = q.a * (f < q.fade ? 1 : 1 - (f - q.fade) / (1 - q.fade));
      this.size[i] = q.size * (1 + q.grow * f);
      this.shape[i] = q.shape;
      this.rot[i] = q.rot;
    }
    const g = this.geom;
    g.setDrawRange(0, k);
    for (const a of ['position', 'aCol', 'aSize', 'aShape', 'aRot']) {
      const at = g.attributes[a];
      at.clearUpdateRanges();
      at.addUpdateRange(0, Math.max(1, k) * at.itemSize);
      at.needsUpdate = true;
    }
    // point scale ~ viewport height / tan(fov/2)
    const h = this.view.renderer.domElement.height;
    this.mat.uniforms.uScale.value = h / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 0.5;
    this.mat.uniforms.uMax.value = h * 0.16;
    // rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const f = r.t / r.life;
      r.m.scale.setScalar(0.5 + f * r.r);
      r.m.material.opacity = 0.9 * (1 - f);
      if (f >= 1) { this.scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); this.rings.splice(i, 1); }
    }
    // popups
    const W = this.view.cssW, H = this.view.cssH;
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const r = this.popups[i];
      r.t += dt;
      if (r.world) {
        this.tmp.copy(r.world).project(camera);
        if (this.tmp.z > 1) r.el.style.display = 'none';
        else { r.el.style.display = ''; r.el.style.left = ((this.tmp.x * 0.5 + 0.5) * W) + 'px'; r.el.style.top = ((-this.tmp.y * 0.5 + 0.5) * H) + 'px'; }
      }
      if (r.t > r.life) { r.el.remove(); this.popups.splice(i, 1); }
    }
  }

  clear() {
    this.p.length = 0;
    for (const r of this.rings) { this.scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); }
    this.rings.length = 0;
    for (const r of this.popups) r.el.remove();
    this.popups.length = 0;
  }

  dispose() {
    this.clear();
    this.scene.remove(this.points);
    this.geom.dispose(); this.mat.dispose(); this.addMat.dispose();
  }
}
