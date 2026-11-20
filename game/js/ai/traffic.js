// Traffic + crowd management: lane-following cars on the road graph (left-hand traffic),
// smooth bezier turns through intersections, braking for obstacles, honking, backing out
// when stuck, and a spawn/despawn ring of cars and pedestrians around the player.
import { G } from '../state.js';
import { RNG, clamp, angleDiff } from '../util.js';
import { CELL, ROAD, LANE } from '../world/city.js';
import { nodeXY, neighbors, laneOffset, laneSpawnPoint, edgeAt, nearestNode } from '../world/roads.js';
import { Vehicle, TRAFFIC_MODELS } from '../entities/vehicle.js';
import { Ped } from '../entities/pedestrian.js';
import { viewRect } from '../camera.js';
import { sfx } from '../audio/audio.js';

const rng = new RNG(99);
export const TARGET_CARS = 30, TARGET_PEDS = 45;

// ---------- lane following ----------
function edgeDir(from, to) { const A = nodeXY(from), B = nodeXY(to); return { A, B, dx: Math.sign(B.x - A.x), dy: Math.sign(B.y - A.y) }; }

/** Append the waypoints for driving to the end of edge (from->to) and turning onto (to->next). */
function planTurn(ai) {
  const { B, dx, dy } = edgeDir(ai.from, ai.to);
  const nb = neighbors(ai.to).filter((n) => n !== ai.from);
  const next = nb.length ? rng.pick(nb) : ai.from;
  const e2 = edgeDir(ai.to, next);
  const o1 = laneOffset(dx, dy), o2 = laneOffset(e2.dx, e2.dy);
  const half = ROAD / 2 + 4;
  const entry = { x: B.x - dx * half + o1.x, y: B.y - dy * half + o1.y };
  const exit = { x: B.x + e2.dx * half + o2.x, y: B.y + e2.dy * half + o2.y };
  const straight = dx === e2.dx && dy === e2.dy;
  const ctrl = straight ? { x: (entry.x + exit.x) / 2, y: (entry.y + exit.y) / 2 } : { x: B.x + o1.x + o2.x, y: B.y + o1.y + o2.y };
  const turning = !straight;
  ai.wps.push({ x: entry.x, y: entry.y, slow: turning });
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    const x = (1 - t) * (1 - t) * entry.x + 2 * (1 - t) * t * ctrl.x + t * t * exit.x;
    const y = (1 - t) * (1 - t) * entry.y + 2 * (1 - t) * t * ctrl.y + t * t * exit.y;
    ai.wps.push({ x, y, slow: turning });
  }
  ai.wps.push({ x: exit.x, y: exit.y, advance: { from: ai.to, to: next } });
  ai.from = ai.to; ai.to = next;
}

export function setupTrafficAI(v, from, to) {
  v.ai = { mode: 'traffic', from, to, wps: [], blocked: 0, reverse: 0, cruise: rng.range(120, 160) };
  planTurn(v.ai);
}

/** Generic steering toward a waypoint list. Returns desired speed handling. */
export function steerToward(v, tx, ty, desired) {
  const want = Math.atan2(ty - v.y, tx - v.x);
  const diff = angleDiff(v.angle, want);
  v.ctl.steer = clamp(diff * 2.6, -1, 1);
  const sp = v.forwardSpeed;
  if (sp < desired - 8) { v.ctl.throttle = clamp((desired - sp) / 60, 0.25, 1); v.ctl.brake = 0; }
  else if (sp > desired + 18) { v.ctl.throttle = 0; v.ctl.brake = clamp((sp - desired) / 120, 0.2, 1); }
  else { v.ctl.throttle = 0.15; v.ctl.brake = 0; }
  v.ctl.handbrake = false;
  return diff;
}

/** Distance to the nearest obstacle in a corridor ahead of the car (cars, peds, player). */
export function obstacleAhead(v, range = 90, halfWidth = 13) {
  const fx = Math.cos(v.angle), fy = Math.sin(v.angle);
  let best = Infinity;
  const test = (x, y, r) => {
    const dx = x - v.x, dy = y - v.y;
    const f = dx * fx + dy * fy;
    if (f < v.len / 2 - 4 || f > range + v.len / 2) return;
    const s = Math.abs(dx * -fy + dy * fx);
    if (s < halfWidth + r) best = Math.min(best, f - v.len / 2);
  };
  for (const o of G.vehicles) if (o !== v && Math.abs(o.x - v.x) < range + 60 && Math.abs(o.y - v.y) < range + 60) test(o.x, o.y, o.wid / 2);
  for (const p of G.peds) if (!p.vehicle && !p.dead && Math.abs(p.x - v.x) < range + 20 && Math.abs(p.y - v.y) < range + 20) test(p.x, p.y, 6);
  const pl = G.player;
  if (pl && pl.alive && !pl.vehicle) test(pl.x, pl.y, 7);
  return best;
}

export function updateTrafficCar(v, dt) {
  const ai = v.ai;
  if (!v.driver || v.wrecked) { v.ctl = { throttle: 0, brake: 1, steer: 0, handbrake: false }; return; }
  if (ai.reverse > 0) {
    ai.reverse -= dt;
    v.ctl.throttle = 0; v.ctl.brake = 1; v.ctl.steer = ai.revSteer;
    return;
  }
  while (ai.wps.length < 6) planTurn(ai);
  // drop reached waypoints
  for (let k = 0; k < 3; k++) {
    const w = ai.wps[0];
    const d = Math.hypot(w.x - v.x, w.y - v.y);
    const fx = Math.cos(v.angle), fy = Math.sin(v.angle);
    const behind = (w.x - v.x) * fx + (w.y - v.y) * fy < 0 && d < 50;
    if (d < 16 || behind) { ai.wps.shift(); if (ai.wps.length < 6) planTurn(ai); } else break;
  }
  // look-ahead target
  let target = ai.wps[0];
  if (Math.hypot(target.x - v.x, target.y - v.y) < 30 && ai.wps[1]) target = ai.wps[1];
  let desired = target.slow ? 62 : ai.cruise;
  const obs = obstacleAhead(v, 80, 12);
  if (obs < 80) desired = Math.min(desired, Math.max(0, (obs - 14) * 2.2));
  steerToward(v, target.x, target.y, desired);
  if (obs < 16) { v.ctl.throttle = 0; v.ctl.brake = 1; }
  if (v.speed < 8 && desired < 20) {
    ai.blocked += dt;
    if (ai.blocked > 1.6 && v.horn <= 0 && rng.chance(dt * 2)) { v.horn = 0.5; sfx('horn', { x: v.x, y: v.y, vol: 0.5 }); }
    if (ai.blocked > 5) { ai.reverse = 1.0; ai.revSteer = rng.sign(); ai.blocked = 0; }
  } else ai.blocked = Math.max(0, ai.blocked - dt * 2);
}

// ---------- spawning ----------
function spawnRect() {
  const v = viewRect(60);
  return { x0: v.x0, y0: v.y0, x1: v.x1, y1: v.y1 };
}

export function spawnTrafficCar(rect, forcePolice = false, cx = G.cam.x, cy = G.cam.y) {
  const hw = (rect.x1 - rect.x0) / 2, hh = (rect.y1 - rect.y0) / 2;
  const rMin = Math.hypot(hw, hh) * 0.8 + 40, rMax = rMin + 500;
  const sp = laneSpawnPoint(rng, cx, cy, rMin, rMax, rect);
  if (!sp) return null;
  for (const o of G.vehicles) if (Math.abs(o.x - sp.x) < 70 && Math.abs(o.y - sp.y) < 70) return null;
  const police = forcePolice || rng.chance(0.06);
  const model = police ? 'patrol' : rng.pick(TRAFFIC_MODELS);
  const v = new Vehicle(model, sp.x, sp.y, sp.angle);
  const d = new Ped(police ? 'cop' : 'civ', sp.x, sp.y, police ? 'cop' : null);
  if (police) { d.weapon = 'kobra'; d.hp = d.maxHp = 70; }
  d.vehicle = v; v.driver = d;
  v.role = police ? 'police' : 'traffic';
  const sp0 = rng.range(80, 130);
  v.vx = Math.cos(sp.angle) * sp0; v.vy = Math.sin(sp.angle) * sp0;
  setupTrafficAI(v, sp.from, sp.to);
  G.vehicles.push(v);
  return v;
}

function spawnPed(rect) {
  // on a sidewalk ring of a block near (but outside) the view
  const cx = G.cam.x, cy = G.cam.y;
  for (let tries = 0; tries < 12; tries++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(Math.hypot(rect.x1 - rect.x0, rect.y1 - rect.y0) * 0.42, Math.hypot(rect.x1 - rect.x0, rect.y1 - rect.y0) * 0.42 + 400);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (x > rect.x0 && x < rect.x1 && y > rect.y0 && y < rect.y1) continue;
    const bx = Math.floor(x / CELL), by = Math.floor(y / CELL);
    if (bx < 0 || by < 0 || bx > 11 || by > 11) continue;
    const p = new Ped('civ', x, y);
    p.joinRing();
    const c = p.ring.pts[p.corner], n = p.ring.pts[(p.corner + 1) % 4];
    const t = rng.next();
    p.x = c[0] + (n[0] - c[0]) * t; p.y = c[1] + (n[1] - c[1]) * t;
    if (p.x > rect.x0 && p.x < rect.x1 && p.y > rect.y0 && p.y < rect.y1) continue;
    G.peds.push(p);
    return p;
  }
  return null;
}

/** Keep ~30 cars and ~45 pedestrians alive around the camera; cull far ones. */
export function manageCrowd(dt, initial = false) {
  const rect = spawnRect();
  const farR = Math.hypot(rect.x1 - rect.x0, rect.y1 - rect.y0) * 0.5 + 900;
  const cx = G.cam.x, cy = G.cam.y;
  // despawn
  for (let i = G.vehicles.length - 1; i >= 0; i--) {
    const v = G.vehicles[i];
    if (v.driver && v.driver.isPlayer) continue;
    if (v.mission || v.keep) continue;
    const d = Math.hypot(v.x - cx, v.y - cy);
    const out = v.x < rect.x0 - 80 || v.x > rect.x1 + 80 || v.y < rect.y0 - 80 || v.y > rect.y1 + 80;
    if (d > farR || (out && v.wrecked && v.wreckTime > 20) || (out && d > farR * 0.7 && v.role === 'parked' && !v.everDriven && !v.home)) {
      G.vehicles.splice(i, 1);
      if (v.driver && G.peds.includes(v.driver)) G.peds.splice(G.peds.indexOf(v.driver), 1);
    }
  }
  for (let i = G.peds.length - 1; i >= 0; i--) {
    const p = G.peds[i];
    if (p.mission) continue;
    const d = Math.hypot(p.x - cx, p.y - cy);
    const out = p.x < rect.x0 - 40 || p.x > rect.x1 + 40 || p.y < rect.y0 - 40 || p.y > rect.y1 + 40;
    if ((p.vehicle && !G.vehicles.includes(p.vehicle)) || d > farR || (p.dead && out && p.deadTime > 6)) G.peds.splice(i, 1);
  }
  // spawn
  const traffic = G.vehicles.filter((v) => v.role === 'traffic' || v.role === 'police').length;
  const civs = G.peds.filter((p) => !p.vehicle && p.kind === 'civ' && !p.dead).length;
  const budget = initial ? 60 : 2;
  for (let k = 0, n = 0; k < budget && traffic + n < TARGET_CARS; k++) { if (spawnTrafficCar(initial ? { x0: cx, y0: cy, x1: cx, y1: cy } : rect)) n++; }
  for (let k = 0, n = 0; k < budget && civs + n < TARGET_PEDS; k++) { if (spawnPed(initial ? { x0: cx - 300, y0: cy - 200, x1: cx + 300, y1: cy + 200 } : rect)) n++; }
}

export { nearestNode, edgeAt };
