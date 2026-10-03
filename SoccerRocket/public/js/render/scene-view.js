// Owns every render object for the current quality level so the whole view
// can be rebuilt when graphics settings change.
import * as THREE from 'three';
import { ArenaView } from './arena-view.js';
import { Stadium } from './stadium.js';
import { BallView } from './ball-view.js';
import { Effects } from './effects.js';
import { CarView } from './car-view.js';
import { Ribbon } from './particles.js';
import { S } from './convert.js';

// ball trail colour: untouched, blue, orange
const TRAIL_RGB = [[0.8, 0.85, 1], [0.35, 0.6, 1], [1, 0.6, 0.25]];

function radialShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(0.45, 'rgba(0,0,0,0.6)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// Soft contact shadow decal (texture: dark blob on white).
function shadowDecal(tex, w, l) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uOpacity: { value: 0.6 } },
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D uMap; uniform float uOpacity; varying vec2 vUv; void main(){ float a = (1.0 - texture2D(uMap, vUv).r) * uOpacity; if (a < 0.01) discard; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }',
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(l, w), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  m.frustumCulled = false;
  return m;
}

export class SceneView {
  constructor(renderer, quality, custom = {}) {
    this.custom = custom;
    this.renderer = renderer;
    this.scene = renderer.scene;
    this.q = quality;
    this.root = new THREE.Group();
    this.root.name = 'view';
    this.scene.add(this.root);
    this.arena = new ArenaView(this.root, quality);
    this.stadium = new Stadium(this.root, quality);
    this.ball = new BallView(this.root, quality, custom.ball);
    this.ballShadow = shadowDecal(custom.ballShadow || radialShadowTexture(), 2.4, 2.4);
    this.root.add(this.ballShadow);
    this.carShadowTex = custom.carShadow || radialShadowTexture(); // shared by every match's cars
    this.carShadows = [];
    this.effects = new Effects(this.root, quality, renderer);
    this.ballTrail = new Ribbon(this.root, 30, true);
    this.ballTrail.width = 0.32;
    this.ballTrail.maxAge = 0.4;
    this.cars = [];
    this.time = 0;
    this.camPos = new THREE.Vector3();
  }

  setPlayers(players, settings) {
    for (const c of this.cars) c.dispose();
    // (the ball's shadow shares the decal shader, so disposing these keeps the program)
    for (const d of this.carShadows) { this.root.remove(d); d.geometry.dispose(); d.material.dispose(); }
    this.cars = players.map((p) => new CarView(this.root, p.car, {
      style: p.style || 'striker', paint: p.paint || 0, accent: p.accent || 0, quality: this.q, effects: this.effects,
      isLocal: p.human, name: p.name, showName: !p.human, custom: this.custom.car,
    }));
    for (const c of this.cars) c.showHitbox(!!(settings && settings.showHitbox));
    // contact shadows under cars: always without shadow maps, subtle otherwise
    this.carShadows = players.map(() => { const d = shadowDecal(this.carShadowTex, 1.5, 2.1); this.root.add(d); return d; });
  }

  /**
   * carStates: interpolated car render states (same order as players)
   * ballState: { pos, quat, vel, visible }
   */
  update(dt, carStates, ballState, lastTouchTeam) {
    this.time += dt;
    const cam = this.renderer.camera;
    this.camPos.copy(cam.position);
    this.arena.update(dt, this.time, this.camPos);
    this.stadium.update(dt, this.camPos);
    for (let i = 0; i < this.cars.length; i++) if (carStates[i]) this.cars[i].update(carStates[i], dt, this.time, this.camPos);
    const baseCar = this.q.shadowSize > 0 ? 0.45 : 0.85;
    for (let i = 0; i < this.carShadows.length; i++) {
      const d = this.carShadows[i], st = carStates[i];
      if (!st || st.demoed) { d.visible = false; continue; }
      const h = st.pos.z - 17;
      d.visible = h < 600 && Math.abs(st.pos.x) < 4000 && Math.abs(st.pos.y) < 5900;
      if (!d.visible) continue;
      d.position.set(st.pos.x * S, 0.012, -st.pos.y * S);
      const fx = 1 - 2 * (st.quat.y * st.quat.y + st.quat.z * st.quat.z), fy = 2 * (st.quat.x * st.quat.y + st.quat.w * st.quat.z);
      d.rotation.z = Math.atan2(fy, fx);
      d.material.uniforms.uOpacity.value = baseCar * Math.max(0, 1 - h / 600);
    }
    const bm = this.ball.mesh;
    bm.visible = ballState.visible;
    const bh = ballState.pos.z - 93;
    this.ballShadow.visible = ballState.visible && Math.abs(ballState.pos.y) < 5900;
    this.ballShadow.position.set(ballState.pos.x * S, 0.014, -ballState.pos.y * S);
    this.ballShadow.material.uniforms.uOpacity.value = 0.55 * Math.max(0.15, 1 - bh / 1800);
    this.ballShadow.scale.setScalar(1 + Math.min(1.5, bh / 1200));
    bm.position.set(ballState.pos.x * S, ballState.pos.z * S, -ballState.pos.y * S);
    bm.quaternion.set(ballState.quat.x, ballState.quat.z, -ballState.quat.y, ballState.quat.w);
    const speed = ballState.vel.len();
    this.ball.update(dt, speed);
    // ball trail when it's flying fast
    this.ballTrail.color = TRAIL_RGB[lastTouchTeam + 1] || TRAIL_RGB[0];
    this.ballTrail.push(bm.position, ballState.visible && speed > 2200, this.time);
    this.ballTrail.update(this.time, this.camPos);
    // grass pushers: cars and ball near the floor
    if (this.arena.grass) {
      const P = this.arena.grass.pushers;
      let k = 0;
      for (const s of carStates) {
        if (!s || s.demoed || k >= 7) continue;
        if (s.pos.z < 80) P[k++].set(s.pos.x, s.pos.y, 95, 1);
      }
      if (ballState.visible && ballState.pos.z < 150) P[k++].set(ballState.pos.x, ballState.pos.y, 120, 1 - (ballState.pos.z - 91) / 60);
      for (; k < 8; k++) P[k].w = 0;
    }
    this.effects.update(dt);
  }

  showHitboxes(v) { for (const c of this.cars) c.showHitbox(v); }

  /**
   * Shows every normally idle object (effects, boost flames, trails, hitboxes,
   * spent boost pads) so a warm-up frame draws each of them once. Returns
   * the function that restores everything.
   */
  prime() {
    const undoFx = this.effects.prime(new THREE.Vector3(0, 1, 0));
    const shown = [];
    const show = (o) => { if (o && !o.visible) { o.visible = true; shown.push(o); } };
    for (const c of this.cars) {
      for (const f of c.flames) { show(f.outer); show(f.inner); }
      for (const r of c.ribbons) show(r.mesh);
      show(c.hitbox);
    }
    show(this.ballTrail.mesh);
    const pads = this.arena.pads || [];
    const spent = [pads.findIndex((p) => p.big), pads.findIndex((p) => !p.big)].filter((i) => i >= 0);
    for (const i of spent) this.arena.setPadState(i, false);
    return () => {
      undoFx();
      for (const o of shown) o.visible = false;
      for (const i of spent) this.arena.setPadState(i, true);
    };
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) for (const m of [].concat(o.material)) { if (m.map) m.map.dispose(); m.dispose(); }
    });
  }
}
