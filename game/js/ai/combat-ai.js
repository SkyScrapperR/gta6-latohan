// Combat brains for armed NPCs: Black Orchid gang members (keep distance, strafe,
// imperfect aim), the boss, and police officers on foot (arrest at 1 star, shoot at 2+).
import { G } from '../state.js';
import { RNG, angleDiff, clamp } from '../util.js';
import { lineBlocked } from '../world/collision.js';
import { nearestNode, bfsPath, nodeXY } from '../world/roads.js';
import { fireWeapon, WEAPONS } from '../combat/weapons.js';

const rng = new RNG(555);

/** Walk toward a target, routing via road intersections when a building is in the way. */
export function navigate(p, tx, ty, speed, dt) {
  const blocked = lineBlocked(p.x, p.y, tx, ty, 6);
  if (!blocked) { p.nav = null; return p.moveTo(tx, ty, speed, dt); }
  p.navT = (p.navT || 0) - dt;
  if (!p.nav || p.navT <= 0) {
    p.nav = bfsPath(nearestNode(p.x, p.y), nearestNode(tx, ty));
    p.navT = 1.2;
  }
  while (p.nav.length > 1) {
    const n = nodeXY(p.nav[0]);
    if (Math.hypot(n.x - p.x, n.y - p.y) < 24) p.nav.shift(); else break;
  }
  const n = nodeXY(p.nav[0]);
  return p.moveTo(n.x, n.y, speed, dt);
}

function aimAndShoot(p, tx, ty, dt, inaccuracy) {
  const want = Math.atan2(ty - p.y, tx - p.x);
  p.angle += angleDiff(p.angle, want) * Math.min(1, dt * 8);
  p.cooldown -= dt;
  if (p.cooldown <= 0 && Math.abs(angleDiff(p.angle, want)) < 0.3) {
    const w = WEAPONS[p.weapon];
    if (p.weapon === 'wasp') { p.burst = (p.burst || 0) + 1; p.cooldown = p.burst % 5 === 0 ? rng.range(0.9, 1.6) : w.rate * 1.4; }
    else p.cooldown = w.rate * rng.range(2.2, 3.6);
    fireWeapon(p, p.weapon, p.x + Math.cos(p.angle) * 10, p.y + Math.sin(p.angle) * 10, p.angle, inaccuracy);
  }
}

/** Black Orchid enforcer / guard / boss. */
export function gangBrain(p, dt) {
  const pl = G.player;
  if (!pl || !pl.alive) { p.moving = false; return; }
  const tx = pl.x, ty = pl.y;
  const d = Math.hypot(tx - p.x, ty - p.y);
  if (p.state !== 'combat') {
    p.moving = false;
    const sees = d < (p.aggroRange || 300) && !lineBlocked(p.x, p.y, tx, ty, 10);
    if (sees || p.hp < p.maxHp) { p.state = 'combat'; p.strafeT = 0; }
    else return;
  }
  p.strafeT -= dt;
  if (!(p.strafeT > 0)) { p.strafeDir = rng.sign(); p.strafeT = rng.range(1.2, 2.8); p.prefD = rng.range(130, 230); }
  const los = !lineBlocked(p.x, p.y, tx, ty, 10);
  const speed = p.kind === 'boss' ? 110 : 92;
  if (!los || d > 380) {
    navigate(p, tx, ty, speed * 1.1, dt);
  } else {
    // keep distance and strafe
    const ux = (tx - p.x) / d, uy = (ty - p.y) / d;
    const radial = clamp((d - p.prefD) / 80, -1, 1);
    const mx = ux * radial + -uy * p.strafeDir * 0.9, my = uy * radial + ux * p.strafeDir * 0.9;
    const facing = p.angle;
    p.moveTo(p.x + mx * 30, p.y + my * 30, speed, dt);
    p.angle = facing;
    if (p.weapon && p.weapon !== 'fists') aimAndShoot(p, tx, ty, dt, p.kind === 'boss' ? 0.08 : 0.15);
  }
  if (p.weapon === 'fists' && d < 22) { p.cooldown -= dt; if (p.cooldown <= 0) { p.cooldown = 0.6; fireWeapon(p, 'fists', p.x, p.y, Math.atan2(ty - p.y, tx - p.x)); } }
}

/** Police officer on foot. */
export function copBrain(p, dt) {
  const pl = G.player, w = G.wanted;
  if (!pl || !pl.alive || w.stars === 0) {
    // stand down: walk back to the car or wander off
    if (p.car && !p.car.wrecked && !p.car.driver && Math.hypot(p.car.x - p.x, p.car.y - p.y) < 400) {
      if (p.moveTo(p.car.x, p.car.y, 70, dt) < 20) { p.vehicle = p.car; p.car.driver = p; p.car.ai = { mode: 'leave' }; p.car.siren = false; }
    } else p.moveTo(p.x + Math.cos(p.angle) * 20, p.y + Math.sin(p.angle) * 20, 50, dt);
    return;
  }
  const tx = w.seen ? pl.x : w.lastX, ty = w.seen ? pl.y : w.lastY;
  const d = Math.hypot(tx - p.x, ty - p.y);
  // suspect drove off: get back in the cruiser
  if (pl.vehicle && pl.vehicle.speed > 60 && d > 200 && p.car && !p.car.wrecked && !p.car.driver) {
    const dc = navigate(p, p.car.x, p.car.y, 140, dt);
    if (dc < 22) { G.copReenter(p, p.car); }
    return;
  }
  if (w.stars === 1) {
    // try to arrest
    if (d > 18) navigate(p, tx, ty, 140, dt);
    else p.moving = false;
    p.angle = Math.atan2(ty - p.y, tx - p.x);
    if (w.seen && d < 26 && (!pl.vehicle || pl.vehicle.speed < 25)) G.arrestProgress = (G.arrestProgress || 0) + dt;
    return;
  }
  const los = w.seen && !lineBlocked(p.x, p.y, tx, ty, 10);
  if (!los || d > 320) navigate(p, tx, ty, 145, dt);
  else {
    if (d > 180) p.moveTo(tx, ty, 90, dt); else p.moving = false;
    aimAndShoot(p, tx, ty, dt, 0.13);
  }
}
