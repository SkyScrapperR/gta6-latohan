// localStorage save/load under a versioned key: progress, player state, stats, clock, settings.
import { G } from './core/state.js';

export const SAVE_KEY = 'selarabay3d.save.v1';
const SETTINGS_KEY = 'selarabay3d.settings.v1';

export function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
export function save() {
  const p = G.player;
  if (!p) return false;
  const data = {
    version: 1, money: G.money, clock: G.clock, progress: G.progress, stats: G.stats, settings: G.settings,
    player: { x: p.vehicle ? p.vehicle.x : p.x, z: p.vehicle ? p.vehicle.z : p.z, hp: p.hp, armor: p.armor, weapons: p.weapons, ammo: p.ammo, clip: p.clip, weapon: p.weapon },
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
}
export function load() { try { const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return d && d.version === 1 ? d : null; } catch (e) { return null; } }
export function deleteSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }
export function resetProgress() {
  G.money = 0; G.moneyShown = 0; G.clock = 17 * 60 + 40;
  G.progress = { missionIndex: 0, safehouse: false, tags: [], finished: false };
  G.stats = { missions: 0, tags: 0, kills: 0, carsStolen: 0, played: 0, earned: 0, deaths: 0, arrests: 0, shots: 0 };
  G.waypoint = null;
}
export function applyToState(d) {
  G.money = G.moneyShown = d.money || 0;
  G.clock = d.clock ?? 600;
  G.progress = { missionIndex: 0, safehouse: false, tags: [], finished: false, ...d.progress };
  G.stats = { ...G.stats, ...d.stats };
  if (d.settings) Object.assign(G.settings, d.settings);
}
export function applyToPlayer(d, p) {
  p.hp = d.hp ?? 100; p.armor = d.armor ?? 0;
  p.weapons = { fists: true, kobra: false, wasp: false, thunder: false, ...d.weapons };
  p.ammo = { kobra: 0, wasp: 0, thunder: 0, ...d.ammo };
  p.clip = { kobra: 0, wasp: 0, thunder: 0, ...d.clip };
  p.weapon = d.weapon || 'fists';
}
export function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(G.settings)); } catch (e) { /* ignore */ } }
export function loadSettings() { try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); if (s) Object.assign(G.settings, s); } catch (e) { /* ignore */ } }
