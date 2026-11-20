// Vehicles: original models, arcade physics on the ground plane (throttle/brake/reverse,
// speed-sensitive steering, lateral grip, handbrake drifts), skid marks and tyre smoke,
// weight-based collisions with walls, posts (lamps break) and other cars, visual suspension
// (roll/pitch), damage states smoke -> fire -> explosion, and drawing (body + instanced wheels).
import { G } from '../core/state.js';
import { clamp, mat4 } from '../core/math.js';
import { resolveCircle, removePost } from '../world/collision.js';
import { groundHeight } from '../world/city.js';
import { smoke, fire, skid, sparks } from '../fx/particles.js';
import { addShake } from '../camera-rig.js';
import { sfx } from '../audio/audio.js';
import { vehicleMesh, WHEELS } from './vehicle-model.js';

export const MODELS = {
  kancil: { name: 'Kancil', len: 3.8, wid: 1.7, max: 38, accel: 9.5, grip: 7.5, steer: 2.2, mass: 0.8, hp: 750, colors: [[0.9, 0.27, 0.23], [0.98, 0.8, 0.24], [0.47, 0.78, 0.86], [0.94, 0.94, 0.92], [0.59, 0.86, 0.47]] },
  merpati: { name: 'Merpati', len: 4.5, wid: 1.84, max: 46, accel: 10.5, grip: 7.6, steer: 2.0, mass: 1, hp: 900, colors: [[0.24, 0.31, 0.55], [0.7, 0.12, 0.16], [0.78, 0.78, 0.8], [0.16, 0.16, 0.19], [0.43, 0.35, 0.27], [0.12, 0.43, 0.35]] },
  taxi: { name: 'Selara Taxi', len: 4.5, wid: 1.84, max: 45, accel: 10.2, grip: 7.6, steer: 2.0, mass: 1, hp: 900, colors: [[0.09, 0.67, 0.63]] },
  vesper: { name: 'Vesper GT', len: 4.45, wid: 1.96, max: 64, accel: 17, grip: 8.8, steer: 2.15, mass: 1, hp: 950, colors: [[0.98, 0.78, 0.08], [0.86, 0.12, 0.2], [0.12, 0.12, 0.14], [0.94, 0.43, 0.08]] },
  bajak: { name: 'Bajak', len: 4.9, wid: 1.98, max: 36, accel: 8, grip: 6.8, steer: 1.8, mass: 1.4, hp: 1100, colors: [[0.92, 0.92, 0.9], [0.35, 0.47, 0.63], [0.78, 0.63, 0.24], [0.27, 0.35, 0.27]] },
  bison: { name: 'Bison', len: 7.6, wid: 2.45, max: 30, accel: 6, grip: 6.4, steer: 1.45, mass: 2.6, hp: 1700, colors: [[0.86, 0.35, 0.16], [0.24, 0.39, 0.67], [0.94, 0.94, 0.94]] },
  patrol: { name: 'Garuda Patrol', len: 4.7, wid: 1.9, max: 56, accel: 14, grip: 8.3, steer: 2.05, mass: 1.15, hp: 1200, colors: [[0.95, 0.95, 0.95]] },
};
export const TRAFFIC_MODELS = ['kancil', 'kancil', 'merpati', 'merpati', 'merpati', 'taxi', 'taxi', 'bajak', 'bison', 'vesper'];

let nextId = 1;
const tmp = mat4.create();

export class Vehicle {
  constructor(model, x, z, angle = 0, color = null) {
    const m = MODELS[model];
    this.id = nextId++; this.kind = 'vehicle'; this.model = model; this.m = m;
    this.x = x; this.z = z; this.y = groundHeight(x, z); this.angle = angle;
    this.vx = 0; this.vz = 0; this.angVel = 0; this.steer = 0;
    this.len = m.len; this.wid = m.wid;
    this.color = color || m.colors[Math.floor(Math.random() * m.colors.length)];
    this.hp = m.hp; this.maxHp = m.hp;
    this.driver = null; this.passengers = [];
    this.role = 'parked'; this.ai = null;
    this.onFire = false; this.wrecked = false; this.wreckTime = 0;
    this.siren = false; this.braking = false; this.reversing = false;
    this.horn = 0; this.skidding = 0; this.lastSkid = null;
    this.ctl = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.hitTimer = 0; this.locked = false;
    this.spin = 0; this.roll = 0; this.pitch = 0; this.hop = 0; this.hopY = 0; this.hopV = 0;
    this.prevVf = 0; this.doorOpen = 0;
  }
  get speed() { return Math.hypot(this.vx, this.vz); }
  get forwardSpeed() { return this.vx * Math.cos(this.angle) + this.vz * Math.sin(this.angle); }
  circles() {
    const fx = Math.cos(this.angle), fz = Math.sin(this.angle), o = this.len / 2 - this.wid / 2;
    return [[this.x + fx * o, this.z + fz * o], [this.x, this.z], [this.x - fx * o, this.z - fz * o]];
  }
  /** side = 1: right-hand (driver) door — the driver sits on the right for left-hand traffic. */
  doorPos(side = 1) {
    const rx = -Math.sin(this.angle) * side, rz = Math.cos(this.angle) * side;
    return { x: this.x + rx * (this.wid / 2 + 0.55) + Math.cos(this.angle) * 0.3, z: this.z + rz * (this.wid / 2 + 0.55) + Math.sin(this.angle) * 0.3 };
  }

  damage(amount, source = null) {
    if (this.wrecked || this.invulnerable) return;
    this.hp -= amount;
    if (this.minHp) this.hp = Math.max(this.hp, this.minHp);
    this.lastAttacker = source;
    if (this.onDamage) this.onDamage(amount, source);
    if (this.hp < this.maxHp * 0.15 && !this.onFire && !this.minHp) { this.onFire = true; }
  }

  update(dt) {
    const m = this.m;
    const ctl = this.wrecked ? { throttle: 0, brake: 0.4, steer: 0, handbrake: true } : this.ctl;
    const fx = Math.cos(this.angle), fz = Math.sin(this.angle);
    let vf = this.vx * fx + this.vz * fz;
    let vs = -this.vx * fz + this.vz * fx;
    const maxF = m.max * (this.hp < this.maxHp * 0.3 ? 0.7 : 1);
    this.braking = false; this.reversing = false;
    if (ctl.throttle > 0) {
      if (vf < -0.5) { vf += 25 * dt; this.braking = true; }
      else vf += m.accel * ctl.throttle * dt * clamp(1.12 - vf / maxF, 0, 1);
    }
    if (ctl.brake > 0) {
      if (vf > 0.5) { vf -= 24 * ctl.brake * dt; this.braking = true; }
      else { vf -= m.accel * 0.6 * ctl.brake * dt; vf = Math.max(vf, -11); this.reversing = true; }
    }
    if (ctl.throttle <= 0 && ctl.brake <= 0) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 2.4 * dt);
    vf -= vf * 0.07 * dt;
    if (ctl.handbrake) { vf -= Math.sign(vf) * Math.min(Math.abs(vf), 8 * dt); this.braking = true; }
    this.steer += (ctl.steer - this.steer) * Math.min(1, dt * 8);
    const sf = clamp(Math.abs(vf) / 3, 0, 1) * (1 - clamp(Math.abs(vf) / maxF, 0, 1) * 0.5);
    const turn = this.steer * m.steer * sf * Math.sign(vf) * (ctl.handbrake ? 1.5 : 1);
    this.angVel += (turn - this.angVel) * Math.min(1, dt * 9);
    this.angle += this.angVel * dt;
    const grip = ctl.handbrake ? 1.0 : m.grip * (G.weather.rain > 0.5 ? 0.8 : 1);
    vs *= Math.exp(-grip * dt);
    const nfx = Math.cos(this.angle), nfz = Math.sin(this.angle);
    this.vx = nfx * vf - nfz * vs; this.vz = nfz * vf + nfx * vs;
    // visual suspension
    const accel = (vf - this.prevVf) / Math.max(dt, 1e-4); this.prevVf = vf;
    this.pitch += (clamp(-accel * 0.004, -0.06, 0.06) - this.pitch) * Math.min(1, dt * 6);
    this.roll += (clamp(-this.angVel * vf * 0.004, -0.08, 0.08) - this.roll) * Math.min(1, dt * 6);
    this.spin += vf * dt / 0.34;
    // skid marks + tyre smoke
    const sliding = Math.abs(vs) > 2.2 || (ctl.handbrake && Math.abs(vf) > 3) || (ctl.throttle > 0.9 && vf > 0.5 && vf < 7 && m.accel > 14);
    this.skidding = sliding ? Math.min(1, this.skidding + dt * 5) : Math.max(0, this.skidding - dt * 4);
    const rx = this.x - nfx * this.len * 0.32, rz = this.z - nfz * this.len * 0.32;
    const wx = -nfz * this.wid * 0.42, wz = nfx * this.wid * 0.42;
    if (sliding) {
      if (this.lastSkid) { skid(this.lastSkid[0], this.lastSkid[1], rx + wx, rz + wz); skid(this.lastSkid[2], this.lastSkid[3], rx - wx, rz - wz); }
      this.lastSkid = [rx + wx, rz + wz, rx - wx, rz - wz];
      if (Math.random() < dt * 18) smoke(rx, 0.3, rz, { size: 0.6, life: 1.4, shade: 0.9, vy: 0.6, grow: 1.6 });
    } else this.lastSkid = null;
    // integrate + collisions
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.collideStatic();
    this.hopV -= 20 * dt; this.hopY = Math.max(0, this.hopY + this.hopV * dt);
    if (this.hop > 0) { this.hopV = this.hop * 6; this.hop = 0; }
    this.y = groundHeight(this.x, this.z) + this.hopY;
    // damage states
    if (!this.wrecked) {
      if (this.hp < this.maxHp * 0.45 && Math.random() < dt * (this.hp < this.maxHp * 0.25 ? 14 : 6)) smoke(this.x + nfx * this.len * 0.35, this.y + 1.0, this.z + nfz * this.len * 0.35, { size: 0.6, life: 2, shade: this.hp < this.maxHp * 0.25 ? 0.05 : 0.6 });
      if (this.onFire) {
        this.hp -= 60 * dt;
        if (Math.random() < dt * 30) fire(this.x + nfx * this.len * 0.3, this.y + 1.0, this.z + nfz * this.len * 0.3, 0.8);
        if (this.hp <= 0) this.explode();
      }
    } else {
      this.wreckTime += dt;
      if (this.wreckTime < 14 && Math.random() < dt * 8) smoke(this.x, this.y + 1.2, this.z, { size: 1, life: 3, shade: 0.05 });
      if (this.wreckTime < 6 && Math.random() < dt * 16) fire(this.x, this.y + 0.9, this.z, 1);
    }
    if (this.hitTimer > 0) this.hitTimer -= dt;
    if (this.horn > 0) this.horn -= dt;
    if (this.doorOpen > 0) this.doorOpen = Math.max(0, this.doorOpen - dt * 1.5);
  }

  collideStatic() {
    const r = this.wid / 2;
    let hit = false, nx = 0, nz = 0;
    for (const [cx, cz] of this.circles()) {
      const res = resolveCircle(cx, cz, r);
      if (!res.hit) continue;
      if (res.post && res.post.kind === 'lamp' && this.speed > 6) {
        // knock the lamp post over and keep going
        res.post.ref.broken = true; res.post.ref.fallYaw = -this.angle; G.city.lampsDirty = true; removePost(res.post);
        sparks(res.post.x, 1, res.post.z, 10, 6); sfx('crash', { x: this.x, y: 1, z: this.z, vol: 0.6 });
        this.vx *= 0.85; this.vz *= 0.85; this.damage(30);
        continue;
      }
      this.x += res.x - cx; this.z += res.z - cz; hit = true; nx = res.nx; nz = res.nz;
    }
    if (hit) {
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) {
        this.vx -= 1.3 * vn * nx; this.vz -= 1.3 * vn * nz;
        this.vx *= 0.82; this.vz *= 0.82;
        this.angVel += (Math.random() - 0.5) * -vn * 0.15;
        if (-vn > 6) this.impact(-vn, null);
      }
    }
  }

  impact(speed, other) {
    if (this.hitTimer > 0) return;
    this.hitTimer = 0.15;
    this.damage((speed - 6) * 15, other && other.driver ? other.driver : null);
    sparks(this.x + Math.cos(this.angle) * this.len / 2, 0.7, this.z + Math.sin(this.angle) * this.len / 2, 10, 6);
    if (this.driver && this.driver.isPlayer) { addShake(Math.min(0.8, speed / 25)); if (speed > 20 && G.slowMo) G.slowMo(0.45); }
    sfx('crash', { x: this.x, y: 1, z: this.z, vol: Math.min(1, speed / 22) });
  }

  explode() {
    if (this.wrecked) return;
    this.wrecked = true; this.onFire = false; this.hp = 0; this.siren = false;
    this.vx *= 0.3; this.vz *= 0.3; this.hop = 1.6;
    if (this.onExplode) this.onExplode();
    G.explode(this.x, this.z, 1, this.lastAttacker, this);
    if (this.driver) {
      const d = this.driver;
      if (d.isPlayer) d.kill('explosion');
      else { d.vehicle = null; d.x = this.x + 1.5; d.z = this.z; if (!G.peds.includes(d)) G.peds.push(d); d.die(this.lastAttacker); }
      this.driver = null;
    }
    for (const p of this.passengers) { p.vehicle = null; p.x = this.x - 1.5; p.z = this.z; if (!G.peds.includes(p)) G.peds.push(p); if (p.die) p.die(this.lastAttacker); }
    this.passengers = [];
  }

  /** Body draw + wheel instances. */
  pushDraw(R, wheels) {
    const model = mat4.create();
    mat4.trs(model, this.x, this.y, this.z, -this.angle, 1, 1, 1, 0, 0);
    mat4.rotateZ(model, model, this.pitch);
    mat4.rotateX(model, model, this.roll);
    if (this.wrecked) mat4.rotateX(model, model, 0.04);
    const tint = this.wrecked ? [0.07, 0.065, 0.06] : this.hp < this.maxHp * 0.5 ? this.color.map((c) => c * (0.55 + 0.45 * this.hp / (this.maxHp * 0.5))) : this.color;
    const night = R.env.night || 0;
    const ph = this.siren ? 1 + (Math.floor(G.time * 7) % 2) : 0;
    R.dynamic.push({ mesh: vehicleMesh(this.model), model, tint, params: [this.wrecked ? 0 : (this.driver ? Math.max(night, 0.15) : 0), this.driver && (this.braking || this.reversing) ? 1 : 0, ph, 0] });
    const wd = WHEELS[this.model], s = wd.r / 0.34;
    const rear = wd.rear ?? -wd.x;
    for (const [lx, front] of [[wd.x, true], [rear, false]]) for (const side of [-1, 1]) {
      mat4.translate(tmp, model, lx, wd.r, side * wd.z);
      if (front) mat4.rotateY(tmp, tmp, -this.steer * 0.5);
      mat4.rotateZ(tmp, tmp, -this.spin);
      mat4.scale(tmp, tmp, s, s, 1);
      const c = this.wrecked ? 0.4 : 1;
      wheels.pushMatrix(tmp, c, c, c);
    }
  }
}

/** Car-vs-car collision (body circles), mass-weighted impulse exchange. */
export function collideVehicles(a, b) {
  const reach = (a.len + b.len) / 2 + 0.5;
  if (Math.abs(a.x - b.x) > reach || Math.abs(a.z - b.z) > reach) return;
  const ca = a.circles(), cb = b.circles(), rr = a.wid / 2 + b.wid / 2;
  for (const p of ca) for (const q of cb) {
    const dx = p[0] - q[0], dz = p[1] - q[1], d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr || d2 < 1e-8) continue;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, pen = rr - d;
    const ma = a.m.mass * (a.wrecked ? 1.6 : 1), mb = b.m.mass * (b.wrecked ? 1.6 : 1);
    a.x += nx * pen * mb / (ma + mb); a.z += nz * pen * mb / (ma + mb);
    b.x -= nx * pen * ma / (ma + mb); b.z -= nz * pen * ma / (ma + mb);
    const rvn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    if (rvn < 0) {
      const j = -1.3 * rvn / (1 / ma + 1 / mb);
      a.vx += j / ma * nx; a.vz += j / ma * nz; b.vx -= j / mb * nx; b.vz -= j / mb * nz;
      a.angVel += (Math.random() - 0.5) * 0.15 * -rvn; b.angVel += (Math.random() - 0.5) * 0.15 * -rvn;
      if (-rvn > 4) { a.impact(-rvn, b); b.impact(-rvn, a); if (a.onCollide) a.onCollide(b, -rvn); if (b.onCollide) b.onCollide(a, -rvn); }
    }
    return;
  }
}
