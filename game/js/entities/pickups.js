// Pickups: health, armor, weapons, cash, Orchid tags and mission items.
// Bobbing icons with a soft glow; health/armor/weapons respawn.
import { G } from '../state.js';
import { TAU, RNG } from '../util.js';
import { WEAPONS } from '../combat/weapons.js';
import { addGlow, addLight } from '../fx/lighting.js';
import { cashBurst } from '../fx/particles.js';
import { sfx } from '../audio/audio.js';
import { findFreeSpot } from '../world/city.js';

const COLORS = { health: '255,70,90', armor: '80,160,255', weapon: '255,170,60', cash: '90,255,130', tag: '210,90,255', bag: '255,220,90' };

export class Pickup {
  constructor(type, x, y, opts = {}) {
    this.type = type; this.x = x; this.y = y;
    this.amount = opts.amount || 0;
    this.weapon = opts.weapon || null;
    this.respawn = opts.respawn || 0;
    this.active = true; this.timer = 0;
    this.tagId = opts.tagId ?? null;
    this.life = opts.life || 0;  // auto-expire (dropped cash)
    this.onCollect = opts.onCollect || null;
    this.mission = !!opts.mission;
    this.seed = Math.random() * 10;
  }
}

export function spawnPickup(type, x, y, opts) { const p = new Pickup(type, x, y, opts); G.pickups.push(p); return p; }

/** Fixed world pickups + the 12 hidden Orchid tags. */
export function initWorldPickups() {
  const c = G.city, L = c.landmarks;
  G.pickups = [];
  const rng = new RNG(808);
  spawnPickup('health', L.hospital.x - 40, L.hospital.y, { amount: 100, respawn: 45 });
  spawnPickup('armor', L.police.x + 40, L.police.y - 20, { amount: 100, respawn: 60 });
  const spots = [
    ['health', 1, 2], ['health', 5, 7], ['health', 8, 5], ['health', 3, 9], ['health', 10, 2], ['health', 6, 10],
    ['armor', 0, 7], ['armor', 7, 1], ['armor', 11, 9],
    ['weapon:kobra', 2, 2], ['weapon:thunder', 11, 7], ['weapon:wasp', 9, 0], ['weapon:kobra', 7, 10],
  ];
  for (const [t, bx, by] of spots) {
    const p = findFreeSpot(c, c.blockAt(bx, by), rng, 16);
    if (t.startsWith('weapon:')) spawnPickup('weapon', p.x, p.y, { weapon: t.slice(7), amount: WEAPONS[t.slice(7)].pickupAmmo, respawn: 90 });
    else spawnPickup(t, p.x, p.y, { amount: t === 'health' ? 60 : 50, respawn: 60 });
  }
  for (const tag of c.tags) if (!G.progress.tags.includes(tag.id)) spawnPickup('tag', tag.x, tag.y, { tagId: tag.id });
}

function collect(p, pl) {
  switch (p.type) {
    case 'health': if (pl.hp >= pl.maxHp) return false; pl.hp = Math.min(pl.maxHp, pl.hp + p.amount); G.toast('+ Health', '#ff6b7d'); break;
    case 'armor': if (pl.armor >= 100) return false; pl.armor = Math.min(100, pl.armor + p.amount); G.toast('+ Armor', '#6bb0ff'); break;
    case 'weapon': pl.giveWeapon(p.weapon, p.amount); G.toast(WEAPONS[p.weapon].name + ' + ' + p.amount, '#ffb347'); break;
    case 'cash': G.addMoney(p.amount); cashBurst(p.x, p.y); break;
    case 'tag':
      if (!G.progress.tags.includes(p.tagId)) { G.progress.tags.push(p.tagId); G.stats.tags = G.progress.tags.length; }
      G.toast(`Orchid tag ${G.progress.tags.length}/12`, '#d65aff');
      if (G.progress.tags.length === 12) { G.addMoney(10000); G.banner('ALL TAGS FOUND', '+$10,000', '#d65aff'); }
      break;
    case 'bag': break;
  }
  if (p.onCollect) p.onCollect(p);
  sfx(p.type === 'cash' ? 'cash' : 'pickup');
  return true;
}

export function updatePickups(dt) {
  const pl = G.player;
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const p = G.pickups[i];
    if (!p.active) { p.timer -= dt; if (p.timer <= 0) p.active = true; continue; }
    if (p.life) { p.life -= dt; if (p.life <= 0) { G.pickups.splice(i, 1); continue; } }
    if (!pl || !pl.alive) continue;
    const r = pl.vehicle ? 28 : 16;
    if (pl.vehicle && p.type !== 'cash' && p.type !== 'health' && p.type !== 'armor') continue;
    if ((pl.x - p.x) ** 2 + (pl.y - p.y) ** 2 < r * r) {
      if (!collect(p, pl)) continue;
      if (p.respawn) { p.active = false; p.timer = p.respawn; } else G.pickups.splice(i, 1);
    }
  }
}

export function drawPickups(ctx, view, t) {
  for (const p of G.pickups) {
    if (!p.active) continue;
    if (p.x < view.x0 - 30 || p.x > view.x1 + 30 || p.y < view.y0 - 30 || p.y > view.y1 + 30) continue;
    const bob = Math.sin(t * 3 + p.seed) * 2.5;
    const col = COLORS[p.type];
    addGlow(p.x, p.y, 26, col, 0.8);
    addLight(p.x, p.y, 50, col, 0.5);
    ctx.save();
    ctx.translate(p.x, p.y);
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 18);
    g.addColorStop(0, `rgba(${col},0.45)`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 18, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(0, 4, 7, 3, 0, 0, TAU); ctx.fill();
    ctx.translate(0, bob - 4);
    drawPickupIcon(ctx, p, t);
    ctx.restore();
  }
}

export function drawPickupIcon(ctx, p, t) {
  switch (p.type) {
    case 'health':
      ctx.fillStyle = '#fff'; ctx.fillRect(-7, -7, 14, 14);
      ctx.fillStyle = '#e8243a'; ctx.fillRect(-2, -5.5, 4, 11); ctx.fillRect(-5.5, -2, 11, 4);
      break;
    case 'armor':
      ctx.fillStyle = '#2f6fd8'; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(7, -5); ctx.lineTo(6, 3); ctx.lineTo(0, 8); ctx.lineTo(-6, 3); ctx.lineTo(-7, -5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#bfe0ff'; ctx.lineWidth = 1.5; ctx.stroke();
      break;
    case 'weapon':
      ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1b1b1f'; ctx.fillRect(-6, -2, 11, 3.5); ctx.fillRect(-5, 0, 3, 5);
      if (p.weapon !== 'kobra') ctx.fillRect(-1, 1, 2, 4);
      break;
    case 'cash': case 'bag':
      ctx.fillStyle = p.type === 'bag' ? '#c9a24a' : '#3bbf5c';
      if (p.type === 'bag') { ctx.beginPath(); ctx.arc(0, 1, 8, 0, TAU); ctx.fill(); ctx.fillRect(-3, -9, 6, 4); }
      else ctx.fillRect(-7, -4.5, 14, 9);
      ctx.fillStyle = '#fff'; ctx.font = '900 9px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, 1);
      break;
    case 'tag': {
      ctx.rotate(t * 1.5);
      ctx.fillStyle = '#d65aff';
      for (let i = 0; i < 5; i++) { ctx.save(); ctx.rotate(i / 5 * TAU); ctx.beginPath(); ctx.ellipse(0, -4.5, 2.6, 4.5, 0, 0, TAU); ctx.fill(); ctx.restore(); }
      ctx.fillStyle = '#ffe14d'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, TAU); ctx.fill();
      break;
    }
  }
}
