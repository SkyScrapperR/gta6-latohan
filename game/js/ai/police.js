// Wanted level and police: heat -> 0-5 stars, line-of-sight tracking with a search area and
// cool-down, dispatch of Garuda Patrol units that chase via the road graph and ram, officers
// on foot, roadblocks at 3+ stars, and the Rajawali helicopter (spotlight cone at 3+, door
// gun at 4+, can be shot down: smokes, spirals and explodes for +1 star).
import { G } from '../core/state.js';
import { clamp, angleDiff, RNG, mat4, TAU } from '../core/math.js';
import { lineBlocked } from '../world/collision.js';
import { nearestNode, bfsPath, nodeXZ, neighbors, laneOffset } from '../world/roads.js';
import { CELL, ROAD } from '../world/city.js';
import { spawnTrafficCar, steerToward, obstacleAhead } from './traffic.js';
import { copBrain } from './combat-ai.js';
import { fireWeapon } from '../combat/weapons.js';
import { Vehicle } from '../entities/vehicle.js';
import { Ped } from '../entities/pedestrian.js';
import { smoke, fire } from '../fx/particles.js';
import { MeshBuilder, MAT } from '../engine/mesh-builder.js';
import { createMesh } from '../engine/gl.js';
import { sfx } from '../audio/audio.js';

const rng = new RNG(31337);
export const STAR_HEAT = [0, 10, 60, 160, 320, 540];
const UNITS = [0, 1, 2, 3, 4, 6];
const CRIMES = {
  gunfire: { heat: 4, witness: 'people' }, assault: { heat: 10 }, kill: { heat: 45 }, shootCop: { heat: 60 }, killCop: { heat: 140 },
  explosion: { heat: 35 }, hitPed: { heat: 14 }, carjack: { heat: 18, witness: 'police' }, stealCop: { stars: 2 }, damageCop: { heat: 3 },
};
let dispatchT = 0, roadblockT = 0;

export function starsForHeat(h) { let s = 0; for (let i = 1; i <= 5; i++) if (h >= STAR_HEAT[i]) s = i; return s; }

export function policeSees(x, z, range = 60) {
  for (const p of G.peds) {
    if (p.kind !== 'cop' || p.dead || p.vehicle) continue;
    if (Math.abs(p.x - x) > range || Math.abs(p.z - z) > range) continue;
    if (!lineBlocked(p.x, p.z, x, z)) return true;
  }
  for (const v of G.vehicles) {
    if ((v.role !== 'police') || !v.driver || v.driver.isPlayer || v.wrecked) continue;
    if (Math.abs(v.x - x) > range + 10 || Math.abs(v.z - z) > range + 10) continue;
    if (!lineBlocked(v.x, v.z, x, z)) return true;
  }
  const h = G.heli;
  if (h && !h.leaving && !h.down && Math.hypot(h.x - x, h.z - z) < 90) return true;
  return false;
}
const peopleNear = (x, z, r = 40) => G.peds.some((p) => !p.dead && Math.abs(p.x - x) < r && Math.abs(p.z - z) < r);

export function reportCrime(type, x, z) {
  const c = CRIMES[type];
  if (!c || G.mode === 'title' || G.noCrime) return;
  if (c.witness === 'police' && !policeSees(x, z)) return;
  if (c.witness === 'people' && !peopleNear(x, z) && !policeSees(x, z)) return;
  if (c.stars) setWanted(Math.max(G.wanted.stars, c.stars)); else addHeat(c.heat);
}
export function addHeat(n) {
  const w = G.wanted;
  w.heat += n;
  const s = Math.min(5, starsForHeat(w.heat));
  if (s > w.stars) { w.stars = s; w.flash = 1.5; sfx('star'); }
  if (G.player) { w.lastX = G.player.x; w.lastZ = G.player.z; }
  w.seen = true; w.unseen = 0;
}
export function setWanted(stars) {
  const w = G.wanted;
  stars = Math.min(5, stars);
  w.heat = Math.max(w.heat, STAR_HEAT[stars] + 1);
  if (stars > w.stars) { w.flash = 1.5; sfx('star'); }
  w.stars = Math.max(w.stars, stars);
  if (G.player) { w.lastX = G.player.x; w.lastZ = G.player.z; }
  w.seen = true; w.unseen = 0;
}
export function clearWanted() {
  const w = G.wanted;
  w.heat = 0; w.stars = 0; w.unseen = 0; w.seen = true;
  for (const v of G.vehicles) if (v.ai && (v.ai.mode === 'chase' || v.ai.mode === 'block')) { v.ai = { mode: 'leave' }; v.siren = false; }
  if (G.heli) G.heli.leaving = true;
}
export const clearTime = () => 8 + G.wanted.stars * 6;

export function updateWanted(dt) {
  const w = G.wanted, pl = G.player;
  w.flash = Math.max(0, w.flash - dt);
  if (!pl || !pl.alive) return;
  if (w.stars === 0) { w.heat = Math.max(0, w.heat - dt * 2); return; }
  w.heat = Math.max(w.heat, STAR_HEAT[w.stars]);
  w.seen = policeSees(pl.x, pl.z, 60);
  if (w.seen) { w.lastX = pl.x; w.lastZ = pl.z; w.unseen = 0; }
  else { w.unseen += dt; if (w.unseen > clearTime()) { clearWanted(); G.toast('Lost the cops', '#2ff3e0'); sfx('cleared'); return; } }
  dispatchT -= dt;
  const chasing = G.vehicles.filter((v) => v.ai && v.ai.mode === 'chase' && !v.wrecked).length;
  if (dispatchT <= 0 && chasing < UNITS[w.stars]) {
    dispatchT = 3;
    const patrol = G.vehicles.find((v) => v.role === 'police' && v.driver && !v.driver.isPlayer && !v.wrecked && v.ai && v.ai.mode === 'traffic' && Math.hypot(v.x - pl.x, v.z - pl.z) < 200);
    const v = patrol || spawnTrafficCar(true, pl.x, pl.z, true);
    if (v) startChase(v);
  }
  if (w.stars >= 3) { roadblockT -= dt; if (roadblockT <= 0 && pl.vehicle && pl.vehicle.speed > 8) { roadblockT = 25; spawnRoadblock(); } }
  if (w.stars >= 3 && !G.heli) spawnHeli();
}

export function startChase(v) {
  v.ai = { mode: 'chase', stuck: 0, reverse: 0, path: null, pathT: 0 };
  v.siren = true; v.role = 'police';
  if (v.driver) v.driver.car = v;
}
export function copReenter(p, v) { p.vehicle = v; v.driver = p; const i = G.peds.indexOf(p); if (i < 0) G.peds.push(p); startChase(v); }
G.copReenter = copReenter;

/** Two cruisers parked across the road ahead of the player, officers standing guard. */
function spawnRoadblock() {
  const pl = G.player, v = pl.vehicle;
  const fx = Math.cos(v.angle), fz = Math.sin(v.angle);
  const n = nearestNode(pl.x + fx * 120, pl.z + fz * 120);
  const nb = neighbors(n);
  const back = nb.reduce((best, m) => { const q = nodeXZ(m), p = nodeXZ(n); const dot = (q.x - p.x) * -fx + (q.z - p.z) * -fz; return dot > best.d ? { m, d: dot } : best; }, { m: nb[0], d: -Infinity }).m;
  const A = nodeXZ(n), B = nodeXZ(back);
  const dx = Math.sign(B.x - A.x), dz = Math.sign(B.z - A.z);
  const bx = A.x + dx * (ROAD + 10), bz = A.z + dz * (ROAD + 10);
  const ang = Math.atan2(dz, dx) + Math.PI / 2;
  for (const s of [-1, 1]) {
    const o = laneOffset(dx, dz);
    const c = new Vehicle('patrol', bx + o.x * s * 0.9, bz + o.z * s * 0.9, ang + (s > 0 ? 0.3 : -0.3));
    c.role = 'police'; c.siren = true; c.ai = { mode: 'block' }; c.roadblock = 40;
    G.vehicles.push(c);
    const cop = new Ped('cop', c.x - dx * 4 + o.x * s, c.z - dz * 4 + o.z * s, 'cop');
    cop.weapon = 'kobra'; cop.hp = cop.maxHp = 70; cop.brain = copBrain; cop.car = c; cop.state = 'combat';
    G.peds.push(cop);
  }
}

// ---------- police car AI ----------
export function updatePoliceCar(v, dt) {
  const ai = v.ai, pl = G.player, w = G.wanted;
  if (ai.mode === 'block') { v.ctl = { throttle: 0, brake: 1, steer: 0, handbrake: true }; return; }
  if (!v.driver || v.wrecked) { v.siren = false; v.ctl = { throttle: 0, brake: 1, steer: 0, handbrake: false }; return; }
  if (ai.mode === 'leave') {
    v.siren = false;
    steerToward(v, v.x + Math.cos(v.angle) * 20, v.z + Math.sin(v.angle) * 20, 12);
    if (obstacleAhead(v, 10) < 4) { v.ctl.throttle = 0; v.ctl.brake = 1; }
    return;
  }
  const tx = w.seen ? pl.x : w.lastX, tz = w.seen ? pl.z : w.lastZ;
  const d = Math.hypot(tx - v.x, tz - v.z);
  if (ai.reverse > 0) { ai.reverse -= dt; v.ctl = { throttle: 0, brake: 1, steer: ai.revSteer, handbrake: false }; return; }
  const los = d < 45 && !lineBlocked(v.x, v.z, tx, tz, 1.5);
  let gx = tx, gz = tz, desired = 40;
  if (!los) {
    ai.pathT -= dt;
    if (ai.pathT <= 0 || !ai.path) { ai.path = bfsPath(nearestNode(v.x, v.z), nearestNode(tx, tz)); ai.pathT = 0.8; }
    while (ai.path.length > 1) { const n = nodeXZ(ai.path[0]); if (Math.hypot(n.x - v.x, n.z - v.z) < 8) ai.path.shift(); else break; }
    const n = nodeXZ(ai.path[0]); gx = n.x; gz = n.z;
    if (ai.path.length === 1 && Math.hypot(gx - v.x, gz - v.z) < 9) { gx = tx; gz = tz; }
  }
  const diff = Math.abs(angleDiff(v.angle, Math.atan2(gz - v.z, gx - v.x)));
  if (diff > 0.6) desired = 16; if (diff > 1.4) desired = 9;
  if (!pl.vehicle && d < 22 && w.seen) desired = Math.max(0, (d - 9) * 1.6);
  steerToward(v, gx, gz, desired);
  if (pl.vehicle && d < 20 && los) { v.ctl.throttle = 1; v.ctl.brake = 0; } // ram
  if (!pl.vehicle && d < 24 && v.speed < 4 && w.seen) deployOfficers(v);
  if (pl.vehicle && w.stars === 1 && d < 9 && pl.vehicle.speed < 3 && v.speed < 4) deployOfficers(v);
  if (v.speed < 1.5 && v.ctl.throttle > 0.3) { ai.stuck += dt; if (ai.stuck > 1.2) { ai.reverse = 1; ai.revSteer = rng.sign(); ai.stuck = 0; } }
  else ai.stuck = Math.max(0, ai.stuck - dt);
}

function deployOfficers(v) {
  const d = v.driver;
  if (!d || d.isPlayer) return;
  const door = v.doorPos(1);
  d.vehicle = null; d.x = door.x; d.z = door.z; d.brain = copBrain; d.state = 'combat'; d.car = v;
  if (!G.peds.includes(d)) G.peds.push(d);
  v.driver = null; v.ai = { mode: 'parked' }; v.siren = true;
  sfx('door', { x: v.x, y: 1, z: v.z });
}

// ---------- Rajawali helicopter ----------
let heliMeshes = null;
export function buildHeliMeshes(gl) {
  const b = new MeshBuilder();
  b.bevelBox(-2.4, 0.6, -1.0, 1.6, 2.4, 1.0, 0.3, [1, 1, 1], { mat: MAT.TINT, bottom: true });
  b.box(1.0, 1.1, -0.85, 2.3, 2.2, 0.85, [0.1, 0.12, 0.15], { mat: MAT.GLASS });
  b.box(-7.5, 1.6, -0.18, -2.3, 2.1, 0.18, [0.08, 0.13, 0.32]);
  b.box(-7.6, 1.6, -0.08, -6.9, 3.2, 0.08, [0.08, 0.13, 0.32]);
  b.box(-1.8, 0.7, -1.02, 0.8, 1.2, 1.02, [0.08, 0.13, 0.32]);
  for (const s of [-1, 1]) { b.box(-2.0, 0, s * 1.1 - 0.06, 1.8, 0.1, s * 1.1 + 0.06, [0.15, 0.15, 0.16]); b.box(-1.2, 0, s * 1.1 - 0.04, -1.1, 0.7, s * 1.1 + 0.04, [0.15, 0.15, 0.16]); b.box(0.9, 0, s * 1.1 - 0.04, 1.0, 0.7, s * 1.1 + 0.04, [0.15, 0.15, 0.16]); }
  b.cylinder(0, 2.4, 0, 0.18, 0.5, [0.2, 0.2, 0.22], { seg: 6 });
  b.box(-0.2, 0.4, -0.25, 0.2, 0.6, 0.25, [1, 1, 0.9], { mat: MAT.HEADLIGHT });
  b.box(-0.4, 2.35, -0.3, 0.0, 2.5, -0.05, [1, 0.1, 0.1], { mat: MAT.SIREN_R });
  b.box(-0.4, 2.35, 0.05, 0.0, 2.5, 0.3, [0.1, 0.2, 1], { mat: MAT.SIREN_B });
  const r = new MeshBuilder();
  r.box(-5.5, -0.04, -0.18, 5.5, 0.04, 0.18, [0.08, 0.08, 0.09]);
  r.box(-0.18, -0.04, -5.5, 0.18, 0.04, 5.5, [0.08, 0.08, 0.09]);
  heliMeshes = { body: createMesh(gl, b.toArray()), rotor: createMesh(gl, r.toArray()) };
}

function spawnHeli() {
  const pl = G.player, a = rng.range(0, TAU);
  G.heli = { x: pl.x + Math.cos(a) * 220, z: pl.z + Math.sin(a) * 220, y: 42, vx: 0, vz: 0, angle: a + Math.PI, rotor: 0, spotX: pl.x, spotZ: pl.z, spotOn: true, cooldown: 3, burst: 0, leaving: false, hp: 450, down: false, roll: 0 };
  sfx('heli');
}
G.damageHeli = (dmg) => {
  const h = G.heli;
  if (!h || h.down) return;
  h.hp -= dmg;
  G.ui.hitMarker = 0.25;
  if (h.hp <= 0) { h.down = true; h.spotOn = false; G.toast('Rajawali going down!', '#ffb347'); }
};

export function updateHeli(dt) {
  const h = G.heli, pl = G.player, w = G.wanted;
  if (!h) return;
  h.rotor += dt * 28;
  if (h.down) {
    // spiral down, then explode for an extra star
    h.angle += dt * 4; h.y -= dt * 9; h.x += Math.cos(h.angle) * 6 * dt; h.z += Math.sin(h.angle) * 6 * dt; h.roll = 0.5;
    if (Math.random() < dt * 30) smoke(h.x, h.y + 1.5, h.z, { size: 1.2, life: 3, shade: 0.05, vy: 2 });
    if (Math.random() < dt * 20) fire(h.x, h.y + 1, h.z, 1.2);
    if (h.y <= 1) { G.explode(h.x, h.z, 1.6, pl); setWanted(Math.min(5, w.stars + 1)); G.heli = null; }
    return;
  }
  if (h.hp < 225 && Math.random() < dt * 8) smoke(h.x, h.y + 1.5, h.z, { size: 0.8, life: 2.5, shade: 0.15, vy: 1 });
  if (w.stars < 3 || !pl.alive) { h.leaving = true; h.spotOn = false; }
  let tx, tz;
  if (h.leaving) { tx = h.x + Math.cos(h.angle) * 100; tz = h.z + Math.sin(h.angle) * 100; }
  else {
    const t = G.time * 0.4, bx = w.seen ? pl.x : w.lastX, bz = w.seen ? pl.z : w.lastZ;
    tx = bx + Math.cos(t) * 26; tz = bz + Math.sin(t) * 20;
  }
  const dx = tx - h.x, dz = tz - h.z, d = Math.hypot(dx, dz) || 1, sp = Math.min(48, d * 1.1);
  h.vx += (dx / d * sp - h.vx) * Math.min(1, dt * 1.2); h.vz += (dz / d * sp - h.vz) * Math.min(1, dt * 1.2);
  h.x += h.vx * dt; h.z += h.vz * dt;
  if (Math.hypot(h.vx, h.vz) > 4) h.angle += angleDiff(h.angle, Math.atan2(h.vz, h.vx)) * Math.min(1, dt * 1.5);
  h.roll = clamp(-angleDiff(h.angle, Math.atan2(h.vz, h.vx)) * 0.3, -0.3, 0.3);
  const sx = w.seen ? pl.x : w.lastX + Math.sin(G.time * 1.3) * 18, sz = w.seen ? pl.z : w.lastZ + Math.cos(G.time * 0.9) * 18;
  h.spotX += (sx - h.spotX) * Math.min(1, dt * 2.5); h.spotZ += (sz - h.spotZ) * Math.min(1, dt * 2.5);
  h.spotOn = !h.leaving;
  if (h.leaving) { if (Math.hypot(h.x - pl.x, h.z - pl.z) > 400) G.heli = null; return; }
  if (w.stars >= 4 && w.seen) {
    h.cooldown -= dt;
    if (h.cooldown <= 0) { h.burst = 7; h.cooldown = 3.4; }
    if (h.burst > 0) {
      h.burstT = (h.burstT || 0) - dt;
      if (h.burstT <= 0) { h.burstT = 0.09; h.burst--; fireWeapon({ kind: 'heli', x: h.x, z: h.z }, 'wasp', h.x, h.y - 0.5, h.z, Math.atan2(pl.z - h.z, pl.x - h.x), 0.06); }
    }
  }
}

export function drawHeli(R) {
  const h = G.heli;
  if (!h || !heliMeshes) return;
  const m = mat4.create();
  mat4.trs(m, h.x, h.y, h.z, -h.angle, 1, 1, 1, 0, 0);
  mat4.rotateX(m, m, h.roll); mat4.rotateZ(m, m, -0.08);
  R.dynamic.push({ mesh: heliMeshes.body, model: m, tint: [0.92, 0.93, 0.95], params: [1, 0, 1 + (Math.floor(G.time * 4) % 2), 0] });
  const r = mat4.create(); mat4.translate(r, m, 0, 2.95, 0); mat4.rotateY(r, r, h.rotor);
  R.dynamic.push({ mesh: heliMeshes.rotor, model: r, tint: [1, 1, 1], params: [0, 0, 0, 0], shadow: true });
  const t = mat4.create(); mat4.translate(t, m, -7.3, 2.6, 0.12); mat4.rotateZ(t, t, h.rotor * 1.6); mat4.scale(t, t, 0.2, 0.2, 0.2);
  R.dynamic.push({ mesh: heliMeshes.rotor, model: t, tint: [1, 1, 1], params: [0, 0, 0, 0] });
}
