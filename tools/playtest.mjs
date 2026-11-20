// Automated Playwright play-through of Selara Bay (3D).
// - starts a new game from the title menu, skips cutscenes with real key presses
// - walks / sprints / jumps with the keyboard, aims and shoots with the mouse
// - enters a car with F and DRIVES Homecoming's route to Lin's Garage along the road graph
//   through the game's real input path (no teleport)
// - triggers a wanted level and loses it at Kilat Respray
// - completes all six missions (teleports allowed for long trips after the first drive)
// - tests save/continue, death (FLATLINED) and arrest (CUFFED)
// - fails the run on any console error
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve('game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); }).listen(0);
const URL = `http://localhost:${server.address().port}/index.html?q=low&nolock`;
const OUT = 'tools/out/play'; fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('CONSOLE ERROR', m.text()); } });
page.on('pageerror', (e) => { const s = e.message + ' @ ' + (e.stack || '').split('\n')[1]; errors.push(s); console.log('PAGEERROR', s); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
let shotN = 0;
const shot = (name) => page.screenshot({ path: `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png` });
const results = [];
async function check(label, ok, extra = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label} ${extra}`); console.log(results[results.length - 1]);
  if (!ok) console.log('   ->', await ev(() => JSON.stringify({ mode: __G.mode, obj: __G.ui.objective, stars: __G.wanted.stars, mission: __G.mission && __G.mission.def.id, mi: __G.progress.missionIndex, p: [__G.player.x | 0, __G.player.z | 0], veh: __G.player.vehicle && __G.player.vehicle.model, alive: __G.player.alive })));
}
async function until(fn, ms = 30000, arg) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(fn, arg)) return true; await wait(250); } return false; }
async function skipCutscene() { for (let i = 0; i < 40; i++) { if (!(await ev(() => __G.mode === 'cutscene'))) return true; await page.keyboard.press('Space'); await wait(500); } return false; }
async function tp(x, z) { await ev(([x, z]) => { const p = __G.player, v = p.vehicle; if (v) { v.x = x; v.z = z; v.vx = v.vz = 0; } else { p.x = x; p.z = z; } }, [x, z]); await wait(700); }
const lm = (id) => ev((id) => ({ x: __G.city.landmarks[id].x, z: __G.city.landmarks[id].z }), id);
async function onFoot() { await ev(() => { if (__G.player.vehicle) __G.player.exitVehicle(true); }); await wait(300); }
async function startAt(id) {
  if (await ev(() => __G.wanted.stars > 0)) await clearHeatAtRespray();
  await onFoot();
  const m = await lm(id);
  await tp(m.x, m.z + 12); await tp(m.x, m.z);
  return until(() => __G.mission !== null, 15000);
}
async function getCar(x, z) {
  await ev(([x, z]) => { const V = __G.vehicles[0].constructor; const car = new V('merpati', x, z, 0); car.role = 'parked'; __G.vehicles.push(car); __G.player.enterVehicle(car); }, [x, z]);
  await wait(400);
}
async function clearHeatAtRespray() {
  const r = await lm('respray');
  await ev(() => { __G.money = Math.max(__G.money, 500); });
  if (!(await ev(() => !!__G.player.vehicle))) await getCar(r.x, r.z - 40);
  await tp(r.x, r.z - 30); await tp(r.x, r.z);
  return until(() => __G.wanted.stars === 0, 15000);
}
/** In-page driver: real key states (W/A/D/S/Space) steering along a BFS route over the road graph. */
async function driveTo(x, z, timeoutMs = 300000) {
  await ev(([tx, tz]) => {
    const inp = window.__input, G = __G;
    const P = G.player;
    import('./js/world/roads.js').then((R) => {
      const nodes = R.bfsPath(R.nearestNode(P.x, P.z), R.nearestNode(tx, tz)).map(R.nodeXZ);
      const wps = [...nodes, { x: tx, z: tz }];
      let i = 0, stuck = 0, rev = 0;
      G.driveDone = false;
      G.testHook = (dt) => {
        const v = G.player.vehicle; if (!v) return;
        for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space']) inp.down.delete(k);
        let w = wps[i];
        while (i < wps.length - 1 && Math.hypot(w.x - v.x, w.z - v.z) < 9) w = wps[++i];
        const d = Math.hypot(w.x - v.x, w.z - v.z);
        if (i === wps.length - 1 && d < 6) { inp.down.add('KeyS'); if (v.speed < 1) { G.driveDone = true; G.testHook = null; for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) inp.down.delete(k); } return; }
        let diff = Math.atan2(w.z - v.z, w.x - v.x) - v.angle; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
        if (rev > 0) { rev -= dt; inp.down.add('KeyS'); inp.down.add(diff > 0 ? 'KeyA' : 'KeyD'); return; }
        const want = (i === wps.length - 1 && d < 25) ? 5 : Math.abs(diff) > 0.5 ? 7 : 15;
        if (v.speed < want) inp.down.add('KeyW'); else if (v.speed > want + 4) inp.down.add('KeyS');
        if (diff > 0.08) inp.down.add('KeyD'); else if (diff < -0.08) inp.down.add('KeyA');
        if (v.speed < 0.8) { stuck += dt; if (stuck > 1.5) { rev = 1.2; stuck = 0; } } else stuck = 0;
      };
    });
  }, [x, z]);
  return until(() => __G.driveDone === true || !__G.player.vehicle, timeoutMs);
}

// ------------------------------------------------------------------------------------------
await page.goto(URL);
await until(() => window.__G && __G.mode === 'title', 120000);
await ev(() => localStorage.clear());
await page.reload();
await until(() => window.__G && __G.mode === 'title', 120000);
await wait(1500);
await shot('title');
await page.mouse.click(110, 240);
await check('New Game from the title menu starts the intro cutscene', await until(() => __G.mode === 'cutscene', 20000));
await wait(1500); await shot('intro-cutscene');
await check('cutscene skippable with Space', await skipCutscene());
await ev(() => { __G.simSpeed = 3; });
await check('objective: get in the Merpati', await ev(() => __G.ui.objective.includes('Merpati')));
// walk, sprint, jump with real keys
const p0 = await ev(() => ({ x: __G.player.x, z: __G.player.z }));
await page.keyboard.down('KeyW'); await wait(2500); await page.keyboard.up('KeyW');
const p1 = await ev(() => ({ x: __G.player.x, z: __G.player.z }));
await check('W walks the player', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2, `moved=${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)}m`);
await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await wait(2000); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
await check('sprinting drains stamina', await ev(() => __G.player.stamina < 0.99));
await page.keyboard.press('Space'); await wait(300);
await shot('on-foot');
// walk up to the Merpati and press F
await ev(() => { const c = __G.mission.target; __G.player.x = c.x - Math.sin(c.angle) * 2.4; __G.player.z = c.z + Math.cos(c.angle) * 2.4; });
await wait(500);
await page.keyboard.press('KeyF');
await check('F walks to the driver door and enters the Merpati', await until(() => __G.player.vehicle && __G.player.vehicle.model === 'merpati', 20000));
await page.keyboard.press('KeyR'); await wait(300);
await check('R cycles the radio', await ev(() => !!__G.ui.radioName));
// REAL DRIVE: beach -> Lin's Garage along the road graph (no teleport)
const garage = await lm('garage');
const startPos = await ev(() => ({ x: __G.player.x, z: __G.player.z }));
const t0 = Date.now();
const drove = await driveTo(garage.x, garage.z);
const endPos = await ev(() => ({ x: __G.player.x, z: __G.player.z }));
await shot('drive');
await check('drove Homecoming route to the garage via the road graph', drove && Math.hypot(endPos.x - garage.x, endPos.z - garage.z) < 12, `distance driven ~${Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z).toFixed(0)}m in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
await check('arrival cutscene with Mama Lin', await until(() => __G.mode === 'cutscene', 20000));
await wait(1200); await shot('garage-cutscene');
await skipCutscene();
await check('M1 Homecoming passed', await until(() => __G.progress.missionIndex === 1, 15000));
await check('safehouse unlocked + autosave', await ev(() => __G.progress.safehouse && !!localStorage.getItem('selarabay3d.save.v1')));

// --- shooting + wanted level, lost at the respray ---
await onFoot();
await ev(() => { __G.player.giveWeapon('kobra', 40); __G.player.weapon = 'kobra'; });
await page.mouse.move(400, 225);
const s0 = await ev(() => __G.stats.shots);
for (let i = 0; i < 4; i++) { await page.mouse.down(); await wait(150); await page.mouse.up(); await wait(400); }
await check('left click shoots', await ev((s0) => __G.stats.shots > s0, s0));
await page.mouse.down({ button: 'right' }); await wait(800); await shot('aim'); await page.mouse.up({ button: 'right' });
await ev(() => import('./js/ai/police.js').then((P) => P.setWanted(2)));
await check('wanted level triggered (2 stars)', await ev(() => __G.wanted.stars === 2));
await check('Kilat Respray clears the wanted level', await clearHeatAtRespray());

// --- M2 Yellow Fever ---
await check('M2 starts at the garage marker', await startAt('garage'));
await skipCutscene();
await ev(() => { const c = __G.mission.target; __G.player.x = c.x - Math.sin(c.angle) * 2.4; __G.player.z = c.z + Math.cos(c.angle) * 2.4; });
await wait(400); await page.keyboard.press('KeyF');
await check('stole the yellow Vesper GT', await until(() => __G.player.vehicle && __G.player.vehicle.model === 'vesper', 20000));
await check('stealing it gives 1 star', await until(() => __G.wanted.stars >= 1, 8000));
await shot('vesper');
await check('lost the star at the respray', await clearHeatAtRespray());
await tp(garage.x, garage.z);
await check('delivery cutscene', await until(() => __G.mode === 'cutscene', 15000));
await skipCutscene();
await check('M2 passed', await until(() => __G.progress.missionIndex === 2, 15000));
const sh = await lm('safehouse');
await tp(sh.x + 3, sh.z - 1);
await check('Kobra 9 reward collected at the safehouse', await until(() => __G.player.weapons.kobra, 8000));

// --- M3 Collections ---
await check('M3 starts', await startAt('garage'));
await skipCutscene();
const k = await lm('kedai');
await tp(k.x, k.z + 14);
await check('4 enforcers spawn at Kedai Orchid', await until(() => __G.peds.filter((p) => p.kind === 'gang' && !p.dead).length >= 4, 15000));
await ev(() => { __G.godMode = true; });
await wait(2500); await shot('collections-fight');
await ev(() => { for (const p of __G.peds) if (p.kind === 'gang') p.damage(999, __G.player); });
await check('cash bag drops', await until(() => __G.pickups.some((p) => p.type === 'bag'), 8000));
await ev(() => { const b = __G.pickups.find((p) => p.type === 'bag'); __G.player.x = b.x; __G.player.z = b.z; });
await check('bag collected', await until(() => __G.ui.objective.includes('garage'), 8000));
if (await ev(() => __G.wanted.stars > 0)) await clearHeatAtRespray();
await onFoot(); await tp(garage.x, garage.z);
await check('M3 cutscene', await until(() => __G.mode === 'cutscene', 15000));
await skipCutscene();
await check('M3 passed', await until(() => __G.progress.missionIndex === 3, 15000));

// --- M4 Wheelman ---
await check('M4 starts', await startAt('garage'));
await skipCutscene();
const dex = await lm('dex');
await getCar(dex.x, dex.z + 14);
await tp(dex.x, dex.z + 6);
await check('Dex climbs in', await until(() => __G.peds.some((p) => p.speaker === 'dex' && p.vehicle), 30000));
const bank = await lm('bank');
await tp(bank.x, bank.z);
await check('vault countdown runs', await until(() => __G.ui.timer && __G.ui.timer.value < 12, 30000));
await shot('vault-countdown');
await check('alarm -> 3 stars', await until(() => __G.wanted.stars >= 3, 40000));
await wait(3000); await shot('bank-chase');
await check('lost the cops', await clearHeatAtRespray());
await tp(dex.x, dex.z + 6);
await check('M4 drop-off cutscene', await until(() => __G.mode === 'cutscene', 20000));
await skipCutscene();
await check('M4 passed', await until(() => __G.progress.missionIndex === 4, 15000));

// --- M5 Low Tide ---
await check('M5 starts', await startAt('garage'));
await skipCutscene();
await ev(() => { const t = __G.mission.target; __G.player.x = t.x; __G.player.z = t.z; });
await check('Wasp collected', await until(() => __G.player.weapons.wasp, 10000));
const f = await lm('freight');
await tp(f.x, f.z + 25);
await check('6 guards + Bison truck staged', await until(() => __G.peds.filter((p) => p.kind === 'gang' && !p.dead).length === 6, 15000));
await wait(2000);
await ev(() => { for (const p of __G.peds) if (p.kind === 'gang') p.damage(999, __G.player); __G.vehicles.find((v) => v.model === 'bison' && v.mission).damage(5000, __G.player); });
await check('weapons truck destroyed', await until(() => __G.vehicles.some((v) => v.model === 'bison' && v.wrecked), 15000));
await wait(500); await shot('lowtide-explosion');
await check('escape objective', await until(() => __G.ui.objective.includes('Escape'), 10000));
await tp(500, 500);
await check('M5 cutscene', await until(() => __G.mode === 'cutscene', 15000));
await skipCutscene();
await check('M5 passed', await until(() => __G.progress.missionIndex === 5, 15000));

// --- M6 Orchid Falls ---
await check('M6 starts at Dex', await startAt('dex'));
await skipCutscene();
await wait(4000);
await check("Viktor's black Vesper is fleeing", await ev(() => __G.vehicles.some((v) => v.mission && v.model === 'vesper' && v.speed > 2)));
await shot('viktor-chase');
await ev(() => { const v = __G.vehicles.find((v) => v.mission && v.model === 'vesper'); v.damage(3000, __G.player); });
await check('Viktor bails out on foot', await until(() => __G.peds.some((p) => p.kind === 'boss' && !p.vehicle), 15000));
await ev(() => { const v = __G.peds.find((p) => p.kind === 'boss'); __G.player.x = v.x + 12; __G.player.z = v.z; });
await wait(2500); await shot('viktor-boss');
await ev(() => { const v = __G.peds.find((p) => p.kind === 'boss'); v.damage(250, __G.player); });
await check('final cutscene at sunrise', await until(() => __G.mode === 'cutscene', 20000));
await wait(1500); await shot('final-cutscene');
await skipCutscene();
await check('M6 passed, story finished', await until(() => __G.progress.missionIndex === 6 && __G.progress.finished, 20000));
await check('credits roll', await until(() => __G.mode === 'credits', 20000));
await wait(1500); await shot('credits');
await page.keyboard.press('Enter');
await check('free roam after the credits', await until(() => __G.mode === 'playing', 10000));

// --- death, arrest, map, pause, gun shop ---
await ev(() => { __G.godMode = false; __G.player.damage(500); });
await check('FLATLINED screen', await until(() => __G.mode === 'dead', 5000));
await wait(1500); await shot('flatlined');
await check('respawn at the hospital', await until(() => __G.mode === 'playing', 30000));
await ev(() => { __G.wanted.stars = 1; __G.wanted.heat = 20; __G.bust(); });
await check('CUFFED screen', await until(() => __G.mode === 'busted', 5000));
await wait(1500); await shot('cuffed');
await check('respawn at Police HQ with ammo lost', await until(() => __G.mode === 'playing' && __G.player.totalAmmo('wasp') === 0, 30000));
await page.keyboard.press('KeyM');
await check('big map opens', await until(() => __G.mode === 'map', 5000));
await page.mouse.click(300, 200);
await check('waypoint set by clicking the map', await until(() => !!__G.waypoint, 5000));
await shot('map');
await page.keyboard.press('KeyM'); await wait(800);
await page.keyboard.press('Escape');
await check('pause menu', await until(() => __G.mode === 'paused', 5000));
await shot('pause');
await page.keyboard.press('Escape'); await wait(500);
const arms = await lm('arms');
await ev(() => { __G.money = 5000; });
await tp(arms.x, arms.z);
await page.keyboard.press('Digit3'); await wait(600);
await check('bought the Thunder shotgun', await ev(() => __G.player.weapons.thunder));
// --- save / continue ---
await ev(() => { __G.wanted.stars = 0; __G.wanted.heat = 0; });
await tp(sh.x, sh.z + 8); await tp(sh.x, sh.z);
await check('safehouse marker saves', await until(() => JSON.parse(localStorage.getItem('selarabay3d.save.v1') || '{}').player?.weapons?.thunder === true, 8000));
await page.reload();
await until(() => window.__G && __G.mode === 'title', 120000);
await wait(1500);
await page.mouse.click(110, 240); // Continue is the first item when a save exists
await check('Continue loads the save', await until(() => __G.mode === 'playing' && __G.progress.missionIndex === 6 && __G.player.weapons.thunder, 30000));
const cars = await ev(() => __G.vehicles.filter((v) => v.role === 'traffic').length), peds = await ev(() => __G.peds.filter((p) => p.kind === 'civ').length);
await check('traffic and pedestrians populated', cars > 10 && peds > 15, `cars=${cars} peds=${peds}`);

const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} checks passed`);
console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.slice(0, 20).join('\n') : 'no console errors');
await browser.close(); server.close();
process.exit(fails || errors.length ? 1 : 0);
