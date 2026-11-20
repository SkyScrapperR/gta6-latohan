// Procedural generation of Selara Bay in metres: a 10x10 grid of ~90 m blocks with districts,
// varied building footprints (box, L-shape, podium+tower, stepped setbacks), roof features,
// landmarks, parks, beach, docks, street furniture and hidden Orchid tags.
import { RNG, hash, rgb255 } from '../core/math.js';

export const NB = 10;
export const ROAD = 14;
export const BLOCK = 90;
export const CELL = ROAD + BLOCK;            // 104
export const SIDEWALK = 4;
export const LANE = 3.5;                     // lane centre offset from road centre
export const CURB = 0.15;                    // sidewalk height
export const CITY = NB * CELL + ROAD;        // 1054
export const LAND = { x0: -36, z0: -36, x1: CITY + 48, z1: CITY + 70 };
export const SHORE_Z = CITY + 62;            // where the beach meets the sea
export const PIERS = [
  { id: 'beach', x: 4 * CELL + 2, z: LAND.z1 - 14, w: 10, d: 110, deck: 1.1 },
  { id: 'east', x: LAND.x1 - 6, z: 4 * CELL, w: 130, d: 14, deck: 1.1 },
];

export const DISTRICTS = {
  downtown: { name: 'Kota Lama', sub: 'Downtown', color: '#59c3e8' },
  kemuning: { name: 'Kemuning', sub: 'Midtown', color: '#e89a59' },
  bukit: { name: 'Bukit Asri', sub: 'Residential', color: '#9be86a' },
  docks: { name: 'Pier 9 Docks', sub: 'Harbour', color: '#e8d159' },
  pantai: { name: 'Pantai Selara', sub: 'Beach Row', color: '#ffb0d0' },
  park: { name: 'City Park', sub: 'Green Space', color: '#5fd98a' },
};
export const PARKS = [[1, 2], [4, 6], [7, 4], [2, 8]];

export const LANDMARKS = {
  safehouse: { name: 'Safehouse', bx: 1, by: 4, icon: 'house', color: '#2ff3e0', label: 'SAFEHOUSE' },
  garage: { name: "Lin's Garage", bx: 2, by: 6, icon: 'wrench', color: '#ffb347', label: "LIN'S GARAGE" },
  hospital: { name: 'Selara General Hospital', bx: 7, by: 1, icon: 'cross', color: '#ff4d5e', label: 'SELARA GENERAL' },
  police: { name: 'Selara Police HQ', bx: 2, by: 2, icon: 'badge', color: '#4d8dff', label: 'POLICE HQ' },
  bank: { name: 'Bank Samudra', bx: 5, by: 4, icon: 'bank', color: '#ffd84d', label: 'BANK SAMUDRA' },
  tower: { name: 'Orchid Tower', bx: 4, by: 3, icon: 'orchid', color: '#c45cff', label: 'ORCHID TOWER' },
  freight: { name: 'Orchid Freight', bx: 9, by: 5, icon: 'orchid', color: '#c45cff', label: 'ORCHID FREIGHT' },
  respray: { name: 'Kilat Respray', bx: 7, by: 7, icon: 'spray', color: '#3dff8a', label: 'KILAT RESPRAY' },
  arms: { name: 'Bang Bang Arms', bx: 1, by: 7, icon: 'gun', color: '#ff7a3d', label: 'BANG BANG ARMS' },
  dex: { name: "Dex's Apartment", bx: 6, by: 7, icon: 'laptop', color: '#9dff4d', label: 'DEX' },
  kedai: { name: 'Kedai Orchid', bx: 5, by: 8, icon: 'cup', color: '#ff6fd8', label: 'KEDAI ORCHID' },
};

export const SHOP_NAMES = ['WARUNG OMBAK', 'KOPI SENJA', 'TOKO BINTANG', 'MIE KILAT', 'BATIK NUSA', 'SATE MAWAR', 'APOTEK SEHAT', 'LAUNDRY KILAU',
  'SELULER 88', 'ROTI MENTARI', 'BENGKEL JAYA', 'ES CENDOL', 'SALON AYU', 'TOKO EMAS', 'PIZZA PELANGI', 'NASI LEMAK'];
export const BRANDS = ['OMBAK COLA', 'NUSA MOBILE', 'LUMEN TV', 'BINTANG AIR', 'KOPI SENJA', 'MERAK BANK', 'SURYA ENERGY', 'GECKO RIDE'];

const P = {
  glass: [rgb255(96, 140, 176), rgb255(70, 106, 140), rgb255(120, 150, 170), rgb255(60, 80, 108), rgb255(150, 168, 186), rgb255(88, 120, 128)],
  kemuning: [rgb255(206, 120, 86), rgb255(236, 220, 188), rgb255(218, 168, 108), rgb255(226, 158, 128), rgb255(196, 150, 118), rgb255(240, 200, 160)],
  houses: [rgb255(244, 236, 216), rgb255(208, 226, 236), rgb255(236, 210, 196), rgb255(226, 236, 204), rgb255(250, 220, 170)],
  roofs: [rgb255(176, 76, 54), rgb255(96, 96, 108), rgb255(76, 136, 136), rgb255(150, 92, 60)],
  docks: [rgb255(150, 152, 148), rgb255(122, 134, 146), rgb255(176, 146, 104), rgb255(140, 122, 112)],
  pantai: [rgb255(248, 244, 234), rgb255(252, 196, 176), rgb255(176, 226, 220), rgb255(252, 228, 172)],
  containers: [rgb255(200, 60, 50), rgb255(40, 110, 170), rgb255(230, 160, 40), rgb255(50, 140, 90), rgb255(150, 60, 140), rgb255(210, 210, 205)],
  awnings: [rgb255(220, 60, 120), rgb255(40, 180, 170), rgb255(250, 190, 40), rgb255(230, 90, 40), rgb255(80, 120, 220), rgb255(120, 200, 80)],
};

export function blockRect(bx, by) { return { x: bx * CELL + ROAD, z: by * CELL + ROAD, w: BLOCK, d: BLOCK }; }
export function nodePos(i, j) { return { x: i * CELL + ROAD / 2, z: j * CELL + ROAD / 2 }; }

export function districtOf(bx, by) {
  for (const p of PARKS) if (p[0] === bx && p[1] === by) return 'park';
  if (bx >= 8) return 'docks';
  if (by >= 8) return 'pantai';
  if (bx <= 1) return 'bukit';
  if (bx >= 3 && bx <= 6 && by >= 2 && by <= 5) return 'downtown';
  return 'kemuning';
}
export function districtAt(x, z) {
  if (z > CITY && x < CITY) return 'pantai';
  const bx = Math.max(0, Math.min(NB - 1, Math.floor((x - ROAD / 2) / CELL)));
  const by = Math.max(0, Math.min(NB - 1, Math.floor((z - ROAD / 2) / CELL)));
  return districtOf(bx, by);
}
export function isRoad(x, z) {
  if (x < 0 || z < 0 || x > CITY || z > CITY) return false;
  return (x % CELL) < ROAD || (z % CELL) < ROAD;
}
/** Ground height under a point (roads 0, sidewalks/lots raised, beach slopes, piers decks). */
export function groundHeight(x, z) {
  for (const p of PIERS) if (x >= p.x && x <= p.x + p.w && z >= p.z && z <= p.z + p.d) return p.deck;
  if (x >= 0 && x <= CITY && z >= 0 && z <= CITY) return isRoad(x, z) ? 0 : CURB;
  if (z > CITY + 6 && x > LAND.x0 && x < LAND.x1) return beachHeight(z);
  return CURB;
}
export function beachHeight(z) {
  const t = (z - (CITY + 6)) / (LAND.z1 + 12 - (CITY + 6));
  return t < 0.7 ? CURB + 0.02 - t * 0.5 : CURB + 0.02 - 0.35 - (t - 0.7) * 6;
}

// ---------------------------------------------------------------------------
function makeBuilding(x, z, w, d, h, wall, roof, rng, extra = {}) {
  return { x, z, w, d, h, y0: CURB, wall, roof, seed: rng.next(), features: [], parts: [], kind: 'box', ...extra };
}

/** Roof clutter positioned on top of a box (local coords relative to x,z). */
function roofClutter(b, rng, { ac = 3, tanks = 0, garden = false, solar = false, pool = false, antenna = false, helipad = false } = {}) {
  const top = b.y0 + b.h;
  if (helipad && b.w >= 22 && b.d >= 22) { b.features.push({ type: 'helipad', x: b.x + b.w / 2, z: b.z + b.d / 2, y: top, r: Math.min(b.w, b.d) * 0.34 }); return; }
  if (garden && b.w > 16) b.features.push({ type: 'garden', x: b.x + 2, z: b.z + 2, w: b.w * 0.45, d: b.d * 0.45, y: top });
  if (pool && b.w > 16) b.features.push({ type: 'pool', x: b.x + b.w * 0.45, z: b.z + b.d * 0.5, w: b.w * 0.42, d: b.d * 0.35, y: top });
  if (solar && b.w > 12) b.features.push({ type: 'solar', x: b.x + b.w * 0.5, z: b.z + 2, w: b.w * 0.45, d: b.d * 0.4, y: top });
  for (let i = 0; i < rng.int(Math.max(0, ac - 2), ac); i++) b.features.push({ type: 'ac', x: b.x + rng.range(2, b.w - 4), z: b.z + rng.range(2, b.d - 4), y: top, s: rng.range(1.4, 2.6) });
  for (let i = 0; i < tanks; i++) b.features.push({ type: 'tank', x: b.x + rng.range(3, b.w - 3), z: b.z + rng.range(3, b.d - 3), y: top, r: rng.range(1.2, 1.8) });
  if (antenna) b.features.push({ type: 'antenna', x: b.x + rng.range(3, b.w - 3), z: b.z + rng.range(3, b.d - 3), y: top, h: rng.range(6, 14) });
}

let helipadBudget = 0;
function genDowntown(blk, rng, out) {
  const L = blk.lot;
  blk.ground = 'plaza';
  const tower = (x, z, w, d, h) => {
    const wall = rng.pick(P.glass);
    const style = rng.int(0, 3);
    const roof = [0.36, 0.37, 0.4];
    let b;
    if (style === 1 && w > 30) {
      // podium + tower
      b = makeBuilding(x, z, w, d, rng.range(9, 14), rgb255(190, 180, 168), roof, rng, { kind: 'podium' });
      out.push(b); roofClutter(b, rng, { ac: 2, garden: true });
      const tw = w * rng.range(0.5, 0.65), td = d * rng.range(0.5, 0.65);
      const t = makeBuilding(x + (w - tw) / 2, z + (d - td) / 2, tw, td, h, wall, roof, rng, { kind: 'tower', glass: true });
      t.y0 = CURB + b.h; t.h = h - b.h; out.push(t);
      roofClutter(t, rng, { ac: 4, antenna: rng.chance(0.5), helipad: helipadBudget-- > 0 && rng.chance(0.2), tanks: 1 });
      b = t;
    } else if (style === 2) {
      // stepped setbacks
      let cx = x, cz = z, cw = w, cd = d, y = CURB, rem = h;
      for (let s = 0; s < 3; s++) {
        const sh = s === 2 ? rem : rem * rng.range(0.35, 0.5);
        const p = makeBuilding(cx, cz, cw, cd, sh, wall, roof, rng, { kind: 'tower', glass: true }); p.y0 = y; out.push(p);
        if (s < 2) roofClutter(p, rng, { ac: 2, garden: rng.chance(0.4) }); else roofClutter(p, rng, { ac: 3, antenna: true });
        y += sh; rem -= sh; const ins = rng.range(3, 6); cx += ins; cz += ins; cw -= ins * 2; cd -= ins * 2;
      }
      return;
    } else if (style === 3 && w > 26 && d > 26) {
      // L-shape: two overlapping boxes of different heights
      const a = makeBuilding(x, z, w, d * 0.45, h, wall, roof, rng, { kind: 'tower', glass: true }); out.push(a);
      const c = makeBuilding(x, z + d * 0.45, w * 0.45, d * 0.55, h * rng.range(0.55, 0.8), wall, roof, rng, { kind: 'tower', glass: true }); out.push(c);
      roofClutter(a, rng, { ac: 4, solar: true, antenna: rng.chance(0.4) }); roofClutter(c, rng, { ac: 2, garden: true });
      return;
    } else {
      b = makeBuilding(x, z, w, d, h, wall, roof, rng, { kind: 'tower', glass: true });
      out.push(b);
      roofClutter(b, rng, { ac: 4, antenna: rng.chance(0.5), helipad: helipadBudget-- > 0 && rng.chance(0.25), tanks: rng.int(0, 1), pool: rng.chance(0.15) });
    }
  };
  const v = rng.int(0, 2);
  if (v === 0) {
    const s = rng.range(46, 58);
    tower(L.x + (L.w - s) / 2, L.z + 4, s, s * rng.range(0.8, 1), rng.range(60, 140));
    blk.fountains.push({ x: L.x + L.w / 2, z: L.z + L.d - 10, r: 4 });
  } else if (v === 1) {
    tower(L.x + 3, L.z + 3, 36, L.d - 26, rng.range(70, 140));
    tower(L.x + 46, L.z + 3, L.w - 49, rng.range(34, 48), rng.range(40, 90));
    blk.fountains.push({ x: L.x + 46 + (L.w - 49) / 2, z: L.z + L.d - 13, r: 3.5 });
  } else {
    const s = (L.w - 10) / 2;
    tower(L.x + 3, L.z + 3, s, s, rng.range(40, 110));
    tower(L.x + s + 7, L.z + 3, s, s, rng.range(40, 110));
    tower(L.x + 3, L.z + s + 7, s, s, rng.range(40, 110));
    if (rng.chance(0.5)) tower(L.x + s + 7, L.z + s + 7, s, s, rng.range(40, 110));
    else blk.fountains.push({ x: L.x + s + 7 + s / 2, z: L.z + s + 7 + s / 2, r: 5 });
  }
  if (rng.chance(0.55)) blk.billboards.push({ brand: rng.int(0, BRANDS.length - 1) });
}

function genKemuning(blk, rng, out) {
  const L = blk.lot;
  blk.ground = 'paved';
  const rows = 2;
  let count = 0;
  const rowD = (L.d - 6) / rows;
  for (let r = 0; r < rows; r++) {
    const cols = rng.int(2, 3);
    const colW = (L.w - (cols - 1) * 4) / cols;
    for (let c = 0; c < cols; c++) {
      if (count >= 5 && rng.chance(0.5)) continue;
      const ins = rng.range(0.5, 2);
      const floors = rng.int(4, 10);
      const b = makeBuilding(L.x + c * (colW + 4) + ins, L.z + r * (rowD + 6) + ins, colW - ins * 2, rowD - ins * 2, floors * 3.4, rng.pick(P.kemuning), null, rng, { kind: 'midrise', balconies: rng.chance(0.6), shops: true, facing: r === 0 ? 'n' : 's' });
      b.roof = [b.wall[0] * 0.72, b.wall[1] * 0.68, b.wall[2] * 0.64];
      roofClutter(b, rng, { ac: 2, tanks: rng.int(0, 2), solar: rng.chance(0.3), garden: rng.chance(0.15) });
      out.push(b); count++;
    }
  }
}

function genBukit(blk, rng, out) {
  const L = blk.lot;
  blk.ground = 'garden';
  const half = L.w / 2;
  for (let i = 0; i < 4; i++) {
    const lx = L.x + (i % 2) * half, lz = L.z + Math.floor(i / 2) * half;
    blk.lots.push({ x: lx + 1, z: lz + 1, w: half - 2, d: half - 2 });
    const w = rng.range(14, 19), d = rng.range(11, 15);
    const hx = lx + rng.range(4, half - w - 4), hz = lz + (Math.floor(i / 2) === 0 ? rng.range(4, 8) : half - d - rng.range(6, 10));
    const b = makeBuilding(hx, hz, w, d, rng.chance(0.4) ? 6.6 : 3.6, rng.pick(P.houses), rng.pick(P.roofs), rng, { kind: 'house', gable: true, ridgeX: w > d });
    out.push(b);
    if (rng.chance(0.5)) blk.pools.push({ x: hx + (hx - lx > half / 2 ? -11 : w + 2), z: hz + 2, w: 8, d: 5 });
    for (let t = 0; t < 3; t++) {
      const tx = lx + rng.range(3, half - 3), tz = lz + rng.range(3, half - 3);
      if (tx > hx - 3 && tx < hx + w + 3 && tz > hz - 3 && tz < hz + d + 3) continue;
      if (blk.pools.some((p) => tx > p.x - 2 && tx < p.x + p.w + 2 && tz > p.z - 2 && tz < p.z + p.d + 2)) continue;
      blk.trees.push({ x: tx, z: tz, s: rng.range(0.8, 1.25), kind: rng.chance(0.3) ? 'palm' : 'round' });
    }
    blk.fences.push({ x: lx + 1, z: lz + 1, w: half - 2, d: half - 2 });
    blk.parking.push({ x: hx + w / 2, z: Math.floor(i / 2) === 0 ? lz + 2.6 : lz + half - 2.6, a: 0 });
  }
}

function genDocks(blk, rng, out) {
  const L = blk.lot;
  blk.ground = 'concrete';
  const vertical = rng.chance(0.5);
  const ww = vertical ? rng.range(30, 38) : L.w - 8, wd = vertical ? L.d - 8 : rng.range(28, 34);
  const b = makeBuilding(L.x + 4, L.z + 4, ww, wd, rng.range(10, 14), rng.pick(P.docks), [0.45, 0.48, 0.5], rng, { kind: 'warehouse', ribs: true });
  out.push(b);
  roofClutter(b, rng, { ac: 2, solar: rng.chance(0.5) });
  // container stacks
  const yard = vertical ? { x: L.x + ww + 10, z: L.z + 4, w: L.w - ww - 14, d: L.d - 8 } : { x: L.x + 4, z: L.z + wd + 10, w: L.w - 8, d: L.d - wd - 14 };
  const cl = 12.2, cw = 2.5, ch = 2.6;
  const along = vertical ? yard.d : yard.w, across = vertical ? yard.w : yard.d;
  for (let a = 0; a + cw * 2 < across; a += cw * 2 + 3) {
    for (let s = 0; s + cl < along; s += cl + 1.5) {
      if (rng.chance(0.2)) continue;
      const layers = rng.int(1, 3);
      for (let l = 0; l < layers; l++) for (let k = 0; k < 2; k++) {
        const x = vertical ? yard.x + a + k * cw : yard.x + s, z = vertical ? yard.z + s : yard.z + a + k * cw;
        blk.containers.push({ x, z, w: vertical ? cw : cl, d: vertical ? cl : cw, y: CURB + l * ch, h: ch, color: rng.pick(P.containers) });
      }
    }
  }
  blk.parking.push({ x: vertical ? L.x + ww + 7 : L.x + L.w - 10, z: vertical ? L.z + L.d - 8 : L.z + wd + 6, a: vertical ? Math.PI / 2 : 0 });
}

function genPantai(blk, rng, out) {
  const L = blk.lot;
  blk.ground = 'resort';
  const mk = (x, z, w, d) => {
    const b = makeBuilding(x, z, w, d, rng.int(6, 13) * 3.4, rng.pick(P.pantai), [0.6, 0.58, 0.55], rng, { kind: 'hotel', balconies: true });
    roofClutter(b, rng, { ac: 3, pool: rng.chance(0.5), garden: rng.chance(0.3) });
    out.push(b);
  };
  if (rng.chance(0.55)) { mk(L.x + 2, L.z + 2, 34, 44); mk(L.x + 44, L.z + 2, 36, 38); blk.pools.push({ x: L.x + 8, z: L.z + 54, w: 28, d: 12 }); }
  else { mk(L.x + 6, L.z + 2, L.w - 12, 38); blk.pools.push({ x: L.x + 22, z: L.z + 50, w: 36, d: 14 }); }
  for (let i = 0; i < 6; i++) blk.trees.push({ x: L.x + 4 + i * (L.w - 8) / 5, z: L.z + L.d - 4, s: 1.1, kind: 'palm' });
  for (let i = 0; i < 4; i++) blk.umbrellas.push({ x: L.x + 50 + (i % 2) * 14, z: L.z + 50 + Math.floor(i / 2) * 12, color: rng.pick(P.awnings) });
}

function genPark(blk, rng) {
  const L = blk.lot;
  blk.ground = 'park';
  blk.pond = { x: L.x + L.w / 2 + rng.range(-10, 10), z: L.z + L.d / 2 + rng.range(-10, 10), rx: rng.range(12, 16), rz: rng.range(9, 12) };
  blk.fountains.push({ x: blk.pond.x, z: blk.pond.z, r: 2, inPond: true });
  for (let i = 0; i < 34; i++) {
    const tx = L.x + rng.range(3, L.w - 3), tz = L.z + rng.range(3, L.d - 3);
    const p = blk.pond;
    if (((tx - p.x) / (p.rx + 5)) ** 2 + ((tz - p.z) / (p.rz + 5)) ** 2 < 1) continue;
    if (Math.abs(tx - (L.x + L.w / 2)) < 4 || Math.abs(tz - (L.z + L.d / 2)) < 4) continue;
    blk.trees.push({ x: tx, z: tz, s: rng.range(0.9, 1.5), kind: rng.chance(0.25) ? 'palm' : 'round' });
  }
  for (let i = 0; i < 6; i++) blk.benches.push({ x: L.x + L.w / 2 + (i % 2 ? 3.2 : -3.2), z: L.z + 12 + i * 11, a: Math.PI / 2 });
}

function genLandmark(blk, id, rng, out) {
  const spec = LANDMARKS[id], L = blk.lot;
  blk.ground = id === 'freight' ? 'concrete' : id === 'safehouse' ? 'garden' : id === 'kedai' ? 'resort' : 'paved';
  const lm = { id, ...spec, block: blk, x: L.x + L.w / 2, z: L.z + L.d - 12 };
  let b;
  const add = (x, z, w, d, h, wall, roof, extra = {}) => { const bb = makeBuilding(x, z, w, d, h, wall, roof, rng, { landmark: id, ...extra }); out.push(bb); return bb; };
  switch (id) {
    case 'tower':
      add(L.x + 6, L.z + 4, L.w - 12, 50, 12, rgb255(60, 40, 80), [0.25, 0.22, 0.3], { kind: 'podium' });
      b = add(L.x + 19, L.z + 10, L.w - 38, 38, 196, rgb255(120, 70, 190), [0.25, 0.15, 0.35], { kind: 'tower', glass: true, neon: hexc('#c45cff') });
      b.y0 = CURB + 12; b.h = 196;
      b.features.push({ type: 'orchid', x: b.x + b.w / 2, z: b.z + b.d / 2, y: b.y0 + b.h, r: 14 });
      b.features.push({ type: 'antenna', x: b.x + b.w / 2, z: b.z + b.d / 2, y: b.y0 + b.h, h: 26 });
      lm.z = L.z + L.d - 14;
      break;
    case 'bank':
      b = add(L.x + 8, L.z + 6, L.w - 16, 48, 58, rgb255(222, 208, 176), [0.62, 0.55, 0.4], { kind: 'tower', columns: true });
      b.features.push({ type: 'dome', x: b.x + b.w / 2, z: b.z + b.d / 2, y: b.y0 + b.h, r: 10 });
      break;
    case 'hospital':
      b = add(L.x + 6, L.z + 6, L.w - 12, 50, 36, rgb255(236, 240, 244), [0.8, 0.82, 0.84], { kind: 'midrise' });
      b.features.push({ type: 'helipad', x: b.x + b.w / 2, z: b.z + b.d / 2, y: b.y0 + b.h, r: 10, cross: true });
      break;
    case 'police':
      b = add(L.x + 6, L.z + 6, L.w - 12, 46, 24, rgb255(112, 132, 164), [0.3, 0.34, 0.4], { kind: 'midrise' });
      roofClutter(b, rng, { ac: 3, antenna: true });
      blk.parking.push({ x: L.x + 20, z: L.z + L.d - 10, a: -Math.PI / 2, police: true }, { x: L.x + L.w - 20, z: L.z + L.d - 10, a: -Math.PI / 2, police: true });
      break;
    case 'dex':
      b = add(L.x + 14, L.z + 6, L.w - 28, 44, 42, rgb255(150, 160, 172), [0.4, 0.42, 0.45], { kind: 'midrise', balconies: true });
      roofClutter(b, rng, { ac: 3, antenna: true, solar: true });
      break;
    case 'garage':
      b = add(L.x + 6, L.z + 6, L.w - 12, 40, 9, rgb255(200, 124, 74), [0.45, 0.42, 0.4], { kind: 'warehouse', ribs: true, rollers: true });
      break;
    case 'respray':
      b = add(L.x + 10, L.z + 6, L.w - 20, 36, 8, rgb255(60, 72, 84), [0.2, 0.7, 0.45], { kind: 'warehouse', ribs: true, rollers: true });
      break;
    case 'freight':
      b = add(L.x + 4, L.z + 4, L.w - 8, 44, 14, rgb255(100, 80, 124), [0.4, 0.36, 0.45], { kind: 'warehouse', ribs: true, rollers: true });
      lm.z = L.z + L.d - 20;
      break;
    case 'arms':
      b = add(L.x + 16, L.z + 10, L.w - 32, 30, 7, rgb255(92, 72, 62), [0.3, 0.27, 0.25], { kind: 'shop' });
      break;
    case 'kedai':
      b = add(L.x + 20, L.z + 14, L.w - 40, 24, 6, rgb255(242, 222, 192), [0.6, 0.3, 0.48], { kind: 'shop', awning: true });
      blk.cafeTables = [];
      for (let i = 0; i < 6; i++) blk.umbrellas.push({ x: L.x + 24 + i * 7.5, z: L.z + 46, color: P.awnings[i % P.awnings.length] });
      break;
    case 'safehouse':
      b = add(L.x + 28, L.z + 16, 26, 18, 6.6, rgb255(236, 226, 204), rgb255(60, 140, 140), { kind: 'house', gable: true, ridgeX: true });
      blk.pools.push({ x: L.x + 58, z: L.z + 18, w: 8, d: 14 });
      blk.trees.push({ x: L.x + 8, z: L.z + 10, s: 1.3, kind: 'round' }, { x: L.x + L.w - 8, z: L.z + L.d - 30, s: 1.2, kind: 'palm' });
      blk.fences.push({ x: L.x + 1, z: L.z + 1, w: L.w - 2, d: L.d - 2 });
      lm.z = L.z + 44;
      break;
  }
  b.label = spec.label; b.neon = b.neon || hexc(spec.color); b.signFacing = 's';
  lm.building = b;
  lm.door = { x: lm.x, z: b.z + b.d + 1 };
  return lm;
}
const hexc = (h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

export function generateCity(seed = 1337) {
  const rng = new RNG(seed);
  helipadBudget = 4;
  const city = { seed, blocks: [], buildings: [], trees: [], lamps: [], landmarks: {}, parking: [], tags: [], cranes: [], boats: [], benches: [], bins: [], busStops: [], umbrellas: [], containers: [], billboards: [] };
  const lmAt = {};
  for (const id in LANDMARKS) lmAt[LANDMARKS[id].bx + ',' + LANDMARKS[id].by] = id;
  for (let by = 0; by < NB; by++) for (let bx = 0; bx < NB; bx++) {
    const r = blockRect(bx, by);
    const blk = {
      bx, by, ...r, district: districtOf(bx, by), lot: { x: r.x + SIDEWALK, z: r.z + SIDEWALK, w: r.w - SIDEWALK * 2, d: r.d - SIDEWALK * 2 },
      ground: 'paved', trees: [], pools: [], fountains: [], lots: [], parking: [], fences: [], benches: [], umbrellas: [], containers: [], billboards: [], pond: null,
      seed: rng.int(0, 1e9),
    };
    const out = [];
    const lid = lmAt[bx + ',' + by];
    if (lid) city.landmarks[lid] = genLandmark(blk, lid, rng, out);
    else switch (blk.district) {
      case 'downtown': genDowntown(blk, rng, out); break;
      case 'kemuning': genKemuning(blk, rng, out); break;
      case 'bukit': genBukit(blk, rng, out); break;
      case 'docks': genDocks(blk, rng, out); break;
      case 'pantai': genPantai(blk, rng, out); break;
      case 'park': genPark(blk, rng); break;
    }
    for (const b of out) { b.block = blk; city.buildings.push(b); }
    blk.buildings = out;
    for (const t of blk.trees) city.trees.push(t);
    for (const p of blk.parking) city.parking.push(p);
    for (const c of blk.containers) city.containers.push(c);
    for (const u of blk.umbrellas) city.umbrellas.push(u);
    for (const b of blk.benches) city.benches.push(b);
    city.blocks.push(blk);
    // street furniture on the sidewalk ring: lamps every ~30 m, benches, bins
    const o = 1.4;
    for (let k = 0; k < 3; k++) {
      const t = 15 + k * 30;
      city.lamps.push({ x: r.x + t, z: r.z + o, a: Math.PI / 2 }, { x: r.x + t, z: r.z + r.d - o, a: -Math.PI / 2 });
      city.lamps.push({ x: r.x + o, z: r.z + t, a: Math.PI }, { x: r.x + r.w - o, z: r.z + t, a: 0 });
    }
    if (blk.district !== 'bukit' && blk.district !== 'park') {
      city.bins.push({ x: r.x + 30, z: r.z + r.d - 1.2 }, { x: r.x + r.w - 1.2, z: r.z + 60 });
      if (hash(bx, by, 7) < 0.35) city.busStops.push({ x: r.x + 45, z: r.z + r.d - 1.8, a: 0 });
    }
  }
  // beach palms + umbrellas + boardwalk benches
  for (let x = -20; x < CITY + 30; x += rng.range(14, 22)) {
    if (Math.abs(x - (PIERS[0].x + 5)) < 10) continue;
    city.trees.push({ x, z: CITY + 12 + rng.range(0, 6), s: rng.range(1.1, 1.4), kind: 'palm' });
    if (rng.chance(0.6)) city.umbrellas.push({ x: x + rng.range(4, 10), z: CITY + 30 + rng.range(0, 16), color: rng.pick(P.awnings) });
  }
  // gantry cranes and moored boats at the docks
  for (let i = 0; i < 4; i++) city.cranes.push({ x: CITY + 22, z: 520 + i * 130, h: 34, color: i % 2 ? [0.9, 0.62, 0.12] : [0.8, 0.22, 0.18] });
  for (let i = 0; i < 6; i++) city.boats.push({ x: LAND.x1 + 14 + (i % 2) * 10, z: 300 + i * 120 + rng.range(-10, 10), a: Math.PI / 2 + rng.range(-0.2, 0.2), s: rng.range(0.8, 1.3), color: rng.pick(P.awnings) });
  city.boats.push({ id: 'escape', x: PIERS[1].x + PIERS[1].w + 8, z: PIERS[1].z + 7, a: 0, s: 1.6, color: [0.12, 0.1, 0.16] });
  city.blockAt = (bx, by) => (bx >= 0 && by >= 0 && bx < NB && by < NB ? city.blocks[by * NB + bx] : null);
  // twelve hidden Orchid tags
  const tagBlocks = [[0, 0], [9, 1], [1, 3], [6, 1], [8, 8], [3, 7], [9, 9], [0, 9], [6, 6], [9, 3], [1, 9], [4, 9]];
  tagBlocks.forEach(([bx, by], i) => { const p = findFreeSpot(city, city.blockAt(bx, by), new RNG(seed + 91 * i + 7), 4); city.tags.push({ id: i, x: p.x, z: p.z }); });
  return city;
}

/** A point inside a block lot clear of buildings / containers / ponds. */
export function findFreeSpot(city, blk, rng, margin = 3) {
  const L = blk.lot;
  for (let tries = 0; tries < 80; tries++) {
    const x = L.x + rng.range(margin, L.w - margin), z = L.z + rng.range(margin, L.d - margin);
    let ok = true;
    for (const b of blk.buildings) if (x > b.x - margin && x < b.x + b.w + margin && z > b.z - margin && z < b.z + b.d + margin) { ok = false; break; }
    for (const c of blk.containers) if (ok && x > c.x - margin && x < c.x + c.w + margin && z > c.z - margin && z < c.z + c.d + margin) ok = false;
    for (const p of blk.pools) if (ok && x > p.x - margin && x < p.x + p.w + margin && z > p.z - margin && z < p.z + p.d + margin) ok = false;
    if (ok && blk.pond) { const p = blk.pond; if (((x - p.x) / (p.rx + 3)) ** 2 + ((z - p.z) / (p.rz + 3)) ** 2 < 1) ok = false; }
    if (ok) return { x, z };
  }
  return { x: blk.x + 2, z: blk.z + 2 };
}
