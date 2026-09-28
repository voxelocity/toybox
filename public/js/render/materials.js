// Shared materials: car paint with projected masks, glass, trim, rubber, carbon.
import * as THREE from 'three';
import { SIDE_BOUNDS, PLAN_BOUNDS } from '../cad/body-masks.js';

let flakeTex = null;
/** Tiny random-normal texture used for metallic flake sparkle under the clearcoat. */
function flakeNormalMap() {
  if (flakeTex) return flakeTex;
  const n = 256, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d'), img = g.createImageData(n, n);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n * n; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.55;
    const x = Math.cos(a) * r, y = Math.sin(a) * r, z = Math.sqrt(1 - x * x - y * y);
    img.data[i * 4] = (x * 0.5 + 0.5) * 255;
    img.data[i * 4 + 1] = (y * 0.5 + 0.5) * 255;
    img.data[i * 4 + 2] = (z * 0.5 + 0.5) * 255;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  flakeTex = new THREE.CanvasTexture(c);
  flakeTex.wrapS = flakeTex.wrapT = THREE.RepeatWrapping;
  flakeTex.repeat.set(60, 60);
  flakeTex.colorSpace = THREE.NoColorSpace;
  return flakeTex;
}

export const FINISHES = {
  solid: { metalness: 0.0, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.03, flake: 0 },
  metallic: { metalness: 0.55, roughness: 0.38, clearcoat: 1.0, clearcoatRoughness: 0.03, flake: 0.35 },
  pearl: { metalness: 0.35, roughness: 0.3, clearcoat: 1.0, clearcoatRoughness: 0.03, flake: 0.2, iridescence: 0.35 },
  satin: { metalness: 0.2, roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.45, flake: 0 },
  matte: { metalness: 0.1, roughness: 0.78, clearcoat: 0.0, clearcoatRoughness: 1, flake: 0 },
};

/**
 * GLSL shared by the paint and glass shaders: converts the object-space
 * position to car millimetres and samples the side / plan masks.
 */
const MASK_COMMON = /* glsl */ `
  varying vec3 vCarPos;
  varying vec3 vCarNormal;
  uniform sampler2D uSideMaskL;
  uniform sampler2D uSideMaskR;
  uniform sampler2D uPlanMask;
  uniform vec4 uSideBounds;   // x0, x1, z0, z1  (mm)
  uniform vec4 uPlanBounds;   // x0, x1, w0, w1  (mm)
  uniform float uOffsetX;     // mm added to car x in object space
  uniform vec4 uArch0;        // x, z, r, innerW (mm)
  uniform vec4 uArch1;
  uniform float uUseMasks;
  vec3 carMM() { return vec3(vCarPos.x * 1000.0 - uOffsetX, vCarPos.y * 1000.0, abs(vCarPos.z) * 1000.0); }
  vec4 sideMask(vec3 c) {
    vec2 uv = vec2((c.x - uSideBounds.x) / (uSideBounds.y - uSideBounds.x), (c.y - uSideBounds.z) / (uSideBounds.w - uSideBounds.z));
    vec4 m = vCarPos.z > 0.0 ? texture2D(uSideMaskR, uv) : texture2D(uSideMaskL, uv);
    return vec4(m.rgb, 1.0 - m.a);
  }
  vec4 planMask(vec3 c) {
    vec2 uv = vec2((c.x - uPlanBounds.x) / (uPlanBounds.y - uPlanBounds.x), (c.z - uPlanBounds.z) / (uPlanBounds.w - uPlanBounds.z));
    vec4 m = texture2D(uPlanMask, uv);
    return vec4(m.rgb, 1.0 - m.a);
  }
  // combined mask: rgb = glass, black trim, chrome ; a = shut line darkness
  vec4 bodyMasks(vec3 c, vec3 n) {
    float ws = smoothstep(0.35, 0.7, abs(n.z));
    float wp = smoothstep(0.25, 0.55, n.y);
    vec4 s = sideMask(c) * ws;
    vec4 p = planMask(c) * wp;
    return max(s, p);
  }
  float archCut(vec3 c) {
    float a0 = step(length(vec2(c.x - uArch0.x, c.y - uArch0.y)), uArch0.z) * step(uArch0.w, c.z);
    float a1 = step(length(vec2(c.x - uArch1.x, c.y - uArch1.y)), uArch1.z) * step(uArch1.w, c.z);
    return max(a0, a1);
  }
`;

function injectCommon(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n varying vec3 vCarPos;\n varying vec3 vCarNormal;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n vCarPos = position;\n vCarNormal = normal;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + MASK_COMMON);
}

export function bodyUniforms({ sideL, sideR, plan, offsetX, arches }) {
  return {
    uSideMaskL: { value: sideL },
    uSideMaskR: { value: sideR },
    uPlanMask: { value: plan },
    uSideBounds: { value: new THREE.Vector4(SIDE_BOUNDS.x0, SIDE_BOUNDS.x1, SIDE_BOUNDS.z0, SIDE_BOUNDS.z1) },
    uPlanBounds: { value: new THREE.Vector4(PLAN_BOUNDS.x0, PLAN_BOUNDS.x1, PLAN_BOUNDS.w0, PLAN_BOUNDS.w1) },
    uOffsetX: { value: offsetX },
    uArch0: { value: new THREE.Vector4(arches[0].x, arches[0].z, arches[0].r, arches[0].innerW ?? 420) },
    uArch1: { value: new THREE.Vector4(arches[1].x, arches[1].z, arches[1].r, arches[1].innerW ?? 420) },
    uUseMasks: { value: 1 },
  };
}

/**
 * Car paint. `uniforms` comes from bodyUniforms() and is shared by reference so
 * mask updates reach every material using it.
 */
export function makePaintMaterial(uniforms, { color = '#2b3f5f', finish = 'metallic', glassCut = true } = {}) {
  const f = FINISHES[finish] || FINISHES.metallic;
  const m = new THREE.MeshPhysicalMaterial({
    color, metalness: f.metalness, roughness: f.roughness,
    clearcoat: f.clearcoat, clearcoatRoughness: f.clearcoatRoughness,
    envMapIntensity: 1.0,
  });
  m.alphaToCoverage = true;
  applyFinish(m, finish);
  m.userData.bodyUniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    injectCommon(shader, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        vec3 cm = carMM();
        vec3 cn = normalize(vCarNormal);
        vec4 bm = uUseMasks > 0.5 ? bodyMasks(cm, cn) : vec4(0.0);
        float cut = archCut(cm);
        if (cut > 0.5) discard;
        ${glassCut ? 'float keep = 1.0 - smoothstep(0.35, 0.65, bm.r);' : 'float keep = 1.0;'}
        if (keep < 0.02) discard;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float line = bm.a;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012), bm.g);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95), bm.b);
        diffuseColor.rgb *= 1.0 - 0.9 * line;
        diffuseColor.a = keep;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.3, bm.g);
        roughnessFactor = mix(roughnessFactor, 0.06, bm.b);
        roughnessFactor = mix(roughnessFactor, 0.9, line);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.0, bm.g);
        metalnessFactor = mix(metalnessFactor, 1.0, bm.b);
        metalnessFactor = mix(metalnessFactor, 0.0, line);`);
    // the clearcoat layer should not cover the shut lines and black trim as strongly
    shader.fragmentShader = shader.fragmentShader.replace('#include <clearcoat_normal_fragment_begin>',
      '#include <clearcoat_normal_fragment_begin>');
  };
  m.customProgramCacheKey = () => 'paint-' + (glassCut ? 1 : 0);
  return m;
}

export function applyFinish(m, finish) {
  const f = FINISHES[finish] || FINISHES.metallic;
  m.metalness = f.metalness;
  m.roughness = f.roughness;
  m.clearcoat = f.clearcoat;
  m.clearcoatRoughness = f.clearcoatRoughness;
  if (f.flake > 0) {
    m.normalMap = flakeNormalMap();
    m.normalScale = new THREE.Vector2(f.flake, f.flake);
  } else {
    m.normalMap = null;
  }
  m.iridescence = f.iridescence || 0;
  m.iridescenceIOR = 1.6;
  m.needsUpdate = true;
}

/** Depth material for shadow casting that honours the arch cut-outs and glass. */
export function makeBodyDepthMaterial(uniforms) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vCarPos;\n varying vec3 vCarNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vCarPos = position;\n vCarNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + MASK_COMMON)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (archCut(carMM()) > 0.5) discard;`);
  };
  return m;
}

/** Window glass: only drawn where the masks say glass. */
export function makeGlassMaterial(uniforms, { tint = 0.3 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x0c1012, metalness: 0, roughness: 0.02, transparent: true, opacity: 0.5,
    envMapIntensity: 1.4, clearcoat: 1, clearcoatRoughness: 0.0, side: THREE.DoubleSide,
    depthWrite: false,
  });
  setGlassTint(m, tint);
  m.onBeforeCompile = (shader) => {
    injectCommon(shader, uniforms);
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      vec4 gm = bodyMasks(carMM(), normalize(vCarNormal));
      if (gm.r < 0.5) discard;`);
  };
  m.customProgramCacheKey = () => 'glass';
  return m;
}

/** tint = fraction of light blocked (0 = clear, 0.95 = limo). */
export function setGlassTint(m, tint) {
  const t = Math.max(0, Math.min(0.97, tint));
  m.opacity = 0.28 + 0.66 * t;
  m.color.setRGB(0.05 + 0.1 * (1 - t), 0.07 + 0.1 * (1 - t), 0.08 + 0.1 * (1 - t));
}

export const MATS = {};
export function sharedMaterials() {
  if (MATS.rubber) return MATS;
  MATS.rubber = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.92, metalness: 0 });
  MATS.blackPlastic = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.55, metalness: 0 });
  MATS.texturedPlastic = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85, metalness: 0 });
  MATS.gloss = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02 });
  MATS.chrome = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 1 });
  MATS.satinAlu = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.32, metalness: 1 });
  MATS.castIron = new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 0.75, metalness: 0.6 });
  MATS.steel = new THREE.MeshStandardMaterial({ color: 0x8c8f93, roughness: 0.38, metalness: 1 });
  MATS.darkSteel = new THREE.MeshStandardMaterial({ color: 0x3b3d40, roughness: 0.5, metalness: 0.9 });
  MATS.underbody = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9, metalness: 0.1 });
  MATS.liner = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  MATS.lampClear = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0, transmission: 0, transparent: true, opacity: 0.18, clearcoat: 1, envMapIntensity: 1.5, depthWrite: false });
  MATS.reflector = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.12, metalness: 1 });
  MATS.interior = new THREE.MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.85, metalness: 0 });
  return MATS;
}

let carbonTex = null;
/** Procedural 2x2 twill carbon weave (normal + colour variation). */
export function carbonMaterial() {
  if (!carbonTex) {
    const n = 512, c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    const cells = 16, s = n / cells;
    for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
      const warp = ((i + j * 1) >> 1) % 2 === 0; // 2x2 twill step
      const x = i * s, y = j * s;
      const grad = warp ? g.createLinearGradient(x, y, x + s, y) : g.createLinearGradient(x, y, x, y + s);
      grad.addColorStop(0, '#0a0a0b'); grad.addColorStop(0.5, '#2a2b2e'); grad.addColorStop(1, '#0a0a0b');
      g.fillStyle = grad; g.fillRect(x, y, s, s);
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    }
    carbonTex = new THREE.CanvasTexture(c);
    carbonTex.wrapS = carbonTex.wrapT = THREE.RepeatWrapping;
    carbonTex.colorSpace = THREE.SRGBColorSpace;
    carbonTex.anisotropy = 8;
  }
  const t = carbonTex.clone();
  t.needsUpdate = true;
  t.repeat.set(26, 26);
  return new THREE.MeshPhysicalMaterial({ map: t, color: 0xffffff, metalness: 0.3, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.02 });
}
