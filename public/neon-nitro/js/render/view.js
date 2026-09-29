// Owns the WebGL renderer, the post pipeline, resolution scaling and quality.
import * as THREE from 'three';
import { Post } from './post.js';

export const QUALITY = {
  low: { label: 'Low', scale: 0.62, maxDpr: 1, samples: 0, bloom: false, edges: true, halftone: 1, draw: 0.62 },
  medium: { label: 'Medium', scale: 0.85, maxDpr: 1.5, samples: 0, bloom: true, edges: true, halftone: 1, draw: 0.8 },
  high: { label: 'High', scale: 1, maxDpr: 2, samples: 4, bloom: true, edges: true, halftone: 1, draw: 1 },
};

export const isTouch = typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, preserveDrawingBuffer: false });
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 1);
    renderer.info.autoReset = true;
    this.renderer = renderer;
    this.post = new Post(renderer);
    this.qualityName = 'high';
    this.q = QUALITY.high;
    this.dynScale = 1;
    this.fpsAvg = 60;
    this.autoQuality = true;
    this._frames = 0; this._acc = 0;
    this.cssW = 1; this.cssH = 1;
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
  }

  setQuality(name, auto = this.autoQuality) {
    this.qualityName = QUALITY[name] ? name : 'high';
    this.q = QUALITY[this.qualityName];
    this.autoQuality = auto;
    this.dynScale = 1;
    this.post.bloomOn = this.q.bloom;
    this.post.edgesOn = this.q.edges;
    this.resize();
  }

  pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.q.maxDpr) * this.q.scale * this.dynScale;
  }

  resize() {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    this.cssW = w; this.cssH = h;
    this.renderer.setPixelRatio(1);
    const pr = this.pixelRatio();
    // canvas backing store at render resolution; CSS stretches it
    this.renderer.setSize(Math.round(w * pr), Math.round(h * pr), false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.post.setSize(w * pr, h * pr, this.q.samples);
    if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  }

  /** Track frame time and nudge resolution to hold ~55fps on weak devices. */
  tick(dt) {
    this._acc += dt; this._frames++;
    if (this._acc < 1) return;
    const fps = this._frames / this._acc;
    this._acc = 0; this._frames = 0;
    this.fpsAvg = this.fpsAvg * 0.5 + fps * 0.5;
    if (!this.autoQuality) return;
    let s = this.dynScale;
    if (this.fpsAvg < 48 && s > 0.55) s = Math.max(0.55, s - 0.1);
    else if (this.fpsAvg > 58 && s < 1) s = Math.min(1, s + 0.05);
    if (s !== this.dynScale) { this.dynScale = s; this.resize(); }
  }

  render(scene, camera, time) {
    this.camera = camera;
    this.post.render(scene, camera, time);
  }
}
