// Traffic + crowd: lane following on the road graph (left-hand traffic) with bezier turns,
// traffic-light obedience at stop lines, braking for anything ahead, honking, backing out,
// a junction deadlock breaker, and a spawn/despawn ring outside the camera view that
// adapts the car/pedestrian counts to the frame rate.
import { G } from '../core/state.js';
import { RNG, clamp, angleDiff } from '../core/math.js';
import { CELL, ROAD } from '../world/city.js';
import { nodeXZ, neighbors, laneOffset, laneSpawnPoint, signalState, nearestNode } from '../world/roads.js';
import { Vehicle, TRAFFIC_MODELS } from '../entities/vehicle.js';
import { Ped } from '../entities/pedestrian.js';
import { sphereVisible } from '../engine/frustum.js';
import { sfx } from '../audio/audio.js';

const rng = new RNG(99);
export const counts = { cars: 30, peds: 50 };

function edgeDir(from, to) { const A = nodeXZ(from), B = nodeXZ(to); return { A, B, dx: Math.sign(B.x - A.x), dz: Math.sign(B.z - A.z) }; }

/** Waypoints to the stop line of (from->to), through the junction, onto (to->next). */
function planTurn(ai) {
  const { B, dx, dz } = edgeDir(ai.from, ai.to);
  const nb = neighbors(ai.to).filter((n) => n !== ai.from);
  const next = nb.length ? rng.pick(nb) : ai.from;
  const e2 = edgeDir(ai.to, next);
  const o1 = laneOffset(dx, dz), o2 = laneOffset(e2.dx, e2.dz);
  const half = ROAD / 2 + 4.6;
  const entry = { x: B.x - dx * half + o1.x, z: B.z - dz * half + o1.z };
  const exit = { x: B.x + e2.dx * half + o2.x, z: B.z + e2.dz * half + o2.z };
  const straight = dx === e2.dx && dz === e2.dz;
  const ctrl = straight ? { x: (entry.x + exit.x) / 2, z: (entry.z + exit.z) / 2 } : { x: B.x + o1.x + o2.x, z: B.z + o1.z + o2.z };
  ai.wps.push({ x: entry.x, z: entry.z, slow: !straight, stop: { node: ai.to, axis: dx !== 0 ? 'ew' : 'ns' } });
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    ai.wps.push({ x: (1 - t) ** 2 * entry.x + 2 * (1 - t) * t * ctrl.x + t * t * exit.x, z: (1 - t) ** 2 * entry.z + 2 * (1 - t) * t * ctrl.z + t * t * exit.z, slow: !straight, junction: true });
  }
  ai.wps.push({ x: exit.x, z: exit.z });
  ai.from = ai.to; ai.to = next;
}

export function setupTrafficAI(v, from, to) {
  v.ai = { mode: 'traffic', from, to, wps: [], blocked: 0, reverse: 0, cruise: rng.range(11, 14), ghost: 0 };
  planTurn(v.ai);
}

export function steerToward(v, tx, tz, desired) {
  const want = Math.atan2(tz - v.z, tx - v.x);
  const diff = angleDiff(v.angle, want);
  v.ctl.steer = clamp(diff * 2.4, -1, 1);
  const sp = v.forwardSpeed;
  if (sp < desired - 0.5) { v.ctl.throttle = clamp((desired - sp) / 4, 0.25, 1); v.ctl.brake = 0; }
  else if (sp > desired + 1.2) { v.ctl.throttle = 0; v.ctl.brake = clamp((sp - desired) / 8, 0.2, 1); }
  else { v.ctl.throttle = 0.15; v.ctl.brake = 0; }
  v.ctl.handbrake = false;
  return diff;
}

/** Distance to the nearest obstacle in a corridor ahead (cars, people, the player). */
export function obstacleAhead(v, range = 16, half = 1.3) {
  const fx = Math.cos(v.angle), fz = Math.sin(v.angle);
  let best = Infinity;
  const test = (x, z, r) => {
    const dx = x - v.x, dz = z - v.z, f = dx * fx + dz * fz;
    if (f < v.len / 2 - 0.5 || f > range + v.len / 2) return;
    if (Math.abs(-dx * fz + dz * fx) < half + r) best = Math.min(best, f - v.len / 2);
  };
  for (const o of G.vehicles) if (o !== v && Math.abs(o.x - v.x) < range + 8 && Math.abs(o.z - v.z) < range + 8) test(o.x, o.z, o.wid / 2);
  for (const p of G.peds) if (!p.vehicle && !p.dead && Math.abs(p.x - v.x) < range + 3 && Math.abs(p.z - v.z) < range + 3) test(p.x, p.z, 0.4);
  const pl = G.player;
  if (pl && pl.alive && !pl.vehicle) test(pl.x, pl.z, 0.4);
  return best;
}

export function updateTrafficCar(v, dt) {
  const ai = v.ai;
  if (!v.driver || v.wrecked) { v.ctl = { throttle: 0, brake: 1, steer: 0, handbrake: false }; return; }
  if (ai.reverse > 0) { ai.reverse -= dt; v.ctl = { throttle: 0, brake: 1, steer: ai.revSteer, handbrake: false }; return; }
  while (ai.wps.length < 7) planTurn(ai);
  const fx = Math.cos(v.angle), fz = Math.sin(v.angle);
  for (let k = 0; k < 3; k++) {
    const w = ai.wps[0], d = Math.hypot(w.x - v.x, w.z - v.z);
    const behind = (w.x - v.x) * fx + (w.z - v.z) * fz < 0 && d < 9;
    if (d < 3 || behind) { ai.wps.shift(); if (ai.wps.length < 7) planTurn(ai); } else break;
  }
  let target = ai.wps[0];
  if (Math.hypot(target.x - v.x, target.z - v.z) < 6 && ai.wps[1]) target = ai.wps[1];
  let desired = target.slow ? 6 : ai.cruise;
  // traffic light at the next stop line
  const stopW = ai.wps.find((w) => w.stop);
  if (stopW && stopW === ai.wps[0]) {
    const d = Math.hypot(stopW.x - v.x, stopW.z - v.z);
    const st = signalState(stopW.stop.node, stopW.stop.axis, G.time);
    if ((st === 'r' || (st === 'y' && d > 9)) && d < 30) desired = Math.min(desired, Math.max(0, (d - 2.2) * 0.9));
  }
  ai.ghost -= dt;
  const obs = ai.ghost > 0 ? Infinity : obstacleAhead(v, 16, 1.2);
  if (obs < 16) desired = Math.min(desired, Math.max(0, (obs - 2.5) * 1.1));
  steerToward(v, target.x, target.z, desired);
  if (obs < 2.5) { v.ctl.throttle = 0; v.ctl.brake = 1; }
  if (v.speed < 0.8 && desired < 1.5) {
    ai.blocked += dt;
    if (ai.blocked > 2 && v.horn <= 0 && rng.chance(dt * 1.5)) { v.horn = 0.5; sfx('horn', { x: v.x, y: 1, z: v.z, vol: 0.5 }); }
    // deadlock breaker: stuck behind something in a junction -> creep through
    if (ai.blocked > 5 && ai.wps[0].junction) { ai.ghost = 2.5; ai.blocked = 0; }
    else if (ai.blocked > 7) { ai.reverse = 1.2; ai.revSteer = rng.sign(); ai.blocked = 0; }
  } else ai.blocked = Math.max(0, ai.blocked - dt * 2);
}

// ---------- spawning ----------
function visibleNear(x, z) {
  const R = G.renderer;
  const d = Math.hypot(x - R.camera.pos[0], z - R.camera.pos[2]);
  if (d < 45) return true;
  return d < 170 && R.planes && sphereVisible(R.planes, x, 1, z, 4);
}

export function spawnTrafficCar(force = false, cx, cz, police = null) {
  const c = G.renderer.camera.pos;
  cx = cx ?? c[0]; cz = cz ?? c[2];
  const sp = laneSpawnPoint(rng, cx, cz, force ? 25 : 90, force ? 170 : 230, force ? (x, z) => Math.hypot(x - cx, z - cz) < 12 : (x, z) => visibleNear(x, z));
  if (!sp) return null;
  for (const o of G.vehicles) if (Math.abs(o.x - sp.x) < 10 && Math.abs(o.z - sp.z) < 10) return null;
  const isPolice = police ?? rng.chance(0.06);
  const v = new Vehicle(isPolice ? 'patrol' : rng.pick(TRAFFIC_MODELS), sp.x, sp.z, sp.angle);
  const d = new Ped(isPolice ? 'cop' : 'civ', sp.x, sp.z, isPolice ? 'cop' : null);
  if (isPolice) { d.weapon = 'kobra'; d.hp = d.maxHp = 70; }
  d.vehicle = v; v.driver = d;
  v.role = isPolice ? 'police' : 'traffic';
  const s0 = rng.range(6, 11); v.vx = Math.cos(sp.angle) * s0; v.vz = Math.sin(sp.angle) * s0;
  setupTrafficAI(v, sp.from, sp.to);
  G.vehicles.push(v);
  return v;
}

function spawnPed(initial) {
  const c = G.renderer.camera.pos;
  for (let tries = 0; tries < 10; tries++) {
    const a = rng.range(0, Math.PI * 2), r = initial ? rng.range(8, 110) : rng.range(70, 150);
    const x = c[0] + Math.cos(a) * r, z = c[2] + Math.sin(a) * r;
    if (x < 0 || z < 0 || x > 10 * CELL || z > 10 * CELL) continue;
    const p = new Ped('civ', x, z);
    p.joinRing();
    const p0 = p.ring.pts[p.corner], p1 = p.ring.pts[(p.corner + 1) % 4], t = rng.next();
    p.x = p0[0] + (p1[0] - p0[0]) * t; p.z = p0[1] + (p1[1] - p0[1]) * t;
    if (!initial && visibleNear(p.x, p.z)) continue;
    p.y = 0.15;
    G.peds.push(p);
    return p;
  }
  return null;
}

/** Keep the city populated around the camera; counts follow the frame-rate budget. */
export function manageCrowd(dt, initial = false) {
  const c = G.renderer.camera.pos;
  const farR = 320;
  for (let i = G.vehicles.length - 1; i >= 0; i--) {
    const v = G.vehicles[i];
    if ((v.driver && v.driver.isPlayer) || v.mission || v.keep) continue;
    const d = Math.hypot(v.x - c[0], v.z - c[2]);
    if (d > farR || (v.wrecked && v.wreckTime > 25 && !visibleNear(v.x, v.z)) || (v.role === 'parked' && !v.home && !v.everDriven && d > 200)) {
      G.vehicles.splice(i, 1);
      if (v.driver) { const k = G.peds.indexOf(v.driver); if (k >= 0) G.peds.splice(k, 1); }
    }
  }
  for (let i = G.peds.length - 1; i >= 0; i--) {
    const p = G.peds[i];
    if (p.mission) continue;
    const d = Math.hypot(p.x - c[0], p.z - c[2]);
    if ((p.vehicle && !G.vehicles.includes(p.vehicle)) || d > farR || (p.dead && p.deadT >= 1 && d > 60 && !visibleNear(p.x, p.z))) G.peds.splice(i, 1);
  }
  const k = G.perfScale ?? 1;
  const carsWanted = Math.round(counts.cars * k), pedsWanted = Math.round(counts.peds * k);
  const traffic = G.vehicles.filter((v) => v.role === 'traffic' || (v.role === 'police' && v.ai && v.ai.mode === 'traffic')).length;
  const civs = G.peds.filter((p) => p.kind === 'civ' && !p.vehicle && !p.dead).length;
  const budget = initial ? 80 : 2;
  for (let i = 0, n = 0; i < budget && traffic + n < carsWanted; i++) if (spawnTrafficCar(initial)) n++;
  for (let i = 0, n = 0; i < budget && civs + n < pedsWanted; i++) if (spawnPed(initial)) n++;
}
export { nearestNode };
