// The single shared game-state object. Every system reads and writes through G.

export const G = {
  canvas: null, ctx: null, W: 1280, H: 720, dpr: 1,
  mode: 'boot',            // boot | title | playing | paused | map | cutscene | dead | busted | credits
  prevMode: 'playing',
  realTime: 0,             // seconds since boot (wall clock, never paused)
  time: 0,                 // simulation seconds
  dt: 0,
  timeScale: 1,            // slow motion (death screen)
  clock: 9 * 60,           // minutes of the day (1 real second = 1 game minute)
  clockFrozen: false,

  cam: { x: 0, y: 0, zoom: 1.5, tz: 1.5, shake: 0, sx: 0, sy: 0, leadX: 0, leadY: 0 },
  city: null,
  player: null,
  vehicles: [],
  peds: [],
  pickups: [],
  heli: null,

  money: 0,
  moneyShown: 0,
  wanted: { heat: 0, stars: 0, seen: true, unseen: 0, lastX: 0, lastY: 0, flash: 0 },
  stats: { missions: 0, tags: 0, kills: 0, carsStolen: 0, played: 0, earned: 0, deaths: 0, arrests: 0, shots: 0 },
  progress: { missionIndex: 0, safehouse: false, tags: [], finished: false, rewardsCollected: {} },
  waypoint: null,

  weather: { rain: 0, target: 0, timer: 90 },
  settings: { master: 0.8, music: 0.6, sfx: 0.8, mute: false },
  debug: { shot: 0, noAI: false },
  ui: { banner: null, help: null, area: null, vehicleName: null, radioName: null, objective: '', toast: [] },
};
