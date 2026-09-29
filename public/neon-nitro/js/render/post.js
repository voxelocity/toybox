// Frame pipeline: scene -> (MSAA) target with depth -> comic composite.
// The composite draws ink outlines from the depth buffer (Laplacian of
// inverse depth catches silhouettes and creases but ignores flat planes at
// any angle), adds neon bloom, manga speed lines, hit flashes, glitch and a
// light colour grade.
import * as THREE from 'three';

const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMPOSITE_FRAG = /* glsl */`
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform vec2 uTexel;
uniform float uNear, uFar;
uniform float uEdge, uEdgeWidth, uEdgeFade, uCrease, uCreaseFade;
uniform vec3 uInk;
uniform float uBloom;
uniform float uSpeed;
uniform float uTime;
uniform float uAspect;
uniform vec3 uFlashColor;
uniform float uFlash;
uniform float uAberr;
uniform float uVignette;
uniform float uSat;
uniform float uGlitch;
uniform float uFocus;
varying vec2 vUv;

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

uniform vec2 uTanFov;
vec3 viewPos(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) * uTanFov * z, -z); }
float viewZi(ivec2 p) {
  return -perspectiveDepthToViewZ(texelFetch(tDepth, p, 0).x, uNear, uFar);
}
vec3 viewPosI(ivec2 p, float z) { return viewPos((vec2(p) + 0.5) * uTexel, z); }
float viewZ(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return -perspectiveDepthToViewZ(d, uNear, uFar);
}

void main() {
  vec2 uv = vUv;
  if (uGlitch > 0.0) {
    float row = floor(uv.y * 40.0);
    float g = step(1.0 - uGlitch * 0.5, hash11(row + floor(uTime * 20.0)));
    uv.x += g * (hash11(row * 3.1 + floor(uTime * 30.0)) - 0.5) * 0.08 * uGlitch;
  }
  vec3 col;
  if (uAberr > 0.001) {
    vec2 dir = (uv - 0.5) * uAberr * 0.02;
    col = vec3(texture2D(tColor, uv + dir).r, texture2D(tColor, uv).g, texture2D(tColor, uv - dir).b);
  } else {
    col = texture2D(tColor, uv).rgb;
  }

  // ---- ink outlines: silhouettes from depth ratio, creases from the bend
  // angle between view-space position deltas (scale-independent). Exact
  // texel fetches keep reconstructed positions consistent with the depth.
  if (uEdge > 0.0) {
    ivec2 pc = ivec2(gl_FragCoord.xy);
    ivec2 mx = ivec2(textureSize(tDepth, 0)) - 1;
    int k = int(uEdgeWidth + 0.5);
    ivec2 pl = clamp(pc - ivec2(k, 0), ivec2(0), mx), pr = clamp(pc + ivec2(k, 0), ivec2(0), mx);
    ivec2 pu = clamp(pc + ivec2(0, k), ivec2(0), mx), pd = clamp(pc - ivec2(0, k), ivec2(0), mx);
    float z0 = viewZi(pc);
    float zl = viewZi(pl), zr = viewZi(pr), zu = viewZi(pu), zd = viewZi(pd);
    float zmax = max(max(zl, zr), max(zu, zd));
    float zmin = min(min(zl, zr), min(zu, zd));
    float sil = max(smoothstep(1.06, 1.2, zmax / z0), smoothstep(0.94, 0.83, zmin / z0));
    vec3 P0 = viewPosI(pc, z0);
    vec3 a = P0 - viewPosI(pl, zl);
    vec3 b = viewPosI(pr, zr) - P0;
    vec3 c = P0 - viewPosI(pd, zd);
    vec3 d = viewPosI(pu, zu) - P0;
    float cx = dot(normalize(a), normalize(b));
    float cy = dot(normalize(c), normalize(d));
    float crease = smoothstep(uCrease + 0.04, uCrease - 0.04, min(cx, cy)) * (1.0 - smoothstep(uCreaseFade * 0.6, uCreaseFade, z0));
    float edge = max(crease, sil);
    float fade = 1.0 - smoothstep(uEdgeFade * 0.35, uEdgeFade, z0);
    if (z0 > uFar * 0.98) fade = 0.0;
    col = mix(col, uInk, edge * fade * uEdge);
  }

  // ---- bloom
  if (uBloom > 0.0) col += texture2D(tBloom, vUv).rgb * uBloom;

  // soft shoulder so HDR neon does not clip to flat white
  col = col / (1.0 + max(col - 0.85, 0.0) * 0.6);

  // ---- grade
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat);

  // ---- manga speed lines (focus lines)
  vec2 c = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(c);
  if (uSpeed > 0.0) {
    float a = atan(c.y, c.x);
    float seg = floor(a * 38.0 + floor(uTime * 18.0) * 7.0);
    float on = step(0.72, hash11(seg));
    float w = fract(a * 38.0 + floor(uTime * 18.0) * 7.0);
    float thin = smoothstep(0.5, 0.35, abs(w - 0.5)) ;
    float reach = mix(0.95, 0.42, hash11(seg * 1.7)) ;
    float m = on * thin * smoothstep(reach, reach + 0.25, r) * uSpeed;
    col = mix(col, vec3(1.0), m * 0.55);
  }
  // concentrated focus burst (item hits, finish)
  if (uFocus > 0.0) {
    float a = atan(c.y, c.x);
    float seg = floor(a * 70.0);
    float on = step(0.5, hash11(seg + floor(uTime * 12.0)));
    col = mix(col, uInk, on * smoothstep(0.3, 0.75, r) * uFocus * 0.6);
  }

  // ---- vignette + flash
  col *= 1.0 - smoothstep(0.55, 1.05, r) * uVignette;
  col = mix(col, uFlashColor, uFlash);
  gl_FragColor = vec4(col, 1.0);
}`;

const BRIGHT_FRAG = /* glsl */`
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 s = vec3(0.0);
  s += texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  s += texture2D(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  s += texture2D(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  s += texture2D(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  s *= 0.25;
  float l = max(max(s.r, s.g), s.b);
  float k = smoothstep(uThreshold, uThreshold + 0.35, l);
  gl_FragColor = vec4(s * k, 1.0);
}`;

const BLUR_FRAG = /* glsl */`
uniform sampler2D tColor;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tColor, vUv).rgb * 0.227;
  s += texture2D(tColor, vUv + uDir * 1.385).rgb * 0.316;
  s += texture2D(tColor, vUv - uDir * 1.385).rgb * 0.316;
  s += texture2D(tColor, vUv + uDir * 3.231).rgb * 0.07;
  s += texture2D(tColor, vUv - uDir * 3.231).rgb * 0.07;
  gl_FragColor = vec4(s, 1.0);
}`;

function fsMaterial(frag, uniforms) {
  return new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, fog: false, lights: false });
}

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    const gl = renderer.getContext();
    const floatOK = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    this.colorType = floatOK ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 0;
    this.samples = 0;
    this.bloomOn = true;
    this.edgesOn = true;
    this.width = 1; this.height = 1;

    this.fsScene = new THREE.Scene();
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    this.fsMesh = new THREE.Mesh(tri, null);
    this.fsMesh.frustumCulled = false;
    this.fsScene.add(this.fsMesh);

    this.composite = fsMaterial(COMPOSITE_FRAG, {
      tColor: { value: null }, tDepth: { value: null }, tBloom: { value: null },
      uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 1000 },
      uEdge: { value: 1 }, uEdgeWidth: { value: 1 }, uEdgeFade: { value: 300 }, uCrease: { value: 0.8 }, uCreaseFade: { value: 600 }, uTanFov: { value: new THREE.Vector2(1, 1) },
      uInk: { value: new THREE.Color(0.05, 0.02, 0.09) },
      uBloom: { value: 0.9 }, uSpeed: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 },
      uFlashColor: { value: new THREE.Color(1, 1, 1) }, uFlash: { value: 0 }, uAberr: { value: 0 },
      uVignette: { value: 0.35 }, uSat: { value: 1.12 }, uGlitch: { value: 0 }, uFocus: { value: 0 },
    });
    this.bright = fsMaterial(BRIGHT_FRAG, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.05 } });
    this.blur = fsMaterial(BLUR_FRAG, { tColor: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.fx = this.composite.uniforms;
    this._alloc(2, 2);
  }

  _alloc(w, h) {
    this.rtMain?.dispose(); this.rtB1?.dispose(); this.rtB2?.dispose();
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.FloatType;
    this.rtMain = new THREE.WebGLRenderTarget(w, h, {
      type: this.colorType, samples: Math.min(this.samples, this.maxSamples), depthTexture,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    const o = { type: this.colorType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.rtB1 = new THREE.WebGLRenderTarget(bw, bh, o);
    this.rtB2 = new THREE.WebGLRenderTarget(bw, bh, o);
    this.width = w; this.height = h;
  }

  setSize(w, h, samples = this.samples) {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (w === this.width && h === this.height && samples === this.samples) return;
    this.samples = samples;
    this._alloc(w, h);
  }

  _pass(mat, target) {
    this.fsMesh.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsScene, this.fsCam);
  }

  render(scene, camera, time) {
    const r = this.renderer;
    r.setRenderTarget(this.rtMain);
    r.render(scene, camera);
    this.stats = { calls: r.info.render.calls, tris: r.info.render.triangles };
    const bloom = this.bloomOn && this.fx.uBloom.value > 0;
    if (bloom) {
      this.bright.uniforms.tColor.value = this.rtMain.texture;
      this.bright.uniforms.uTexel.value.set(1 / this.width, 1 / this.height);
      this._pass(this.bright, this.rtB1);
      const bw = this.rtB1.width, bh = this.rtB1.height;
      for (let i = 0; i < 2; i++) {
        const s = 1 + i * 1.5;
        this.blur.uniforms.tColor.value = this.rtB1.texture;
        this.blur.uniforms.uDir.value.set(s / bw, 0);
        this._pass(this.blur, this.rtB2);
        this.blur.uniforms.tColor.value = this.rtB2.texture;
        this.blur.uniforms.uDir.value.set(0, s / bh);
        this._pass(this.blur, this.rtB1);
      }
    }
    const f = this.fx;
    f.tColor.value = this.rtMain.texture;
    f.tDepth.value = this.rtMain.depthTexture;
    f.tBloom.value = this.rtB1.texture;
    f.uTexel.value.set(1 / this.width, 1 / this.height);
    f.uNear.value = camera.near; f.uFar.value = camera.far;
    f.uTime.value = time;
    f.uAspect.value = this.width / this.height;
    f.uEdgeWidth.value = Math.max(1.5, this.height / 450);
    const ty = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    f.uTanFov.value.set(ty * camera.aspect, ty);
    const saveBloom = f.uBloom.value, saveEdge = f.uEdge.value;
    if (!bloom) f.uBloom.value = 0;
    if (!this.edgesOn) f.uEdge.value = 0;
    this._pass(this.composite, null);
    f.uBloom.value = saveBloom; f.uEdge.value = saveEdge;
  }
}
