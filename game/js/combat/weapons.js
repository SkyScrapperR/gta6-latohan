// Weapons: fists (melee) + hitscan guns with spread, pellets, tracers, muzzle flashes,
// impact sparks; explosions with chain reactions. All damage flows through here.
import { G } from '../state.js';
import { TAU, dist2, clamp } from '../util.js';
import { raycastWorld } from '../world/collision.js';
import { tracer, muzzleFlash, sparks, explosionFx, decal } from '../fx/particles.js';
import { addShake } from '../camera.js';
import { sfx } from '../audio/audio.js';
import { reportCrime } from '../ai/police.js';

export const WEAPON_ORDER = ['fists', 'kobra', 'wasp', 'thunder'];
export const WEAPONS = {
  fists: { name: 'Fists', melee: true, damage: 16, rate: 0.36, range: 24 },
  kobra: { name: 'Kobra 9', damage: 24, rate: 0.26, spread: 0.035, pellets: 1, range: 560, auto: false, sound: 'pistol', pickupAmmo: 48, price: 400, ammoPrice: 60 },
  wasp: { name: 'Wasp', damage: 13, rate: 0.075, spread: 0.085, pellets: 1, range: 500, auto: true, sound: 'smg', pickupAmmo: 150, price: 1500, ammoPrice: 120 },
  thunder: { name: 'Thunder', damage: 13, rate: 0.85, spread: 0.2, pellets: 8, range: 320, auto: false, sound: 'shotgun', pickupAmmo: 18, price: 2200, ammoPrice: 140 },
};

/** Ray vs circle: distance along the ray to the first intersection, or -1. */
function rayCircle(ox, oy, dx, dy, len, cx, cy, r) {
  const fx = cx - ox, fy = cy - oy;
  const t = fx * dx + fy * dy;
  if (t < 0 || t > len + r) return -1;
  const p2 = fx * fx + fy * fy - t * t;
  if (p2 > r * r) return -1;
  return Math.max(0, t - Math.sqrt(r * r - p2));
}

/**
 * Fire a hitscan weapon. shooter: player or ped. Returns true if a shot was fired.
 * inaccuracy adds to the weapon's own spread (used by AI).
 */
export function fireWeapon(shooter, wid, ox, oy, angle, inaccuracy = 0) {
  const w = WEAPONS[wid];
  if (w.melee) return melee(shooter, ox, oy, angle);
  muzzleFlash(ox + Math.cos(angle) * 4, oy + Math.sin(angle) * 4, angle);
  sfx(w.sound, { x: ox, y: oy });
  const isPlayer = !!shooter.isPlayer;
  if (isPlayer) { G.stats.shots++; reportCrime('gunfire', ox, oy); }
  scareAround(ox, oy, 380);
  const ownVehicle = shooter.vehicle || null;
  for (let p = 0; p < w.pellets; p++) {
    const a = angle + (Math.random() - 0.5) * 2 * (w.spread + inaccuracy);
    const dx = Math.cos(a), dy = Math.sin(a);
    let len = w.range;
    const wall = raycastWorld(ox, oy, ox + dx * len, oy + dy * len);
    if (wall) len = wall.t * len;
    let best = len, target = null;
    for (const ped of G.peds) {
      if (ped === shooter || ped.vehicle || (ped.dead && ped.deadTime > 0.2)) continue;
      if (ped.dead) continue;
      if (Math.abs(ped.x - ox) > len + 20 && Math.abs(ped.y - oy) > len + 20) continue;
      const t = rayCircle(ox, oy, dx, dy, best, ped.x, ped.y, ped.r + 1);
      if (t >= 0 && t < best) { best = t; target = ped; }
    }
    const pl = G.player;
    if (pl && !isPlayer && pl.alive && !pl.vehicle) {
      const t = rayCircle(ox, oy, dx, dy, best, pl.x, pl.y, pl.r + 1);
      if (t >= 0 && t < best) { best = t; target = pl; }
    }
    for (const v of G.vehicles) {
      if (v === ownVehicle) continue;
      if (Math.abs(v.x - ox) > len + 60 && Math.abs(v.y - oy) > len + 60) continue;
      for (const [cx, cy] of v.circles()) {
        const t = rayCircle(ox, oy, dx, dy, best, cx, cy, v.wid / 2);
        if (t >= 0 && t < best) { best = t; target = v; }
      }
    }
    if (G.heli && isPlayer) {
      const t = rayCircle(ox, oy, dx, dy, best, G.heli.x, G.heli.y, 26);
      if (t >= 0 && t < best && G.heli.alt < 40) { best = t; target = G.heli; }
    }
    const hx = ox + dx * best, hy = oy + dy * best;
    tracer(ox + dx * 8, oy + dy * 8, hx, hy, isPlayer ? '255,240,170' : '255,190,140');
    if (target) {
      if (target.kind === 'vehicle') {
        target.damage(w.damage * (isPlayer ? 2.4 : 1.2), shooter);
        sparks(hx, hy, 4, a + Math.PI, 140);
        if (isPlayer && target.role === 'police' && !target.wrecked) reportCrime('damageCop', hx, hy, target);
      } else if (target.isPlayer) {
        target.damage(w.damage * 0.55, shooter);
      } else {
        const wasDead = target.dead;
        target.damage(w.damage, shooter, dx * 0.6, dy * 0.6);
        if (isPlayer && !wasDead) reportCrime(target.dead ? (target.kind === 'cop' ? 'killCop' : 'kill') : (target.kind === 'cop' ? 'shootCop' : 'assault'), hx, hy, target);
        decal('mark', hx + dx * 6, hy + dy * 6, 3);
      }
    } else if (wall) {
      sparks(hx, hy, 5, a + Math.PI, 160);
      decal('hole', hx, hy, 2);
    }
  }
  return true;
}

function melee(shooter, ox, oy, angle) {
  shooter.punchT = 0.15;
  const w = WEAPONS.fists;
  const reachX = ox + Math.cos(angle) * 14, reachY = oy + Math.sin(angle) * 14;
  const targets = [...G.peds];
  if (!shooter.isPlayer && G.player && !G.player.vehicle) targets.push(G.player);
  for (const p of targets) {
    if (p === shooter || p.dead || p.vehicle || (p.alive === false)) continue;
    if (dist2(p.x, p.y, reachX, reachY) < (w.range) ** 2) {
      const dx = Math.cos(angle), dy = Math.sin(angle);
      if (p.isPlayer) p.damage(8, shooter);
      else {
        const wasDead = p.dead;
        p.damage(w.damage, shooter, dx * 0.8, dy * 0.8);
        if (shooter.isPlayer && !wasDead) reportCrime(p.dead ? (p.kind === 'cop' ? 'killCop' : 'kill') : (p.kind === 'cop' ? 'shootCop' : 'assault'), p.x, p.y, p);
      }
      sfx('punch', { x: p.x, y: p.y });
      return true;
    }
  }
  sfx('swing', { x: ox, y: oy, vol: 0.4 });
  return true;
}

export function scareAround(x, y, r) {
  for (const p of G.peds) if (p.kind === 'civ' && !p.dead && dist2(p.x, p.y, x, y) < r * r) p.scare(x, y, 6);
}

/** Explosion: visual + damage + chain reaction to vehicles + shake + sound + crime. */
export function explode(x, y, power = 1, source = null, ignore = null) {
  explosionFx(x, y, power);
  sfx('explosion', { x, y });
  const p = G.player;
  if (p) {
    const d = Math.hypot(p.x - x, p.y - y);
    addShake(clamp(1 - d / 900, 0, 1) * 0.9 * power);
    if (d < 110 * power && p.alive) {
      if (p.vehicle && p.vehicle !== ignore) p.vehicle.damage(600 * (1 - d / (110 * power)) * power, source);
      else if (!p.vehicle) p.damage(120 * (1 - d / (130 * power)) * power, source);
    }
  }
  for (const ped of G.peds) {
    if (ped.dead || ped.vehicle) continue;
    const d = Math.hypot(ped.x - x, ped.y - y);
    if (d < 120 * power) ped.knockDown((ped.x - x) / (d || 1) * 300, (ped.y - y) / (d || 1) * 300, 140 * (1 - d / (120 * power)), source);
  }
  for (const v of G.vehicles) {
    if (v === ignore || v.wrecked) continue;
    const d = Math.hypot(v.x - x, v.y - y);
    if (d < 140 * power) {
      // chain reaction: close cars catch fire and blow shortly after
      v.damage(900 * (1 - d / (140 * power)) * power, source);
      v.vx += (v.x - x) / (d || 1) * 200 * (1 - d / 140); v.vy += (v.y - y) / (d || 1) * 200 * (1 - d / 140);
      v.angVel += (Math.random() - 0.5) * 4;
    }
  }
  if (G.onExplosion) G.onExplosion(x, y, power, source, ignore);
  if (source && source.isPlayer) reportCrime('explosion', x, y);
  scareAround(x, y, 600);
}
G.explode = explode;
