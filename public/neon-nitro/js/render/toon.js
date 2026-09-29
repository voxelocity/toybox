// Cel-shaded material system. Every lit surface in the game uses one shader
// (with #defines per variant) so the whole frame shares the same comic look:
// hard light bands, tinted shadows, screen-space halftone dots in the shade,
// a neon rim light and a hard specular pop. Colour management is off
// project-wide: colours are authored in display space and written as-is.
import * as THREE from 'three';

THREE.ColorManagement.enabled = false;

// Uniforms shared by reference across every material. Mutate `.value`.
export const G = {
  uTime: { value: 0 },
  uLightDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
  uLightColor: { value: new THREE.Color(1, 0.97, 0.92) },
  uShadowColor: { value: new THREE.Color(0.42, 0.36, 0.62) },
  uSkyColor: { value: new THREE.Color(0.12, 0.1, 0.22) },
  uGroundColor: { value: new THREE.Color(0.05, 0.03, 0.08) },
  uRimColor: { value: new THREE.Color(1.0, 0.25, 0.7) },
  uRimStrength: { value: 0.55 },
  uFogColor: { value: new THREE.Color(0.1, 0.06, 0.2) },
  uFogNear: { value: 60 },
  uFogFar: { value: 420 },
  uHalftone: { value: 1 },
  uHalftoneScale: { value: 5 },
  uSkyTop: { value: new THREE.Color(0.02, 0.01, 0.08) },
  uSkyHorizon: { value: new THREE.Color(0.5, 0.12, 0.45) },
  uWindowLit: { value: 0.35 },
  uGlitch: { value: 0 },
};

const COMMON_VERT = /* glsl */`
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying vec2 vUv;
#ifdef USE_EMIT_ATTR
attribute float aEmit;
varying float vEmit;
#endif
#ifdef USE_CAR
attribute float aMat;
varying float vMat;
varying vec3 vObjPos;
varying vec3 vObjNormal;
#endif
#ifdef USE_WAVE
uniform float uTime;
#endif
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
  n = mat3(instanceMatrix) * n;
#endif
#ifdef USE_CAR
  vObjPos = position;
  vObjNormal = normal;
  vMat = aMat;
#endif
  vec4 wp = modelMatrix * p;
#ifdef USE_WAVE
  wp.y += sin(wp.x * 0.08 + uTime * 1.3) * 0.35 + cos(wp.z * 0.07 + uTime * 0.9) * 0.35;
#endif
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  vColor = vec3(1.0);
#ifdef USE_COLOR
  vColor = color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor *= instanceColor;
#endif
#ifdef USE_EMIT_ATTR
  vEmit = aEmit;
#endif
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const COMMON_FRAG_HEAD = /* glsl */`
uniform float uTime;
uniform vec3 uLightDir, uLightColor, uShadowColor, uSkyColor, uGroundColor, uRimColor, uFogColor;
uniform float uRimStrength, uFogNear, uFogFar, uHalftone, uHalftoneScale, uWindowLit, uGlitch;
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform float uOpacity;
uniform float uSpec;
uniform float uShine;
uniform float uRim;
uniform float uLitFloor;
#ifdef USE_MAP
uniform sampler2D uMap;
#endif
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying vec2 vUv;
#ifdef USE_EMIT_ATTR
varying float vEmit;
#endif

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }

// 1 inside a halftone dot. darkness 0..1 controls dot radius.
float halftoneDot(float darkness, float scale) {
  vec2 p = gl_FragCoord.xy / scale;
  p = vec2(p.x + p.y, p.y - p.x) * 0.7071;
  vec2 f = fract(p) - 0.5;
  float r = sqrt(clamp(darkness, 0.0, 1.0)) * 0.62;
  float d = length(f);
  float aa = 0.12;
  return 1.0 - smoothstep(r - aa, r + aa, d);
}

vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

// Returns shaded colour for an albedo, plus writes the light band (0 shade .. 1 full)
vec3 toonShade(vec3 albedo, vec3 N, vec3 V, float spec, float shine, float rimAmt, out float band) {
  float ndl = dot(N, uLightDir);
  float lit = smoothstep(-0.03, 0.03, ndl);
  float hi = smoothstep(0.55, 0.6, ndl);
  band = lit * 0.7 + hi * 0.3;
  vec3 hemi = mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5);
  vec3 lightCol = mix(uShadowColor, uLightColor, lit * 0.78 + hi * 0.22);
  lightCol = max(lightCol, vec3(uLitFloor));
  vec3 col = albedo * lightCol + albedo * hemi;
  // halftone in the shade band
  if (uHalftone > 0.0) {
    float shade = (1.0 - lit) * 0.6 + (1.0 - hi) * lit * 0.06;
    float dotm = halftoneDot(shade, uHalftoneScale);
    col *= 1.0 - dotm * 0.28 * uHalftone;
  }
  // hard specular pop
  if (spec > 0.0) {
    vec3 H = normalize(uLightDir + V);
    float s = pow(max(dot(N, H), 0.0), shine);
    col += uLightColor * smoothstep(0.5, 0.56, s) * spec;
  }
  // neon rim
  float fr = 1.0 - max(dot(N, V), 0.0);
  float rim = smoothstep(0.62, 0.68, fr) * rimAmt * uRimStrength * (1.0 - 0.5 * lit) * (0.35 + 0.65 * (1.0 - abs(N.y)));
  col += uRimColor * rim;
  return col;
}

vec3 applyFog(vec3 col, float dist) {
  float f = smoothstep(uFogNear, uFogFar, dist);
  return mix(col, uFogColor, f * f * (3.0 - 2.0 * f) * 0.94);
}
`;

const BASIC_FRAG = /* glsl */`
#ifdef USE_WINDOWS
float windowMask(vec2 uv, out float lit, out vec3 tint) {
  vec2 cell = vec2(2.6, 3.4);
  vec2 id = floor(uv / cell);
  vec2 f = fract(uv / cell);
  float inWin = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.78);
  float h = hash12(id + floor(vColor.r * 97.0));
  float h2 = hash12(id * 1.7 + 3.1);
  lit = step(1.0 - uWindowLit, h);
  tint = h2 < 0.55 ? vec3(1.0, 0.82, 0.5) : (h2 < 0.8 ? vec3(0.55, 0.9, 1.0) : vec3(1.0, 0.45, 0.8));
  return inWin;
}
#endif
void main() {
  vec3 N = normalize(vNormal);
#ifdef DOUBLE_SIDED
  if (!gl_FrontFacing) N = -N;
#endif
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 albedo = uColor * vColor;
  float alpha = uOpacity;
#ifdef USE_MAP
  vec4 tx = texture2D(uMap, vUv);
  albedo *= tx.rgb;
  alpha *= tx.a;
#ifdef ALPHA_TEST
  if (alpha < 0.5) discard;
#endif
#endif
  float band;
  vec3 col;
#ifdef UNLIT
  col = albedo;
  band = 1.0;
#else
  col = toonShade(albedo, N, V, uSpec, uShine, uRim, band);
#endif
#ifdef USE_WINDOWS
  // facades: vUv carries metres along/up the wall; vColor.r seeds the pattern
  if (vUv.y > 0.0) {
    float lit; vec3 tint;
    float wm = windowMask(vUv, lit, tint);
    vec3 glass = mix(albedo * 0.35, uSkyColor * 1.6 + 0.05, 0.5);
    vec3 w = mix(glass, tint * 1.25, lit);
    col = mix(col, w, wm);
  }
#endif
  col += uEmissive;
#ifdef USE_EMIT_ATTR
  col = mix(col, albedo * 1.45, vEmit);
#endif
  float dist = length(cameraPosition - vWorldPos);
  col = applyFog(col, dist);
  gl_FragColor = vec4(col, alpha);
}
`;

// Car paint / trim / chrome / glass / lights all in one draw call. aMat ids:
// 0 trim (vertex colour)  1 paint  2 chrome  3 glass  4 emissive light
// 5 rubber  6 carbon  7 accent paint  8 rim  9 neon (uses uNeon)
const CAR_FRAG = /* glsl */`
uniform vec3 uPaint;
uniform vec3 uAccent;
uniform vec3 uRimCol;
uniform vec3 uNeon;
uniform vec4 uFinish;      // x gloss, y flake, z pearl/chameleon shift, w matte
uniform float uFinishKind; // 0 gloss 1 metallic 2 pearl 3 matte 4 chrome 5 chameleon 6 neon
uniform sampler2D uLivery;
uniform float uLiveryOn;
uniform vec4 uBounds;      // minX, maxX, minY, maxY
uniform float uHalfW;
uniform float uFlash;      // hit flash
uniform float uBrake;      // brake light boost
varying float vMat;
varying vec3 vObjPos;
varying vec3 vObjNormal;

vec3 fakeEnv(vec3 R) {
  // cartoon chrome: sky gradient, bright horizon line, dark ground
  float y = R.y;
  vec3 sky = mix(uSkyColor * 2.2 + 0.25, vec3(0.95, 0.97, 1.0), smoothstep(0.0, 0.5, y));
  vec3 ground = uGroundColor * 1.5 + vec3(0.08, 0.07, 0.1);
  vec3 c = y > 0.0 ? sky : ground;
  c = mix(c, uRimColor * 1.2 + 0.2, smoothstep(0.06, 0.0, abs(y)) );
  return c;
}

vec4 sampleLivery(vec3 p, vec3 n) {
  float u = clamp((p.x - uBounds.x) / (uBounds.y - uBounds.x), 0.0, 1.0);
  float vs = clamp((p.y - uBounds.z) / (uBounds.w - uBounds.z), 0.0, 1.0);
  float vt = clamp(p.z / (uHalfW * 2.0) + 0.5, 0.0, 1.0);
  vec4 side = n.z >= 0.0 ? texture2D(uLivery, vec2(u, 0.75 + vs * 0.25)) : texture2D(uLivery, vec2(u, 0.5 + vs * 0.25));
  vec4 top = texture2D(uLivery, vec2(u, vt * 0.5));
  float ws = smoothstep(0.25, 0.55, abs(n.z));
  float wt = smoothstep(0.35, 0.7, n.y);
  vec4 r = side * ws + top * wt * (1.0 - ws);
  return r;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  int m = int(vMat + 0.5);
  vec3 albedo = vColor;
  float spec = 0.0, shine = 30.0, rimAmt = 1.0;
  vec3 col;
  float band;
  if (m == 1 || m == 7) {
    vec3 paint = m == 1 ? uPaint : uAccent;
    if (m == 1 && uLiveryOn > 0.5) {
      vec4 lv = sampleLivery(vObjPos, normalize(vObjNormal));
      paint = mix(paint, lv.rgb, lv.a);
    }
    float fr = 1.0 - max(dot(N, V), 0.0);
    if (uFinishKind > 4.5 && uFinishKind < 5.5) paint = hueShift(paint, fr * 2.6 + 0.4 * sin(vWorldPos.x * 0.2));
    if (uFinishKind > 1.5 && uFinishKind < 2.5) paint = mix(paint, hueShift(paint, 0.7) * 1.15, smoothstep(0.35, 0.8, fr) * 0.6);
    albedo = paint;
    spec = uFinish.x; shine = 40.0;
    if (uFinishKind > 3.5 && uFinishKind < 4.5) {
      vec3 R = reflect(-V, N);
      vec3 env = fakeEnv(R);
      float ndl = dot(N, uLightDir);
      col = paint * (0.35 + env * 0.9) * (0.75 + 0.25 * step(0.0, ndl));
      col += uLightColor * smoothstep(0.5, 0.56, pow(max(dot(N, normalize(uLightDir + V)), 0.0), 60.0)) * 0.9;
      band = 1.0;
    } else {
      col = toonShade(albedo, N, V, spec, shine, 1.0, band);
      if (uFinish.y > 0.0) {
        float fl = hash13(floor(vObjPos * 110.0));
        col += step(0.988, fl) * uFinish.y * 0.6 * band * uLightColor;
      }
      if (uFinishKind > 5.5) col += paint * (0.35 + 0.65 * smoothstep(0.45, 0.75, fr)) * 0.9;
    }
  } else if (m == 2) {
    vec3 R = reflect(-V, N);
    col = fakeEnv(R) * vColor * 1.05;
    col += uRimColor * smoothstep(0.62, 0.7, 1.0 - max(dot(N, V), 0.0)) * 0.4;
    band = 1.0;
  } else if (m == 3) {
    vec3 R = reflect(-V, N);
    float fr = 1.0 - max(dot(N, V), 0.0);
    vec3 base = vec3(0.07, 0.1, 0.18) + uSkyColor * 0.4;
    col = base + fakeEnv(R) * 0.18 * (0.4 + fr);
    // diagonal highlight streaks
    float s = fract((vObjPos.x * 1.2 + vObjPos.y * 2.2) * 0.9);
    col += vec3(0.55, 0.65, 0.8) * step(0.86, s) * step(s, 0.93) * 0.6;
    band = 0.5;
  } else if (m == 4) {
    col = vColor * (1.7 + uBrake * vColor.r * step(0.6, vColor.r) * step(vColor.g, 0.3) * 1.5);
    band = 1.0;
  } else if (m == 9) {
    col = uNeon * 1.9;
    band = 1.0;
  } else if (m == 5) {
    col = toonShade(vColor, N, V, 0.0, 10.0, 0.4, band);
  } else if (m == 6) {
    vec2 q = floor(vec2(vObjPos.x + vObjPos.y, vObjPos.z + vObjPos.y) * 22.0);
    float weave = mod(q.x + q.y, 2.0);
    albedo = mix(vec3(0.05, 0.05, 0.06), vec3(0.13, 0.13, 0.15), weave);
    col = toonShade(albedo, N, V, 0.8, 50.0, 1.0, band);
  } else if (m == 8) {
    albedo = uRimCol;
    col = toonShade(albedo, N, V, 0.7, 30.0, 1.0, band);
    vec3 R = reflect(-V, N);
    col += fakeEnv(R) * 0.15;
  } else {
    col = toonShade(albedo, N, V, 0.15, 20.0, 0.6, band);
  }
  col = mix(col, vec3(1.0, 0.95, 0.9), uFlash);
  float dist = length(cameraPosition - vWorldPos);
  col = applyFog(col, dist);
  gl_FragColor = vec4(col, 1.0);
}
`;

function baseUniforms(o) {
  return {
    ...G,
    uColor: { value: new THREE.Color(o.color ?? 0xffffff) },
    uEmissive: { value: new THREE.Color(o.emissive ?? 0x000000) },
    uOpacity: { value: o.opacity ?? 1 },
    uSpec: { value: o.spec ?? 0 },
    uShine: { value: o.shine ?? 24 },
    uRim: { value: o.rim ?? 0.6 },
    uLitFloor: { value: o.litFloor ?? 0 },
    uMap: { value: o.map ?? null },
  };
}

/**
 * General cel material.
 * opts: color, map, vertexColors, emissive, spec, shine, rim, unlit, windows,
 *       emitAttr, side, transparent, opacity, alphaTest, wave, depthWrite
 */
export function toonMaterial(o = {}) {
  const defines = {};
  if (o.map) defines.USE_MAP = '';
  if (o.unlit) defines.UNLIT = '';
  if (o.windows) defines.USE_WINDOWS = '';
  if (o.emitAttr) defines.USE_EMIT_ATTR = '';
  if (o.alphaTest) defines.ALPHA_TEST = '';
  if (o.wave) defines.USE_WAVE = '';
  if (o.side === THREE.DoubleSide) defines.DOUBLE_SIDED = '';
  const mat = new THREE.ShaderMaterial({
    uniforms: baseUniforms(o),
    vertexShader: COMMON_VERT,
    fragmentShader: COMMON_FRAG_HEAD + BASIC_FRAG,
    defines,
    vertexColors: !!o.vertexColors,
    side: o.side ?? THREE.FrontSide,
    transparent: !!o.transparent,
    depthWrite: o.depthWrite ?? !o.transparent,
    fog: false,
    lights: false,
  });
  if (o.polygonOffset) { mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2; }
  return mat;
}

export function carMaterial() {
  const u = {
    ...baseUniforms({}),
    uPaint: { value: new THREE.Color(0xff2d6f) },
    uAccent: { value: new THREE.Color(0x111111) },
    uRimCol: { value: new THREE.Color(0xdddddd) },
    uNeon: { value: new THREE.Color(0x00e5ff) },
    uFinish: { value: new THREE.Vector4(0.8, 0, 0, 0) },
    uFinishKind: { value: 0 },
    uLivery: { value: null },
    uLiveryOn: { value: 0 },
    uBounds: { value: new THREE.Vector4(-2.2, 2.2, 0, 1.4) },
    uHalfW: { value: 0.95 },
    uFlash: { value: 0 },
    uBrake: { value: 0 },
  };
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: COMMON_VERT,
    fragmentShader: COMMON_FRAG_HEAD + CAR_FRAG,
    defines: { USE_CAR: '' },
    vertexColors: true,
    fog: false,
    lights: false,
  });
}

// Sky dome: vertical gradient, sun/moon disc, stars, drifting cloud bands.
export function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...G,
      uMoonDir: { value: new THREE.Vector3(-0.3, 0.35, -0.9).normalize() },
      uMoonColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uMoonSize: { value: 0.06 },
      uStars: { value: 1 },
      uCloudColor: { value: new THREE.Color(0.35, 0.1, 0.35) },
      uSun: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSkyTop, uSkyHorizon, uFogColor, uMoonColor, uMoonDir, uCloudColor;
      uniform float uMoonSize, uStars, uTime, uSun;
      varying vec3 vDir;
      float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, 0.55, h));
        col = mix(uFogColor, col, smoothstep(-0.05, 0.12, h));
        // posterise the gradient into comic bands
        float bands = floor(smoothstep(-0.05, 0.6, h) * 7.0) / 7.0;
        col = mix(col, mix(uSkyHorizon, uSkyTop, bands), 0.35);
        // stars
        if (uStars > 0.0 && h > 0.05) {
          vec2 sp = vec2(atan(d.z, d.x) * 120.0, h * 140.0);
          vec2 id = floor(sp);
          float s = hash12(id);
          vec2 f = fract(sp) - 0.5;
          float star = step(0.985, s) * smoothstep(0.25, 0.0, length(f)) * (0.6 + 0.4 * sin(uTime * 2.0 + s * 50.0));
          col += vec3(star) * uStars * smoothstep(0.05, 0.3, h);
        }
        // moon / sun disc with ink ring
        float md = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
        float disc = smoothstep(uMoonSize, uMoonSize - 0.004, md);
        float ring = smoothstep(uMoonSize + 0.006, uMoonSize + 0.002, md) - disc;
        float glow = smoothstep(uMoonSize * 5.0, uMoonSize, md) * 0.35;
        vec3 moon = uMoonColor;
        if (uSun < 0.5) {
          // crater halftone on the moon
          vec2 mp = vec2(dot(d, normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)))), d.y - uMoonDir.y) * 180.0;
          float cr = step(0.8, hash12(floor(mp * 0.35))) * 0.12;
          moon -= cr;
        }
        col = mix(col, moon, disc);
        col = mix(col, vec3(0.05, 0.02, 0.1), ring * 0.8);
        col += uMoonColor * glow * (1.0 - disc);
        // cloud streaks
        float cb = sin(atan(d.z, d.x) * 3.0 + uTime * 0.01) * 0.5 + 0.5;
        float band = smoothstep(0.08, 0.12, h) * smoothstep(0.26, 0.18, h) * step(0.45, fract(atan(d.z, d.x) * 2.0 + cb));
        col = mix(col, uCloudColor, band * 0.55);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    lights: false,
  });
}

// Transparent additive glow used for neon halos, headlight cones, boost flames.
export function glowMaterial(color = 0xffffff, opacity = 1, extra = {}) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, ...extra,
  });
}

/** Apply a theme palette to the shared uniforms. */
export function applyTheme(t) {
  const set = (k, v) => { if (v !== undefined) G[k].value.set(v); };
  set('uLightColor', t.light);
  set('uShadowColor', t.shadow);
  set('uSkyColor', t.sky);
  set('uGroundColor', t.ground);
  set('uRimColor', t.rim);
  set('uFogColor', t.fog);
  set('uSkyTop', t.skyTop);
  set('uSkyHorizon', t.skyHorizon);
  if (t.lightDir) G.uLightDir.value.set(...t.lightDir).normalize();
  if (t.rimStrength !== undefined) G.uRimStrength.value = t.rimStrength;
  if (t.fogNear !== undefined) G.uFogNear.value = t.fogNear;
  if (t.fogFar !== undefined) G.uFogFar.value = t.fogFar;
  if (t.windowLit !== undefined) G.uWindowLit.value = t.windowLit;
}
