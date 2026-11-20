// Playwright helper: node tools/shot.mjs "<query>" out.png [waitMs] [w] [h]
// Waits for window.__shotReady when the page sets it (debug ?shot=N scenes), else waitMs.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve('game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(0);
const port = server.address().port;
const [query = '', out = 'tools/out/shot.png', wait = '3000', w = '1920', h = '1080'] = process.argv.slice(2);
fs.mkdirSync(path.dirname(out), { recursive: true });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
await page.goto(`http://localhost:${port}/index.html${query}`);
const t0 = Date.now();
if (query.includes('shot=')) await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 60000, polling: 16 }).catch(() => errors.push('timeout waiting for __shotReady'));
else await page.waitForTimeout(+wait);
const frames = await page.evaluate(() => window.__frames || 0);
await page.screenshot({ path: out });
console.log('frames:', frames, 'fps~', (frames / ((Date.now() - t0) / 1000)).toFixed(1));
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close(); server.close();
