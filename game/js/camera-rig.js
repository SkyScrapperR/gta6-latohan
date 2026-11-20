// Camera rig: third-person over-the-shoulder on foot (with aim zoom and wall collision),
// lagging chase camera in vehicles (FOV widens with speed, recentres after 1.5 s),
// scripted cinematic shots for cutscenes/title, and screen shake.
import { G } from './core/state.js';
import { input } from './core/input.js';
import { clamp, lerp, angleDiff } from './core/math.js';
import { raycastWorld } from './world/collision.js';
import { groundHeight } from './world/city.js';

export const rig = {
  yaw: 0, pitch: 0.28, dist: 4.2, fov: 62,
  pos: [0, 5, 0], target: [0, 0, 0],
  shake: 0, lastLook: -10, mode: 'foot', cine: null, cinematic: false,
};

export function addShake(a) { rig.shake = Math.min(1.2, rig.shake + a); }

/** Mouse look (pointer lock deltas) — shared by foot and vehicle modes. */
function look(dt) {
  const s = 0.0026 * G.settings.sensitivity;
  const dx = input.mouse.dx, dy = input.mouse.dy;
  if (dx || dy) rig.lastLook = G.realTime;
  rig.yaw += dx * s;
  rig.pitch = clamp(rig.pitch + dy * s * (G.settings.invertY ? -1 : 1), -0.35, 1.2);
}

/** Pull the camera in front of walls between the focus and the desired position. */
function collide(fx, fy, fz, px, py, pz) {
  const hit = raycastWorld(fx, fz, px, pz, Math.max(py, fy));
  let t = 1;
  if (hit) t = Math.max(0.08, hit.t - 0.06);
  const x = fx + (px - fx) * t, z = fz + (pz - fz) * t;
  let y = fy + (py - fy) * t;
  y = Math.max(y, groundHeight(x, z) + 0.4);
  return [x, y, z];
}

export function updateCamera(dt) {
  const p = G.player;
  if (rig.cine) { cinematic(dt); return; }
  if (!p) return;
  look(dt);
  const v = p.vehicle;
  let focus, dist, fov, height;
  if (v) {
    const sp = v.speed;
    // recentre behind the car when the mouse is idle
    const heading = v.angle + (v.forwardSpeed < -2 ? Math.PI : 0);
    if (G.realTime - rig.lastLook > 1.5) { rig.yaw += angleDiff(rig.yaw, heading) * Math.min(1, dt * 2.4); rig.pitch = lerp(rig.pitch, 0.22, dt * 2); }
    dist = (v.model === 'bison' ? 11 : 7.4) + sp * 0.05;
    height = 1.5;
    fov = clamp(62 + sp * 0.45, 62, 88);
    focus = [v.x, v.y + height, v.z];
  } else {
    const aim = p.aiming ? 1 : 0;
    rig.aimK = lerp(rig.aimK || 0, aim, Math.min(1, dt * 10));
    dist = lerp(4.3, 2.0, rig.aimK);
    fov = lerp(62, 48, rig.aimK);
    const side = lerp(0.55, 0.75, rig.aimK);
    const rx = -Math.sin(rig.yaw), rz = Math.cos(rig.yaw);
    focus = [p.x + rx * side, p.y + 1.55 + (p.crouch || 0), p.z + rz * side];
  }
  const cp = Math.cos(rig.pitch), sp_ = Math.sin(rig.pitch);
  const want = [focus[0] - Math.cos(rig.yaw) * cp * dist, focus[1] + sp_ * dist, focus[2] - Math.sin(rig.yaw) * cp * dist];
  const pos = collide(focus[0], focus[1], focus[2], want[0], want[1], want[2]);
  const k = v ? 1 - Math.exp(-dt * 10) : 1;
  rig.pos = rig.pos.map((c, i) => lerp(c, pos[i], k));
  rig.target = [focus[0] + Math.cos(rig.yaw) * 10 * cp, focus[1] - sp_ * 4, focus[2] + Math.sin(rig.yaw) * 10 * cp];
  rig.fov = lerp(rig.fov, fov, Math.min(1, dt * 4));
  applyShake(dt);
}

function applyShake(dt) {
  rig.shake = Math.max(0, rig.shake - dt * 1.8);
  const s = rig.shake * rig.shake * 0.35;
  if (s > 0) for (const a of [rig.pos, rig.target]) { a[0] += (Math.random() - 0.5) * s; a[1] += (Math.random() - 0.5) * s; a[2] += (Math.random() - 0.5) * s; }
}

/** Scripted shot: { from, to, lookFrom, lookTo, dur, t, fov } — dolly between two positions. */
export function playShot(shot) { rig.cine = { t: 0, fov: 50, ...shot }; }
export function stopShot() { rig.cine = null; }
function cinematic(dt) {
  const c = rig.cine;
  c.t += dt;
  const k = c.dur ? clamp(c.t / c.dur, 0, 1) : 0;
  const e = k * k * (3 - 2 * k);
  const L = (a, b) => [lerp(a[0], b[0], e), lerp(a[1], b[1], e), lerp(a[2], b[2], e)];
  if (c.orbit) {
    const o = c.orbit, a = o.a0 + (o.a1 - o.a0) * e;
    rig.pos = [o.cx + Math.cos(a) * o.r, o.y, o.cz + Math.sin(a) * o.r];
    rig.target = [o.cx, o.ty, o.cz];
  } else {
    rig.pos = L(c.from, c.to || c.from);
    rig.target = L(c.lookFrom, c.lookTo || c.lookFrom);
  }
  rig.fov = c.fov;
  applyShake(dt);
}

/** Camera-forward on the ground plane (for movement and aiming). */
export function camForward() { return [Math.cos(rig.yaw), Math.sin(rig.yaw)]; }
