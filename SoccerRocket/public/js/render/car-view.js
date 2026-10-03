// Visual representation of one car: model, wheels, boost flames, trails.
import * as THREE from 'three';
import { buildCarModel, GROUND_Z, PAINTS } from './car-model.js';
import { instantiateCar } from './custom-assets.js';
import { Ribbon } from './particles.js';
import { S } from './convert.js';
import { TEAM_RGB } from './effects.js';

const FLAME_COLORS = [
  { core: new THREE.Color(2.4, 3.2, 4.0), mid: new THREE.Color(0.35, 0.8, 3.2), edge: new THREE.Color(0.1, 0.25, 1.4) },
  { core: new THREE.Color(4.0, 3.4, 2.0), mid: new THREE.Color(3.4, 1.2, 0.25), edge: new THREE.Color(1.6, 0.3, 0.05) },
];

function flameGeometry(len, radius) {
  const pts = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = radius * (Math.pow(1 - t, 0.75) * (1 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 2.2))) ) + 0.0001;
    pts.push(new THREE.Vector2(r * S, -t * len * S));
  }
  const g = new THREE.LatheGeometry(pts, 20);
  g.rotateZ(-Math.PI / 2); // lathe axis (-y) -> -x (backwards)
  return g;
}

function flameMaterial(team, inner) {
  const c = FLAME_COLORS[team] || FLAME_COLORS[1];
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCore: { value: c.core }, uMid: { value: c.mid }, uEdge: { value: c.edge }, uAmp: { value: 1 }, uInner: { value: inner ? 1 : 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying float vT;
      uniform float uTime;
      void main(){
        vT = clamp(-position.x / ${(0.6).toFixed(2)}, 0.0, 1.0);
        vec3 p = position;
        p.yz *= 1.0 + 0.12 * sin(uTime * 60.0 + position.x * 40.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCore, uMid, uEdge; uniform float uAmp, uInner, uTime;
      varying vec3 vN; varying vec3 vV; varying float vT;
      void main(){
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float core = pow(facing, uInner > 0.5 ? 1.2 : 2.5);
        vec3 col = mix(uEdge, uMid, core);
        col = mix(col, uCore, pow(core, 3.0) * (1.0 - vT));
        float a = core * (1.0 - smoothstep(0.35, 1.0, vT)) * uAmp;
        // mach diamonds
        a *= 0.8 + 0.35 * smoothstep(0.6, 1.0, sin(vT * 32.0 - uTime * 40.0));
        gl_FragColor = vec4(col * a, 1.0);
      }`,
  });
}

function nameSprite(text, team) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeText(text, 128, 32);
  g.fillStyle = team === 0 ? '#8fc0ff' : '#ffb27a'; g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1);
  s.renderOrder = 30;
  return s;
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _w = new THREE.Vector3();

// Wireframe of the physics hitbox and wheels (car-local), like the in-game
// hitbox visualisers: box at the hitbox offset, circles at the wheel
// hardpoints at rest, and the centre of mass.
function hitboxOverlay(car) {
  const g = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0xd8ff3a, depthTest: false, transparent: true, opacity: 0.95 });
  const [L, W, H] = [car.hitbox.x, car.hitbox.y, car.hitbox.z];
  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L * S, H * S, W * S)), mat);
  box.position.set(car.hbOffset.x * S, car.hbOffset.z * S, -car.hbOffset.y * S);
  g.add(box);
  for (const w of car.wheels) {
    const pts = [];
    for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * w.radius * S, Math.sin(a) * w.radius * S, 0)); }
    const c = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    // wheel centre at rest: hardpoint minus the resting suspension length
    c.position.set(w.local.x * S, (w.local.z - (w.rest - 1.95)) * S, -w.local.y * S);
    g.add(c);
  }
  const com = new THREE.Mesh(new THREE.SphereGeometry(2.2 * S, 10, 8), new THREE.MeshBasicMaterial({ color: 0xd8ff3a, depthTest: false }));
  g.add(com);
  g.renderOrder = 40;
  g.traverse((o) => { o.renderOrder = 40; });
  return g;
}

export class CarView {
  constructor(scene, car, opts) {
    this.scene = scene;
    this.car = car;
    this.team = car.team;
    this.effects = opts.effects;
    this.q = opts.quality;
    let model;
    if (opts.custom) {
      const pc = PAINTS[opts.paint || 0] || PAINTS[0];
      const inst = instantiateCar(opts.custom, new THREE.Color(car.team === 0 ? pc.blue : pc.orange));
      model = { group: inst.group, wheels: inst.wheels, nozzles: inst.nozzles, custom: true };
    } else {
      model = buildCarModel({ style: opts.style, team: car.team, paint: opts.paint || 0, accent: opts.accent || 0, quality: opts.quality });
    }
    this.model = model;
    this.group = model.group;
    scene.add(this.group);
    // flames
    this.flames = [];
    for (const n of model.nozzles) {
      const outer = new THREE.Mesh(flameGeometry(60, 6.2), flameMaterial(car.team, false));
      const inner = new THREE.Mesh(flameGeometry(30, 3.2), flameMaterial(car.team, true));
      outer.position.copy(n); inner.position.copy(n);
      outer.renderOrder = inner.renderOrder = 22;
      outer.frustumCulled = inner.frustumCulled = false;
      this.group.add(outer, inner);
      this.flames.push({ outer, inner });
    }
    this.flameAmp = 0;
    // supersonic ribbons from the rear corners
    this.ribbons = [];
    if (this.q.trails) {
      for (const side of [1, -1]) {
        const r = new Ribbon(scene, 26, true);
        const c = TEAM_RGB[car.team];
        r.color = [0.6 + c[0] * 0.4, 0.6 + c[1] * 0.4, 0.6 + c[2] * 0.4];
        r.width = 0.05; r.maxAge = 0.35;
        r.localPos = new THREE.Vector3(-44 * S, 22 * S, side * 34 * S);
        this.ribbons.push(r);
      }
    }
    this.light = null;
    if (opts.isLocal && this.q.shadowSize > 0) {
      this.light = new THREE.PointLight(car.team === 0 ? 0x4a8cff : 0xff7a22, 0, 9, 2);
      this.light.position.set(-80 * S, 10 * S, 0);
      this.group.add(this.light);
    }
    if (opts.name && opts.showName) {
      this.tag = nameSprite(opts.name, car.team);
      this.tag.position.set(0, 85 * S, 0);
      this.group.add(this.tag);
    }
    this.hitbox = hitboxOverlay(car);
    this.hitbox.visible = false;
    this.group.add(this.hitbox);
    this.emitAcc = 0; this.smokeAcc = 0; this.sprayAcc = 0;
    this.wasSupersonic = false;
    this.visible = true;
  }

  showHitbox(v) { this.hitbox.visible = v; }

  setVisible(v) { this.group.visible = v; this.visible = v; if (!v) for (const r of this.ribbons) r.clear(); }

  /**
   * s: interpolated render state { pos (physics V3-like), quat (physics), boosting,
   *    supersonic, demoed, wheels: [{steer, spin, susLen, contact, rest}], handbrake, onGround, speed }
   */
  update(s, dt, time, camPos) {
    const g = this.group;
    if (s.demoed) { if (this.visible) this.setVisible(false); return; }
    if (!this.visible) this.setVisible(true);
    g.position.set(s.pos.x * S, s.pos.z * S, -s.pos.y * S);
    g.quaternion.set(s.quat.x, s.quat.z, -s.quat.y, s.quat.w);
    // wheels
    const W = this.model.wheels;
    if (W) for (let i = 0; i < 4; i++) {
      const w = W[i], ws = s.wheels[i];
      w.pivot.rotation.y = -ws.steer;
      w.spin.rotation.z = -ws.spin;
      // suspension travel relative to the resting compression (~1.95 uu)
      const travel = (ws.rest - 1.95) - Math.min(ws.susLen, ws.rest + 4);
      w.pivot.position.y = w.baseY + travel * S;
    }
    // boost flames
    const target = s.boosting ? 1 : 0;
    this.flameAmp += (target - this.flameAmp) * Math.min(1, dt * (s.boosting ? 30 : 14));
    const flick = 0.85 + Math.random() * 0.3;
    for (const f of this.flames) {
      const vis = this.flameAmp > 0.02;
      f.outer.visible = f.inner.visible = vis;
      if (!vis) continue;
      const sc = this.flameAmp * flick;
      f.outer.scale.set(sc * (s.supersonic ? 1.35 : 1), 0.8 + 0.2 * sc, 0.8 + 0.2 * sc);
      f.inner.scale.set(sc, 1, 1);
      f.outer.material.uniforms.uTime.value = time; f.inner.material.uniforms.uTime.value = time;
      f.outer.material.uniforms.uAmp.value = this.flameAmp; f.inner.material.uniforms.uAmp.value = this.flameAmp;
    }
    if (this.light) this.light.intensity = this.flameAmp * (4 + Math.random() * 1.5);

    // particles from the nozzles while boosting
    const E = this.effects;
    if (s.boosting && E) {
      const back = _v.set(-1, 0, 0).applyQuaternion(g.quaternion);
      const vel = _w.set(s.vel.x * S, s.vel.z * S, -s.vel.y * S);
      this.emitAcc += dt * 140 * E.budget;
      this.smokeAcc += dt * 34 * E.budget;
      const c = FLAME_COLORS[this.team];
      while (this.emitAcc >= 1) {
        this.emitAcc -= 1;
        const n = this.model.nozzles[Math.random() < 0.5 ? 0 : 1];
        const p = n.clone().applyMatrix4(g.matrixWorld);
        const sp = 6 + Math.random() * 5;
        E.add.emit({ x: p.x, y: p.y, z: p.z, vx: vel.x * 0.55 + back.x * sp + (Math.random() - 0.5), vy: vel.y * 0.55 + back.y * sp + (Math.random() - 0.5), vz: vel.z * 0.55 + back.z * sp + (Math.random() - 0.5),
          life: 0.1 + Math.random() * 0.16, size0: 0.1, size1: 0.32, c0: [c.mid.r * 0.5, c.mid.g * 0.5, c.mid.b * 0.5, 1], c1: [c.edge.r * 0.4, c.edge.g * 0.4, c.edge.b * 0.4, 0], drag: 4, type: 4, spin: 3 });
      }
      while (this.smokeAcc >= 1) {
        this.smokeAcc -= 1;
        const n = this.model.nozzles[Math.random() < 0.5 ? 0 : 1];
        const p = n.clone().applyMatrix4(g.matrixWorld).addScaledVector(back, 0.35);
        E.alpha.emit({ x: p.x, y: p.y, z: p.z, vx: vel.x * 0.25 + back.x * 2, vy: vel.y * 0.25 + 0.3, vz: vel.z * 0.25 + back.z * 2,
          life: 0.5 + Math.random() * 0.5, size0: 0.14, size1: 0.75, c0: [0.5, 0.5, 0.52, 0.22], c1: [0.62, 0.62, 0.64, 0], drag: 2.2, type: 1, spin: (Math.random() - 0.5) * 2 });
      }
    } else { this.emitAcc = 0; this.smokeAcc = 0; }

    // powerslide grass spray from the rear wheels
    if (E && s.onGround && s.handbrake > 0.3 && s.speed > 350 && s.up.z > 0.85) {
      this.sprayAcc += dt * 60 * Math.min(1, s.speed / 1200);
      if (this.sprayAcc >= 1) {
        const n = Math.floor(this.sprayAcc); this.sprayAcc -= n;
        for (const wi of (W ? [2, 3] : [])) {
          const wp = W[wi].pivot.getWorldPosition(new THREE.Vector3());
          wp.y = 0.05;
          const side = _v.set(0, 0, wi === 2 ? -1 : 1).applyQuaternion(g.quaternion);
          E.grassSpray(wp, side, n);
        }
      }
    }

    // supersonic ribbons
    g.updateMatrixWorld();
    for (const r of this.ribbons) {
      const p = r.localPos.clone().applyMatrix4(g.matrixWorld);
      r.push(p, s.supersonic, time);
      r.update(time, camPos);
    }
    if (s.supersonic && !this.wasSupersonic && E) E.sonicBoom(g.position.clone(), TEAM_RGB[this.team]);
    this.wasSupersonic = s.supersonic;
    if (this.tag) this.tag.visible = camPos.distanceTo(g.position) > 6;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const r of this.ribbons) this.scene.remove(r.mesh);
  }
}

export { GROUND_Z };
