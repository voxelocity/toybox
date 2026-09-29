// Boost pads: animated chevron strips conforming to the road.
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uA, uB;
varying vec2 vUv;
void main() {
  float x = abs(vUv.x - 0.5);
  float c = fract(vUv.y * 2.5 - uTime * 2.2 - x * 1.4);
  float chev = step(0.45, c);
  float edge = step(0.44, x);
  vec3 col = mix(uB * 0.35, uA * 1.6, chev);
  col = mix(col, vec3(0.05, 0.02, 0.09), edge);
  gl_FragColor = vec4(col, 1.0);
}`;

export class BoostPads {
  constructor(race) {
    this.race = race;
    const tr = race.track;
    const path = tr.path;
    this.pads = [];
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color(tr.theme.padA || '#ffe23b') }, uB: { value: new THREE.Color(tr.theme.padB || '#ff2d6f') } },
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    const pos = [], uv = [], idx = [];
    for (const p of tr.def.boostPads || []) {
      const s0 = p.u * path.length, len = p.len ?? 9, w = p.w ?? 4.6, lat = p.lat ?? 0;
      const n = 6;
      const base = pos.length / 3;
      for (let k = 0; k <= n; k++) {
        const s = s0 + (len * k) / n;
        for (const side of [-1, 1]) {
          const q = path.point(s, lat + side * w / 2);
          const ramp = tr.rampHeight(s, lat + side * w / 2);
          pos.push(q.px, q.py + 0.03 + ramp, q.pz);
          uv.push(side < 0 ? 0 : 1, k / n * (len / w));
        }
      }
      for (let k = 0; k < n; k++) {
        const a = base + k * 2;
        idx.push(a, a + 3, a + 1, a, a + 2, a + 3);
      }
      this.pads.push({ s0, s1: s0 + len, lat0: lat - w / 2, lat1: lat + w / 2 });
    }
    if (this.pads.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      this.mesh = new THREE.Mesh(g, this.mat);
      this.mesh.material.side = THREE.DoubleSide;
      race.scene.add(this.mesh);
    }
  }

  check(v) {
    if (!v.grounded) return;
    const L = this.race.track.length;
    for (const p of this.pads) {
      let ds = v.s - p.s0;
      if (ds < -L / 2) ds += L;
      if (ds >= 0 && ds <= p.s1 - p.s0 && v.lat >= p.lat0 - 0.6 && v.lat <= p.lat1 + 0.6) {
        if (v.boostT < 0.6 || v.boostKind !== 'pad') v.boost(1.0, 1.36, 'pad');
      }
    }
  }

  update(dt, t) { this.mat.uniforms.uTime.value = t; }

  dispose() { if (this.mesh) { this.race.scene.remove(this.mesh); this.mesh.geometry.dispose(); } this.mat.dispose(); }
}
