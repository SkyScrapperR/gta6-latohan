// Story missions as generator scripts. Each yields predicates (wait until true), numbers
// (wait seconds) or cutscenes; fail conditions are checked every frame. Failed missions
// clean up and their start marker reappears so the player can retry.
import { G } from '../state.js';
import { TAU, RNG, clamp, formatMoney } from '../util.js';
import { Vehicle } from '../entities/vehicle.js';
import { Ped } from '../entities/pedestrian.js';
import { spawnPickup } from '../entities/pickups.js';
import { setWanted, clearWanted } from '../ai/police.js';
import { gangBrain } from '../ai/combat-ai.js';
import { steerToward, obstacleAhead } from '../ai/traffic.js';
import { nearestNode, bfsPath, nodeXY, laneOffset } from '../world/roads.js';
import { CELL, ROAD, PIERS, LAND, districtAt } from '../world/city.js';
import { playCutscene, say, cancelCutscene } from './dialogue.js';
import { drawMarker } from './side-content.js';
import { UI } from '../ui/theme.js';
import * as Save from '../save.js';
import { sfx, setMusicMood } from '../audio/audio.js';
import { startCredits } from '../ui/menus.js';

const rng = new RNG(77);
let M = null; // running mission context

// ---------------------------------------------------------------------------
// helpers available to scripts
function ctx() {
  return {
    entities: [], fails: [], target: null, blips: null,
    objective(text) { G.ui.objective = text; },
    setTarget(t, color = UI.gold, icon = 'mission') { this.target = t; this.targetColor = color; this.targetIcon = icon; },
    cutscene(lines, focus) { return { cutscene: lines, focus }; },
    failIf(fn, reason) { const f = { fn, reason }; this.fails.push(f); return f; },
    track(e) { this.entities.push(e); e.mission = true; return e; },
  };
}
const nearP = (a, b, r) => a && b && (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < r * r;
const lm = (id) => G.city.landmarks[id];
const pl = () => G.player;
const inCar = () => !!(G.player && G.player.vehicle);

export function spawnGang(x, y, weapon = 'kobra', hp = 60, outfit = 'gang') {
  const p = new Ped('gang', x, y, outfit);
  p.weapon = weapon; p.hp = p.maxHp = hp; p.brain = gangBrain; p.state = 'guard';
  p.cooldown = rng.range(0.4, 1.4); p.aggroRange = 320; p.mission = true;
  G.peds.push(p);
  return p;
}
export function spawnCar(model, x, y, angle, color) {
  const v = new Vehicle(model, x, y, angle, color);
  v.role = 'mission'; v.mission = true;
  G.vehicles.push(v);
  return v;
}
/** Make an NPC ride with the player: enters any car the player is in when close. */
function companionTick(p) {
  const P = G.player;
  if (p.dead) return;
  if (p.vehicle) {
    if (!P.vehicle || P.vehicle !== p.vehicle) { // player got out: companion gets out too
      const v = p.vehicle; v.passengers = v.passengers.filter((q) => q !== p); p.vehicle = null;
      const d = v.doorPos(-1); p.x = d.x; p.y = d.y;
    }
    return;
  }
  if (P.vehicle && nearP(p, P.vehicle, 90) && P.vehicle.speed < 40) {
    p.moveTo(P.vehicle.x, P.vehicle.y, 120, G.dt);
    if (nearP(p, P.vehicle, 26)) { p.vehicle = P.vehicle; P.vehicle.passengers.push(p); sfx('door'); }
  } else if (!nearP(p, P, 40)) p.moveTo(P.x, P.y, 130, G.dt); else p.moving = false;
}

// ---------------------------------------------------------------------------
// The six story missions
export const MISSIONS = [
  {
    id: 'homecoming', name: 'Homecoming', giver: null, reward: 500,
    *script(m) {
      const pier = PIERS[0];
      const P = pl();
      P.x = pier.x + pier.w / 2; P.y = pier.y + pier.h - 40; P.angle = -Math.PI / 2;
      G.clock = 17 * 60 + 35;
      const car = m.track(spawnCar('merpati', pier.x + 150, 5381, Math.PI, [40, 90, 150]));
      yield m.cutscene([
        { who: 'kai', text: 'Five years. The bay still smells like diesel and frangipani.' },
        { who: 'kai', text: "Same pier. Same gulls. Different me." },
        { who: 'lin', text: "Kai? You're really back? Good. Don't stand there looking poetic." },
        { who: 'lin', text: "There's a blue Merpati by the boardwalk. Keys are in it. Get to the garage." },
        { who: 'kai', text: 'Still bossing me around, Mama Lin.' },
        { who: 'lin', text: 'Somebody has to. Drive careful — the Orchids own half the coast now.' },
      ], { x: P.x, y: P.y - 250 });
      m.objective('Get in the Merpati.');
      m.setTarget(car);
      m.failIf(() => car.wrecked, 'The Merpati was wrecked.');
      yield () => P.vehicle === car;
      m.objective("Drive to Lin's Garage.");
      m.setTarget(lm('garage'));
      yield () => inCar() && nearP(P.vehicle, lm('garage'), 60) && P.vehicle.speed < 60;
      G.clock = 18 * 60;
      yield m.cutscene([
        { who: 'lin', text: "Look at you. Taller. Thinner. Still can't park." },
        { who: 'kai', text: 'Missed you too. The shop looks… quiet.' },
        { who: 'lin', text: "Viktor Raza's Black Orchid takes a cut of everything on this coast. Mine included." },
        { who: 'lin', text: 'Your old room at the Bukit Asri house is yours. Rest. Tomorrow we talk business.' },
      ], { x: lm('garage').x, y: lm('garage').y - 40 });
      G.progress.safehouse = true;
      G.toast('Safehouse unlocked in Bukit Asri', UI.teal);
    },
  },
  {
    id: 'yellow', name: 'Yellow Fever', giver: 'garage', reward: 1500,
    *script(m) {
      yield m.cutscene([
        { who: 'lin', text: "Viktor's nephew Rendy parks a yellow Vesper GT downtown like he owns the street." },
        { who: 'lin', text: 'I want it. In my shop. Mostly in one piece.' },
        { who: 'kai', text: 'Stealing from the Orchids on day two. Great plan.' },
        { who: 'lin', text: "It's a message, not a plan. Under 25% damage and I'll make it worth your while." },
      ], { x: lm('garage').x, y: lm('garage').y - 40 });
      const spot = { x: 5 * CELL + ROAD + 180, y: 2 * CELL + 30 };
      const car = m.track(spawnCar('vesper', spot.x, 971, 0, [250, 200, 20]));
      car.noRespray = true;
      const rendy = m.track(new Ped('civ', spot.x + 40, 990, null));
      rendy.state = 'idle'; rendy.stateTime = 9999;
      rendy.look.shirt = [255, 225, 77]; rendy.look.hair = [42, 29, 20];
      G.peds.push(rendy);
      m.objective("Steal Rendy's yellow Vesper GT in Kota Lama.");
      m.setTarget(car);
      m.failIf(() => car.wrecked, 'The Vesper GT was destroyed.');
      yield () => pl().vehicle === car;
      setWanted(1);
      say([{ who: 'rendy', text: "HEY! That's my car! Uncle Viktor is gonna hear about this!" }]);
      m.objective('Deliver the Vesper to the garage. Keep it above 25% health.');
      m.setTarget(lm('garage'));
      const low = m.failIf(() => car.hp < car.maxHp * 0.25, 'The Vesper is too damaged. Lin won\'t take it.');
      yield () => pl().vehicle === car && nearP(car, lm('garage'), 60) && car.speed < 60 && G.wanted.stars === 0
        || (pl().vehicle === car && nearP(car, lm('garage'), 60) && G.wanted.stars > 0 && (G.help('Lose the heat before delivering the car.', 0.2), false));
      pl().exitVehicle(true);
      car.locked = true;
      yield m.cutscene([
        { who: 'lin', text: "Now that's a pretty message. I'll strip it by morning." },
        { who: 'lin', text: 'There is a Kobra 9 waiting for you at the safehouse. Please only point it at bad people.' },
      ], { x: lm('garage').x, y: lm('garage').y - 40 });
      const s = lm('safehouse');
      spawnPickup('weapon', s.x + 34, s.y - 10, { weapon: 'kobra', amount: 60 });
      G.toast('Kobra 9 waiting at the safehouse', UI.gold);
    },
  },
  {
    id: 'collections', name: 'Collections', giver: 'garage', reward: 2000,
    *script(m) {
      yield m.cutscene([
        { who: 'lin', text: 'Every Friday Orchid enforcers collect "insurance" at Kedai Orchid by the beach.' },
        { who: 'lin', text: "Today they're the ones getting collected. Bring me their bag." },
        { who: 'kai', text: 'How many?' },
        { who: 'lin', text: 'Four. Maybe five if one of them brought his mother.' },
      ], { x: lm('garage').x, y: lm('garage').y - 40 });
      const k = lm('kedai');
      m.objective('Go to Kedai Orchid.');
      m.setTarget(k);
      yield () => nearP(pl(), k, 260);
      const goons = [];
      const offs = [[-80, -10], [80, -10], [-40, 50], [50, 60]];
      for (const [dx, dy] of offs) { const g = m.track(spawnGang(k.x + dx, k.y + dy, 'kobra', 55)); g.blip = UI.red; goons.push(g); }
      say([{ who: 'goon', text: "Who's this? Somebody teach him the rules." }]);
      m.objective('Defeat the 4 Orchid enforcers.');
      m.setTarget(null);
      m.blips = () => goons.filter((g) => !g.dead).map((g) => ({ x: g.x, y: g.y, icon: 'target', color: UI.red }));
      yield () => goons.every((g) => g.dead);
      m.blips = null;
      const last = goons[goons.length - 1];
      let got = false;
      const bag = spawnPickup('bag', last.x, last.y, { mission: true, onCollect: () => { got = true; } });
      m.objective('Pick up the cash bag.');
      m.setTarget(bag);
      yield () => got;
      m.objective('Bring the bag back to the garage.');
      m.setTarget(lm('garage'));
      yield () => nearP(pl(), lm('garage'), 60) && G.wanted.stars === 0 || (nearP(pl(), lm('garage'), 60) && (G.help('Lose the heat first.', 0.2), false));
      yield m.cutscene([
        { who: 'lin', text: 'Eight thousand in small bills and a phone that keeps ringing. Viktor knows your face now.' },
        { who: 'kai', text: 'Good. Let him lose sleep for once.' },
      ], { x: lm('garage').x, y: lm('garage').y - 40 });
    },
  },
  {
    id: 'wheelman', name: 'Wheelman', giver: 'garage', reward: 5000,
    *script(m) {
      yield m.cutscene([
        { who: 'lin', text: "Your friend Dex called. The hacker with the haircut." },
        { who: 'dex', text: "Kai! Bank Samudra holds Viktor's laundering ledgers. I can crack the vault network from the curb." },
        { who: 'dex', text: "I need fifteen seconds and a driver who doesn't panic. You still don't panic, right?" },
        { who: 'kai', text: 'Only on the inside.' },
      ], { x: lm('garage').x, y: lm('garage').y - 40 });
      const d = lm('dex');
      const dex = m.track(new Ped('story', d.x, d.y - 4, 'dex'));
      dex.hp = dex.maxHp = 120; dex.brain = () => {}; dex.blip = '#9dff4d';
      G.peds.push(dex);
      m.failIf(() => dex.dead, 'Dex is dead.');
      m.failIf(() => dex.vehicle && dex.vehicle.wrecked, 'The car exploded with Dex inside.');
      m.objective(inCar() ? "Pick up Dex at his apartment." : "Get a car and pick up Dex at his apartment.");
      m.setTarget(d);
      yield () => inCar() && nearP(pl().vehicle, d, 80) && pl().vehicle.speed < 40;
      dex.brain = companionTick; dex.companion = true;
      m.objective('Wait for Dex to get in.');
      yield () => dex.vehicle === pl().vehicle;
      say([{ who: 'dex', text: "Nice ride. Smells like regret. Bank Samudra, downtown." }]);
      const needDex = () => {
        if (dex.vehicle && dex.vehicle === pl().vehicle) return true;
        m.objective('Get back in a car with Dex.'); m.setTarget(dex); return false;
      };
      const b = lm('bank');
      m.objective('Drive Dex to Bank Samudra.');
      m.setTarget(b);
      yield () => needDex() && (m.objective('Drive Dex to Bank Samudra.'), m.setTarget(b), nearP(pl().vehicle, b, 70)) && pl().vehicle.speed < 50;
      m.objective('Hold position while Dex cracks the vault.');
      let left = 15;
      G.ui.timer = { label: 'VAULT CRACK', value: left };
      say([{ who: 'dex', text: 'Fifteen seconds. Keep the engine warm and your face boring.' }]);
      yield () => {
        if (needDex() && nearP(pl().vehicle, b, 110)) { left -= G.dt; m.objective('Hold position while Dex cracks the vault.'); m.setTarget(b); }
        else if (dex.vehicle) { m.objective('Get back to the bank!'); m.setTarget(b); }
        G.ui.timer.value = Math.max(0, left);
        return left <= 0;
      };
      G.ui.timer = null;
      setWanted(3);
      sfx('alarm');
      say([{ who: 'dex', text: "Got it! Ledgers are ours — and so is the alarm. GO!" }, { who: 'radio', text: 'All units, robbery in progress at Bank Samudra. Suspects in a vehicle.' }]);
      m.objective('Lose the cops.');
      m.setTarget(null);
      yield () => G.wanted.stars === 0 && (dex.vehicle || needDex());
      m.objective('Drop Dex at his apartment.');
      m.setTarget(d);
      yield () => needDex() && (m.objective('Drop Dex at his apartment.'), m.setTarget(d), nearP(pl().vehicle, d, 80) && pl().vehicle.speed < 40);
      const v = dex.vehicle; v.passengers = v.passengers.filter((q) => q !== dex); dex.vehicle = null; const door = v.doorPos(-1); dex.x = door.x; dex.y = door.y; dex.brain = () => {};
      yield m.cutscene([
        { who: 'dex', text: "Shell companies, offshore pings… and a boat. Viktor keeps an escape boat at the east pier." },
        { who: 'dex', text: "Give me a few days. I'll find out when he plans to use it." },
      ], { x: d.x, y: d.y - 30 });
    },
  },
  {
    id: 'lowtide', name: 'Low Tide', giver: 'garage', reward: 8000,
    *script(m) {
      const gun = lm('garage');
      yield m.cutscene([
        { who: 'lin', text: "Orchid Freight at Pier 9 moves guns in a Bison truck. Tonight it's loaded." },
        { who: 'lin', text: "There's a Wasp on the bench. Take it. Burn that truck." },
        { who: 'kai', text: "You keep an SMG on your workbench?" },
        { who: 'lin', text: "Next to the spanners. Go." },
      ], { x: gun.x, y: gun.y - 40 });
      let gotGun = false;
      spawnPickup('weapon', gun.x + 30, gun.y + 10, { weapon: 'wasp', amount: 180, mission: true, onCollect: () => { gotGun = true; } });
      m.objective('Grab the Wasp SMG.');
      m.setTarget({ x: gun.x + 30, y: gun.y + 10 });
      yield () => gotGun;
      const f = lm('freight');
      m.objective('Go to Orchid Freight at Pier 9 Docks.');
      m.setTarget(f);
      // stage the yard
      const truck = m.track(spawnCar('bison', f.x - 60, f.y + 20, 0, [118, 42, 168]));
      truck.cargoLabel = 'ORCHID'; truck.maxHp = truck.hp = 1400;
      const guards = [];
      const pos = [[-130, -30], [130, -30], [-100, 60], [100, 70], [0, -60], [40, 110]];
      for (const [dx, dy] of pos) { const g = m.track(spawnGang(f.x + dx, f.y + dy, rng.chance(0.4) ? 'wasp' : 'kobra', 60)); g.aggroRange = 360; guards.push(g); }
      yield () => nearP(pl(), f, 380);
      m.objective('Defeat the 6 guards and blow up the Bison weapons truck.');
      m.setTarget(truck, UI.red, 'target');
      m.blips = () => guards.filter((g) => !g.dead).map((g) => ({ x: g.x, y: g.y, icon: 'target', color: UI.red }));
      let alarm = false;
      yield () => {
        const alive = guards.filter((g) => !g.dead).length;
        if (!alarm && (alive < 6 || truck.hp < truck.maxHp)) { alarm = true; say([{ who: 'goon', text: 'Protect the truck! Nobody leaves the yard!' }]); }
        m.objective(`Guards left: ${alive}  ·  ${truck.wrecked ? 'Truck destroyed ✓' : 'Blow up the Bison truck'}`);
        if (truck.wrecked) m.setTarget(null);
        return alive === 0 && truck.wrecked;
      };
      m.blips = null;
      setWanted(2);
      m.objective('Escape the docks!');
      m.setTarget(null);
      say([{ who: 'lin', text: "I can see the smoke from here. Get out of the docks, now!" }]);
      yield () => districtAt(pl().x, pl().y) !== 'docks';
      yield m.cutscene([
        { who: 'lin', text: 'That was a year of Orchid profit going up in smoke.' },
        { who: 'kai', text: "Then Viktor's going to run. Men like him always do." },
      ], { x: pl().x, y: pl().y });
    },
  },
  {
    id: 'orchidfalls', name: 'Orchid Falls', giver: 'dex', reward: 25000,
    *script(m) {
      const t = lm('tower');
      yield m.cutscene([
        { who: 'dex', text: "It's happening. Viktor just left Orchid Tower in a black Vesper. He's heading for the boat at the east pier." },
        { who: 'viktor', text: 'Selara Bay was mine before you learned to walk, boy. Enjoy the ashes.' },
        { who: 'kai', text: "You're not getting on that boat, Viktor." },
      ], { x: t.x, y: t.y });
      // Viktor's car follows the road graph toward the east pier
      const start = { x: t.x, y: t.y + 40 };
      const car = m.track(spawnCar('vesper', start.x, start.y, Math.PI / 2, [26, 24, 30]));
      car.stripe = [150, 50, 220];
      car.maxHp = car.hp = 1600; car.minHp = 1600 * 0.17;
      const viktor = m.track(new Ped('boss', start.x, start.y, 'boss'));
      viktor.hp = viktor.maxHp = 200; viktor.weapon = 'wasp';
      viktor.vehicle = car; car.driver = viktor;
      G.peds.push(viktor);
      const pier = PIERS[1];
      const boat = { x: pier.x + pier.w - 30, y: pier.y + pier.h / 2 };
      const route = bfsPath(nearestNode(start.x, start.y), nearestNode(pier.x - 100, boat.y)).map(nodeXY);
      route.push({ x: pier.x + 40, y: boat.y }, boat);
      let wi = 0;
      car.ai = {
        mode: 'script', update(v, dt) {
          if (wi >= route.length) { v.ctl = { throttle: 0, brake: 1, steer: 0, handbrake: false }; return; }
          const w = route[wi];
          const prev = route[Math.max(0, wi - 1)];
          const dx = Math.sign(w.x - prev.x), dy = Math.sign(w.y - prev.y), o = laneOffset(dx, dy);
          const tx = wi < route.length - 2 ? w.x + o.x : w.x, ty = wi < route.length - 2 ? w.y + o.y : w.y;
          if (Math.hypot(tx - v.x, ty - v.y) < 40) wi++;
          const turnSoon = Math.hypot(tx - v.x, ty - v.y) < 140 ? 170 : 300;
          steerToward(v, tx, ty, turnSoon);
          if (obstacleAhead(v, 50) < 18 && v.speed < 30) { v.ctl.throttle = 1; }
        },
      };
      const startD = route.reduce((s, p, i) => (i ? s + Math.hypot(p.x - route[i - 1].x, p.y - route[i - 1].y) : 0), 0);
      m.objective("Wreck Viktor's car before he reaches the boat!");
      m.setTarget(car, UI.red, 'boss');
      m.failIf(() => !car.wrecked && Math.hypot(car.x - boat.x, car.y - boat.y) < 60, 'Viktor reached his boat.');
      G.ui.meter = { label: 'VIKTOR → BOAT', value: 0, color: UI.purple };
      const disabled = () => car.wrecked || car.hp < car.maxHp * 0.2;
      yield () => {
        let rem = 0;
        for (let i = wi; i < route.length; i++) { const a = i === wi ? car : route[i - 1]; rem += Math.hypot(route[i].x - a.x, route[i].y - a.y); }
        G.ui.meter.value = clamp(1 - rem / startD, 0, 1);
        G.ui.meter.text = Math.round(rem / 10) + ' m';
        G.ui.meter.value2 = car.hp / car.maxHp;
        return disabled();
      };
      G.ui.meter = null;
      // he bails out on foot
      car.ai = null; car.ctl = { throttle: 0, brake: 1, steer: 0, handbrake: true };
      viktor.vehicle = null; car.driver = null;
      const door = car.doorPos(1); viktor.x = door.x; viktor.y = door.y;
      viktor.brain = gangBrain; viktor.state = 'combat'; viktor.aggroRange = 900; viktor.cooldown = 1; viktor.blip = UI.purple;
      m.fails = m.fails.filter((f) => !f.reason.includes('boat'));
      say([{ who: 'viktor', text: "You want me? Come and take it!" }]);
      for (let i = 0; i < 2; i++) { const g = m.track(spawnGang(viktor.x + (i ? 40 : -40), viktor.y + 30, 'kobra', 60)); g.state = 'combat'; }
      m.objective('Take down Viktor Raza.');
      m.setTarget(viktor, UI.purple, 'boss');
      G.ui.meter = { label: 'VIKTOR RAZA', value: 1, color: UI.purple };
      yield () => { G.ui.meter.value = Math.max(0, viktor.hp) / viktor.maxHp; G.ui.meter.text = Math.max(0, Math.ceil(viktor.hp)) + ' HP'; return viktor.dead; };
      G.ui.meter = null;
      clearWanted();
      yield 1.5;
      yield m.cutscene([
        { who: 'viktor', text: 'The coast… was… mine…' },
        { who: 'kai', text: "The coast was never yours. You just rented it with other people's fear." },
        { who: 'lin', text: 'Kai. Come home. I made rendang. Dex is already eating all of it.' },
        { who: 'dex', text: "In my defence, it's excellent rendang." },
        { who: 'kai', text: "Five years gone. Feels like I never left. Feels like I'm finally back." },
      ], { x: viktor.x, y: viktor.y });
      G.progress.finished = true;
      m.afterPass = () => startCredits('playing');
    },
  },
];

// ---------------------------------------------------------------------------
// runner
export function startMission(i) {
  const def = MISSIONS[i];
  if (!def || M) return;
  G.markerArmed = false;
  const c = ctx();
  c.def = def; c.index = i; c.gen = def.script(c); c.wait = null;
  M = c; G.mission = c;
  G.missionTarget = () => { const t = M && M.target; return t && !(t.dead) ? t : null; };
  G.missionBlips = missionBlips;
  setMusicMood('mission');
  G.banner(def.name.toUpperCase(), 'Mission ' + (i + 1) + ' of 6', UI.teal, 3);
  step();
}

function step(value) {
  if (!M) return;
  const r = M.gen.next(value);
  if (r.done) { pass(); return; }
  const y = r.value;
  if (y && y.cutscene) {
    M.wait = { type: 'cutscene', done: false };
    const w = M.wait;
    playCutscene(y.cutscene, { x: y.focus ? y.focus.x : G.cam.x, y: y.focus ? y.focus.y : G.cam.y, onDone: () => { w.done = true; } });
  } else if (typeof y === 'number') M.wait = { type: 'time', t: y };
  else if (typeof y === 'function') M.wait = { type: 'until', fn: y };
  else M.wait = null;
}

export function update(dt) {
  if (!M) {
    // start markers for the next mission
    const i = G.progress.missionIndex;
    const def = MISSIONS[i];
    if (!def || !def.giver || G.wanted.stars > 0) return;
    const at = lm(def.giver);
    const p = pl();
    if (!p) return;
    if (!nearP(p, at, 70)) G.markerArmed = true;            // must step off the marker before (re)starting
    if (!p.vehicle && nearP(p, at, 26) && G.markerArmed) startMission(i);
    else if (p && p.vehicle && nearP(p.vehicle, at, 40)) G.help('Get out of the car and step into the marker to start the mission.', 0.2);
    return;
  }
  if (G.mode !== 'playing' && G.mode !== 'cutscene') return;
  for (const f of M.fails) if (f.fn()) { fail(f.reason); return; }
  const w = M.wait;
  if (!w) { step(); return; }
  if (w.type === 'cutscene') { if (w.done) step(); }
  else if (w.type === 'time') { w.t -= dt; if (w.t <= 0) step(); }
  else if (w.type === 'until') { if (w.fn()) step(); }
}

function cleanup(keepCars = false) {
  G.markerArmed = false;
  for (const e of M.entities) {
    if (e.kind === 'vehicle') {
      if (e.driver && e.driver.isPlayer && keepCars) { e.mission = false; e.role = 'player'; continue; }
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
  cleanup(true);
  G.progress.missionIndex = Math.max(G.progress.missionIndex, MISSIONS.indexOf(def) + 1);
  G.stats.missions = Math.max(G.stats.missions, G.progress.missionIndex);
  G.addMoney(def.reward);
  G.banner('MISSION PASSED', '+' + formatMoney(def.reward), UI.gold, 5);
  sfx('passed');
  Save.save();
  G.toast('Autosaved', UI.teal);
  if (after) setTimeout(after, 4500);
  else if (MISSIONS[G.progress.missionIndex]) {
    const next = MISSIONS[G.progress.missionIndex];
    G.toast(`New mission at ${lm(next.giver).name}`, UI.gold);
  }
}

export function fail(reason) {
  if (!M) return;
  cleanup();
  clearWanted();
  G.banner('MISSION FAILED', reason, UI.red, 4.5);
  sfx('failed');
  if (G.progress.missionIndex === 0) {
    // Homecoming has no giver: retry right away from the pier
    setTimeout(() => { if (G.mode === 'playing' && !M) startMission(0); }, 4600);
  }
}

export function onPlayerDown(reason) { if (M) fail(reason); }
export function abort() { if (M) cleanup(); cancelCutscene(); }

export function missionTarget() { return M ? M.target : null; }

function missionBlips() {
  const out = [];
  if (M) {
    const t = M.target;
    if (t && !t.dead && !(t.kind === 'vehicle' && t.wrecked && t !== M.target)) out.push({ x: t.x, y: t.y, icon: M.targetIcon || 'mission', color: M.targetColor || UI.gold, big: true });
    if (M.blips) for (const b of M.blips()) out.push(b);
  } else {
    const def = MISSIONS[G.progress.missionIndex];
    if (def && def.giver) { const g = lm(def.giver); out.push({ x: g.x, y: g.y, icon: 'mission', color: UI.gold, big: true, name: def.name }); }
  }
  return out;
}
G.missionBlips = missionBlips;

/** Mission markers + target chevrons on the ground layer. */
export function drawWorld(ctx, view, t) {
  if (!M) {
    const def = MISSIONS[G.progress.missionIndex];
    if (def && def.giver) { const g = lm(def.giver); drawMarker(ctx, g.x, g.y, '255,210,63', t, 24, def.name.toUpperCase()); }
    return;
  }
  const tg = M.target;
  if (tg && !tg.dead && tg.kind !== 'vehicle' && !(tg instanceof Ped) && !tg.type) drawMarker(ctx, tg.x, tg.y, M.targetColor === UI.gold ? '255,210,63' : '255,77,94', t, 30);
}

/** Bouncing arrows above mission targets (over buildings). */
export function drawOverhead(ctx, view, t) {
  if (!M || !M.target) return;
  const tg = M.target;
  if (tg.dead || (tg.kind === 'vehicle' && tg.wrecked)) return;
  if (tg.x < view.x0 || tg.x > view.x1 || tg.y < view.y0 || tg.y > view.y1) return;
  const y = tg.y - 34 - Math.abs(Math.sin(t * 4)) * 10;
  ctx.fillStyle = M.targetColor || UI.gold;
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(tg.x, y + 12); ctx.lineTo(tg.x - 10, y); ctx.lineTo(tg.x - 4, y); ctx.lineTo(tg.x - 4, y - 10); ctx.lineTo(tg.x + 4, y - 10); ctx.lineTo(tg.x + 4, y); ctx.lineTo(tg.x + 10, y); ctx.closePath();
  ctx.fill(); ctx.stroke();
}
