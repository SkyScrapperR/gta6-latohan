// The six story missions as generator scripts. Scripts yield predicates (wait until true),
// numbers (seconds) or cutscenes; fail conditions are checked every frame. Failure cleans up
// and the start marker (a glowing light cylinder) reappears so the mission can be retried.
import { G } from '../core/state.js';
import { RNG, clamp, formatMoney, hex } from '../core/math.js';
import { Vehicle } from '../entities/vehicle.js';
import { Ped } from '../entities/pedestrian.js';
import { spawnPickup } from '../entities/pickups.js';
import { setWanted, clearWanted } from '../ai/police.js';
import { gangBrain } from '../ai/combat-ai.js';
import { steerToward, obstacleAhead } from '../ai/traffic.js';
import { nearestNode, bfsPath, nodeXZ, laneOffset } from '../world/roads.js';
import { CELL, ROAD, PIERS, CITY, districtAt, CURB } from '../world/city.js';
import { playCutscene, say, cancelCutscene } from './dialogue.js';
import { UI } from '../ui/theme.js';
import { rig } from '../camera-rig.js';
import * as Save from '../save.js';
import { sfx, setMusicMood } from '../audio/audio.js';
import { startCredits } from '../ui/menus.js';

const rng = new RNG(77);
let M = null;

function ctx() {
  return {
    entities: [], fails: [], target: null, blips: null,
    objective(t) { G.ui.objective = t; },
    setTarget(t, color = UI.gold, icon = 'mission') { this.target = t; this.targetColor = color; this.targetIcon = icon; },
    cutscene(lines, opts = {}) { return { cutscene: lines, opts }; },
    failIf(fn, reason) { const f = { fn, reason }; this.fails.push(f); return f; },
    track(e) { this.entities.push(e); e.mission = true; return e; },
  };
}
const near = (a, b, r) => a && b && (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < r * r;
const lm = (id) => G.city.landmarks[id];
const pl = () => G.player;
const inCar = () => !!(G.player && G.player.vehicle);

export function spawnGang(x, z, weapon = 'kobra', hp = 60, outfit = 'gang') {
  const p = new Ped('gang', x, z, outfit);
  p.weapon = weapon; p.hp = p.maxHp = hp; p.brain = gangBrain; p.state = 'guard';
  p.cooldown = rng.range(0.4, 1.4); p.aggroRange = 45; p.mission = true;
  G.peds.push(p);
  return p;
}
export function spawnCar(model, x, z, angle, color) {
  const v = new Vehicle(model, x, z, angle, color);
  v.role = 'mission'; v.mission = true; G.vehicles.push(v);
  return v;
}
function spawnStory(outfit, x, z, speaker) {
  const p = new Ped('story', x, z, outfit);
  p.brain = (q) => { q.speedNow = 0; }; p.speaker = speaker; p.hp = p.maxHp = 150; p.mission = true;
  G.peds.push(p);
  return p;
}
/** Shots used by cutscenes: orbit around a point, or dolly between two points. */
const orbit = (x, z, r, y, a0, a1, dur, ty = 1.6, fov = 42) => ({ orbit: { cx: x, cz: z, r, y, ty, a0, a1 }, dur, fov });
const dolly = (from, to, lookFrom, lookTo, dur, fov = 45) => ({ from, to, lookFrom, lookTo, dur, fov });

/** NPC that rides along with the player: follows on foot, climbs in when the player stops nearby. */
function companionTick(p, dt) {
  const P = G.player;
  if (p.dead) return;
  if (p.vehicle) {
    if (!P.vehicle || P.vehicle !== p.vehicle) { const v = p.vehicle; v.passengers = v.passengers.filter((q) => q !== p); p.vehicle = null; const d = v.doorPos(-1); p.x = d.x; p.z = d.z; }
    return;
  }
  if (P.vehicle && near(p, P.vehicle, 14) && P.vehicle.speed < 3) {
    const d = P.vehicle.doorPos(-1);
    if (p.moveTo(d.x, d.z, 4.5, dt) < 0.8) { p.vehicle = P.vehicle; P.vehicle.passengers.push(p); sfx('door', { x: p.x, y: 1, z: p.z }); }
  } else if (!near(p, P, 4)) p.moveTo(P.x, P.z, 5.5, dt);
}

// ---------------------------------------------------------------------------
export const MISSIONS = [
  {
    id: 'homecoming', name: 'Homecoming', giver: null, reward: 500,
    *script(m) {
      const pier = PIERS[0], P = pl();
      G.clock = 17 * 60 + 45;
      P.x = pier.x + pier.w / 2; P.z = pier.z + pier.d - 6; P.angle = -Math.PI / 2; rig.yaw = -Math.PI / 2;
      const car = m.track(spawnCar('merpati', pier.x + 18, CITY + 9, Math.PI, [0.18, 0.36, 0.6]));
      // ferry arrival: sweeping shot over the bay to the pier
      yield m.cutscene([
        { who: 'kai', text: 'Five years. The bay still smells like diesel and frangipani.' },
        { who: 'kai', text: 'Same pier. Same gulls. Different me.' },
        { who: 'lin', text: "Kai? You're really back? Good. Don't stand there looking poetic." },
        { who: 'lin', text: "There's a blue Merpati by the boardwalk. Keys are in it. Get to the garage." },
        { who: 'kai', text: 'Still bossing me around, Mama Lin.' },
        { who: 'lin', text: 'Somebody has to. Drive careful — the Orchids own half the coast now.' },
      ], { shots: [
        dolly([pier.x + 140, 70, pier.z + 260], [pier.x + 40, 26, pier.z + 150], [pier.x, 40, CITY - 300], [pier.x, 30, CITY - 200], 9, 55),
        dolly([pier.x + 40, 26, pier.z + 150], [pier.x + 12, 6, P.z + 14], [pier.x, 30, CITY - 200], [P.x, 2, P.z], 7, 50),
        orbit(P.x, P.z, 6, 2.4, 0.9, 1.8, 9, 1.6, 42),
      ] });
      m.objective('Get in the Merpati parked by the boardwalk.');
      m.setTarget(car);
      m.failIf(() => car.wrecked, 'The Merpati was wrecked.');
      yield () => P.vehicle === car;
      m.objective("Drive to Lin's Garage.");
      m.setTarget(lm('garage'));
      yield () => inCar() && near(P.vehicle, lm('garage'), 9) && P.vehicle.speed < 6;
      G.clock = 18 * 60 + 5;
      P.exitVehicle(true);
      const g = lm('garage');
      const lin = m.track(spawnStory('lin', g.x - 3, g.z - 4, 'lin'));
      lin.angle = Math.PI / 2;
      yield m.cutscene([
        { who: 'lin', text: "Look at you. Taller. Thinner. Still can't park." },
        { who: 'kai', text: 'Missed you too. The shop looks… quiet.' },
        { who: 'lin', text: "Viktor Raza's Black Orchid takes a cut of everything on this coast. Mine included." },
        { who: 'lin', text: 'Your old room at the Bukit Asri house is yours. Rest. Tomorrow we talk business.' },
      ], { actors: [lin], shots: [orbit(g.x - 1.5, g.z - 2, 7, 2.2, 0.3, 1.1, 14)] });
      G.progress.safehouse = true;
      G.toast('Safehouse unlocked in Bukit Asri', UI.teal);
    },
  },
  {
    id: 'yellow', name: 'Yellow Fever', giver: 'garage', reward: 1500,
    *script(m) {
      const g = lm('garage');
      const lin = m.track(spawnStory('lin', g.x - 3, g.z - 4, 'lin'));
      yield m.cutscene([
        { who: 'lin', text: "Viktor's nephew Rendy parks a yellow Vesper GT downtown like he owns the street." },
        { who: 'lin', text: 'I want it. In my shop. Mostly in one piece.' },
        { who: 'kai', text: 'Stealing from the Orchids on day two. Great plan.' },
        { who: 'lin', text: "It's a message, not a plan. Under 25% damage and I'll make it worth your while." },
      ], { actors: [lin], shots: [orbit(g.x - 1.5, g.z - 2, 6.5, 2.0, 2.4, 3.3, 16, 1.6, 40)] });
      const blk = G.city.blockAt(5, 2);
      const spot = { x: blk.x + 45, z: blk.z + 1.8 };
      const car = m.track(spawnCar('vesper', spot.x, spot.z, 0, [0.98, 0.78, 0.08]));
      car.noRespray = true;
      const rendy = m.track(new Ped('civ', spot.x + 5, spot.z + 3, 'rendy'));
      rendy.state = 'phone'; rendy.phone = true; rendy.stateTime = 1e9;
      G.peds.push(rendy);
      m.objective("Steal Rendy's yellow Vesper GT in Kota Lama.");
      m.setTarget(car);
      m.failIf(() => car.wrecked, 'The Vesper GT was destroyed.');
      yield () => pl().vehicle === car;
      setWanted(1);
      say([{ who: 'rendy', text: "HEY! That's my car! Uncle Viktor is gonna hear about this!" }]);
      m.objective('Deliver the Vesper to the garage. Keep it above 25% health.');
      m.setTarget(lm('garage'));
      m.failIf(() => car.hp < car.maxHp * 0.25, "The Vesper is too damaged. Lin won't take it.");
      yield () => {
        if (pl().vehicle !== car || !near(car, lm('garage'), 9)) return false;
        if (G.wanted.stars > 0) { G.help('Lose the heat before delivering the car.', 0.2); return false; }
        return car.speed < 6;
      };
      pl().exitVehicle(true); car.locked = true;
      yield m.cutscene([
        { who: 'lin', text: "Now that's a pretty message. I'll strip it by morning." },
        { who: 'lin', text: 'There is a Kobra 9 waiting for you at the safehouse. Please only point it at bad people.' },
      ], { actors: [lin], shots: [orbit(car.x, car.z, 8, 2.4, 0.5, 1.4, 8)] });
      const s = lm('safehouse');
      spawnPickup('weapon', s.x + 3, s.z - 1, { weapon: 'kobra', amount: 60 });
      G.toast('Kobra 9 waiting at the safehouse', UI.gold);
    },
  },
  {
    id: 'collections', name: 'Collections', giver: 'garage', reward: 2000,
    *script(m) {
      const g = lm('garage');
      const lin = m.track(spawnStory('lin', g.x - 3, g.z - 4, 'lin'));
      yield m.cutscene([
        { who: 'lin', text: 'Every Friday Orchid enforcers collect "insurance" at Kedai Orchid by the beach.' },
        { who: 'lin', text: "Today they're the ones getting collected. Bring me their bag." },
        { who: 'kai', text: 'How many?' },
        { who: 'lin', text: 'Four. Maybe five if one of them brought his mother.' },
      ], { actors: [lin] });
      const k = lm('kedai');
      m.objective('Go to Kedai Orchid.');
      m.setTarget(k);
      yield () => near(pl(), k, 40);
      const goons = [];
      for (const [dx, dz] of [[-10, -2], [10, -2], [-5, 6], [6, 7]]) { const q = m.track(spawnGang(k.x + dx, k.z + dz, 'kobra', 55)); q.blip = UI.red; goons.push(q); }
      say([{ who: 'goon', text: "Who's this? Somebody teach him the rules." }]);
      m.objective('Defeat the 4 Orchid enforcers.');
      m.setTarget(null);
      m.blips = () => goons.filter((q) => !q.dead).map((q) => ({ x: q.x, z: q.z, icon: 'target', color: UI.red }));
      yield () => goons.every((q) => q.dead);
      m.blips = null;
      const last = goons[goons.length - 1];
      let got = false;
      const bag = spawnPickup('bag', last.x, last.z, { mission: true, onCollect: () => { got = true; } });
      m.objective('Pick up the cash bag.');
      m.setTarget(bag);
      yield () => got;
      m.objective('Bring the bag back to the garage.');
      m.setTarget(lm('garage'));
      yield () => near(pl(), lm('garage'), 9) && (G.wanted.stars === 0 || (G.help('Lose the heat first.', 0.2), false));
      if (pl().vehicle) pl().exitVehicle(true);
      yield m.cutscene([
        { who: 'lin', text: 'Eight thousand in small bills and a phone that keeps ringing. Viktor knows your face now.' },
        { who: 'kai', text: 'Good. Let him lose sleep for once.' },
      ], { actors: [lin] });
    },
  },
  {
    id: 'wheelman', name: 'Wheelman', giver: 'garage', reward: 5000,
    *script(m) {
      const g = lm('garage');
      const lin = m.track(spawnStory('lin', g.x - 3, g.z - 4, 'lin'));
      yield m.cutscene([
        { who: 'lin', text: 'Your friend Dex called. The hacker with the haircut.' },
        { who: 'dex', text: "Kai! Bank Samudra holds Viktor's laundering ledgers. I can crack the vault network from the curb." },
        { who: 'dex', text: "I need fifteen seconds and a driver who doesn't panic. You still don't panic, right?" },
        { who: 'kai', text: 'Only on the inside.' },
      ], { actors: [lin] });
      const d = lm('dex');
      const dex = m.track(spawnStory('dex', d.x, d.z - 1, 'dex'));
      dex.blip = '#9dff4d';
      m.failIf(() => dex.dead, 'Dex is dead.');
      m.failIf(() => dex.vehicle && dex.vehicle.wrecked, 'The car exploded with Dex inside.');
      m.objective(inCar() ? "Pick up Dex at his apartment." : "Get a car and pick up Dex at his apartment.");
      m.setTarget(d);
      yield () => inCar() && near(pl().vehicle, d, 12) && pl().vehicle.speed < 4;
      dex.brain = companionTick; dex.companion = true;
      m.objective('Wait for Dex to get in.');
      yield () => dex.vehicle === pl().vehicle;
      say([{ who: 'dex', text: 'Nice ride. Smells like regret. Bank Samudra, downtown.' }]);
      const needDex = () => { if (dex.vehicle && dex.vehicle === pl().vehicle) return true; m.objective('Get back in a car with Dex.'); m.setTarget(dex); return false; };
      const b = lm('bank');
      m.objective('Drive Dex to Bank Samudra.'); m.setTarget(b);
      yield () => needDex() && (m.objective('Drive Dex to Bank Samudra.'), m.setTarget(b), near(pl().vehicle, b, 10)) && pl().vehicle.speed < 5;
      let left = 15;
      G.ui.timer = { label: 'VAULT CRACK', value: left };
      say([{ who: 'dex', text: 'Fifteen seconds. Keep the engine warm and your face boring.' }]);
      yield () => {
        if (needDex() && near(pl().vehicle, b, 16)) { left -= G.dt; m.objective('Hold position while Dex cracks the vault.'); m.setTarget(b); }
        else if (dex.vehicle) { m.objective('Get back to the bank!'); m.setTarget(b); }
        G.ui.timer.value = Math.max(0, left);
        return left <= 0;
      };
      G.ui.timer = null;
      setWanted(3);
      sfx('alarm', { x: b.x, y: 4, z: b.z });
      say([{ who: 'dex', text: 'Got it! Ledgers are ours — and so is the alarm. GO!' }, { who: 'radio', text: 'All units, robbery in progress at Bank Samudra. Suspects in a vehicle.' }]);
      m.objective('Lose the cops.'); m.setTarget(null);
      yield () => G.wanted.stars === 0 && (dex.vehicle || needDex());
      m.objective('Drop Dex at his apartment.'); m.setTarget(d);
      yield () => needDex() && (m.objective('Drop Dex at his apartment.'), m.setTarget(d), near(pl().vehicle, d, 12) && pl().vehicle.speed < 4);
      const v = dex.vehicle; v.passengers = v.passengers.filter((q) => q !== dex); dex.vehicle = null; dex.companion = false;
      const door = v.doorPos(-1); dex.x = door.x; dex.z = door.z; dex.brain = (q) => { q.speedNow = 0; };
      yield m.cutscene([
        { who: 'dex', text: 'Shell companies, offshore pings… and a boat. Viktor keeps an escape boat at the east pier.' },
        { who: 'dex', text: "Give me a few days. I'll find out when he plans to use it." },
      ], { actors: [dex], x: dex.x, z: dex.z });
    },
  },
  {
    id: 'lowtide', name: 'Low Tide', giver: 'garage', reward: 8000,
    *script(m) {
      const g = lm('garage');
      if (G.clock > 6 * 60 && G.clock < 20 * 60 + 30) G.clock = 21 * 60 + 10; // a night job
      const lin = m.track(spawnStory('lin', g.x - 3, g.z - 4, 'lin'));
      yield m.cutscene([
        { who: 'lin', text: "Orchid Freight at Pier 9 moves guns in a Bison truck. Tonight it's loaded." },
        { who: 'lin', text: "There's a Wasp on the bench. Take it. Burn that truck." },
        { who: 'kai', text: 'You keep an SMG on your workbench?' },
        { who: 'lin', text: 'Next to the spanners. Go.' },
      ], { actors: [lin] });
      let gotGun = false;
      const gp = { x: g.x + 4, z: g.z + 1 };
      spawnPickup('weapon', gp.x, gp.z, { weapon: 'wasp', amount: 180, mission: true, onCollect: () => { gotGun = true; } });
      m.objective('Grab the Wasp SMG.'); m.setTarget(gp);
      yield () => gotGun;
      const f = lm('freight');
      m.objective('Go to Orchid Freight at Pier 9 Docks.'); m.setTarget(f);
      const truck = m.track(spawnCar('bison', f.x - 8, f.z + 2, 0, [0.46, 0.16, 0.66]));
      truck.maxHp = truck.hp = 1400;
      const guards = [];
      for (const [dx, dz] of [[-16, -4], [16, -4], [-12, 7], [12, 8], [0, -7], [5, 13]]) { const q = m.track(spawnGang(f.x + dx, f.z + dz, rng.chance(0.4) ? 'wasp' : 'kobra', 60)); q.aggroRange = 50; guards.push(q); }
      yield () => near(pl(), f, 55);
      m.setTarget(truck, UI.red, 'target');
      m.blips = () => guards.filter((q) => !q.dead).map((q) => ({ x: q.x, z: q.z, icon: 'target', color: UI.red }));
      let alarm = false;
      yield () => {
        const alive = guards.filter((q) => !q.dead).length;
        if (!alarm && (alive < 6 || truck.hp < truck.maxHp)) { alarm = true; say([{ who: 'goon', text: 'Protect the truck! Nobody leaves the yard!' }]); }
        m.objective(`Guards left: ${alive}  ·  ${truck.wrecked ? 'Truck destroyed ✓' : 'Blow up the Bison weapons truck'}`);
        if (truck.wrecked) m.setTarget(null);
        return alive === 0 && truck.wrecked;
      };
      m.blips = null;
      setWanted(2);
      m.objective('Escape the docks!'); m.setTarget(null);
      say([{ who: 'lin', text: 'I can see the smoke from here. Get out of the docks, now!' }]);
      yield () => districtAt(pl().x, pl().z) !== 'docks';
      yield m.cutscene([
        { who: 'lin', text: 'That was a year of Orchid profit going up in smoke.' },
        { who: 'kai', text: "Then Viktor's going to run. Men like him always do." },
      ]);
    },
  },
  {
    id: 'orchidfalls', name: 'Orchid Falls', giver: 'dex', reward: 25000,
    *script(m) {
      const t = lm('tower'), d = lm('dex');
      const dex = m.track(spawnStory('dex', d.x - 2, d.z - 2, 'dex'));
      yield m.cutscene([
        { who: 'dex', text: "It's happening. Viktor just left Orchid Tower in a black Vesper. He's heading for the boat at the east pier." },
        { who: 'viktor', text: 'Selara Bay was mine before you learned to walk, boy. Enjoy the ashes.' },
        { who: 'kai', text: "You're not getting on that boat, Viktor." },
      ], { actors: [dex], shots: [orbit(d.x - 1, d.z - 1, 6, 2, 1, 1.8, 7), dolly([t.x + 60, 30, t.z + 80], [t.x + 30, 12, t.z + 40], [t.x, 150, t.z - 30], [t.x, 40, t.z], 7, 50), orbit(d.x - 1, d.z - 1, 5, 1.8, 2, 2.6, 5)] });
      const start = { x: t.x, z: t.z + 6 };
      const car = m.track(spawnCar('vesper', start.x, start.z, Math.PI / 2, [0.08, 0.07, 0.09]));
      car.maxHp = car.hp = 1600; car.minHp = 1600 * 0.17;
      const viktor = m.track(new Ped('boss', start.x, start.z, 'boss'));
      viktor.hp = viktor.maxHp = 200; viktor.weapon = 'wasp'; viktor.vehicle = car; car.driver = viktor;
      G.peds.push(viktor);
      const pier = PIERS[1];
      const boat = { x: pier.x + pier.w - 10, z: pier.z + pier.d / 2 };
      const route = bfsPath(nearestNode(start.x, start.z), nearestNode(pier.x - 12, boat.z)).map(nodeXZ);
      route.push({ x: pier.x - 4, z: boat.z }, { x: pier.x + 20, z: boat.z }, boat);
      let wi = 0;
      car.ai = {
        mode: 'script', update(v, dt) {
          if (wi >= route.length) { v.ctl = { throttle: 0, brake: 1, steer: 0, handbrake: false }; return; }
          const w = route[wi], prev = route[Math.max(0, wi - 1)];
          const o = laneOffset(Math.sign(w.x - prev.x), Math.sign(w.z - prev.z));
          const tx = wi < route.length - 3 ? w.x + o.x : w.x, tz = wi < route.length - 3 ? w.z + o.z : w.z;
          if (Math.hypot(tx - v.x, tz - v.z) < 7) wi++;
          steerToward(v, tx, tz, Math.hypot(tx - v.x, tz - v.z) < 22 ? 16 : 30);
          if (obstacleAhead(v, 8) < 3 && v.speed < 3) v.ctl.throttle = 1;
        },
      };
      const startD = route.reduce((s, p, i) => (i ? s + Math.hypot(p.x - route[i - 1].x, p.z - route[i - 1].z) : 0), 0);
      m.objective("Wreck Viktor's car before he reaches the boat!");
      m.setTarget(car, UI.red, 'boss');
      const boatFail = m.failIf(() => !car.wrecked && near(car, boat, 9), 'Viktor reached his boat.');
      G.ui.meter = { label: 'VIKTOR → BOAT', value: 0, color: UI.purple };
      const disabled = () => car.wrecked || car.hp <= car.minHp + 1;
      yield () => {
        let rem = 0;
        for (let i = wi; i < route.length; i++) { const a = i === wi ? car : route[i - 1]; rem += Math.hypot(route[i].x - a.x, route[i].z - a.z); }
        G.ui.meter.value = clamp(1 - rem / startD, 0, 1); G.ui.meter.text = Math.round(rem) + ' m';
        return disabled();
      };
      G.ui.meter = null;
      car.ai = null; car.ctl = { throttle: 0, brake: 1, steer: 0, handbrake: true };
      viktor.vehicle = null; car.driver = null;
      const door = car.doorPos(1); viktor.x = door.x; viktor.z = door.z;
      viktor.brain = gangBrain; viktor.state = 'combat'; viktor.aggroRange = 120; viktor.cooldown = 1; viktor.blip = UI.purple;
      m.fails = m.fails.filter((f) => f !== boatFail);
      say([{ who: 'viktor', text: 'You want me? Come and take it!' }]);
      for (let i = 0; i < 2; i++) { const q = m.track(spawnGang(viktor.x + (i ? 4 : -4), viktor.z + 3, 'kobra', 60)); q.state = 'combat'; }
      m.objective('Take down Viktor Raza.'); m.setTarget(viktor, UI.purple, 'boss');
      G.ui.meter = { label: 'VIKTOR RAZA', value: 1, color: UI.purple };
      yield () => { G.ui.meter.value = Math.max(0, viktor.hp) / viktor.maxHp; G.ui.meter.text = Math.max(0, Math.ceil(viktor.hp)) + ' HP'; return viktor.dead; };
      G.ui.meter = null;
      clearWanted();
      yield 1.5;
      G.clock = 6 * 60 + 15; // sunrise over the bay
      if (pl().vehicle) pl().exitVehicle(true);
      yield m.cutscene([
        { who: 'viktor', text: 'The coast… was… mine…' },
        { who: 'kai', text: "The coast was never yours. You just rented it with other people's fear." },
        { who: 'lin', text: 'Kai. Come home. I made rendang. Dex is already eating all of it.' },
        { who: 'dex', text: "In my defence, it's excellent rendang." },
        { who: 'kai', text: "Five years gone. Feels like I never left. Feels like I'm finally back." },
      ], { shots: [orbit(viktor.x, viktor.z, 6, 2, 0, 0.6, 6), dolly([pl().x, 3, pl().z], [pl().x - 30, 40, pl().z + 60], [pl().x, 1.5, pl().z], [400, 30, 300], 16, 50)] });
      G.progress.finished = true;
      m.afterPass = () => startCredits('playing');
    },
  },
];

// ---------------------------------------------------------------------------
export function startMission(i) {
  const def = MISSIONS[i];
  if (!def || M) return;
  G.markerArmed = false;
  const c = ctx();
  c.def = def; c.index = i; c.gen = def.script(c); c.wait = null;
  M = c; G.mission = c;
  G.missionTarget = () => { const t = M && M.target; return t && !t.dead && !(t.kind === 'vehicle' && t.wrecked) ? t : null; };
  setMusicMood('mission');
  G.banner(def.name.toUpperCase(), `Mission ${i + 1} of 6`, UI.teal, 3, 3);
  step();
}

function step() {
  if (!M) return;
  const r = M.gen.next();
  if (r.done) { pass(); return; }
  const y = r.value;
  if (y && y.cutscene) {
    const w = { type: 'cutscene', done: false };
    M.wait = w;
    playCutscene(y.cutscene, { ...y.opts, onDone: () => { w.done = true; } });
  } else if (typeof y === 'number') M.wait = { type: 'time', t: y };
  else if (typeof y === 'function') M.wait = { type: 'until', fn: y };
  else M.wait = null;
}

export function update(dt) {
  if (!M) {
    const def = MISSIONS[G.progress.missionIndex];
    if (!def || !def.giver || G.wanted.stars > 0) return;
    const at = lm(def.giver), p = pl();
    if (!p) return;
    if (!near(p, at, 7)) G.markerArmed = true;
    if (!p.vehicle && near(p, at, 2.2) && G.markerArmed) startMission(G.progress.missionIndex);
    else if (p.vehicle && near(p.vehicle, at, 5)) G.help('Step out of the car and into the marker to start the mission.', 0.2);
    return;
  }
  if (G.mode !== 'playing' && G.mode !== 'cutscene') return;
  for (const f of M.fails) if (f.fn()) { fail(f.reason); return; }
  const w = M.wait;
  if (!w) { step(); return; }
  if (w.type === 'cutscene') { if (w.done) step(); }
  else if (w.type === 'time') { w.t -= dt; if (w.t <= 0) step(); }
  else if (w.type === 'until' && w.fn()) step();
}

function cleanup() {
  G.markerArmed = false;
  for (const e of M.entities) {
    if (e.kind === 'vehicle') {
      if (e.driver && e.driver.isPlayer) { e.mission = false; e.role = 'player'; continue; }
      const i = G.vehicles.indexOf(e); if (i >= 0) G.vehicles.splice(i, 1);
    } else {
      if (e.vehicle) { e.vehicle.passengers = e.vehicle.passengers.filter((q) => q !== e); if (e.vehicle.driver === e) e.vehicle.driver = null; }
      const i = G.peds.indexOf(e); if (i >= 0) G.peds.splice(i, 1);
    }
  }
  G.pickups = G.pickups.filter((p) => !p.mission);
  G.ui.objective = ''; G.ui.timer = null; G.ui.meter = null;
  M = null; G.mission = null; G.missionTarget = null;
  setMusicMood('free');
}

function pass() {
  const def = M.def, after = M.afterPass;
  cleanup();
  G.progress.missionIndex = Math.max(G.progress.missionIndex, MISSIONS.indexOf(def) + 1);
  G.stats.missions = Math.max(G.stats.missions, G.progress.missionIndex);
  G.addMoney(def.reward);
  G.banner('MISSION PASSED', '+' + formatMoney(def.reward), UI.gold, 5, 5);
  sfx('passed');
  Save.save();
  G.toast('Autosaved', UI.teal);
  if (after) setTimeout(after, 4500);
  else if (MISSIONS[G.progress.missionIndex]) G.toast(`New mission at ${lm(MISSIONS[G.progress.missionIndex].giver).name}`, UI.gold);
}

export function fail(reason) {
  if (!M) return;
  cleanup(); clearWanted(); cancelCutscene();
  G.banner('MISSION FAILED', reason, UI.red, 4.5, 5);
  sfx('failed');
  if (G.progress.missionIndex === 0) setTimeout(() => { if (G.mode === 'playing' && !M) startMission(0); }, 4600);
}
export function onPlayerDown(reason) { if (M) fail(reason); }
export function abort() { if (M) cleanup(); cancelCutscene(); }

function missionBlips() {
  const out = [];
  if (M) {
    const t = G.missionTarget();
    if (t) out.push({ x: t.x, z: t.z, icon: M.targetIcon || 'mission', color: M.targetColor || UI.gold, big: true });
    if (M.blips) for (const b of M.blips()) out.push(b);
  } else {
    const def = MISSIONS[G.progress.missionIndex];
    if (def && def.giver) { const g = lm(def.giver); out.push({ x: g.x, z: g.z, icon: 'mission', color: UI.gold, big: true }); }
  }
  return out;
}
G.missionBlips = missionBlips;

/** Light-cylinder markers: mission start points and ground targets. */
export function markerList() {
  if (!M) {
    const def = MISSIONS[G.progress.missionIndex];
    if (def && def.giver) { const g = lm(def.giver); return [{ x: g.x, z: g.z, r: 1.5, h: 5, color: hex('#ffd23f') }]; }
    return [];
  }
  const t = G.missionTarget();
  if (!t || t.kind === 'vehicle' || t instanceof Ped || t.type) return [];
  return [{ x: t.x, z: t.z, r: t.id ? 4 : 1.8, h: 5, color: M.targetColor === UI.gold ? hex('#ffd23f') : hex('#ff4d5e') }];
}
