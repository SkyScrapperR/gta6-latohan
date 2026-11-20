// Pedestrians: varied looks, sidewalk-ring walking with zebra crossings, idling,
// fleeing from danger, knock-downs, and the shared top-down human renderer.
import { G } from '../state.js';
import { TAU, clamp, rgb, angleDiff, RNG } from '../util.js';
import { resolveCircle } from '../world/collision.js';
import { CELL, ROAD, NB } from '../world/city.js';
import { decal } from '../fx/particles.js';

const SKINS = [[255, 220, 185], [236, 188, 150], [205, 150, 110], [170, 115, 80], [128, 84, 56], [96, 62, 42]];
const HAIRS = [[30, 24, 20], [60, 40, 25], [110, 70, 40], [200, 160, 90], [20, 20, 20], [150, 150, 150], [170, 60, 40]];
const SHIRTS = [[230, 70, 70], [70, 140, 220], [250, 210, 70], [90, 190, 120], [240, 240, 240], [240, 130, 50], [160, 90, 200], [40, 50, 60], [250, 150, 190], [80, 200, 210]];
const PANTS = [[40, 50, 80], [60, 60, 66], [120, 100, 80], [30, 30, 34], [200, 190, 160]];

export const OUTFITS = {
  player: { skin: [205, 150, 110], hair: [24, 20, 18], shirt: [26, 176, 168], pants: [36, 40, 56], jacket: true },
  cop: { skin: null, hair: [24, 24, 30], shirt: [40, 64, 130], pants: [24, 30, 50], cap: [24, 34, 70] },
  gang: { skin: null, hair: [20, 20, 22], shirt: [118, 42, 168], pants: [28, 24, 34], bandana: [200, 70, 230] },
  boss: { skin: [214, 170, 130], hair: [70, 70, 74], shirt: [238, 236, 244], pants: [238, 236, 244], tie: [150, 50, 220] },
  dex: { skin: [180, 125, 90], hair: [30, 28, 26], shirt: [140, 210, 60], pants: [40, 40, 46], hood: true },
  lin: { skin: [222, 180, 140], hair: [200, 200, 205], shirt: [240, 140, 40], pants: [60, 60, 70] },
};

let nextId = 1;
const pedRng = new RNG(4242);

export class Ped {
  constructor(kind, x, y, outfit = null) {
    this.id = nextId++;
    this.kind = kind; // civ | cop | gang | boss | story
    this.x = x; this.y = y; this.angle = pedRng.range(0, TAU);
    this.r = 7;
    this.vx = 0; this.vy = 0; this.kx = 0; this.ky = 0;
    this.hp = 50; this.maxHp = 50; this.armor = 0;
    const o = outfit ? { ...OUTFITS[outfit] } : null;
    this.look = {
      skin: (o && o.skin) || pedRng.pick(SKINS),
      hair: (o && o.hair) || pedRng.pick(HAIRS),
      shirt: (o && o.shirt) || pedRng.pick(SHIRTS),
      pants: (o && o.pants) || pedRng.pick(PANTS),
      cap: o && o.cap, bandana: o && o.bandana, tie: o && o.tie, hood: o && o.hood, jacket: o && o.jacket,
      long: pedRng.chance(0.35),
    };
    this.state = 'walk';
    this.stateTime = 0;
    this.walkSpeed = pedRng.range(34, 48);
    this.phase = pedRng.range(0, TAU);
    this.dead = false; this.deadTime = 0;
    this.downTime = 0;
    this.vehicle = null;
    this.weapon = null; this.cooldown = 0; this.ammo = Infinity;
    this.fearX = 0; this.fearY = 0;
    this.ring = null; this.corner = 0; this.dir = 1;
    this.moving = false;
    this.mission = false;     // mission-owned peds are never despawned by the spawner
    this.cash = pedRng.int(5, 40);
  }

  /** Attach to the sidewalk ring of whatever block we are next to. */
  joinRing() {
    const bx = clamp(Math.floor((this.x - ROAD / 2) / CELL), 0, NB - 1);
    const by = clamp(Math.floor((this.y - ROAD / 2) / CELL), 0, NB - 1);
    const x0 = bx * CELL + ROAD + 7, y0 = by * CELL + ROAD + 7, x1 = (bx + 1) * CELL - 7, y1 = (by + 1) * CELL - 7;
    this.ring = { bx, by, pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] };
    let best = 0, bd = Infinity;
    this.ring.pts.forEach((p, i) => { const d = (p[0] - this.x) ** 2 + (p[1] - this.y) ** 2; if (d < bd) { bd = d; best = i; } });
    this.corner = best;
    this.dir = pedRng.chance(0.5) ? 1 : -1;
  }

  damage(amount, source = null, dx = 0, dy = 0) {
    if (this.dead) return;
    if (this.armor > 0) { const a = Math.min(this.armor, amount * 0.7); this.armor -= a; amount -= a; }
    this.hp -= amount;
    this.kx += dx * 120; this.ky += dy * 120;
    this.lastAttacker = source;
    if (this.onDamage) this.onDamage(amount, source);
    if (this.hp <= 0) this.die(source);
    else if (this.kind === 'civ') this.scare(source ? source.x : this.x - dx, source ? source.y : this.y - dy, 6);
  }

  knockDown(vx, vy, dmg, source) {
    if (this.dead) return;
    this.kx = vx * 0.9; this.ky = vy * 0.9;
    this.state = 'down'; this.downTime = 2.2;
    this.damage(dmg, source, 0, 0);
  }

  die(killer = null) {
    if (this.dead) return;
    this.dead = true; this.state = 'dead'; this.deadTime = 0; this.hp = 0;
    this.angle += pedRng.range(-1, 1);
    decal('mark', this.x + pedRng.range(-3, 3), this.y + pedRng.range(-3, 3), pedRng.range(5, 9));
    if (this.onDeath) this.onDeath(killer);
    if (G.onPedDeath) G.onPedDeath(this, killer);
  }

  scare(x, y, time = 5) {
    if (this.dead || this.kind !== 'civ' || this.vehicle) return;
    this.state = 'flee'; this.stateTime = time; this.fearX = x; this.fearY = y;
  }

  update(dt) {
    this.phase += dt * 10;
    if (this.dead) { this.deadTime += dt; this.applyKnock(dt); return; }
    if (this.vehicle) { this.x = this.vehicle.x; this.y = this.vehicle.y; if (this.companion && this.brain) this.brain(this, dt); return; }
    if (this.state === 'down') {
      this.downTime -= dt; this.applyKnock(dt);
      if (this.downTime <= 0) { this.state = this.kind === 'civ' ? 'flee' : 'combat'; this.stateTime = 4; this.fearX = this.x - this.kx; this.fearY = this.y - this.ky; }
      return;
    }
    if (this.brain) this.brain(this, dt);
    else this.civBrain(dt);
    this.applyKnock(dt);
  }

  applyKnock(dt) {
    this.x += this.kx * dt; this.y += this.ky * dt;
    this.kx *= Math.exp(-dt * 5); this.ky *= Math.exp(-dt * 5);
    const r = resolveCircle(this.x, this.y, this.r, true);
    this.x = r.x; this.y = r.y;
  }

  /** Move towards a point at speed; returns remaining distance. */
  moveTo(tx, ty, speed, dt) {
    const dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy);
    if (d < 0.5) { this.moving = false; return 0; }
    const s = Math.min(speed * dt, d);
    this.x += (dx / d) * s; this.y += (dy / d) * s;
    const want = Math.atan2(dy, dx);
    this.angle += angleDiff(this.angle, want) * Math.min(1, dt * 10);
    const r = resolveCircle(this.x, this.y, this.r, false);
    this.x = r.x; this.y = r.y;
    this.moving = true; this.speedNow = speed;
    return d;
  }

  civBrain(dt) {
    this.stateTime -= dt;
    if (this.state === 'flee') {
      const dx = this.x - this.fearX, dy = this.y - this.fearY, d = Math.hypot(dx, dy) || 1;
      this.moveTo(this.x + (dx / d) * 40, this.y + (dy / d) * 40, 120, dt);
      if (this.stateTime <= 0) { this.state = 'walk'; this.joinRing(); }
      return;
    }
    if (this.state === 'idle') {
      this.moving = false;
      if (this.stateTime <= 0) this.state = 'walk';
      return;
    }
    if (!this.ring) this.joinRing();
    const p = this.ring.pts[this.corner];
    const d = this.moveTo(p[0], p[1], this.walkSpeed, dt);
    if (d < 3) {
      // at a corner: maybe cross the road on the zebra, maybe idle, else continue
      if (pedRng.chance(0.22)) this.crossRoad();
      else this.corner = (this.corner + this.dir + 4) % 4;
      if (pedRng.chance(0.15)) { this.state = 'idle'; this.stateTime = pedRng.range(1, 4); }
    }
  }

  crossRoad() {
    const { bx, by } = this.ring;
    const c = this.corner; // 0 TL, 1 TR, 2 BR, 3 BL
    const horizontal = pedRng.chance(0.5);
    let nbx = bx, nby = by;
    if (horizontal) nbx += c === 1 || c === 2 ? 1 : -1; else nby += c === 2 || c === 3 ? 1 : -1;
    if (nbx < 0 || nby < 0 || nbx >= NB || nby >= NB) { this.corner = (c + this.dir + 4) % 4; return; }
    const map = horizontal ? { 0: 1, 1: 0, 2: 3, 3: 2 } : { 0: 3, 3: 0, 1: 2, 2: 1 };
    const x0 = nbx * CELL + ROAD + 7, y0 = nby * CELL + ROAD + 7, x1 = (nbx + 1) * CELL - 7, y1 = (nby + 1) * CELL - 7;
    this.ring = { bx: nbx, by: nby, pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] };
    this.corner = map[c];
  }

  draw(ctx, t) { drawHuman(ctx, this, t); }
}

/** Top-down person: legs, torso, arms, head + hair; lying flat when dead/down. */
export function drawHuman(ctx, h, t) {
  if (h.vehicle) return;
  const amb = G.light.amb;
  const L = h.look;
  const col = (c, k = 1) => rgb(c[0] * amb[0] * k, c[1] * amb[1] * k, c[2] * amb[2] * k);
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.rotate(h.angle);
  if (h.dead || h.state === 'down') {
    // lying down
    ctx.fillStyle = col(L.pants, 0.9); ctx.fillRect(-14, -3.5, 9, 3); ctx.fillRect(-14, 0.5, 9, 3);
    ctx.fillStyle = col(L.shirt, h.dead ? 0.8 : 1); ctx.beginPath(); ctx.ellipse(-1, 0, 7, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = col(L.skin); ctx.beginPath(); ctx.arc(-3, -9, 2.2, 0, TAU); ctx.arc(-3, 9, 2.2, 0, TAU); ctx.fill();
    ctx.fillStyle = col(L.skin); ctx.beginPath(); ctx.arc(8, 0, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = col(L.hair); ctx.beginPath(); ctx.arc(9, 0, 4, -1.2, 1.2); ctx.fill();
    ctx.restore();
    return;
  }
  const moving = h.moving || (h.speedNow && h.speedNow > 5);
  const sw = moving ? Math.sin(h.phase * (h.speedNow > 80 ? 1.5 : 1)) * 4 : 0;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(2, 2, 7, 8, 0, 0, TAU); ctx.fill();
  // legs
  ctx.fillStyle = col(L.pants);
  ctx.fillRect(-2.5 + sw, -4.5, 5, 3.4); ctx.fillRect(-2.5 - sw, 1.1, 5, 3.4);
  // arms
  const armed = h.weapon && h.weapon !== 'fists';
  ctx.fillStyle = col(L.skin);
  if (armed) {
    ctx.fillStyle = col(L.shirt, 0.85); ctx.fillRect(1, -6.5, 7, 3); ctx.fillRect(1, 3.5, 7, 3);
    ctx.fillStyle = '#1b1b1f'; const gl = h.weapon === 'thunder' ? 13 : h.weapon === 'wasp' ? 11 : 8;
    ctx.fillRect(6, -1.3, gl, 2.6);
    ctx.fillStyle = col(L.skin); ctx.beginPath(); ctx.arc(8, 0, 2, 0, TAU); ctx.fill();
  } else {
    const punch = h.punchT > 0 ? 6 : 0;
    ctx.beginPath(); ctx.arc(-sw * 0.8 + punch, -7.5, 2.1, 0, TAU); ctx.arc(sw * 0.8, 7.5, 2.1, 0, TAU); ctx.fill();
  }
  // torso
  ctx.fillStyle = col(L.shirt);
  ctx.beginPath(); ctx.ellipse(0, 0, 4.4, 7.2, 0, 0, TAU); ctx.fill();
  if (L.jacket) { ctx.fillStyle = col([20, 24, 30]); ctx.fillRect(-1, -1, 4.6, 2); }
  if (L.tie) { ctx.fillStyle = col(L.tie); ctx.fillRect(1.5, -1, 3, 2); }
  // head
  ctx.fillStyle = col(L.skin); ctx.beginPath(); ctx.arc(0.6, 0, 3.9, 0, TAU); ctx.fill();
  if (L.cap) { ctx.fillStyle = col(L.cap); ctx.beginPath(); ctx.arc(0.3, 0, 4.1, 0, TAU); ctx.fill(); ctx.fillRect(2.5, -3, 3, 6); }
  else if (L.hood) { ctx.fillStyle = col(L.shirt, 0.8); ctx.beginPath(); ctx.arc(-0.4, 0, 4.3, Math.PI * 0.35, Math.PI * 1.65); ctx.fill(); }
  else {
    ctx.fillStyle = col(L.hair);
    ctx.beginPath(); ctx.arc(-0.2, 0, L.long ? 4.4 : 4, Math.PI * 0.4, Math.PI * 1.6); ctx.fill();
    if (L.bandana) { ctx.fillStyle = col(L.bandana); ctx.fillRect(-1, -4, 2, 8); }
  }
  ctx.restore();
}
