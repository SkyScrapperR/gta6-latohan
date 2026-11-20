// Particles (smoke, fire, sparks, debris, explosions), ground decals (skid marks,
// scorch marks, small dark-red marks), bullet tracers and muzzle flashes.
import { G } from '../state.js';
import { TAU, clamp } from '../util.js';
import { addLight, addGlow } from './lighting.js';

const parts = [];
const skids = [];      // persistent tyre marks
const decals = [];     // scorch / marks
const tracers = [];
const MAX_PARTS = 900, MAX_SKIDS = 900, MAX_DECALS = 160;

function spawn(p) { if (parts.length < MAX_PARTS) parts.push(p); }

export function smoke(x, y, { size = 8, life = 1.6, dark = 0.5, vx = 0, vy = 0, rise = 1 } = {}) {
  spawn({ type: 'smoke', x, y, vx: vx + (Math.random() - 0.5) * 14, vy: vy + (Math.random() - 0.5) * 14, life, max: life, size, grow: 14 * rise, shade: dark, rot: Math.random() * TAU });
}
export function fire(x, y, size = 7) {
  spawn({ type: 'fire', x: x + (Math.random() - 0.5) * 8, y: y + (Math.random() - 0.5) * 8, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20, life: 0.5, max: 0.5, size, grow: -6 });
}
export function sparks(x, y, n = 6, angle = null, speed = 160, color = '255,210,120') {
  for (let i = 0; i < n; i++) {
    const a = angle === null ? Math.random() * TAU : angle + (Math.random() - 0.5) * 1.6;
    const s = speed * (0.4 + Math.random() * 0.8);
    spawn({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.25 + Math.random() * 0.25, max: 0.5, size: 1.6, color });
  }
}
export function debris(x, y, n, color = '60,60,60') {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = 80 + Math.random() * 220;
    spawn({ type: 'debris', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.8 + Math.random() * 0.6, max: 1.4, size: 2 + Math.random() * 3, color, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 20 });
  }
}
export function cashBurst(x, y) { sparks(x, y, 10, null, 90, '120,255,140'); }

/** Visual part of an explosion (damage is handled in combat/weapons.js). */
export function explosionFx(x, y, power = 1) {
  spawn({ type: 'flash', x, y, life: 0.35, max: 0.35, size: 90 * power });
  spawn({ type: 'ring', x, y, life: 0.5, max: 0.5, size: 120 * power });
  for (let i = 0; i < 26 * power; i++) {
    const a = Math.random() * TAU, s = Math.random() * 170 * power;
    spawn({ type: 'fire', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6 + Math.random() * 0.5, max: 1.1, size: 12 + Math.random() * 14, grow: 10 });
  }
  for (let i = 0; i < 18 * power; i++) smoke(x + (Math.random() - 0.5) * 50, y + (Math.random() - 0.5) * 50, { size: 16, life: 2.6 + Math.random() * 1.5, dark: 0.25, vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.5) * 120 });
  sparks(x, y, 30, null, 380);
  debris(x, y, 14);
  decal('scorch', x, y, 34 * power);
}

export function skid(x0, y0, x1, y1, alpha = 0.5, width = 4) {
  if ((x1 - x0) ** 2 + (y1 - y0) ** 2 > 900) return;
  skids.push({ x0, y0, x1, y1, a: alpha, w: width, t: G.time });
  if (skids.length > MAX_SKIDS) skids.splice(0, skids.length - MAX_SKIDS);
}
export function decal(type, x, y, r, rot = Math.random() * TAU) {
  decals.push({ type, x, y, r, rot, t: G.time });
  if (decals.length > MAX_DECALS) decals.shift();
}
export function tracer(x0, y0, x1, y1, color = '255,236,160') { tracers.push({ x0, y0, x1, y1, life: 0.09, color }); }
export function muzzleFlash(x, y, a) {
  spawn({ type: 'muzzle', x, y, a, life: 0.06, max: 0.06, size: 12 });
  addLight(x, y, 90, '255,200,120', 0.9);
}

export function clearFx() { parts.length = 0; skids.length = 0; decals.length = 0; tracers.length = 0; }

export function updateParticles(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
    p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt;
    if (p.type === 'smoke') { p.vx *= 1 - dt * 0.8; p.vy *= 1 - dt * 0.8; p.size += p.grow * dt; p.vx += 6 * dt; }
    else if (p.type === 'fire') { p.vx *= 1 - dt * 3; p.vy *= 1 - dt * 3; p.size = Math.max(1, p.size + p.grow * dt); if (Math.random() < 0.08) smoke(p.x, p.y, { size: 6, life: 1.2, dark: 0.3 }); }
    else if (p.type === 'spark' || p.type === 'debris') { p.vx *= 1 - dt * 3; p.vy *= 1 - dt * 3; if (p.rot !== undefined) p.rot += (p.vr || 0) * dt; }
  }
  for (let i = tracers.length - 1; i >= 0; i--) { tracers[i].life -= dt; if (tracers[i].life <= 0) tracers.splice(i, 1); }
}

/** Ground layer: decals and skid marks. */
export function drawGroundFx(ctx, view) {
  const now = G.time;
  ctx.lineCap = 'round';
  for (const s of skids) {
    const age = now - s.t;
    const a = s.a * clamp(1 - age / 40, 0, 1);
    if (a <= 0.01) continue;
    ctx.strokeStyle = `rgba(18,18,20,${a.toFixed(3)})`;
    ctx.lineWidth = s.w;
    ctx.beginPath(); ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); ctx.stroke();
  }
  ctx.lineCap = 'butt';
  for (const d of decals) {
    if (d.x < view.x0 - 60 || d.x > view.x1 + 60 || d.y < view.y0 - 60 || d.y > view.y1 + 60) continue;
    const age = now - d.t;
    const a = clamp(1 - age / 90, 0, 1);
    if (d.type === 'scorch') {
      const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
      g.addColorStop(0, `rgba(10,8,8,${0.75 * a})`); g.addColorStop(1, 'rgba(10,8,8,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
    } else if (d.type === 'mark') {
      ctx.fillStyle = `rgba(110,18,22,${0.55 * a})`;
      ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * 0.6, d.rot, 0, TAU); ctx.fill();
    } else if (d.type === 'hole') {
      ctx.fillStyle = `rgba(20,20,20,${0.6 * a})`; ctx.beginPath(); ctx.arc(d.x, d.y, 1.6, 0, TAU); ctx.fill();
    }
  }
}

/** Air layer: smoke, fire, sparks, tracers (drawn over vehicles). */
export function drawParticles(ctx, view) {
  const amb = G.light.amb;
  for (const p of parts) {
    if (p.x < view.x0 - 100 || p.x > view.x1 + 100 || p.y < view.y0 - 100 || p.y > view.y1 + 100) continue;
    const k = p.life / p.max;
    switch (p.type) {
      case 'smoke': {
        const c = 40 + p.shade * 150;
        ctx.fillStyle = `rgba(${(c * amb[0]) | 0},${(c * amb[1]) | 0},${(c * amb[2]) | 0},${(0.45 * k).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
        break;
      }
      case 'fire': {
        ctx.fillStyle = `rgba(255,${(120 + 120 * k) | 0},${(40 * k) | 0},${(0.85 * k).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
        if (Math.random() < 0.2) addLight(p.x, p.y, 70, '255,150,60', 0.6);
        break;
      }
      case 'spark':
        ctx.strokeStyle = `rgba(${p.color},${k.toFixed(3)})`; ctx.lineWidth = p.size;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
        break;
      case 'debris':
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = `rgba(${p.color},${k.toFixed(3)})`; ctx.fillRect(-p.size, -p.size / 2, p.size * 2, p.size); ctx.restore();
        break;
      case 'flash': {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        g.addColorStop(0, `rgba(255,255,220,${k})`); g.addColorStop(0.4, `rgba(255,190,80,${0.8 * k})`); g.addColorStop(1, 'rgba(255,120,30,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
        addLight(p.x, p.y, 300, '255,170,80', k);
        break;
      }
      case 'ring':
        ctx.strokeStyle = `rgba(255,240,200,${(0.6 * k).toFixed(3)})`; ctx.lineWidth = 4 * k + 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - k) + 10, 0, TAU); ctx.stroke();
        break;
      case 'muzzle':
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.fillStyle = 'rgba(255,230,150,0.95)';
        ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(p.size, 0); ctx.lineTo(0, 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(1, 0, 3, 0, TAU); ctx.fill();
        ctx.restore();
        addGlow(p.x, p.y, 16, '255,200,120', 1);
        break;
    }
  }
  for (const t of tracers) {
    const k = t.life / 0.09;
    ctx.strokeStyle = `rgba(${t.color},${(0.9 * k).toFixed(3)})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(t.x0, t.y0); ctx.lineTo(t.x1, t.y1); ctx.stroke();
  }
}
