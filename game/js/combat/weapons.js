// Weapons: fists (melee combo) and hitscan guns (spread, pellets, recoil, clips) with tracers,
// muzzle flashes, impact sparks, bullet holes and shell casings; explosions with chain reactions.
import { G } from '../core/state.js';
import { clamp } from '../core/math.js';
import { raycastWorld } from '../world/collision.js';
import { tracer, muzzleFlash, sparks, explosionFx, decal, casing } from '../fx/particles.js';
import { addShake } from '../camera-rig.js';
import { sfx } from '../audio/audio.js';
import { reportCrime } from '../ai/police.js';

export const WEAPON_ORDER = ['fists', 'kobra', 'wasp', 'thunder'];
export const WEAPONS = {
  fists: { name: 'Fists', melee: true, damage: 18, rate: 0.32, range: 1.6 },
  kobra: { name: 'Kobra 9', damage: 26, rate: 0.24, spread: 0.02, pellets: 1, range: 90, auto: false, sound: 'pistol', clip: 12, reload: 1.1, bloom: 0.25, pickupAmmo: 48, price: 400, ammoPrice: 60 },
  wasp: { name: 'Wasp', damage: 15, rate: 0.075, spread: 0.045, pellets: 1, range: 75, auto: true, sound: 'smg', clip: 30, reload: 1.5, bloom: 0.12, pickupAmmo: 150, price: 1500, ammoPrice: 120 },
  thunder: { name: 'Thunder', damage: 14, rate: 0.8, spread: 0.11, pellets: 8, range: 40, auto: false, sound: 'shotgun', clip: 6, reload: 2.0, bloom: 0.6, pickupAmmo: 18, price: 2200, ammoPrice: 140 },
};

function rayCircle(ox, oz, dx, dz, len, cx, cz, r) {
  const fx = cx - ox, fz = cz - oz, t = fx * dx + fz * dz;
  if (t < 0 || t > len + r) return -1;
  const p2 = fx * fx + fz * fz - t * t;
  if (p2 > r * r) return -1;
  return Math.max(0, t - Math.sqrt(r * r - p2));
}

/**
 * Fire a hitscan weapon from (ox,oy,oz) along heading `angle` (radians on the ground plane).
 * pitch tilts the tracer vertically when shooting from the camera (player).
 */
export function fireWeapon(shooter, wid, ox, oy, oz, angle, inaccuracy = 0, pitch = 0) {
  const w = WEAPONS[wid];
  if (w.melee) return melee(shooter, ox, oy, oz, angle);
  muzzleFlash(ox, oy, oz, angle);
  sfx(w.sound, { x: ox, y: oy, z: oz });
  casing(ox, oy, oz, angle);
  const isPlayer = !!shooter.isPlayer;
  if (isPlayer) { G.stats.shots++; reportCrime('gunfire', ox, oz); addShake(wid === 'thunder' ? 0.35 : 0.12); }
  scareAround(ox, oz, 45);
  const own = shooter.vehicle || null;
  for (let pi = 0; pi < w.pellets; pi++) {
    const a = angle + (Math.random() - 0.5) * 2 * (w.spread + inaccuracy);
    const dx = Math.cos(a), dz = Math.sin(a);
    let len = w.range;
    const wall = raycastWorld(ox, oz, ox + dx * len, oz + dz * len, Math.max(0.5, oy - 0.2));
    if (wall) len = wall.t * len;
    let best = len, target = null;
    for (const p of G.peds) {
      if (p === shooter || p.vehicle || p.dead) continue;
      if (Math.abs(p.x - ox) > len + 2 && Math.abs(p.z - oz) > len + 2) continue;
      const t = rayCircle(ox, oz, dx, dz, best, p.x, p.z, p.r + 0.12);
      if (t >= 0 && t < best) { best = t; target = p; }
    }
    const pl = G.player;
    if (pl && !isPlayer && pl.alive && !pl.vehicle) { const t = rayCircle(ox, oz, dx, dz, best, pl.x, pl.z, pl.r + 0.1); if (t >= 0 && t < best) { best = t; target = pl; } }
    for (const v of G.vehicles) {
      if (v === own) continue;
      if (Math.abs(v.x - ox) > len + 6 && Math.abs(v.z - oz) > len + 6) continue;
      for (const [cx, cz] of v.circles()) { const t = rayCircle(ox, oz, dx, dz, best, cx, cz, v.wid / 2); if (t >= 0 && t < best) { best = t; target = v; } }
    }
    const h = G.heli;
    if (h && isPlayer && !h.down) { const t = rayCircle(ox, oz, dx, dz, best + 30, h.x, h.z, 4); if (t >= 0 && t < best + 30) { best = t; target = h; } }
    const hx = ox + dx * best, hz = oz + dz * best;
    let hy = target ? (target === h ? h.y : target.kind === 'vehicle' ? 1.0 : 1.2) : clamp(oy - Math.tan(pitch) * best * 0.3, 0.1, 30);
    if (target === h) hy = h.y;
    tracer(ox + dx * 0.4, oy, oz + dz * 0.4, hx, hy, hz, isPlayer ? [4, 3.3, 1.6] : [4, 1.6, 1]);
    if (target) {
      if (target === h) { G.damageHeli && G.damageHeli(w.damage); sparks(hx, hy, hz, 4, 5); }
      else if (target.kind === 'vehicle') {
        target.damage(w.damage * (isPlayer ? 2.2 : 1.1), shooter);
        sparks(hx, hy, hz, 5, 6);
        if (isPlayer && target.role === 'police' && !target.wrecked) reportCrime('damageCop', hx, hz);
      } else if (target.isPlayer) target.damage(w.damage * 0.5, shooter);
      else {
        const wasDead = target.dead;
        target.damage(w.damage, shooter, dx, dz);
        if (isPlayer && !wasDead) { G.ui.hitMarker = target.dead ? 0.5 : 0.25; G.ui.hitKill = target.dead; reportCrime(target.dead ? (target.kind === 'cop' ? 'killCop' : 'kill') : (target.kind === 'cop' ? 'shootCop' : 'assault'), hx, hz); }
        decal('mark', hx + dx * 0.6, hz + dz * 0.6, 0.3);
      }
    } else if (wall) {
      sparks(hx - dx * 0.05, hy, hz - dz * 0.05, 6, 5);
      decal('hole', hx - dx * 0.02, hz - dz * 0.02, 0.07, hy);
    }
  }
  return true;
}

function melee(shooter, ox, oy, oz, angle) {
  shooter.punch = 1;
  const reachX = ox + Math.cos(angle) * 0.9, reachZ = oz + Math.sin(angle) * 0.9;
  const targets = [...G.peds];
  if (!shooter.isPlayer && G.player && !G.player.vehicle && G.player.alive) targets.push(G.player);
  for (const p of targets) {
    if (p === shooter || p.dead || p.vehicle) continue;
    if ((p.x - reachX) ** 2 + (p.z - reachZ) ** 2 < 1.1 ** 2) {
      if (p.isPlayer) p.damage(9, shooter);
      else {
        const wasDead = p.dead;
        p.damage(WEAPONS.fists.damage, shooter, Math.cos(angle), Math.sin(angle));
        if (shooter.isPlayer && !wasDead) { G.ui.hitMarker = 0.25; reportCrime(p.dead ? (p.kind === 'cop' ? 'killCop' : 'kill') : (p.kind === 'cop' ? 'shootCop' : 'assault'), p.x, p.z); }
      }
      sfx('punch', { x: p.x, y: 1.2, z: p.z });
      return true;
    }
  }
  sfx('swing', { x: ox, y: oy, z: oz, vol: 0.4 });
  return true;
}

export function scareAround(x, z, r) { for (const p of G.peds) if (p.kind === 'civ' && !p.dead && (p.x - x) ** 2 + (p.z - z) ** 2 < r * r) p.flee(x, z, 7); }

/** Explosion: visuals + radial damage + chain reaction + shake + slow-mo + crime. */
export function explode(x, z, power = 1, source = null, ignore = null) {
  explosionFx(x, 0.2, z, power);
  sfx('explosion', { x, y: 1, z });
  const p = G.player;
  if (p) {
    const d = Math.hypot(p.x - x, p.z - z);
    addShake(clamp(1 - d / 120, 0, 1) * 1.1 * power);
    if (d < 40 && G.slowMo) G.slowMo(0.6);
    if (d < 9 * power && p.alive) {
      if (p.vehicle && p.vehicle !== ignore) p.vehicle.damage(700 * (1 - d / (9 * power)), source);
      else if (!p.vehicle) p.damage(130 * (1 - d / (10 * power)), source);
    }
  }
  for (const ped of G.peds) {
    if (ped.dead || ped.vehicle) continue;
    const d = Math.hypot(ped.x - x, ped.z - z);
    if (d < 10 * power) ped.knockDown((ped.x - x) / (d || 1) * 9, (ped.z - z) / (d || 1) * 9, 150 * (1 - d / (10 * power)), source);
  }
  for (const v of G.vehicles) {
    if (v === ignore || v.wrecked) continue;
    const d = Math.hypot(v.x - x, v.z - z);
    if (d < 11 * power) {
      v.damage(950 * (1 - d / (11 * power)) * power, source);
      v.vx += (v.x - x) / (d || 1) * 8 * (1 - d / 11); v.vz += (v.z - z) / (d || 1) * 8 * (1 - d / 11);
      v.angVel += (Math.random() - 0.5) * 3; v.hop = Math.max(v.hop || 0, 1.2 * (1 - d / 11));
    }
  }
  if (G.onExplosion) G.onExplosion(x, z, power, source, ignore);
  if (source && source.isPlayer) reportCrime('explosion', x, z);
  scareAround(x, z, 90);
}
G.explode = explode;
