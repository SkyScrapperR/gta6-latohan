// Pedestrians: sidewalk loops around blocks, zebra crossings on the pedestrian green, idling,
// phone calls, chatting in pairs, fleeing gunfire, diving away from speeding cars,
// knock-downs and non-graphic deaths (small dark mark, cash drop).
import { G } from '../core/state.js';
import { TAU, clamp, angleDiff, RNG } from '../core/math.js';
import { resolveCircle } from '../world/collision.js';
import { CELL, ROAD, NB, groundHeight } from '../world/city.js';
import { nearestNode, pedestrianGreen } from '../world/roads.js';
import { decal } from '../fx/particles.js';
import { drawCharacter, randomLook, outfitLook } from './character-model.js';

let nextId = 1;
const rng = new RNG(4242);
const RING = 2.2; // distance of the walking line from the block edge

export class Ped {
  constructor(kind, x, z, outfit = null) {
    this.id = nextId++; this.kind = kind;
    this.x = x; this.z = z; this.y = groundHeight(x, z); this.angle = rng.range(0, TAU); this.r = 0.35;
    this.hp = 50; this.maxHp = 50; this.armor = 0;
    this.look = outfit ? outfitLook(outfit, rng) : randomLook(rng);
    this.state = 'walk'; this.stateTime = 0;
    this.walkSpeed = rng.range(1.3, 1.8);
    this.walk = rng.range(0, TAU); this.speedNow = 0;
    this.dead = false; this.deadT = 0; this.downTime = 0; this.hit = 0; this.punch = 0;
    this.vehicle = null; this.weapon = null; this.cooldown = 0;
    this.fearX = 0; this.fearZ = 0; this.ring = null; this.corner = 0; this.dir = 1;
    this.kx = 0; this.kz = 0;
    this.mission = false; this.cash = rng.int(5, 40);
    this.phone = false; this.partner = null;
  }

  joinRing() {
    const bx = clamp(Math.floor((this.x - ROAD / 2) / CELL), 0, NB - 1), bz = clamp(Math.floor((this.z - ROAD / 2) / CELL), 0, NB - 1);
    this.setRing(bx, bz);
    let best = 0, bd = Infinity;
    this.ring.pts.forEach((p, i) => { const d = (p[0] - this.x) ** 2 + (p[1] - this.z) ** 2; if (d < bd) { bd = d; best = i; } });
    this.corner = best; this.dir = rng.chance(0.5) ? 1 : -1;
  }
  setRing(bx, bz) {
    const x0 = bx * CELL + ROAD + RING, z0 = bz * CELL + ROAD + RING, x1 = (bx + 1) * CELL - RING, z1 = (bz + 1) * CELL - RING;
    this.ring = { bx, bz, pts: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] };
  }

  damage(amount, source = null, dx = 0, dz = 0) {
    if (this.dead) return;
    if (this.armor > 0) { const a = Math.min(this.armor, amount * 0.7); this.armor -= a; amount -= a; }
    this.hp -= amount; this.hit = 1;
    this.kx += dx * 2.5; this.kz += dz * 2.5;
    this.lastAttacker = source;
    if (this.onDamage) this.onDamage(amount, source);
    if (this.hp <= 0) this.die(source);
    else if (this.kind === 'civ') this.flee(source ? source.x : this.x - dx, source ? source.z : this.z - dz, 7);
  }
  knockDown(vx, vz, dmg, source) {
    if (this.dead) return;
    this.kx = vx; this.kz = vz; this.state = 'down'; this.downTime = 2.4; this.deadT = 0;
    this.damage(dmg, source, 0, 0);
  }
  die(killer = null) {
    if (this.dead) return;
    this.dead = true; this.state = 'dead'; this.deadT = 0; this.hp = 0;
    decal('mark', this.x + rng.range(-0.4, 0.4), this.z + rng.range(-0.4, 0.4), rng.range(0.35, 0.6));
    if (this.partner) { this.partner.partner = null; this.partner = null; }
    if (this.onDeath) this.onDeath(killer);
    if (G.onPedDeath) G.onPedDeath(this, killer);
  }
  flee(x, z, time = 6) {
    if (this.dead || this.kind !== 'civ' || this.vehicle) return;
    this.state = 'flee'; this.stateTime = time; this.fearX = x; this.fearZ = z; this.phone = false;
    if (this.partner) { const p = this.partner; this.partner = null; p.partner = null; p.flee(x, z, time); }
  }

  update(dt) {
    this.hit = Math.max(0, this.hit - dt * 3);
    this.punch = Math.max(0, this.punch - dt * 4);
    if (this.dead) { this.deadT = Math.min(1, this.deadT + dt * 2.5); this.applyKnock(dt); return; }
    if (this.vehicle) { this.x = this.vehicle.x; this.z = this.vehicle.z; if (this.companion && this.brain) this.brain(this, dt); return; }
    if (this.state === 'down') {
      this.downTime -= dt; this.deadT = Math.min(1, this.deadT + dt * 3); this.applyKnock(dt);
      if (this.downTime <= 0) { this.deadT = 0; this.state = this.kind === 'civ' ? 'flee' : 'combat'; this.stateTime = 5; this.fearX = this.x - this.kx; this.fearZ = this.z - this.kz; }
      return;
    }
    this.speedNow = 0;
    this.dodgeCars(dt);
    if (this.brain) this.brain(this, dt); else this.civBrain(dt);
    this.applyKnock(dt);
    this.y = groundHeight(this.x, this.z);
  }
  applyKnock(dt) {
    if (Math.abs(this.kx) + Math.abs(this.kz) < 0.01) return;
    this.x += this.kx * dt; this.z += this.kz * dt;
    this.kx *= Math.exp(-dt * 4); this.kz *= Math.exp(-dt * 4);
    const r = resolveCircle(this.x, this.z, this.r, true); this.x = r.x; this.z = r.z;
    this.y = groundHeight(this.x, this.z);
  }
  moveTo(tx, tz, speed, dt) {
    if (!Number.isFinite(tx) || !Number.isFinite(tz)) return 0;
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    const s = Math.min(speed * dt, d);
    this.x += dx / d * s; this.z += dz / d * s;
    this.angle += angleDiff(this.angle, Math.atan2(dz, dx)) * Math.min(1, dt * 10);
    const r = resolveCircle(this.x, this.z, this.r); this.x = r.x; this.z = r.z;
    this.speedNow = speed; this.walk += dt * (speed > 4 ? 10 : 7.5);
    return d;
  }
  /** Dive sideways when a fast car is about to hit us. */
  dodgeCars(dt) {
    if (this.kind !== 'civ' || this.diveT > 0) { this.diveT = (this.diveT || 0) - dt; return; }
    for (const v of G.vehicles) {
      const sp = v.speed;
      if (sp < 9 || Math.abs(v.x - this.x) > 14 || Math.abs(v.z - this.z) > 14) continue;
      const fx = v.vx / sp, fz = v.vz / sp, dx = this.x - v.x, dz = this.z - v.z;
      const along = dx * fx + dz * fz, lat = -dx * fz + dz * fx;
      if (along > 0 && along < sp * 0.7 && Math.abs(lat) < 1.8) {
        const s = lat >= 0 ? 1 : -1;
        this.kx = -fz * s * 7; this.kz = fx * s * 7; this.diveT = 1.5;
        this.flee(v.x, v.z, 4);
        return;
      }
    }
  }

  civBrain(dt) {
    this.stateTime -= dt;
    switch (this.state) {
      case 'flee': {
        const dx = this.x - this.fearX, dz = this.z - this.fearZ, d = Math.hypot(dx, dz) || 1;
        this.moveTo(this.x + dx / d * 3, this.z + dz / d * 3, 5.8, dt);
        if (this.stateTime <= 0) { this.state = 'walk'; this.joinRing(); }
        return;
      }
      case 'idle': case 'phone':
        if (this.stateTime <= 0) { this.state = 'walk'; this.phone = false; }
        return;
      case 'chat':
        if (this.partner) this.angle += angleDiff(this.angle, Math.atan2(this.partner.z - this.z, this.partner.x - this.x)) * Math.min(1, dt * 5);
        if (this.stateTime <= 0 || !this.partner) { this.state = 'walk'; if (this.partner) { this.partner.partner = null; this.partner = null; } }
        return;
      case 'wait': {
        // waiting at the kerb for the pedestrian green
        const c = this.cross;
        if (pedestrianGreen(c.node, c.axis, G.time) || this.stateTime < -12) { this.state = 'cross'; }
        return;
      }
      case 'cross': {
        const c = this.cross;
        if (this.moveTo(c.tx, c.tz, this.walkSpeed * 1.3, dt) < 0.2) { this.setRing(c.bx, c.bz); this.corner = c.corner; this.state = 'walk'; }
        return;
      }
    }
    if (!this.ring) this.joinRing();
    const p = this.ring.pts[this.corner];
    if (this.moveTo(p[0], p[1], this.walkSpeed, dt) < 0.3) {
      const r = rng.next();
      if (r < 0.3) this.startCrossing();
      else this.corner = (this.corner + this.dir + 4) % 4;
      if (r > 0.82) { this.state = rng.chance(0.5) ? 'phone' : 'idle'; this.phone = this.state === 'phone'; this.stateTime = rng.range(2, 6); }
    } else if (rng.next() < dt * 0.02) this.tryChat();
  }
  tryChat() {
    for (const o of G.peds) {
      if (o === this || o.kind !== 'civ' || o.state !== 'walk' || o.partner || o.dead) continue;
      if ((o.x - this.x) ** 2 + (o.z - this.z) ** 2 < 2.5 ** 2) {
        this.partner = o; o.partner = this; this.state = o.state = 'chat'; this.stateTime = o.stateTime = rng.range(4, 9);
        return;
      }
    }
  }
  startCrossing() {
    const { bx, bz } = this.ring, c = this.corner; // 0 NW, 1 NE, 2 SE, 3 SW
    const horizontal = rng.chance(0.5);
    let nbx = bx, nbz = bz;
    if (horizontal) nbx += c === 1 || c === 2 ? 1 : -1; else nbz += c === 2 || c === 3 ? 1 : -1;
    if (nbx < 0 || nbz < 0 || nbx >= NB || nbz >= NB) { this.corner = (c + this.dir + 4) % 4; return; }
    const map = horizontal ? { 0: 1, 1: 0, 2: 3, 3: 2 } : { 0: 3, 3: 0, 1: 2, 2: 1 };
    const x0 = nbx * CELL + ROAD + RING, z0 = nbz * CELL + ROAD + RING, x1 = (nbx + 1) * CELL - RING, z1 = (nbz + 1) * CELL - RING;
    const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], nc = map[c];
    // crossing a north-south road (moving in x) must wait for the NS traffic to stop
    const axis = horizontal ? 'ns' : 'ew';
    this.cross = { bx: nbx, bz: nbz, corner: nc, tx: pts[nc][0], tz: pts[nc][1], node: nearestNode((this.x + pts[nc][0]) / 2, (this.z + pts[nc][1]) / 2), axis };
    this.state = 'wait'; this.stateTime = 0;
  }

  draw() {
    drawCharacter({
      x: this.x, y: this.y, z: this.z, yaw: -this.angle, look: this.look, walk: this.walk,
      speed: this.speedNow > 4 ? 2 : this.speedNow > 0.1 ? 1 : 0, aim: this.aiming ? 1 : 0, punch: this.punch,
      hit: this.hit, dead: this.dead || this.state === 'down' ? Math.max(this.deadT, 0.001) : 0,
      weapon: this.weapon, phone: this.phone, gesture: this.state === 'chat' || this.talking ? G.time + this.id : 0, breath: G.time * 2 + this.id,
    });
  }
}
