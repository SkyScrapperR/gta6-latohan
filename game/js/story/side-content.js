// Open-world side content: the safehouse SAVE marker, Bang Bang Arms (guns/ammo/armor),
// Kilat Respray (clears your wanted level for $100), and their 3D light-beam markers.
import { G } from '../core/state.js';
import { input } from '../core/input.js';
import { formatMoney, hex } from '../core/math.js';
import { WEAPONS } from '../combat/weapons.js';
import { clearWanted } from '../ai/police.js';
import { MODELS } from '../entities/vehicle.js';
import { UI, uiScale, panel, text } from '../ui/theme.js';
import * as Save from '../save.js';
import { sfx } from '../audio/audio.js';

const state = { inSave: false, inShop: false, inRespray: false };
const SHOP = [
  { key: 'Digit1', label: 'Kobra 9', weapon: 'kobra' }, { key: 'Digit2', label: 'Wasp', weapon: 'wasp' },
  { key: 'Digit3', label: 'Thunder', weapon: 'thunder' }, { key: 'Digit4', label: 'Body armor', armor: true, price: 250 },
];
const near = (a, b, r) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < r * r;

export function update() {
  const pl = G.player, L = G.city.landmarks;
  if (!pl || !pl.alive || G.mode !== 'playing') return;
  const atSave = G.progress.safehouse && !pl.vehicle && near(pl, L.safehouse, 2.2);
  if (atSave && !state.inSave) {
    if (G.mission) G.toast("Can't save during a mission", UI.red);
    else if (G.wanted.stars > 0) G.toast('Lose the heat before saving', UI.red);
    else { pl.hp = pl.maxHp; Save.save(); G.toast('Game saved', UI.teal); sfx('save'); }
  }
  state.inSave = atSave;
  state.inShop = !pl.vehicle && near(pl, L.arms, 2.6);
  if (state.inShop) for (const it of SHOP) if (input.pressed.has(it.key)) buy(it);
  const v = pl.vehicle, atRespray = v && near(v, L.respray, 4);
  if (atRespray && !state.inRespray) {
    const damaged = v.hp < v.maxHp * 0.95;
    if (G.wanted.stars === 0 && !damaged) G.help('Kilat Respray: bring the car back when it needs work or has heat on it. $100.', 3);
    else if (G.money < 100) G.help('Kilat Respray costs $100. Come back with cash.', 3);
    else {
      G.addMoney(-100);
      const had = G.wanted.stars > 0;
      clearWanted();
      if (!v.noRespray && v.model !== 'patrol' && v.model !== 'taxi') { const c = MODELS[v.model].colors; v.color = c[Math.floor(Math.random() * c.length)].map((x) => Math.min(1, x * (0.7 + Math.random() * 0.5))); }
      v.hp = v.maxHp; v.onFire = false;
      G.banner('KILAT RESPRAY', had ? 'Fresh paint. Clean slate.  −$100' : 'Good as new.  −$100', '#3dff8a', 3, 2);
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
  const w = WEAPONS[it.weapon], owned = pl.weapons[it.weapon], price = owned ? w.ammoPrice : w.price;
  if (G.money < price) { G.toast('Not enough cash', UI.red); sfx('error'); return; }
  G.addMoney(-price); pl.giveWeapon(it.weapon, w.pickupAmmo); pl.weapon = it.weapon; sfx('cash');
  G.toast(owned ? `${w.name} ammo +${w.pickupAmmo}` : `Bought ${w.name}`, UI.gold);
}

export function drawUI(ctx) {
  if (!state.inShop || G.mode !== 'playing') return;
  const s = uiScale(G), pl = G.player, w = 380 * s, h = 250 * s, x = 24 * s, y = 24 * s;
  panel(ctx, x, y, w, h, 12 * s, UI.gold);
  text(ctx, 'BANG BANG ARMS', x + 20 * s, y + 38 * s, 24 * s, '#ff7a3d');
  SHOP.forEach((it, i) => {
    const yy = y + (74 + i * 38) * s;
    let label = it.label, price;
    if (it.armor) price = it.price; else { const owned = pl.weapons[it.weapon]; price = owned ? WEAPONS[it.weapon].ammoPrice : WEAPONS[it.weapon].price; if (owned) label += ' ammo'; }
    text(ctx, `${i + 1}`, x + 22 * s, yy, 20 * s, UI.teal);
    text(ctx, label, x + 50 * s, yy, 19 * s, '#fff', 'left', UI.body, false);
    text(ctx, formatMoney(price), x + w - 20 * s, yy, 19 * s, G.money >= price ? UI.green : UI.red, 'right');
  });
  text(ctx, 'Press 1–4 to buy', x + 20 * s, y + h - 16 * s, 14 * s, '#aaa', 'left', UI.body, false);
}

/** Light-beam markers for shops and the save point. */
export function markerList() {
  const L = G.city.landmarks, out = [];
  if (G.progress.safehouse) out.push({ x: L.safehouse.x, z: L.safehouse.z, r: 1.4, h: 3.5, color: hex('#2ff3e0') });
  out.push({ x: L.arms.x, z: L.arms.z, r: 1.6, h: 3.5, color: hex('#ff7a3d') });
  out.push({ x: L.respray.x, z: L.respray.z, r: 3.2, h: 4, color: hex('#3dff8a') });
  return out;
}
