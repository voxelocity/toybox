// WebGL renderer, post-processing chain, sky/environment and sun lighting.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

// Sun direction measured from the sky HDR (elevation 47.9 deg).
const SUN_DIR = new THREE.Vector3(0.5547, 0.742, 0.377).normalize();

// NaN / Inf test on the bit pattern (isnan() may be optimised away).
const BAD_PIXEL_GLSL = (v, repl) => `{ uvec4 bb = floatBitsToUint(${v}); if (any(equal(bb & uvec4(0x7f800000u), uvec4(0x7f800000u)))) ${v} = ${repl}; }`;

const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); ${BAD_PIXEL_GLSL('c', 'vec4(0.0, 0.0, 0.0, 1.0)')} gl_FragColor = clamp(c, vec4(0.0), vec4(60.0)); }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.22 },
    uSaturation: { value: 1.08 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uAberration: { value: 0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uVignette, uSaturation, uFlash, uAberration; uniform vec3 uFlashColor;
    varying vec2 vUv;
    void main(){
      vec2 d = vUv - 0.5;
      vec4 c = texture2D(tDiffuse, vUv);
      ${BAD_PIXEL_GLSL('c', 'vec4(0.0, 0.0, 0.0, 1.0)')}
      c = min(c, vec4(64.0));
      if (uAberration > 0.0) {
        c.r = texture2D(tDiffuse, vUv + d * uAberration).r;
        c.b = texture2D(tDiffuse, vUv - d * uAberration).b;
      }
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSaturation);
      c.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.85, length(d * vec2(1.25, 1.0)));
      c.rgb = mix(c.rgb, uFlashColor, uFlash);
      gl_FragColor = c;
    }`,
};

export class Renderer {
  constructor(canvas, quality) {
    this.canvas = canvas;
    this.q = quality;
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false,
      alpha: false, preserveDrawingBuffer: /[?&]shot\b/.test(location.search),
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 900);
    this.scene.add(this.camera);
    this.sunDir = SUN_DIR.clone();
    this.flash = 0;
    this.flashColor = new THREE.Color(1, 1, 1);
    this.applyQuality(quality);
    window.addEventListener('resize', () => this.resize());
    // GPU resets (driver crash, memory pressure on phones): reload into the
    // menu so the player is not left with a black screen.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('WebGL context lost');
      this.contextLost = true;
      if (this.onContextLost) this.onContextLost();
    });
    canvas.addEventListener('webglcontextrestored', () => { console.warn('WebGL context restored'); location.reload(); });
  }

  applyQuality(q) {
    this.q = q;
    const r = this.renderer;
    r.shadowMap.enabled = q.shadowSize > 0;
    r.shadowMap.type = q.shadowSize >= 2048 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this._setupLights();
    this._setupComposer();
    this.resize();
  }

  _setupLights() {
    const q = this.q;
    if (!this.sun) {
      this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
      this.sun.target.position.set(0, 0, 0);
      this.scene.add(this.sun, this.sun.target);
      this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a6b2a, 0.35);
      this.scene.add(this.hemi);
    }
    const sun = this.sun;
    sun.position.copy(this.sunDir).multiplyScalar(150);
    sun.castShadow = q.shadowSize > 0;
    if (sun.castShadow) {
      sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      const cam = sun.shadow.camera;
      cam.left = -66; cam.right = 66; cam.top = 66; cam.bottom = -66; cam.near = 60; cam.far = 260;
      cam.updateProjectionMatrix();
      sun.shadow.bias = -0.0003;
      sun.shadow.normalBias = 0.03;
      sun.shadow.radius = 3;
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    this.hemi.intensity = q.sky === 'procedural' ? 0.9 : 0.25;
  }

  _setupComposer() {
    const q = this.q;
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    if (!q.bloom) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    // HDR target without MSAA (multisampled half-float + alpha-tested grass is
    // unreliable on some drivers); anti-aliasing is done with SMAA instead.
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    composer.addPass(new ShaderPass(SanitizeShader));
    const bloomRes = q.bloom >= 2 ? 1 : 0.5;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x * bloomRes, size.y * bloomRes), 0.75, 0.5, 1.9);
    // Guard against Inf / NaN from extreme specular highlights in the half
    // float target, which the blur would otherwise smear over the screen.
    const hp = this.bloom.materialHighPassFilter;
    hp.fragmentShader = hp.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );',
      'vec4 texel = texture2D( tDiffuse, vUv ); ' + BAD_PIXEL_GLSL('texel', 'vec4(0.0)') + ' texel = min(texel, vec4(48.0));');
    hp.needsUpdate = true;
    composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    composer.addPass(new OutputPass());
    if (q.msaa) { this.smaa = new SMAAPass(); composer.addPass(this.smaa); } else this.smaa = null;
    this.composer = composer;
  }

  async loadSky(basePath, onProgress) {
    const q = this.q;
    const scene = this.scene;
    if (q.sky === 'procedural') {
      scene.background = makeGradientSky();
      scene.environment = makeSimpleEnv(this.renderer);
      scene.fog = new THREE.Fog(0xb8cde0, 250, 700);
      return;
    }
    const tex = await new Promise((res, rej) => {
      new HDRLoader().load(basePath + q.sky, res, (e) => onProgress && e.total && onProgress(e.loaded / e.total), rej);
    });
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose();
    scene.background = tex;
    scene.environment = env;
    scene.environmentIntensity = 0.9;
    scene.backgroundIntensity = 1.0;
    scene.backgroundBlurriness = 0;
    scene.fog = null;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.q.maxPixelRatio) * (this.q.renderScale || 1) * (this.dynamicScale || 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
  }

  /** Horizontal FOV (degrees) to the vertical FOV three.js expects. */
  setHorizontalFov(hfovDeg) {
    const a = this.camera.aspect;
    const v = 2 * Math.atan(Math.tan((hfovDeg * Math.PI / 180) / 2) / a) * 180 / Math.PI;
    // keep a sane vertical fov in portrait / ultrawide
    this.camera.fov = Math.min(100, Math.max(45, v));
    this.camera.updateProjectionMatrix();
  }

  render(dt) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.2);
    if (this.composer) {
      this.grade.uniforms.uFlash.value = this.flash * 0.6;
      this.grade.uniforms.uFlashColor.value.copy(this.flashColor);
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  doFlash(color, amount = 1) {
    this.flashColor.set(color);
    this.flash = Math.max(this.flash, amount);
  }
}

function makeGradientSky() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#2f6fc0');
  grad.addColorStop(0.45, '#7fb0e2');
  grad.addColorStop(0.5, '#c9dcec');
  grad.addColorStop(0.52, '#8b9a7a');
  grad.addColorStop(1, '#3d4a32');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

function makeSimpleEnv(renderer) {
  // tiny environment from the gradient sky so metals still read as metal
  const scene = new THREE.Scene();
  scene.background = makeGradientSky();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0, 0.1, 100).texture;
  pmrem.dispose();
  return env;
}
