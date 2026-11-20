// Wanted system (heat -> 0-5 stars, line-of-sight tracking, search area, cool-down),
// police dispatch, cop-car chase/ram AI, officers on foot and the police helicopter.
import { G } from '../state.js';
import { clamp, angleDiff, RNG, TAU } from '../util.js';
import { lineBlocked } from '../world/collision.js';
import { nearestNode, bfsPath, nodeXY } from '../world/roads.js';
import { spawnTrafficCar, steerToward, obstacleAhead } from './traffic.js';
import { viewRect } from '../camera.js';
import { copBrain } from './combat-ai.js';
import { fireWeapon } from '../combat/weapons.js';
import { addLight, addGlow } from '../fx/lighting.js';
import { project } from '../world/render-city.js';
import { sfx } from '../audio/audio.js';

const rng = new RNG(31337);
export const STAR_HEAT = [0, 10, 60, 160, 320, 540];
const UNITS = [0, 1, 2, 3, 4, 6];
const CRIMES = {
  gunfire: { heat: 4, witness: 'people' }, assault: { heat: 10 }, kill: { heat: 45 }, shootCop: { heat: 60 },
  killCop: { heat: 140 }, explosion: { heat: 35 }, hitPed: { heat: 14 }, carjack: { heat: 18, witness: 'police' },
  stealCop: { stars: 2 }, damageCop: { heat: 3 },
};
let dispatchTimer = 0;

export function starsForHeat(h) { let s = 0; for (let i = 1; i <= 5; i++) if (h >= STAR_HEAT[i]) s = i; return s; }

function policeSees(x, y, range = 460) {
  for (const p of G.peds) {
    if (p.kind !== 'cop' || p.dead) continue;
    const r = p.vehicle ? range + 40 : range;
    if (Math.abs(p.x - x) > r || Math.abs(p.y - y) > r) continue;
    if (!lineBlocked(p.x, p.y, x, y)) return true;
  }
  for (const v of G.vehicles) {
    if (v.role !== 'police' || !v.driver || v.driver.isPlayer || v.wrecked) continue;
    if (Math.abs(v.x - x) > range + 40 || Math.abs(v.y - y) > range + 40) continue;
    if (!lineBlocked(v.x, v.y, x, y)) return true;
  }
  if (G.heli && !G.heli.leaving && Math.hypot(G.heli.x - x, G.heli.y - y) < 700) return true;
  return false;
}
function peopleNear(x, y, r = 320) {
  for (const p of G.peds) if (!p.dead && Math.abs(p.x - x) < r && Math.abs(p.y - y) < r) return true;
  return false;
}

export function reportCrime(type, x, y) {
  const c = CRIMES[type];
  if (!c || G.mode === 'title' || G.noCrime) return;
  if (c.witness === 'police' && !policeSees(x, y)) return;
  if (c.witness === 'people' && !peopleNear(x, y) && !policeSees(x, y)) return;
  if (c.stars) setWanted(Math.max(G.wanted.stars, c.stars));
  else addHeat(c.heat);
}

export function addHeat(n) {
  const w = G.wanted;
  w.heat += n;
  const s = starsForHeat(w.heat);
  if (s > w.stars) { w.stars = s; w.flash = 1.5; if (s >= 1) sfx('star'); }
  if (G.player) { w.lastX = G.player.x; w.lastY = G.player.y; }
  w.seen = true; w.unseen = 0;
}
export function setWanted(stars) {
  const w = G.wanted;
  w.heat = Math.max(w.heat, STAR_HEAT[stars] + 1);
  if (stars > w.stars) { w.flash = 1.5; sfx('star'); }
  w.stars = Math.max(w.stars, stars);
  if (G.player) { w.lastX = G.player.x; w.lastY = G.player.y; }
  w.seen = true; w.unseen = 0;
}
export function clearWanted() {
  const w = G.wanted;
  w.heat = 0; w.stars = 0; w.unseen = 0; w.seen = true;
  for (const v of G.vehicles) if (v.ai && v.ai.mode === 'chase') { v.ai.mode = 'leave'; v.siren = false; }
}

/** Per-frame wanted logic: visibility, search area, cool-down and dispatch. */
export function updateWanted(dt) {
  const w = G.wanted, pl = G.player;
  w.flash = Math.max(0, w.flash - dt);
  if (!pl || !pl.alive) return;
  if (w.stars === 0) { w.heat = Math.max(0, w.heat - dt * 2); return; }
  w.heat = Math.max(w.heat, STAR_HEAT[w.stars]);
  w.seen = policeSees(pl.x, pl.y, 440);
  if (w.seen) { w.lastX = pl.x; w.lastY = pl.y; w.unseen = 0; }
  else {
    w.unseen += dt;
    if (w.unseen > clearTime()) { clearWanted(); G.toast && G.toast('Lost the cops', '#2ff3e0'); sfx('cleared'); return; }
  }
  // dispatch
  dispatchTimer -= dt;
  const chasing = G.vehicles.filter((v) => v.ai && v.ai.mode === 'chase' && !v.wrecked).length;
  if (dispatchTimer <= 0 && chasing < UNITS[w.stars]) {
    dispatchTimer = 2.5;
    // recruit a nearby patrol first
    const patrol = G.vehicles.find((v) => v.role === 'police' && v.driver && !v.wrecked && v.ai && v.ai.mode === 'traffic' && Math.hypot(v.x - pl.x, v.y - pl.y) < 1100);
    const v = patrol || spawnTrafficCar(viewRect(40), true, pl.x, pl.y);
    if (v) startChase(v);
  }
  const copsOnFoot = G.peds.filter((p) => p.kind === 'cop' && !p.dead && !p.vehicle).length;
  w.copsOnFoot = copsOnFoot;
  if (w.stars >= 3 && !G.heli) spawnHeli();
}
export function clearTime() { return 6 + G.wanted.stars * 5; }

export function startChase(v) {
  v.ai = { mode: 'chase', stuck: 0, reverse: 0, path: null, pathT: 0, deployT: 0 };
  v.siren = true; v.role = 'police';
  if (v.driver) v.driver.car = v;
}

// ---------- police car AI ----------
export function updatePoliceCar(v, dt) {
  const ai = v.ai, pl = G.player, w = G.wanted;
  if (!v.driver || v.wrecked) { v.siren = false; v.ctl = { throttle: 0, brake: 1, steer: 0, handbrake: false }; return; }
  if (ai.mode === 'leave') {
    // drive off and get culled by the spawner
    v.siren = false;
    const fx = Math.cos(v.angle), fy = Math.sin(v.angle);
    steerToward(v, v.x + fx * 100, v.y + fy * 100, 120);
    if (obstacleAhead(v, 60) < 20) { v.ctl.throttle = 0; v.ctl.brake = 1; }
    return;
  }
  const tx = w.seen ? pl.x : w.lastX, ty = w.seen ? pl.y : w.lastY;
  const d = Math.hypot(tx - v.x, ty - v.y);
  if (ai.reverse > 0) { ai.reverse -= dt; v.ctl = { throttle: 0, brake: 1, steer: ai.revSteer, handbrake: false }; return; }
  const los = d < 300 && !lineBlocked(v.x, v.y, tx, ty, 10);
  let gx = tx, gy = ty, desired = 330;
  if (!los) {
    ai.pathT -= dt;
    if (ai.pathT <= 0 || !ai.path) { ai.path = bfsPath(nearestNode(v.x, v.y), nearestNode(tx, ty)); ai.pathT = 0.8; }
    while (ai.path.length > 1) {
      const n = nodeXY(ai.path[0]);
      if (Math.hypot(n.x - v.x, n.y - v.y) < 50) ai.path.shift(); else break;
    }
    const n = nodeXY(ai.path[0]);
    gx = n.x; gy = n.y;
    if (ai.path.length === 1 && Math.hypot(gx - v.x, gy - v.y) < 60) { gx = tx; gy = ty; }
  }
  const diff = Math.abs(angleDiff(v.angle, Math.atan2(gy - v.y, gx - v.x)));
  if (diff > 0.6) desired = 150;
  if (diff > 1.4) desired = 90;
  // on-foot suspect: pull up and deploy officers
  if (!pl.vehicle && d < 150 && w.seen) desired = Math.max(0, (d - 60) * 2);
  steerToward(v, gx, gy, desired);
  if (pl.vehicle && d < 140 && los) { v.ctl.throttle = 1; v.ctl.brake = 0; } // ram
  if (!pl.vehicle && d < 170 && v.speed < 50 && w.seen) deployOfficers(v);
  // arrest a suspect sitting still in a car at 1 star
  if (pl.vehicle && w.stars === 1 && d < 70 && pl.vehicle.speed < 25 && v.speed < 30) deployOfficers(v);
  // stuck?
  if (v.speed < 14 && v.ctl.throttle > 0.3) { ai.stuck += dt; if (ai.stuck > 1.1) { ai.reverse = 0.9; ai.revSteer = rng.sign(); ai.stuck = 0; } }
  else ai.stuck = Math.max(0, ai.stuck - dt);
}

function deployOfficers(v) {
  const d = v.driver;
  if (!d || d.isPlayer) return;
  const door = v.doorPos(1);
  d.vehicle = null; d.x = door.x; d.y = door.y;
  d.brain = copBrain; d.state = 'combat'; d.car = v;
  if (!G.peds.includes(d)) G.peds.push(d);
  v.driver = null; v.ai = { mode: 'parked' }; v.siren = true;
  v.role = 'police';
  for (const p of v.passengers) { p.vehicle = null; const dd = v.doorPos(-1); p.x = dd.x; p.y = dd.y; p.brain = copBrain; p.car = v; if (!G.peds.includes(p)) G.peds.push(p); }
  v.passengers = [];
  sfx('door', { x: v.x, y: v.y });
}

/** Officer climbs back into his car to resume the chase. */
export function copReenter(p, v) {
  p.vehicle = v; v.driver = p; startChase(v);
}

// ---------- helicopter ----------
function spawnHeli() {
  const pl = G.player;
  const a = rng.range(0, TAU);
  G.heli = { x: pl.x + Math.cos(a) * 1300, y: pl.y + Math.sin(a) * 1300, vx: 0, vy: 0, angle: a + Math.PI, rotor: 0, alt: 230, spotX: pl.x, spotY: pl.y, cooldown: 3, burst: 0, leaving: false, hp: 1 };
  sfx('heli');
}

export function updateHeli(dt) {
  const h = G.heli, pl = G.player, w = G.wanted;
  if (!h) return;
  h.rotor += dt * 40;
  if (w.stars < 3 || !pl.alive) h.leaving = true;
  let tx, ty;
  if (h.leaving) { tx = h.x + Math.cos(h.angle) * 500; ty = h.y + Math.sin(h.angle) * 500; }
  else {
    const t = G.time * 0.5;
    const bx = w.seen ? pl.x : w.lastX, by = w.seen ? pl.y : w.lastY;
    tx = bx + Math.cos(t) * 140; ty = by + Math.sin(t) * 110;
  }
  const dx = tx - h.x, dy = ty - h.y, d = Math.hypot(dx, dy) || 1;
  const sp = Math.min(380, d * 1.2);
  h.vx += ((dx / d) * sp - h.vx) * Math.min(1, dt * 1.5);
  h.vy += ((dy / d) * sp - h.vy) * Math.min(1, dt * 1.5);
  h.x += h.vx * dt; h.y += h.vy * dt;
  const want = Math.atan2(h.vy, h.vx);
  if (Math.hypot(h.vx, h.vy) > 30) h.angle += angleDiff(h.angle, want) * Math.min(1, dt * 2);
  // spotlight tracks the player with lag (searches the last known spot when unseen)
  const sx = w.seen ? pl.x : w.lastX + Math.sin(G.time * 1.3) * 120, sy = w.seen ? pl.y : w.lastY + Math.cos(G.time * 0.9) * 120;
  h.spotX += (sx - h.spotX) * Math.min(1, dt * 2.2);
  h.spotY += (sy - h.spotY) * Math.min(1, dt * 2.2);
  if (h.leaving) { if (Math.hypot(h.x - pl.x, h.y - pl.y) > 1800) G.heli = null; return; }
  // 4+ stars: fire bursts from the door gun
  if (w.stars >= 4 && w.seen) {
    h.cooldown -= dt;
    if (h.cooldown <= 0) { h.burst = 6; h.cooldown = 3.2; }
    if (h.burst > 0) {
      h.burstT = (h.burstT || 0) - dt;
      if (h.burstT <= 0) {
        h.burstT = 0.09; h.burst--;
        const a = Math.atan2(pl.y - h.y, pl.x - h.x);
        fireWeapon({ kind: 'heli', x: h.x, y: h.y }, 'wasp', h.x, h.y, a, 0.08);
      }
    }
  }
}

export function drawHeli(ctx, t) {
  const h = G.heli;
  if (!h) return;
  const amb = G.light.amb;
  // shadow on the ground
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.save(); ctx.translate(h.x + 60, h.y + 70); ctx.rotate(h.angle); ctx.beginPath(); ctx.ellipse(0, 0, 30, 12, 0, 0, TAU); ctx.fill(); ctx.restore();
  // spotlight: light map + visible beam
  addLight(h.spotX, h.spotY, 120, '255,255,235', 1, 'point');
  const [hx, hy] = project(h.x, h.y, h.alt);
  const night = G.light.night;
  if (night > 0.15) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(hx, hy, h.spotX, h.spotY);
    g.addColorStop(0, `rgba(255,255,230,${0.28 * night})`); g.addColorStop(1, `rgba(255,255,230,${0.08 * night})`);
    ctx.fillStyle = g;
    const ang = Math.atan2(h.spotY - hy, h.spotX - hx), px = -Math.sin(ang), py = Math.cos(ang);
    ctx.beginPath(); ctx.moveTo(hx + px * 4, hy + py * 4); ctx.lineTo(h.spotX + px * 60, h.spotY + py * 60); ctx.lineTo(h.spotX - px * 60, h.spotY - py * 60); ctx.lineTo(hx - px * 4, hy - py * 4); ctx.closePath(); ctx.fill();
    const sg = ctx.createRadialGradient(h.spotX, h.spotY, 0, h.spotX, h.spotY, 62);
    sg.addColorStop(0, `rgba(255,255,240,${0.35 * night})`); sg.addColorStop(1, 'rgba(255,255,240,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(h.spotX, h.spotY, 62, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // body
  const s = 1.18;
  ctx.save();
  ctx.translate(hx, hy); ctx.rotate(h.angle); ctx.scale(s, s);
  const col = (r, g, b) => `rgb(${(r * amb[0]) | 0},${(g * amb[1]) | 0},${(b * amb[2]) | 0})`;
  ctx.fillStyle = col(30, 40, 70); ctx.fillRect(-34, -2.5, 26, 5);            // tail boom
  ctx.fillRect(-38, -8, 5, 16);                                                 // tail fin
  ctx.fillStyle = col(235, 235, 240);
  ctx.beginPath(); ctx.ellipse(0, 0, 17, 10, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = col(30, 60, 140); ctx.fillRect(-12, -10, 14, 3); ctx.fillRect(-12, 7, 14, 3);
  ctx.fillStyle = 'rgba(80,140,200,0.85)'; ctx.beginPath(); ctx.ellipse(9, 0, 7, 7, 0, -1.2, 1.2); ctx.fill();
  // rotor
  ctx.strokeStyle = 'rgba(20,20,20,0.75)'; ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) { const a = h.rotor + i * Math.PI / 2; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 34, Math.sin(a) * 34); }
  ctx.stroke();
  ctx.fillStyle = 'rgba(40,40,40,0.12)'; ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.fill();
  ctx.restore();
  const blink = Math.floor(t * 3) % 2;
  addGlow(hx, hy, 10, blink ? '255,40,40' : '40,255,80', 1);
}
