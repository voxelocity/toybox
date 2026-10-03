// Generates every sound effect off the main thread and streams them back.
import { SOUND_LIST } from './sounds.js';

self.onmessage = (e) => {
  if (!e.data || e.data.cmd !== 'gen') return;
  const total = SOUND_LIST.length;
  SOUND_LIST.forEach(([name, fn], i) => {
    let r;
    try { r = fn(); } catch (err) { self.postMessage({ type: 'error', name, message: String(err) }); return; }
    self.postMessage({ type: 'sound', name, sr: r.sr, ch: r.ch, loop: !!r.loop, meta: r.meta || null, progress: (i + 1) / total }, r.ch.map((c) => c.buffer));
  });
  self.postMessage({ type: 'done' });
};
