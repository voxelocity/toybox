// Headless screenshots: node tools/shot.mjs <out.png> [query] [w] [h] [waitMs] [script]
// Starts its own static server. Uses the preinstalled Chromium (SwiftShader).
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const [, , out = '.shots/shot.png', query0 = '', w = '1280', h = '720', wait = '3000', script = ''] = process.argv;
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let f = path.join(ROOT, decodeURIComponent(u.pathname));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404).end(); return; } res.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }).end(d); });
}).listen(0);
const port = srv.address().port;
const query = query0.includes('shot') ? query0 : (query0 ? query0 + '&shot' : '?shot');
const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:${port}/${query}`, { waitUntil: 'load' });
try { await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }); } catch { logs.push('[shot] __ready timeout'); }
if (script) { try { const r = await page.evaluate(script); if (r !== undefined) logs.push('[eval] ' + JSON.stringify(r)); } catch (e) { logs.push('[eval error] ' + e.message); } }
await page.waitForTimeout(+wait);
// freeze the loop and render one last frame synchronously so the capture is deterministic
await page.evaluate(() => { if (window.app) { app.frozen = false; app.last = performance.now() - 16; app.frame(performance.now()); app.frozen = true; } }).catch(() => {});
await page.waitForTimeout(300);
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.screenshot({ path: out });
const fps = await page.evaluate(() => window.app && window.app.fpsInfo).catch(() => null);
if (logs.length) console.log(logs.slice(0, 60).join('\n'));
await browser.close(); srv.close();
