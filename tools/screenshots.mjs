// Captures the README screenshots (1920x1080, High preset) from the running game.
// usage: node tools/screenshots.mjs [shotNumber ...]   (default: 1 2 3 4)
// Each scene is staged by the in-game debug hook ?shot=N; once it signals ready, the WebGL
// canvas and the HUD canvas are composited from their real pixels (avoids headless
// compositor flakiness with WebGL layers) and written to screenshots/.
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const NAMES = { 1: '01-title', 2: '02-night-chase', 3: '03-mission-cutscene', 4: '04-docks-firefight' };
const root = path.resolve('game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); }).listen(0);
const shots = process.argv.slice(2).map(Number).filter(Boolean);
const list = shots.length ? shots : [1, 2, 3, 4];
const browser = await chromium.launch();
let failed = 0;
for (const n of list) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto(`http://localhost:${server.address().port}/index.html?shot=${n}&q=high`);
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 900000, polling: 200 });
  const data = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
    const gl = document.getElementById('gl'), hud = document.getElementById('hud');
    const c = document.createElement('canvas'); c.width = gl.width; c.height = gl.height;
    const ctx = c.getContext('2d'); ctx.drawImage(gl, 0, 0); ctx.drawImage(hud, 0, 0);
    resolve(c.toDataURL('image/png'));
  })));
  const out = `screenshots/${NAMES[n]}.png`;
  fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`${out} captured in ${((Date.now() - t0) / 1000).toFixed(0)}s ${errors.length ? 'ERRORS: ' + errors.join(' | ') : '(no console errors)'}`);
  if (errors.length) failed++;
  await page.close();
}
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
