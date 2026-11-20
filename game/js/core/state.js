// The single shared game-state object. Every system reads and writes through G.

export const G = {
  gl: null, renderer: null, hud: null, hctx: null, W: 1280, H: 720,
  mode: 'boot',            // boot | title | playing | paused | map | cutscene | dead | busted | credits
  realTime: 0, time: 0, dt: 1 / 60, timeScale: 1, simSpeed: 1,
  clock: 18 * 60,          // minutes of the day (1 real second = 1 game minute)
  clockFrozen: false,
  city: null, atlas: null, props: null,
  player: null, vehicles: [], peds: [], pickups: [], heli: null,
  money: 0, moneyShown: 0,
  wanted: { heat: 0, stars: 0, seen: true, unseen: 0, lastX: 0, lastZ: 0, flash: 0 },
  stats: { missions: 0, tags: 0, kills: 0, carsStolen: 0, played: 0, earned: 0, deaths: 0, arrests: 0, shots: 0 },
  progress: { missionIndex: 0, safehouse: false, tags: [], finished: false },
  waypoint: null,
  weather: { rain: 0, target: 0, timer: 120 },
  settings: { quality: 'high', master: 0.8, music: 0.6, sfx: 0.8, mute: false, sensitivity: 1, invertY: false },
  cam: null,
  debug: { shot: 0 },
  ui: { banner: null, help: null, area: null, vehicleName: null, radioName: null, objective: '', toasts: [], hitMarker: 0, damageDirs: [], crossBloom: 0, timer: null, meter: null },
};
