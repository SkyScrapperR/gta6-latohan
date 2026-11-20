// Boot, fixed-timestep main loop and the top-level state machine:
// boot -> title -> playing <-> paused / map / cutscene, dead / busted -> respawn, credits.
import { G } from './core/state.js';
import { input, initInput, endFrameInput, wasPressed, loadBindings, releasePointer } from './core/input.js';
import { RNG, clamp } from './core/math.js';
import { createGL, createMesh } from './engine/gl.js';
import { Renderer } from './engine/renderer.js';
import { MeshBuilder } from './engine/mesh-builder.js';
import { InstanceBatch } from './engine/instancing.js';
import { generateCity, LAND, SHORE_Z, DISTRICTS, districtAt } from './world/city.js';
import { buildCityMeshes } from './world/city-meshes.js';
import { buildCollision } from './world/collision.js';
import { SignAtlas } from './world/signs.js';
import { rig, updateCamera, playShot, stopShot } from './camera-rig.js';
import { createCharacterBatch } from './entities/character-model.js';
import { Player } from './entities/player.js';
import { Vehicle, collideVehicles } from './entities/vehicle.js';
import { buildVehicleMeshes } from './entities/vehicle-model.js';
import { initWorldPickups, updatePickups, drawPickups, spawnPickup } from './entities/pickups.js';
import { updateParticles, clearFx } from './fx/particles.js';
import { updateWeather } from './fx/weather.js';
import { manageCrowd, updateTrafficCar } from './ai/traffic.js';
import { updateWanted, updatePoliceCar, updateHeli, clearWanted, reportCrime } from './ai/police.js';
import { initAudio, updateAudio, sfx } from './audio/audio.js';
import { assembleScene, setBeamMeshes } from './scene.js';
import * as HUD from './ui/hud.js';
import * as Menus from './ui/menus.js';
import * as BigMap from './ui/bigmap.js';
import * as Dialogue from './story/dialogue.js';
import * as Missions from './story/missions.js';
import * as Side from './story/side-content.js';
import * as Save from './save.js';
import { setupShot } from './debug/screenshots.js';

const canvas = document.getElementById('gl');
const hud = document.getElementById('hud');
const params = new URLSearchParams(location.search);
G.debug.shot = +(params.get('shot') || 0);
G.noPointerLock = params.has('nolock') || !!G.debug.shot;
window.__G = G; // handy for debugging from the console

function resize() {
  G.W = innerWidth; G.H = innerHeight;
  canvas.width = G.W; canvas.height = G.H; hud.width = G.W; hud.height = G.H;
  if (G.renderer) G.renderer.resize(G.W, G.H);
}

// ---------- shared helpers ----------
G.addMoney = (n) => { G.money = Math.max(0, G.money + n); if (n > 0) G.stats.earned += n; };
G.toast = (text, color = '#fff') => HUD.notify({ kind: 'toast', text, color });
G.banner = (title, sub = '', color = '#2ff3e0', time = 4, priority = 1) => HUD.notify({ kind: 'banner', title, sub, color, time, priority });
G.help = (text, time = 0.15) => { G.ui.help = { text, t: time }; };
G.slowMo = (dur) => { G.slowT = Math.max(G.slowT || 0, dur); };
G.onPedDeath = (ped, killer) => {
  if (killer && killer.isPlayer) G.stats.kills++;
  if ((ped.kind === 'civ' || ped.kind === 'cop') && Math.random() < 0.85) spawnPickup('cash', ped.x + 0.6, ped.z + 0.3, { amount: ped.cash, life: 40 });
};
G.onPlayerDeath = () => { G.mode = 'dead'; G.deathT = 0; G.stats.deaths++; sfx('flatline'); Missions.onPlayerDown('You flatlined.'); releasePointer(); };
G.bust = () => {
  if (G.mode !== 'playing') return;
  G.mode = 'busted'; G.deathT = 0; G.stats.arrests++;
  if (G.player.vehicle) G.player.exitVehicle(true);
  sfx('cuffed'); Missions.onPlayerDown('You got cuffed.'); releasePointer();
};
G.onPointerLockLost = () => { if (G.mode === 'playing' && !G.debug.shot) { G.mode = 'paused'; Menus.open('pause'); } };

// ---------- world ----------
export function resetWorld() {
  G.vehicles = []; G.peds = []; G.pickups = []; G.heli = null; G.markers = [];
  clearFx(); clearWanted(); G.arrestProgress = 0;
}
function placeParkedCars() {
  const rng = new RNG(2024);
  for (const p of G.city.parking) {
    const v = new Vehicle(p.police ? 'patrol' : rng.pick(['kancil', 'merpati', 'merpati', 'bajak', 'vesper', 'taxi']), p.x, p.z, p.a);
    v.role = p.police ? 'police' : 'parked'; v.home = true;
    if (p.police) v.ai = { mode: 'parked' };
    G.vehicles.push(v);
  }
}
export function startWorld(data) {
  resetWorld();
  const L = G.city.landmarks;
  const pl = new Player(data ? data.x : L.safehouse.x, data ? data.z : L.safehouse.z);
  G.player = pl;
  if (data) Save.applyToPlayer(data, pl);
  initWorldPickups();
  placeParkedCars();
  stopShot();
  rig.yaw = -Math.PI / 2; rig.pitch = 0.25;
  updateCamera(0.016);
  manageCrowd(0, true);
  G.mode = 'playing'; G.areaKey = null;
}
G.newGame = () => { Save.resetProgress(); startWorld(null); Missions.startMission(0); };
G.continueGame = () => { const d = Save.load(); if (!d) return G.newGame(); Save.applyToState(d); startWorld(d.player); };
G.quitToTitle = () => {
  Missions.abort(); resetWorld(); G.player = null; G.waypoint = null; G.ui.objective = '';
  G.clock = 18 * 60 + 20; G.mode = 'title'; Menus.open('title'); startTitleCamera(); releasePointer();
  manageCrowd(0, true);
};

function respawn(where) {
  const pl = G.player, lm = G.city.landmarks[where === 'hospital' ? 'hospital' : 'police'];
  clearWanted(); G.heli = null;
  for (let i = G.vehicles.length - 1; i >= 0; i--) if (G.vehicles[i].ai && G.vehicles[i].ai.mode === 'chase') G.vehicles.splice(i, 1);
  G.peds = G.peds.filter((p) => p.kind !== 'cop' || p.vehicle);
  pl.alive = true; pl.hp = pl.maxHp; pl.deadT = 0; pl.vehicle = null; pl.entering = null;
  if (where === 'police') { pl.armor = 0; for (const k in pl.ammo) { pl.ammo[k] = 0; pl.clip[k] = 0; } pl.weapon = 'fists'; }
  pl.x = lm.x; pl.z = lm.z + 2;
  G.money = Math.max(0, G.money - 100);
  G.timeScale = 1; G.arrestProgress = 0; G.mode = 'playing';
  rig.yaw = -Math.PI / 2;
  G.banner(where === 'hospital' ? 'SELARA GENERAL' : 'POLICE HQ', 'Fees paid: $100', '#ffffff', 3);
}

// ---------- simulation tick ----------
function tick(dt) {
  const pl = G.player;
  G.time += dt; G.dt = dt;
  if (!G.clockFrozen) G.clock = (G.clock + dt) % 1440;
  G.stats.played += dt;
  updateWeather(dt);
  if (pl) pl.update(dt);
  for (const v of G.vehicles) {
    if (v.driver && !v.driver.isPlayer && v.ai) {
      if (v.ai.mode === 'traffic') updateTrafficCar(v, dt);
      else if (v.ai.mode === 'chase' || v.ai.mode === 'leave' || v.ai.mode === 'block') updatePoliceCar(v, dt);
      else if (v.ai.mode === 'script' && v.ai.update) v.ai.update(v, dt);
    } else if (!v.driver || !v.driver.isPlayer) { v.ctl.throttle = 0; v.ctl.brake = 0.6; v.ctl.steer = 0; v.ctl.handbrake = false; }
    v.update(dt);
  }
  for (let i = 0; i < G.vehicles.length; i++) for (let j = i + 1; j < G.vehicles.length; j++) collideVehicles(G.vehicles[i], G.vehicles[j]);
  for (const p of G.peds) p.update(dt);
  vehiclePedHits();
  if (pl) { updateWanted(dt); updateHeli(dt); }
  if (G.arrestProgress > 0) { G.arrestProgress -= dt * 0.5; if (G.arrestProgress > 1.4) G.bust(); }
  updatePickups(dt);
  updateParticles(dt);
  if (G.shotUpdate) G.shotUpdate(dt);
  if (pl) { Side.update(dt); Missions.update(dt); Dialogue.tickSubs(dt); }
  manageCrowd(dt);
  const diff = G.money - G.moneyShown;
  G.moneyShown += Math.sign(diff) * Math.min(Math.abs(diff), Math.max(1, Math.abs(diff) * dt * 4));
  if (pl) {
    const key = districtAt(pl.x, pl.z);
    if (key !== G.areaKey) { G.areaKey = key; G.ui.area = { text: DISTRICTS[key].name, sub: DISTRICTS[key].sub, color: DISTRICTS[key].color, t: 3.5 }; }
  }
}

function vehiclePedHits() {
  for (const v of G.vehicles) {
    const sp = v.speed;
    if (sp < 2.5) continue;
    for (const p of G.peds) {
      if (p.dead || p.vehicle || p.state === 'down') continue;
      if (Math.abs(p.x - v.x) > v.len || Math.abs(p.z - v.z) > v.len) continue;
      for (const [cx, cz] of v.circles()) {
        const dx = p.x - cx, dz = p.z - cz, rr = v.wid / 2 + p.r;
        if (dx * dx + dz * dz < rr * rr) {
          if (sp > 5) {
            p.knockDown(v.vx * 0.8 + dx * 2, v.vz * 0.8 + dz * 2, sp * 3.2, v.driver);
            sfx('thud', { x: p.x, y: 1, z: p.z });
            if (v.driver && v.driver.isPlayer) { reportCrime(p.dead ? (p.kind === 'cop' ? 'killCop' : 'kill') : 'hitPed', p.x, p.z); if (p.dead) G.stats.kills++; }
          } else { const d = Math.hypot(dx, dz) || 1; p.x = cx + dx / d * rr; p.z = cz + dz / d * rr; }
          break;
        }
      }
    }
  }
}

// ---------- title camera ----------
const TITLE_SHOTS = [
  { from: [398, 3, 470], to: [420, 9, 300], lookFrom: [420, 40, 300], lookTo: [450, 60, 180], dur: 26 },
  { from: [520, 50, 640], to: [610, 30, 520], lookFrom: [470, 60, 380], lookTo: [480, 50, 360], dur: 26 },
];
let titleShot = 0;
function startTitleCamera() { titleShot = 0; playShot({ ...TITLE_SHOTS[0], fov: 55 }); }
function updateTitleCamera() { if (rig.cine && rig.cine.t > rig.cine.dur) { titleShot = (titleShot + 1) % TITLE_SHOTS.length; playShot({ ...TITLE_SHOTS[titleShot], fov: 55 }); } }

// ---------- main loop ----------
let last = 0, acc = 0, fpsAvg = 60;
function frame(now) {
  const dtReal = Math.min(0.1, Math.max(0.001, (now - last) / 1000)); last = now;
  G.realTime += dtReal;
  fpsAvg = fpsAvg * 0.95 + (1 / dtReal) * 0.05;
  adaptPerformance();
  if (G.slowT > 0) { G.slowT -= dtReal; G.timeScale = G.slowT > 0 ? 0.35 : 1; }
  const playingLike = G.mode === 'playing' || G.mode === 'cutscene';
  switch (G.mode) {
    case 'title': updateTitleCamera(); Menus.update(dtReal); simulate(dtReal, true); break;
    case 'playing':
      if (wasPressed('pause') && !G.debug.shot) { G.mode = 'paused'; Menus.open('pause'); releasePointer(); sfx('click'); break; }
      if (wasPressed('map')) { G.mode = 'map'; BigMap.open(); releasePointer(); sfx('click'); break; }
      if (wasPressed('cinematic')) rig.cinematic = !rig.cinematic;
      simulate(dtReal);
      break;
    case 'cutscene': Dialogue.update(dtReal); simulate(dtReal); break;
    case 'paused': Menus.update(dtReal); break;
    case 'map': BigMap.update(dtReal); break;
    case 'dead': case 'busted':
      G.deathT += dtReal; G.timeScale = 0.3;
      simulate(dtReal);
      if (G.deathT > 4.5) respawn(G.mode === 'dead' ? 'hospital' : 'police');
      break;
    case 'credits': Menus.update(dtReal); simulate(dtReal * 0.5, true); break;
  }
  if (G.mode !== 'paused' && G.mode !== 'map') updateCamera(dtReal);
  assembleScene(G.renderer, dtReal);
  if (G.player || G.mode === 'title' || G.mode === 'credits') drawPickups();
  G.renderer.render(G.time);
  // 2D overlay
  const ctx = G.hctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, G.W, G.H);
  if (playingLike || G.mode === 'dead' || G.mode === 'busted' || G.mode === 'paused') { HUD.draw(ctx, dtReal); Side.drawUI(ctx); Dialogue.draw(ctx); }
  if (G.mode === 'map') BigMap.draw(ctx);
  if (G.mode === 'title' || G.mode === 'paused' || G.mode === 'credits') Menus.draw(ctx);
  updateAudio(dtReal);
  endFrameInput();
  window.__frames = (window.__frames || 0) + 1;
  requestAnimationFrame(frame);
}

function simulate(dtReal, ambientOnly = false) {
  const step = 1 / 60;
  acc += dtReal * G.simSpeed * (G.mode === 'dead' || G.mode === 'busted' ? 0.3 : G.timeScale);
  let n = 0;
  while (acc >= step && n < 8 * Math.max(1, G.simSpeed)) {
    if (ambientOnly) ambientTick(step); else tick(step);
    acc -= step; n++;
  }
  if (acc > step * 4) acc = 0;
}
function ambientTick(dt) {
  G.time += dt;
  for (const v of G.vehicles) { if (v.driver && v.ai && v.ai.mode === 'traffic') updateTrafficCar(v, dt); v.update(dt); }
  for (let i = 0; i < G.vehicles.length; i++) for (let j = i + 1; j < G.vehicles.length; j++) collideVehicles(G.vehicles[i], G.vehicles[j]);
  for (const p of G.peds) p.update(dt);
  updateParticles(dt);
  manageCrowd(dt);
}

let perfT = 0;
function adaptPerformance() {
  perfT += 1;
  if (perfT % 30) return;
  const R = G.renderer;
  // dynamic resolution + crowd density follow the frame rate
  if (fpsAvg < 45 && R.adaptive > 0.6) { R.adaptive = Math.max(0.6, R.adaptive - 0.1); R.needResize = true; R.resize(G.W, G.H); }
  else if (fpsAvg > 58 && R.adaptive < 1) { R.adaptive = Math.min(1, R.adaptive + 0.05); R.needResize = true; R.resize(G.W, G.H); }
  G.perfScale = clamp((fpsAvg - 20) / 35, 0.5, 1);
  if (G.fixedPerf) G.perfScale = 1;
}

// ---------- boot ----------
function buildBeamMeshes(gl) {
  const mk = (r0, r1, seg) => {
    const m = new MeshBuilder();
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      m.quad([c0 * r0, 0, s0 * r0], [c1 * r0, 0, s1 * r0], [c1 * r1, 1, s1 * r1], [c0 * r1, 1, s0 * r1], [(c0 + c1) / 2, 0, (s0 + s1) / 2], [1, 1, 1], 0, 0, [0, 0, 1, 0, 1, 1, 0, 1]);
    }
    return createMesh(gl, m.toArray());
  };
  return { cylinder: mk(1, 1, 18), cone: mk(0.06, 1, 16) };
}

async function boot() {
  const fill = document.getElementById('boot-fill'), msg = document.getElementById('boot-msg');
  const step = (p, m) => new Promise((res) => { fill.style.width = p + '%'; msg.textContent = m; setTimeout(res, 20); });
  await step(5, 'Starting the WebGL2 engine…');
  G.hctx = hud.getContext('2d');
  Save.loadSettings();
  G.gl = createGL(canvas);
  G.renderer = new Renderer(G.gl);
  G.renderer.setQuality(params.get('q') || G.settings.quality);
  resize(); addEventListener('resize', resize);
  await step(15, 'Laying roads and districts…');
  G.city = generateCity(1337);
  await step(35, 'Building city meshes…');
  G.atlas = new SignAtlas();
  const built = buildCityMeshes(G.gl, G.city, G.atlas);
  G.renderer.atlas = G.atlas.upload(G.gl);
  G.renderer.statics = built.statics;
  await step(60, 'Spawning props, cars and people…');
  G.props = built.batches;
  G.props.characters = createCharacterBatch(G.gl);
  const wm = new MeshBuilder(); wm.wheel(0.34, 0.24, [0.07, 0.07, 0.08]);
  G.props.wheels = new InstanceBatch(createMesh(G.gl, wm.toArray()), { name: 'wheels' });
  G.props.pickups = HUD.createPickupBatch ? null : null;
  buildVehicleMeshes(G.gl);
  setBeamMeshes(buildBeamMeshes(G.gl));
  G.renderer.batches = Object.values(G.props).filter(Boolean);
  G.renderer.land = [LAND.x0, LAND.z0, LAND.x1, SHORE_Z];
  await step(75, 'Mapping collisions…');
  buildCollision(G.city);
  await step(85, 'Painting the map…');
  HUD.init();
  BigMap.init();
  loadBindings();
  initInput(hud);
  input.onFirstGesture = () => initAudio();
  G.clock = 18 * 60 + 20;
  G.mode = 'title';
  Menus.open('title');
  startTitleCamera();
  updateCamera(0.016);
  assembleScene(G.renderer, 0.016);
  manageCrowd(0, true);
  await step(100, 'Ready');
  if (G.debug.shot) setupShot(G.debug.shot);
  document.getElementById('boot').classList.add('hidden');
  hud.focus();
  requestAnimationFrame((t) => { last = t; frame(t); });
}
boot().catch((e) => { console.error(e); document.getElementById('boot-msg').textContent = 'Error: ' + e.message; });
