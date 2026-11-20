// Boot, main loop and the top-level state machine:
// boot -> title -> playing <-> paused / map / cutscene, dead / busted -> respawn, credits.
import { G } from './state.js';
import { input, initInput, isDown, wasPressed, endFrameInput, updateMouseWorld, loadBindings } from './input.js';
import { clamp, RNG } from './util.js';
import { generateCity, districtAt, DISTRICTS, CITY } from './world/city.js';
import { buildCollision } from './world/collision.js';
import * as R from './world/render-city.js';
import { updateCamera, snapCamera, viewRect, baseZoom, addShake } from './camera.js';
import { updateTimeOfDay, renderLightmap, addStreetLights, renderGlows, updateWeather, drawRain, drawPuddles } from './fx/lighting.js';
import { updateParticles, drawGroundFx, drawParticles, clearFx } from './fx/particles.js';
import { Player } from './entities/player.js';
import { Vehicle, collideVehicles, drawVehicle } from './entities/vehicle.js';
import { initWorldPickups, updatePickups, drawPickups, spawnPickup } from './entities/pickups.js';
import { manageCrowd, updateTrafficCar } from './ai/traffic.js';
import { updateWanted, updatePoliceCar, updateHeli, drawHeli, clearWanted, copReenter, reportCrime } from './ai/police.js';
import { initAudio, updateAudio, sfx } from './audio/audio.js';
import * as HUD from './ui/hud.js';
import * as Menus from './ui/menus.js';
import * as Dialogue from './story/dialogue.js';
import * as Missions from './story/missions.js';
import * as Side from './story/side-content.js';
import * as Save from './save.js';
import { setupShot } from './debug/screenshots.js';

const canvas = document.getElementById('game');
G.canvas = canvas;
G.ctx = canvas.getContext('2d');
G.copReenter = copReenter;
const params = new URLSearchParams(location.search);
G.debug.shot = +(params.get('shot') || 0);
window.__G = G; // handy for debugging from the console

function resize() {
  G.W = window.innerWidth; G.H = window.innerHeight;
  canvas.width = G.W; canvas.height = G.H;
  G.cam.tz = baseZoom();
}
window.addEventListener('resize', resize);
resize();

// ---------- global helpers used across systems ----------
G.addMoney = (n) => { G.money = Math.max(0, G.money + n); if (n > 0) G.stats.earned += n; };
G.toast = (text, color = '#fff') => { G.ui.toast.push({ text, color, t: 2.6 }); if (G.ui.toast.length > 4) G.ui.toast.shift(); };
G.banner = (title, sub = '', color = '#2ff3e0', time = 4) => { G.ui.banner = { title, sub, color, t: time, max: time }; };
G.help = (text, time = 0.1) => { G.ui.help = { text, t: time }; };

G.onPedDeath = (ped, killer) => {
  if (killer && killer.isPlayer) G.stats.kills++;
  if (ped.kind === 'civ' || ped.kind === 'cop') {
    if (Math.random() < 0.85) spawnPickup('cash', ped.x + 6, ped.y + 4, { amount: ped.cash, life: 40 });
  }
};
G.onPlayerDeath = () => {
  G.mode = 'dead'; G.deathT = 0; G.stats.deaths++;
  sfx('flatline');
  Missions.onPlayerDown('You flatlined.');
};
G.bust = () => {
  if (G.mode !== 'playing') return;
  G.mode = 'busted'; G.deathT = 0; G.stats.arrests++;
  const pl = G.player;
  if (pl.vehicle) pl.exitVehicle(true);
  sfx('cuffed');
  Missions.onPlayerDown('You got cuffed.');
};

// ---------- world setup ----------
export function resetWorld() {
  G.vehicles = []; G.peds = []; G.pickups = []; G.heli = null;
  clearFx(); clearWanted();
  G.wanted.heat = 0;
  G.arrestProgress = 0;
}

function placeParkedCars() {
  const rng = new RNG(2024);
  for (const p of G.city.parking) {
    const model = p.police ? 'patrol' : rng.pick(['kancil', 'merpati', 'merpati', 'bajak', 'vesper', 'taxi']);
    const v = new Vehicle(model, p.x, p.y, p.a);
    v.role = p.police ? 'police' : 'parked'; v.home = true;
    if (p.police) v.ai = { mode: 'parked' };
    G.vehicles.push(v);
  }
}

export function startWorld(data) {
  resetWorld();
  const L = G.city.landmarks;
  const pl = new Player(data ? data.x : L.safehouse.x, data ? data.y : L.safehouse.y);
  G.player = pl;
  if (data) Save.applyToPlayer(data, pl);
  initWorldPickups();
  placeParkedCars();
  snapCamera(pl.x, pl.y);
  R.warmChunks(pl.x, pl.y, 1200);
  manageCrowd(0, true);
  G.mode = 'playing';
  G.areaKey = null;
}

export function newGame() {
  Save.resetProgress();
  startWorld(null);
  Missions.startMission(0);
}
export function continueGame() {
  const data = Save.load();
  if (!data) return newGame();
  Save.applyToState(data);
  startWorld(data.player);
}
G.newGame = newGame; G.continueGame = continueGame;
G.quitToTitle = () => {
  Missions.abort();
  resetWorld();
  G.player = null; G.waypoint = null;
  G.ui.objective = ''; G.ui.banner = null;
  G.clock = 18 * 60 + 20;
  G.mode = 'title';
  Menus.open('title');
  manageCrowd(0, true);
};

// ---------- respawn ----------
function respawn(where) {
  const pl = G.player, L = G.city.landmarks;
  const lm = where === 'hospital' ? L.hospital : L.police;
  clearWanted();
  G.heli = null;
  for (let i = G.vehicles.length - 1; i >= 0; i--) if (G.vehicles[i].ai && G.vehicles[i].ai.mode === 'chase') G.vehicles.splice(i, 1);
  G.peds = G.peds.filter((p) => p.kind !== 'cop' || p.vehicle);
  pl.alive = true; pl.hp = pl.maxHp; pl.armor = where === 'police' ? 0 : pl.armor;
  pl.x = lm.x; pl.y = lm.y + 10; pl.vehicle = null; pl.entering = null;
  G.money = Math.max(0, G.money - 100);
  if (where === 'police') { for (const k in pl.ammo) pl.ammo[k] = 0; pl.weapon = 'fists'; }
  G.timeScale = 1;
  G.arrestProgress = 0;
  snapCamera(pl.x, pl.y);
  G.mode = 'playing';
  G.banner(where === 'hospital' ? 'SELARA GENERAL' : 'POLICE HQ', 'Fees paid: $100', '#ffffff', 3);
}

// ---------- update ----------
function updateWorld(dt) {
  const pl = G.player;
  G.time += dt;
  if (!G.clockFrozen) G.clock = (G.clock + dt) % 1440; // 1 real second = 1 game minute
  G.stats.played += dt;
  updateWeather(dt);
  if (pl) pl.update(dt);
  for (const v of G.vehicles) {
    if (v.driver && !v.driver.isPlayer && v.ai) {
      if (v.ai.mode === 'traffic') updateTrafficCar(v, dt);
      else if (v.ai.mode === 'chase' || v.ai.mode === 'leave') updatePoliceCar(v, dt);
      else if (v.ai.mode === 'script' && v.ai.update) v.ai.update(v, dt);
    } else if (!v.driver || !v.driver.isPlayer) { v.ctl.throttle = 0; v.ctl.brake = 0.6; v.ctl.steer = 0; v.ctl.handbrake = false; }
    v.update(dt);
  }
  for (let i = 0; i < G.vehicles.length; i++) for (let j = i + 1; j < G.vehicles.length; j++) collideVehicles(G.vehicles[i], G.vehicles[j]);
  for (const p of G.peds) p.update(dt);
  vehiclePedHits();
  updateWanted(dt);
  updateHeli(dt);
  // arrest progress (cops at 1 star)
  if (G.arrestProgress > 0) {
    G.arrestProgress -= dt * 0.5;
    if (G.arrestProgress > 1.3) G.bust();
  }
  updatePickups(dt);
  updateParticles(dt);
  if (G.shotUpdate) G.shotUpdate(dt);
  Side.update(dt);
  Missions.update(dt);
  Dialogue.tickSubs(dt);
  manageCrowd(dt);
  // money counter ticks toward the real value
  const diff = G.money - G.moneyShown;
  G.moneyShown += Math.sign(diff) * Math.min(Math.abs(diff), Math.max(1, Math.abs(diff) * dt * 4));
  // district banner
  if (pl) {
    const key = districtAt(pl.x, pl.y);
    if (key !== G.areaKey) { G.areaKey = key; G.ui.area = { text: DISTRICTS[key].name, sub: DISTRICTS[key].sub, color: DISTRICTS[key].color, t: 3.5 }; }
  }
  HUD.tick(dt);
}

function vehiclePedHits() {
  for (const v of G.vehicles) {
    const sp = v.speed;
    if (sp < 30) continue;
    for (const p of G.peds) {
      if (p.dead || p.vehicle || p.state === 'down') continue;
      if (Math.abs(p.x - v.x) > v.len || Math.abs(p.y - v.y) > v.len) continue;
      for (const [cx, cy] of v.circles()) {
        const dx = p.x - cx, dy = p.y - cy, rr = v.wid / 2 + p.r;
        if (dx * dx + dy * dy < rr * rr) {
          if (sp > 70) {
            p.knockDown(v.vx * 0.7 + dx * 4, v.vy * 0.7 + dy * 4, sp * 0.24, v.driver);
            sfx('thud', { x: p.x, y: p.y });
            if (v.driver && v.driver.isPlayer) reportCrime(p.dead ? (p.kind === 'cop' ? 'killCop' : 'kill') : 'hitPed', p.x, p.y);
            if (v.driver && v.driver.isPlayer && p.dead) G.stats.kills++;
          } else { const d = Math.hypot(dx, dy) || 1; p.x = cx + dx / d * rr; p.y = cy + dy / d * rr; }
          break;
        }
      }
    }
  }
}

// ---------- render ----------
function renderWorld() {
  const ctx = G.ctx, c = G.cam, t = G.time;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#0d3c50'; ctx.fillRect(0, 0, G.W, G.H);
  const camX = c.x + c.sx, camY = c.y + c.sy;
  const setWorld = () => ctx.setTransform(c.zoom, 0, 0, c.zoom, G.W / 2 - camX * c.zoom, G.H / 2 - camY * c.zoom);
  setWorld();
  const view = viewRect(0);
  R.setProjectionCenter(c.x, c.y);
  R.drawSea(ctx, view, t);
  R.drawGround(ctx, view);
  R.drawFoam(ctx, view, t);
  const vis = R.visibleStructures(view);
  const blocks = G.city.blocks.filter((b) => b.x < view.x1 && b.x + b.w > view.x0 && b.y < view.y1 && b.y + b.h > view.y0);
  R.drawFountains(ctx, blocks, t);
  drawPuddles(ctx, view);
  drawGroundFx(ctx, view);
  Side.drawMarkers(ctx, view, t);
  Missions.drawWorld(ctx, view, t);
  R.drawShadows(ctx, view, vis.bs, vis.ts);
  drawPickups(ctx, view, t);
  // entities: dead first, then peds, then vehicles
  for (const p of G.peds) if (p.dead && inView(p, view)) p.draw(ctx, t);
  for (const v of G.vehicles) if (inView(v, view, 60)) drawVehicle(ctx, v, t);
  for (const p of G.peds) if (!p.dead && inView(p, view)) p.draw(ctx, t);
  if (G.player && !G.player.vehicle) G.player.draw(ctx, t);
  drawParticles(ctx, view);
  addStreetLights(view);
  // light map (night/sunset) then additive glows, then buildings drawn already lit
  renderLightmap(ctx, view);
  setWorld();
  renderGlows(ctx);
  R.drawStructures(ctx, view, vis.bs, vis.ts, t);
  drawHeli(ctx, t);
  Missions.drawOverhead(ctx, view, t);
  renderGlows(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawRain(ctx, G.dt);
}
function inView(e, v, m = 20) { return e.x > v.x0 - m && e.x < v.x1 + m && e.y > v.y0 - m && e.y < v.y1 + m; }

function postFx() {
  const ctx = G.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (G.mode === 'dead' || G.mode === 'busted') {
    const k = clamp(G.deathT / 1.2, 0, 1);
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = `rgba(128,128,128,${k})`;
    ctx.fillRect(0, 0, G.W, G.H);
    ctx.globalCompositeOperation = 'source-over';
  }
  const pl = G.player;
  if (pl && pl.hurtFlash > 0) {
    const g = ctx.createRadialGradient(G.W / 2, G.H / 2, G.H * 0.3, G.W / 2, G.H / 2, G.H * 0.8);
    g.addColorStop(0, 'rgba(160,0,20,0)'); g.addColorStop(1, `rgba(160,0,20,${pl.hurtFlash})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, G.W, G.H);
  }
  // vignette
  const v = ctx.createRadialGradient(G.W / 2, G.H / 2, G.H * 0.45, G.W / 2, G.H / 2, G.H * 0.95);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, G.W, G.H);
}

// ---------- title camera ----------
let titleT = 0;
function updateTitleCamera(dt) {
  titleT += dt;
  const x = 2600 + Math.sin(titleT * 0.05) * 700, y = 1900 + Math.cos(titleT * 0.04) * 500;
  G.cam.x = x; G.cam.y = y; G.cam.zoom = baseZoom() * 0.92; G.cam.sx = G.cam.sy = 0;
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  let dtReal = (now - last) / 1000; last = now;
  if (G.fixedStep) dtReal = G.fixedStep;
  dtReal = Math.min(dtReal, 0.05); // clamp
  G.realTime += dtReal;
  G.dt = dtReal;
  updateMouseWorld();
  updateTimeOfDay();
  if (G.ui) G.ui.mouseOverUI = false;

  switch (G.mode) {
    case 'title':
      updateTitleCamera(dtReal);
      G.time += dtReal;
      tickTraffic(dtReal);
      Menus.update(dtReal);
      break;
    case 'playing': {
      if (wasPressed('pause')) { G.mode = 'paused'; Menus.open('pause'); sfx('click'); break; }
      if (wasPressed('map')) { G.mode = 'map'; HUD.openMap(); sfx('click'); break; }
      updateWorld(dtReal);
      followPlayer(dtReal);
      break;
    }
    case 'cutscene':
      Dialogue.update(dtReal);
      updateWorld(dtReal);
      Dialogue.updateCamera(dtReal);
      break;
    case 'paused': Menus.update(dtReal); break;
    case 'map': HUD.updateMap(dtReal); break;
    case 'dead': case 'busted': {
      G.deathT += dtReal;
      G.timeScale = 0.3;
      updateWorld(dtReal * 0.3);
      followPlayer(dtReal * 0.3);
      if (G.deathT > 4) respawn(G.mode === 'dead' ? 'hospital' : 'police');
      break;
    }
    case 'credits': Menus.update(dtReal); G.time += dtReal; tickTraffic(dtReal * 0.5); break;
  }
  renderWorld();
  postFx();
  if (G.mode === 'playing' || G.mode === 'dead' || G.mode === 'busted' || G.mode === 'cutscene' || G.mode === 'paused') { HUD.draw(G.ctx); Side.drawUI(G.ctx); Dialogue.draw(G.ctx); }
  if (G.mode === 'map') HUD.drawMap(G.ctx);
  if (G.mode === 'title' || G.mode === 'paused' || G.mode === 'credits') Menus.draw(G.ctx);
  updateAudio(dtReal);
  endFrameInput();
  window.__frames = (window.__frames || 0) + 1;
  requestAnimationFrame(frame);
}

function tickTraffic(dt) {
  for (const v of G.vehicles) { if (v.driver && v.ai && v.ai.mode === 'traffic') updateTrafficCar(v, dt); v.update(dt); }
  for (let i = 0; i < G.vehicles.length; i++) for (let j = i + 1; j < G.vehicles.length; j++) collideVehicles(G.vehicles[i], G.vehicles[j]);
  for (const p of G.peds) p.update(dt);
  updateParticles(dt);
  manageCrowd(dt);
}

function followPlayer(dt) {
  const pl = G.player;
  if (!pl) return;
  const v = pl.vehicle;
  updateCamera(dt, pl.x, pl.y, v ? v.vx : 0, v ? v.vy : 0, v ? v.speed : 0);
}

// ---------- boot ----------
async function boot() {
  const fill = document.getElementById('boot-fill'), msg = document.getElementById('boot-msg');
  const step = (p, m) => new Promise((res) => { fill.style.width = p + '%'; msg.textContent = m; setTimeout(res, 30); });
  await step(10, 'Laying roads…');
  G.city = generateCity(1337);
  await step(40, 'Raising towers…');
  buildCollision(G.city);
  await step(60, 'Painting the map…');
  HUD.init();
  loadBindings();
  Save.loadSettings();
  initInput(canvas);
  input.onFirstGesture = () => initAudio();
  await step(80, 'Waking the city…');
  G.clock = 18 * 60 + 20; // dusk behind the title
  G.player = null;
  G.vehicles = []; G.peds = [];
  G.cam.x = 2600; G.cam.y = 1900;
  R.warmChunks(2600, 1900, 1500);
  manageCrowd(0, true);
  await step(100, 'Ready');
  G.mode = 'title';
  Menus.open('title');
  if (G.debug.shot) setupShot(G.debug.shot);
  document.getElementById('boot').classList.add('hidden');
  canvas.focus();
  requestAnimationFrame((t) => { last = t; frame(t); });
}
boot();
