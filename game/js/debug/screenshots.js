// Debug hook: ?shot=N stages a scene for the README screenshots (real renders of the game).
//   1 title screen at dusk · 2 downtown night chase · 3 sunset cutscene at Lin's Garage · 4 docks firefight
import { G } from '../state.js';
import { Vehicle } from '../entities/vehicle.js';
import { Ped } from '../entities/pedestrian.js';
import { setWanted, startChase } from '../ai/police.js';
import { steerToward, obstacleAhead } from '../ai/traffic.js';
import { fireWeapon } from '../combat/weapons.js';
import * as Missions from '../story/missions.js';
import { snapCamera } from '../camera.js';
import { warmChunks } from '../world/render-city.js';
import { CELL, ROAD } from '../world/city.js';
import { input } from '../input.js';
import { RNG } from '../util.js';

const ready = () => { window.__shotReady = true; };

export function setupShot(n) {
  window.__shotReady = false;
  G.godMode = true;
  input.mouse.x = G.W * 0.62; input.mouse.y = G.H * 0.42;
  if (n === 1) { setTimeout(ready, 3500); return; }
  G.newGameSilent = true;
  G.newGame();
  Missions.abort();
  G.ui.banner = null; G.ui.toast = [];
  G.progress.safehouse = true;
  G.money = G.moneyShown = 48250;
  const P = G.player;
  if (n === 2) {
    G.clock = 22 * 60 + 40; G.clockFrozen = true;
    G.progress.missionIndex = 4;
    const y = 4 * CELL + ROAD / 2 - 18, x = 4 * CELL + 120;
    const car = new Vehicle('vesper', x, y, 0, [250, 200, 20]);
    car.role = 'player'; G.vehicles.push(car);
    P.enterVehicle(car); G.ui.vehicleName = null;
    car.vx = 260;
    P.giveWeapon('wasp', 214); P.weapon = 'wasp'; P.armor = 64; P.hp = 82;
    for (let i = 0; i < 3; i++) {
      const c = new Vehicle('patrol', x - 120 - i * 75, y + (i % 2 ? 26 : -2), 0);
      const d = new Ped('cop', c.x, c.y, 'cop'); d.weapon = 'kobra'; d.vehicle = c; c.driver = d;
      c.vx = 250; G.vehicles.push(c); startChase(c);
    }
    setWanted(4);
    G.wanted.heat = 330;
    G.autopilot = (v) => { steerToward(v, v.x + 300, y, 250); if (v.x > 6 * CELL + 200) { v.ctl.throttle = 0; v.ctl.brake = 0.4; } };
    snapCamera(x + 120, y);
    warmChunks(x + 600, y, 1600);
    setTimeout(() => { G.heli.x = G.player.x + 120; G.heli.y = G.player.y - 160; G.heli.spotX = G.player.x + 40; G.heli.spotY = G.player.y; }, 200);
    setTimeout(ready, 3800);
  } else if (n === 3) {
    G.clock = 18 * 60 + 2; G.clockFrozen = true;
    G.progress.missionIndex = 1;
    const g = G.city.landmarks.garage;
    P.x = g.x + 10; P.y = g.y + 10;
    const car = new Vehicle('merpati', g.x - 70, g.y + 4, -0.3, [40, 90, 150]); car.role = 'parked'; G.vehicles.push(car);
    snapCamera(g.x, g.y - 40);
    Missions.startMission(1);
    G.ui.banner = null;
    setTimeout(ready, 3300);
  } else if (n === 4) {
    G.clock = 19 * 60 + 25; G.clockFrozen = true;
    G.progress.missionIndex = 4;
    const f = G.city.landmarks.freight;
    P.x = f.x - 40; P.y = f.y + 150;
    P.giveWeapon('wasp', 180); P.weapon = 'wasp'; P.armor = 100;
    const truck = Missions.spawnCar('bison', f.x - 60, f.y + 20, 0.1, [118, 42, 168]); truck.cargoLabel = 'ORCHID';
    const van = Missions.spawnCar('bajak', f.x + 90, f.y + 60, 1.2, [70, 90, 70]);
    const rng = new RNG(5);
    const guards = [];
    for (const [dx, dy] of [[-130, -20], [120, -10], [-90, 50], [60, 90], [20, -50]]) {
      const g = Missions.spawnGang(f.x + dx, f.y + dy, rng.chance(0.5) ? 'wasp' : 'kobra', 9999);
      g.state = 'combat'; guards.push(g);
    }
    const dead = Missions.spawnGang(f.x - 20, f.y + 40, 'kobra', 10); dead.die(P);
    G.ui.objective = 'Guards left: 5  ·  Blow up the Bison weapons truck';
    snapCamera(f.x, f.y + 60);
    let t = 0, shot = 0;
    G.shotUpdate = (dt) => {
      t += dt; shot -= dt;
      const tgt = guards[Math.floor(t / 0.8) % guards.length];
      P.angle = Math.atan2(tgt.y - P.y, tgt.x - P.x);
      input.mouse.x = G.W / 2 + (tgt.x - G.cam.x) * G.cam.zoom; input.mouse.y = G.H / 2 + (tgt.y - G.cam.y) * G.cam.zoom;
      if (shot <= 0) { shot = 0.08; fireWeapon(P, 'wasp', P.x + Math.cos(P.angle) * 10, P.y + Math.sin(P.angle) * 10, P.angle, 0.02); }
      if (t > 2.6 && !van.wrecked) van.explode();
      if (t > 2.85 && !window.__shotReady) ready();
    };
  }
}
