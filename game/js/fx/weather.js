// Weather: rain showers come and go; rain streaks around the camera, splashes, wet roads.
import { G } from '../core/state.js';
import { clamp, hash } from '../core/math.js';
import { splash } from './particles.js';
import { rig } from '../camera-rig.js';

export function updateWeather(dt) {
  const w = G.weather;
  if (!w.forced) {
    w.timer -= dt;
    if (w.timer <= 0) {
      w.target = w.target > 0 ? 0 : (hash(Math.floor(G.time)) < 0.4 ? 1 : 0);
      w.timer = w.target > 0 ? 80 + hash(Math.floor(G.time), 3) * 70 : 180 + hash(Math.floor(G.time), 5) * 160;
    }
    w.rain += clamp(w.target - w.rain, -dt * 0.08, dt * 0.08);
  }
  // rain streak positions around the camera (rendered as particles)
  const n = Math.floor(900 * w.rain);
  const drops = G.rainDrops || (G.rainDrops = []);
  const c = rig.pos;
  while (drops.length < n) drops.push([c[0] + (Math.random() - 0.5) * 60, c[1] + Math.random() * 25, c[2] + (Math.random() - 0.5) * 60]);
  drops.length = Math.min(drops.length, n);
  for (const d of drops) {
    d[1] -= 22 * dt; d[0] += 1.2 * dt;
    if (d[1] < 0 || Math.abs(d[0] - c[0]) > 30 || Math.abs(d[2] - c[2]) > 30) {
      if (d[1] < 0 && Math.random() < 0.08) splash(d[0], d[2]);
      d[0] = c[0] + (Math.random() - 0.5) * 60; d[1] = c[1] + 8 + Math.random() * 18; d[2] = c[2] + (Math.random() - 0.5) * 60;
    }
  }
}
