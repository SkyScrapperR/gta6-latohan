// Dynamic light list for the forward renderer: street lamps and landmark neon near the camera,
// vehicle headlight cones / taillights / police lightbars, the helicopter spotlight, muzzle
// flashes and fires (transient), and mission markers. The renderer keeps the nearest N.
import { G } from '../core/state.js';
import { CURB } from '../world/city.js';

const transient = [];
export function addTransientLight(x, y, z, r, color, intensity, life) { if (transient.length < 64) transient.push({ x, y, z, r, color, intensity, life, max: life }); }

export function collectLights(R, dt) {
  const out = [];
  const night = R.env.night || 0;
  const cam = R.camera.pos;
  const near = (x, z, d) => Math.abs(x - cam[0]) < d && Math.abs(z - cam[2]) < d;
  if (night > 0.05) {
    for (const l of G.city.lamps) {
      if (l.broken || !near(l.x, l.z, 170)) continue;
      const hx = l.x + Math.cos(-l.a) * 2.2, hz = l.z + Math.sin(-l.a) * 2.2;
      out.push({ x: hx, y: 6.2, z: hz, r: 17, color: [1, 0.72, 0.42], intensity: 2.0 * night });
    }
    for (const id in G.city.landmarks) {
      const b = G.city.landmarks[id].building;
      if (!near(b.x, b.z, 260)) continue;
      out.push({ x: b.x + b.w / 2, y: 6, z: b.z + b.d + 4, r: 26, color: b.neon, intensity: 2.2 * night, priority: 200 });
    }
  }
  for (const v of G.vehicles) {
    if (v.wrecked || !near(v.x, v.z, 200)) continue;
    const fx = Math.cos(v.angle), fz = Math.sin(v.angle);
    if (v.driver && night > 0.05) {
      out.push({ x: v.x + fx * (v.len / 2 + 0.3), y: 0.9, z: v.z + fz * (v.len / 2 + 0.3), r: 34, color: [1, 0.95, 0.82], intensity: 3.2 * night, dir: [fx, -0.12, fz], cos: 0.78, priority: v.driver.isPlayer ? 4000 : 0 });
      out.push({ x: v.x - fx * (v.len / 2 + 0.4), y: 0.8, z: v.z - fz * (v.len / 2 + 0.4), r: 5, color: [1, 0.08, 0.05], intensity: v.braking ? 3 : 1.2 });
    }
    if (v.siren) {
      const ph = Math.floor(G.time * 7) % 2;
      out.push({ x: v.x, y: 2.2, z: v.z, r: 20, color: ph ? [0.15, 0.3, 1] : [1, 0.06, 0.1], intensity: 4.5, priority: 2500 });
    }
    if (v.onFire) out.push({ x: v.x, y: 1.5, z: v.z, r: 14, color: [1, 0.5, 0.2], intensity: 3 });
  }
  const h = G.heli;
  if (h && night > 0.02) out.push({ x: h.spotX, y: h.y - 4, z: h.spotZ, r: h.y + 14, color: [1, 1, 0.92], intensity: 6, dir: norm([h.spotX - h.x, -(h.y - 1), h.spotZ - h.z]), cos: 0.985, priority: 5000 });
  for (let i = transient.length - 1; i >= 0; i--) {
    const t = transient[i];
    t.life -= dt;
    if (t.life <= 0) { transient.splice(i, 1); continue; }
    out.push({ ...t, intensity: t.intensity * (t.life / t.max), priority: 1500 });
  }
  if (G.markerLights) for (const m of G.markerLights) out.push({ ...m, priority: 600 });
  R.lights = out;
}
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
export { CURB };
