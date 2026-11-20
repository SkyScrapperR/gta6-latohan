// Kai Santoso — the player: on-foot movement (screen-relative WASD, mouse aim, stamina sprint),
// weapons, entering/exiting/carjacking vehicles, driving controls and drive-by shooting.
import { G } from '../state.js';
import { input, isDown, wasPressed } from '../input.js';
import { TAU, clamp, angleDiff } from '../util.js';
import { resolveCircle } from '../world/collision.js';
import { drawHuman, OUTFITS } from './pedestrian.js';
import { WEAPONS, WEAPON_ORDER, fireWeapon } from '../combat/weapons.js';
import { reportCrime } from '../ai/police.js';
import { sfx, cycleRadio } from '../audio/audio.js';

export class Player {
  constructor(x, y) {
    this.isPlayer = true;
    this.kind = 'player';
    this.x = x; this.y = y; this.angle = 0; this.r = 7;
    this.hp = 100; this.maxHp = 100; this.armor = 0;
    this.stamina = 1;
    this.alive = true;
    this.vehicle = null;
    this.weapons = { fists: true, kobra: false, wasp: false, thunder: false };
    this.ammo = { kobra: 0, wasp: 0, thunder: 0 };
    this.weapon = 'fists';
    this.cooldown = 0;
    this.phase = 0; this.moving = false; this.speedNow = 0;
    this.look = { ...OUTFITS.player, long: false };
    this.entering = null;   // { v, t }
    this.punchT = 0;
    this.hurtFlash = 0;
    this.controlsLocked = false;
  }

  giveWeapon(id, ammo) {
    this.weapons[id] = true;
    if (id !== 'fists') this.ammo[id] = (this.ammo[id] || 0) + ammo;
    if (this.weapon === 'fists') this.weapon = id;
  }
  cycleWeapon(dir) {
    let i = WEAPON_ORDER.indexOf(this.weapon);
    for (let k = 0; k < WEAPON_ORDER.length; k++) {
      i = (i + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length;
      const id = WEAPON_ORDER[i];
      if (this.weapons[id] && (id === 'fists' || this.ammo[id] > 0)) { this.weapon = id; sfx('click'); return; }
    }
  }

  damage(amount, source = null) {
    if (!this.alive || G.godMode) return;
    if (this.armor > 0) { const a = Math.min(this.armor, amount * 0.75); this.armor -= a; amount -= a; }
    this.hp -= amount;
    this.hurtFlash = 0.3;
    if (this.hp <= 0) this.kill('damage');
  }
  kill(cause) {
    if (!this.alive) return;
    this.alive = false; this.hp = 0;
    if (this.vehicle) { const v = this.vehicle; v.driver = null; this.vehicle = null; this.x = v.x; this.y = v.y; }
    if (G.onPlayerDeath) G.onPlayerDeath(cause);
  }

  get speed() { return this.vehicle ? this.vehicle.speed : this.speedNow; }

  update(dt) {
    if (!this.alive) return;
    this.cooldown -= dt; this.punchT -= dt; this.hurtFlash -= dt;
    if (input.mouse.wheel) this.cycleWeapon(input.mouse.wheel > 0 ? 1 : -1);
    if (wasPressed('nextWeapon')) this.cycleWeapon(1);
    if (wasPressed('prevWeapon')) this.cycleWeapon(-1);
    if (this.weapon !== 'fists' && this.ammo[this.weapon] <= 0) this.cycleWeapon(1);
    if (this.vehicle) this.updateDriving(dt);
    else this.updateOnFoot(dt);
  }

  updateOnFoot(dt) {
    const locked = this.controlsLocked;
    if (this.entering) {
      const e = this.entering;
      e.t += dt;
      const door = e.v.doorPos(1);
      const dx = door.x - this.x, dy = door.y - this.y;
      this.x += dx * Math.min(1, dt * 12); this.y += dy * Math.min(1, dt * 12);
      if (e.t > 0.3) { this.enterVehicle(e.v); this.entering = null; }
      return;
    }
    let mx = 0, my = 0;
    if (!locked) {
      if (isDown('left')) mx -= 1; if (isDown('right')) mx += 1;
      if (isDown('up')) my -= 1; if (isDown('down')) my += 1;
    }
    const len = Math.hypot(mx, my);
    const sprint = isDown('sprint') && len > 0 && this.stamina > 0.02 && !locked;
    if (sprint) this.stamina = Math.max(0, this.stamina - dt * 0.22);
    else this.stamina = Math.min(1, this.stamina + dt * 0.14);
    const sp = sprint ? 168 : 98;
    if (len > 0) { mx /= len; my /= len; }
    this.x += mx * sp * dt; this.y += my * sp * dt;
    this.moving = len > 0; this.speedNow = len > 0 ? sp : 0;
    if (this.moving) this.phase += dt * (sprint ? 15 : 10);
    // aim with the mouse
    if (!locked) this.angle = Math.atan2(input.mouse.wy - this.y, input.mouse.wx - this.x);
    // push out of buildings and vehicles
    const r = resolveCircle(this.x, this.y, this.r, false);
    this.x = r.x; this.y = r.y;
    for (const v of G.vehicles) {
      if (Math.abs(v.x - this.x) > 60 || Math.abs(v.y - this.y) > 60) continue;
      for (const [cx, cy] of v.circles()) {
        const dx = this.x - cx, dy = this.y - cy, d = Math.hypot(dx, dy), rr = v.wid / 2 + this.r;
        if (d < rr && d > 0.01) {
          this.x = cx + dx / d * rr; this.y = cy + dy / d * rr;
          if (v.speed > 120 && !v.wrecked) { this.damage(v.speed * 0.08); }
        }
      }
    }
    if (locked) return;
    // attack
    const w = WEAPONS[this.weapon];
    const trigger = w.auto ? input.mouse.down : input.mouse.clicked || (input.mouse.down && this.weapon === 'fists');
    if (trigger && this.cooldown <= 0 && !G.ui.mouseOverUI) {
      this.cooldown = w.rate;
      const ox = this.x + Math.cos(this.angle) * 10, oy = this.y + Math.sin(this.angle) * 10;
      fireWeapon(this, this.weapon, ox, oy, this.angle, sprint ? 0.08 : 0);
      if (this.weapon !== 'fists') this.ammo[this.weapon]--;
    }
    if (wasPressed('enter')) this.tryEnter();
  }

  nearestVehicle(maxD = 48) {
    let best = null, bd = maxD;
    for (const v of G.vehicles) {
      if (v.wrecked || v.locked) continue;
      const d = Math.hypot(v.x - this.x, v.y - this.y) - v.len * 0.3;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  tryEnter() {
    const v = this.nearestVehicle();
    if (!v) return;
    this.entering = { v, t: 0 };
    sfx('door');
  }

  enterVehicle(v) {
    if (v.wrecked) return;
    if (v.driver && !v.driver.isPlayer) {
      // carjack: pull the driver out of the right-hand door
      const d = v.driver;
      const door = v.doorPos(1);
      d.vehicle = null; d.x = door.x; d.y = door.y;
      v.driver = null;
      if (d.kind === 'civ') { d.state = 'flee'; d.stateTime = 6; d.fearX = this.x; d.fearY = this.y; d.knockDown(-Math.sin(v.angle) * 120, Math.cos(v.angle) * 120, 4, this); }
      else if (d.onJacked) d.onJacked(this);
      if (!G.peds.includes(d)) G.peds.push(d);
      reportCrime(v.role === 'police' ? 'stealCop' : 'carjack', v.x, v.y, v);
      G.stats.carsStolen++;
    } else if (v.role === 'police') {
      reportCrime('stealCop', v.x, v.y, v);
      G.stats.carsStolen++;
    } else if (v.role === 'parked' || v.role === 'traffic') {
      if (!v.everDriven) G.stats.carsStolen++;
    }
    for (const p of v.passengers) { if (p.kind === 'civ') { p.vehicle = null; const door = v.doorPos(-1); p.x = door.x; p.y = door.y; p.scare(this.x, this.y, 6); if (!G.peds.includes(p)) G.peds.push(p); } }
    v.passengers = v.passengers.filter((p) => p.kind !== 'civ');
    v.everDriven = true;
    v.driver = this; this.vehicle = v;
    if (v.role !== 'mission') v.role = v.model === 'patrol' ? 'police-stolen' : 'player';
    v.ai = null;
    G.ui.vehicleName = { text: v.m.name, t: 3 };
    if (G.onEnterVehicle) G.onEnterVehicle(v);
    sfx('door');
  }

  exitVehicle(force = false) {
    const v = this.vehicle;
    if (!v) return;
    let door = v.doorPos(1);
    let r = resolveCircle(door.x, door.y, this.r, false);
    if (Math.hypot(r.x - door.x, r.y - door.y) > 4) { door = v.doorPos(-1); r = resolveCircle(door.x, door.y, this.r, false); }
    this.x = r.x; this.y = r.y;
    if (v.speed > 140 && !force) this.damage(10);
    v.driver = null; v.ctl = { throttle: 0, brake: 0, steer: 0, handbrake: true };
    if (v.role === 'player') v.role = 'parked';
    v.siren = false;
    this.vehicle = null;
    if (G.onExitVehicle) G.onExitVehicle(v);
    sfx('door');
  }

  updateDriving(dt) {
    const v = this.vehicle;
    this.x = v.x; this.y = v.y;
    this.angle = Math.atan2(input.mouse.wy - v.y, input.mouse.wx - v.x);
    if (v.wrecked) { this.exitVehicle(true); return; }
    if (this.controlsLocked) { v.ctl = { throttle: 0, brake: 0.5, steer: 0, handbrake: false }; return; }
    if (G.autopilot) { G.autopilot(v, dt); return; }
    v.ctl.throttle = isDown('up') ? 1 : 0;
    v.ctl.brake = isDown('down') ? 1 : 0;
    v.ctl.steer = (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0);
    v.ctl.handbrake = isDown('handbrake');
    if (isDown('horn')) { if (v.horn <= 0) sfx('horn', { x: v.x, y: v.y }); v.horn = 0.2; this.honking = true; } else this.honking = false;
    if (v.model === 'patrol' && wasPressed('horn') && false) v.siren = !v.siren;
    if (wasPressed('radio')) { const name = cycleRadio(); G.ui.radioName = { text: name, t: 3 }; }
    if (wasPressed('enter')) { this.exitVehicle(); return; }
    // drive-by: shoot toward the cursor
    let wid = this.weapon;
    if (wid === 'fists') wid = ['wasp', 'kobra', 'thunder'].find((w) => this.weapons[w] && this.ammo[w] > 0) || null;
    if (wid) {
      const w = WEAPONS[wid];
      const trigger = w.auto ? input.mouse.down : input.mouse.clicked;
      if (trigger && this.cooldown <= 0) {
        this.cooldown = w.rate * 1.15;
        const a = this.angle;
        const ox = v.x + Math.cos(a) * (v.wid / 2 + 6), oy = v.y + Math.sin(a) * (v.wid / 2 + 6);
        fireWeapon(this, wid, ox, oy, a, 0.04);
        this.ammo[wid]--;
      }
    }
  }

  draw(ctx, t) {
    if (this.vehicle || !this.alive && false) return;
    drawHuman(ctx, { ...this, look: this.look, weapon: this.weapon, dead: !this.alive, state: this.alive ? 'walk' : 'dead' }, t);
  }
}
