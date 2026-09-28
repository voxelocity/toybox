// Screenshot helper: node tools/shot.mjs <url-path> <out.png> [w] [h] [waitMs]
// Uses the system Chrome through playwright-core (no bundled browser download).
import { chromium } from 'playwright-core';
const [, , urlPath = '/', out = '.shots/shot.png', w = '1400', h = '800', wait = '1500'] = process.argv;
const exe = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:4800' + urlPath, { waitUntil: 'load' });
try { await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 }); } catch { logs.push('[shot] __ready timeout'); }
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
if (logs.length) console.log(logs.join('\n'));
await browser.close();
