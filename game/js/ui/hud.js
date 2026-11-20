// In-game HUD: clock/money/weapon/stars panel, rounded north-up minimap with blips, GPS and
// search area, health/armor/stamina bars, objective, help tips, pop-ups, banners, crosshair
// and the full-screen city map with waypoint placement.
import { G } from '../state.js';
import { input } from '../input.js';
import { TAU, clamp, formatMoney, formatClock, roundRect } from '../util.js';
import { CELL, ROAD, NB, CITY, LAND, PIERS, DISTRICTS, districtOf } from '../world/city.js';
import { nearestNode, bfsPath, nodeXY } from '../world/roads.js';
import { WEAPONS } from '../combat/weapons.js';
import { UI, uiScale, panel, text, fitText, wrap, star, mapIcon } from './theme.js';
import { clearTime } from '../ai/police.js';

const MAP_K = 0.125;           // map canvas pixels per world unit
let mapCanvas = null;
let gps = { path: null, t: 0, tx: 0, ty: 0 };

const DCOL = { downtown: '#3f5f78', kemuning: '#7a5a48', bukit: '#4f6e45', docks: '#6e6a50', pantai: '#8a7a68', park: '#3f8a4a' };

export function init() {
  const w = Math.ceil((LAND.x1 - LAND.x0 + 900) * MAP_K), h = Math.ceil((LAND.y1 - LAND.y0 + 900) * MAP_K);
  mapCanvas = document.createElement('canvas'); mapCanvas.width = w; mapCanvas.height = h;
  const c = mapCanvas.getContext('2d');
  c.scale(MAP_K, MAP_K); c.translate(-(LAND.x0 - 450), -(LAND.y0 - 450));
  c.fillStyle = '#123a52'; c.fillRect(LAND.x0 - 450, LAND.y0 - 450, LAND.x1 - LAND.x0 + 900, LAND.y1 - LAND.y0 + 900);
  c.fillStyle = '#1d5a73'; c.fillRect(LAND.x0 - 60, LAND.y0 - 60, LAND.x1 - LAND.x0 + 120, LAND.y1 - LAND.y0 + 120);
  c.fillStyle = '#58645a'; c.fillRect(LAND.x0, LAND.y0, LAND.x1 - LAND.x0, LAND.y1 - LAND.y0);
  c.fillStyle = '#d9c48a'; c.fillRect(LAND.x0, CITY, LAND.x1 - LAND.x0, LAND.y1 - CITY);
  c.fillStyle = '#8a6a48'; for (const p of PIERS) c.fillRect(p.x, p.y, p.w, p.h);
  c.fillStyle = '#c9c9c9'; c.fillRect(0, 0, CITY, CITY);
  for (const b of G.city.blocks) {
    c.fillStyle = DCOL[b.district] || '#555';
    c.fillRect(b.x, b.y, b.w, b.h);
    if (b.pond) { c.fillStyle = '#2f86a8'; c.beginPath(); c.ellipse(b.pond.x, b.pond.y, b.pond.rx, b.pond.ry, 0, 0, TAU); c.fill(); }
  }
  c.fillStyle = 'rgba(0,0,0,0.25)';
  for (const b of G.city.buildings) if (b.kind !== 'container') c.fillRect(b.x, b.y, b.w, b.h);
}

export function tick(dt) {
  const u = G.ui;
  for (const k of ['banner', 'help', 'area', 'vehicleName', 'radioName']) if (u[k]) { u[k].t -= dt; if (u[k].t <= 0) u[k] = null; }
  for (let i = u.toast.length - 1; i >= 0; i--) { u.toast[i].t -= dt; if (u.toast[i].t <= 0) u.toast.splice(i, 1); }
  // GPS route to the waypoint or the active mission target
  gps.t -= dt;
  const tgt = G.waypoint || (G.missionTarget && G.missionTarget());
  if (!tgt || !G.player) { gps.path = null; return; }
  if (gps.t <= 0) {
    gps.t = 0.5;
    const p = G.player;
    const nodes = bfsPath(nearestNode(p.x, p.y), nearestNode(tgt.x, tgt.y));
    gps.path = [[p.x, p.y], ...nodes.map((n) => { const q = nodeXY(n); return [q.x, q.y]; }), [tgt.x, tgt.y]];
    gps.color = G.waypoint ? UI.purple : UI.gold;
  }
  if (G.waypoint && Math.hypot(G.player.x - G.waypoint.x, G.player.y - G.waypoint.y) < 60) { G.waypoint = null; G.toast('Waypoint reached', UI.purple); }
}

// ---------------------------------------------------------------------------
export function draw(ctx) {
  const s = uiScale(G);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (G.mode !== 'cutscene') {
    drawTopRight(ctx, s);
    drawMinimap(ctx, s);
    drawObjective(ctx, s);
    drawHelp(ctx, s);
    drawPopups(ctx, s);
    drawMeters(ctx, s);
    drawToasts(ctx, s);
  }
  drawBanner(ctx, s);
  if (G.mode === 'dead' || G.mode === 'busted') drawDownScreen(ctx, s);
  if (G.mode === 'playing') drawCrosshair(ctx, s);
  ctx.restore();
}

function drawTopRight(ctx, s) {
  const w = 300 * s, h = 150 * s, x = G.W - w - 24 * s, y = 22 * s;
  panel(ctx, x, y, w, h, 12 * s);
  const r = x + w - 18 * s;
  text(ctx, formatClock(G.clock), r, y + 46 * s, 38 * s, '#fff', 'right');
  text(ctx, formatMoney(G.moneyShown), r, y + 86 * s, 30 * s, G.moneyShown < G.money - 0.5 ? '#b9ffcc' : UI.green, 'right');
  // weapon
  const pl = G.player;
  if (pl) {
    const wid = pl.weapon, wdef = WEAPONS[wid];
    drawWeaponIcon(ctx, wid, x + 24 * s, y + 24 * s, 64 * s);
    text(ctx, wdef.name.toUpperCase(), x + 22 * s, y + 104 * s, 13 * s, '#cfe', 'left');
    if (wid !== 'fists') text(ctx, String(pl.ammo[wid]), x + 100 * s, y + 104 * s, 15 * s, pl.ammo[wid] > 0 ? '#fff' : UI.red, 'left');
  }
  // stars
  const W = G.wanted;
  const flashing = W.stars > 0 && !W.seen;
  for (let i = 0; i < 5; i++) {
    const on = i < W.stars;
    let fill = on ? UI.gold : 'rgba(255,255,255,0.12)';
    if (on && flashing && Math.floor(G.realTime * 4) % 2) fill = 'rgba(255,210,63,0.25)';
    if (on && W.flash > 0) fill = Math.floor(G.realTime * 10) % 2 ? '#fff' : UI.gold;
    star(ctx, r - (4 - i) * 30 * s - 10 * s, y + 126 * s, 12 * s, fill);
  }
  if (W.stars > 0 && !W.seen) {
    const k = clamp(W.unseen / clearTime(), 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x + 18 * s, y + h - 9 * s, w - 36 * s, 4 * s);
    ctx.fillStyle = UI.teal; ctx.fillRect(x + 18 * s, y + h - 9 * s, (w - 36 * s) * k, 4 * s);
  }
}

export function drawWeaponIcon(ctx, wid, x, y, size) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 64, size / 64);
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; roundRect(ctx, 0, 0, 64, 60, 8); ctx.fill();
  ctx.fillStyle = '#e8eef5'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.beginPath();
  if (wid === 'fists') {
    roundRect(ctx, 16, 20, 30, 22, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); for (let i = 0; i < 3; i++) { ctx.moveTo(24 + i * 8, 20); ctx.lineTo(24 + i * 8, 30); } ctx.stroke();
  } else if (wid === 'kobra') {
    ctx.rect(12, 20, 38, 9); ctx.rect(14, 28, 10, 18); ctx.fill(); ctx.stroke();
  } else if (wid === 'wasp') {
    ctx.rect(8, 22, 46, 10); ctx.rect(18, 31, 8, 16); ctx.rect(32, 31, 5, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = UI.gold; ctx.fillRect(40, 24, 10, 4);
  } else {
    ctx.rect(4, 24, 56, 8); ctx.rect(6, 31, 16, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#9a6a3a'; ctx.fillRect(6, 31, 16, 12);
  }
  ctx.restore();
}

// ---------------- minimap ----------------
function mmTransform(cx, cy, R, size) { return { k: size / (2 * R), cx, cy, R, size }; }

function drawMinimap(ctx, s) {
  const pl = G.player;
  if (!pl) return;
  const size = 270 * s, x = 24 * s, y = G.H - size - 70 * s;
  const R = 700 + (pl.vehicle ? clamp(pl.vehicle.speed / 450, 0, 1) * 500 : 0);
  const T = mmTransform(pl.x, pl.y, R, size);
  const toMM = (wx, wy) => [x + size / 2 + (wx - pl.x) * T.k, y + size / 2 + (wy - pl.y) * T.k];
  ctx.save();
  // frame
  roundRect(ctx, x - 5 * s, y - 5 * s, size + 10 * s, size + 10 * s, 26 * s);
  ctx.fillStyle = 'rgba(8,6,18,0.85)'; ctx.fill();
  const g = ctx.createLinearGradient(x, y, x + size, y + size); g.addColorStop(0, UI.teal); g.addColorStop(1, UI.magenta);
  ctx.strokeStyle = g; ctx.lineWidth = 3 * s; ctx.stroke();
  roundRect(ctx, x, y, size, size, 22 * s);
  ctx.save(); ctx.clip();
  // map image
  const srcX = (pl.x - R - (LAND.x0 - 450)) * MAP_K, srcY = (pl.y - R - (LAND.y0 - 450)) * MAP_K;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(mapCanvas, srcX, srcY, 2 * R * MAP_K, 2 * R * MAP_K, x, y, size, size);
  // search area
  const W = G.wanted;
  if (W.stars > 0 && !W.seen) {
    const [sx, sy] = toMM(W.lastX, W.lastY);
    const rr = (260 + W.stars * 70) * T.k;
    ctx.fillStyle = Math.floor(G.realTime * 3) % 2 ? 'rgba(255,60,80,0.22)' : 'rgba(60,110,255,0.22)';
    ctx.beginPath(); ctx.arc(sx, sy, rr, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
  // GPS line
  if (gps.path) {
    ctx.strokeStyle = gps.color; ctx.lineWidth = 4 * s; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.85;
    ctx.beginPath(); gps.path.forEach(([wx, wy], i) => { const [mx, my] = toMM(wx, wy); i ? ctx.lineTo(mx, my) : ctx.moveTo(mx, my); }); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // traffic dots
  for (const v of G.vehicles) {
    if (Math.abs(v.x - pl.x) > R || Math.abs(v.y - pl.y) > R) continue;
    const [mx, my] = toMM(v.x, v.y);
    if (v.role === 'police' && v.siren) { ctx.fillStyle = Math.floor(G.realTime * 6) % 2 ? '#ff3344' : '#3377ff'; ctx.beginPath(); ctx.arc(mx, my, 5 * s, 0, TAU); ctx.fill(); }
  }
  for (const p of G.peds) {
    if (p.dead || p.vehicle) continue;
    if (Math.abs(p.x - pl.x) > R || Math.abs(p.y - pl.y) > R) continue;
    if (p.kind === 'cop' && W.stars > 0) { const [mx, my] = toMM(p.x, p.y); ctx.fillStyle = Math.floor(G.realTime * 6) % 2 ? '#ff3344' : '#3377ff'; ctx.beginPath(); ctx.arc(mx, my, 3.5 * s, 0, TAU); ctx.fill(); }
    else if (p.blip) { const [mx, my] = toMM(p.x, p.y); ctx.fillStyle = p.blip; ctx.beginPath(); ctx.arc(mx, my, 4 * s, 0, TAU); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); }
  }
  if (G.heli) { const [mx, my] = toMM(G.heli.x, G.heli.y); ctx.fillStyle = '#fff'; ctx.font = `${12 * s}px ${UI.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✣', mx, my); }
  ctx.restore();
  // blips (clamped to the edge)
  const clampB = (wx, wy) => {
    let [mx, my] = toMM(wx, wy);
    const m = 12 * s;
    mx = clamp(mx, x + m, x + size - m); my = clamp(my, y + m, y + size - m);
    return [mx, my];
  };
  for (const b of blipList()) {
    const [mx, my] = clampB(b.x, b.y);
    mapIcon(ctx, b.icon, mx, my, (b.big ? 11 : 9) * s, b.color);
  }
  if (G.waypoint) { const [mx, my] = clampB(G.waypoint.x, G.waypoint.y); mapIcon(ctx, 'target', mx, my, 9 * s, UI.purple); }
  // player arrow
  const a = pl.vehicle ? pl.vehicle.angle : pl.angle;
  ctx.save(); ctx.translate(x + size / 2, y + size / 2); ctx.rotate(a);
  ctx.beginPath(); ctx.moveTo(10 * s, 0); ctx.lineTo(-7 * s, -7 * s); ctx.lineTo(-3 * s, 0); ctx.lineTo(-7 * s, 7 * s); ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  // north marker
  text(ctx, 'N', x + size / 2, y + 16 * s, 13 * s, '#fff', 'center');
  // bars
  const bw = size, by = y + size + 14 * s;
  bar(ctx, x, by, bw * 0.62, 12 * s, pl.hp / pl.maxHp, pl.hp / pl.maxHp < 0.3 ? UI.red : '#4cff7a');
  bar(ctx, x + bw * 0.65, by, bw * 0.35, 12 * s, pl.armor / 100, UI.blue);
  if (!pl.vehicle) bar(ctx, x, by + 17 * s, bw * 0.62, 5 * s, pl.stamina, UI.gold);
  else bar(ctx, x, by + 17 * s, bw * 0.62, 5 * s, pl.vehicle.hp / pl.vehicle.maxHp, '#ff9a3d');
  ctx.restore();
}

function bar(ctx, x, y, w, h, v, color) {
  ctx.fillStyle = 'rgba(0,0,0,0.65)'; roundRect(ctx, x - 2, y - 2, w + 4, h + 4, (h + 4) / 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
  if (v > 0.01) { ctx.fillStyle = color; roundRect(ctx, x, y, Math.max(h, w * clamp(v, 0, 1)), h, h / 2); ctx.fill(); }
}

/** Landmarks and mission markers shown on maps. */
export function blipList(all = false) {
  const L = G.city.landmarks, out = [];
  const add = (lm, icon = lm.icon, color = lm.color) => out.push({ x: lm.x, y: lm.y, icon, color, name: lm.name });
  if (G.progress.safehouse) add(L.safehouse);
  add(L.garage); add(L.hospital); add(L.police); add(L.arms); add(L.respray);
  if (all) { add(L.bank); add(L.tower); add(L.freight); add(L.dex); add(L.kedai); }
  if (G.missionBlips) for (const b of G.missionBlips()) out.push(b);
  return out;
}

// ---------------- text elements ----------------
function drawObjective(ctx, s) {
  const o = G.ui.objective;
  if (!o) return;
  const size = 22 * s;
  const lines = wrap(ctx, o, G.W * 0.6, size, UI.body);
  lines.forEach((l, i) => text(ctx, l, G.W / 2, G.H - 34 * s - (lines.length - 1 - i) * size * 1.25, size, '#fff', 'center', UI.body));
}

function drawHelp(ctx, s) {
  const h = G.ui.help;
  if (!h) return;
  const w = 380 * s;
  const lines = wrap(ctx, h.text, w - 32 * s, 17 * s);
  const hh = (24 + lines.length * 22) * s;
  panel(ctx, 24 * s, 24 * s, w, hh, 10 * s);
  lines.forEach((l, i) => text(ctx, l, 40 * s, (50 + i * 22) * s, 17 * s, '#fff', 'left', UI.body, false));
}

function drawPopups(ctx, s) {
  const u = G.ui;
  const x = G.W - 32 * s;
  if (u.area) {
    const a = clamp(u.area.t, 0, 1);
    ctx.globalAlpha = a;
    const size = fitText(ctx, u.area.text, G.W * 0.4, 44 * s);
    text(ctx, u.area.text, x, G.H - 80 * s, size, u.area.color, 'right');
    text(ctx, u.area.sub.toUpperCase(), x, G.H - 52 * s, 15 * s, '#fff', 'right');
    ctx.globalAlpha = 1;
  }
  if (u.vehicleName) {
    ctx.globalAlpha = clamp(u.vehicleName.t, 0, 1);
    text(ctx, u.vehicleName.text, x, G.H - 132 * s, 30 * s, '#fff', 'right');
    ctx.globalAlpha = 1;
  }
  if (u.radioName) {
    ctx.globalAlpha = clamp(u.radioName.t, 0, 1);
    text(ctx, '♪ ' + u.radioName.text, G.W / 2, 50 * s, 26 * s, UI.teal, 'center');
    ctx.globalAlpha = 1;
  }
}

function drawMeters(ctx, s) {
  const u = G.ui;
  let y = 200 * s;
  if (u.timer) {
    const w = 260 * s;
    panel(ctx, G.W - w - 24 * s, y, w, 52 * s, 10 * s, UI.magenta);
    text(ctx, u.timer.label, G.W - w - 8 * s, y + 33 * s, 16 * s, '#fff', 'left');
    text(ctx, Math.ceil(u.timer.value).toString(), G.W - 40 * s, y + 38 * s, 28 * s, UI.gold, 'right');
    y += 62 * s;
  }
  if (u.meter) {
    const w = 260 * s;
    panel(ctx, G.W - w - 24 * s, y, w, 62 * s, 10 * s, UI.magenta);
    text(ctx, u.meter.label, G.W - w - 8 * s, y + 26 * s, 15 * s, '#fff', 'left');
    if (u.meter.text) text(ctx, u.meter.text, G.W - 40 * s, y + 26 * s, 15 * s, UI.gold, 'right');
    bar(ctx, G.W - w - 8 * s, y + 38 * s, w - 32 * s, 10 * s, u.meter.value, u.meter.color || UI.magenta);
  }
}

function drawToasts(ctx, s) {
  let y = 196 * s + (G.ui.timer ? 62 * s : 0) + (G.ui.meter ? 72 * s : 0);
  for (const t of G.ui.toast) {
    ctx.globalAlpha = clamp(t.t, 0, 1);
    text(ctx, t.text, G.W - 30 * s, y + 20 * s, 18 * s, t.color, 'right');
    y += 28 * s;
  }
  ctx.globalAlpha = 1;
}

function drawBanner(ctx, s) {
  const b = G.ui.banner;
  if (!b) return;
  const k = b.max - b.t;
  const a = clamp(Math.min(k * 3, b.t * 1.5), 0, 1);
  ctx.globalAlpha = a;
  const y = G.H * 0.34;
  const g = ctx.createLinearGradient(0, 0, G.W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, y - 70 * s, G.W, 120 * s);
  const size = fitText(ctx, b.title, G.W * 0.9, 64 * s);
  ctx.save();
  ctx.shadowColor = b.color; ctx.shadowBlur = 24 * s;
  text(ctx, b.title, G.W / 2, y, size, b.color, 'center');
  ctx.restore();
  if (b.sub) text(ctx, b.sub, G.W / 2, y + 38 * s, 24 * s, '#fff', 'center');
  ctx.globalAlpha = 1;
}

function drawDownScreen(ctx, s) {
  const k = clamp(G.deathT / 0.8, 0, 1);
  ctx.fillStyle = `rgba(0,0,0,${0.35 * k})`; ctx.fillRect(0, 0, G.W, G.H);
  const word = G.mode === 'dead' ? 'FLATLINED' : 'CUFFED';
  const col = G.mode === 'dead' ? '#ff3b4f' : '#4d9dff';
  ctx.globalAlpha = k;
  ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 30;
  const size = 110 * s * (1 + (1 - k) * 0.3);
  text(ctx, word, G.W / 2, G.H / 2, size, col, 'center');
  ctx.restore();
  if (G.mode === 'dead') {
    // ECG flatline
    ctx.strokeStyle = col; ctx.lineWidth = 3 * s;
    ctx.beginPath();
    const y = G.H / 2 + 50 * s, w = 500 * s, x0 = G.W / 2 - w / 2;
    const p = clamp(G.deathT / 1.5, 0, 1);
    ctx.moveTo(x0, y);
    for (let i = 0; i <= 60 * p; i++) { const x = x0 + (i / 60) * w; const blip = i > 10 && i < 22 ? Math.sin((i - 10) / 12 * Math.PI * 3) * 30 * s * (1 - i / 22) : 0; ctx.lineTo(x, y - blip); }
    ctx.stroke();
  }
  text(ctx, G.mode === 'dead' ? 'Waking up at Selara General…' : 'Processing at Police HQ…', G.W / 2, G.H / 2 + 100 * s, 20 * s, '#fff', 'center', UI.body);
  ctx.globalAlpha = 1;
}

function drawCrosshair(ctx, s) {
  const { x, y } = input.mouse;
  const pl = G.player;
  const armed = pl && (pl.weapon !== 'fists' || pl.vehicle);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  const r = (armed ? 10 : 6) * s;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  ctx.strokeStyle = UI.magenta;
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * (r + 3), y + dy * (r + 3)); ctx.lineTo(x + dx * (r + 9 * s), y + dy * (r + 9 * s)); }
  ctx.stroke();
  ctx.fillStyle = UI.teal; ctx.beginPath(); ctx.arc(x, y, 2, 0, TAU); ctx.fill();
}

// ---------------- big map ----------------
let mapView = null;
export function openMap() { mapView = null; }
function mapLayout() {
  const pad = 40;
  const h = G.H - pad * 2, w = h * (mapCanvas.width / mapCanvas.height);
  const x = (G.W - w) / 2 - Math.min(160, G.W * 0.08), y = pad;
  return { x, y, w, h, k: w / mapCanvas.width * MAP_K };
}
const worldToMap = (L, wx, wy) => [L.x + (wx - (LAND.x0 - 450)) * L.k, L.y + (wy - (LAND.y0 - 450)) * L.k];

export function updateMap() {
  const L = mapLayout();
  if (input.pressed.has('KeyM') || input.pressed.has('Escape')) { G.mode = 'playing'; return; }
  if (input.mouse.clicked) {
    const wx = (input.mouse.x - L.x) / L.k + LAND.x0 - 450, wy = (input.mouse.y - L.y) / L.k + LAND.y0 - 450;
    if (wx > LAND.x0 && wx < LAND.x1 && wy > LAND.y0 && wy < LAND.y1) { G.waypoint = { x: wx, y: wy }; gps.t = 0; }
  }
  if (input.mouse.rclicked) G.waypoint = null;
}

export function drawMap(ctx) {
  const s = uiScale(G);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(6,5,14,0.92)'; ctx.fillRect(0, 0, G.W, G.H);
  const L = mapLayout();
  ctx.drawImage(mapCanvas, L.x, L.y, L.w, L.h);
  ctx.strokeStyle = UI.teal; ctx.lineWidth = 2; ctx.strokeRect(L.x, L.y, L.w, L.h);
  // district names
  const groups = {};
  for (const b of G.city.blocks) { const d = b.district; (groups[d] = groups[d] || []).push(b); }
  for (const d in groups) {
    if (d === 'park') continue;
    let sx = 0, sy = 0; for (const b of groups[d]) { sx += b.x + b.w / 2; sy += b.y + b.h / 2; }
    const [mx, my] = worldToMap(L, sx / groups[d].length, sy / groups[d].length + (d === 'pantai' ? 120 : 0));
    text(ctx, DISTRICTS[d].name.toUpperCase(), mx, my, 20 * s, DISTRICTS[d].color, 'center');
  }
  for (const b of blipList(true)) { const [mx, my] = worldToMap(L, b.x, b.y); mapIcon(ctx, b.icon, mx, my, 11 * s, b.color); }
  if (G.waypoint) { const [mx, my] = worldToMap(L, G.waypoint.x, G.waypoint.y); mapIcon(ctx, 'target', mx, my, 11 * s, UI.purple); }
  if (gps.path) {
    ctx.strokeStyle = gps.color; ctx.lineWidth = 3; ctx.beginPath();
    gps.path.forEach(([wx, wy], i) => { const [mx, my] = worldToMap(L, wx, wy); i ? ctx.lineTo(mx, my) : ctx.moveTo(mx, my); }); ctx.stroke();
  }
  const pl = G.player;
  if (pl) {
    const [mx, my] = worldToMap(L, pl.x, pl.y);
    const pulse = 8 + Math.sin(G.realTime * 5) * 3;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mx, my, pulse + 6, 0, TAU); ctx.stroke();
    ctx.save(); ctx.translate(mx, my); ctx.rotate(pl.vehicle ? pl.vehicle.angle : pl.angle);
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-8, -8); ctx.lineTo(-4, 0); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.restore();
  }
  // legend
  const lw = 280 * s, lx = Math.min(G.W - lw - 24 * s, L.x + L.w + 24 * s), ly = L.y;
  const items = [['house', '#2ff3e0', 'Safehouse (save)'], ['wrench', '#ffb347', "Lin's Garage"], ['cross', '#ff4d5e', 'Hospital'], ['badge', '#4d8dff', 'Police HQ'],
    ['gun', '#ff7a3d', 'Bang Bang Arms'], ['spray', '#3dff8a', 'Kilat Respray'], ['bank', '#ffd84d', 'Bank Samudra'], ['orchid', '#c45cff', 'Black Orchid'],
    ['laptop', '#9dff4d', "Dex's Apartment"], ['cup', '#ff6fd8', 'Kedai Orchid'], ['mission', '#ffd23f', 'Mission'], ['target', UI.purple, 'Waypoint']];
  panel(ctx, lx, ly, lw, (70 + items.length * 30 + 70) * s, 12 * s);
  text(ctx, 'SELARA BAY', lx + 18 * s, ly + 38 * s, 24 * s, '#fff');
  items.forEach(([ic, c, label], i) => { const yy = ly + (72 + i * 30) * s; mapIcon(ctx, ic, lx + 30 * s, yy, 10 * s, c); text(ctx, label, lx + 50 * s, yy + 6 * s, 16 * s, '#ddd', 'left', UI.body, false); });
  const fy = ly + (78 + items.length * 30) * s;
  text(ctx, 'Click: set waypoint', lx + 18 * s, fy + 10 * s, 14 * s, UI.teal, 'left', UI.body, false);
  text(ctx, 'Right click: clear · M / Esc: close', lx + 18 * s, fy + 32 * s, 14 * s, UI.teal, 'left', UI.body, false);
  drawCrosshair(ctx, s);
}
