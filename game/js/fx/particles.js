// CPU-simulated, GPU-drawn particles: smoke, fire, sparks, debris, shell casings, flashes,
// rain streaks and splashes; tracers; ground decals (skid marks, scorch, marks, bullet holes).
// Everything is packed into the renderer's billboard buffer each frame (alpha first, additive last).
import { G } from '../core/state.js';
import { clamp } from '../core/math.js';
import { addTransientLight } from './lights.js';

const parts = [], tracers = [], skids = [], decals = [];
const MAX = 2600;
const KIND = { BILLBOARD: 0, STREAK: 1, GLOW: 2, FLAT: 3, SCORCH: 4 };

function spawn(p) { if (parts.length < MAX) parts.push(p); }

export function smoke(x, y, z, { size = 0.8, life = 2, shade = 0.5, vx = 0, vy = 1.2, vz = 0, grow = 1.4 } = {}) {
  spawn({ t: 'smoke', x, y, z, vx: vx + (Math.random() - 0.5) * 0.8, vy, vz: vz + (Math.random() - 0.5) * 0.8, life, max: life, size, grow, shade });
}
export function fire(x, y, z, size = 0.7) {
  spawn({ t: 'fire', x: x + (Math.random() - 0.5) * 0.6, y, z: z + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 0.6, vy: 1.6 + Math.random(), vz: (Math.random() - 0.5) * 0.6, life: 0.6, max: 0.6, size, grow: -0.6 });
}
export function sparks(x, y, z, n = 8, speed = 7, color = [3, 2, 0.8]) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 - 0.2, s = speed * (0.4 + Math.random() * 0.8);
    spawn({ t: 'spark', x, y, z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s + 1, vz: Math.sin(a) * Math.cos(e) * s, life: 0.3 + Math.random() * 0.3, max: 0.6, size: 0.04, color, grav: 9 });
  }
}
export function debris(x, y, z, n, color = [0.15, 0.15, 0.16]) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 10;
    spawn({ t: 'debris', x, y, z, vx: Math.cos(a) * s, vy: 4 + Math.random() * 8, vz: Math.sin(a) * s, life: 1.4 + Math.random(), max: 2.4, size: 0.12 + Math.random() * 0.18, color, grav: 14 });
  }
}
export function casing(x, y, z, angle) {
  const a = angle + Math.PI / 2 + (Math.random() - 0.5) * 0.5;
  spawn({ t: 'debris', x, y, z, vx: Math.cos(a) * 2.4, vy: 2.2, vz: Math.sin(a) * 2.4, life: 0.9, max: 0.9, size: 0.035, color: [0.9, 0.7, 0.25], grav: 12 });
}
export function muzzleFlash(x, y, z, angle) {
  spawn({ t: 'flash', x, y, z, life: 0.05, max: 0.05, size: 0.35, color: [6, 4.4, 2] });
  addTransientLight(x, y, z, 9, [1, 0.75, 0.4], 3.5, 0.06);
}
export function cashBurst(x, y, z) { sparks(x, y, z, 10, 3, [0.4, 2.5, 0.6]); }
export function splash(x, z, y = 0.05) { spawn({ t: 'splash', x, y, z, vx: 0, vy: 1.6, vz: 0, life: 0.25, max: 0.25, size: 0.05, color: [0.6, 0.7, 0.8], grav: 10 }); }

/** Visual part of an explosion (damage lives in combat/weapons.js). */
export function explosionFx(x, y, z, power = 1) {
  spawn({ t: 'flash', x, y: y + 1, z, life: 0.4, max: 0.4, size: 7 * power, color: [9, 6, 3] });
  for (let i = 0; i < 34 * power; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.random() * 1.3, s = Math.random() * 9 * power;
    spawn({ t: 'fire', x, y: y + 0.6, z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s + 2, vz: Math.sin(a) * Math.cos(e) * s, life: 0.7 + Math.random() * 0.6, max: 1.3, size: 1.2 + Math.random() * 1.4, grow: 1.2, drag: 2.5 });
  }
  for (let i = 0; i < 24 * power; i++) smoke(x + (Math.random() - 0.5) * 3, y + 1 + Math.random() * 2, z + (Math.random() - 0.5) * 3, { size: 1.6, life: 3.5 + Math.random() * 2, shade: 0.12, vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 4, grow: 1.6 });
  sparks(x, y + 1, z, 40, 16);
  debris(x, y + 1, z, 16);
  decal('scorch', x, z, 3.2 * power);
  addTransientLight(x, y + 2, z, 40 * power, [1, 0.6, 0.25], 7, 0.7);
}

export function skid(x0, z0, x1, z1, a = 0.55) {
  if ((x1 - x0) ** 2 + (z1 - z0) ** 2 > 4) return;
  skids.push({ x0, z0, x1, z1, a, t: G.time });
  if (skids.length > 900) skids.splice(0, skids.length - 900);
}
export function decal(type, x, z, r, y = null) { decals.push({ type, x, z, r, y, t: G.time }); if (decals.length > 200) decals.shift(); }
export function tracer(x0, y0, z0, x1, y1, z1, color = [4, 3.2, 1.6]) { tracers.push({ x0, y0, z0, x1, y1, z1, life: 0.07, color }); }
export function clearFx() { parts.length = 0; tracers.length = 0; skids.length = 0; decals.length = 0; }

export function updateParticles(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
    if (p.grav) p.vy -= p.grav * dt;
    p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; p.z += (p.vz || 0) * dt;
    if (p.t === 'smoke') { p.size += p.grow * dt; p.vx *= 1 - dt * 0.6; p.vz *= 1 - dt * 0.6; p.vx += 0.3 * dt; }
    else if (p.t === 'fire') { const k = 1 - dt * (p.drag || 1.2); p.vx *= k; p.vz *= k; p.vy *= k; p.size = Math.max(0.1, p.size + p.grow * dt); if (Math.random() < 0.06) smoke(p.x, p.y, p.z, { size: 0.8, life: 1.6, shade: 0.25 }); }
    if ((p.t === 'debris' || p.t === 'spark') && p.y < 0.05) { p.y = 0.05; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
    if (p.t === 'fire' && Math.random() < 0.15) addTransientLight(p.x, p.y, p.z, 10, [1, 0.5, 0.2], 1.5, 0.05);
  }
  for (let i = tracers.length - 1; i >= 0; i--) { tracers[i].life -= dt; if (tracers[i].life <= 0) tracers.splice(i, 1); }
}

/** Pack everything into the renderer's particle buffer. */
export function packParticles(R) {
  const d = R.particleData, cam = R.camera.pos, amb = R.env.skyCol || [0.4, 0.4, 0.4], night = R.env.night || 0;
  let n = 0;
  const cap = d.length / 12;
  const put = (x, y, z, size, r, g, b, a, sx, sy, sz, kind) => {
    if (n >= cap) return;
    const o = n * 12;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = size; d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = a; d[o + 8] = sx; d[o + 9] = sy; d[o + 10] = sz; d[o + 11] = kind; n++;
  };
  const near = (x, z, r = 260) => Math.abs(x - cam[0]) < r && Math.abs(z - cam[2]) < r;
  // --- alpha blended: decals, skids, smoke, debris
  const now = G.time;
  for (const s of skids) {
    if (!near(s.x0, s.z0, 180)) continue;
    const a = s.a * clamp(1 - (now - s.t) / 45, 0, 1);
    if (a > 0.02) put((s.x0 + s.x1) / 2, 0.025, (s.z0 + s.z1) / 2, 0.13, 0.02, 0.02, 0.02, a, s.x1 - s.x0, 0, s.z1 - s.z0, KIND.FLAT);
  }
  for (const dc of decals) {
    if (!near(dc.x, dc.z, 200)) continue;
    const a = clamp(1 - (now - dc.t) / 120, 0, 1);
    if (dc.type === 'scorch') put(dc.x, 0.03, dc.z, dc.r, 0.02, 0.015, 0.01, 0.85 * a, 0, 0, 0, KIND.SCORCH);
    else if (dc.type === 'mark') put(dc.x, 0.2, dc.z, dc.r, 0.25, 0.03, 0.04, 0.6 * a, 0, 0, 0, KIND.FLAT);
    else if (dc.type === 'hole') put(dc.x, dc.y ?? 1.4, dc.z, 0.07, 0.03, 0.03, 0.03, 0.85 * a, 0, 0, 0, KIND.BILLBOARD);
  }
  const lightK = 0.35 + 0.65 * (1 - night);
  for (const p of parts) {
    if (!near(p.x, p.z)) continue;
    const k = p.life / p.max;
    if (p.t === 'smoke') { const c = (0.12 + p.shade * 0.6) * lightK; put(p.x, p.y, p.z, p.size, c * (amb[0] * 1.5 + 0.4), c * (amb[1] * 1.5 + 0.4), c * (amb[2] * 1.5 + 0.45), 0.55 * k * Math.min(1, (1 - k) * 6), 0, 0, 0, KIND.BILLBOARD); }
    else if (p.t === 'debris') put(p.x, p.y, p.z, p.size, p.color[0] * lightK, p.color[1] * lightK, p.color[2] * lightK, 1, 0, 0, 0, KIND.BILLBOARD);
    else if (p.t === 'splash') put(p.x, p.y, p.z, p.size, 0.6, 0.7, 0.8, 0.5 * k, 0, 0.15, 0, KIND.STREAK);
  }
  const alphaCount = n;
  // --- additive: fire, sparks, flashes, tracers, glows
  for (const p of parts) {
    if (!near(p.x, p.z)) continue;
    const k = p.life / p.max;
    if (p.t === 'fire') put(p.x, p.y, p.z, p.size, 4 * k + 1, 1.6 * k + 0.2, 0.3 * k, 0.8 * k, 0, 0, 0, KIND.GLOW);
    else if (p.t === 'spark') put(p.x, p.y, p.z, p.size, p.color[0], p.color[1], p.color[2], k, p.vx * 0.04, p.vy * 0.04, p.vz * 0.04, KIND.STREAK);
    else if (p.t === 'flash') put(p.x, p.y, p.z, p.size * (1.3 - k * 0.3), p.color[0], p.color[1], p.color[2], k, 0, 0, 0, KIND.GLOW);
  }
  for (const t of tracers) put((t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2, (t.z0 + t.z1) / 2, 0.035, t.color[0], t.color[1], t.color[2], t.life / 0.07, t.x1 - t.x0, t.y1 - t.y0, t.z1 - t.z0, KIND.STREAK);
  if (G.glows) for (const g of G.glows) put(g.x, g.y, g.z, g.r, g.c[0], g.c[1], g.c[2], g.a, 0, 0, 0, KIND.GLOW);
  if (G.rainDrops) for (const r of G.rainDrops) put(r[0], r[1], r[2], 0.012, 0.5, 0.55, 0.65, 0.35, 0, -0.9, 0.05, KIND.STREAK);
  R.particleCount = n; R.additiveStart = alphaCount;
}
