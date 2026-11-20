// Turns city data into GPU geometry: static chunk meshes (2x2 blocks each, frustum-culled),
// a coast mesh (promenade, beach, quay, piers, cranes, boats) and instanced prop batches.
import { createMesh } from '../engine/gl.js';
import { MeshBuilder, MAT } from '../engine/mesh-builder.js';
import { InstanceBatch } from '../engine/instancing.js';
import { CELL, ROAD, NB, CITY, LAND, PIERS, CURB, SHORE_Z, SHOP_NAMES, BRANDS, beachHeight } from './city.js';
import { hash, RNG } from '../core/math.js';
import { drawOrchid, BRAND_SLOGANS } from './signs.js';
import * as Props from './props.js';

const ASPHALT = [0.15, 0.155, 0.17], LINE = [0.85, 0.83, 0.74], YELLOW = [0.92, 0.72, 0.15];
const SIDEWALK_C = [0.6, 0.58, 0.55], CURB_C = [0.72, 0.7, 0.66];
const CHUNK = 2 * CELL;

export function buildCityMeshes(gl, city, atlas) {
  const nC = Math.ceil(NB / 2);
  const builders = [];
  for (let i = 0; i < nC * nC; i++) builders.push({ mb: new MeshBuilder(), maxH: 1 });
  const chunkOf = (x, z) => {
    const ci = Math.max(0, Math.min(nC - 1, Math.floor(x / CHUNK))), cj = Math.max(0, Math.min(nC - 1, Math.floor(z / CHUNK)));
    return builders[cj * nC + ci];
  };
  // roads: one asphalt slab per chunk + markings per edge
  for (let cj = 0; cj < nC; cj++) for (let ci = 0; ci < nC; ci++) {
    const x0 = ci * CHUNK, z0 = cj * CHUNK, x1 = ci === nC - 1 ? CITY : x0 + CHUNK, z1 = cj === nC - 1 ? CITY : z0 + CHUNK;
    builders[cj * nC + ci].mb.flat(x0, z0, x1, z1, 0, ASPHALT, MAT.ROAD);
  }
  for (let j = 0; j <= NB; j++) for (let i = 0; i < NB; i++) {
    roadEdge(chunkOf(i * CELL + CELL / 2, j * CELL).mb, i * CELL + ROAD, j * CELL, true, i, j);
    roadEdge(chunkOf(j * CELL, i * CELL + CELL / 2).mb, j * CELL, i * CELL + ROAD, false, j, i);
  }
  for (const blk of city.blocks) blockGround(chunkOf(blk.x + 1, blk.z + 1).mb, blk);
  for (const b of city.buildings) { const ch = chunkOf(b.x + b.w / 2, b.z + b.d / 2); building(ch.mb, b, atlas); ch.maxH = Math.max(ch.maxH, b.y0 + b.h + 30); }
  for (const c of city.containers) container(chunkOf(c.x, c.z).mb, c);
  for (const blk of city.blocks) for (const bb of blk.billboards) billboard(chunkOf(blk.x + 1, blk.z + 1), blk, bb, atlas);

  const statics = [];
  for (let cj = 0; cj < nC; cj++) for (let ci = 0; ci < nC; ci++) {
    const b = builders[cj * nC + ci];
    if (!b.mb.vertexCount) continue;
    const x0 = ci * CHUNK - 30, z0 = cj * CHUNK - 30;
    statics.push({ mesh: createMesh(gl, b.mb.toArray()), aabb: [x0, -1, z0, x0 + CHUNK + 60, b.maxH + 40, z0 + CHUNK + 60] });
  }
  const coast = coastMesh(city);
  statics.push({ mesh: createMesh(gl, coast.toArray()), aabb: [LAND.x0 - 200, -5, LAND.z0 - 200, LAND.x1 + 250, 60, LAND.z1 + 200] });
  return { statics, batches: buildPropBatches(gl, city) };
}

// ---------------------------------------------------------------------------
function roadEdge(m, x, z, horiz, a, b) {
  const L = CELL - ROAD, y = 0.02;
  const R = (x0, z0, x1, z1, c = LINE) => horiz ? m.flat(x + x0, z + z0, x + x1, z + z1, y, c) : m.flat(x + z0, z + x0, x + z1, z + x1, y, c);
  // centre dashes (yellow) and edge lines
  for (let t = 6; t < L - 6; t += 6) R(t, ROAD / 2 - 0.08, t + 3, ROAD / 2 + 0.08, YELLOW);
  R(5, 0.6, L - 5, 0.75); R(5, ROAD - 0.75, L - 5, ROAD - 0.6);
  // zebra crossings + stop lines at both ends
  for (const e of [0.6, L - 4.2]) for (let s = 0.9; s < ROAD - 0.9; s += 1.2) R(e, s, e + 3.6, s + 0.6);
  R(4.6, ROAD / 2, 5.1, ROAD - 0.6); R(L - 5.1, 0.6, L - 4.6, ROAD / 2);
  // manhole
  if (hash(a, b, 5) < 0.7) {
    const t = 12 + hash(a, b, 6) * (L - 24);
    const cx = horiz ? x + t : x + ROAD / 2 + 3.3, cz = horiz ? z + ROAD / 2 + 3.3 : z + t;
    m.cylinder(cx, 0, cz, 0.45, 0.025, [0.1, 0.1, 0.11], { seg: 8 });
  }
}

function blockGround(m, blk) {
  m.box(blk.x, 0, blk.z, blk.x + blk.w, CURB, blk.z + blk.d, CURB_C, { topColor: SIDEWALK_C });
  const L = blk.lot, y = CURB + 0.01;
  const G = {
    plaza: [0.66, 0.62, 0.56], paved: [0.5, 0.48, 0.45], garden: [0.32, 0.5, 0.22], concrete: [0.46, 0.46, 0.44], resort: [0.82, 0.76, 0.64], park: [0.3, 0.52, 0.22],
  }[blk.ground] || [0.5, 0.5, 0.5];
  const gm = blk.ground === 'garden' || blk.ground === 'park' ? MAT.GRASS : 0;
  m.flat(L.x, L.z, L.x + L.w, L.z + L.d, y, G, gm);
  if (blk.ground === 'plaza') for (let t = 6; t < L.w; t += 6) { m.flat(L.x + t, L.z, L.x + t + 0.12, L.z + L.d, y + 0.005, [0.56, 0.52, 0.46]); m.flat(L.x, L.z + t, L.x + L.w, L.z + t + 0.12, y + 0.005, [0.56, 0.52, 0.46]); }
  if (blk.ground === 'concrete') { m.flat(L.x + 1, L.z + 1, L.x + L.w - 1, L.z + 1.25, y + 0.005, YELLOW); m.flat(L.x + 1, L.z + L.d - 1.25, L.x + L.w - 1, L.z + L.d - 1, y + 0.005, YELLOW); }
  if (blk.ground === 'park') {
    m.flat(L.x, L.z + L.d / 2 - 1.5, L.x + L.w, L.z + L.d / 2 + 1.5, y + 0.005, [0.74, 0.68, 0.52]);
    m.flat(L.x + L.w / 2 - 1.5, L.z, L.x + L.w / 2 + 1.5, L.z + L.d, y + 0.006, [0.74, 0.68, 0.52]);
    const p = blk.pond;
    ellipse(m, p.x, p.z, p.rx + 1.2, p.rz + 1.2, y + 0.01, [0.6, 0.56, 0.46], 0);
    ellipse(m, p.x, p.z, p.rx, p.rz, y + 0.02, [0.2, 0.5, 0.6], MAT.WATER_POOL);
  }
  if (blk.ground === 'garden') for (const lot of blk.lots) m.flat(lot.x + lot.w / 2 - 1.6, lot.z, lot.x + lot.w / 2 + 1.6, lot.z + lot.d, y + 0.004, [0.62, 0.6, 0.56]);
  for (const p of blk.pools) {
    m.box(p.x - 0.5, CURB, p.z - 0.5, p.x + p.w + 0.5, CURB + 0.2, p.z + p.d + 0.5, [0.92, 0.92, 0.9]);
    m.flat(p.x, p.z, p.x + p.w, p.z + p.d, CURB + 0.21, [0.2, 0.6, 0.7], MAT.WATER_POOL);
  }
  for (const f of blk.fences) fence(m, f);
  for (const f of blk.fountains) {
    if (!f.inPond) { m.cylinder(f.x, CURB, f.z, f.r + 0.6, 0.6, [0.8, 0.78, 0.74], { seg: 12 }); m.cylinder(f.x, CURB, f.z, f.r, 0.62, [0.3, 0.6, 0.7], { seg: 12, mat: MAT.WATER_POOL }); }
    m.cylinder(f.x, CURB, f.z, 0.35, 2.2, [0.8, 0.78, 0.74], { seg: 8 });
  }
}

function ellipse(m, cx, cz, rx, rz, y, c, mat) {
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
    m.vert(cx, y, cz, 0, 1, 0, c, 0, mat); m.vert(cx + Math.cos(a1) * rx, y, cz + Math.sin(a1) * rz, 0, 1, 0, c, 0, mat); m.vert(cx + Math.cos(a0) * rx, y, cz + Math.sin(a0) * rz, 0, 1, 0, c, 0, mat);
  }
}

function fence(m, f) {
  const c = [0.92, 0.9, 0.86], h = 1.0, t = 0.08, y = CURB;
  m.box(f.x, y, f.z, f.x + f.w, y + h, f.z + t, c);
  m.box(f.x, y, f.z, f.x + t, y + h, f.z + f.d, c);
  m.box(f.x + f.w - t, y, f.z, f.x + f.w, y + h, f.z + f.d, c);
  m.box(f.x, y, f.z + f.d - t, f.x + f.w / 2 - 2, y + h, f.z + f.d, c);
  m.box(f.x + f.w / 2 + 2, y, f.z + f.d - t, f.x + f.w, y + h, f.z + f.d, c);
}

function container(m, c) {
  m.box(c.x, c.y, c.z, c.x + c.w, c.y + c.h - 0.02, c.z + c.d, c.color, { topColor: c.color.map((v) => v * 0.9) });
  const dark = c.color.map((v) => v * 0.7);
  if (c.w > c.d) for (let t = 0.6; t < c.w; t += 0.9) { m.box(c.x + t, c.y, c.z - 0.03, c.x + t + 0.12, c.y + c.h - 0.05, c.z, dark, { top: false }); m.box(c.x + t, c.y, c.z + c.d, c.x + t + 0.12, c.y + c.h - 0.05, c.z + c.d + 0.03, dark, { top: false }); }
  else for (let t = 0.6; t < c.d; t += 0.9) { m.box(c.x - 0.03, c.y, c.z + t, c.x, c.y + c.h - 0.05, c.z + t + 0.12, dark, { top: false }); m.box(c.x + c.w, c.y, c.z + t, c.x + c.w + 0.03, c.y + c.h - 0.05, c.z + t + 0.12, dark, { top: false }); }
}

/** A building: walls (procedural windows), parapet, roof, shopfronts, balconies, roof features, labels. */
function building(m, b, atlas) {
  const x0 = b.x, z0 = b.z, x1 = b.x + b.w, z1 = b.z + b.d, y0 = b.y0, y1 = b.y0 + b.h;
  const windowed = b.kind === 'tower' || b.kind === 'midrise' || b.kind === 'hotel' || b.kind === 'podium';
  const wallMat = windowed ? MAT.WINDOWS + (b.seed * 0.9) : 0;
  if (b.gable) {
    m.box(x0, y0, z0, x1, y1, z1, b.wall, { top: false });
    // simple windows + door for houses
    const glass = [0.15, 0.2, 0.26];
    for (let k = 0; k < 2; k++) {
      const fx = x0 + b.w * (0.25 + 0.5 * k);
      m.box(fx - 0.7, y0 + 1.0, z1, fx + 0.7, y0 + 2.2, z1 + 0.04, glass, { mat: MAT.NEON, e: 0.5 });
      if (b.h > 4) m.box(fx - 0.7, y0 + 4.0, z1, fx + 0.7, y0 + 5.2, z1 + 0.04, glass, { mat: MAT.NEON, e: 0.4 });
    }
    m.box(x0 + b.w / 2 - 0.55, y0, z1, x0 + b.w / 2 + 0.55, y0 + 2.1, z1 + 0.06, [0.4, 0.25, 0.15]);
    m.gable(x0, z0, x1, z1, y1, Math.min(b.w, b.d) * 0.35, b.roof, b.ridgeX, 0.5);
    labelSign(m, b, atlas);
    return;
  }
  m.box(x0, y0, z0, x1, y1, z1, b.wall, { mat: wallMat, topColor: b.roof, topMat: 0 });
  // parapet
  const pc = b.wall.map((v) => v * 0.85), ph = 0.9, t = 0.35;
  if (b.h > 6) {
    m.box(x0, y1, z0, x1, y1 + ph, z0 + t, pc); m.box(x0, y1, z1 - t, x1, y1 + ph, z1, pc);
    m.box(x0, y1, z0, x0 + t, y1 + ph, z1, pc); m.box(x1 - t, y1, z0, x1, y1 + ph, z1, pc);
  }
  if (b.kind === 'warehouse' || b.ribs) {
    const rc = b.wall.map((v) => v * 0.78);
    for (let x = x0 + 1.5; x < x1 - 1; x += 3) { m.box(x, y0, z1, x + 0.2, y1, z1 + 0.12, rc, { top: false }); m.box(x, y0, z0 - 0.12, x + 0.2, y1, z0, rc, { top: false }); }
    if (b.rollers) for (let k = 0; k < 3; k++) { const cx = x0 + b.w * (0.22 + 0.28 * k); m.box(cx - 2.2, y0, z1 + 0.05, cx + 2.2, y0 + 4.4, z1 + 0.2, [0.55, 0.57, 0.6]); for (let yy = 0.3; yy < 4.4; yy += 0.35) m.box(cx - 2.2, y0 + yy, z1 + 0.2, cx + 2.2, y0 + yy + 0.06, z1 + 0.24, [0.42, 0.44, 0.47], { top: false }); }
  }
  if (b.columns) for (let x = x0 + 2; x < x1 - 1; x += 4.5) m.cylinder(x + 0.5, y0, z1 + 1.2, 0.55, 10, [0.9, 0.86, 0.76], { seg: 8 });
  // ground floor shopfronts with awnings and signs (on the facade facing the street)
  if (b.shops || b.kind === 'podium' || (b.kind === 'tower' && y0 <= CURB + 0.01)) shopfronts(m, b, atlas);
  if (b.balconies) balconies(m, b);
  for (const f of b.features) roofFeature(m, f, b, atlas);
  // neon roof trim on landmarks
  if (b.landmark && b.neon) {
    const e = 2.5, ny = y1 + (b.h > 6 ? ph : 0) + 0.05, nt = 0.18;
    m.box(x0, ny, z0, x1, ny + nt, z0 + nt, b.neon, { mat: MAT.NEON, e }); m.box(x0, ny, z1 - nt, x1, ny + nt, z1, b.neon, { mat: MAT.NEON, e });
    m.box(x0, ny, z0, x0 + nt, ny + nt, z1, b.neon, { mat: MAT.NEON, e }); m.box(x1 - nt, ny, z0, x1, ny + nt, z1, b.neon, { mat: MAT.NEON, e });
  }
  labelSign(m, b, atlas);
}

function labelSign(m, b, atlas) {
  if (!b.label) return;
  const uv = atlas.text('lm-' + b.label, b.label, { fg: '#fff', bg: '#141018', glow: '#' + b.neon.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join(''), border: '#' + b.neon.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('') });
  const w = Math.min(b.w * 0.8, 22), h = w / 4;
  const y = b.landmark === 'tower' ? b.y0 - 10 : Math.min(b.y0 + b.h - h - 1, b.gable ? b.y0 + 2.6 : 5.2);
  m.sign(b.x + b.w / 2, b.gable ? b.y0 + b.h + 0.3 : y, b.z + b.d + 0.32, w, h, 's', uv, 2.2);
}

function shopfronts(m, b, atlas) {
  const sides = b.facing === 'n' ? ['n'] : b.facing === 's' ? ['s'] : ['s', 'n'];
  const rng = new RNG(Math.floor(b.seed * 1e6));
  for (const side of sides) {
    const z = side === 's' ? b.z + b.d : b.z, dir = side === 's' ? 1 : -1;
    const n = Math.max(1, Math.floor(b.w / 9));
    const sw = b.w / n;
    for (let k = 0; k < n; k++) {
      const x0 = b.x + k * sw + 0.4, x1 = b.x + (k + 1) * sw - 0.4;
      const warm = rng.pick([[1, 0.8, 0.55], [0.7, 0.9, 1], [1, 0.65, 0.8]]);
      m.box(x0, b.y0 + 0.4, Math.min(z, z + dir * 0.06), x1, b.y0 + 3.3, Math.max(z, z + dir * 0.06), warm.map((v) => v * 0.35), { mat: MAT.NEON, e: 1.1 });
      const aw = rng.pick([[0.86, 0.24, 0.47], [0.16, 0.7, 0.66], [0.98, 0.75, 0.16], [0.9, 0.35, 0.16], [0.3, 0.47, 0.86]]);
      const az0 = side === 's' ? z : z - 1.6, az1 = side === 's' ? z + 1.6 : z;
      m.box(x0, b.y0 + 3.4, az0, x1, b.y0 + 3.6, az1, aw);
      if (rng.chance(0.75)) {
        const name = SHOP_NAMES[rng.int(0, SHOP_NAMES.length - 1)];
        const colors = ['#ff5ca8', '#2ff3e0', '#ffd23f', '#ff8c42', '#9dff4d'];
        const col = colors[rng.int(0, colors.length - 1)];
        const uv = atlas.text('shop-' + name + col, name, { fg: col, bg: '#0d0b12', glow: col });
        m.sign((x0 + x1) / 2, b.y0 + 3.65, z + dir * 0.12, Math.min(sw - 1.2, 7), Math.min(sw - 1.2, 7) / 4, side, uv, 1.8);
      }
    }
  }
}

function balconies(m, b) {
  const floors = Math.floor(b.h / 3.4);
  const c = [0.92, 0.9, 0.86];
  for (let f = 2; f < floors; f++) {
    const y = b.y0 + f * 3.4 + 0.2;
    for (let x = b.x + 1.5; x < b.x + b.w - 4; x += 5.4) {
      m.box(x, y, b.z + b.d, x + 3.6, y + 0.15, b.z + b.d + 1.1, c);
      m.box(x, y + 0.15, b.z + b.d + 1.0, x + 3.6, y + 1.0, b.z + b.d + 1.1, [0.5, 0.65, 0.72], { mat: MAT.GLASS });
    }
  }
}

function roofFeature(m, f, b, atlas) {
  const y = f.y;
  switch (f.type) {
    case 'ac': m.box(f.x - f.s / 2, y, f.z - f.s / 2, f.x + f.s / 2, y + f.s * 0.6, f.z + f.s / 2, [0.62, 0.64, 0.66]); m.cylinder(f.x, y + f.s * 0.6, f.z, f.s * 0.3, 0.05, [0.2, 0.2, 0.22], { seg: 8 }); break;
    case 'tank': m.cylinder(f.x, y, f.z, f.r, 0.6, [0.3, 0.3, 0.32], { seg: 8 }); m.cylinder(f.x, y + 0.6, f.z, f.r, f.r * 2, [0.24, 0.45, 0.68], { seg: 10 }); break;
    case 'antenna':
      m.cylinder(f.x, y, f.z, 0.12, f.h, [0.7, 0.7, 0.72], { seg: 5 });
      m.box(f.x - 0.25, y + f.h, f.z - 0.25, f.x + 0.25, y + f.h + 0.5, f.z + 0.25, [1, 0.1, 0.1], { mat: MAT.NEON, e: 4 });
      break;
    case 'helipad':
      m.cylinder(f.x, y, f.z, f.r, 0.12, [0.2, 0.21, 0.23], { seg: 20 });
      m.cylinder(f.x, y, f.z, f.r * 0.86, 0.14, [0.85, 0.7, 0.15], { seg: 20 });
      m.cylinder(f.x, y, f.z, f.r * 0.78, 0.16, [0.2, 0.21, 0.23], { seg: 20 });
      if (f.cross) { m.box(f.x - f.r * 0.15, y + 0.17, f.z - f.r * 0.5, f.x + f.r * 0.15, y + 0.19, f.z + f.r * 0.5, [0.9, 0.12, 0.15]); m.box(f.x - f.r * 0.5, y + 0.17, f.z - f.r * 0.15, f.x + f.r * 0.5, y + 0.19, f.z + f.r * 0.15, [0.9, 0.12, 0.15]); }
      else { const s = f.r * 0.45; m.box(f.x - s, y + 0.17, f.z - s, f.x - s * 0.6, y + 0.19, f.z + s, [0.95, 0.95, 0.95]); m.box(f.x + s * 0.6, y + 0.17, f.z - s, f.x + s, y + 0.19, f.z + s, [0.95, 0.95, 0.95]); m.box(f.x - s, y + 0.17, f.z - s * 0.15, f.x + s, y + 0.19, f.z + s * 0.15, [0.95, 0.95, 0.95]); }
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; m.box(f.x + Math.cos(a) * f.r - 0.15, y + 0.12, f.z + Math.sin(a) * f.r - 0.15, f.x + Math.cos(a) * f.r + 0.15, y + 0.3, f.z + Math.sin(a) * f.r + 0.15, [0.3, 1, 0.4], { mat: MAT.NEON, e: 3 }); }
      break;
    case 'garden':
      m.box(f.x, y, f.z, f.x + f.w, y + 0.4, f.z + f.d, [0.4, 0.35, 0.3], { topColor: [0.3, 0.5, 0.22], topMat: MAT.GRASS });
      for (let i = 0; i < 4; i++) m.sphere(f.x + f.w * (0.2 + 0.2 * i), y + 1.0, f.z + f.d * (i % 2 ? 0.3 : 0.7), 0.9, [0.2, 0.45, 0.2], { seg: 5, rings: 3 });
      break;
    case 'pool': m.box(f.x, y, f.z, f.x + f.w, y + 0.35, f.z + f.d, [0.9, 0.9, 0.88]); m.flat(f.x + 0.4, f.z + 0.4, f.x + f.w - 0.4, f.z + f.d - 0.4, y + 0.36, [0.2, 0.6, 0.7], MAT.WATER_POOL); break;
    case 'solar':
      for (let r = 0; r < 3; r++) for (let x = f.x; x < f.x + f.w - 1.5; x += 2) {
        const zz = f.z + r * (f.d / 3);
        m.quad([x, y + 0.4, zz + 1.6], [x + 1.8, y + 0.4, zz + 1.6], [x + 1.8, y + 1.0, zz], [x, y + 1.0, zz], [0, 0.94, 0.35], [0.08, 0.14, 0.3], 0, MAT.GLASS);
      }
      break;
    case 'dome': m.sphere(f.x, y, f.z, f.r, [0.85, 0.7, 0.35], { seg: 12, rings: 6, sy: 0.7 }); break;
    case 'orchid': {
      const uv = atlas.emblem('orchid', drawOrchid);
      const s = f.r * 2, cy = y + 2;
      m.box(f.x - f.r * 0.6, y, f.z - f.r * 0.6, f.x + f.r * 0.6, y + 2, f.z + f.r * 0.6, [0.2, 0.12, 0.28]);
      for (const side of ['s', 'n', 'e', 'w']) {
        const off = f.r * 0.62;
        const cx = side === 'e' ? f.x + off : side === 'w' ? f.x - off : f.x;
        const cz = side === 's' ? f.z + off : side === 'n' ? f.z - off : f.z;
        m.sign(cx, cy, cz, s, s, side, uv, 3.2);
      }
      m.sign(f.x, y + 2.05, f.z, s * 1.2, s * 1.2, 'up', uv, 3.2);
      break;
    }
  }
}

function billboard(chunk, blk, bb, atlas) {
  const tallest = blk.buildings.reduce((a, b) => (b.y0 + b.h > (a ? a.y0 + a.h : 0) ? b : a), null);
  if (!tallest) return;
  const m = chunk.mb;
  const brand = BRANDS[bb.brand];
  const [slogan, colors] = BRAND_SLOGANS[brand];
  const uv = atlas.billboard('bb-' + brand, brand, slogan, colors);
  const y = tallest.y0 + tallest.h + 1, w = Math.min(tallest.w - 2, 20), h = w / 2;
  const cx = tallest.x + tallest.w / 2, cz = tallest.z + tallest.d / 2;
  m.box(cx - 0.2, y, cz - 0.2, cx + 0.2, y + 2, cz + 0.2, [0.2, 0.2, 0.22]);
  m.box(cx - w / 2 - 0.3, y + 2, cz - 0.3, cx + w / 2 + 0.3, y + 2 + h + 0.4, cz + 0.3, [0.15, 0.15, 0.17]);
  m.sign(cx, y + 2.2, cz + 0.32, w, h, 's', uv, 2.4);
  m.sign(cx, y + 2.2, cz - 0.32, w, h, 'n', uv, 2.4);
  chunk.maxH = Math.max(chunk.maxH, y + h + 5);
}

// ---------------------------------------------------------------------------
function coastMesh(city) {
  const m = new MeshBuilder();
  const y = CURB;
  const prom = [0.58, 0.55, 0.5], quay = [0.45, 0.46, 0.45], wall = [0.38, 0.38, 0.36];
  // promenade ring north + west, quay east
  m.box(LAND.x0, -4, LAND.z0, LAND.x1, y, 0, wall, { topColor: prom });
  m.box(LAND.x0, -4, 0, 0, y, CITY + 6, wall, { topColor: prom });
  m.box(CITY, -4, 0, LAND.x1, y, CITY + 6, wall, { topColor: quay });
  m.flat(LAND.x1 - 1.2, 0, LAND.x1 - 0.8, CITY + 6, y + 0.01, YELLOW);
  for (let z = 10; z < CITY; z += 14) m.cylinder(LAND.x1 - 2, y, z, 0.3, 0.6, [0.15, 0.15, 0.15], { seg: 6 });
  for (let x = LAND.x0 + 2; x < LAND.x1; x += 3) m.box(x, y, LAND.z0 + 0.3, x + 0.1, y + 1.1, LAND.z0 + 0.4, [0.85, 0.85, 0.82]);
  m.box(LAND.x0, y + 1.0, LAND.z0 + 0.25, LAND.x1, y + 1.1, LAND.z0 + 0.45, [0.85, 0.85, 0.82]);
  // beach: sloped sand from the boardwalk into the sea
  const z0 = CITY + 6, z1 = LAND.z1 + 12;
  const sand = [0.86, 0.76, 0.52], wet = [0.62, 0.52, 0.34];
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const za = z0 + (z1 - z0) * i / steps, zb = z0 + (z1 - z0) * (i + 1) / steps;
    const c = i < steps - 5 ? sand : wet;
    m.quad([LAND.x0, beachHeight(zb), zb], [LAND.x1, beachHeight(zb), zb], [LAND.x1, beachHeight(za), za], [LAND.x0, beachHeight(za), za], [0, 0.995, -0.08], c, 0, MAT.SAND);
  }
  m.box(LAND.x0, -4, z0, LAND.x0 + 0.1, y, z1, wall); m.box(LAND.x1 - 0.1, -4, z0, LAND.x1, y, z1, wall);
  m.box(LAND.x0, -0.2, CITY, LAND.x1, y, z0, wall, { topColor: prom });
  // boardwalk
  m.box(LAND.x0, y, CITY + 6, LAND.x1, y + 0.18, CITY + 12, [0.42, 0.3, 0.2], { topColor: [0.55, 0.4, 0.26] });
  for (let x = LAND.x0; x < LAND.x1; x += 1.2) m.flat(x, CITY + 6, x + 0.06, CITY + 12, y + 0.19, [0.36, 0.25, 0.16]);
  // piers
  for (const p of PIERS) {
    m.box(p.x, p.deck - 0.25, p.z, p.x + p.w, p.deck, p.z + p.d, [0.42, 0.3, 0.2], { topColor: [0.56, 0.42, 0.28] });
    const long = p.d > p.w;
    for (let t = 0; t < (long ? p.d : p.w); t += 4) {
      for (const s of [0.3, (long ? p.w : p.d) - 0.3]) {
        const px = long ? p.x + s : p.x + t, pz = long ? p.z + t : p.z + s;
        m.cylinder(px, -3, pz, 0.22, p.deck + 0.8, [0.3, 0.22, 0.15], { seg: 6 });
      }
    }
    // rails
    if (long) { m.box(p.x, p.deck, p.z, p.x + 0.1, p.deck + 1.0, p.z + p.d, [0.5, 0.38, 0.25]); m.box(p.x + p.w - 0.1, p.deck, p.z, p.x + p.w, p.deck + 1.0, p.z + p.d, [0.5, 0.38, 0.25]); }
  }
  // ramp from the quay onto the east pier
  const ep = PIERS[1];
  m.quad([ep.x - 8, y, ep.z + ep.d], [ep.x, ep.deck, ep.z + ep.d], [ep.x, ep.deck, ep.z], [ep.x - 8, y, ep.z], [-0.1, 0.99, 0], [0.5, 0.48, 0.46]);
  // gantry cranes
  for (const c of city.cranes) {
    const col = c.color;
    for (const [dx, dz] of [[0, 0], [14, 0], [0, 10], [14, 10]]) m.box(c.x + dx, y, c.z + dz, c.x + dx + 1, y + c.h, c.z + dz + 1, col);
    m.box(c.x - 6, y + c.h, c.z - 0.5, c.x + 48, y + c.h + 2.2, c.z + 11.5, col);
    for (let x = c.x - 4; x < c.x + 46; x += 3) m.box(x, y + c.h + 2.2, c.z + 5, x + 0.3, y + c.h + 4.5, c.z + 5.4, col);
    m.box(c.x + 16, y + c.h - 4, c.z + 2, c.x + 21, y + c.h, c.z + 9, [0.25, 0.27, 0.3]);
    m.box(c.x + 17, y + c.h - 3, c.z + 8.9, c.x + 20, y + c.h - 1.2, c.z + 9.05, [0.9, 0.8, 0.5], { mat: MAT.NEON, e: 1.5 });
    m.box(c.x + 47, y + c.h + 2.2, c.z + 5, c.x + 47.6, y + c.h + 2.8, c.z + 5.6, [1, 0.1, 0.1], { mat: MAT.NEON, e: 1.5 });
  }
  // moored boats
  for (const b of city.boats) boat(m, b);
  return m;
}

function boat(m, b) {
  const s = b.s, L = 9 * s, W = 3 * s;
  const ca = Math.cos(b.a), sa = Math.sin(b.a);
  const P = (lx, ly, lz) => [b.x + lx * ca - lz * sa, ly, b.z + lx * sa + lz * ca];
  const hull = b.id === 'escape' ? [0.1, 0.09, 0.12] : [0.92, 0.92, 0.9];
  const pts = [[-L / 2, -W / 2], [L / 3, -W / 2], [L / 2, 0], [L / 3, W / 2], [-L / 2, W / 2]];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    m.quad(P(a[0], -0.6, a[1]), P(c[0], -0.6, c[1]), P(c[0], 0.7, c[1]), P(a[0], 0.7, a[1]), [0, 0, 0], hull);
  }
  m.quad(P(-L / 2, 0.7, W / 2), P(L / 3, 0.7, W / 2), P(L / 3, 0.7, -W / 2), P(-L / 2, 0.7, -W / 2), [0, 1, 0], [0.62, 0.48, 0.32]);
  m.tri(P(L / 3, 0.7, -W / 2), P(L / 3, 0.7, W / 2), P(L / 2, 0.7, 0), [0.62, 0.48, 0.32]);
  // cabin
  const cc = b.color;
  const q = (lx0, lz0, lx1, lz1, y0, y1, c, mat = 0) => {
    const corners = [P(lx0, 0, lz0), P(lx1, 0, lz0), P(lx1, 0, lz1), P(lx0, 0, lz1)];
    for (let i = 0; i < 4; i++) { const a = corners[i], d = corners[(i + 1) % 4]; m.quad([a[0], y0, a[2]], [d[0], y0, d[2]], [d[0], y1, d[2]], [a[0], y1, a[2]], [0, 0, 0], c, 0, mat); }
    m.quad([corners[3][0], y1, corners[3][2]], [corners[2][0], y1, corners[2][2]], [corners[1][0], y1, corners[1][2]], [corners[0][0], y1, corners[0][2]], [0, 1, 0], c, 0, mat);
  };
  q(-L / 4, -W / 3, L / 6, W / 3, 0.7, 2.1, cc);
  q(L / 6 - 0.1, -W / 3 + 0.2, L / 6 + 0.05, W / 3 - 0.2, 1.0, 1.9, [0.2, 0.3, 0.4], MAT.GLASS);
}

// ---------------------------------------------------------------------------
function buildPropBatches(gl, city) {
  const B = (data, opts) => new InstanceBatch(createMesh(gl, data), opts);
  const trees = B(Props.treeMesh(), { name: 'trees' });
  const palms = B(Props.palmMesh(), { name: 'palms' });
  const lamps = B(Props.lampMesh(), { name: 'lamps' });
  const poles = B(Props.trafficPoleMesh(), { name: 'traffic-poles' });
  const signals = B(Props.signalLampMesh(), { name: 'signals', castShadow: false });
  const benches = B(Props.benchMesh(), { name: 'benches' });
  const bins = B(Props.binMesh(), { name: 'bins' });
  const stops = B(Props.busStopMesh(), { name: 'bus-stops' });
  const umbrellas = B(Props.umbrellaMesh(), { name: 'umbrellas' });
  const broken = B(Props.brokenLampMesh(), { name: 'broken-lamps' });
  for (const t of city.trees) {
    const v = 0.85 + hash(Math.floor(t.x * 10), Math.floor(t.z * 10)) * 0.3;
    const yaw = hash(Math.floor(t.z * 7), Math.floor(t.x * 3)) * 6.28;
    const y = t.z > CITY ? Math.max(beachHeightSafe(t.z), CURB) : CURB;
    (t.kind === 'palm' ? palms : trees).push(t.x, y, t.z, yaw, t.s, t.s, t.s, v, v * (0.95 + 0.1 * hash(Math.floor(t.x))), v);
  }
  rebuildLamps(city, lamps, broken);
  for (const b of city.benches) benches.push(b.x, CURB, b.z, b.a);
  for (const b of city.bins) bins.push(b.x, CURB, b.z);
  for (const s of city.busStops) stops.push(s.x, CURB, s.z, s.a);
  for (const u of city.umbrellas) umbrellas.push(u.x, u.z > CITY + 6 ? beachHeightSafe(u.z) : CURB, u.z, 0, 1, 1, 1, u.color[0], u.color[1], u.color[2]);
  // traffic light poles at every intersection corner facing the approaching lane
  city.signals = [];
  for (let j = 0; j <= NB; j++) for (let i = 0; i <= NB; i++) {
    const cx = i * CELL + ROAD / 2, cz = j * CELL + ROAD / 2, o = ROAD / 2 + 1.2;
    // four poles; each serves traffic arriving from one direction (left-hand traffic)
    const defs = [
      { x: cx - o, z: cz - o, yaw: -Math.PI / 2, axis: 'ew', from: 'w' }, { x: cx + o, z: cz + o, yaw: Math.PI / 2, axis: 'ew', from: 'e' },
      { x: cx + o, z: cz - o, yaw: Math.PI, axis: 'ns', from: 'n' }, { x: cx - o, z: cz + o, yaw: 0, axis: 'ns', from: 's' },
    ];
    for (const d of defs) {
      if ((d.from === 'w' && i === 0) || (d.from === 'e' && i === NB) || (d.from === 'n' && j === 0) || (d.from === 's' && j === NB)) continue;
      poles.push(d.x, CURB, d.z, d.yaw);
      city.signals.push({ node: j * (NB + 1) + i, x: d.x, z: d.z, yaw: d.yaw, axis: d.axis });
    }
  }
  return { trees, palms, lamps, poles, signals, benches, bins, stops, umbrellas, broken };
}
const beachHeightSafe = (z) => beachHeight(z);

/** Lamps (standing) and knocked-down lamps — rebuilt when a car breaks one. */
export function rebuildLamps(city, lamps, broken) {
  lamps.clear(); broken.clear();
  for (const l of city.lamps) {
    if (l.broken) broken.push(l.x, CURB, l.z, l.fallYaw ?? l.a);
    else lamps.push(l.x, CURB, l.z, l.a);
  }
}
