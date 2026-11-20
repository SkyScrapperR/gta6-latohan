// In-game HUD (2D canvas overlay): clock/money/weapon/ammo/stars panel, minimap, objective,
// help tip, area/vehicle/radio pop-ups, timers and meters, a dynamic crosshair with hit markers,
// damage-direction indicators, the FLATLINED / CUFFED screens, and a notification system with a
// priority queue and fixed screen slots so banners and toasts never overlap.
import { G } from '../core/state.js';
import { clamp, TAU, formatMoney, formatClock, roundRect } from '../core/math.js';
import { WEAPONS } from '../combat/weapons.js';
import { UI, uiScale, panel, text, fitText, wrap, star } from './theme.js';
import { initMinimap, drawMinimap, tickGPS } from './minimap.js';
import { rig } from '../camera-rig.js';

const queue = [];       // pending banners, highest priority first
let banner = null;      // banner currently in the banner slot
const toasts = [];      // toast column (max 4 slots)

export function init() { initMinimap(); }

/** Notifications: { kind: 'banner'|'toast', ... }. Banners queue by priority; toasts fill fixed slots. */
export function notify(n) {
  if (n.kind === 'toast') { toasts.push({ text: n.text, color: n.color || '#fff', t: 2.8 }); while (toasts.length > 4) toasts.shift(); return; }
  const b = { title: n.title, sub: n.sub || '', color: n.color || UI.teal, t: n.time || 4, max: n.time || 4, priority: n.priority || 1 };
  if (banner && b.priority > banner.priority) { queue.unshift(banner); banner = b; }
  else { queue.push(b); queue.sort((a, c) => c.priority - a.priority); }
}
export function clearNotifications() { banner = null; queue.length = 0; toasts.length = 0; }

function tick(dt) {
  const u = G.ui;
  for (const k of ['help', 'area', 'vehicleName', 'radioName']) if (u[k]) { u[k].t -= dt; if (u[k].t <= 0) u[k] = null; }
  for (let i = toasts.length - 1; i >= 0; i--) { toasts[i].t -= dt; if (toasts[i].t <= 0) toasts.splice(i, 1); }
  if (G.mode !== 'cutscene') {
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    if (!banner && queue.length) banner = queue.shift();
  }
  u.hitMarker = Math.max(0, u.hitMarker - dt);
  u.crossBloom = Math.max(0, u.crossBloom - dt * 2.5);
  for (let i = u.damageDirs.length - 1; i >= 0; i--) { u.damageDirs[i].t -= dt; if (u.damageDirs[i].t <= 0) u.damageDirs.splice(i, 1); }
  tickGPS(dt);
}

export function draw(ctx, dt) {
  tick(dt);
  const s = uiScale(G);
  if (G.mode !== 'cutscene') {
    drawTopRight(ctx, s);
    drawMinimap(ctx, s);
    drawObjective(ctx, s);
    drawHelp(ctx, s);
    drawPopups(ctx, s);
    const y = drawMeters(ctx, s);
    drawToasts(ctx, s, y);
    drawDamageDirs(ctx, s);
    if (G.mode === 'playing') drawCrosshair(ctx, s);
  }
  if (G.mode !== 'cutscene') drawBanner(ctx, s);
  if (G.mode === 'dead' || G.mode === 'busted') drawDownScreen(ctx, s);
}

function drawTopRight(ctx, s) {
  const w = 310 * s, h = 156 * s, x = G.W - w - 24 * s, y = 22 * s;
  panel(ctx, x, y, w, h, 12 * s);
  const r = x + w - 18 * s;
  text(ctx, formatClock(G.clock), r, y + 46 * s, 38 * s, '#fff', 'right');
  text(ctx, formatMoney(G.moneyShown), r, y + 86 * s, 30 * s, G.moneyShown < G.money - 0.5 ? '#b9ffcc' : UI.green, 'right');
  const pl = G.player;
  if (pl) {
    drawWeaponIcon(ctx, pl.weapon, x + 22 * s, y + 22 * s, 66 * s);
    text(ctx, WEAPONS[pl.weapon].name.toUpperCase(), x + 22 * s, y + 106 * s, 13 * s, '#cfe', 'left');
    if (pl.weapon !== 'fists') {
      const reloading = pl.reloading > 0;
      text(ctx, reloading ? 'RELOAD' : `${pl.clip[pl.weapon]} / ${pl.ammo[pl.weapon]}`, x + 22 * s, y + 128 * s, 15 * s, reloading ? UI.gold : pl.clip[pl.weapon] > 0 ? '#fff' : UI.red, 'left');
    }
  }
  const W = G.wanted, unseen = W.stars > 0 && !W.seen;
  for (let i = 0; i < 5; i++) {
    const on = i < W.stars;
    let fill = on ? UI.gold : 'rgba(255,255,255,0.12)';
    if (on && unseen && Math.floor(G.realTime * 4) % 2) fill = 'rgba(255,210,63,0.25)';
    if (on && W.flash > 0) fill = Math.floor(G.realTime * 10) % 2 ? '#fff' : UI.gold;
    star(ctx, r - (4 - i) * 30 * s - 10 * s, y + 128 * s, 12 * s, fill);
  }
}

export function drawWeaponIcon(ctx, wid, x, y, size) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 64, size / 64);
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; roundRect(ctx, 0, 0, 64, 60, 8); ctx.fill();
  ctx.fillStyle = '#e8eef5'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath();
  if (wid === 'fists') { roundRect(ctx, 16, 20, 30, 22, 7); ctx.fill(); ctx.stroke(); ctx.beginPath(); for (let i = 0; i < 3; i++) { ctx.moveTo(24 + i * 8, 20); ctx.lineTo(24 + i * 8, 30); } ctx.stroke(); }
  else if (wid === 'kobra') { ctx.rect(12, 20, 38, 9); ctx.rect(14, 28, 10, 18); ctx.fill(); ctx.stroke(); }
  else if (wid === 'wasp') { ctx.rect(8, 22, 46, 10); ctx.rect(18, 31, 8, 16); ctx.rect(32, 31, 5, 12); ctx.fill(); ctx.stroke(); ctx.fillStyle = UI.gold; ctx.fillRect(40, 24, 10, 4); }
  else { ctx.rect(4, 24, 56, 8); ctx.rect(6, 31, 16, 12); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#9a6a3a'; ctx.fillRect(6, 31, 16, 12); }
  ctx.restore();
}

function drawObjective(ctx, s) {
  const o = G.ui.objective;
  if (!o) return;
  const size = 22 * s, lines = wrap(ctx, o, G.W * 0.55, size, UI.body);
  lines.forEach((l, i) => text(ctx, l, G.W / 2, G.H - 30 * s - (lines.length - 1 - i) * size * 1.25, size, '#fff', 'center', UI.body));
}
function drawHelp(ctx, s) {
  const h = G.ui.help;
  if (!h) return;
  const w = 390 * s, lines = wrap(ctx, h.text, w - 32 * s, 17 * s), hh = (24 + lines.length * 22) * s;
  panel(ctx, 24 * s, 24 * s, w, hh, 10 * s);
  lines.forEach((l, i) => text(ctx, l, 40 * s, (50 + i * 22) * s, 17 * s, '#fff', 'left', UI.body, false));
}
function drawPopups(ctx, s) {
  const u = G.ui, x = G.W - 32 * s;
  if (u.area) {
    ctx.globalAlpha = clamp(u.area.t, 0, 1);
    const size = fitText(ctx, u.area.text, G.W * 0.4, 44 * s);
    text(ctx, u.area.text, x, G.H - 76 * s, size, u.area.color, 'right');
    text(ctx, u.area.sub.toUpperCase(), x, G.H - 50 * s, 15 * s, '#fff', 'right');
    ctx.globalAlpha = 1;
  }
  if (u.vehicleName) { ctx.globalAlpha = clamp(u.vehicleName.t, 0, 1); text(ctx, u.vehicleName.text, x, G.H - 128 * s, 30 * s, '#fff', 'right'); ctx.globalAlpha = 1; }
  if (u.radioName) { ctx.globalAlpha = clamp(u.radioName.t, 0, 1); text(ctx, '♪ ' + u.radioName.text, G.W / 2, 52 * s, 26 * s, UI.teal, 'center'); ctx.globalAlpha = 1; }
}
/** Timer and meter occupy the slot under the top-right panel; returns the next free y. */
function drawMeters(ctx, s) {
  const u = G.ui, w = 270 * s, x = G.W - w - 24 * s;
  let y = 190 * s;
  if (u.timer) {
    panel(ctx, x, y, w, 52 * s, 10 * s, UI.magenta);
    text(ctx, u.timer.label, x + 16 * s, y + 33 * s, 16 * s, '#fff');
    text(ctx, Math.ceil(u.timer.value).toString(), x + w - 16 * s, y + 38 * s, 28 * s, UI.gold, 'right');
    y += 62 * s;
  }
  if (u.meter) {
    panel(ctx, x, y, w, 62 * s, 10 * s, UI.magenta);
    text(ctx, u.meter.label, x + 16 * s, y + 26 * s, 15 * s, '#fff');
    if (u.meter.text) text(ctx, u.meter.text, x + w - 16 * s, y + 26 * s, 15 * s, UI.gold, 'right');
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 16 * s, y + 38 * s, w - 32 * s, 10 * s);
    ctx.fillStyle = u.meter.color || UI.magenta; ctx.fillRect(x + 16 * s, y + 38 * s, (w - 32 * s) * clamp(u.meter.value, 0, 1), 10 * s);
    y += 72 * s;
  }
  return y;
}
function drawToasts(ctx, s, y0) {
  toasts.forEach((t, i) => {
    ctx.globalAlpha = clamp(t.t * 2, 0, 1);
    text(ctx, t.text, G.W - 30 * s, y0 + 22 * s + i * 30 * s, 19 * s, t.color, 'right');
  });
  ctx.globalAlpha = 1;
}
function drawBanner(ctx, s) {
  const b = banner;
  if (!b) return;
  const a = clamp(Math.min((b.max - b.t) * 3, b.t * 1.5), 0, 1);
  ctx.globalAlpha = a;
  const y = G.H * 0.3;
  const g = ctx.createLinearGradient(0, 0, G.W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, y - 70 * s, G.W, 122 * s);
  const size = fitText(ctx, b.title, G.W * 0.9, 66 * s);
  ctx.save(); ctx.shadowColor = b.color; ctx.shadowBlur = 26 * s; text(ctx, b.title, G.W / 2, y, size, b.color, 'center'); ctx.restore();
  if (b.sub) text(ctx, b.sub, G.W / 2, y + 40 * s, 24 * s, '#fff', 'center');
  ctx.globalAlpha = 1;
}
function drawCrosshair(ctx, s) {
  const pl = G.player;
  if (!pl || !pl.alive) return;
  const x = G.W / 2, y = G.H / 2;
  const aiming = pl.aiming || pl.vehicle;
  if (!aiming && pl.weapon === 'fists') { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(x, y, 2.5 * s, 0, TAU); ctx.fill(); }
  else {
    const gap = (6 + G.ui.crossBloom * 16 + (pl.speedNow > 5 ? 6 : 0)) * s, len = 9 * s;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * s; ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * gap, y + dy * gap); ctx.lineTo(x + dx * (gap + len), y + dy * (gap + len)); }
    ctx.stroke(); ctx.shadowBlur = 0;
    ctx.fillStyle = UI.teal; ctx.beginPath(); ctx.arc(x, y, 1.8 * s, 0, TAU); ctx.fill();
  }
  if (G.ui.hitMarker > 0) {
    ctx.strokeStyle = G.ui.hitKill ? UI.red : '#fff'; ctx.lineWidth = 2.5 * s; ctx.globalAlpha = clamp(G.ui.hitMarker * 4, 0, 1);
    const a = 6 * s, b = 13 * s;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { ctx.moveTo(x + dx * a, y + dy * a); ctx.lineTo(x + dx * b, y + dy * b); }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
}
function drawDamageDirs(ctx, s) {
  const pl = G.player;
  if (!pl) return;
  for (const d of G.ui.damageDirs) {
    const rel = d.a - rig.yaw - Math.PI / 2;
    const r = Math.min(G.W, G.H) * 0.22;
    ctx.save(); ctx.translate(G.W / 2, G.H / 2); ctx.rotate(rel + Math.PI / 2 - Math.PI / 2);
    ctx.globalAlpha = clamp(d.t, 0, 1);
    ctx.strokeStyle = 'rgba(255,40,50,0.9)'; ctx.lineWidth = 8 * s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0, r, -0.25, 0.25); ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
function drawDownScreen(ctx, s) {
  const k = clamp(G.deathT / 0.8, 0, 1);
  ctx.fillStyle = `rgba(0,0,0,${0.3 * k})`; ctx.fillRect(0, 0, G.W, G.H);
  const word = G.mode === 'dead' ? 'FLATLINED' : 'CUFFED', col = G.mode === 'dead' ? '#ff3b4f' : '#4d9dff';
  ctx.globalAlpha = k;
  ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 34; text(ctx, word, G.W / 2, G.H / 2, 112 * s * (1 + (1 - k) * 0.3), col, 'center'); ctx.restore();
  if (G.mode === 'dead') {
    ctx.strokeStyle = col; ctx.lineWidth = 3 * s; ctx.beginPath();
    const y = G.H / 2 + 50 * s, w = 500 * s, x0 = G.W / 2 - w / 2, p = clamp(G.deathT / 1.5, 0, 1);
    ctx.moveTo(x0, y);
    for (let i = 0; i <= 60 * p; i++) { const bl = i > 10 && i < 22 ? Math.sin((i - 10) / 12 * Math.PI * 3) * 30 * s * (1 - i / 22) : 0; ctx.lineTo(x0 + i / 60 * w, y - bl); }
    ctx.stroke();
  }
  text(ctx, G.mode === 'dead' ? 'Waking up at Selara General…' : 'Processing at Police HQ…', G.W / 2, G.H / 2 + 100 * s, 20 * s, '#fff', 'center', UI.body);
  ctx.globalAlpha = 1;
}
