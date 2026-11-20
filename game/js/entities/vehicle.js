// Vehicles: original models, arcade physics (grip, drift, handbrake), collisions,
// progressive damage (smoke -> fire -> explosion) and top-down drawing.
import { G } from '../state.js';
import { clamp, TAU, angleDiff, rgb, mix } from '../util.js';
import { resolveCircle } from '../world/collision.js';
import { smoke, fire, skid, sparks } from '../fx/particles.js';
import { addLight, addGlow } from '../fx/lighting.js';
import { addShake } from '../camera.js';
import { sfx } from '../audio/audio.js';

export const MODELS = {
  kancil: { name: 'Kancil', len: 36, wid: 19, max: 300, accel: 270, grip: 7.5, steer: 3.0, mass: 0.8, hp: 750, cabin: [0.3, -0.25], colors: [[230, 70, 60], [250, 205, 60], [120, 200, 220], [240, 240, 236], [150, 220, 120]] },
  merpati: { name: 'Merpati', len: 44, wid: 20, max: 340, accel: 290, grip: 7.5, steer: 2.7, mass: 1, hp: 900, cabin: [0.22, -0.28], colors: [[60, 80, 140], [180, 30, 40], [200, 200, 205], [40, 42, 48], [110, 90, 70], [30, 110, 90]] },
  taxi: { name: 'Selara Taxi', len: 44, wid: 20, max: 330, accel: 280, grip: 7.5, steer: 2.7, mass: 1, hp: 900, cabin: [0.22, -0.28], colors: [[24, 170, 160]] },
  vesper: { name: 'Vesper GT', len: 46, wid: 21, max: 480, accel: 440, grip: 8.8, steer: 2.9, mass: 1, hp: 950, cabin: [0.08, -0.3], colors: [[250, 200, 20], [220, 30, 50], [30, 30, 36], [240, 110, 20]] },
  bajak: { name: 'Bajak', len: 50, wid: 22, max: 280, accel: 230, grip: 6.8, steer: 2.4, mass: 1.4, hp: 1100, cabin: [0.36, 0.18], colors: [[235, 235, 230], [90, 120, 160], [200, 160, 60], [70, 90, 70]] },
  bison: { name: 'Bison', len: 72, wid: 26, max: 230, accel: 170, grip: 6.5, steer: 2.0, mass: 2.4, hp: 1700, cabin: [0.5, 0.3], colors: [[220, 90, 40], [60, 100, 170], [240, 240, 240]] },
  patrol: { name: 'Garuda Patrol', len: 46, wid: 21, max: 420, accel: 380, grip: 8.2, steer: 2.8, mass: 1.15, hp: 1200, cabin: [0.18, -0.26], colors: [[245, 245, 245]] },
};
export const TRAFFIC_MODELS = ['kancil', 'kancil', 'merpati', 'merpati', 'merpati', 'taxi', 'taxi', 'bajak', 'bison', 'vesper'];

let nextId = 1;

export class Vehicle {
  constructor(model, x, y, angle = 0, color = null) {
    const m = MODELS[model];
    this.id = nextId++;
    this.kind = 'vehicle';
    this.model = model; this.m = m;
    this.x = x; this.y = y; this.angle = angle;
    this.vx = 0; this.vy = 0; this.angVel = 0; this.steer = 0;
    this.len = m.len; this.wid = m.wid;
    this.color = color || m.colors[Math.floor(Math.random() * m.colors.length)];
    this.hp = m.hp; this.maxHp = m.hp;
    this.driver = null; this.passengers = [];
    this.role = 'parked';          // parked | traffic | police | mission
    this.ai = null;
    this.onFire = false; this.wrecked = false; this.wreckTime = 0;
    this.siren = false; this.braking = false; this.reversing = false;
    this.horn = 0; this.skidding = 0; this.lastSkid = null;
    this.ctl = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.hitTimer = 0;
    this.locked = false;
    this.invulnerable = false;
  }
  get speed() { return Math.hypot(this.vx, this.vy); }
  get forwardSpeed() { return this.vx * Math.cos(this.angle) + this.vy * Math.sin(this.angle); }
  /** Positions of the three collision circles along the body. */
  circles() {
    const fx = Math.cos(this.angle), fy = Math.sin(this.angle);
    const o = this.len / 2 - this.wid / 2;
    return [[this.x + fx * o, this.y + fy * o], [this.x, this.y], [this.x - fx * o, this.y - fy * o]];
  }
  doorPos(side = 1) {
    // driver sits on the right: side = 1 is the right-hand door
    const rx = -Math.sin(this.angle) * side, ry = Math.cos(this.angle) * side;
    return { x: this.x + rx * (this.wid / 2 + 9), y: this.y + ry * (this.wid / 2 + 9) };
  }

  damage(amount, source = null) {
    if (this.wrecked || this.invulnerable) return;
    this.hp -= amount;
    if (this.minHp) this.hp = Math.max(this.hp, this.minHp);
    this.lastAttacker = source;
    if (this.onDamage) this.onDamage(amount, source);
    if (this.hp < this.maxHp * 0.15 && !this.onFire && !this.minHp) { this.onFire = true; this.fireTimer = 0; }
  }

  update(dt) {
    const m = this.m;
    const ctl = this.wrecked ? { throttle: 0, brake: 0.3, steer: 0, handbrake: true } : this.ctl;
    const fx = Math.cos(this.angle), fy = Math.sin(this.angle);
    let vf = this.vx * fx + this.vy * fy;
    let vs = this.vx * -fy + this.vy * fx;
    const maxF = m.max * (this.hp < this.maxHp * 0.3 ? 0.7 : 1);
    this.braking = false; this.reversing = false;
    if (ctl.throttle > 0) {
      if (vf < -8) { vf += 900 * dt; this.braking = true; }
      else vf += m.accel * ctl.throttle * dt * clamp(1.15 - vf / maxF, 0, 1);
    }
    if (ctl.brake > 0) {
      if (vf > 8) { vf -= 820 * ctl.brake * dt; this.braking = true; }
      else { vf -= m.accel * 0.6 * ctl.brake * dt; vf = Math.max(vf, -maxF * 0.35); this.reversing = true; }
    }
    if (ctl.throttle <= 0 && ctl.brake <= 0) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 90 * dt);
    vf -= vf * 0.12 * dt;
    if (ctl.handbrake) { vf -= Math.sign(vf) * Math.min(Math.abs(vf), 230 * dt); this.braking = true; }

    this.steer += (ctl.steer - this.steer) * Math.min(1, dt * 9);
    const sf = clamp(Math.abs(vf) / 70, 0, 1) * (1 - clamp(Math.abs(vf) / maxF, 0, 1) * 0.42);
    const turn = this.steer * m.steer * sf * Math.sign(vf) * (ctl.handbrake ? 1.45 : 1);
    this.angVel += (turn - this.angVel) * Math.min(1, dt * 10);
    this.angle += this.angVel * dt;

    const grip = ctl.handbrake ? 1.1 : m.grip * (G.weather.rain > 0.5 ? 0.75 : 1);
    vs *= Math.exp(-grip * dt);
    const nfx = Math.cos(this.angle), nfy = Math.sin(this.angle);
    this.vx = nfx * vf - nfy * vs;
    this.vy = nfy * vf + nfx * vs;

    // tyre marks + smoke when sliding
    const sliding = Math.abs(vs) > 70 || (ctl.handbrake && Math.abs(vf) > 90) || (ctl.throttle > 0.9 && vf > 20 && vf < 90 && m.accel > 400);
    this.skidding = sliding ? Math.min(1, this.skidding + dt * 5) : Math.max(0, this.skidding - dt * 4);
    const rearX = this.x - nfx * this.len * 0.32, rearY = this.y - nfy * this.len * 0.32;
    const wx = -nfy * this.wid * 0.42, wy = nfx * this.wid * 0.42;
    if (sliding) {
      if (this.lastSkid) {
        skid(this.lastSkid[0], this.lastSkid[1], rearX + wx, rearY + wy);
        skid(this.lastSkid[2], this.lastSkid[3], rearX - wx, rearY - wy);
      }
      this.lastSkid = [rearX + wx, rearY + wy, rearX - wx, rearY - wy];
      if (Math.random() < dt * 22) smoke(rearX + (Math.random() - 0.5) * 12, rearY + (Math.random() - 0.5) * 12, { size: 6, life: 1.1, dark: 0.85, rise: 1.2 });
    } else this.lastSkid = null;

    // integrate + static collisions
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.collideStatic();

    // damage states
    if (!this.wrecked) {
      if (this.hp < this.maxHp * 0.4 && Math.random() < dt * (this.hp < this.maxHp * 0.25 ? 14 : 6)) {
        smoke(this.x + nfx * this.len * 0.35, this.y + nfy * this.len * 0.35, { size: 6, life: 1.6, dark: this.hp < this.maxHp * 0.25 ? 0.1 : 0.6 });
      }
      if (this.onFire) {
        this.hp -= 55 * dt;
        if (Math.random() < dt * 30) fire(this.x + nfx * this.len * 0.3, this.y + nfy * this.len * 0.3, 7);
        addLight(this.x, this.y, 90, '255,140,50', 0.7);
        if (this.hp <= 0) this.explode();
      }
    } else {
      this.wreckTime += dt;
      if (this.wreckTime < 10 && Math.random() < dt * 8) smoke(this.x, this.y, { size: 8, life: 2.2, dark: 0.1 });
      if (this.wreckTime < 5 && Math.random() < dt * 14) fire(this.x, this.y, 8);
    }
    if (this.hitTimer > 0) this.hitTimer -= dt;
    if (this.horn > 0) this.horn -= dt;
  }

  collideStatic() {
    const cs = this.circles();
    const r = this.wid / 2;
    let hit = false, nx = 0, ny = 0;
    for (const [cx, cy] of cs) {
      const res = resolveCircle(cx, cy, r, false);
      if (res.hit) {
        this.x += res.x - cx; this.y += res.y - cy;
        hit = true; nx = res.nx; ny = res.ny;
      }
    }
    if (hit) {
      const vn = this.vx * nx + this.vy * ny;
      if (vn < 0) {
        this.vx -= 1.35 * vn * nx; this.vy -= 1.35 * vn * ny;
        this.vx *= 0.8; this.vy *= 0.8;
        const impact = -vn;
        this.angVel += (Math.random() - 0.5) * impact * 0.01;
        if (impact > 90) this.impact(impact, null);
      }
    }
  }

  impact(speed, other) {
    if (this.hitTimer > 0) return;
    this.hitTimer = 0.15;
    const dmg = (speed - 70) * 1.15;
    this.damage(dmg, other && other.driver ? other.driver : null);
    sparks(this.x + Math.cos(this.angle) * this.len / 2, this.y + Math.sin(this.angle) * this.len / 2, 8, null, 180);
    if (this.driver && this.driver.isPlayer) { addShake(Math.min(0.6, speed / 600)); }
    sfx('crash', { x: this.x, y: this.y, vol: Math.min(1, speed / 350) });
  }

  explode() {
    if (this.wrecked) return;
    this.wrecked = true; this.onFire = false; this.hp = 0;
    this.vx *= 0.3; this.vy *= 0.3;
    if (this.onExplode) this.onExplode();
    G.explode(this.x, this.y, 1, this.lastAttacker, this);
    // occupants die
    if (this.driver) {
      const d = this.driver;
      if (d.isPlayer) d.kill('explosion');
      else { d.vehicle = null; d.x = this.x; d.y = this.y; d.die(this.lastAttacker); }
      this.driver = null;
    }
    for (const p of this.passengers) { p.vehicle = null; p.x = this.x + 10; p.y = this.y; if (p.die) p.die(this.lastAttacker); }
    this.passengers = [];
    this.siren = false;
  }
}

/** Car-vs-car collision between two vehicles (approximated by their body circles). */
export function collideVehicles(a, b) {
  const reach = (a.len + b.len) / 2 + 4;
  if (Math.abs(a.x - b.x) > reach || Math.abs(a.y - b.y) > reach) return;
  const ca = a.circles(), cb = b.circles();
  const rr = a.wid / 2 + b.wid / 2;
  for (const p of ca) for (const q of cb) {
    const dx = p[0] - q[0], dy = p[1] - q[1];
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr || d2 < 1e-6) continue;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, pen = rr - d;
    const ma = a.m.mass * (a.wrecked ? 1.5 : 1), mb = b.m.mass * (b.wrecked ? 1.5 : 1);
    const ta = mb / (ma + mb), tb = ma / (ma + mb);
    a.x += nx * pen * ta; a.y += ny * pen * ta;
    b.x -= nx * pen * tb; b.y -= ny * pen * tb;
    const rvn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (rvn < 0) {
      const j = -(1.3) * rvn / (1 / ma + 1 / mb);
      a.vx += (j / ma) * nx; a.vy += (j / ma) * ny;
      b.vx -= (j / mb) * nx; b.vy -= (j / mb) * ny;
      a.angVel += (Math.random() - 0.5) * 0.02 * -rvn;
      b.angVel += (Math.random() - 0.5) * 0.02 * -rvn;
      if (-rvn > 80) {
        a.impact(-rvn, b); b.impact(-rvn, a);
        if (a.onCollide) a.onCollide(b, -rvn);
        if (b.onCollide) b.onCollide(a, -rvn);
      }
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// drawing (local frame: +x forward)

function shade(c, k, amb) { return rgb(c[0] * k * amb[0], c[1] * k * amb[1], c[2] * k * amb[2]); }

function bodyPath(ctx, L, W, nose = 6, tail = 4) {
  const x0 = -L / 2, x1 = L / 2, y0 = -W / 2, y1 = W / 2;
  ctx.beginPath();
  ctx.moveTo(x0 + tail, y0);
  ctx.lineTo(x1 - nose, y0);
  ctx.quadraticCurveTo(x1, y0, x1, y0 + nose);
  ctx.lineTo(x1, y1 - nose);
  ctx.quadraticCurveTo(x1, y1, x1 - nose, y1);
  ctx.lineTo(x0 + tail, y1);
  ctx.quadraticCurveTo(x0, y1, x0, y1 - tail);
  ctx.lineTo(x0, y0 + tail);
  ctx.quadraticCurveTo(x0, y0, x0 + tail, y0);
  ctx.closePath();
}

export function drawVehicle(ctx, v, t) {
  const m = v.m, L = v.len, W = v.wid;
  const amb = G.light.amb;
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate(v.angle);
  // ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(-L / 2 + 3, -W / 2 + 3, L, W);
  // wheels
  ctx.fillStyle = '#141414';
  const wx = L * 0.32, wy = W / 2 - 1;
  for (const sx of [wx, -wx]) for (const sy of [-wy, wy]) {
    ctx.save(); ctx.translate(sx, sy);
    if (sx > 0) ctx.rotate(v.steer * 0.5);
    ctx.fillRect(-5, -2.5, 10, 5);
    ctx.restore();
  }
  let col = v.color;
  if (v.wrecked) col = [42, 38, 36];
  else if (v.hp < v.maxHp * 0.5) col = mix(col, [70, 60, 55], (1 - v.hp / (v.maxHp * 0.5)) * 0.45);

  if (v.model === 'bison') {
    // cab + cargo box
    ctx.fillStyle = shade(col, 1, amb);
    ctx.translate(L / 2 - 10, 0); bodyPath(ctx, 20, W - 2, 5, 2); ctx.fill(); ctx.translate(-(L / 2 - 10), 0);
    ctx.fillStyle = shade([30, 40, 50], 1, amb); ctx.fillRect(L / 2 - 8, -W / 2 + 3, 5, W - 6);
    ctx.fillStyle = shade(v.wrecked ? [40, 40, 40] : [236, 236, 230], 1, amb);
    ctx.fillRect(-L / 2, -W / 2, L - 22, W);
    ctx.strokeStyle = shade([150, 150, 150], 1, amb); ctx.lineWidth = 1;
    ctx.beginPath(); for (let x = -L / 2 + 6; x < L / 2 - 24; x += 6) { ctx.moveTo(x, -W / 2 + 1); ctx.lineTo(x, W / 2 - 1); } ctx.stroke();
    if (!v.wrecked) {
      ctx.fillStyle = shade(col, 1, amb); ctx.fillRect(-L / 2 + 8, -3, L - 40, 6);
      if (v.cargoLabel) { ctx.save(); ctx.fillStyle = '#fff'; ctx.font = '900 7px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(v.cargoLabel, -12, 0); ctx.restore(); }
    }
  } else {
    // body with a soft highlight along the spine
    const g = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
    g.addColorStop(0, shade(col, 0.72, amb)); g.addColorStop(0.5, shade(col, 1.08, amb)); g.addColorStop(1, shade(col, 0.72, amb));
    ctx.fillStyle = g;
    const nose = v.model === 'vesper' ? 10 : v.model === 'bajak' ? 4 : 7;
    bodyPath(ctx, L, W, nose, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    const [c0, c1] = m.cabin; // cabin start/end as fraction of half-length (front positive)
    const xf = c0 * L, xr = c1 * L;
    if (v.model === 'patrol') {
      ctx.fillStyle = shade([20, 24, 34], 1, amb); ctx.fillRect(-L / 2 + 2, -W / 2 + 1, L * 0.25, W - 2); ctx.fillRect(L / 2 - L * 0.2, -W / 2 + 1, L * 0.2 - 3, W - 2);
      ctx.fillStyle = shade([30, 70, 160], 1, amb); ctx.fillRect(-L * 0.1, -W / 2, L * 0.25, 2); ctx.fillRect(-L * 0.1, W / 2 - 2, L * 0.25, 2);
    }
    if (v.model === 'vesper' && !v.wrecked) {
      ctx.fillStyle = shade(v.stripe || [20, 20, 24], 1, amb);
      ctx.fillRect(-L / 2 + 2, -2.5, L - 4, 5);
    }
    if (v.model === 'taxi' && !v.wrecked) {
      ctx.fillStyle = shade([250, 250, 250], 1, amb);
      for (let i = 0; i < 6; i++) ctx.fillRect(-L / 2 + 6 + i * 6, W / 2 - 2.5, 3, 2.5);
    }
    // windscreen, roof, rear window
    const glass = v.wrecked ? '#1a1a1a' : shade([40, 60, 80], 1, amb);
    ctx.fillStyle = glass;
    ctx.beginPath(); ctx.moveTo(xf + 6, -W / 2 + 3); ctx.lineTo(xf + 6, W / 2 - 3); ctx.lineTo(xf - 1, W / 2 - 2.5); ctx.lineTo(xf - 1, -W / 2 + 2.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(col, v.wrecked ? 1 : 0.92, amb);
    ctx.fillRect(xr, -W / 2 + 2.5, xf - xr - 1, W - 5);
    ctx.fillStyle = glass;
    ctx.fillRect(xr - 4, -W / 2 + 3.5, 4, W - 7);
    if (!v.wrecked) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath(); ctx.moveTo(xf + 5, -W / 2 + 4); ctx.lineTo(xf + 2, -W / 2 + 4); ctx.lineTo(xf + 1, -1); ctx.closePath(); ctx.fill();
    }
    if (v.model === 'bajak') {
      ctx.strokeStyle = shade(col, 0.75, amb); ctx.lineWidth = 1;
      ctx.beginPath(); for (let x = xr + 6; x < xf - 2; x += 6) { ctx.moveTo(x, -W / 2 + 3); ctx.lineTo(x, W / 2 - 3); } ctx.stroke();
    }
    if (v.model === 'vesper' && !v.wrecked) { // spoiler
      ctx.fillStyle = shade([25, 25, 28], 1, amb); ctx.fillRect(-L / 2 - 1, -W / 2 + 1, 4, W - 2);
    }
    if (v.model === 'taxi' && !v.wrecked) {
      ctx.fillStyle = shade([255, 240, 120], 1.1, amb); ctx.fillRect(-4, -6, 7, 12);
      ctx.save(); ctx.rotate(Math.PI / 2); ctx.fillStyle = '#123'; ctx.font = '900 4.5px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('TAXI', 0, 0.5); ctx.restore();
    }
    if (v.model === 'patrol' && !v.wrecked) {
      // lightbar
      const on = v.siren ? Math.floor(t * 8) % 2 : -1;
      ctx.fillStyle = on === 0 ? '#ff2a3a' : '#5a1018'; ctx.fillRect(-2, -W / 2 + 3, 5, W / 2 - 3);
      ctx.fillStyle = on === 1 ? '#2a6bff' : '#10204a'; ctx.fillRect(-2, 0, 5, W / 2 - 3);
    }
  }
  // lights
  if (!v.wrecked) {
    const night = G.light.night;
    ctx.fillStyle = night > 0.2 && v.driver ? '#fffbe0' : shade([240, 236, 200], 1, amb);
    ctx.fillRect(L / 2 - 3, -W / 2 + 2, 3, 4); ctx.fillRect(L / 2 - 3, W / 2 - 6, 3, 4);
    ctx.fillStyle = v.braking || v.reversing ? '#ff3030' : shade([150, 20, 20], 1, amb);
    ctx.fillRect(-L / 2, -W / 2 + 2, 2.5, 4); ctx.fillRect(-L / 2, W / 2 - 6, 2.5, 4);
  }
  ctx.restore();
  emitVehicleLights(v, t);
}

function emitVehicleLights(v, t) {
  if (v.wrecked) return;
  const fx = Math.cos(v.angle), fy = Math.sin(v.angle);
  const night = G.light.night;
  if (v.driver && night > 0.05) {
    const hx = v.x + fx * v.len / 2, hy = v.y + fy * v.len / 2;
    addLight(hx, hy, 230, '255,244,214', 0.95, 'cone', v.angle, 0.42);
    const rx = -fy * v.wid * 0.35, ry = fx * v.wid * 0.35;
    addGlow(hx + rx, hy + ry, 9, '255,250,225', 0.9); addGlow(hx - rx, hy - ry, 9, '255,250,225', 0.9);
    const tx = v.x - fx * v.len / 2, ty = v.y - fy * v.len / 2;
    addLight(tx, ty, 40, '255,40,40', v.braking ? 0.8 : 0.4);
    addGlow(tx + rx, ty + ry, v.braking ? 8 : 5, '255,40,40', 0.9); addGlow(tx - rx, ty - ry, v.braking ? 8 : 5, '255,40,40', 0.9);
  }
  if (v.siren) {
    const ph = Math.floor(t * 8) % 2;
    const c = ph ? '60,110,255' : '255,40,60';
    const l = { x: v.x, y: v.y };
    addLight(l.x, l.y, 150, c, 1);
    G.lightForce = true;
    addGlow(v.x - fy * (ph ? 5 : -5), v.y + fx * (ph ? 5 : -5), 14, c, 1);
  }
}
