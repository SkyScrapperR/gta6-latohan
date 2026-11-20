// Debug hook: ?shot=N stages a scene for the README screenshots (real renders of the game).
// 1 title at dusk · 2 rainy night chase · 3 golden-hour cutscene at Lin's Garage · 4 docks firefight
import { G } from '../core/state.js';
import { Vehicle } from '../entities/vehicle.js';
import { Ped } from '../entities/pedestrian.js';
import { setWanted, startChase } from '../ai/police.js';
import { steerToward } from '../ai/traffic.js';
import { fireWeapon } from '../combat/weapons.js';
import * as Missions from '../story/missions.js';
import { rig } from '../camera-rig.js';
import { CELL, ROAD } from '../world/city.js';
import { RNG } from '../core/math.js';
import { input } from '../core/input.js';

/** Ready once `sec` seconds of simulation have run (independent of the frame rate). */
const ready = (sec) => { const t0 = G.time; const iv = setInterval(() => { if (G.time - t0 >= sec) { clearInterval(iv); window.__shotReady = true; } }, 100); };

export function setupShot(n) {
  window.__shotReady = false;
  G.godMode = true; G.fixedPerf = true; G.simSpeed = 2;
  input.mouse.x = -100; input.mouse.y = -100; // keep the menu cursor out of frame
  if (n === 1) { G.clock = 18 * 60 + 25; G.clockFrozen = true; ready(3.5); return; }
  G.newGame();
  Missions.abort();
  G.clearNotes();
  G.progress.safehouse = true;
  G.money = G.moneyShown = 48250;
  const P = G.player;
  if (n === 2) {
    G.clock = 22 * 60 + 40; G.clockFrozen = true;
    G.weather.forced = true; G.weather.rain = 1;
    G.progress.missionIndex = 4;
    const z = 3 * CELL + ROAD / 2 - 3.5, x = 3 * CELL + 40;
    const car = new Vehicle('vesper', x, z, 0, [0.98, 0.78, 0.08]);
    car.role = 'player'; G.vehicles.push(car);
    P.enterVehicle(car); G.ui.vehicleName = null;
    car.vx = 22;
    P.giveWeapon('wasp', 214); P.weapon = 'wasp'; P.armor = 64; P.hp = 82;
    const cops = [];
    for (let i = 0; i < 3; i++) {
      const c = new Vehicle('patrol', x - 13 - i * 10, z + (i % 2 ? 3.6 : 0.4), 0);
      const d = new Ped('cop', c.x, c.z, 'cop'); d.weapon = 'kobra'; d.vehicle = c; c.driver = d;
      c.vx = 21; G.vehicles.push(c); startChase(c); cops.push(c); c.keep = true;
    }
    setWanted(4); G.wanted.heat = 330;
    G.autopilot = (v) => { steerToward(v, v.x + 30, z, 21); };
    rig.yaw = -0.35; rig.pitch = 0.16; rig.lastLook = 1e9;
    const slots = [[-11, 0.2], [-18, 3.6], [-26, -0.6]];
    G.shotUpdate = () => {
      rig.lastLook = G.realTime; rig.yaw = car.angle + Math.PI + 0.42; rig.pitch = 0.2; // looking back at the pursuit
      const fx = Math.cos(car.angle), fz = Math.sin(car.angle);
      cops.forEach((c, i) => { const [b, l] = slots[i]; c.x = car.x + fx * b - fz * l; c.z = car.z + fz * b + fx * l; c.angle = car.angle; c.vx = car.vx; c.vz = car.vz; c.siren = true; });
      const h = G.heli;
      if (h) { h.x = car.x - fx * 22 + 6; h.z = car.z - fz * 22 - 10; h.y = 26; h.spotX = car.x; h.spotZ = car.z; h.angle = car.angle; h.spotOn = true; }
    };
    ready(4);
  } else if (n === 3) {
    G.clock = 17 * 60 + 35; G.clockFrozen = true;
    G.progress.missionIndex = 1;
    const g = G.city.landmarks.garage;
    P.x = g.x + 1; P.z = g.z - 2.5; P.angle = Math.PI;
    const car = new Vehicle('merpati', g.x + 10, g.z - 3, -0.2, [0.18, 0.36, 0.6]); car.role = 'parked'; G.vehicles.push(car);
    G.markerArmed = true;
    Missions.startMission(1);
    G.shotUpdate = () => { const lin = G.peds.find((p) => p.speaker === 'lin'); if (lin) { lin.angle = Math.atan2(P.z - lin.z, P.x - lin.x); P.angle = Math.atan2(lin.z - P.z, lin.x - P.x); } };
    ready(3);
  } else if (n === 4) {
    G.clock = 22 * 60 + 15; G.clockFrozen = true;
    G.progress.missionIndex = 4;
    G.noCrime = true;
    // on the quay, looking north: container stacks on the left, gantry cranes ahead
    P.x = 1072; P.z = 968; P.giveWeapon('wasp', 180); P.weapon = 'wasp'; P.armor = 100;
    const truck = Missions.spawnCar('bison', 1082, 942, -1.9, [0.46, 0.16, 0.66]);
    const rng = new RNG(5), guards = [];
    for (const [x, z] of [[1050, 940], [1060, 928], [1074, 930], [1056, 906], [1090, 925]]) { const q = Missions.spawnGang(x, z, rng.chance(0.5) ? 'wasp' : 'kobra', 9999); q.state = 'combat'; guards.push(q); }
    G.ui.objective = 'Guards left: 5  ·  Blow up the Bison weapons truck';
    let t = 0, shot = 0;
    G.shotUpdate = (dt) => {
      t += dt; shot -= dt;
      const tgt = guards[Math.floor(t / 0.9) % guards.length];
      const a = Math.atan2(tgt.z - P.z, tgt.x - P.x);
      rig.yaw = -Math.PI / 2 - 0.12; rig.pitch = 0.02; P.angle = rig.yaw; P.forceAim = true;
      P.x = 1072; P.z = 968;
      if (shot <= 0) { shot = 0.08; fireWeapon(P, 'wasp', P.x + Math.cos(a) * 0.7, 1.6, P.z + Math.sin(a) * 0.7, a, 0.02, 0.05); }
      if (t > 1.6 && !truck.wrecked) truck.explode();
      if (t > 1.85 && !window.__shotReady) window.__shotReady = true;
    };
  }
}
