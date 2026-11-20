// Smooth follow camera: look-ahead in the direction of travel, speed-based zoom, screen shake.
import { G } from './state.js';
import { clamp, lerp } from './util.js';

export function baseZoom() { return (G.H / 1080) * 1.55; }

export function updateCamera(dt, tx, ty, vx = 0, vy = 0, speed = 0) {
  const c = G.cam;
  const speedK = clamp(speed / 420, 0, 1);
  c.tz = baseZoom() * (1 - 0.36 * speedK);
  c.zoom = lerp(c.zoom, c.tz, 1 - Math.exp(-dt * 1.8));
  const lead = 0.55;
  c.leadX = lerp(c.leadX, vx * lead, 1 - Math.exp(-dt * 2.5));
  c.leadY = lerp(c.leadY, vy * lead, 1 - Math.exp(-dt * 2.5));
  const k = 1 - Math.exp(-dt * 6);
  c.x = lerp(c.x, tx + c.leadX, k);
  c.y = lerp(c.y, ty + c.leadY, k);
  c.shake = Math.max(0, c.shake - dt * 2.2);
  const s = c.shake * c.shake * 26;
  c.sx = (Math.random() * 2 - 1) * s;
  c.sy = (Math.random() * 2 - 1) * s;
}

export function snapCamera(x, y) {
  const c = G.cam;
  c.x = x; c.y = y; c.leadX = 0; c.leadY = 0; c.zoom = c.tz = baseZoom();
}

export function addShake(amount) { G.cam.shake = Math.min(1.2, G.cam.shake + amount); }

/** World-space rectangle currently on screen. */
export function viewRect(margin = 0) {
  const c = G.cam;
  const hw = G.W / 2 / c.zoom + margin, hh = G.H / 2 / c.zoom + margin;
  return { x0: c.x - hw, y0: c.y - hh, x1: c.x + hw, y1: c.y + hh };
}

export function worldToScreen(x, y) {
  const c = G.cam;
  return { x: (x - c.x - c.sx) * c.zoom + G.W / 2, y: (y - c.y - c.sy) * c.zoom + G.H / 2 };
}
