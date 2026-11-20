// Procedural generation of Selara Bay: a 12x12 block grid with districts, landmarks,
// extruded buildings, trees, streetlights, parking spots and hidden Orchid tags.
import { RNG, hash } from '../util.js';

export const NB = 12;             // blocks per side
export const CELL = 440;          // road + block
export const ROAD = 80;           // road width (two lanes)
export const BLOCK = 360;         // block width incl. sidewalk
export const SIDEWALK = 14;
export const LANE = 18;           // lane centre offset from road centre
export const CITY = NB * CELL + ROAD; // 5360
export const LAND = { x0: -130, y0: -130, x1: CITY + 130, y1: CITY + 300 };
export const PIERS = [
  { id: 'beach', x: 4 * CELL + 15, y: LAND.y1 - 30, w: 50, h: 430 },
  { id: 'east', x: LAND.x1 - 30, y: 4 * CELL + 5, w: 500, h: 70 },
];

export const DISTRICTS = {
  downtown: { name: 'Kota Lama', sub: 'Downtown', color: '#59c3e8' },
  kemuning: { name: 'Kemuning', sub: 'Midtown', color: '#e89a59' },
  bukit: { name: 'Bukit Asri', sub: 'Residential', color: '#9be86a' },
  docks: { name: 'Pier 9 Docks', sub: 'Harbour', color: '#e8d159' },
  pantai: { name: 'Pantai Selara', sub: 'Beach Row', color: '#ffb0d0' },
  park: { name: 'City Park', sub: 'Green Space', color: '#5fd98a' },
};

export const PARKS = [[1, 2], [5, 7], [8, 5], [3, 9]];

/** Unique landmark buildings. door = side facing the forecourt / marker. */
export const LANDMARKS = {
  safehouse: { name: 'Safehouse', bx: 1, by: 5, icon: 'house', color: '#2ff3e0', height: 42, wall: [236, 226, 204], roof: [60, 140, 140], label: 'SAFE' },
  garage: { name: "Lin's Garage", bx: 3, by: 7, icon: 'wrench', color: '#ffb347', height: 54, wall: [196, 120, 70], roof: [120, 110, 100], label: "LIN'S GARAGE" },
  hospital: { name: 'Selara General Hospital', bx: 8, by: 2, icon: 'cross', color: '#ff4d5e', height: 150, wall: [232, 236, 240], roof: [200, 205, 210], label: 'SELARA GENERAL' },
  police: { name: 'Selara Police HQ', bx: 3, by: 3, icon: 'badge', color: '#4d8dff', height: 118, wall: [110, 130, 160], roof: [70, 84, 104], label: 'POLICE HQ' },
  bank: { name: 'Bank Samudra', bx: 6, by: 5, icon: 'bank', color: '#ffd84d', height: 190, wall: [214, 200, 170], roof: [150, 130, 90], label: 'BANK SAMUDRA' },
  tower: { name: 'Orchid Tower', bx: 5, by: 3, icon: 'orchid', color: '#c45cff', height: 450, wall: [96, 52, 140], roof: [60, 30, 90], label: 'ORCHID' },
  freight: { name: 'Orchid Freight', bx: 10, by: 6, icon: 'orchid', color: '#c45cff', height: 62, wall: [100, 80, 120], roof: [90, 84, 100], label: 'ORCHID FREIGHT' },
  respray: { name: 'Kilat Respray', bx: 8, by: 8, icon: 'spray', color: '#3dff8a', height: 40, wall: [60, 70, 80], roof: [40, 200, 120], label: 'KILAT RESPRAY' },
  arms: { name: 'Bang Bang Arms', bx: 2, by: 8, icon: 'gun', color: '#ff7a3d', height: 44, wall: [90, 70, 60], roof: [70, 60, 55], label: 'BANG BANG ARMS' },
  dex: { name: "Dex's Apartment", bx: 7, by: 8, icon: 'laptop', color: '#9dff4d', height: 128, wall: [150, 160, 170], roof: [90, 96, 104], label: 'DEX' },
  kedai: { name: 'Kedai Orchid', bx: 6, by: 9, icon: 'cup', color: '#ff6fd8', height: 30, wall: [240, 220, 190], roof: [160, 70, 120], label: 'KEDAI ORCHID' },
};

export const PALETTES = {
  downtown: { walls: [[70, 112, 142], [58, 90, 124], [92, 130, 152], [52, 72, 98], [120, 142, 164], [84, 100, 120]], roof: [86, 92, 100] },
  kemuning: { walls: [[198, 112, 82], [232, 214, 182], [212, 162, 102], [222, 152, 122], [190, 140, 110]], roof: [150, 120, 100] },
  bukit: { walls: [[242, 232, 212], [204, 222, 232], [232, 204, 192], [222, 232, 200]], roofs: [[170, 72, 52], [92, 92, 104], [72, 132, 132], [140, 90, 60]] },
  docks: { walls: [[150, 150, 146], [122, 132, 142], [172, 142, 102], [140, 120, 110]], roof: [112, 122, 128] },
  pantai: { walls: [[246, 242, 232], [250, 192, 172], [172, 222, 216], [250, 226, 170]], roof: [210, 205, 195] },
  containers: [[200, 60, 50], [40, 110, 170], [230, 160, 40], [50, 140, 90], [150, 60, 140], [210, 210, 205]],
};

export function blockRect(bx, by) {
  return { x: bx * CELL + ROAD, y: by * CELL + ROAD, w: BLOCK, h: BLOCK };
}
export function nodePos(i, j) { return { x: i * CELL + ROAD / 2, y: j * CELL + ROAD / 2 }; }

export function districtOf(bx, by) {
  for (const p of PARKS) if (p[0] === bx && p[1] === by) return 'park';
  if (bx >= 9) return 'docks';
  if (by >= 10) return 'pantai';
  if (bx <= 2) return 'bukit';
  if (bx >= 4 && bx <= 7 && by >= 2 && by <= 6) return 'downtown';
  return 'kemuning';
}

/** District key for a world position (roads take the district of the nearest block). */
export function districtAt(x, y) {
  if (y > CITY + 10 && x < CITY) return 'pantai';
  const bx = Math.max(0, Math.min(NB - 1, Math.floor((x - ROAD / 2) / CELL)));
  const by = Math.max(0, Math.min(NB - 1, Math.floor((y - ROAD / 2) / CELL)));
  return districtOf(bx, by);
}
export function blockIndexAt(x, y) {
  const bx = Math.floor(x / CELL), by = Math.floor(y / CELL);
  if (bx < 0 || by < 0 || bx >= NB || by >= NB) return null;
  if (x - bx * CELL < ROAD || y - by * CELL < ROAD) return null; // on a road
  return { bx, by };
}
export function isRoad(x, y) {
  if (x < 0 || y < 0 || x > CITY || y > CITY) return false;
  return (x % CELL) < ROAD || (y % CELL) < ROAD;
}
export function isLand(x, y) {
  if (x >= LAND.x0 && x <= LAND.x1 && y >= LAND.y0 && y <= LAND.y1) return true;
  for (const p of PIERS) if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return true;
  return false;
}

// ---------------------------------------------------------------------------

function makeBuilding(x, y, w, h, height, kind, wall, roof, rng, extra = {}) {
  return {
    x, y, w, h, height, kind, wall, roof,
    wall2: [wall[0] * 0.78, wall[1] * 0.78, wall[2] * 0.82],
    seed: Math.floor(rng.next() * 1e9),
    features: [], label: null, landmark: null, neon: null, pitched: false,
    floorH: kind === 'tower' ? 18 : 14, winW: kind === 'tower' ? 15 : 16,
    ...extra,
  };
}

function addRoofClutter(b, rng, { ac = 3, tanks = 0, helipad = false, antenna = false } = {}) {
  if (helipad && b.w >= 120 && b.h >= 120) {
    b.features.push({ type: 'helipad', x: b.w / 2, y: b.h / 2, r: Math.min(b.w, b.h) * 0.32 });
  }
  const n = rng.int(Math.max(0, ac - 2), ac);
  for (let i = 0; i < n; i++) {
    const w = rng.range(10, 18), h = rng.range(8, 14);
    const px = rng.range(6, b.w - w - 6), py = rng.range(6, b.h - h - 6);
    if (helipad && Math.hypot(px + w / 2 - b.w / 2, py + h / 2 - b.h / 2) < Math.min(b.w, b.h) * 0.4) continue;
    b.features.push({ type: 'ac', x: px, y: py, w, h });
  }
  for (let i = 0; i < tanks; i++) b.features.push({ type: 'tank', x: rng.range(14, b.w - 14), y: rng.range(14, b.h - 14), r: rng.range(6, 9) });
  if (antenna) b.features.push({ type: 'antenna', x: rng.range(10, b.w - 10), y: rng.range(10, b.h - 10) });
}

function genDowntown(blk, rng, out) {
  const L = blk.lot;
  const pal = PALETTES.downtown;
  const v = rng.int(0, 2);
  blk.ground = 'plaza';
  const tower = (x, y, w, h) => {
    const b = makeBuilding(x, y, w, h, rng.range(160, 360), 'tower', rng.pick(pal.walls), pal.roof, rng);
    addRoofClutter(b, rng, { ac: 5, helipad: rng.chance(0.22), antenna: rng.chance(0.5), tanks: rng.chance(0.3) ? 1 : 0 });
    b.glass = true;
    const tone = rng.pick([[96, 100, 108], [74, 84, 98], [112, 106, 98], [60, 72, 80]]);
    b.roof = tone;
    if (rng.chance(0.35)) b.features.push({ type: 'garden', x: b.w * 0.15, y: b.h * 0.15, w: b.w * 0.3, h: b.h * 0.25 });
    out.push(b);
  };
  if (v === 0) {
    const s = rng.range(200, 250);
    tower(L.x + (L.w - s) / 2, L.y + 18, s, s * rng.range(0.8, 1));
    blk.fountains.push({ x: L.x + L.w / 2, y: L.y + L.h - 34, r: 20 });
  } else if (v === 1) {
    const w1 = rng.range(130, 160);
    tower(L.x + 12, L.y + 12, w1, L.h - 90);
    tower(L.x + w1 + 40, L.y + 12, L.w - w1 - 52, rng.range(150, 230));
    blk.fountains.push({ x: L.x + w1 + 40 + (L.w - w1 - 52) / 2, y: L.y + L.h - 50, r: 18 });
  } else {
    const s = (L.w - 36) / 2;
    tower(L.x + 12, L.y + 12, s, s);
    tower(L.x + s + 24, L.y + 12, s, s);
    tower(L.x + 12, L.y + s + 24, s, s);
    if (rng.chance(0.5)) tower(L.x + s + 24, L.y + s + 24, s, s);
    else blk.fountains.push({ x: L.x + s + 24 + s / 2, y: L.y + s + 24 + s / 2, r: 24 });
  }
  for (let i = 0; i < 4; i++) blk.trees.push({ x: L.x + 8 + (i % 2) * (L.w - 16), y: L.y + 8 + Math.floor(i / 2) * (L.h - 16), r: 11, kind: 'round' });
}

function genKemuning(blk, rng, out) {
  const L = blk.lot;
  const pal = PALETTES.kemuning;
  blk.ground = 'paved';
  const rows = rng.chance(0.5) ? 2 : 1;
  let count = 0;
  const rowH = (L.h - (rows - 1) * 16) / rows;
  for (let r = 0; r < rows; r++) {
    const cols = rows === 1 ? rng.int(3, 4) : rng.int(2, 3);
    const colW = (L.w - (cols - 1) * 16) / cols;
    for (let c = 0; c < cols; c++) {
      if (count >= 5) break;
      const inset = rng.range(4, 14);
      const x = L.x + c * (colW + 16) + inset, y = L.y + r * (rowH + 16) + inset;
      const b = makeBuilding(x, y, colW - inset * 2, rowH - inset * 2, rng.range(50, 120), 'midrise', rng.pick(pal.walls), pal.roof, rng);
      b.roof = [b.wall[0] * 0.72, b.wall[1] * 0.68, b.wall[2] * 0.64];
      addRoofClutter(b, rng, { ac: 2, tanks: rng.int(1, 2) });
      out.push(b);
      count++;
    }
  }
  blk.alley = true;
}

function genBukit(blk, rng, out) {
  const L = blk.lot;
  const pal = PALETTES.bukit;
  blk.ground = 'garden';
  const half = L.w / 2;
  for (let i = 0; i < 4; i++) {
    const lx = L.x + (i % 2) * half, ly = L.y + Math.floor(i / 2) * half;
    blk.lots.push({ x: lx + 3, y: ly + 3, w: half - 6, h: half - 6 });
    const w = rng.range(78, 104), h = rng.range(66, 92);
    const hx = lx + rng.range(10, half - w - 10), hy = ly + rng.range(10, half - h - 30);
    const b = makeBuilding(hx, hy, w, h, rng.range(24, 36), 'house', rng.pick(pal.walls), rng.pick(pal.roofs), rng);
    b.pitched = true; b.ridgeX = w > h;
    out.push(b);
    if (rng.chance(0.45)) {
      const pw = 40, ph = 22;
      const px = hx + w + 8 < lx + half - pw - 4 ? hx + w + 8 : lx + 8;
      const py = hy + h + 8 < ly + half - ph - 4 ? hy + h + 8 : ly + half - ph - 8;
      blk.pools.push({ x: px, y: py, w: pw, h: ph });
    }
    for (let t = 0; t < 3; t++) {
      const tx = lx + rng.range(10, half - 10), ty = ly + rng.range(10, half - 10);
      if (tx > hx - 12 && tx < hx + w + 12 && ty > hy - 12 && ty < hy + h + 12) continue;
      blk.trees.push({ x: tx, y: ty, r: rng.range(12, 19), kind: rng.chance(0.25) ? 'palm' : 'round' });
    }
    blk.parking.push({ x: hx + w / 2, y: ly + half - 18, a: 0 });
  }
}

function genDocks(blk, rng, out) {
  const L = blk.lot;
  const pal = PALETTES.docks;
  blk.ground = 'concrete';
  const vertical = rng.chance(0.5);
  const ww = vertical ? rng.range(140, 170) : L.w - 30, wh = vertical ? L.h - 30 : rng.range(130, 160);
  const wx = L.x + 15, wy = L.y + 15;
  const wh_ = makeBuilding(wx, wy, ww, wh, rng.range(40, 60), 'warehouse', rng.pick(pal.walls), pal.roof, rng);
  wh_.corrugated = true; wh_.ribsX = !vertical;
  out.push(wh_);
  // container stacks in the remaining yard
  const yard = vertical ? { x: wx + ww + 20, y: L.y + 16, w: L.w - ww - 50, h: L.h - 32 } : { x: L.x + 16, y: wy + wh + 20, w: L.w - 32, h: L.h - wh - 50 };
  const cw = 62, ch = 24;
  if (vertical) {
    for (let cy = yard.y; cy + ch <= yard.y + yard.h; cy += ch + 10) {
      if (rng.chance(0.25)) continue;
      const layers = rng.int(1, 3);
      const c = makeBuilding(yard.x + rng.range(0, Math.max(0, yard.w - cw)), cy, Math.min(cw, yard.w), ch, 13 * layers, 'container', rng.pick(PALETTES.containers), null, rng);
      c.roof = c.wall; out.push(c);
    }
  } else {
    for (let cx = yard.x; cx + ch <= yard.x + yard.w; cx += ch + 10) {
      if (rng.chance(0.25)) continue;
      const layers = rng.int(1, 3);
      const c = makeBuilding(cx, yard.y + rng.range(0, Math.max(0, yard.h - cw)), ch, Math.min(cw, yard.h), 13 * layers, 'container', rng.pick(PALETTES.containers), null, rng);
      c.roof = c.wall; out.push(c);
    }
  }
  blk.parking.push({ x: vertical ? wx + ww + 14 : L.x + L.w - 30, y: vertical ? L.y + L.h - 30 : wy + wh + 12, a: vertical ? Math.PI / 2 : 0 });
}

function genPantai(blk, rng, out) {
  const L = blk.lot;
  const pal = PALETTES.pantai;
  blk.ground = 'resort';
  const two = rng.chance(0.55);
  const mk = (x, y, w, h) => {
    const b = makeBuilding(x, y, w, h, rng.range(60, 140), 'hotel', rng.pick(pal.walls), pal.roof, rng);
    b.balconies = true;
    addRoofClutter(b, rng, { ac: 3, helipad: false });
    if (rng.chance(0.4)) b.features.push({ type: 'roofpool', x: b.w * 0.2, y: b.h * 0.25, w: b.w * 0.6, h: b.h * 0.3 });
    out.push(b);
  };
  if (two) {
    mk(L.x + 10, L.y + 10, 140, 180);
    mk(L.x + 180, L.y + 10, 140, 150);
    blk.pools.push({ x: L.x + 40, y: L.y + 225, w: 120, h: 50 });
  } else {
    mk(L.x + 20, L.y + 10, L.w - 40, 160);
    blk.pools.push({ x: L.x + 90, y: L.y + 210, w: 150, h: 60 });
  }
  for (let i = 0; i < 6; i++) blk.trees.push({ x: L.x + 14 + i * (L.w - 28) / 5, y: L.y + L.h - 16, r: 17, kind: 'palm' });
  blk.parking.push({ x: L.x + L.w - 40, y: L.y + 200, a: Math.PI / 2 });
}

function genPark(blk, rng) {
  const L = blk.lot;
  blk.ground = 'park';
  blk.pond = { x: L.x + L.w / 2 + rng.range(-40, 40), y: L.y + L.h / 2 + rng.range(-40, 40), rx: rng.range(50, 70), ry: rng.range(36, 50) };
  blk.fountains.push({ x: blk.pond.x, y: blk.pond.y, r: 10, inPond: true });
  for (let i = 0; i < 26; i++) {
    const tx = L.x + rng.range(12, L.w - 12), ty = L.y + rng.range(12, L.h - 12);
    const p = blk.pond;
    if (((tx - p.x) / (p.rx + 20)) ** 2 + ((ty - p.y) / (p.ry + 20)) ** 2 < 1) continue;
    if (Math.abs(tx - (L.x + L.w / 2)) < 16 || Math.abs(ty - (L.y + L.h / 2)) < 16) continue;
    blk.trees.push({ x: tx, y: ty, r: rng.range(14, 22), kind: rng.chance(0.2) ? 'palm' : 'round' });
  }
}

function genLandmark(blk, id, rng, out) {
  const spec = LANDMARKS[id];
  const L = blk.lot;
  blk.ground = id === 'freight' ? 'concrete' : id === 'safehouse' ? 'garden' : id === 'kedai' ? 'resort' : 'paved';
  let bx = L.x + 20, by = L.y + 16, bw = L.w - 40, bh = L.h - 170;
  if (id === 'tower') { bw = 230; bh = 200; bx = L.x + (L.w - bw) / 2; by = L.y + 14; }
  if (id === 'safehouse') { bw = 130; bh = 110; bx = L.x + (L.w - bw) / 2; by = L.y + 50; }
  if (id === 'kedai') { bw = 170; bh = 100; bx = L.x + (L.w - bw) / 2; by = L.y + 60; }
  if (id === 'respray' || id === 'garage') { bh = L.h - 190; }
  const kind = id === 'tower' || id === 'bank' || id === 'dex' || id === 'hospital' || id === 'police' ? 'tower' : id === 'freight' || id === 'garage' ? 'warehouse' : 'shop';
  const b = makeBuilding(bx, by, bw, bh, spec.height, kind, spec.wall, spec.roof, rng);
  b.landmark = id; b.label = spec.label; b.neon = spec.color;
  if (id === 'tower') { b.glass = true; b.features.push({ type: 'orchid', x: bw / 2, y: bh / 2, r: 60 }); }
  if (id === 'hospital') b.features.push({ type: 'redcross', x: bw / 2, y: bh / 2, r: 46 });
  if (id === 'police') { b.features.push({ type: 'helipad', x: bw * 0.75, y: bh / 2, r: 36 }); addRoofClutter(b, rng, { ac: 3 }); }
  if (id === 'bank') { b.features.push({ type: 'dome', x: bw / 2, y: bh / 2, r: 40 }); }
  if (id === 'freight' || id === 'garage') { b.corrugated = true; b.ribsX = true; }
  if (id === 'safehouse') { b.pitched = true; b.ridgeX = true; }
  if (id === 'kedai') b.features.push({ type: 'awning', x: 0, y: bh - 14, w: bw, h: 14 });
  if (id === 'dex') addRoofClutter(b, rng, { ac: 4, antenna: true, tanks: 1 });
  out.push(b);
  // forecourt + marker in front (south) of the building
  const markY = Math.min(L.y + L.h - 50, by + bh + 70);
  blk.forecourt = { x: L.x + 6, y: by + bh + 6, w: L.w - 12, h: L.y + L.h - (by + bh) - 12 };
  const lm = { id, ...spec, block: blk, building: b, x: L.x + L.w / 2, y: markY, door: { x: L.x + L.w / 2, y: by + bh + 6 } };
  if (id === 'safehouse') { blk.pools.push({ x: bx + bw + 14, y: by + 20, w: 34, h: 60 }); blk.trees.push({ x: L.x + 30, y: L.y + 40, r: 18, kind: 'round' }, { x: L.x + L.w - 30, y: L.y + L.h - 40, r: 16, kind: 'palm' }); }
  if (id === 'kedai') {
    blk.cafeTables = [];
    for (let i = 0; i < 6; i++) blk.cafeTables.push({ x: bx + 20 + i * 26, y: by + bh + 30 });
    blk.trees.push({ x: L.x + 20, y: L.y + 20, r: 16, kind: 'palm' }, { x: L.x + L.w - 20, y: L.y + 20, r: 16, kind: 'palm' });
  }
  if (id === 'police') { blk.parking.push({ x: L.x + 60, y: markY + 10, a: -Math.PI / 2, police: true }, { x: L.x + L.w - 60, y: markY + 10, a: -Math.PI / 2, police: true }); }
  return lm;
}

/** Quay cranes along the docks waterfront (tall gantry structures). */
function genCranes(rng) {
  const cranes = [];
  for (let i = 0; i < 4; i++) {
    const y = 2400 + i * 640;
    cranes.push({ x: CITY + 20, y, w: 80, h: 70, height: 170, boom: rng.range(-0.2, 0.2), color: i % 2 ? [230, 160, 30] : [200, 60, 50] });
  }
  return cranes;
}

export function generateCity(seed = 1337) {
  const rng = new RNG(seed);
  const city = { seed, blocks: [], buildings: [], trees: [], lights: [], landmarks: {}, parking: [], tags: [], cranes: [], beachProps: [] };
  const landmarkAt = {};
  for (const id in LANDMARKS) landmarkAt[LANDMARKS[id].bx + ',' + LANDMARKS[id].by] = id;

  for (let by = 0; by < NB; by++) {
    for (let bx = 0; bx < NB; bx++) {
      const r = blockRect(bx, by);
      const blk = {
        bx, by, ...r, district: districtOf(bx, by),
        lot: { x: r.x + SIDEWALK, y: r.y + SIDEWALK, w: r.w - SIDEWALK * 2, h: r.h - SIDEWALK * 2 },
        ground: 'paved', trees: [], pools: [], fountains: [], lots: [], parking: [], forecourt: null, pond: null,
        seed: Math.floor(rng.next() * 1e9),
      };
      const out = [];
      const lid = landmarkAt[bx + ',' + by];
      if (lid) {
        city.landmarks[lid] = genLandmark(blk, lid, rng, out);
      } else {
        switch (blk.district) {
          case 'downtown': genDowntown(blk, rng, out); break;
          case 'kemuning': genKemuning(blk, rng, out); break;
          case 'bukit': genBukit(blk, rng, out); break;
          case 'docks': genDocks(blk, rng, out); break;
          case 'pantai': genPantai(blk, rng, out); break;
          case 'park': genPark(blk, rng); break;
        }
      }
      for (const b of out) { b.block = blk; city.buildings.push(b); }
      blk.buildings = out;
      for (const t of blk.trees) { t.seed = Math.floor(rng.next() * 1e6); city.trees.push(t); }
      for (const p of blk.parking) city.parking.push(p);
      city.blocks.push(blk);
      // streetlights at the four sidewalk corners
      const o = 7;
      city.lights.push({ x: r.x + o, y: r.y + o }, { x: r.x + r.w - o, y: r.y + o }, { x: r.x + o, y: r.y + r.h - o }, { x: r.x + r.w - o, y: r.y + r.h - o });
    }
  }
  // beach: palms and umbrellas along the south strip
  for (let x = -60; x < CITY + 80; x += rng.range(90, 150)) {
    if (Math.abs(x - (PIERS[0].x + 25)) < 60) continue;
    city.trees.push({ x, y: CITY + 40 + rng.range(0, 30), r: rng.range(16, 20), kind: 'palm', seed: rng.int(0, 1e6) });
    if (rng.chance(0.7)) city.beachProps.push({ type: 'umbrella', x: x + rng.range(20, 60), y: CITY + 150 + rng.range(0, 70), color: rng.pick(['#ff5d8f', '#ffd23f', '#2ff3e0', '#ff8c42', '#ffffff']) });
    if (rng.chance(0.4)) city.beachProps.push({ type: 'towel', x: x + rng.range(0, 60), y: CITY + 180 + rng.range(0, 60), color: rng.pick(['#3d7dff', '#ff4d6d', '#ffe14d']) });
  }
  city.cranes = genCranes(rng);
  city.blockAt = (bx, by) => (bx >= 0 && by >= 0 && bx < NB && by < NB ? city.blocks[by * NB + bx] : null);

  // Twelve hidden Orchid tags in out-of-the-way spots (deterministic).
  const tagBlocks = [[0, 0], [11, 1], [2, 4], [6, 1], [9, 9], [4, 8], [10, 11], [0, 10], [7, 6], [11, 4], [1, 11], [5, 10]];
  tagBlocks.forEach(([bx, by], i) => {
    const blk = city.blockAt(bx, by);
    const p = findFreeSpot(city, blk, new RNG(seed + 91 * i + 7), 18);
    city.tags.push({ id: i, x: p.x, y: p.y });
  });
  return city;
}

/** Find a point inside a block's lot that is clear of buildings (for pickups, tags, spawns). */
export function findFreeSpot(city, blk, rng, margin = 14) {
  const L = blk.lot;
  for (let tries = 0; tries < 60; tries++) {
    const x = L.x + rng.range(margin, L.w - margin), y = L.y + rng.range(margin, L.h - margin);
    let ok = true;
    for (const b of blk.buildings) {
      if (x > b.x - margin && x < b.x + b.w + margin && y > b.y - margin && y < b.y + b.h + margin) { ok = false; break; }
    }
    if (ok && blk.pond) { const p = blk.pond; if (((x - p.x) / (p.rx + 10)) ** 2 + ((y - p.y) / (p.ry + 10)) ** 2 < 1) ok = false; }
    if (ok) return { x, y };
  }
  return { x: blk.x + 7, y: blk.y + 7 };
}

export { hash };
