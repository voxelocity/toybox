// Visual arena: grass field, glass walls, ceiling, goals, frame and boost pads.
// Built from the same surfaces as the collision mesh.
import * as THREE from 'three';
import { buildArenaSurfaces } from '../physics/arena.js';
import { ARENA, BOOST_PADS } from '../physics/constants.js';
import { S } from './convert.js';
import { makeFieldMaterial, makeGrassShells } from './grass.js';

const { X, Y, Z, R, GOAL_HALF_W: GW, GOAL_H: GH, GOAL_DEPTH: GD } = ARENA;

export function surfaceToGeometry(s) {
  const n = s.positions.length / 3;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = s.positions[i * 3] * S; pos[i * 3 + 1] = s.positions[i * 3 + 2] * S; pos[i * 3 + 2] = -s.positions[i * 3 + 1] * S;
    nrm[i * 3] = s.normals[i * 3]; nrm[i * 3 + 1] = s.normals[i * 3 + 2]; nrm[i * 3 + 2] = -s.normals[i * 3 + 1];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(s.uvs, 2));
  // (x, y, z) -> (x, z, -y) is a proper rotation, so CCW winding is kept
  const idx = s.indices.slice();
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

function mergeGeoms(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, ov * 3); nrm.set(g.attributes.normal.array, ov * 3); uv.set(g.attributes.uv.array, ov * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[oi + i] = gi[i] + ov;
    ov += g.attributes.position.count; oi += gi.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

const HEX_GLSL = /* glsl */`
float hexDist(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x); }
vec4 hexCoords(vec2 uv){
  vec2 r = vec2(1.0, 1.7320508), h = r * 0.5;
  vec2 a = mod(uv, r) - h, b = mod(uv - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return vec4(gv, uv - gv);
}
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

function glassMaterial(shared, kind) {
  // kind: 0 wall, 1 ceiling, 2 goal net
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({ uKind: { value: kind }, uFlash: shared.uFlash, uFlashTeam: shared.uFlashTeam }, {
      uTime: shared.uTime, uTeamBlue: shared.uTeamBlue, uTeamOrange: shared.uTeamOrange,
    }),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec3 vWPos; varying vec3 vN; varying vec2 vUv;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uKind, uFlash, uFlashTeam; uniform vec3 uTeamBlue, uTeamOrange;
      varying vec3 vWPos; varying vec3 vN; varying vec2 vUv;
      ${HEX_GLSL}
      void main(){
        vec2 fp = vec2(vWPos.x, -vWPos.z) * 100.0;
        float z = vWPos.y * 100.0;
        float side = smoothstep(-900.0, 900.0, fp.y);
        vec3 team = mix(uTeamBlue, uTeamOrange, side);
        vec3 V = normalize(cameraPosition - vWPos);
        float fres = pow(1.0 - abs(dot(V, normalize(vN))), 3.0);
        vec2 huv = uKind == 1.0 ? fp / 210.0 : (uKind == 2.0 ? vec2(vUv.x, vUv.y) / 70.0 : vec2(vUv.x, z) / 150.0);
        vec4 hc = hexCoords(huv);
        float e = 0.5 - hexDist(hc.xy);
        float fw = fwidth(e) * 1.2 + 1e-4;
        float lineW = uKind == 2.0 ? 0.06 : 0.035;
        float line = 1.0 - smoothstep(lineW - fw, lineW + fw, e);
        // fade the lattice where it would alias (far away / grazing)
        float lod = 1.0 - smoothstep(0.08, 0.35, length(fwidth(huv)));
        line *= lod;
        float rnd = h12(hc.zw);
        vec3 col; float a;
        if (uKind == 0.0) {
          float low = 1.0 - smoothstep(260.0, 1500.0, z);
          float band = (1.0 - smoothstep(0.0, 28.0, abs(z - 300.0))) + 0.6 * (1.0 - smoothstep(0.0, 10.0, abs(z - 360.0)));
          float pulse = smoothstep(0.985, 1.0, sin(uTime * 0.6 + rnd * 60.0)) * low;
          float top = 1.0 - smoothstep(0.0, 40.0, abs(z - 1950.0));
          col = vec3(0.012, 0.018, 0.03) + team * (line * (0.18 + 1.6 * low) + band * 5.0 + pulse * 1.2 + top * 2.5);
          col += team * uFlash * (0.6 + line * 2.0) * low;
          a = 0.10 + 0.22 * low + line * (0.15 + 0.35 * low) + fres * 0.25 + band * 0.4 + pulse * 0.3;
        } else if (uKind == 1.0) {
          col = vec3(0.01, 0.012, 0.02) + team * line * 0.35;
          a = 0.035 + line * 0.12 + fres * 0.08;
        } else {
          float depthFade = 0.55 + 0.45 * smoothstep(0.0, 700.0, z);
          col = vec3(0.01, 0.015, 0.03) + team * (line * 1.6 * depthFade + 0.12) + team * uFlash * 1.5;
          a = 0.35 + line * 0.45 + fres * 0.1;
        }
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return mat;
}

export class ArenaView {
  constructor(scene, quality) {
    this.group = new THREE.Group();
    this.group.name = 'arena';
    scene.add(this.group);
    this.q = quality;
    this.shared = {
      uTime: { value: 0 },
      uTeamBlue: { value: new THREE.Color(0.10, 0.42, 1.0) },
      uTeamOrange: { value: new THREE.Color(1.0, 0.42, 0.05) },
      uFlash: { value: 0 },
      uFlashTeam: { value: 0 },
    };
    const surfaces = buildArenaSurfaces({ filletSteps: 24, arcSteps: 8, maxSeg: 512, wallSteps: 4 });
    const byTag = Object.fromEntries(surfaces.map((s) => [s.tag, surfaceToGeometry(s)]));

    // field: floor + ramps + goal floors
    const fieldGeom = mergeGeoms([byTag.floor, byTag.ramp, byTag.goalfloor]);
    const field = makeFieldMaterial(this.shared, !quality.physicalMaterials);
    this.fieldMesh = new THREE.Mesh(fieldGeom, field.material);
    this.fieldMesh.receiveShadow = true;
    this.group.add(this.fieldMesh);
    if (quality.grassShells > 0) {
      const shells = makeGrassShells(fieldGeom, quality.grassShells, this.shared, {
        fadeFar: quality.grassShells >= 20 ? 42 : 32, fadeNear: quality.grassShells >= 20 ? 18 : 12,
      });
      this.grass = shells;
      this.group.add(shells.mesh);
    }

    // glass walls, ceiling, goal nets
    const wallMat = glassMaterial(this.shared, 0);
    this.walls = new THREE.Mesh(byTag.wall, wallMat);
    this.walls.renderOrder = 5;
    this.group.add(this.walls);
    const ceilMat = glassMaterial(this.shared, 1);
    this.ceiling = new THREE.Mesh(mergeGeoms([byTag.ceilramp, byTag.ceiling]), ceilMat);
    this.ceiling.renderOrder = 4;
    this.group.add(this.ceiling);
    const goalMat = glassMaterial(this.shared, 2);
    this.goalNets = new THREE.Mesh(byTag.goal, goalMat);
    this.goalNets.renderOrder = 3;
    this.group.add(this.goalNets);

    this._buildGoalFrames();
    this._buildStructure();
    this._buildPads();
  }

  _buildGoalFrames() {
    const shared = this.shared;
    for (const team of [0, 1]) {
      const sy = team === 0 ? -1 : 1;
      const color = team === 0 ? shared.uTeamBlue.value : shared.uTeamOrange.value;
      const glow = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(7.0), toneMapped: false });
      const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.35, metalness: 0.8 });
      const g = new THREE.Group();
      const yWall = sy * (Y - 5); // just in front of the wall face
      const box = (w, h, d, x, y, z, mat) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w * S, h * S, d * S), mat);
        m.position.set(x * S, z * S, -y * S);
        m.castShadow = true;
        g.add(m);
        return m;
      };
      // frame on the wall face around the mouth (outside the opening)
      for (const sx of [-1, 1]) {
        box(70, GH + 70, 12, sx * (GW + 35), yWall, (GH + 70) / 2, dark);
        box(14, GH + 60, 14, sx * (GW + 8), yWall - sy * 4, (GH + 60) / 2, glow);
        box(10, GH, 30, sx * (GW + 4), sy * (Y + 15), GH / 2, glow); // inner lip
      }
      box(2 * GW + 140, 70, 12, 0, yWall, GH + 35, dark);
      box(2 * GW + 30, 14, 14, 0, yWall - sy * 4, GH + 8, glow);
      box(2 * GW, 10, 30, 0, sy * (Y + 15), GH - 4, glow);
      // back corners of the goal box
      for (const sx of [-1, 1]) box(16, GH, 16, sx * (GW - 8), sy * (Y + GD - 8), GH / 2, glow);
      box(2 * GW, 12, 16, 0, sy * (Y + GD - 8), GH - 6, glow);
      // light inside the goal
      if (this.q.shadowSize > 0 || this.q.stadiumDetail > 0) {
        const pl = new THREE.PointLight(color, 6, 14, 2);
        pl.position.set(0, (GH * 0.6) * S, -sy * (Y + GD * 0.5) * S);
        g.add(pl);
        this['goalLight' + team] = pl;
      }
      this.group.add(g);
    }
  }

  _buildStructure() {
    // dark metal cage outside the glass: pillars, top ring and ad-light strip
    const metal = new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.4, metalness: 0.85 });
    const trimBlue = new THREE.MeshBasicMaterial({ color: this.shared.uTeamBlue.value.clone().multiplyScalar(4), toneMapped: false });
    const trimOrange = new THREE.MeshBasicMaterial({ color: this.shared.uTeamOrange.value.clone().multiplyScalar(4), toneMapped: false });
    const g = new THREE.Group();
    const out = 40;
    // perimeter path (outer wall line) as segments
    const C = ARENA.CORNER;
    const pts = [[X, -(C - X)], [X, C - X], [C - Y, Y], [-(C - Y), Y], [-X, C - X], [-X, -(C - X)], [-(C - Y), -Y], [C - Y, -Y]];
    const pillarGeo = new THREE.BoxGeometry(60 * S, (Z + 260) * S, 60 * S);
    const beamGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 8; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % 8];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const nx = (y1 - y0) / len, ny = -(x1 - x0) / len; // outward for CCW path
      const n = Math.max(1, Math.round(len / 1100));
      for (let k = 0; k <= n; k++) {
        if (k === n) continue;
        const t = k / n;
        const x = x0 + (x1 - x0) * t + nx * out, y = y0 + (y1 - y0) * t + ny * out;
        // skip pillars in front of the goal mouths
        if (Math.abs(y) > Y - 10 && Math.abs(x) < GW + 120) continue;
        const p = new THREE.Mesh(pillarGeo, metal);
        p.position.set(x * S, (Z + 260) / 2 * S - 1.2, -y * S);
        p.castShadow = true;
        g.add(p);
      }
      // top ring beam
      const mx = (x0 + x1) / 2 + nx * out, my = (y0 + y1) / 2 + ny * out;
      const beam = new THREE.Mesh(beamGeo, metal);
      beam.scale.set(len * S + 0.6, 0.7, 0.7);
      beam.position.set(mx * S, (Z + 40) * S, -my * S);
      beam.rotation.y = Math.atan2(-(y1 - y0), x1 - x0);
      g.add(beam);
      // glowing trim on the beam, team coloured by half
      const trim = new THREE.Mesh(beamGeo, (my < 0) ? trimBlue : trimOrange);
      trim.scale.set(len * S, 0.08, 0.1);
      trim.position.set((mx - nx * 36) * S, (Z + 10) * S, -(my - ny * 36) * S);
      trim.rotation.y = beam.rotation.y;
      if (Math.abs(my) < 500 && Math.abs(nx) > 0.9) trim.material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      g.add(trim);
    }
    this.group.add(g);
  }

  _buildPads() {
    this.pads = [];
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.35, metalness: 0.9 });
    const ringOn = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.62, 0.12).multiplyScalar(4.5), toneMapped: false });
    const ringOff = new THREE.MeshBasicMaterial({ color: 0x3a2a14 });
    const smallBase = new THREE.CylinderGeometry(0.62, 0.7, 0.08, 32);
    const smallDisc = new THREE.CylinderGeometry(0.48, 0.48, 0.1, 32);
    const bigBase = new THREE.CylinderGeometry(1.35, 1.55, 0.14, 48);
    const bigRing = new THREE.TorusGeometry(1.18, 0.07, 10, 64);
    const orbGeo = new THREE.SphereGeometry(0.55, 32, 20);
    const orbMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.shared.uTime },
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uTime; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.0);
          vec3 core = vec3(1.0, 0.78, 0.25) * (2.6 + 0.5 * sin(uTime * 6.0));
          vec3 col = mix(core, vec3(1.0, 0.45, 0.05) * 4.0, f);
          gl_FragColor = vec4(col, 1.0); }`,
      toneMapped: false,
    });
    const ringGeo = new THREE.TorusGeometry(0.85, 0.025, 8, 48);
    const glowTex = makeGlowTexture();
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffa020, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 });
    for (const [x, y, big] of BOOST_PADS) {
      const g = new THREE.Group();
      g.position.set(x * S, 0, -y * S);
      const pad = { group: g, big: !!big, active: true, t: 0 };
      if (big) {
        const base = new THREE.Mesh(bigBase, baseMat); base.position.y = 0.07; base.receiveShadow = true; g.add(base);
        const ring = new THREE.Mesh(bigRing, ringOn); ring.rotation.x = Math.PI / 2; ring.position.y = 0.15; g.add(ring);
        const orb = new THREE.Mesh(orbGeo, orbMat); orb.position.y = 1.0; g.add(orb);
        const rings = [];
        for (let i = 0; i < 2; i++) { const r = new THREE.Mesh(ringGeo, ringOn); r.position.y = 1.0; g.add(r); rings.push(r); }
        const glow = new THREE.Sprite(glowMat); glow.scale.set(3.2, 3.2, 1); glow.position.y = 1.0; g.add(glow);
        Object.assign(pad, { ring, orb, rings, glow });
      } else {
        const base = new THREE.Mesh(smallBase, baseMat); base.position.y = 0.04; base.receiveShadow = true; g.add(base);
        const disc = new THREE.Mesh(smallDisc, ringOn); disc.position.y = 0.06; g.add(disc);
        Object.assign(pad, { disc });
      }
      pad.ringOn = ringOn; pad.ringOff = ringOff;
      this.group.add(g);
      this.pads.push(pad);
    }
  }

  setPadState(i, active) {
    const p = this.pads[i];
    if (p.active === active) return;
    p.active = active;
    p.t = 0;
    if (p.big) {
      p.ring.material = active ? p.ringOn : p.ringOff;
      for (const r of p.rings) r.visible = active;
    } else p.disc.material = active ? p.ringOn : p.ringOff;
  }

  update(dt, time, camPos) {
    this.shared.uTime.value = time;
    if (this.shared.uFlash.value > 0) this.shared.uFlash.value = Math.max(0, this.shared.uFlash.value - dt * 0.8);
    if (this.grass) this.grass.uniforms.uCamPos.value.copy(camPos);
    for (const p of this.pads) {
      p.t += dt;
      if (p.big) {
        const s = p.active ? Math.min(1, p.t * 4) : Math.max(0, 1 - p.t * 6);
        p.orb.visible = p.glow.visible = s > 0.01;
        p.orb.scale.setScalar(s);
        p.orb.position.y = p.glow.position.y = 1.0 + Math.sin(time * 2.2 + p.group.position.x) * 0.08;
        p.glow.scale.setScalar(3.2 * s * (0.9 + 0.1 * Math.sin(time * 9)));
        p.rings[0].rotation.set(time * 1.3, time * 0.7, 0);
        p.rings[1].rotation.set(-time * 0.9, 0, time * 1.1);
        p.rings[0].position.y = p.rings[1].position.y = p.orb.position.y;
      }
    }
  }

  flash(team) {
    this.shared.uFlash.value = 1;
    this.shared.uFlashTeam.value = team;
  }
}

let _glowTex = null;
export function makeGlowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}
