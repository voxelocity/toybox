// The ball: a panelled sphere (12 pentagons + 20 hexagons) with recessed,
// glowing seams that take the colour of the last team to touch it.
import * as THREE from 'three';
import { BALL_RADIUS } from '../physics/constants.js';
import { S } from './convert.js';

function panelCentres() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const out = [];
  // pentagons: icosahedron vertices
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    out.push([0, a, b * phi], [a, b * phi, 0], [b * phi, 0, a]);
  }
  // hexagons: dodecahedron vertices
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) out.push([a, b, c]);
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    out.push([0, a / phi, b * phi], [a / phi, b * phi, 0], [b * phi, 0, a / phi]);
  }
  return out.map(([x, y, z]) => { const l = Math.hypot(x, y, z); return new THREE.Vector3(x / l, y / l, z / l); });
}

export class BallView {
  constructor(scene, quality) {
    const centres = panelCentres();
    this.uniforms = {
      uCentres: { value: centres },
      uSeam: { value: new THREE.Color(0.9, 0.95, 1.0) },
      uGlow: { value: 0.6 },
    };
    const physical = quality.physicalMaterials;
    const mat = physical
      ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.25 })
      : new THREE.MeshLambertMaterial({ color: 0xffffff });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = normalize(position);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vObj; uniform vec3 uCentres[32]; uniform vec3 uSeam; uniform float uGlow;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 n = normalize(vObj);
          float d1 = -2.0, d2 = -2.0; int id = 0;
          for (int i = 0; i < 32; i++) {
            float d = dot(n, uCentres[i]);
            if (d > d1) { d2 = d1; d1 = d; id = i; } else if (d > d2) { d2 = d; }
          }
          float edge = d1 - d2;
          float fw = fwidth(edge) + 1e-4;
          float seam = 1.0 - smoothstep(0.012 - fw, 0.012 + fw, edge);
          float inner = 1.0 - smoothstep(0.03, 0.07, edge);
          bool pent = id < 12;
          vec3 panel = pent ? vec3(0.07, 0.08, 0.10) : vec3(0.62, 0.64, 0.67);
          // subtle inner bevel ring on each panel
          panel *= 1.0 - 0.18 * inner;
          diffuseColor.rgb = mix(panel, vec3(0.03), seam);
          float ballSeam = seam;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = pent ? 0.3 : 0.55;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += uSeam * ballSeam * uGlow * 3.5;`);
    };
    mat.customProgramCacheKey = () => 'ball';
    const geo = new THREE.SphereGeometry(BALL_RADIUS * S, quality.stadiumDetail >= 1 ? 64 : 32, quality.stadiumDetail >= 1 ? 48 : 24);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.targetSeam = new THREE.Color(0.9, 0.95, 1.0);
  }

  setTouchTeam(team) {
    this.targetSeam.set(team === 0 ? 0x3d8bff : team === 1 ? 0xff7a22 : 0xe8eeff);
    this.uniforms.uGlow.value = 1.6;
  }

  update(dt, speed) {
    this.uniforms.uSeam.value.lerp(this.targetSeam, Math.min(1, dt * 6));
    const base = 0.35 + Math.min(1, speed / 3000) * 0.9;
    this.uniforms.uGlow.value += (base - this.uniforms.uGlow.value) * Math.min(1, dt * 2);
  }
}
