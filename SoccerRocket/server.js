// SoccerRocket static server. Zero dependencies: serves public/, plus your
// own car model from the project's assets/ folder.
// Usage: node server.js [port]   (or PORT=8080 node server.js)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PROJECT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(PROJECT, 'public');
const USER_ASSETS = path.join(PROJECT, 'assets');
const PORT = Number(process.argv[2] || process.env.PORT) || 5173;
const MODEL_EXT = ['.glb', '.gltf', '.fbx', '.obj'];
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.tga', '.webp', '.bmp'];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.tga': 'image/x-tga',
  '.bmp': 'image/bmp', '.dds': 'application/octet-stream', '.hdr': 'application/octet-stream', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.fbx': 'application/octet-stream',
  '.obj': 'text/plain; charset=utf-8', '.mtl': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

// Recursively find models and textures in assets/ and public/assets/models/.
function findAssets() {
  const found = [], images = [];
  let config = null;
  const walk = (dir, urlBase, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 4 && !e.name.startsWith('.') && e.name !== 'hdri') walk(full, `${urlBase}${encodeURIComponent(e.name)}/`, depth + 1); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (MODEL_EXT.includes(ext)) found.push({ url: urlBase + encodeURIComponent(e.name), name: e.name, size: fs.statSync(full).size });
      if (IMAGE_EXT.includes(ext)) images.push({ url: urlBase + encodeURIComponent(e.name), name: e.name });
      if (depth === 0 && !config && e.name.toLowerCase() === 'soccerrocket.json') config = urlBase + encodeURIComponent(e.name);
    }
  };
  walk(USER_ASSETS, 'project-assets/', 0);
  walk(path.join(ROOT, 'assets', 'models'), 'assets/models/', 0);
  const rank = (m) => (/fennec/i.test(m.name) ? 0 : /car|body|chassis/i.test(m.name) ? 1 : 2) * 10 + MODEL_EXT.indexOf(path.extname(m.name).toLowerCase());
  return { models: found.sort((a, b) => rank(a) - rank(b)), images, config };
}

function resolveFile(pathname) {
  const rel = decodeURIComponent(pathname);
  if (rel.startsWith('/project-assets/')) {
    const f = path.normalize(path.join(USER_ASSETS, rel.slice('/project-assets/'.length)));
    return f.startsWith(USER_ASSETS) ? f : null;
  }
  const f = path.normalize(path.join(ROOT, rel));
  return f.startsWith(ROOT) ? f : null;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/models') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(JSON.stringify(findAssets()));
    return;
  }
  let file = resolveFile(url.pathname);
  if (!file) { res.writeHead(403).end('Forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err2, data) => {
      if (err2) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    });
  });
}).listen(PORT, () => {
  console.log(`SoccerRocket running at http://localhost:${PORT}`);
  const { models, images } = findAssets();
  if (models.length) console.log(`  models: ${models.map((m) => m.name).join(', ')} (+${images.length} textures)`);
  else console.log('  no models found in assets/ - using the built-in car and ball');
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal) console.log(`  on your network (phones/tablets): http://${a.address}:${PORT}`);
  }
});
