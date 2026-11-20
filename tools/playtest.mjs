// Automated play-through: drives the real game in Chromium via Playwright, using real
// keyboard/mouse input for core actions and teleports for long trips. Fails on any console error.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve('game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(0);
const port = server.address().port;
const OUT = 'tools/out/play'; fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]); console.log('PAGEERROR', e.message, (e.stack || '').split('\n')[1]); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
let shotN = 0;
const shot = async (name) => page.screenshot({ path: `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png` });
const results = [];
async function check(label, ok, extra = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label} ${extra}`); console.log(results[results.length - 1]);
  if (!ok) console.log('   ->', await ev(() => JSON.stringify({ mode: __G.mode, obj: __G.ui.objective, stars: __G.wanted.stars, mission: __G.mission && __G.mission.def.id, mi: __G.progress.missionIndex, p: [__G.player.x | 0, __G.player.y | 0], veh: __G.player.vehicle && __G.player.vehicle.model, alive: __G.player.alive, toasts: __G.ui.toast.map((t) => t.text), help: __G.ui.help && __G.ui.help.text })));
}
async function until(fn, ms = 15000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(fn, arg)) return true; await wait(100); }
  return false;
}
async function skipCutscene() {
  for (let i = 0; i < 30; i++) {
    if (!(await ev(() => __G.mode === 'cutscene'))) return true;
    await page.keyboard.press('Space'); await wait(320);
  }
  return false;
}
async function tp(x, y) { await ev(([x, y]) => { const p = __G.player; if (p.vehicle) { p.vehicle.x = x; p.vehicle.y = y; p.vehicle.vx = p.vehicle.vy = 0; } else { p.x = x; p.y = y; } __G.cam.x = x; __G.cam.y = y; }, [x, y]); await wait(400); }
const lmPos = (id) => ev((id) => ({ x: __G.city.landmarks[id].x, y: __G.city.landmarks[id].y }), id);
async function stepOutOfMarker() { const p = await ev(() => ({ x: __G.player.x, y: __G.player.y })); await tp(p.x, p.y + 100); }
async function startAt(id) {
  if (await ev(() => __G.wanted.stars > 0)) await clearHeatAtRespray();
  await ev(() => { if (__G.player.vehicle) __G.player.exitVehicle(true); });
  const m = await lmPos(id);
  await tp(m.x, m.y + 100); await tp(m.x, m.y);
  const ok = await until(() => __G.mission !== null, 4000);
  if (!ok) console.log('  state:', await ev(() => JSON.stringify({ mode: __G.mode, stars: __G.wanted.stars, veh: !!__G.player.vehicle, mi: __G.progress.missionIndex, px: __G.player.x | 0, py: __G.player.y | 0 })));
  return ok;
}
async function clearHeatAtRespray() {
  const r = await lmPos('respray');
  if (!(await ev(() => !!__G.player.vehicle))) await spawnCarNear(r.x, r.y - 260);
  await ev(() => { __G.money = Math.max(__G.money, 500); });
  await tp(r.x, r.y - 200); await tp(r.x, r.y);
  return until(() => __G.wanted.stars === 0, 4000);
}
async function spawnCarNear(x, y) {
  await ev(([x, y]) => { const P = __G.player; const V = __G.vehicles.find((v) => v.model === 'merpati' && !v.wrecked && !v.mission) || null; const car = new (__G.vehicles[0].constructor)('merpati', x, y, 0); car.role = 'parked'; __G.vehicles.push(car); P.x = x; P.y = y + 22; P.enterVehicle(car); }, [x, y]);
  await wait(200);
  return until(() => !!__G.player.vehicle, 3000);
}

await page.goto(`http://localhost:${port}/index.html`);
await until(() => window.__G && __G.mode === 'title', 20000);
await ev(() => localStorage.clear());
await wait(500);
await shot('title');
// --- New Game via real mouse click on the menu ---
await page.mouse.move(150, 376); await page.mouse.down(); await page.mouse.up();
await check('New Game starts Homecoming cutscene', await until(() => __G.mode === 'cutscene', 4000));
await wait(800); await shot('homecoming-cutscene');
await check('cutscene skippable', await skipCutscene());
await check('objective shown', await ev(() => __G.ui.objective.includes('Merpati')));
// walk with WASD (real input)
const p0 = await ev(() => ({ x: __G.player.x, y: __G.player.y }));
await page.keyboard.down('KeyW'); await wait(900); await page.keyboard.up('KeyW');
const p1 = await ev(() => ({ x: __G.player.x, y: __G.player.y }));
await check('WASD walking moves the player', p1.y < p0.y - 30, `dy=${(p1.y - p0.y).toFixed(0)}`);
// sprint drains stamina
await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await wait(700); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
await check('sprint drains stamina', await ev(() => __G.player.stamina < 0.95));
// go to the Merpati and press F
await ev(() => { const car = __G.mission.target; __G.player.x = car.x; __G.player.y = car.y + 26; });
await wait(200);
await page.keyboard.press('KeyF');
await check('F enters the Merpati', await until(() => __G.player.vehicle && __G.player.vehicle.model === 'merpati', 3000));
await wait(300);
await ev(() => { const v = __G.player.vehicle; v.angle = -Math.PI / 2; v.x = 4 * 440 + 40 - 18; v.y = 5200; });
await page.keyboard.down('KeyW'); await wait(1600);
const sp = await ev(() => __G.player.vehicle.speed);
await check('W accelerates the car', sp > 120, `speed=${sp.toFixed(0)}`);
await page.keyboard.down('KeyD'); await page.keyboard.down('Space'); await wait(600);
await shot('drift');
await page.keyboard.up('KeyD'); await page.keyboard.up('Space'); await page.keyboard.up('KeyW');
await page.keyboard.press('KeyR'); await wait(100);
await check('R cycles radio', await ev(() => !!__G.ui.radioName));
const g = await lmPos('garage');
await tp(g.x, g.y);
await check('arrive at garage -> cutscene', await until(() => __G.mode === 'cutscene', 5000));
await skipCutscene();
await check('M1 Homecoming passed', await until(() => __G.progress.missionIndex === 1, 5000));
await check('safehouse unlocked', await ev(() => __G.progress.safehouse));
await check('autosave written', await ev(() => !!localStorage.getItem('selarabay.save.v1')));
await shot('m1-passed');
await page.keyboard.press('KeyF'); await wait(500);

// --- M2 Yellow Fever ---
await stepOutOfMarker();
await check('M2 starts at garage marker', await startAt('garage'));
await skipCutscene();
await ev(() => { const car = __G.mission.target; __G.player.x = car.x; __G.player.y = car.y + 26; });
await wait(200); await page.keyboard.press('KeyF');
await check('stole yellow Vesper', await until(() => __G.player.vehicle && __G.player.vehicle.model === 'vesper', 3000));
await check('stealing gives 1 star', await until(() => __G.wanted.stars >= 1, 2000));
await shot('m2-vesper');
await check('respray clears heat', await clearHeatAtRespray());
await tp(g.x, g.y);
await check('deliver -> cutscene', await until(() => __G.mode === 'cutscene', 5000));
await skipCutscene();
await check('M2 passed', await until(() => __G.progress.missionIndex === 2, 5000));
const kobra = await ev(() => __G.pickups.some((p) => p.type === 'weapon' && p.weapon === 'kobra' && Math.hypot(p.x - __G.city.landmarks.safehouse.x, p.y - __G.city.landmarks.safehouse.y) < 80));
await check('Kobra 9 reward at safehouse', kobra);
const sh = await lmPos('safehouse');
await tp(sh.x + 34, sh.y - 10);
await check('picked up Kobra 9', await until(() => __G.player.weapons.kobra && __G.player.ammo.kobra > 0, 2000));
await tp(sh.x, sh.y - 120); await tp(sh.x, sh.y);
console.log('  toasts:', await ev(() => JSON.stringify({ t: __G.ui.toast.map((t) => t.text), stars: __G.wanted.stars, m: !!__G.mission, mode: __G.mode, sf: __G.progress.safehouse, d: Math.hypot(__G.player.x - __G.city.landmarks.safehouse.x, __G.player.y - __G.city.landmarks.safehouse.y) })));
await check('save marker saves', await ev(() => JSON.parse(localStorage.getItem('selarabay.save.v1')).player.weapons.kobra === true));

// --- M3 Collections ---
await check('M3 starts', await startAt('garage'));
await skipCutscene();
const k = await lmPos('kedai');
await tp(k.x, k.y + 120);
await check('enforcers spawn', await until(() => __G.peds.filter((p) => p.kind === 'gang').length >= 4, 4000));
await ev(() => { __G.player.weapon = 'kobra'; __G.player.ammo.kobra = 200; __G.player.hp = 100; __G.godMode = true; });
// real mouse shooting at the nearest enforcer
for (let i = 0; i < 25; i++) {
  const s = await ev(() => { const g = __G.peds.find((p) => p.kind === 'gang' && !p.dead); if (!g) return null; return { x: __G.W / 2 + (g.x - __G.cam.x) * __G.cam.zoom, y: __G.H / 2 + (g.y - __G.cam.y) * __G.cam.zoom }; });
  if (!s) break;
  await page.mouse.move(s.x, s.y); await page.mouse.down(); await page.mouse.up(); await wait(280);
}
const shotsFired = await ev(() => __G.stats.shots);
await check('mouse shooting fires the Kobra', shotsFired > 3, `shots=${shotsFired}`);
await shot('m3-firefight');
await ev(() => { for (const p of __G.peds) if (p.kind === 'gang') p.damage(999, __G.player); });
await check('bag drops', await until(() => __G.pickups.some((p) => p.type === 'bag'), 3000));
await ev(() => { const b = __G.pickups.find((p) => p.type === 'bag'); __G.player.x = b.x; __G.player.y = b.y; });
await check('bag collected', await until(() => __G.ui.objective.includes('garage'), 3000));
if (await ev(() => __G.wanted.stars > 0)) await clearHeatAtRespray();
await ev(() => { if (__G.player.vehicle) __G.player.exitVehicle(true); });
await tp(g.x, g.y);
await check('M3 cutscene', await until(() => __G.mode === 'cutscene', 5000));
await skipCutscene();
await check('M3 passed', await until(() => __G.progress.missionIndex === 3, 5000));

// --- M4 Wheelman ---
await stepOutOfMarker();
await check('M4 starts', await startAt('garage'));
await skipCutscene();
const d = await lmPos('dex');
await check('got a car', await spawnCarNear(d.x, d.y + 60));
await tp(d.x, d.y + 50);
await check('Dex gets in', await until(() => __G.peds.some((p) => p.kind === 'story' && p.vehicle), 8000));
const b = await lmPos('bank');
await tp(b.x, b.y);
await check('vault countdown runs', await until(() => __G.ui.timer && __G.ui.timer.value < 13, 6000));
await shot('m4-countdown');
await check('alarm -> 3 stars', await until(() => __G.wanted.stars >= 3, 20000));
await wait(1500);
await shot('m4-chase');
await check('respray clears 3 stars', await clearHeatAtRespray());
await tp(d.x, d.y + 40);
await check('M4 cutscene', await until(() => __G.mode === 'cutscene', 6000));
await skipCutscene();
await check('M4 passed', await until(() => __G.progress.missionIndex === 4, 5000));

// --- M5 Low Tide ---
await ev(() => { if (__G.player.vehicle) __G.player.exitVehicle(true); });
await check('M5 starts', await startAt('garage'));
await skipCutscene();
await ev(() => { const t = __G.mission.target; __G.player.x = t.x; __G.player.y = t.y; });
await check('Wasp collected', await until(() => __G.player.weapons.wasp, 3000));
const f = await lmPos('freight');
await tp(f.x, f.y + 200);
await check('guards + truck staged', await until(() => __G.peds.filter((p) => p.kind === 'gang' && !p.dead).length === 6, 4000));
await wait(1200);
await ev(() => { for (const p of __G.peds) if (p.kind === 'gang') p.damage(999, __G.player); const t = __G.vehicles.find((v) => v.model === 'bison' && v.mission); t.damage(5000, __G.player); });
await check('truck explodes', await until(() => __G.vehicles.some((v) => v.model === 'bison' && v.wrecked), 6000));
await wait(300); await shot('m5-explosion');
await check('escape objective', await until(() => __G.ui.objective.includes('Escape'), 3000));
await tp(6 * 440 + 40, 6 * 440 + 40);
await check('M5 cutscene', await until(() => __G.mode === 'cutscene', 5000));
await skipCutscene();
await check('M5 passed', await until(() => __G.progress.missionIndex === 5, 5000));

// --- M6 Orchid Falls ---
if (await ev(() => __G.wanted.stars > 0)) await clearHeatAtRespray();
await ev(() => { if (__G.player.vehicle) __G.player.exitVehicle(true); });
await check('M6 starts at Dex', await startAt('dex'));
await skipCutscene();
await wait(2500);
const vk = await ev(() => { const v = __G.vehicles.find((v) => v.mission && v.model === 'vesper'); return v ? { x: v.x, y: v.y, moved: true } : null; });
await check("Viktor's car is driving", !!vk);
await shot('m6-chase');
await ev(() => { const v = __G.vehicles.find((v) => v.mission && v.model === 'vesper'); v.damage(1500, __G.player); });
await check('Viktor bails out', await until(() => __G.peds.some((p) => p.kind === 'boss' && !p.vehicle), 4000));
await ev(() => { const v = __G.peds.find((p) => p.kind === 'boss'); __G.player.x = v.x + 120; __G.player.y = v.y; });
await wait(1500); await shot('m6-boss');
await ev(() => { const v = __G.peds.find((p) => p.kind === 'boss'); v.damage(250, __G.player); });
await check('final cutscene', await until(() => __G.mode === 'cutscene', 8000));
await skipCutscene();
await check('M6 passed', await until(() => __G.progress.missionIndex === 6 && __G.progress.finished, 6000));
await check('credits roll', await until(() => __G.mode === 'credits', 8000));
await wait(1500); await shot('credits');
await page.keyboard.press('Enter');
await check('free roam after credits', await until(() => __G.mode === 'playing', 3000));

// --- death, arrest, pause, map, continue ---
await ev(() => { __G.godMode = false; __G.player.damage(500); });
await check('FLATLINED screen', await until(() => __G.mode === 'dead', 2000));
await wait(1200); await shot('flatlined');
await check('respawn at hospital', await until(() => __G.mode === 'playing', 8000));
await ev(() => { __G.wanted.stars = 1; __G.wanted.heat = 20; __G.bust(); });
await check('CUFFED screen', await until(() => __G.mode === 'busted', 2000));
await wait(1200); await shot('cuffed');
await check('respawn at police HQ, ammo lost', await until(() => __G.mode === 'playing' && __G.player.ammo.wasp === 0, 8000));
await page.keyboard.press('KeyM');
await check('map opens', await until(() => __G.mode === 'map', 2000));
await page.mouse.click(700, 300);
await check('waypoint set by click', await until(() => !!__G.waypoint, 2000));
await shot('map');
await page.keyboard.press('KeyM'); await wait(300);
await shot('gps');
await page.keyboard.press('Escape');
await check('pause menu', await until(() => __G.mode === 'paused', 2000));
await shot('pause');
await page.keyboard.press('Escape'); await wait(300);
await check('resume', await ev(() => __G.mode === 'playing'));
// gun shop
const arms = await lmPos('arms');
await ev(() => { __G.money = 5000; });
await tp(arms.x, arms.y);
await page.keyboard.press('Digit3'); await wait(300);
await check('bought Thunder', await ev(() => __G.player.weapons.thunder));
await shot('gunshop');
// traffic sanity
const cars = await ev(() => __G.vehicles.filter((v) => v.role === 'traffic').length);
const peds = await ev(() => __G.peds.filter((p) => p.kind === 'civ').length);
await check('traffic and crowd populated', cars > 15 && peds > 20, `cars=${cars} peds=${peds}`);

console.log('\n' + results.filter((r) => r.startsWith('FAIL')).length + ' failures');
console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.slice(0, 20).join('\n') : 'no console errors');
await browser.close(); server.close();
