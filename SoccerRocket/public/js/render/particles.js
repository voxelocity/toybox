// Instanced billboard particle system. CPU simulates, GPU draws one
// instanced quad per live particle. Sprites come from a small procedural
// atlas: 0 glow, 1 smoke, 2 spark (stretched along velocity), 3 debris,
// 4 flame wisp, 5 grass blade.
import * as THREE from 'three';

function makeAtlas() {
  const N = 8, R = 64;
  const c = document.createElement('canvas');
  c.width = N * R; c.height = R;
  const g = c.getContext('2d');
  const rad = (x, stops) => {
    const gr = g.createRadialGradient(x + R / 2, R / 2, 0, x + R / 2, R / 2, R / 2);
    for (const [o, a] of stops) gr.addColorStop(o, `rgba(255,255,255,${a})`);
    g.fillStyle = gr; g.fillRect(x, 0, R, R);
  };
  // 0 glow
  rad(0, [[0, 1], [0.25, 0.7], [0.6, 0.15], [1, 0]]);
  // 1 smoke: lumpy blobs
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 14; i++) {
    const x = R + R / 2 + (rnd() - 0.5) * R * 0.45, y = R / 2 + (rnd() - 0.5) * R * 0.45, r = R * (0.16 + rnd() * 0.18);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.32)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // 2 spark: horizontal streak
  const sg = g.createLinearGradient(2 * R, 0, 3 * R, 0);
  sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.7, 'rgba(255,255,255,0.9)'); sg.addColorStop(1, 'rgba(255,255,255,0.2)');
  g.fillStyle = sg; g.fillRect(2 * R, R / 2 - 4, R, 8);
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(2 * R + R * 0.3, R / 2 - 1.5, R * 0.65, 3);
  // 3 debris chunk
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath(); g.moveTo(3 * R + 18, 14); g.lineTo(3 * R + 48, 20); g.lineTo(3 * R + 52, 46); g.lineTo(3 * R + 22, 52); g.lineTo(3 * R + 12, 30); g.fill();
  // 4 flame wisp
  for (let i = 0; i < 6; i++) {
    const x = 4 * R + R / 2 + (rnd() - 0.5) * 16, y = R / 2 + (rnd() - 0.5) * 16, r = R * (0.2 + rnd() * 0.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // 5 grass blade / clipping
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 6; g.lineCap = 'round';
  g.beginPath(); g.moveTo(5 * R + 20, 52); g.quadraticCurveTo(5 * R + 34, 30, 5 * R + 42, 10); g.stroke();
  // 6 ring
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 5;
  g.beginPath(); g.arc(6 * R + R / 2, R / 2, R / 2 - 6, 0, Math.PI * 2); g.stroke();
  // 7 star flare
  rad(7 * R, [[0, 1], [0.1, 0.6], [0.4, 0.05], [1, 0]]);
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.fillRect(7 * R + 2, R / 2 - 1, R - 4, 2); g.fillRect(7 * R + R / 2 - 1, 2, 2, R - 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

let _atlas = null;

export class ParticleSystem {
  constructor(scene, max, blending) {
    if (!_atlas) _atlas = makeAtlas();
    this.max = max;
    this.n = 0;
    // CPU state
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max * 2);
    this.col0 = new Float32Array(max * 4);
    this.col1 = new Float32Array(max * 4);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.rot = new Float32Array(max * 2);
    this.type = new Float32Array(max);
    // GPU attributes
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); // xyz + size
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); // rot, type, vel dir (2d stretch via vel)
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    for (const a of [this.aPos, this.aCol, this.aMisc, this.aVel]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos); g.setAttribute('aCol', this.aCol); g.setAttribute('aMisc', this.aMisc); g.setAttribute('aVel', this.aVel);
    g.instanceCount = 0;
    this.geometry = g;
    const additive = blending === 'add';
    this.material = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: _atlas } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute vec4 aPos; attribute vec4 aCol; attribute vec4 aMisc; attribute vec3 aVel;
        varying vec2 vUv; varying vec4 vCol; varying float vType;
        void main(){
          vCol = aCol; vType = aMisc.y;
          vec4 mv = modelViewMatrix * vec4(aPos.xyz, 1.0);
          vec2 corner = position.xy;
          float size = aPos.w;
          if (aMisc.y > 1.5 && aMisc.y < 2.5) {
            // spark: stretch along screen-space velocity
            vec3 vv = mat3(modelViewMatrix) * aVel;
            vec2 d = vv.xy; float l = length(d);
            vec2 dir = l > 1e-4 ? d / l : vec2(1.0, 0.0);
            vec2 nrm = vec2(-dir.y, dir.x);
            float stretch = 1.0 + min(l * 0.18, 6.0);
            mv.xy += dir * corner.x * size * stretch + nrm * corner.y * size * 0.35;
          } else {
            float c = cos(aMisc.x), s = sin(aMisc.x);
            mv.xy += vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
          }
          vUv = vec2((uv.x + aMisc.y) / 8.0, uv.y);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uAtlas; varying vec2 vUv; varying vec4 vCol; varying float vType;
        void main(){
          vec4 t = texture2D(uAtlas, vUv);
          float a = t.a * vCol.a;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vCol.rgb${additive ? ' * a' : ''}, ${additive ? '1.0' : 'a'});
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    if (additive) {
      this.material.blending = THREE.CustomBlending;
      this.material.blendSrc = THREE.OneFactor;
      this.material.blendDst = THREE.OneFactor;
    }
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 15;
    scene.add(this.mesh);
  }

  /**
   * o: { x,y,z (three metres), vx,vy,vz, life, size0, size1, c0:[r,g,b,a], c1:[r,g,b,a],
   *      drag, gravity, rot, spin, type }
   */
  emit(o) {
    let i;
    if (this.n < this.max) i = this.n++;
    else { i = Math.floor(Math.random() * this.max); }
    this.pos[i * 3] = o.x; this.pos[i * 3 + 1] = o.y; this.pos[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx || 0; this.vel[i * 3 + 1] = o.vy || 0; this.vel[i * 3 + 2] = o.vz || 0;
    this.life[i] = 0; this.maxLife[i] = o.life || 1;
    this.size[i * 2] = o.size0 ?? 0.2; this.size[i * 2 + 1] = o.size1 ?? this.size[i * 2];
    const c0 = o.c0 || [1, 1, 1, 1], c1 = o.c1 || c0;
    this.col0.set(c0, i * 4); this.col1.set(c1, i * 4);
    this.drag[i] = o.drag || 0; this.grav[i] = o.gravity || 0;
    this.rot[i * 2] = o.rot ?? Math.random() * 6.283; this.rot[i * 2 + 1] = o.spin || 0;
    this.type[i] = o.type || 0;
  }

  update(dt) {
    let n = this.n;
    const P = this.pos, V = this.vel, L = this.life, ML = this.maxLife;
    for (let i = 0; i < n; i++) {
      L[i] += dt;
      if (L[i] >= ML[i]) {
        // swap-remove
        n--;
        if (i !== n) this._move(n, i);
        i--;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      V[i * 3] *= d; V[i * 3 + 1] = V[i * 3 + 1] * d - this.grav[i] * dt; V[i * 3 + 2] *= d;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      if (this.type[i] === 3 || this.type[i] === 5) { // debris bounces on the floor
        if (P[i * 3 + 1] < 0.02) { P[i * 3 + 1] = 0.02; V[i * 3 + 1] = Math.abs(V[i * 3 + 1]) * 0.35; V[i * 3] *= 0.6; V[i * 3 + 2] *= 0.6; }
      }
      this.rot[i * 2] += this.rot[i * 2 + 1] * dt;
    }
    this.n = n;
    const ap = this.aPos.array, ac = this.aCol.array, am = this.aMisc.array, av = this.aVel.array;
    for (let i = 0; i < n; i++) {
      const t = L[i] / ML[i];
      ap[i * 4] = P[i * 3]; ap[i * 4 + 1] = P[i * 3 + 1]; ap[i * 4 + 2] = P[i * 3 + 2];
      ap[i * 4 + 3] = this.size[i * 2] + (this.size[i * 2 + 1] - this.size[i * 2]) * t;
      for (let k = 0; k < 4; k++) ac[i * 4 + k] = this.col0[i * 4 + k] + (this.col1[i * 4 + k] - this.col0[i * 4 + k]) * t;
      // fade in quickly and out at the end
      ac[i * 4 + 3] *= Math.min(1, t * 12) * (t > 0.7 ? (1 - t) / 0.3 : 1);
      am[i * 4] = this.rot[i * 2]; am[i * 4 + 1] = this.type[i];
      av[i * 3] = V[i * 3]; av[i * 3 + 1] = V[i * 3 + 1]; av[i * 3 + 2] = V[i * 3 + 2];
    }
    this.geometry.instanceCount = n;
    if (n > 0) {
      for (const a of [this.aPos, this.aCol, this.aMisc, this.aVel]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }

  _move(from, to) {
    for (let k = 0; k < 3; k++) { this.pos[to * 3 + k] = this.pos[from * 3 + k]; this.vel[to * 3 + k] = this.vel[from * 3 + k]; }
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.size[to * 2] = this.size[from * 2]; this.size[to * 2 + 1] = this.size[from * 2 + 1];
    for (let k = 0; k < 4; k++) { this.col0[to * 4 + k] = this.col0[from * 4 + k]; this.col1[to * 4 + k] = this.col1[from * 4 + k]; }
    this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from];
    this.rot[to * 2] = this.rot[from * 2]; this.rot[to * 2 + 1] = this.rot[from * 2 + 1];
    this.type[to] = this.type[from];
  }

  clear() { this.n = 0; this.geometry.instanceCount = 0; }
}

/** Camera-facing ribbon trail (supersonic streaks, ball trail). */
export class Ribbon {
  constructor(scene, length = 40, additive = true) {
    this.len = length;
    this.pts = [];
    const g = new THREE.BufferGeometry();
    this.posArr = new Float32Array(length * 2 * 3);
    this.colArr = new Float32Array(length * 2 * 4);
    g.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colArr, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.geometry = g;
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 18;
    scene.add(this.mesh);
    this.color = [1, 1, 1];
    this.width = 0.1;
    this.maxAge = 0.5;
  }

  push(p, emitting, time) {
    this.pts.unshift({ x: p.x, y: p.y, z: p.z, t: time, on: emitting });
    if (this.pts.length > this.len) this.pts.pop();
  }

  update(time, camPos) {
    const n = this.pts.length;
    const P = this.posArr, C = this.colArr;
    let drawn = 0;
    for (let i = 0; i < this.len; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      if (!p) { P.fill(0); C.fill(0); break; }
      const q = this.pts[Math.min(i + 1, n - 1)] || p, r = this.pts[Math.min(Math.max(i - 1, 0), n - 1)];
      let dx = r.x - q.x, dy = r.y - q.y, dz = r.z - q.z;
      // side vector: perpendicular to segment and view
      const vx = camPos.x - p.x, vy = camPos.y - p.y, vz = camPos.z - p.z;
      let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const age = (time - p.t) / this.maxAge;
      const fade = Math.max(0, 1 - age) * (p.on ? 1 : 0) * (i < n ? 1 : 0);
      const w = this.width * (0.35 + 0.65 * Math.max(0, 1 - age));
      sx = sx / sl * w; sy = sy / sl * w; sz = sz / sl * w;
      P[i * 6] = p.x + sx; P[i * 6 + 1] = p.y + sy; P[i * 6 + 2] = p.z + sz;
      P[i * 6 + 3] = p.x - sx; P[i * 6 + 4] = p.y - sy; P[i * 6 + 5] = p.z - sz;
      for (let k = 0; k < 2; k++) {
        C[i * 8 + k * 4] = this.color[0]; C[i * 8 + k * 4 + 1] = this.color[1]; C[i * 8 + k * 4 + 2] = this.color[2];
        C[i * 8 + k * 4 + 3] = fade;
      }
      if (fade > 0) drawn++;
    }
    this.mesh.visible = drawn > 1;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  clear() { this.pts.length = 0; this.mesh.visible = false; }
}
