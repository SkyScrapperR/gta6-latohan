// Circular minimap that rotates with the camera heading: pre-rendered city map, GPS route
// along the road graph, landmark/mission blips (clamped to the rim), flashing cop blips,
// the police search area, and health/armor arcs around the rim.
import { G } from '../core/state.js';
import { clamp, TAU } from '../core/math.js';
import { CITY, LAND, PIERS, CELL, NB } from '../world/city.js';
import { nearestNode, bfsPath, nodeXZ } from '../world/roads.js';
import { rig } from '../camera-rig.js';
import { UI, text, mapIcon } from './theme.js';
import { clearTime } from '../ai/police.js';

export const MAP_K = 0.9;               // map canvas pixels per metre
export const MAP_ORIGIN = { x: LAND.x0 - 200, z: LAND.z0 - 200 };
let mapCanvas = null;
const DCOL = { downtown: '#33536b', kemuning: '#6e4e3e', bukit: '#44613b', docks: '#5f5b44', pantai: '#7c6b5a', park: '#3a7a44' };
const gps = { path: null, t: 0, color: UI.gold };

export function initMinimap() {
  const w = Math.ceil((LAND.x1 - LAND.x0 + 400) * MAP_K), h = Math.ceil((LAND.z1 - LAND.z0 + 400) * MAP_K);
  mapCanvas = document.createElement('canvas'); mapCanvas.width = w; mapCanvas.height = h;
  const c = mapCanvas.getContext('2d');
  c.scale(MAP_K, MAP_K); c.translate(-MAP_ORIGIN.x, -MAP_ORIGIN.z);
  c.fillStyle = '#0f3346'; c.fillRect(MAP_ORIGIN.x, MAP_ORIGIN.z, w / MAP_K, h / MAP_K);
  c.fillStyle = '#185068'; c.fillRect(LAND.x0 - 40, LAND.z0 - 40, LAND.x1 - LAND.x0 + 80, LAND.z1 - LAND.z0 + 80);
  c.fillStyle = '#56615a'; c.fillRect(LAND.x0, LAND.z0, LAND.x1 - LAND.x0, LAND.z1 - LAND.z0);
  c.fillStyle = '#d4bf86'; c.fillRect(LAND.x0, CITY + 6, LAND.x1 - LAND.x0, LAND.z1 - CITY - 6);
  c.fillStyle = '#8a6a48'; for (const p of PIERS) c.fillRect(p.x, p.z, p.w, p.d);
  c.fillStyle = '#c4c4c4'; c.fillRect(0, 0, CITY, CITY);
  for (const b of G.city.blocks) {
    c.fillStyle = DCOL[b.district] || '#555'; c.fillRect(b.x, b.z, b.w, b.d);
    if (b.pond) { c.fillStyle = '#2f86a8'; c.beginPath(); c.ellipse(b.pond.x, b.pond.z, b.pond.rx, b.pond.rz, 0, 0, TAU); c.fill(); }
  }
  c.fillStyle = 'rgba(0,0,0,0.28)';
  for (const b of G.city.buildings) if (b.y0 < 1) c.fillRect(b.x, b.z, b.w, b.d);
  return mapCanvas;
}
export function getMapCanvas() { return mapCanvas; }

export function tickGPS(dt) {
  gps.t -= dt;
  const tgt = G.waypoint || (G.missionTarget && G.missionTarget());
  if (!tgt || !G.player) { gps.path = null; return; }
  if (gps.t <= 0) {
    gps.t = 0.5;
    const p = G.player;
    const nodes = bfsPath(nearestNode(p.x, p.z), nearestNode(tgt.x, tgt.z));
    gps.path = [[p.x, p.z], ...nodes.map((n) => { const q = nodeXZ(n); return [q.x, q.z]; }), [tgt.x, tgt.z]];
    gps.color = G.waypoint ? UI.purple : UI.gold;
  }
  if (G.waypoint && Math.hypot(G.player.x - G.waypoint.x, G.player.z - G.waypoint.z) < 12) { G.waypoint = null; G.toast('Waypoint reached', UI.purple); }
}
export function gpsPath() { return gps; }

/** Landmark + mission blips. */
export function blipList(all = false) {
  const L = G.city.landmarks, out = [];
  const add = (lm) => out.push({ x: lm.x, z: lm.z, icon: lm.icon, color: lm.color, name: lm.name });
  if (G.progress.safehouse) add(L.safehouse);
  add(L.garage); add(L.hospital); add(L.police); add(L.arms); add(L.respray);
  if (all) { add(L.bank); add(L.tower); add(L.freight); add(L.dex); add(L.kedai); }
  if (G.missionBlips) for (const b of G.missionBlips()) out.push(b);
  return out;
}

export function drawMinimap(ctx, s) {
  const pl = G.player;
  if (!pl || !mapCanvas) return;
  const R = 128 * s, cx = 30 * s + R, cy = G.H - 34 * s - R;
  const range = 170 + (pl.vehicle ? clamp(pl.vehicle.speed / 50, 0, 1) * 130 : 0);  // metres from centre to rim
  const k = R / range;
  const rot = -rig.yaw - Math.PI / 2;
  const toMM = (x, z) => {
    const dx = (x - pl.x) * k, dz = (z - pl.z) * k;
    const c = Math.cos(rot), sn = Math.sin(rot);
    return [cx + dx * c - dz * sn, cy + dx * sn + dz * c];
  };
  ctx.save();
  // rim + arcs
  ctx.beginPath(); ctx.arc(cx, cy, R + 9 * s, 0, TAU); ctx.fillStyle = 'rgba(8,6,18,0.85)'; ctx.fill();
  const arc = (v, color, a0, a1) => {
    ctx.lineWidth = 6 * s; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.beginPath(); ctx.arc(cx, cy, R + 4.5 * s, a0, a1); ctx.stroke();
    if (v > 0.005) { ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(cx, cy, R + 4.5 * s, a0, a0 + (a1 - a0) * clamp(v, 0, 1)); ctx.stroke(); }
  };
  arc(pl.hp / pl.maxHp, pl.hp / pl.maxHp < 0.3 ? UI.red : '#4cff7a', Math.PI * 0.62, Math.PI * 1.38);
  arc(pl.armor / 100, UI.blue, Math.PI * 1.62, Math.PI * 2.38);
  // map
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(k / MAP_K, k / MAP_K);
  ctx.translate(-(pl.x - MAP_ORIGIN.x) * MAP_K, -(pl.z - MAP_ORIGIN.z) * MAP_K);
  ctx.drawImage(mapCanvas, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const W = G.wanted;
  if (W.stars > 0 && !W.seen) {
    const [sx, sy] = toMM(W.lastX, W.lastZ);
    ctx.fillStyle = Math.floor(G.realTime * 3) % 2 ? 'rgba(255,60,80,0.25)' : 'rgba(60,110,255,0.25)';
    ctx.beginPath(); ctx.arc(sx, sy, (40 + W.stars * 15) * k, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
  }
  if (gps.path) {
    ctx.strokeStyle = gps.color; ctx.lineWidth = 4.5 * s; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.9;
    ctx.beginPath(); gps.path.forEach(([x, z], i) => { const [mx, my] = toMM(x, z); i ? ctx.lineTo(mx, my) : ctx.moveTo(mx, my); }); ctx.stroke(); ctx.globalAlpha = 1;
  }
  const flash = Math.floor(G.realTime * 6) % 2 ? '#ff3344' : '#3377ff';
  for (const v of G.vehicles) if (v.siren && Math.abs(v.x - pl.x) < range && Math.abs(v.z - pl.z) < range) { const [mx, my] = toMM(v.x, v.z); ctx.fillStyle = flash; ctx.beginPath(); ctx.arc(mx, my, 4.5 * s, 0, TAU); ctx.fill(); }
  for (const p of G.peds) {
    if (p.dead || p.vehicle || Math.abs(p.x - pl.x) > range || Math.abs(p.z - pl.z) > range) continue;
    if (p.kind === 'cop' && W.stars > 0) { const [mx, my] = toMM(p.x, p.z); ctx.fillStyle = flash; ctx.beginPath(); ctx.arc(mx, my, 3 * s, 0, TAU); ctx.fill(); }
    else if (p.blip) { const [mx, my] = toMM(p.x, p.z); ctx.fillStyle = p.blip; ctx.beginPath(); ctx.arc(mx, my, 4 * s, 0, TAU); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); }
  }
  if (G.heli) { const [mx, my] = toMM(G.heli.x, G.heli.z); ctx.fillStyle = '#fff'; ctx.font = `${14 * s}px ${UI.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✣', mx, my); }
  ctx.restore();
  // blips clamped to the rim
  const clampB = (x, z) => {
    let [mx, my] = toMM(x, z);
    const dx = mx - cx, dy = my - cy, d = Math.hypot(dx, dy), max = R - 10 * s;
    if (d > max) { mx = cx + dx / d * max; my = cy + dy / d * max; }
    return [mx, my];
  };
  for (const b of blipList()) { const [mx, my] = clampB(b.x, b.z); mapIcon(ctx, b.icon, mx, my, (b.big ? 11 : 9) * s, b.color); }
  if (G.waypoint) { const [mx, my] = clampB(G.waypoint.x, G.waypoint.z); mapIcon(ctx, 'target', mx, my, 9 * s, UI.purple); }
  // player arrow (points where the character/car faces, relative to the camera)
  const a = (pl.vehicle ? pl.vehicle.angle : pl.angle) + rot;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
  ctx.beginPath(); ctx.moveTo(11 * s, 0); ctx.lineTo(-7 * s, -7 * s); ctx.lineTo(-3 * s, 0); ctx.lineTo(-7 * s, 7 * s); ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  // north marker on the rim
  const [nx, ny] = (() => { const c = Math.cos(rot), sn = Math.sin(rot); return [cx + (0 * c - (-1) * sn) * (R - 2 * s), cy + (0 * sn + (-1) * c) * (R - 2 * s)]; })();
  ctx.beginPath(); ctx.arc(nx, ny, 9 * s, 0, TAU); ctx.fillStyle = '#111'; ctx.fill();
  text(ctx, 'N', nx, ny + 5 * s, 13 * s, '#fff', 'center');
  if (W.stars > 0 && !W.seen) {
    const kk = clamp(W.unseen / clearTime(), 0, 1);
    ctx.strokeStyle = UI.teal; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.arc(cx, cy, R + 12 * s, -Math.PI / 2, -Math.PI / 2 + TAU * kk); ctx.stroke();
  }
  // stamina / vehicle health bar under the map
  const bw = R * 1.3, bx = cx - bw / 2, by = cy + R + 16 * s;
  const v = pl.vehicle ? pl.vehicle.hp / pl.vehicle.maxHp : pl.stamina;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx - 2, by - 2, bw + 4, 8 * s + 4);
  ctx.fillStyle = pl.vehicle ? '#ff9a3d' : UI.gold; ctx.fillRect(bx, by, bw * clamp(v, 0, 1), 8 * s);
}
