// Kai Santoso: camera-relative WASD movement, sprint with stamina, jump, over-the-shoulder
// aiming (RMB), shooting/punching (LMB), reloading, weapon switching, entering/exiting and
// carjacking vehicles through the driver door, driving controls and drive-by shooting.
import { G } from '../core/state.js';
import { input, isDown, wasPressed } from '../core/input.js';
import { clamp, angleDiff, lerp } from '../core/math.js';
import { resolveCircle } from '../world/collision.js';
import { groundHeight } from '../world/city.js';
import { rig } from '../camera-rig.js';
import { drawCharacter, outfitLook } from './character-model.js';
import { WEAPONS, WEAPON_ORDER, fireWeapon } from '../combat/weapons.js';
import { reportCrime } from '../ai/police.js';
import { sfx, cycleRadio, footstep } from '../audio/audio.js';

export class Player {
  constructor(x, z) {
    this.isPlayer = true; this.kind = 'player';
    this.x = x; this.z = z; this.y = groundHeight(x, z); this.angle = 0; this.r = 0.35;
    this.hp = 100; this.maxHp = 100; this.armor = 0; this.stamina = 1; this.alive = true;
    this.vehicle = null;
    this.weapons = { fists: true, kobra: false, wasp: false, thunder: false };
    this.ammo = { kobra: 0, wasp: 0, thunder: 0 };      // reserve
    this.clip = { kobra: 0, wasp: 0, thunder: 0 };      // loaded
    this.weapon = 'fists';
    this.cooldown = 0; this.reloading = 0;
    this.walk = 0; this.speedNow = 0; this.jumpY = 0; this.vy = 0;
    this.look = outfitLook('kai');
    this.entering = null; this.punch = 0; this.hit = 0; this.deadT = 0;
    this.aiming = false; this.recoil = 0;
    this.controlsLocked = false; this.stepT = 0;
  }

  giveWeapon(id, ammo) {
    this.weapons[id] = true;
    if (id === 'fists') return;
    this.ammo[id] += ammo;
    if (this.clip[id] === 0) this.reload(id, true);
    if (this.weapon === 'fists') this.weapon = id;
  }
  totalAmmo(id) { return (this.ammo[id] || 0) + (this.clip[id] || 0); }
  reload(id = this.weapon, instant = false) {
    const w = WEAPONS[id];
    if (!w || w.melee || this.ammo[id] <= 0 || this.clip[id] >= w.clip) return;
    if (instant) { const n = Math.min(w.clip - this.clip[id], this.ammo[id]); this.clip[id] += n; this.ammo[id] -= n; return; }
    if (this.reloading > 0) return;
    this.reloading = w.reload; this.reloadId = id;
    sfx('reload', { x: this.x, y: 1.4, z: this.z });
  }
  cycleWeapon(dir) {
    let i = WEAPON_ORDER.indexOf(this.weapon);
    for (let k = 0; k < WEAPON_ORDER.length; k++) {
      i = (i + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length;
      const id = WEAPON_ORDER[i];
      if (this.weapons[id] && (id === 'fists' || this.totalAmmo(id) > 0)) { this.weapon = id; this.reloading = 0; sfx('click'); return; }
    }
  }

  damage(amount, source = null) {
    if (!this.alive || G.godMode) return;
    if (this.armor > 0) { const a = Math.min(this.armor, amount * 0.7); this.armor -= a; amount -= a; }
    this.hp -= amount; this.hit = 1;
    if (source && source.x !== undefined) G.ui.damageDirs.push({ a: Math.atan2(source.z - this.z, source.x - this.x), t: 1.2 });
    if (this.hp <= 0) this.kill('damage');
  }
  kill(cause) {
    if (!this.alive) return;
    this.alive = false; this.hp = 0; this.deadT = 0;
    if (this.vehicle) { const v = this.vehicle; v.driver = null; this.vehicle = null; const d = v.doorPos(1); this.x = d.x; this.z = d.z; }
    if (G.onPlayerDeath) G.onPlayerDeath(cause);
  }
  get speed() { return this.vehicle ? this.vehicle.speed : this.speedNow; }

  update(dt) {
    this.hit = Math.max(0, this.hit - dt * 3);
    if (!this.alive) { this.deadT = Math.min(1, this.deadT + dt * 2.2); return; }
    this.cooldown -= dt; this.recoil = Math.max(0, this.recoil - dt * 6);
    if (this.punch > 0) this.punch = Math.max(0, this.punch - dt * 4);
    if (this.reloading > 0) { this.reloading -= dt; if (this.reloading <= 0) { this.reload(this.reloadId, true); sfx('click'); } }
    if (!this.controlsLocked) {
      if (input.mouse.wheel) this.cycleWeapon(input.mouse.wheel > 0 ? 1 : -1);
      if (wasPressed('nextWeapon')) this.cycleWeapon(1);
      if (wasPressed('prevWeapon')) this.cycleWeapon(-1);
    }
    if (this.weapon !== 'fists' && this.totalAmmo(this.weapon) <= 0) this.cycleWeapon(1);
    if (this.vehicle) this.updateDriving(dt); else this.updateOnFoot(dt);
  }

  updateOnFoot(dt) {
    if (this.entering) { this.updateEntering(dt); return; }
    const locked = this.controlsLocked;
    this.aiming = !locked && input.mouse.right && this.alive;
    let f = 0, s = 0;
    if (!locked) { if (isDown('up')) f += 1; if (isDown('down')) f -= 1; if (isDown('right')) s += 1; if (isDown('left')) s -= 1; }
    const fx = Math.cos(rig.yaw), fz = Math.sin(rig.yaw), rx = -fz, rz = fx;
    let mx = fx * f + rx * s, mz = fz * f + rz * s;
    const len = Math.hypot(mx, mz);
    const sprint = isDown('sprint') && len > 0 && this.stamina > 0.03 && !this.aiming && !locked;
    if (sprint) this.stamina = Math.max(0, this.stamina - dt * 0.2); else this.stamina = Math.min(1, this.stamina + dt * 0.12);
    const sp = this.aiming ? 2.6 : sprint ? 7.6 : 4.6;
    if (len > 0) { mx /= len; mz /= len; }
    this.x += mx * sp * dt; this.z += mz * sp * dt;
    this.speedNow = len > 0 ? sp : 0;
    this.walk += dt * (len > 0 ? (sprint ? 11 : 8.5) : 0);
    if (len > 0) { this.stepT -= dt * (sprint ? 1.5 : 1); if (this.stepT <= 0) { this.stepT = 0.36; footstep(this.x, this.z, sprint); } }
    // face movement, or the camera direction while aiming/shooting
    const faceCam = this.aiming || (input.mouse.left && this.weapon !== 'fists' && !locked);
    const want = faceCam ? rig.yaw : len > 0 ? Math.atan2(mz, mx) : this.angle;
    this.angle += angleDiff(this.angle, want) * Math.min(1, dt * (faceCam ? 18 : 10));
    // jump
    if (!locked && wasPressed('jump') && this.jumpY <= 0.001) { this.vy = 4.4; sfx('jump', { x: this.x, y: 1, z: this.z }); }
    this.vy -= 13 * dt; this.jumpY = Math.max(0, this.jumpY + this.vy * dt); if (this.jumpY <= 0) this.vy = 0;
    // collisions with the world and with cars
    const r = resolveCircle(this.x, this.z, this.r);
    this.x = r.x; this.z = r.z;
    for (const v of G.vehicles) {
      if (Math.abs(v.x - this.x) > 6 || Math.abs(v.z - this.z) > 6) continue;
      for (const [cx, cz] of v.circles()) {
        const dx = this.x - cx, dz = this.z - cz, d = Math.hypot(dx, dz), rr = v.wid / 2 + this.r;
        if (d < rr && d > 1e-4) { this.x = cx + dx / d * rr; this.z = cz + dz / d * rr; if (v.speed > 9 && !v.wrecked) this.damage(v.speed * 1.2, v.driver); }
      }
    }
    this.y = groundHeight(this.x, this.z);
    if (locked) return;
    // attack
    const w = WEAPONS[this.weapon];
    if (wasPressed('reload') && !w.melee) this.reload();
    const trigger = w.auto ? input.mouse.left : input.mouse.clicked;
    if (trigger && this.cooldown <= 0 && this.reloading <= 0) this.attack(rig.yaw);
    if (wasPressed('enter')) this.tryEnter();
  }

  attack(angle) {
    const w = WEAPONS[this.weapon];
    if (w.melee) { this.cooldown = w.rate; this.punch = 1; fireWeapon(this, 'fists', this.x, 1.3, this.z, this.angle, 0); return; }
    if (this.clip[this.weapon] <= 0) { if (this.ammo[this.weapon] > 0) this.reload(); else sfx('dry'); this.cooldown = 0.25; return; }
    this.cooldown = w.rate;
    this.angle = angle;
    const inacc = (this.aiming ? 0 : 0.035) + (this.speedNow > 5 ? 0.04 : 0) + G.ui.crossBloom * 0.04;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    fireWeapon(this, this.weapon, this.x + ca * 0.7 - sa * 0.27, 1.45 + this.y, this.z + sa * 0.7 + ca * 0.27, angle, inacc, rig.pitch);
    this.clip[this.weapon]--;
    this.recoil = 1;
    G.ui.crossBloom = Math.min(1, G.ui.crossBloom + w.bloom);
    if (this.clip[this.weapon] <= 0 && this.ammo[this.weapon] > 0) this.reload();
  }

  nearestVehicle(maxD = 4.5) {
    let best = null, bd = maxD;
    for (const v of G.vehicles) {
      if (v.wrecked || v.locked) continue;
      const d = Math.hypot(v.x - this.x, v.z - this.z) - v.len * 0.3;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }
  tryEnter() {
    const v = this.nearestVehicle();
    if (!v) return;
    this.entering = { v, t: 0, phase: 'walk' };
  }
  /** Walk to the driver's door (right-hand drive), open it, climb in. */
  updateEntering(dt) {
    const e = this.entering, v = e.v;
    if (v.wrecked) { this.entering = null; return; }
    const door = v.doorPos(1);
    if (e.phase === 'walk') {
      const dx = door.x - this.x, dz = door.z - this.z, d = Math.hypot(dx, dz);
      e.t += dt;
      if (d < 0.35 || e.t > 2.5) { e.phase = 'open'; e.t = 0; v.doorOpen = 1; sfx('door', { x: v.x, y: 1, z: v.z }); if (v.driver && !v.driver.isPlayer) this.carjack(v); }
      else { const sp = 6; this.x += dx / d * Math.min(d, sp * dt); this.z += dz / d * Math.min(d, sp * dt); this.angle = Math.atan2(dz, dx); this.walk += dt * 9; this.speedNow = sp; }
    } else {
      e.t += dt;
      this.speedNow = 0;
      this.angle += angleDiff(this.angle, v.angle + Math.PI / 2) * Math.min(1, dt * 10);
      if (e.t > 0.45) { this.enterVehicle(v); this.entering = null; }
    }
    this.y = groundHeight(this.x, this.z);
    if (wasPressed('enter') && e.phase === 'walk' && e.t > 0.2) this.entering = null;
  }
  carjack(v) {
    const d = v.driver, door = v.doorPos(1);
    d.vehicle = null; d.x = door.x + Math.cos(v.angle + Math.PI / 2) * 1.2; d.z = door.z + Math.sin(v.angle + Math.PI / 2) * 1.2;
    v.driver = null;
    if (d.kind === 'civ') { d.knockDown(Math.cos(v.angle + Math.PI / 2) * 3, Math.sin(v.angle + Math.PI / 2) * 3, 2, this); d.flee(this.x, this.z, 8); }
    else if (d.onJacked) d.onJacked(this);
    if (!G.peds.includes(d)) G.peds.push(d);
    reportCrime(v.role === 'police' ? 'stealCop' : 'carjack', v.x, v.z);
    G.stats.carsStolen++; v.everDriven = true;
  }
  enterVehicle(v) {
    if (v.wrecked) return;
    if (v.driver && !v.driver.isPlayer) this.carjack(v);
    if (v.role === 'police' && !v.everDriven) { reportCrime('stealCop', v.x, v.z); G.stats.carsStolen++; }
    else if (!v.everDriven && v.role !== 'mission') G.stats.carsStolen++;
    for (const p of v.passengers) if (p.kind === 'civ') { p.vehicle = null; const dd = v.doorPos(-1); p.x = dd.x; p.z = dd.z; p.flee(this.x, this.z, 6); if (!G.peds.includes(p)) G.peds.push(p); }
    v.passengers = v.passengers.filter((p) => p.kind !== 'civ');
    v.everDriven = true; v.driver = this; this.vehicle = v;
    if (v.role !== 'mission') v.role = v.model === 'patrol' ? 'police-stolen' : 'player';
    v.ai = null; v.doorOpen = 1;
    rig.yaw = v.angle; rig.lastLook = -10;
    G.ui.vehicleName = { text: v.m.name, t: 3 };
    if (G.onEnterVehicle) G.onEnterVehicle(v);
  }
  exitVehicle(force = false) {
    const v = this.vehicle;
    if (!v) return;
    let door = v.doorPos(1), r = resolveCircle(door.x, door.z, this.r);
    if (Math.hypot(r.x - door.x, r.z - door.z) > 0.5) { door = v.doorPos(-1); r = resolveCircle(door.x, door.z, this.r); }
    this.x = r.x; this.z = r.z; this.y = groundHeight(this.x, this.z);
    this.angle = v.angle - Math.PI / 2;
    if (v.speed > 12 && !force) this.damage(10);
    v.driver = null; v.ctl = { throttle: 0, brake: 0, steer: 0, handbrake: true };
    if (v.role === 'player') v.role = 'parked';
    v.siren = false; v.doorOpen = 1;
    this.vehicle = null;
    rig.yaw = v.angle; 
    if (G.onExitVehicle) G.onExitVehicle(v);
    sfx('door', { x: v.x, y: 1, z: v.z });
  }

  updateDriving(dt) {
    const v = this.vehicle;
    this.x = v.x; this.z = v.z; this.y = v.y; this.angle = v.angle;
    this.aiming = false;
    if (v.wrecked) { this.exitVehicle(true); return; }
    if (this.controlsLocked) { v.ctl = { throttle: 0, brake: 0.5, steer: 0, handbrake: false }; return; }
    if (G.autopilot) { G.autopilot(v, dt); return; }
    v.ctl.throttle = isDown('up') ? 1 : 0;
    v.ctl.brake = isDown('down') ? 1 : 0;
    v.ctl.steer = (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0);
    v.ctl.handbrake = isDown('handbrake');
    if (isDown('horn')) { if (v.horn <= 0) sfx('horn', { x: v.x, y: 1, z: v.z }); v.horn = 0.25; }
    if (wasPressed('radio')) G.ui.radioName = { text: cycleRadio(), t: 3 };
    if (wasPressed('enter')) { this.exitVehicle(); return; }
    // drive-by toward the camera direction
    let wid = this.weapon;
    if (wid === 'fists') wid = ['wasp', 'kobra', 'thunder'].find((w) => this.weapons[w] && this.clip[w] > 0) || null;
    if (wid && this.clip[wid] > 0) {
      const w = WEAPONS[wid];
      const trigger = w.auto ? input.mouse.left : input.mouse.clicked;
      if (trigger && this.cooldown <= 0) {
        this.cooldown = w.rate * 1.15;
        const a = rig.yaw, ca = Math.cos(a), sa = Math.sin(a);
        fireWeapon(this, wid, v.x + ca * (v.wid / 2 + 0.6), v.y + 1.2, v.z + sa * (v.wid / 2 + 0.6), a, 0.05, rig.pitch);
        this.clip[wid]--;
        if (this.clip[wid] <= 0) this.reload(wid, true);
      }
    }
  }

  draw() {
    if (this.vehicle) return;
    drawCharacter({
      x: this.x, y: this.y, z: this.z, yaw: -this.angle, look: this.look,
      walk: this.walk, speed: this.speedNow > 6 ? 2 : this.speedNow > 0.1 ? 1 : 0,
      aim: this.aiming || (input.mouse.left && this.weapon !== 'fists' && this.alive) ? 1 : 0,
      punch: this.punch, hit: this.hit, dead: this.alive ? 0 : this.deadT, jump: this.jumpY,
      weapon: this.weapon, breath: G.time * 2.2,
    });
  }
}
