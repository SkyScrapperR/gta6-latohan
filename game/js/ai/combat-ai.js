// Combat brains: Black Orchid gang members (take cover behind containers / cars / corners,
// peek and shoot with imperfect aim, strafe, keep distance), the boss, and police officers
// on foot (arrest at 1 star, shoot at 2+, get back into their cruiser when you drive off).
import { G } from '../core/state.js';
import { RNG, angleDiff, clamp } from '../core/math.js';
import { lineBlocked, boxesNear } from '../world/collision.js';
import { nearestNode, bfsPath, nodeXZ } from '../world/roads.js';
import { fireWeapon, WEAPONS } from '../combat/weapons.js';

const rng = new RNG(555);

/** Walk to a target, routing via intersections when buildings are in the way. */
export function navigate(p, tx, tz, speed, dt) {
  if (!lineBlocked(p.x, p.z, tx, tz, 1.5)) { p.nav = null; return p.moveTo(tx, tz, speed, dt); }
  p.navT = (p.navT || 0) - dt;
  if (!p.nav || p.navT <= 0) { p.nav = bfsPath(nearestNode(p.x, p.z), nearestNode(tx, tz)); p.navT = 1.2; }
  while (p.nav.length > 1) { const n = nodeXZ(p.nav[0]); if (Math.hypot(n.x - p.x, n.z - p.z) < 3) p.nav.shift(); else break; }
  const n = nodeXZ(p.nav[0]);
  return p.moveTo(n.x, n.z, speed, dt);
}

function aimAndShoot(p, tx, tz, dt, inacc) {
  const want = Math.atan2(tz - p.z, tx - p.x);
  p.angle += angleDiff(p.angle, want) * Math.min(1, dt * 8);
  p.aiming = true;
  p.cooldown -= dt;
  if (p.cooldown <= 0 && Math.abs(angleDiff(p.angle, want)) < 0.25) {
    const w = WEAPONS[p.weapon];
    if (p.weapon === 'wasp') { p.burst = (p.burst || 0) + 1; p.cooldown = p.burst % 5 === 0 ? rng.range(0.9, 1.6) : w.rate * 1.5; }
    else p.cooldown = w.rate * rng.range(2.2, 3.8);
    const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
    fireWeapon(p, p.weapon, p.x + ca * 0.7 - sa * 0.27, p.y + 1.45, p.z + sa * 0.7 + ca * 0.27, p.angle, inacc);
  }
}

/** Pick a cover spot: the far side of a nearby container, car or building corner. */
function findCover(p, tx, tz) {
  let best = null, bd = 26 * 26;
  const consider = (cx, cz, rad) => {
    const dx = cx - tx, dz = cz - tz, d = Math.hypot(dx, dz) || 1;
    const x = cx + dx / d * (rad + 0.9), z = cz + dz / d * (rad + 0.9);
    const dd = (x - p.x) ** 2 + (z - p.z) ** 2;
    if (dd < bd && Math.hypot(x - tx, z - tz) > 7) { bd = dd; best = { x, z }; }
  };
  for (const b of boxesNear(p.x, p.z, 26)) if (b.w < 40 && b.d < 40) consider(b.x + b.w / 2, b.z + b.d / 2, Math.max(b.w, b.d) / 2);
  for (const v of G.vehicles) if (Math.abs(v.x - p.x) < 26 && Math.abs(v.z - p.z) < 26) consider(v.x, v.z, v.len / 2);
  return best;
}

export function gangBrain(p, dt) {
  const pl = G.player;
  p.aiming = false;
  if (!pl || !pl.alive) return;
  const tx = pl.x, tz = pl.z, d = Math.hypot(tx - p.x, tz - p.z);
  if (p.state !== 'combat') {
    const sees = d < (p.aggroRange || 45) && !lineBlocked(p.x, p.z, tx, tz, 2);
    if (sees || p.hp < p.maxHp) { p.state = 'combat'; p.tactic = 'cover'; p.tacticT = 0; } else return;
  }
  p.tacticT -= dt;
  const los = !lineBlocked(p.x, p.z, tx, tz, 2);
  const speed = p.kind === 'boss' ? 5.2 : 4.4;
  if (!los && d > 30) { navigate(p, tx, tz, speed * 1.1, dt); return; }
  if (!(p.tacticT > 0)) {
    p.tacticT = rng.range(1.6, 3.2);
    const r = rng.next();
    p.tactic = r < 0.45 ? 'cover' : r < 0.8 ? 'strafe' : 'peek';
    p.cover = p.tactic === 'cover' || p.tactic === 'peek' ? findCover(p, tx, tz) : null;
    p.strafeDir = rng.sign(); p.prefD = rng.range(10, 22);
  }
  if ((p.tactic === 'cover' || p.tactic === 'peek') && p.cover) {
    const c = p.cover;
    let gx = c.x, gz = c.z;
    if (p.tactic === 'peek') { const dx = tx - c.x, dz = tz - c.z, l = Math.hypot(dx, dz) || 1; gx += -dz / l * 1.6 * p.strafeDir; gz += dx / l * 1.6 * p.strafeDir; }
    if (p.moveTo(gx, gz, speed, dt) < 0.4 && p.tactic === 'peek' && los) aimAndShoot(p, tx, tz, dt, p.kind === 'boss' ? 0.04 : 0.07);
    else if (los && p.tactic === 'cover' && rng.next() < dt * 0.6) aimAndShoot(p, tx, tz, dt, 0.1);
    return;
  }
  // strafe at a preferred distance
  const ux = (tx - p.x) / (d || 1), uz = (tz - p.z) / (d || 1);
  const radial = clamp((d - p.prefD) / 6, -1, 1);
  p.moveTo(p.x + (ux * radial - uz * p.strafeDir * 0.9) * 3, p.z + (uz * radial + ux * p.strafeDir * 0.9) * 3, speed * 0.8, dt);
  if (los && p.weapon && p.weapon !== 'fists') aimAndShoot(p, tx, tz, dt, p.kind === 'boss' ? 0.05 : 0.08);
  if (p.weapon === 'fists' && d < 1.4) { p.cooldown -= dt; if (p.cooldown <= 0) { p.cooldown = 0.7; fireWeapon(p, 'fists', p.x, 1.3, p.z, Math.atan2(tz - p.z, tx - p.x)); } }
}

export function copBrain(p, dt) {
  const pl = G.player, w = G.wanted;
  p.aiming = false;
  if (!pl || !pl.alive || w.stars === 0) {
    if (p.car && !p.car.wrecked && !p.car.driver && Math.hypot(p.car.x - p.x, p.car.z - p.z) < 60) {
      if (p.moveTo(p.car.x, p.car.z, 2.5, dt) < 2.2) { p.vehicle = p.car; p.car.driver = p; p.car.ai = { mode: 'leave' }; p.car.siren = false; }
    } else p.moveTo(p.x + Math.cos(p.angle) * 3, p.z + Math.sin(p.angle) * 3, 1.5, dt);
    return;
  }
  const tx = w.seen ? pl.x : w.lastX, tz = w.seen ? pl.z : w.lastZ;
  const d = Math.hypot(tx - p.x, tz - p.z);
  if (pl.vehicle && pl.vehicle.speed > 8 && d > 25 && p.car && !p.car.wrecked && !p.car.driver) {
    if (navigate(p, p.car.x, p.car.z, 6.5, dt) < 2.4) G.copReenter(p, p.car);
    return;
  }
  if (w.stars === 1) {
    if (d > 1.2) navigate(p, tx, tz, 6.2, dt);
    p.angle = Math.atan2(tz - p.z, tx - p.x);
    if (w.seen && d < 2 && (!pl.vehicle || pl.vehicle.speed < 3)) G.arrestProgress = (G.arrestProgress || 0) + dt;
    return;
  }
  const los = w.seen && !lineBlocked(p.x, p.z, tx, tz, 2);
  if (!los || d > 40) navigate(p, tx, tz, 6.4, dt);
  else { if (d > 20) p.moveTo(tx, tz, 3, dt); aimAndShoot(p, tx, tz, dt, 0.09); }
}
