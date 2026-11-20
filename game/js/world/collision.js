// Static collision on the ground plane: a spatial hash of building/container AABBs and
// round obstacles (tree trunks, lamp posts, signal poles), circle resolution, coastline
// clamping, line-of-sight tests and ray casts.
import { LAND, PIERS, CITY } from './city.js';

const CS = 32;
let grid = new Map();
const key = (cx, cz) => cx * 8192 + cz;

function insert(item, x0, z0, x1, z1) {
  for (let cx = Math.floor(x0 / CS); cx <= Math.floor(x1 / CS); cx++) for (let cz = Math.floor(z0 / CS); cz <= Math.floor(z1 / CS); cz++) {
    const k = key(cx, cz);
    let c = grid.get(k);
    if (!c) grid.set(k, (c = { boxes: [], posts: [] }));
    (item.r !== undefined ? c.posts : c.boxes).push(item);
  }
}

export function buildCollision(city) {
  grid = new Map();
  for (const b of city.buildings) if (b.y0 <= 0.5) addBox({ x: b.x, z: b.z, w: b.w, d: b.d, h: b.y0 + b.h, ref: b });
  for (const c of city.containers) if (c.y < 1) addBox({ x: c.x, z: c.z, w: c.w, d: c.d, h: 2.6 * 3, ref: c });
  for (const c of city.cranes) for (const [dx, dz] of [[0, 0], [14, 0], [0, 10], [14, 10]]) addBox({ x: c.x + dx, z: c.z + dz, w: 1, d: 1, h: c.h, thin: true });
  for (const s of city.busStops) addBox({ x: s.x - 2.2, z: s.z - 0.8, w: 4.4, d: 0.4, h: 2.7, thin: true });
  for (const t of city.trees) addPost({ x: t.x, z: t.z, r: 0.3, kind: 'tree' });
  for (const l of city.lamps) addPost({ x: l.x, z: l.z, r: 0.18, kind: 'lamp', ref: l });
  for (const s of city.signals || []) addPost({ x: s.x, z: s.z, r: 0.2, kind: 'signal', ref: s });
  for (const blk of city.blocks) for (const f of blk.fountains) if (!f.inPond) addPost({ x: f.x, z: f.z, r: f.r + 0.6, kind: 'fountain' });
}
export function addBox(b) { insert(b, b.x, b.z, b.x + b.w, b.z + b.d); }
export function addPost(p) { insert(p, p.x - p.r, p.z - p.r, p.x + p.r, p.z + p.r); }
export function removePost(p) { for (const c of grid.values()) { const i = c.posts.indexOf(p); if (i >= 0) c.posts.splice(i, 1); } }

export function boxesNear(x, z, r) {
  const out = new Set();
  for (let cx = Math.floor((x - r) / CS); cx <= Math.floor((x + r) / CS); cx++) for (let cz = Math.floor((z - r) / CS); cz <= Math.floor((z + r) / CS); cz++) {
    const c = grid.get(key(cx, cz)); if (c) for (const b of c.boxes) out.add(b);
  }
  return out;
}
export function pointInBuilding(x, z) {
  const c = grid.get(key(Math.floor(x / CS), Math.floor(z / CS)));
  if (!c) return null;
  for (const b of c.boxes) if (x >= b.x && x <= b.x + b.w && z >= b.z && z <= b.z + b.d) return b;
  return null;
}

/**
 * Push a circle out of boxes, posts and the sea. Returns { x, z, hit, nx, nz, post }.
 * `post` is the round obstacle hit (so vehicles can knock lamp posts down).
 */
export function resolveCircle(x, z, r, ignorePosts = false) {
  let hit = false, nx = 0, nz = 0, post = null;
  for (let pass = 0; pass < 2; pass++) {
    for (let cx = Math.floor((x - r) / CS); cx <= Math.floor((x + r) / CS); cx++) for (let cz = Math.floor((z - r) / CS); cz <= Math.floor((z + r) / CS); cz++) {
      const c = grid.get(key(cx, cz));
      if (!c) continue;
      for (const b of c.boxes) {
        const px = x < b.x ? b.x : x > b.x + b.w ? b.x + b.w : x;
        const pz = z < b.z ? b.z : z > b.z + b.d ? b.z + b.d : z;
        let dx = x - px, dz = z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-8) {
          const l = x - b.x, rr = b.x + b.w - x, t = z - b.z, bt = b.z + b.d - z, m = Math.min(l, rr, t, bt);
          if (m === l) { x = b.x - r; nx = -1; nz = 0; } else if (m === rr) { x = b.x + b.w + r; nx = 1; nz = 0; }
          else if (m === t) { z = b.z - r; nx = 0; nz = -1; } else { z = b.z + b.d + r; nx = 0; nz = 1; }
          hit = true; continue;
        }
        const d = Math.sqrt(d2); nx = dx / d; nz = dz / d;
        x = px + nx * r; z = pz + nz * r; hit = true;
      }
      if (!ignorePosts) for (const p of c.posts) {
        const dx = x - p.x, dz = z - p.z, d2 = dx * dx + dz * dz, rr = r + p.r;
        if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; x = p.x + nx * rr; z = p.z + nz * rr; hit = true; post = p; }
      }
    }
  }
  const s = clampToLand(x, z, r);
  if (s.hit) { x = s.x; z = s.z; nx = s.nx; nz = s.nz; hit = true; }
  return { x, z, hit, nx, nz, post };
}

let zones = null;
export function clampToLand(x, z, r) {
  if (!zones) zones = [{ x0: LAND.x0, z0: LAND.z0, x1: LAND.x1, z1: LAND.z1 }, ...PIERS.map((p) => ({ x0: p.x, z0: p.z, x1: p.x + p.w, z1: p.z + p.d }))];
  let best = null, bd = Infinity;
  for (const zn of zones) {
    const x0 = zn.x0 + r, x1 = zn.x1 - r, z0 = zn.z0 + r, z1 = zn.z1 - r;
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return { x, z, hit: false };
    const px = Math.max(x0, Math.min(x1, x)), pz = Math.max(z0, Math.min(z1, z));
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bd) { bd = d; best = { x: px, z: pz }; }
  }
  const d = Math.sqrt(bd) || 1;
  return { x: best.x, z: best.z, hit: true, nx: (best.x - x) / d, nz: (best.z - z) / d };
}

export function segBox(x0, z0, x1, z1, b) {
  let tmin = 0, tmax = 1;
  const dx = x1 - x0, dz = z1 - z0;
  if (Math.abs(dx) < 1e-9) { if (x0 < b.x || x0 > b.x + b.w) return -1; }
  else { let a = (b.x - x0) / dx, c = (b.x + b.w - x0) / dx; if (a > c) [a, c] = [c, a]; tmin = Math.max(tmin, a); tmax = Math.min(tmax, c); if (tmin > tmax) return -1; }
  if (Math.abs(dz) < 1e-9) { if (z0 < b.z || z0 > b.z + b.d) return -1; }
  else { let a = (b.z - z0) / dz, c = (b.z + b.d - z0) / dz; if (a > c) [a, c] = [c, a]; tmin = Math.max(tmin, a); tmax = Math.min(tmax, c); if (tmin > tmax) return -1; }
  return tmin;
}
function boxesAlong(x0, z0, x1, z1) {
  const out = new Set();
  const len = Math.hypot(x1 - x0, z1 - z0), steps = Math.max(1, Math.ceil(len / (CS * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, cx = Math.floor((x0 + (x1 - x0) * t) / CS), cz = Math.floor((z0 + (z1 - z0) * t) / CS);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) { const c = grid.get(key(cx + ox, cz + oz)); if (c) for (const b of c.boxes) out.add(b); }
  }
  return out;
}
/** True if a building taller than minH blocks the line (eye height ~1.6 m). */
export function lineBlocked(x0, z0, x1, z1, minH = 2) {
  for (const b of boxesAlong(x0, z0, x1, z1)) { if (b.h < minH || b.thin) continue; if (segBox(x0, z0, x1, z1, b) >= 0) return true; }
  return false;
}
/** First wall hit along a segment at height y: { t, x, z, nx, nz } or null. */
export function raycastWorld(x0, z0, x1, z1, y = 1.4) {
  let best = 2, hb = null;
  for (const b of boxesAlong(x0, z0, x1, z1)) {
    if (b.h < y) continue;
    const t = segBox(x0, z0, x1, z1, b);
    if (t >= 0 && t < best) { best = t; hb = b; }
  }
  if (best > 1) return null;
  const x = x0 + (x1 - x0) * best, z = z0 + (z1 - z0) * best;
  let nx = 0, nz = 0;
  const e = 0.05;
  if (Math.abs(x - hb.x) < e) nx = -1; else if (Math.abs(x - hb.x - hb.w) < e) nx = 1; else if (Math.abs(z - hb.z) < e) nz = -1; else nz = 1;
  return { t: best, x, z, nx, nz, box: hb };
}
export { CITY };
