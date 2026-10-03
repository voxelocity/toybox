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

export class SceneView {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.scene = renderer.scene;
    this.q = quality;
    this.root = new THREE.Group();
    this.root.name = 'view';
    this.scene.add(this.root);
    this.arena = new ArenaView(this.root, quality);
    this.stadium = new Stadium(this.root, quality);
    this.ball = new BallView(this.root, quality);
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
    this.cars = players.map((p) => new CarView(this.root, p.car, {
      style: p.style || 'striker', paint: p.paint || 0, accent: p.accent || 0, quality: this.q, effects: this.effects,
      isLocal: p.human, name: p.name, showName: !p.human,
    }));
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
    const bm = this.ball.mesh;
    bm.visible = ballState.visible;
    bm.position.set(ballState.pos.x * S, ballState.pos.z * S, -ballState.pos.y * S);
    bm.quaternion.set(ballState.quat.x, ballState.quat.z, -ballState.quat.y, ballState.quat.w);
    const speed = ballState.vel.len();
    this.ball.update(dt, speed);
    // ball trail when it's flying fast
    const tc = lastTouchTeam === 0 ? [0.35, 0.6, 1] : lastTouchTeam === 1 ? [1, 0.6, 0.25] : [0.8, 0.85, 1];
    this.ballTrail.color = tc;
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

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) for (const m of [].concat(o.material)) { if (m.map) m.map.dispose(); m.dispose(); }
    });
  }
}
