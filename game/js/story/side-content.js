// Side content in the open world: the safehouse SAVE marker, Bang Bang Arms (gun shop)
// and Kilat Respray (clears your wanted level for $100). Also the shared marker renderer.
import { G } from '../state.js';
import { input } from '../input.js';
import { TAU, formatMoney } from '../util.js';
import { WEAPONS } from '../combat/weapons.js';
import { clearWanted } from '../ai/police.js';
import { MODELS } from '../entities/vehicle.js';
import { addLight, addGlow } from '../fx/lighting.js';
import { project } from '../world/render-city.js';
import { UI, uiScale, panel, text } from '../ui/theme.js';
import * as Save from '../save.js';
import { sfx } from '../audio/audio.js';

const state = { inSave: false, inShop: false, inRespray: false };
const SHOP = [
  { key: 'Digit1', label: 'Kobra 9', weapon: 'kobra' },
  { key: 'Digit2', label: 'Wasp', weapon: 'wasp' },
  { key: 'Digit3', label: 'Thunder', weapon: 'thunder' },
  { key: 'Digit4', label: 'Body armor', armor: true, price: 250 },
];

const near = (a, b, r) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < r * r;

export function update(dt) {
  const pl = G.player, L = G.city.landmarks;
  if (!pl || !pl.alive || G.mode !== 'playing') return;
  // safehouse save
  const atSave = G.progress.safehouse && !pl.vehicle && near(pl, L.safehouse, 26);
  if (atSave && !state.inSave) {
    if (G.mission) G.toast("Can't save during a mission", UI.red);
    else if (G.wanted.stars > 0) G.toast('Lose the heat before saving', UI.red);
    else { pl.hp = pl.maxHp; Save.save(); G.toast('Game saved', UI.teal); sfx('save'); }
  }
  state.inSave = atSave;
  // gun shop
  state.inShop = !pl.vehicle && near(pl, L.arms, 30);
  if (state.inShop) {
    for (const it of SHOP) if (input.pressed.has(it.key)) buy(it);
  }
  // respray
  const v = pl.vehicle;
  const atRespray = v && near(v, L.respray, 40);
  if (atRespray && !state.inRespray) {
    const damaged = v.hp < v.maxHp * 0.95;
    if (G.wanted.stars === 0 && !damaged) G.help('Kilat Respray: bring the car back when it needs work or has heat on it. $100.', 3);
    else if (G.money < 100) G.help('Kilat Respray costs $100. Come back with cash.', 3);
    else {
      G.addMoney(-100);
      const had = G.wanted.stars > 0;
      clearWanted();
      const cols = MODELS[v.model].colors;
      if (!v.noRespray && v.model !== 'patrol' && v.model !== 'taxi') v.color = [30 + Math.random() * 220, 30 + Math.random() * 220, 30 + Math.random() * 220];
      if (!v.noRespray && cols.length > 1 && Math.random() < 0.5) v.color = cols[Math.floor(Math.random() * cols.length)];
      v.hp = v.maxHp; v.onFire = false;
      G.banner('KILAT RESPRAY', had ? 'Fresh paint. Clean slate.  −$100' : 'Good as new.  −$100', '#3dff8a', 3);
      sfx('spray');
    }
  }
  state.inRespray = !!atRespray;
}

function buy(it) {
  const pl = G.player;
  if (it.armor) {
    if (G.money < it.price) { G.toast('Not enough cash', UI.red); sfx('error'); return; }
    if (pl.armor >= 100) { G.toast('Armor already full', '#aaa'); return; }
    G.addMoney(-it.price); pl.armor = 100; sfx('cash'); G.toast('Armor equipped', UI.blue); return;
  }
  const w = WEAPONS[it.weapon];
  const owned = pl.weapons[it.weapon];
  const price = owned ? w.ammoPrice : w.price;
  if (G.money < price) { G.toast('Not enough cash', UI.red); sfx('error'); return; }
  G.addMoney(-price);
  pl.giveWeapon(it.weapon, w.pickupAmmo);
  pl.weapon = it.weapon;
  sfx('cash');
  G.toast(owned ? `${w.name} ammo +${w.pickupAmmo}` : `Bought ${w.name}`, UI.gold);
}

export function drawUI(ctx) {
  if (!state.inShop || G.mode !== 'playing') return;
  const s = uiScale(G), pl = G.player;
  const w = 380 * s, h = 250 * s, x = 24 * s, y = 24 * s;
  panel(ctx, x, y, w, h, 12 * s, UI.gold);
  text(ctx, 'BANG BANG ARMS', x + 20 * s, y + 38 * s, 24 * s, '#ff7a3d');
  SHOP.forEach((it, i) => {
    const yy = y + (74 + i * 38) * s;
    let label = it.label, price;
    if (it.armor) price = it.price;
    else { const owned = pl.weapons[it.weapon]; price = owned ? WEAPONS[it.weapon].ammoPrice : WEAPONS[it.weapon].price; if (owned) label += ' ammo'; }
    text(ctx, `${i + 1}`, x + 22 * s, yy, 20 * s, UI.teal);
    text(ctx, label, x + 50 * s, yy, 19 * s, '#fff', 'left', UI.body, false);
    text(ctx, formatMoney(price), x + w - 20 * s, yy, 19 * s, G.money >= price ? UI.green : UI.red, 'right');
  });
  text(ctx, 'Press 1–4 to buy', x + 20 * s, y + h - 16 * s, 14 * s, '#aaa', 'left', UI.body, false);
}

/** Glowing ground ring + light column used for shops, save and mission markers. */
export function drawMarker(ctx, x, y, color, t, r = 22, label = null) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 4 + x);
  const rgb = color;
  ctx.save();
  ctx.fillStyle = `rgba(${rgb},${0.18 + 0.12 * pulse})`;
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.92, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = `rgba(${rgb},0.95)`; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(x, y, r * (0.8 + 0.2 * pulse), r * (0.75 + 0.2 * pulse), 0, 0, TAU); ctx.stroke();
  // light column leaning with the 2.5D projection
  const [tx, ty] = project(x, y, 90);
  const g = ctx.createLinearGradient(x, y, tx, ty);
  g.addColorStop(0, `rgba(${rgb},0.55)`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.strokeStyle = g; ctx.lineWidth = r * 1.2; ctx.lineCap = 'round';
  ctx.globalAlpha = 0.55;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.restore();
  addLight(x, y, r * 3, rgb, 0.45);
  addGlow(x, y, r * 1.6, rgb, 0.5);
  if (label) {
    ctx.font = `900 11px ${UI.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(label, x, y - r - 8);
    ctx.fillStyle = `rgb(${rgb})`; ctx.fillText(label, x, y - r - 8);
  }
}

export function drawMarkers(ctx, view, t) {
  const L = G.city.landmarks;
  const vis = (p) => p.x > view.x0 - 60 && p.x < view.x1 + 60 && p.y > view.y0 - 60 && p.y < view.y1 + 60;
  if (G.progress.safehouse && vis(L.safehouse)) drawMarker(ctx, L.safehouse.x, L.safehouse.y, '47,243,224', t, 20, 'SAVE');
  if (vis(L.arms)) drawMarker(ctx, L.arms.x, L.arms.y, '255,122,61', t, 22, 'GUNS');
  if (vis(L.respray)) drawMarker(ctx, L.respray.x, L.respray.y, '61,255,138', t, 34, 'RESPRAY $100');
}
