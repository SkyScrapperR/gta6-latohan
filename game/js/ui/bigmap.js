// Full-screen city map (M): district names, legend, landmarks, GPS route, player marker.
// Clicking sets a waypoint (shown on the minimap and as a light beam in the 3D world).
import { G } from '../core/state.js';
import { input } from '../core/input.js';
import { TAU } from '../core/math.js';
import { LAND, DISTRICTS } from '../world/city.js';
import { UI, uiScale, panel, text, mapIcon } from './theme.js';
import { getMapCanvas, MAP_K, MAP_ORIGIN, blipList, gpsPath } from './minimap.js';

export function init() {}
export function open() {}
function layout() {
  const mc = getMapCanvas(), pad = 40;
  const h = G.H - pad * 2, w = h * mc.width / mc.height;
  const x = (G.W - w) / 2 - Math.min(170, G.W * 0.09), y = pad;
  return { x, y, w, h, k: w / mc.width * MAP_K };
}
const toMap = (L, x, z) => [L.x + (x - MAP_ORIGIN.x) * L.k, L.y + (z - MAP_ORIGIN.z) * L.k];

export function update() {
  if (input.pressed.has('KeyM') || input.pressed.has('Escape')) { G.mode = 'playing'; return; }
  const L = layout();
  if (input.mouse.clicked) {
    const x = (input.mouse.x - L.x) / L.k + MAP_ORIGIN.x, z = (input.mouse.y - L.y) / L.k + MAP_ORIGIN.z;
    if (x > LAND.x0 && x < LAND.x1 && z > LAND.z0 && z < LAND.z1) { G.waypoint = { x, z }; G.toast('Waypoint set', UI.purple); }
  }
  if (input.mouse.rclicked) G.waypoint = null;
}

export function draw(ctx) {
  const s = uiScale(G), L = layout();
  ctx.fillStyle = 'rgba(6,5,14,0.88)'; ctx.fillRect(0, 0, G.W, G.H);
  ctx.drawImage(getMapCanvas(), L.x, L.y, L.w, L.h);
  ctx.strokeStyle = UI.teal; ctx.lineWidth = 2; ctx.strokeRect(L.x, L.y, L.w, L.h);
  const groups = {};
  for (const b of G.city.blocks) (groups[b.district] = groups[b.district] || []).push(b);
  for (const d in groups) {
    if (d === 'park') continue;
    let sx = 0, sz = 0; for (const b of groups[d]) { sx += b.x + b.w / 2; sz += b.z + b.d / 2; }
    const [mx, my] = toMap(L, sx / groups[d].length, sz / groups[d].length + (d === 'pantai' ? 40 : 0));
    text(ctx, DISTRICTS[d].name.toUpperCase(), mx, my, 20 * s, DISTRICTS[d].color, 'center');
  }
  const gps = gpsPath();
  if (gps.path) { ctx.strokeStyle = gps.color; ctx.lineWidth = 3; ctx.beginPath(); gps.path.forEach(([x, z], i) => { const [mx, my] = toMap(L, x, z); i ? ctx.lineTo(mx, my) : ctx.moveTo(mx, my); }); ctx.stroke(); }
  for (const b of blipList(true)) { const [mx, my] = toMap(L, b.x, b.z); mapIcon(ctx, b.icon, mx, my, 11 * s, b.color); }
  if (G.waypoint) { const [mx, my] = toMap(L, G.waypoint.x, G.waypoint.z); mapIcon(ctx, 'target', mx, my, 11 * s, UI.purple); }
  const pl = G.player;
  if (pl) {
    const [mx, my] = toMap(L, pl.x, pl.z);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mx, my, 14 + Math.sin(G.realTime * 5) * 3, 0, TAU); ctx.stroke();
    ctx.save(); ctx.translate(mx, my); ctx.rotate(pl.vehicle ? pl.vehicle.angle : pl.angle);
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-8, -8); ctx.lineTo(-4, 0); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.stroke(); ctx.restore();
  }
  const items = [['house', '#2ff3e0', 'Safehouse (save)'], ['wrench', '#ffb347', "Lin's Garage"], ['cross', '#ff4d5e', 'Hospital'], ['badge', '#4d8dff', 'Police HQ'], ['gun', '#ff7a3d', 'Bang Bang Arms'],
    ['spray', '#3dff8a', 'Kilat Respray'], ['bank', '#ffd84d', 'Bank Samudra'], ['orchid', '#c45cff', 'Black Orchid'], ['laptop', '#9dff4d', "Dex's Apartment"], ['cup', '#ff6fd8', 'Kedai Orchid'], ['mission', '#ffd23f', 'Mission'], ['target', UI.purple, 'Waypoint']];
  const lw = 290 * s, lx = Math.min(G.W - lw - 24 * s, L.x + L.w + 24 * s), ly = L.y;
  panel(ctx, lx, ly, lw, (150 + items.length * 30) * s, 12 * s);
  text(ctx, 'SELARA BAY', lx + 18 * s, ly + 38 * s, 24 * s, '#fff');
  items.forEach(([ic, c, label], i) => { const yy = ly + (72 + i * 30) * s; mapIcon(ctx, ic, lx + 30 * s, yy, 10 * s, c); text(ctx, label, lx + 50 * s, yy + 6 * s, 16 * s, '#ddd', 'left', UI.body, false); });
  const fy = ly + (82 + items.length * 30) * s;
  text(ctx, 'Click: set waypoint', lx + 18 * s, fy + 10 * s, 14 * s, UI.teal, 'left', UI.body, false);
  text(ctx, 'Right click: clear · M / Esc: close', lx + 18 * s, fy + 32 * s, 14 * s, UI.teal, 'left', UI.body, false);
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(input.mouse.x, input.mouse.y, 4, 0, TAU); ctx.fill();
}
