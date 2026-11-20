// City rendering: cached ground chunks (roads, sidewalks, lots, beach), animated sea,
// sun shadows, 2.5D extruded buildings with floor bands + window grids, trees and cranes.
import { G } from '../state.js';
import { CELL, ROAD, NB, CITY, LAND, PIERS, SIDEWALK } from './city.js';
import { hash, lit, rgb, convexHull, TAU, clamp } from '../util.js';

export const PERSP = 1700;          // virtual camera height used for the 2.5D lean
const CHUNK = 512, CHUNK_SCALE = 1.25, CHUNK_CACHE = 42;
const chunks = new Map();
let chunkClock = 0;

// --- projection --------------------------------------------------------------
let pcx = 0, pcy = 0;
export function setProjectionCenter(x, y) { pcx = x; pcy = y; }
/** Project a world point at height h into the 2.5D ground plane (perspective lean from the camera). */
export function project(x, y, h) {
  const s = PERSP / (PERSP - Math.min(h, PERSP * 0.8));
  return [pcx + (x - pcx) * s, pcy + (y - pcy) * s];
}

// --- ground colours ----------------------------------------------------------
const C = {
  asphalt: '#3b3e44', asphalt2: '#34373c', dash: '#e9e3c8', zebra: 'rgba(235,235,225,0.85)',
  sidewalk: '#a7a39a', curb: '#cfcac0', grass: '#5d8f47', grass2: '#4f7f3c', plaza: '#bdb3a2',
  paved: '#9c958a', concrete: '#8a8c88', resort: '#e2d6bd', sand: '#e8d49a', wetsand: '#cdb67c',
  plank: '#8a6440', plank2: '#6f4f31', pool: '#38c6e0', pond: '#3a8fa8',
};

function drawRoads(ctx, x0, y0, x1, y1) {
  ctx.fillStyle = C.asphalt;
  for (let i = 0; i <= NB; i++) {
    const p = i * CELL;
    if (p + ROAD >= x0 && p <= x1) ctx.fillRect(p, Math.max(y0, -10), ROAD, Math.min(y1, CITY + 10) - Math.max(y0, -10));
    if (p + ROAD >= y0 && p <= y1) ctx.fillRect(Math.max(x0, -10), p, Math.min(x1, CITY + 10) - Math.max(x0, -10), ROAD);
  }
  // per-edge details
  for (let j = 0; j <= NB; j++) for (let i = 0; i < NB; i++) {
    // horizontal edge (i,j)->(i+1,j)
    const hx = i * CELL + ROAD, hy = j * CELL;
    if (hx < x1 && hx + BLOCKW > x0 && hy < y1 && hy + ROAD > y0) roadEdge(ctx, hx, hy, true, i, j);
    // vertical edge (j,i)->(j,i+1)  (column j, row i)
    const vx = j * CELL, vy = i * CELL + ROAD;
    if (vx < x1 && vx + ROAD > x0 && vy < y1 && vy + BLOCKW > y0) roadEdge(ctx, vx, vy, false, j, i + 50);
  }
}
const BLOCKW = CELL - ROAD;

function roadEdge(ctx, x, y, horiz, a, b) {
  const L = BLOCKW;
  // subtle asphalt patches
  ctx.fillStyle = 'rgba(30,32,36,0.35)';
  const ph = hash(a, b, 3);
  if (horiz) ctx.fillRect(x + ph * 200, y + 8, 80 + ph * 60, 26); else ctx.fillRect(x + 8, y + ph * 200, 26, 80 + ph * 60);
  // centre dashes
  ctx.fillStyle = C.dash;
  for (let t = 30; t < L - 30; t += 34) {
    if (horiz) ctx.fillRect(x + t, y + ROAD / 2 - 1.5, 18, 3); else ctx.fillRect(x + ROAD / 2 - 1.5, y + t, 3, 18);
  }
  // edge lines
  ctx.fillStyle = 'rgba(230,226,210,0.35)';
  if (horiz) { ctx.fillRect(x, y + 4, L, 1.5); ctx.fillRect(x, y + ROAD - 5.5, L, 1.5); }
  else { ctx.fillRect(x + 4, y, 1.5, L); ctx.fillRect(x + ROAD - 5.5, y, 1.5, L); }
  // zebra crossings at both ends
  ctx.fillStyle = C.zebra;
  for (const end of [4, L - 16]) {
    for (let s = 6; s < ROAD - 6; s += 9) {
      if (horiz) ctx.fillRect(x + end, y + s, 12, 5); else ctx.fillRect(x + s, y + end, 5, 12);
    }
  }
  // oil stains
  for (let k = 0; k < 2; k++) {
    const h1 = hash(a, b, 10 + k), h2 = hash(a, b, 20 + k);
    const px = horiz ? x + 40 + h1 * (L - 80) : x + 22 + h2 * 36;
    const py = horiz ? y + 22 + h2 * 36 : y + 40 + h1 * (L - 80);
    ctx.fillStyle = 'rgba(15,15,20,0.28)';
    ctx.beginPath(); ctx.ellipse(px, py, 7 + h1 * 8, 4 + h2 * 5, h1 * 3, 0, TAU); ctx.fill();
  }
  // manhole
  if (hash(a, b, 5) < 0.7) {
    const t = 60 + hash(a, b, 6) * (L - 120);
    const px = horiz ? x + t : x + ROAD / 2 + 18, py = horiz ? y + ROAD / 2 + 18 : y + t;
    ctx.fillStyle = '#2a2c30'; ctx.beginPath(); ctx.arc(px, py, 6, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#55585e'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px - 4, py); ctx.lineTo(px + 4, py); ctx.moveTo(px, py - 4); ctx.lineTo(px, py + 4); ctx.stroke();
  }
}

function drawBlockGround(ctx, blk) {
  // sidewalk + curb
  ctx.fillStyle = C.curb; ctx.fillRect(blk.x, blk.y, blk.w, blk.h);
  ctx.fillStyle = C.sidewalk; ctx.fillRect(blk.x + 2, blk.y + 2, blk.w - 4, blk.h - 4);
  // paving joints
  ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let t = 0; t < blk.w; t += 16) { ctx.moveTo(blk.x + t, blk.y); ctx.lineTo(blk.x + t, blk.y + SIDEWALK); ctx.moveTo(blk.x + t, blk.y + blk.h - SIDEWALK); ctx.lineTo(blk.x + t, blk.y + blk.h); }
  for (let t = 0; t < blk.h; t += 16) { ctx.moveTo(blk.x, blk.y + t); ctx.lineTo(blk.x + SIDEWALK, blk.y + t); ctx.moveTo(blk.x + blk.w - SIDEWALK, blk.y + t); ctx.lineTo(blk.x + blk.w, blk.y + t); }
  ctx.stroke();
  const L = blk.lot;
  switch (blk.ground) {
    case 'plaza': {
      ctx.fillStyle = C.plaza; ctx.fillRect(L.x, L.y, L.w, L.h);
      ctx.strokeStyle = 'rgba(120,100,80,0.18)';
      ctx.beginPath();
      for (let t = 0; t <= L.w; t += 24) { ctx.moveTo(L.x + t, L.y); ctx.lineTo(L.x + t, L.y + L.h); }
      for (let t = 0; t <= L.h; t += 24) { ctx.moveTo(L.x, L.y + t); ctx.lineTo(L.x + L.w, L.y + t); }
      ctx.stroke();
      break;
    }
    case 'paved': ctx.fillStyle = C.paved; ctx.fillRect(L.x, L.y, L.w, L.h);
      ctx.fillStyle = 'rgba(60,50,40,0.12)';
      for (let i = 0; i < 6; i++) ctx.fillRect(L.x + hash(blk.seed, i) * (L.w - 30), L.y + hash(blk.seed, i, 1) * (L.h - 20), 30, 20);
      break;
    case 'garden': {
      ctx.fillStyle = C.grass; ctx.fillRect(L.x, L.y, L.w, L.h);
      for (const lot of blk.lots) {
        ctx.fillStyle = hash(lot.x, lot.y) < 0.5 ? C.grass2 : '#679a4f';
        ctx.fillRect(lot.x, lot.y, lot.w, lot.h);
        ctx.strokeStyle = 'rgba(240,235,220,0.55)'; ctx.lineWidth = 2; ctx.strokeRect(lot.x, lot.y, lot.w, lot.h);
        ctx.fillStyle = '#b8b0a2'; ctx.fillRect(lot.x + lot.w / 2 - 12, lot.y + lot.h - 36, 24, 36); // driveway
      }
      // flower beds
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = ['#e85d8f', '#ffd166', '#f7f7f7', '#c77dff'][i % 4];
        ctx.beginPath(); ctx.arc(L.x + hash(blk.seed, i, 7) * L.w, L.y + hash(blk.seed, i, 8) * L.h, 2.5, 0, TAU); ctx.fill();
      }
      break;
    }
    case 'concrete': ctx.fillStyle = C.concrete; ctx.fillRect(L.x, L.y, L.w, L.h);
      ctx.strokeStyle = 'rgba(240,200,40,0.6)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
      ctx.strokeRect(L.x + 6, L.y + 6, L.w - 12, L.h - 12); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(40,40,40,0.18)';
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(L.x + hash(blk.seed, i, 2) * L.w, L.y + hash(blk.seed, i, 3) * L.h, 10, 6, 0, 0, TAU); ctx.fill(); }
      break;
    case 'resort': ctx.fillStyle = C.resort; ctx.fillRect(L.x, L.y, L.w, L.h);
      ctx.strokeStyle = 'rgba(160,140,110,0.25)';
      ctx.beginPath(); for (let t = 0; t < L.w; t += 12) { ctx.moveTo(L.x + t, L.y); ctx.lineTo(L.x + t, L.y + L.h); } ctx.stroke();
      break;
    case 'park': {
      ctx.fillStyle = C.grass; ctx.fillRect(L.x, L.y, L.w, L.h);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = 'rgba(40,80,30,0.2)';
        ctx.beginPath(); ctx.arc(L.x + hash(blk.seed, i, 4) * L.w, L.y + hash(blk.seed, i, 5) * L.h, 6 + hash(i, blk.seed) * 10, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = '#d9cba5'; ctx.lineWidth = 12; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(L.x, L.y + L.h / 2); ctx.lineTo(L.x + L.w, L.y + L.h / 2);
      ctx.moveTo(L.x + L.w / 2, L.y); ctx.lineTo(L.x + L.w / 2, L.y + L.h);
      ctx.moveTo(L.x + 10, L.y + 10); ctx.quadraticCurveTo(L.x + L.w * 0.2, L.y + L.h * 0.8, L.x + L.w - 10, L.y + L.h - 10);
      ctx.stroke(); ctx.lineCap = 'butt';
      const p = blk.pond;
      ctx.fillStyle = '#c9b98e'; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx + 6, p.ry + 6, 0, 0, TAU); ctx.fill();
      const g = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, p.rx);
      g.addColorStop(0, '#4fb0c8'); g.addColorStop(1, C.pond);
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, TAU); ctx.fill();
      break;
    }
  }
  if (blk.forecourt) {
    const f = blk.forecourt;
    ctx.fillStyle = '#8f8a82'; ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let t = 30; t < f.w - 20; t += 36) { ctx.moveTo(f.x + t, f.y + f.h - 4); ctx.lineTo(f.x + t, f.y + f.h - 40); }
    ctx.stroke();
  }
  if (blk.alley) {
    ctx.fillStyle = 'rgba(70,60,50,0.25)';
    ctx.fillRect(L.x + L.w / 2 - 6, L.y, 12, L.h);
  }
  for (const p of blk.pools) {
    ctx.fillStyle = '#f2efe6'; ctx.fillRect(p.x - 3, p.y - 3, p.w + 6, p.h + 6);
    const g = ctx.createLinearGradient(p.x, p.y, p.x + p.w, p.y + p.h);
    g.addColorStop(0, '#5fe0f0'); g.addColorStop(1, '#1f9ec0');
    ctx.fillStyle = g; ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); for (let t = 6; t < p.w; t += 10) { ctx.moveTo(p.x + t, p.y + 4); ctx.lineTo(p.x + t + 4, p.y + p.h - 4); } ctx.stroke();
  }
  for (const f of blk.fountains) {
    if (f.inPond) continue;
    ctx.fillStyle = '#d8d0c0'; ctx.beginPath(); ctx.arc(f.x, f.y, f.r + 5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3fb2d0'; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
  }
  if (blk.cafeTables) for (const t of blk.cafeTables) {
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(t.x, t.y, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7a4a2a'; for (const o of [-9, 9]) { ctx.beginPath(); ctx.arc(t.x + o, t.y, 3, 0, TAU); ctx.fill(); }
    ctx.fillStyle = ['#ff6fd8', '#2ff3e0', '#ffd23f'][(t.x | 0) % 3]; ctx.beginPath(); ctx.arc(t.x, t.y - 1, 9, Math.PI, TAU); ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
  }
}

function drawCoast(ctx, x0, y0, x1, y1) {
  // land base: promenade ring around the grid
  ctx.fillStyle = '#7f9a6a'; ctx.fillRect(LAND.x0, LAND.y0, LAND.x1 - LAND.x0, LAND.y1 - LAND.y0);
  ctx.fillStyle = '#a19a8c'; // promenade paving north/west
  ctx.fillRect(LAND.x0, LAND.y0, LAND.x1 - LAND.x0, 130); ctx.fillRect(LAND.x0, LAND.y0, 130, CITY + 130);
  ctx.fillStyle = '#8c8e8a'; ctx.fillRect(CITY, LAND.y0, LAND.x1 - CITY, CITY + 130); // docks quay
  ctx.fillStyle = 'rgba(240,200,40,0.8)'; ctx.fillRect(LAND.x1 - 8, LAND.y0, 4, CITY + 130);
  for (let y = LAND.y0 + 30; y < CITY; y += 70) { ctx.fillStyle = '#2b2b2b'; ctx.beginPath(); ctx.arc(LAND.x1 - 14, y, 4, 0, TAU); ctx.fill(); }
  // railing dots along north/west promenade edge
  ctx.fillStyle = '#ddd6c8';
  for (let x = LAND.x0; x < CITY; x += 22) ctx.fillRect(x, LAND.y0 + 2, 10, 3);
  for (let y = LAND.y0; y < CITY + 120; y += 22) ctx.fillRect(LAND.x0 + 2, y, 3, 10);
  // beach
  const g = ctx.createLinearGradient(0, CITY, 0, LAND.y1);
  g.addColorStop(0, '#efdca6'); g.addColorStop(0.75, C.sand); g.addColorStop(1, C.wetsand);
  ctx.fillStyle = g; ctx.fillRect(LAND.x0, CITY + 2, LAND.x1 - LAND.x0, LAND.y1 - CITY - 2);
  // sand speckle
  for (let i = 0; i < 400; i++) {
    const sx = LAND.x0 + hash(i, 1, 77) * (LAND.x1 - LAND.x0), sy = CITY + 40 + hash(i, 2, 77) * 240;
    if (sx < x0 - 10 || sx > x1 + 10 || sy < y0 - 10 || sy > y1 + 10) continue;
    ctx.fillStyle = hash(i, 3) < 0.5 ? 'rgba(180,150,90,0.35)' : 'rgba(255,250,230,0.5)';
    ctx.fillRect(sx, sy, 2, 2);
  }
  // boardwalk
  ctx.fillStyle = C.plank; ctx.fillRect(LAND.x0, CITY + 6, LAND.x1 - LAND.x0, 30);
  ctx.fillStyle = C.plank2;
  for (let x = LAND.x0; x < LAND.x1; x += 8) if (x > x0 - 10 && x < x1 + 10) ctx.fillRect(x, CITY + 6, 1.5, 30);
  // piers
  for (const p of PIERS) {
    ctx.fillStyle = C.plank; ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = C.plank2;
    if (p.w < p.h) for (let y = p.y; y < p.y + p.h; y += 7) ctx.fillRect(p.x, y, p.w, 1.5);
    else for (let x = p.x; x < p.x + p.w; x += 7) ctx.fillRect(x, p.y, 1.5, p.h);
    ctx.fillStyle = '#4a3320';
    const n = Math.floor(Math.max(p.w, p.h) / 40);
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (p.w < p.h) { ctx.fillRect(p.x - 3, p.y + t * p.h - 3, 6, 6); ctx.fillRect(p.x + p.w - 3, p.y + t * p.h - 3, 6, 6); }
      else { ctx.fillRect(p.x + t * p.w - 3, p.y - 3, 6, 6); ctx.fillRect(p.x + t * p.w - 3, p.y + p.h - 3, 6, 6); }
    }
  }
}

function drawBeachProps(ctx, city, x0, y0, x1, y1) {
  for (const p of city.beachProps) {
    if (p.x < x0 - 40 || p.x > x1 + 40 || p.y < y0 - 40 || p.y > y1 + 40) continue;
    if (p.type === 'towel') { ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 14, 26); ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(p.x, p.y + 6, 14, 3); }
  }
}

function drawStreetlightPoles(ctx, city, x0, y0, x1, y1) {
  for (const l of city.lights) {
    if (l.x < x0 - 10 || l.x > x1 + 10 || l.y < y0 - 10 || l.y > y1 + 10) continue;
    ctx.fillStyle = '#2f3236'; ctx.beginPath(); ctx.arc(l.x, l.y, 3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#6a6e74'; ctx.beginPath(); ctx.arc(l.x, l.y, 1.5, 0, TAU); ctx.fill();
  }
}

function renderChunk(ci, cj) {
  const x0 = ci * CHUNK, y0 = cj * CHUNK, x1 = x0 + CHUNK, y1 = y0 + CHUNK;
  if (x1 < LAND.x0 - 600 || x0 > LAND.x1 + 600 || y1 < LAND.y0 - 600 || y0 > LAND.y1 + 600) return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.ceil(CHUNK * CHUNK_SCALE);
  const ctx = cv.getContext('2d');
  ctx.scale(CHUNK_SCALE, CHUNK_SCALE);
  ctx.translate(-x0, -y0);
  ctx.beginPath(); ctx.rect(x0, y0, CHUNK, CHUNK); ctx.clip();
  const city = G.city;
  drawCoast(ctx, x0, y0, x1, y1);
  drawRoads(ctx, x0, y0, x1, y1);
  for (const blk of city.blocks) {
    if (blk.x > x1 || blk.x + blk.w < x0 || blk.y > y1 || blk.y + blk.h < y0) continue;
    drawBlockGround(ctx, blk);
  }
  drawBeachProps(ctx, city, x0, y0, x1, y1);
  drawStreetlightPoles(ctx, city, x0, y0, x1, y1);
  return cv;
}

export function clearChunkCache() { chunks.clear(); }

/** Draw the ground layer for the current view (world-space transform must be active). */
export function drawGround(ctx, view) {
  chunkClock++;
  const ci0 = Math.floor(view.x0 / CHUNK), ci1 = Math.floor(view.x1 / CHUNK);
  const cj0 = Math.floor(view.y0 / CHUNK), cj1 = Math.floor(view.y1 / CHUNK);
  let built = 0;
  for (let ci = ci0; ci <= ci1; ci++) for (let cj = cj0; cj <= cj1; cj++) {
    const k = ci * 1000 + cj;
    let e = chunks.get(k);
    if (!e) {
      if (built >= 3 && G.mode !== 'boot') { ctx.fillStyle = '#6c7a68'; ctx.fillRect(ci * CHUNK, cj * CHUNK, CHUNK, CHUNK); continue; }
      e = { cv: renderChunk(ci, cj), used: 0 }; chunks.set(k, e); built++;
    }
    e.used = chunkClock;
    if (e.cv) ctx.drawImage(e.cv, ci * CHUNK, cj * CHUNK, CHUNK + 0.6, CHUNK + 0.6);
  }
  if (chunks.size > CHUNK_CACHE) {
    const arr = [...chunks.entries()].sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < chunks.size - CHUNK_CACHE; i++) chunks.delete(arr[i][0]);
  }
}
/** Pre-render chunks around a point (used at boot / teleports). */
export function warmChunks(x, y, r = 1400) {
  for (let ci = Math.floor((x - r) / CHUNK); ci <= Math.floor((x + r) / CHUNK); ci++)
    for (let cj = Math.floor((y - r) / CHUNK); cj <= Math.floor((y + r) / CHUNK); cj++) {
      const k = ci * 1000 + cj;
      if (!chunks.has(k)) chunks.set(k, { cv: renderChunk(ci, cj), used: chunkClock });
    }
}

// --- sea -----------------------------------------------------------------------
export function drawSea(ctx, view, t) {
  const amb = G.light.amb;
  const g = ctx.createLinearGradient(0, view.y0, 0, view.y1);
  g.addColorStop(0, lit([28, 120, 150], amb));
  g.addColorStop(1, lit([20, 96, 138], amb));
  ctx.fillStyle = g;
  ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
  // shallow band near the coast
  ctx.fillStyle = lit([60, 170, 180], amb, 1, 0.55);
  ctx.fillRect(LAND.x0 - 70, LAND.y0 - 70, LAND.x1 - LAND.x0 + 140, LAND.y1 - LAND.y0 + 140);
  // wave crests
  ctx.strokeStyle = lit([200, 240, 250], amb, 1, 0.35);
  ctx.lineWidth = 2;
  ctx.beginPath();
  const S = 110;
  for (let gx = Math.floor(view.x0 / S); gx <= Math.floor(view.x1 / S); gx++) for (let gy = Math.floor(view.y0 / S); gy <= Math.floor(view.y1 / S); gy++) {
    const h = hash(gx, gy, 9);
    const px = gx * S + h * 80 + Math.sin(t * 0.6 + h * 9) * 12, py = gy * S + hash(gy, gx, 4) * 80;
    if (px > LAND.x0 - 40 && px < LAND.x1 + 40 && py > LAND.y0 - 40 && py < LAND.y1 + 40) continue;
    const ph = (t * 0.5 + h * 5) % 3;
    if (ph > 2) continue;
    const w = 12 + h * 14;
    ctx.moveTo(px - w, py); ctx.quadraticCurveTo(px, py - 5, px + w, py);
  }
  ctx.stroke();
}

/** Animated foam along the shoreline (drawn over the ground chunks). */
export function drawFoam(ctx, view, t) {
  const amb = G.light.amb;
  ctx.strokeStyle = lit([250, 255, 255], amb, 1, 0.75);
  ctx.lineWidth = 3;
  ctx.beginPath();
  const yB = LAND.y1;
  for (let x = Math.max(LAND.x0, view.x0 - 20); x <= Math.min(LAND.x1, view.x1 + 20); x += 12) {
    const y = yB + Math.sin(x * 0.03 + t * 1.6) * 5 + Math.sin(x * 0.011 - t) * 4 + 2;
    if (x === Math.max(LAND.x0, view.x0 - 20)) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = lit([250, 255, 255], amb, 1, 0.4);
  const off = (Math.sin(t * 0.8) + 1) * 4;
  ctx.setLineDash([16, 10]);
  ctx.lineDashOffset = -t * 10;
  ctx.strokeRect(LAND.x0 - 3 - off, LAND.y0 - 3 - off, LAND.x1 - LAND.x0 + 6 + off * 2, LAND.y1 - LAND.y0 + 6 + off * 2);
  ctx.setLineDash([]);
}

// --- shadows ----------------------------------------------------------------
export function drawShadows(ctx, view, buildings, trees) {
  const L = G.light;
  if (L.shadowAlpha <= 0.01) return;
  ctx.fillStyle = `rgba(10,12,30,${L.shadowAlpha.toFixed(3)})`;
  ctx.beginPath();
  for (const b of buildings) {
    const dx = L.sunX * b.height * L.shadowLen, dy = L.sunY * b.height * L.shadowLen;
    const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h],
      [b.x + dx, b.y + dy], [b.x + b.w + dx, b.y + dy], [b.x + b.w + dx, b.y + b.h + dy], [b.x + dx, b.y + b.h + dy]];
    const hull = convexHull(pts);
    ctx.moveTo(hull[0][0], hull[0][1]);
    for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i][0], hull[i][1]);
    ctx.closePath();
  }
  for (const c of G.city.cranes) {
    const dx = L.sunX * c.height * L.shadowLen, dy = L.sunY * c.height * L.shadowLen;
    ctx.moveTo(c.x, c.y + c.h / 2 - 4); ctx.lineTo(c.x + c.w, c.y + c.h / 2 - 4); ctx.lineTo(c.x + c.w + dx, c.y + c.h / 2 - 4 + dy); ctx.lineTo(c.x + dx, c.y + c.h / 2 - 4 + dy); ctx.closePath();
  }
  ctx.fill();
  ctx.beginPath();
  for (const t of trees) {
    const dx = L.sunX * 26 * L.shadowLen, dy = L.sunY * 26 * L.shadowLen;
    ctx.moveTo(t.x + dx + t.r, t.y + dy);
    ctx.ellipse(t.x + dx, t.y + dy, t.r, t.r * 0.9, 0, 0, TAU);
  }
  ctx.fill();
}

// --- buildings -----------------------------------------------------------------
const FACE_SHADE = { n: 0.62, e: 0.8, s: 0.95, w: 0.72 };

function quad(ctx, a, b, c, d) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); }

function drawFace(ctx, b, ax, ay, bx, by, face, amb, night) {
  const H = b.height;
  const a0 = [ax, ay], b0 = [bx, by], a1 = project(ax, ay, H), b1 = project(bx, by, H);
  const k = FACE_SHADE[face];
  ctx.beginPath(); quad(ctx, a0, b0, b1, a1);
  if (b.glass) {
    const g = ctx.createLinearGradient(a0[0], a0[1], a1[0], a1[1]);
    g.addColorStop(0, lit(b.wall2, amb, k * 0.9));
    g.addColorStop(1, lit(b.wall, amb, k * 1.15));
    ctx.fillStyle = g;
  } else ctx.fillStyle = lit(b.wall, amb, k);
  ctx.fill();
  // how much of the wall is visible on screen (edge-on walls get no detail)
  const span = Math.max(Math.abs(a1[0] - ax), Math.abs(a1[1] - ay));
  if (span < 5 || b.kind === 'container') {
    if (b.kind === 'container') {
      ctx.strokeStyle = lit(b.wall, amb, k * 0.7); ctx.lineWidth = 1;
      ctx.beginPath();
      const len = Math.hypot(bx - ax, by - ay), n = Math.floor(len / 5);
      for (let i = 1; i < n; i++) { const t = i / n; const p0 = [ax + (bx - ax) * t, ay + (by - ay) * t]; const p1 = project(p0[0], p0[1], H); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); }
      ctx.stroke();
    }
    return;
  }
  const floorH = b.floorH, floors = Math.max(1, Math.floor(H / floorH));
  const len = Math.hypot(bx - ax, by - ay);
  const cols = Math.max(1, Math.floor(len / b.winW));
  const pt = (t, h) => project(ax + (bx - ax) * t, ay + (by - ay) * t, h);
  // floor bands
  if (b.kind !== 'house' && b.kind !== 'shop') {
    ctx.strokeStyle = lit(b.wall2, amb, k * 0.75); ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let f = 1; f < floors; f++) { const p = pt(0, f * floorH), q = pt(1, f * floorH); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
    ctx.stroke();
  }
  // windows
  const dayWin = b.glass ? [150, 196, 222] : b.kind === 'warehouse' ? [70, 80, 90] : [70, 92, 112];
  const litFrac = night * (b.kind === 'warehouse' ? 0.15 : 0.45);
  const fi = face === 'n' ? 0 : face === 'e' ? 1 : face === 's' ? 2 : 3;
  const dark = new Path2D(), on = new Path2D();
  const fstart = b.kind === 'warehouse' ? floors - 1 : 0;
  const winCols = b.kind === 'warehouse' ? Math.max(1, Math.floor(cols / 3)) : cols;
  for (let f = fstart; f < floors; f++) {
    const h0 = f * floorH + 3, h1 = f * floorH + floorH - 3;
    for (let c = 0; c < winCols; c++) {
      if (b.kind === 'house' && f > 0) continue;
      const t0 = (c + 0.18) / winCols, t1 = (c + 0.82) / winCols;
      const A = pt(t0, h0), B = pt(t1, h0), Cc = pt(t1, h1), D = pt(t0, h1);
      const target = hash(b.seed, fi, f, c) < litFrac ? on : dark;
      target.moveTo(A[0], A[1]); target.lineTo(B[0], B[1]); target.lineTo(Cc[0], Cc[1]); target.lineTo(D[0], D[1]); target.closePath();
    }
  }
  ctx.fillStyle = lit(dayWin, amb, k * (b.glass ? 1.05 : 0.9));
  ctx.fill(dark);
  if (litFrac > 0) {
    ctx.fillStyle = hash(b.seed, 1) < 0.3 ? '#bfe6ff' : '#ffd88a';
    ctx.fill(on);
  }
  // door on houses/shops facing south
  if ((b.kind === 'house' || b.kind === 'shop') && face === 's') {
    const A = pt(0.45, 0), B = pt(0.55, 0), Cc = pt(0.55, 9), D = pt(0.45, 9);
    ctx.fillStyle = lit([90, 60, 40], amb); ctx.beginPath(); quad(ctx, A, B, Cc, D); ctx.fill();
  }
  if (b.balconies && face === 's') {
    ctx.strokeStyle = lit([255, 255, 255], amb, 0.9, 0.7); ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let f = 1; f < floors; f++) { const p = pt(0.05, f * floorH + 1), q = pt(0.95, f * floorH + 1); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
    ctx.stroke();
  }
}

function drawRoof(ctx, b, amb, night, t) {
  const r0 = project(b.x, b.y, b.height), r1 = project(b.x + b.w, b.y + b.h, b.height);
  const s = (r1[0] - r0[0]) / b.w;
  ctx.save();
  ctx.translate(r0[0], r0[1]);
  ctx.scale(s, s);
  const w = b.w, h = b.h;
  if (b.pitched) {
    const c1 = lit(b.roof, amb, 1.05), c2 = lit(b.roof, amb, 0.78);
    ctx.fillStyle = c1;
    if (b.ridgeX) { ctx.fillRect(-3, -3, w + 6, h / 2 + 3); ctx.fillStyle = c2; ctx.fillRect(-3, h / 2, w + 6, h / 2 + 3); }
    else { ctx.fillRect(-3, -3, w / 2 + 3, h + 6); ctx.fillStyle = c2; ctx.fillRect(w / 2, -3, w / 2 + 3, h + 6); }
    ctx.strokeStyle = lit(b.roof, amb, 0.6); ctx.lineWidth = 1;
    ctx.beginPath();
    if (b.ridgeX) for (let y = 4; y < h; y += 5) { ctx.moveTo(-3, y); ctx.lineTo(w + 3, y); }
    else for (let x = 4; x < w; x += 5) { ctx.moveTo(x, -3); ctx.lineTo(x, h + 3); }
    ctx.stroke();
    ctx.strokeStyle = lit(b.roof, amb, 1.3); ctx.lineWidth = 2;
    ctx.beginPath(); if (b.ridgeX) { ctx.moveTo(4, h / 2); ctx.lineTo(w - 4, h / 2); } else { ctx.moveTo(w / 2, 4); ctx.lineTo(w / 2, h - 4); } ctx.stroke();
  } else {
    ctx.fillStyle = lit(b.roof, amb, b.kind === 'container' ? 1.05 : 1);
    ctx.fillRect(0, 0, w, h);
    if (b.kind !== 'container') {
      ctx.strokeStyle = lit(b.roof, amb, 0.7); ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
      ctx.strokeStyle = lit(b.roof, amb, 1.25); ctx.lineWidth = 1; ctx.strokeRect(4, 4, w - 8, h - 8);
    }
    if (b.corrugated || b.kind === 'container') {
      ctx.strokeStyle = lit(b.roof, amb, 0.78); ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (b.ribsX || (b.kind === 'container' && w > h)) for (let x = 4; x < w - 2; x += 5) { ctx.moveTo(x, 2); ctx.lineTo(x, h - 2); }
      else for (let y = 4; y < h - 2; y += 5) { ctx.moveTo(2, y); ctx.lineTo(w - 2, y); }
      ctx.stroke();
    }
  }
  for (const f of b.features) drawRoofFeature(ctx, f, b, amb, night, t);
  if (b.label) {
    const size = clamp(Math.min(w / (b.label.length * 0.7), h * 0.22), 9, 30);
    ctx.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const ly = b.features.some((f) => f.type === 'orchid' || f.type === 'redcross' || f.type === 'dome') ? h - size * 0.9 : h / 2;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(b.label, w / 2, ly);
    ctx.fillStyle = night > 0.3 ? b.neon : lit([255, 255, 255], amb, 0.95);
    if (night > 0.3) { ctx.shadowColor = b.neon; ctx.shadowBlur = 12; }
    ctx.fillText(b.label, w / 2, ly);
    ctx.shadowBlur = 0;
  }
  if (b.neon && night > 0.25) {
    ctx.strokeStyle = b.neon; ctx.globalAlpha = Math.min(1, night * 1.2) * (0.75 + 0.25 * Math.sin(t * 3 + b.seed));
    ctx.lineWidth = 2.5; ctx.shadowColor = b.neon; ctx.shadowBlur = 14;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawRoofFeature(ctx, f, b, amb, night, t) {
  switch (f.type) {
    case 'ac':
      ctx.fillStyle = lit([150, 155, 160], amb); ctx.fillRect(f.x, f.y, f.w, f.h);
      ctx.fillStyle = lit([90, 95, 100], amb); ctx.beginPath(); ctx.arc(f.x + f.w / 2, f.y + f.h / 2, Math.min(f.w, f.h) * 0.32, 0, TAU); ctx.fill();
      break;
    case 'tank':
      ctx.fillStyle = lit([70, 70, 75], amb); ctx.beginPath(); ctx.arc(f.x + 2, f.y + 2, f.r, 0, TAU); ctx.fill();
      ctx.fillStyle = lit([60, 110, 170], amb); ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = lit([150, 190, 230], amb); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 0.6, 0, TAU); ctx.stroke();
      break;
    case 'antenna':
      ctx.strokeStyle = lit([200, 200, 205], amb); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(f.x - 8, f.y); ctx.lineTo(f.x + 8, f.y); ctx.moveTo(f.x, f.y - 8); ctx.lineTo(f.x, f.y + 8); ctx.stroke();
      ctx.fillStyle = Math.sin(t * 4 + f.x) > 0 ? '#ff3030' : '#601010'; ctx.beginPath(); ctx.arc(f.x, f.y, 2.5, 0, TAU); ctx.fill();
      break;
    case 'helipad':
      ctx.fillStyle = lit([60, 64, 70], amb); ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = lit([240, 220, 60], amb); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 0.82, 0, TAU); ctx.stroke();
      ctx.fillStyle = lit([255, 255, 255], amb);
      ctx.font = `900 ${f.r * 0.9}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H', f.x, f.y + 1);
      break;
    case 'redcross':
      ctx.fillStyle = lit([245, 245, 245], amb); ctx.beginPath(); ctx.arc(f.x, f.y - 8, f.r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e8243a';
      ctx.fillRect(f.x - f.r * 0.18, f.y - 8 - f.r * 0.6, f.r * 0.36, f.r * 1.2);
      ctx.fillRect(f.x - f.r * 0.6, f.y - 8 - f.r * 0.18, f.r * 1.2, f.r * 0.36);
      break;
    case 'orchid': {
      const g = ctx.createRadialGradient(f.x, f.y - 10, 4, f.x, f.y - 10, f.r);
      g.addColorStop(0, night > 0.3 ? '#ffb8ff' : '#e9b6ff'); g.addColorStop(1, night > 0.3 ? 'rgba(170,60,255,0.2)' : 'rgba(120,50,170,0.4)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y - 10, f.r, 0, TAU); ctx.fill();
      ctx.fillStyle = night > 0.3 ? '#ff5cf0' : '#c45cff';
      if (night > 0.3) { ctx.shadowColor = '#ff5cf0'; ctx.shadowBlur = 20; }
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * TAU - Math.PI / 2 + Math.sin(t * 0.5) * 0.05;
        ctx.save(); ctx.translate(f.x, f.y - 10); ctx.rotate(a);
        ctx.beginPath(); ctx.ellipse(0, -f.r * 0.42, f.r * 0.2, f.r * 0.4, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#ffe14d'; ctx.beginPath(); ctx.arc(f.x, f.y - 10, f.r * 0.14, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      break;
    }
    case 'dome': {
      const g = ctx.createRadialGradient(f.x - 10, f.y - 18, 4, f.x, f.y - 8, f.r);
      g.addColorStop(0, lit([255, 240, 170], amb)); g.addColorStop(1, lit([170, 130, 50], amb));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y - 8, f.r, 0, TAU); ctx.fill();
      break;
    }
    case 'garden':
      ctx.fillStyle = lit([84, 140, 70], amb); ctx.fillRect(f.x, f.y, f.w, f.h);
      ctx.fillStyle = lit([60, 110, 50], amb);
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(f.x + f.w * (0.2 + 0.2 * i), f.y + f.h * (i % 2 ? 0.35 : 0.65), Math.min(f.w, f.h) * 0.18, 0, TAU); ctx.fill(); }
      break;
    case 'roofpool':
      ctx.fillStyle = '#eee'; ctx.fillRect(f.x - 2, f.y - 2, f.w + 4, f.h + 4);
      ctx.fillStyle = lit([60, 200, 230], amb, 1); ctx.fillRect(f.x, f.y, f.w, f.h);
      break;
    case 'awning':
      for (let x = 0; x < f.w; x += 12) { ctx.fillStyle = (x / 12) % 2 ? lit([255, 255, 255], amb) : lit([220, 60, 140], amb); ctx.fillRect(f.x + x, f.y, 12, f.h); }
      break;
  }
}

function drawCrane(ctx, c, amb, t) {
  const H = c.height;
  const legs = [[c.x + 4, c.y + 4], [c.x + c.w - 4, c.y + 4], [c.x + 4, c.y + c.h - 4], [c.x + c.w - 4, c.y + c.h - 4]];
  ctx.strokeStyle = lit(c.color, amb, 0.8); ctx.lineWidth = 4;
  ctx.beginPath();
  for (const [x, y] of legs) { const p = project(x, y, H); ctx.moveTo(x, y); ctx.lineTo(p[0], p[1]); }
  ctx.stroke();
  // boom across the top, reaching out over the water
  const y = c.y + c.h / 2;
  const a = project(c.x - 30, y, H + 8), b = project(c.x + c.w + 160, y, H + 8);
  ctx.strokeStyle = lit(c.color, amb, 1); ctx.lineWidth = 10;
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  ctx.strokeStyle = lit([40, 40, 40], amb); ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 0; k < 14; k++) { const p0 = project(c.x - 30 + k * 20, y - 5, H + 8), p1 = project(c.x - 20 + k * 20, y + 5, H + 8); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); }
  ctx.stroke();
  const cab = project(c.x + c.w / 2 + Math.sin(t * 0.2 + c.y) * 60, y, H + 10);
  ctx.fillStyle = lit([60, 60, 66], amb); ctx.fillRect(cab[0] - 9, cab[1] - 9, 18, 18);
}

function drawTree(ctx, tr, amb, t) {
  const h = tr.kind === 'palm' ? 34 : 24;
  const [px, py] = project(tr.x, tr.y, h);
  const sway = Math.sin(t * 1.3 + tr.seed) * 1.2;
  if (tr.kind === 'palm') {
    ctx.strokeStyle = lit([120, 90, 60], amb); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(tr.x, tr.y); ctx.lineTo(px, py); ctx.stroke();
    ctx.fillStyle = lit([54, 128, 62], amb);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + tr.seed + sway * 0.05;
      ctx.save(); ctx.translate(px, py); ctx.rotate(a);
      ctx.beginPath(); ctx.ellipse(tr.r * 0.55, 0, tr.r * 0.6, tr.r * 0.17, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = lit([90, 160, 70], amb);
    ctx.beginPath(); ctx.arc(px, py, 3.5, 0, TAU); ctx.fill();
  } else {
    ctx.fillStyle = lit([46, 96, 46], amb);
    ctx.beginPath(); ctx.arc(px + sway, py, tr.r, 0, TAU); ctx.fill();
    ctx.fillStyle = lit([70, 128, 58], amb);
    ctx.beginPath(); ctx.arc(px + sway - tr.r * 0.25, py - tr.r * 0.25, tr.r * 0.65, 0, TAU); ctx.fill();
    ctx.fillStyle = lit([110, 160, 80], amb, 1, 0.6);
    ctx.beginPath(); ctx.arc(px + sway - tr.r * 0.38, py - tr.r * 0.4, tr.r * 0.28, 0, TAU); ctx.fill();
  }
}

/** Animated fountains (drawn on the ground layer, after chunks). */
export function drawFountains(ctx, blocks, t) {
  const amb = G.light.amb;
  for (const blk of blocks) for (const f of blk.fountains) {
    ctx.strokeStyle = lit([220, 245, 255], amb, 1, 0.6); ctx.lineWidth = 1.5;
    for (let r = 0; r < 3; r++) {
      const rr = ((t * 12 + r * 6) % 18) / 18;
      ctx.globalAlpha = 1 - rr;
      ctx.beginPath(); ctx.arc(f.x, f.y, 3 + rr * (f.r + 4), 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = lit([235, 250, 255], amb);
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * TAU + t, d = (Math.sin(t * 5 + i) * 0.5 + 0.5) * f.r * 0.7;
      ctx.fillRect(f.x + Math.cos(a) * d - 1, f.y + Math.sin(a) * d - 1, 2, 2);
    }
  }
}

/** Draw trees + buildings + cranes for the view, far-to-near so near walls overlap far ones. */
export function drawStructures(ctx, view, buildings, trees, t) {
  const amb = G.light.amb, night = G.light.night;
  const cx = pcx, cy = pcy;
  for (const tr of trees) drawTree(ctx, tr, amb, t);
  const list = buildings.map((b) => {
    const nx = cx < b.x ? b.x : cx > b.x + b.w ? b.x + b.w : cx;
    const ny = cy < b.y ? b.y : cy > b.y + b.h ? b.y + b.h : cy;
    return { b, d: (nx - cx) ** 2 + (ny - cy) ** 2 - b.height * 0.01 };
  });
  list.sort((p, q) => q.d - p.d);
  for (const { b } of list) {
    if (cy < b.y) drawFace(ctx, b, b.x, b.y, b.x + b.w, b.y, 'n', amb, night);
    if (cy > b.y + b.h) drawFace(ctx, b, b.x + b.w, b.y + b.h, b.x, b.y + b.h, 's', amb, night);
    if (cx < b.x) drawFace(ctx, b, b.x, b.y + b.h, b.x, b.y, 'w', amb, night);
    if (cx > b.x + b.w) drawFace(ctx, b, b.x + b.w, b.y, b.x + b.w, b.y + b.h, 'e', amb, night);
    drawRoof(ctx, b, amb, night, t);
  }
  for (const c of G.city.cranes) if (c.x < view.x1 + 300 && c.x > view.x0 - 300 && c.y < view.y1 + 300 && c.y > view.y0 - 300) drawCrane(ctx, c, amb, t);
}

/** Visible-set culling (buildings expand with their lean). */
export function visibleStructures(view) {
  const m = 380;
  const bs = [], ts = [];
  for (const b of G.city.buildings) if (b.x < view.x1 + m && b.x + b.w > view.x0 - m && b.y < view.y1 + m && b.y + b.h > view.y0 - m) bs.push(b);
  for (const t of G.city.trees) if (t.x < view.x1 + 40 && t.x > view.x0 - 40 && t.y < view.y1 + 40 && t.y > view.y0 - 40) ts.push(t);
  return { bs, ts };
}

export { rgb };
