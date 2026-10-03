// Field / grass shading.
//
// The pitch is drawn as a lit base surface plus N "shells": copies of the
// floor offset along the normal. Each shell keeps only the fragments that lie
// inside a grass blade at that height (blades are hashed per cell, taper
// towards the tip, sway in the wind and are pushed flat by cars and the ball).
// Mowing stripes, field markings and team tints come from one shared function
// so the base surface, the blades and the far-distance fallback all agree.
import * as THREE from 'three';
import { ARENA } from '../physics/constants.js';

const A = ARENA.X - ARENA.R, B = ARENA.Y - ARENA.R, C = ARENA.CORNER - ARENA.R * Math.SQRT2;

export const FIELD_GLSL = /* glsl */`
uniform vec3 uTeamBlue;
uniform vec3 uTeamOrange;
uniform float uTime;
float g_hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 g_hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float g_noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(g_hash12(i), g_hash12(i + vec2(1, 0)), u.x), mix(g_hash12(i + vec2(0, 1)), g_hash12(i + vec2(1, 1)), u.x), u.y); }
float g_fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * g_noise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
float g_line(float d, float w){ float fw = max(fwidth(d), 1e-3); return 1. - smoothstep(w - fw, w + fw, abs(d)); }

// p: field position in uu (x right, y toward orange goal)
vec3 fieldColor(vec2 p, out float paint, out vec3 glow) {
  float ax = abs(p.x), ay = abs(p.y);
  // mowing stripes across the pitch + a softer checker along x
  float stripe = mod(floor((p.y + 5120.) / 640.), 2.);
  float check = mod(floor((p.x + 4096.) / 1024.), 2.);
  vec3 g1 = vec3(0.060, 0.175, 0.030), g2 = vec3(0.095, 0.255, 0.045);
  vec3 col = mix(g1, g2, stripe * 0.85 + check * 0.15);
  float n = g_fbm(p * 0.0011);
  col *= 0.80 + 0.40 * n;
  float dry = smoothstep(0.58, 0.85, g_fbm(p * 0.00035 + 7.3));
  col = mix(col, col * vec3(1.25, 1.12, 0.62), dry * 0.35);
  col *= 0.92 + 0.16 * g_noise(p * 0.05);
  // team halves: gentle tint that grows toward each goal
  float side = clamp(p.y / 5120., -1., 1.);
  vec3 tint = side < 0. ? uTeamBlue : uTeamOrange;
  float tAmt = smoothstep(0.15, 1.0, abs(side)) * 0.22;
  col = mix(col, col * (0.55 + tint * 1.1), tAmt);
  // markings
  float w = 13.0, L = 0.;
  L = max(L, g_line(p.y, w));
  float r = length(p);
  L = max(L, g_line(r - 960., w));
  L = max(L, 1. - smoothstep(42., 46., r));
  // centre emblem: hexagon ring
  vec2 q = abs(p);
  float hex = max(q.x * 0.866025 + q.y * 0.5, q.y) - 560.;
  L = max(L, g_line(hex, w * 0.8) * 0.75);
  L = max(L, g_line(hex + 70., w * 0.5) * 0.45);
  // goal boxes
  float box = max(g_line(ax - 1460., w) * step(4000., ay), g_line(ay - 4000., w) * step(ax, 1460.));
  float small = max(g_line(ax - 1160., w) * step(4560., ay), g_line(ay - 4560., w) * step(ax, 1160.));
  L = max(L, max(box, small) * step(ay, 5120.));
  // boundary line, inset from the ramp start
  float dOct = max(max(ax - ${A.toFixed(1)}, ay - ${B.toFixed(1)}), (ax + ay - ${C.toFixed(1)}) * 0.70710678);
  L = max(L, g_line(dOct + 80., w));
  paint = L;
  col = mix(col, vec3(0.80, 0.83, 0.80), L * 0.88);
  // goal mouth line glows in the defending team colour
  float gl = g_line(ay - 5120., 22.) * step(ax, 893.);
  glow = (p.y < 0. ? uTeamBlue : uTeamOrange) * gl * 3.0;
  // team tinted wash inside the goal box
  float inBox = step(4000., ay) * step(ax, 1460.) * step(ay, 5120.);
  col = mix(col, col * (0.5 + tint * 1.3), inBox * 0.25);
  return col;
}
`;

function fieldUniforms(shared) {
  return shared || {
    uTeamBlue: { value: new THREE.Color(0.18, 0.45, 1.0) },
    uTeamOrange: { value: new THREE.Color(1.0, 0.45, 0.08) },
    uTime: { value: 0 },
  };
}

/** Base field surface (floor, ramps, goal floors). */
export function makeFieldMaterial(shared, lowQuality = false) {
  const uniforms = fieldUniforms(shared);
  const mat = lowQuality
    ? new THREE.MeshLambertMaterial({ color: 0xffffff })
    : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\n' + FIELD_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float fPaint; vec3 fGlow;
        vec2 fp = vec2(vWPos.x, -vWPos.z) * 100.0;
        vec3 fcol = fieldColor(fp, fPaint, fGlow);
        // fine blade speckle so the base reads as turf even without shells
        float sp = g_hash12(floor(fp * 0.55));
        fcol *= 0.78 + 0.3 * sp;
        diffuseColor.rgb = fcol * ${lowQuality ? '1.05' : '0.82'};`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += fGlow + vec3(fPaint * 0.06);`);
  };
  mat.customProgramCacheKey = () => 'field' + (lowQuality ? 'L' : 'H');
  return { material: mat, uniforms };
}

/**
 * Grass shells: an instanced copy of the field geometry, one instance per
 * shell. `pushers` is a uniform array of vec4(x, y, radius, strength) in uu.
 */
export function makeGrassShells(geometry, shells, shared, opts = {}) {
  const uniforms = fieldUniforms(shared);
  const height = opts.height || 7.5;    // uu
  const density = opts.density || 0.62; // blades per uu
  const pushers = [];
  for (let i = 0; i < 8; i++) pushers.push(new THREE.Vector4(0, 0, 0, 0));
  Object.assign(uniforms, {
    uPushers: { value: pushers },
    uCamPos: { value: new THREE.Vector3() },
    uShellCount: { value: shells },
    uFadeNear: { value: opts.fadeNear || 14 },
    uFadeFar: { value: opts.fadeFar || 34 },
  });
  const g = new THREE.InstancedBufferGeometry();
  g.index = geometry.index;
  for (const k of ['position', 'normal', 'uv']) g.setAttribute(k, geometry.getAttribute(k));
  const shellAttr = new Float32Array(shells);
  for (let i = 0; i < shells; i++) shellAttr[i] = (i + 1) / shells;
  g.setAttribute('aShell', new THREE.InstancedBufferAttribute(shellAttr, 1));
  g.instanceCount = shells;
  g.boundingSphere = geometry.boundingSphere || (geometry.computeBoundingSphere(), geometry.boundingSphere);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aShell;
        varying vec3 vWPos; varying float vShell; varying vec2 vBladeUv;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed += normal * (${(height * 0.01).toFixed(4)} * aShell);
        vShell = aShell; vBladeUv = uv;`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying float vShell; varying vec2 vBladeUv;
        uniform vec4 uPushers[8]; uniform vec3 uCamPos; uniform float uShellCount, uFadeNear, uFadeFar;
        ${FIELD_GLSL}
        // returns blade presence (0/1) and per-blade random in .y
        vec2 blade(vec2 bp, float t, float scale) {
          vec2 cell = floor(bp);
          vec2 f = fract(bp);
          vec2 h = g_hash22(cell * scale + 3.7);
          float hgt = 0.35 + 0.65 * g_hash12(cell * 1.31 + scale);
          if (t > hgt) return vec2(0.0);
          vec2 c = 0.2 + 0.6 * h;
          float r = 0.5 * (1.0 - t / hgt) + 0.04;
          return vec2(step(length(f - c), r), h.x);
        }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float camDist = distance(vWPos, uCamPos);
        float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, camDist);
        if (vShell > fade + 0.02) discard;
        vec2 fieldP = vec2(vWPos.x, -vWPos.z) * 100.0;
        float t = vShell;
        // wind sway grows with blade height
        vec2 sway = vec2(sin(uTime * 1.7 + fieldP.x * 0.011 + fieldP.y * 0.004),
                         cos(uTime * 1.3 + fieldP.y * 0.013 - fieldP.x * 0.003)) * 0.35;
        sway += vec2(sin(uTime * 4.1 + fieldP.y * 0.07), cos(uTime * 3.7 + fieldP.x * 0.06)) * 0.08;
        // pushed flat around cars / ball
        vec2 push = vec2(0.0);
        float flat_ = 0.0;
        for (int i = 0; i < 8; i++) {
          vec4 P = uPushers[i];
          if (P.w <= 0.0) continue;
          vec2 d = fieldP - P.xy;
          float dl = length(d);
          float k = (1.0 - smoothstep(P.z * 0.35, P.z, dl)) * P.w;
          push += (dl > 0.01 ? d / dl : vec2(0.0)) * k * 2.2;
          flat_ = max(flat_, k);
        }
        float tt = t / max(0.25, 1.0 - flat_ * 0.7);
        vec2 off = (sway * t * t + push * t);
        vec2 bp = vBladeUv * ${density.toFixed(3)} + off;
        vec2 b1 = blade(bp, tt, 1.0);
        vec2 b2 = blade(bp * 1.37 + vec2(0.31, 0.77), tt, 2.0);
        float present = max(b1.x, b2.x);
        if (present < 0.5) discard;
        float bladeRnd = b1.x > 0.5 ? b1.y : b2.y;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float fPaint; vec3 fGlow;
        vec3 fcol = fieldColor(fieldP, fPaint, fGlow);
        float ao = mix(0.42, 1.18, t);
        vec3 tipTint = mix(vec3(1.0), vec3(1.18, 1.12, 0.78), smoothstep(0.7, 1.0, t) * 0.5);
        fcol *= ao * tipTint * (0.82 + 0.36 * bladeRnd);
        diffuseColor.rgb = fcol;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += fGlow * t + vec3(fPaint * 0.05);`);
  };
  mat.customProgramCacheKey = () => 'grassShell';
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = 1;
  return { mesh, uniforms, pushers };
}
