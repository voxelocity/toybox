// Placeholder audio engine (replaced by the full implementation).
export class AudioEngine {
  constructor(settings) { this.settings = settings; this.ready = false; }
  async init(onProgress) { onProgress && onProgress(1); }
  unlock() {}
  ui() {}
  applyVolumes() {}
  setCars() {}
  update() {}
  event() {}
  stopAll() {}
  pause() {}
}
