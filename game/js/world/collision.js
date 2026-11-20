// Static collision: a spatial hash grid of building AABBs and tree trunks,
// circle-vs-AABB resolution, coastline clamping, line of sight and ray casts.
import { LAND, PIERS } from './city.js';

const CS = 200; // grid cell size
let grid = new Map();
let boxes = [];
let trunks = [];

const key = (cx, cy) => cx * 4096 + cy;

function insert(item, x0, y0, x1, y1) {
  for (let cx = Math.floor(x0 / CS); cx <= Math.floor(x1 / CS); cx++) {
    for (let cy = Math.floor(y0 / CS); cy <= Math.floor(y1 / CS); cy++) {
      const k = key(cx, cy);
      let cell = grid.get(k);
      if (!cell) grid.set(k, (cell = { boxes: [], trunks: [] }));
      (item.r !== undefined ? cell.trunks : cell.boxes).push(item);
    }
  }
}

export function buildCollision(city) {
  grid = new Map(); boxes = []; trunks = [];
  for (const b of city.buildings) addBox(b);
  for (const c of city.cranes) {
    // crane legs only
    addBox({ x: c.x, y: c.y, w: 8, h: 8, height: c.height, leg: true });
    addBox({ x: c.x + c.w - 8, y: c.y, w: 8, h: 8, height: c.height, leg: true });
    addBox({ x: c.x, y: c.y + c.h - 8, w: 8, h: 8, height: c.height, leg: true });
    addBox({ x: c.x + c.w - 8, y: c.y + c.h - 8, w: 8, h: 8, height: c.height, leg: true });
  }
  for (const t of city.trees) { const tr = { x: t.x, y: t.y, r: 4 }; trunks.push(tr); insert(tr, t.x - 4, t.y - 4, t.x + 4, t.y + 4); }
}
export function addBox(b) { boxes.push(b); insert(b, b.x, b.y, b.x + b.w, b.y + b.h); }

function cellAt(x, y) { return grid.get(key(Math.floor(x / CS), Math.floor(y / CS))); }

/** Gather unique boxes near an area. */
export function boxesNear(x, y, r) {
  const res = new Set();
  for (let cx = Math.floor((x - r) / CS); cx <= Math.floor((x + r) / CS); cx++) {
    for (let cy = Math.floor((y - r) / CS); cy <= Math.floor((y + r) / CS); cy++) {
      const c = grid.get(key(cx, cy));
      if (c) for (const b of c.boxes) res.add(b);
    }
  }
  return res;
}

export function pointInBuilding(x, y) {
  const c = cellAt(x, y);
  if (!c) return null;
  for (const b of c.boxes) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  return null;
}

/**
 * Resolve a circle against buildings, trunks and the coastline.
 * Returns {x, y, hit, nx, ny} — the corrected position and the last contact normal.
 */
export function resolveCircle(x, y, r, ignoreTrunks = false) {
  let hit = false, nx = 0, ny = 0;
  for (let pass = 0; pass < 2; pass++) {
    const cx0 = Math.floor((x - r) / CS), cx1 = Math.floor((x + r) / CS);
    const cy0 = Math.floor((y - r) / CS), cy1 = Math.floor((y + r) / CS);
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const c = grid.get(key(cx, cy));
      if (!c) continue;
      for (const b of c.boxes) {
        const px = x < b.x ? b.x : x > b.x + b.w ? b.x + b.w : x;
        const py = y < b.y ? b.y : y > b.y + b.h ? b.y + b.h : y;
        let dx = x - px, dy = y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 < 1e-6) {
          // centre inside the box: push out along the shallowest axis
          const l = x - b.x, rr = b.x + b.w - x, t = y - b.y, bt = b.y + b.h - y;
          const m = Math.min(l, rr, t, bt);
          if (m === l) { x = b.x - r; dx = -1; dy = 0; } else if (m === rr) { x = b.x + b.w + r; dx = 1; dy = 0; }
          else if (m === t) { y = b.y - r; dx = 0; dy = -1; } else { y = b.y + b.h + r; dx = 0; dy = 1; }
          nx = dx; ny = dy; hit = true; continue;
        }
        const d = Math.sqrt(d2);
        nx = dx / d; ny = dy / d;
        x = px + nx * r; y = py + ny * r;
        hit = true;
      }
      if (!ignoreTrunks) for (const t of c.trunks) {
        const dx = x - t.x, dy = y - t.y, d2 = dx * dx + dy * dy, rr = r + t.r;
        if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; x = t.x + nx * rr; y = t.y + ny * rr; hit = true; }
      }
    }
  }
  const s = clampToLand(x, y, r);
  if (s.hit) { x = s.x; y = s.y; nx = s.nx; ny = s.ny; hit = true; }
  return { x, y, hit, nx, ny };
}

const zones = () => [LAND, ...PIERS.map((p) => ({ x0: p.x, y0: p.y, x1: p.x + p.w, y1: p.y + p.h }))];
let zoneCache = null;
/** Keep a circle on land (the main island rectangle or one of the piers). */
export function clampToLand(x, y, r) {
  if (!zoneCache) zoneCache = zones();
  let best = null, bd = Infinity;
  for (const z of zoneCache) {
    const x0 = z.x0 + r, x1 = z.x1 - r, y0 = z.y0 + r, y1 = z.y1 - r;
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return { x, y, hit: false };
    const px = Math.max(x0, Math.min(x1, x)), py = Math.max(y0, Math.min(y1, y));
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bd) { bd = d; best = { x: px, y: py }; }
  }
  const d = Math.sqrt(bd) || 1;
  return { x: best.x, y: best.y, hit: true, nx: (best.x - x) / d, ny: (best.y - y) / d };
}

/** Segment-vs-AABB slab test; returns entry t in [0,1] or -1. */
export function segBox(x0, y0, x1, y1, b) {
  let tmin = 0, tmax = 1;
  const dx = x1 - x0, dy = y1 - y0;
  if (Math.abs(dx) < 1e-9) { if (x0 < b.x || x0 > b.x + b.w) return -1; }
  else {
    let t1 = (b.x - x0) / dx, t2 = (b.x + b.w - x0) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) { if (y0 < b.y || y0 > b.y + b.h) return -1; }
  else {
    let t1 = (b.y - y0) / dy, t2 = (b.y + b.h - y0) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/** Boxes whose grid cells the segment passes through (conservative, via sampling). */
function boxesAlong(x0, y0, x1, y1) {
  const res = new Set();
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len / (CS * 0.5)));
  let last = -1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.floor((x0 + (x1 - x0) * t) / CS), cy = Math.floor((y0 + (y1 - y0) * t) / CS);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const k = key(cx + ox, cy + oy);
      if (k === last) continue;
      const c = grid.get(k);
      if (c) for (const b of c.boxes) res.add(b);
    }
  }
  return res;
}

/** True when a building (taller than minHeight) blocks the line between two points. */
export function lineBlocked(x0, y0, x1, y1, minHeight = 20) {
  for (const b of boxesAlong(x0, y0, x1, y1)) {
    if (b.height < minHeight || b.leg) continue;
    if (segBox(x0, y0, x1, y1, b) >= 0) return true;
  }
  return false;
}

/** First building hit along a segment: {t, x, y} or null. */
export function raycastWorld(x0, y0, x1, y1) {
  let best = 2;
  for (const b of boxesAlong(x0, y0, x1, y1)) {
    const t = segBox(x0, y0, x1, y1, b);
    if (t >= 0 && t < best) best = t;
  }
  if (best > 1) return null;
  return { t: best, x: x0 + (x1 - x0) * best, y: y0 + (y1 - y0) * best };
}
