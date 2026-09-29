// Neon garage used behind the menus and in the shop: turntable, light
// strips, tool chests, tyre stacks, signage. Drag to orbit.
import * as THREE from 'three';
import { toonMaterial, skyMaterial, applyTheme, G } from './toon.js';
import { Geo } from '../geo/builder.js';
import { CarModel } from '../cars/car.js';
import { defaultConfig } from '../cars/catalog.js';
import { signAtlas, signUV, addSign } from './signs.js';

const THEME = {
  light: '#fff0e0', shadow: '#5a468e', sky: '#3a2a66', ground: '#1a1026', rim: '#20d8ff', fog: '#120a22',
  skyTop: '#07041a', skyHorizon: '#3a1450', lightDir: [0.55, 0.85, 0.4], fogNear: 40, fogFar: 140, rimStrength: 0.75, windowLit: 0.5,
};

export class Showroom {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 400);
    this.yaw = 0.7; this.pitch = 0.2; this.dist = 9.5;
    this.targetYaw = null;
    this.auto = true;
    this.focusX = 0;
    this.offset = new THREE.Vector3(0, 0, 0);
    this.t = 0;
    this.car = null;
  }

  async build() {
    const s = this.scene;
    const g = new Geo();
    const sg = new Geo();
    // floor tiles
    for (let x = -30; x < 30; x += 3) for (let z = -30; z < 30; z += 3) {
      g.set(((x + z) / 3) % 2 ? [0.12, 0.1, 0.18] : [0.15, 0.12, 0.22], 0, 0);
      g.quad([x, 0, z + 3], [x + 3, 0, z + 3], [x + 3, 0, z], [x, 0, z]);
    }
    // neon grid lines on the floor
    for (let k = -30; k <= 30; k += 6) {
      g.set([0.55, 0.15, 0.7], 0, 0.45);
      g.quad([k - 0.04, 0.01, 30], [k + 0.04, 0.01, 30], [k + 0.04, 0.01, -30], [k - 0.04, 0.01, -30]);
      g.quad([-30, 0.01, k + 0.04], [30, 0.01, k + 0.04], [30, 0.01, k - 0.04], [-30, 0.01, k - 0.04]);
    }
    // back walls
    g.set([0.2, 0.16, 0.3], 0, 0);
    g.box(0, 7, -16, 44, 14, 1);
    g.box(-21, 7, 0, 1, 14, 34);
    g.box(21, 7, 0, 1, 14, 34);
    // wall neon strips
    const strips = [[0.1, 0.85, 1], [1, 0.18, 0.44], [0.54, 0.24, 1]];
    for (let i = 0; i < 3; i++) {
      g.set(strips[i], 0, 1);
      g.box(0, 2 + i * 3.2, -15.45, 40, 0.18, 0.1);
    }
    for (const x of [-20.45, 20.45]) { g.set(strips[1], 0, 1); g.box(x, 9, 0, 0.1, 0.2, 30); g.set(strips[0], 0, 1); g.box(x, 3.5, 0, 0.1, 0.2, 30); }
    // ceiling light panels
    for (let z = -12; z <= 8; z += 5) { g.set([1, 0.95, 0.85], 0, 1); g.box(0, 12, z, 12, 0.2, 1.2); }
    // turntable
    g.set([0.08, 0.07, 0.12], 0, 0);
    g.cyl([0, 0, 0], [0, 0.12, 0], 4.6, 4.6, 48, true);
    g.set([0.12, 0.9, 1], 0, 1);
    g.at([0, 0.13, 0], [0, 0, Math.PI / 2], 1, (gg) => gg.ring(0, 4.35, 4.6, 48));
    // tool chests & tyre stacks
    for (const [x, z, a] of [[-12, -12, 0.2], [13, -11, -0.3]]) {
      g.at([x, 0, z], [0, a, 0], 1, (gg) => {
        gg.set([0.95, 0.15, 0.3], 0, 0); gg.box(0, 1.1, 0, 2.6, 2.2, 1.2);
        gg.set([0.1, 0.08, 0.12], 0, 0); for (let k = 0; k < 5; k++) gg.box(0.61 + 0.0, 0.3 + k * 0.4, 0, 0.02, 0.05, 2.2);
        gg.set([0.85, 0.85, 0.9], 0, 0); for (let k = 0; k < 5; k++) gg.box(0.64, 0.4 + k * 0.4, 0, 0.04, 0.05, 0.8);
      });
    }
    for (const [x, z, n] of [[-15, -6, 4], [-16.5, -3.5, 3], [15.5, -4, 5]]) {
      for (let k = 0; k < n; k++) {
        g.set([0.08, 0.08, 0.1], 0, 0);
        g.at([x, 0.18 + k * 0.36, z], [0, 0, Math.PI / 2], 1, (gg) => gg.lathe([[0.3, -0.18], [0.55, -0.18], [0.6, -0.1], [0.6, 0.1], [0.55, 0.18], [0.3, 0.18]], 14, true));
      }
    }
    // signs
    const P = (x, y, z) => [x, y, z];
    addSign(sg, P(-8, 8.5, -15.4), 0, 1, 9, 3.4, signUV('h', 12), 1);
    addSign(sg, P(8, 8.5, -15.4), 0, 1, 9, 3.4, signUV('h', 29), 1);
    addSign(sg, P(-20.4, 7, -8), 1, 0, 2.2, 7, signUV('v', 8), 1);
    addSign(sg, P(20.4, 7, -8), -1, 0, 2.2, 7, signUV('v', 2), 1);
    addSign(sg, P(0, 10.5, -15.4), 0, 1, 12, 5.2, signUV('b', 4), 1);
    const worldMat = toonMaterial({ vertexColors: true, emitAttr: true, rim: 0.2 });
    this.worldMat = worldMat;
    s.add(new THREE.Mesh(g.build({ color: true, emit: true, uv: true }), worldMat));
    const signMat = toonMaterial({ vertexColors: true, map: signAtlas(), emitAttr: true, alphaTest: true, rim: 0, side: THREE.DoubleSide });
    s.add(new THREE.Mesh(sg.build({ color: true, emit: true, uv: true }), signMat));
    // floor light pool under the car
    const pool = new THREE.Mesh(new THREE.CircleGeometry(6, 40), new THREE.MeshBasicMaterial({ color: 0x3a2270, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.14;
    s.add(pool);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 16, 8), skyMaterial());
    s.add(this.sky);
    // turntable group
    this.table = new THREE.Group();
    this.table.position.y = 0.12;
    s.add(this.table);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.01; this.shadow.scale.set(2.6, 1.2, 1);
    this.table.add(this.shadow);
    this.setCar(this.game.save.d.current);
    this.bindPointer();
    this.activate();
  }

  activate() { applyTheme(THEME); G.uHalftone.value = 1; }

  setCar(body, cfg = null) {
    const c = cfg || { ...(this.game.save.d.cars[body]?.cfg || defaultConfig(body)), body };
    if (this.car) { this.table.remove(this.car.root); this.car.dispose(); }
    this.car = new CarModel(c);
    this.table.add(this.car.root);
    this.cfg = c;
    this.activate();
  }

  /** Live preview: rebuild with a new config (keeps rotation). */
  preview(cfg) {
    if (!this.car) return this.setCar(cfg.body, cfg);
    const needGeo = ['body', 'front', 'rear', 'side', 'aero', 'wheels', 'height', 'camber'].some((k) => this.cfg[k] !== cfg[k]);
    if (needGeo) { this.car.build({ ...cfg }); }
    else this.car.applyPaint(cfg);
    this.car.cfg = { ...cfg };
    this.cfg = { ...cfg };
  }

  bindPointer() {
    const el = this.game.view.canvas;
    let down = null;
    el.addEventListener('pointerdown', (e) => { if (this.game.mode !== 'menu') return; down = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch }; this.auto = false; this.idle = 0; });
    window.addEventListener('pointermove', (e) => {
      if (!down) return;
      this.yaw = down.yaw - (e.clientX - down.x) * 0.008;
      this.pitch = Math.max(0.02, Math.min(0.7, down.pitch + (e.clientY - down.y) * 0.004));
    });
    window.addEventListener('pointerup', () => { down = null; });
    el.addEventListener('wheel', (e) => { if (this.game.mode !== 'menu') return; this.dist = Math.max(6, Math.min(16, this.dist + e.deltaY * 0.01)); }, { passive: true });
  }

  /** frame: 'menu' puts the car right of the buttons; 'garage' right of the panel */
  frame(kind) {
    this.kind = kind;
    this.dist = kind === 'garage' ? 10.5 : kind === 'title' ? 12 : 10;
  }

  update(dt) {
    this.t += dt;
    this.idle = (this.idle || 0) + dt;
    if (this.idle > 4) this.auto = true;
    if (this.auto) this.yaw += dt * 0.25;
    const w = this.game.view.cssW, h = this.game.view.cssH;
    this.camera.aspect = w / h;
    // shift the car into the free side of the screen
    const shift = this.kind === 'title' ? 0 : (w / h > 1.2 ? -0.22 : -0.05);
    const d = this.dist * (w / h < 1 ? 1.5 : 1);
    const tx = 0, ty = 0.75, tz = 0;
    this.camera.position.set(tx + Math.sin(this.yaw) * Math.cos(this.pitch) * d, ty + Math.sin(this.pitch) * d, tz + Math.cos(this.yaw) * Math.cos(this.pitch) * d);
    this.camera.lookAt(tx, ty, tz);
    this.camera.setViewOffset(w, h, shift * w, (this.kind === 'garage' ? 0.06 : 0) * h, w, h);
    this.camera.updateProjectionMatrix();
    if (this.car) {
      const len = this.car.dims.length || 4.4;
      this.shadow.scale.set(len * 0.62, this.car.dims.halfW * 1.25, 1);
      // idle bob / wheel spin for life
      this.car.body.position.y = this.car.heightOff + Math.sin(this.t * 2.2) * 0.006;
      if (this.car.rainLight) this.car.material.uniforms.uBrake.value = Math.sin(this.t * 6) > 0 ? 1 : 0;
    }
  }
}
