// Pickups: health, armor, weapons, cash, Orchid tags and mission items. They float, rotate
// and glow (instanced meshes + glow sprites + a light); health/armor/weapons respawn.
import { G } from '../core/state.js';
import { RNG, mat4 } from '../core/math.js';
import { MeshBuilder, MAT } from '../engine/mesh-builder.js';
import { createMesh } from '../engine/gl.js';
import { InstanceBatch } from '../engine/instancing.js';
import { WEAPONS } from '../combat/weapons.js';
import { cashBurst } from '../fx/particles.js';
import { addTransientLight } from '../fx/lights.js';
import { sfx } from '../audio/audio.js';
import { findFreeSpot, CURB } from '../world/city.js';

const GLOW = { health: [1, 0.25, 0.3], armor: [0.3, 0.6, 1], weapon: [1, 0.65, 0.2], cash: [0.35, 1, 0.5], tag: [0.85, 0.35, 1], bag: [1, 0.85, 0.35] };
let batches = null;
const tmp = mat4.create();

function iconMeshes(gl) {
  const mk = (f) => { const m = new MeshBuilder(); f(m); return new InstanceBatch(createMesh(gl, m.toArray()), { castShadow: false }); };
  return {
    health: mk((m) => { m.box(-0.3, -0.3, -0.12, 0.3, 0.3, 0.12, [0.95, 0.95, 0.95]); m.box(-0.07, -0.22, -0.14, 0.07, 0.22, 0.14, [0.9, 0.1, 0.12], { mat: MAT.NEON, e: 2 }); m.box(-0.22, -0.07, -0.14, 0.22, 0.07, 0.14, [0.9, 0.1, 0.12], { mat: MAT.NEON, e: 2 }); }),
    armor: mk((m) => { m.box(-0.28, -0.1, -0.08, 0.28, 0.32, 0.08, [0.2, 0.4, 0.85]); m.box(-0.18, -0.32, -0.08, 0.18, -0.1, 0.08, [0.2, 0.4, 0.85]); m.box(-0.2, 0.1, -0.1, 0.2, 0.2, 0.1, [0.6, 0.85, 1], { mat: MAT.NEON, e: 1.5 }); }),
    weapon: mk((m) => { m.box(-0.35, 0, -0.05, 0.35, 0.12, 0.05, [0.12, 0.12, 0.13]); m.box(-0.3, -0.25, -0.05, -0.15, 0.02, 0.05, [0.12, 0.12, 0.13]); m.box(-0.05, -0.15, -0.04, 0.02, 0.02, 0.04, [0.12, 0.12, 0.13]); m.box(0.2, 0.12, -0.03, 0.3, 0.17, 0.03, [1, 0.65, 0.2], { mat: MAT.NEON, e: 2 }); }),
    cash: mk((m) => { for (let i = 0; i < 3; i++) m.box(-0.28, -0.15 + i * 0.1, -0.14, 0.28, -0.07 + i * 0.1, 0.14, [0.3, 0.75, 0.38]); m.box(-0.05, -0.16, -0.15, 0.05, 0.16, 0.15, [0.95, 0.9, 0.6]); }),
    tag: mk((m) => { for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; m.box(Math.cos(a) * 0.18 - 0.09, Math.sin(a) * 0.18 - 0.09, -0.04, Math.cos(a) * 0.18 + 0.09, Math.sin(a) * 0.18 + 0.09, 0.04, [0.85, 0.35, 1], { mat: MAT.NEON, e: 2.5 }); } m.box(-0.06, -0.06, -0.06, 0.06, 0.06, 0.06, [1, 0.9, 0.3], { mat: MAT.NEON, e: 3 }); }),
    bag: mk((m) => { m.sphere(0, 0, 0, 0.32, [0.62, 0.48, 0.25], { seg: 6, rings: 4 }); m.box(-0.08, 0.25, -0.08, 0.08, 0.4, 0.08, [0.5, 0.38, 0.2]); m.box(-0.12, -0.05, 0.3, 0.12, 0.15, 0.32, [1, 0.85, 0.3], { mat: MAT.NEON, e: 2 }); }),
  };
}
export function createPickupBatches(gl) { batches = iconMeshes(gl); return Object.values(batches); }

export class Pickup {
  constructor(type, x, z, o = {}) {
    Object.assign(this, { type, x, z, amount: o.amount || 0, weapon: o.weapon || null, respawn: o.respawn || 0, active: true, timer: 0, tagId: o.tagId ?? null, life: o.life || 0, onCollect: o.onCollect || null, mission: !!o.mission, seed: Math.random() * 10 });
  }
}
export function spawnPickup(type, x, z, o) { const p = new Pickup(type, x, z, o); G.pickups.push(p); return p; }

export function initWorldPickups() {
  const c = G.city, L = c.landmarks, rng = new RNG(808);
  G.pickups = [];
  spawnPickup('health', L.hospital.x - 8, L.hospital.z, { amount: 100, respawn: 45 });
  spawnPickup('armor', L.police.x + 8, L.police.z - 3, { amount: 100, respawn: 60 });
  const spots = [['health', 1, 2], ['health', 4, 6], ['health', 7, 4], ['health', 2, 8], ['health', 8, 2], ['health', 5, 9], ['armor', 0, 6], ['armor', 6, 1], ['armor', 9, 8],
    ['weapon:kobra', 2, 3], ['weapon:thunder', 9, 6], ['weapon:wasp', 8, 0], ['weapon:kobra', 6, 9]];
  for (const [t, bx, by] of spots) {
    const p = findFreeSpot(c, c.blockAt(bx, by), rng, 3);
    if (t.startsWith('weapon:')) spawnPickup('weapon', p.x, p.z, { weapon: t.slice(7), amount: WEAPONS[t.slice(7)].pickupAmmo, respawn: 90 });
    else spawnPickup(t, p.x, p.z, { amount: t === 'health' ? 60 : 50, respawn: 60 });
  }
  for (const tag of c.tags) if (!G.progress.tags.includes(tag.id)) spawnPickup('tag', tag.x, tag.z, { tagId: tag.id });
}

function collect(p, pl) {
  switch (p.type) {
    case 'health': if (pl.hp >= pl.maxHp) return false; pl.hp = Math.min(pl.maxHp, pl.hp + p.amount); G.toast('+ Health', '#ff6b7d'); break;
    case 'armor': if (pl.armor >= 100) return false; pl.armor = Math.min(100, pl.armor + p.amount); G.toast('+ Armor', '#6bb0ff'); break;
    case 'weapon': pl.giveWeapon(p.weapon, p.amount); G.toast(`${WEAPONS[p.weapon].name} +${p.amount}`, '#ffb347'); break;
    case 'cash': G.addMoney(p.amount); cashBurst(p.x, 1, p.z); break;
    case 'tag':
      if (!G.progress.tags.includes(p.tagId)) { G.progress.tags.push(p.tagId); G.stats.tags = G.progress.tags.length; }
      G.toast(`Orchid tag ${G.progress.tags.length}/12`, '#d65aff');
      if (G.progress.tags.length === 12) { G.addMoney(10000); G.banner('ALL TAGS FOUND', '+$10,000', '#d65aff', 4, 2); }
      break;
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
    const r = pl.vehicle ? 2.6 : 1.3;
    if (pl.vehicle && !['cash', 'health', 'armor'].includes(p.type)) continue;
    if ((pl.x - p.x) ** 2 + (pl.z - p.z) ** 2 < r * r) {
      if (!collect(p, pl)) continue;
      if (p.respawn) { p.active = false; p.timer = p.respawn; } else G.pickups.splice(i, 1);
    }
  }
}

/** Fill the instanced icon batches + glow sprites for visible pickups. */
export function drawPickups() {
  if (!batches) return;
  for (const k in batches) batches[k].clear();
  const cam = G.renderer.camera.pos, t = G.time;
  G.glows = [];
  for (const p of G.pickups) {
    if (!p.active || Math.abs(p.x - cam[0]) > 140 || Math.abs(p.z - cam[2]) > 140) continue;
    const y = CURB + 0.9 + Math.sin(t * 2.4 + p.seed) * 0.15;
    mat4.trs(tmp, p.x, y, p.z, t * 2 + p.seed, 1.2, 1.2, 1.2);
    const c = GLOW[p.type];
    batches[p.type].pushMatrix(tmp, 1, 1, 1, 0.25);
    G.glows.push({ x: p.x, y, z: p.z, r: 1.1, c: c.map((v) => v * 1.6), a: 0.5 });
    if (Math.abs(p.x - cam[0]) < 60 && Math.abs(p.z - cam[2]) < 60 && Math.random() < 0.3) addTransientLight(p.x, y, p.z, 5, c, 1.5, 0.05);
  }
}
