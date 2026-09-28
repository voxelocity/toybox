// Renderer, camera, lighting and floor for the 3D view.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export const ENVIRONMENTS = {
  studio: { file: '/assets/hdri/studio_small_09.hdr', label: 'Studio', exposure: 1.0, floor: 0x9a9a98, bg: 0xdcdcda, rot: 0.6 },
  garage: { file: '/assets/hdri/empty_warehouse_01.hdr', label: 'Warehouse', exposure: 1.05, floor: 0x6f6d69, bg: 0x2a2927, rot: 2.2 },
  sky: { file: '/assets/hdri/kloofendal_48d_partly_cloudy_puresky.hdr', label: 'Open sky', exposure: 0.9, floor: 0x8d8b86, bg: 0xb9c3cc, rot: 0 },
};

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
    this.camera.position.set(5.2, 1.6, 4.6);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.55, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 14;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.update();

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envCache = new Map();

    // key light for crisp shadows; the HDRI does the rest of the lighting
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(2.5, 6, 3.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -4; sun.shadow.camera.right = 4;
    sun.shadow.camera.top = 4; sun.shadow.camera.bottom = -4;
    sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 16;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    this.sun = sun;

    // floor: a large disc that fades out, receives shadows
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x9a9a98, roughness: 0.82, metalness: 0 });
    floorMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>',
        `#include <dithering_fragment>
         float fr = length(vFloorPos.xz);
         gl_FragColor.a *= 1.0 - smoothstep(6.0, 11.0, fr);`);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vFloorPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vFloorPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n varying vec3 vFloorPos;');
    };
    floorMat.transparent = true;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 96), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.floor = floor;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.onFrame = [];
    const loop = () => {
      if (this.controls.enabled) this.controls.update();
      for (const f of this.onFrame) f();
      renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async setEnvironment(name) {
    const env = ENVIRONMENTS[name] || ENVIRONMENTS.studio;
    let tex = this.envCache.get(name);
    if (!tex) {
      const hdr = await new HDRLoader().loadAsync(env.file);
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      tex = this.pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose();
      this.envCache.set(name, tex);
    }
    this.scene.environment = tex;
    this.scene.environmentRotation.y = env.rot;
    this.scene.background = new THREE.Color(env.bg);
    this.floor.material.color.set(env.floor);
    this.renderer.toneMappingExposure = env.exposure;
    this.envName = name;
  }

  /** Smoothly move the camera to a preset. */
  flyTo(pos, target, ms = 900) {
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    const p1 = new THREE.Vector3(...pos), t1 = new THREE.Vector3(...target);
    const start = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.camera.position.lerpVectors(p0, p1, e);
      this.controls.target.lerpVectors(t0, t1, e);
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }
}
