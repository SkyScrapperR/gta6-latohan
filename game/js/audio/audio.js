// Web Audio: positional one-shot SFX (PannerNode per sound, listener follows the camera),
// engine with RPM pitch and gear shifts, tyre screech, two-tone siren with a doppler-ish
// pitch shift, helicopter rotor thump, footsteps, city + sea ambience. Radio lives in radio.js.
import { G } from '../core/state.js';
import { clamp } from '../core/math.js';
import { rig } from '../camera-rig.js';
import { createRadio, updateRadio, cycleStation, stationName } from './radio.js';

let ac = null, master, sfxBus, musicBus, noiseBuf;
let engine = null, screech = null, siren = null, heli = null, city = null, waves = null;
let lastSirenD = null, gearPrev = 0;

export function initAudio() {
  if (ac) return;
  try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  master = ac.createGain();
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp); comp.connect(ac.destination);
  sfxBus = ac.createGain(); sfxBus.connect(master);
  musicBus = ac.createGain(); musicBus.connect(master);
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  applyVolumes();
  buildLoops();
  createRadio(ac, musicBus, noiseBuf);
}
export function applyVolumes() {
  if (!ac) return;
  const s = G.settings, t = ac.currentTime;
  master.gain.setTargetAtTime(s.mute ? 0 : s.master, t, 0.05);
  sfxBus.gain.setTargetAtTime(s.sfx, t, 0.05);
  musicBus.gain.setTargetAtTime(s.music * 0.55, t, 0.05);
}
export function setMusicMood() {}
export function cycleRadio() { return cycleStation(); }
export { stationName };

// ---------- building blocks ----------
function panner(x, y, z) {
  const p = ac.createPanner();
  p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 6; p.maxDistance = 400; p.rolloffFactor = 1.1;
  p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
  p.connect(sfxBus);
  return p;
}
function noise(t, dur, out, { type = 'bandpass', f = 1000, f2 = null, q = 1, vol = 0.5, attack = 0.002 } = {}) {
  const src = ac.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(fl); fl.connect(g); g.connect(out); src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
}
function tone(t, dur, out, { type = 'sine', f = 440, f2 = null, vol = 0.3, attack = 0.005, lp = null } = {}) {
  const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let n = o; if (lp) { const f_ = ac.createBiquadFilter(); f_.type = 'lowpass'; f_.frequency.value = lp; o.connect(f_); n = f_; }
  n.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
}

/** Play a sound effect; o = { x, y, z } makes it positional (otherwise UI/2D). */
export function sfx(name, o = {}) {
  if (!ac) return;
  const t = ac.currentTime + 0.005, v = o.vol ?? 1;
  const out = o.x !== undefined ? panner(o.x, o.y ?? 1, o.z) : sfxBus;
  switch (name) {
    case 'pistol': noise(t, 0.16, out, { f: 1900, q: 0.8, vol: 0.6 * v }); tone(t, 0.12, out, { f: 140, f2: 45, vol: 0.5 * v }); break;
    case 'smg': noise(t, 0.08, out, { f: 2500, q: 0.9, vol: 0.45 * v }); tone(t, 0.07, out, { f: 180, f2: 60, vol: 0.3 * v }); break;
    case 'shotgun': noise(t, 0.4, out, { type: 'lowpass', f: 2400, f2: 300, vol: 0.85 * v }); tone(t, 0.25, out, { f: 110, f2: 35, vol: 0.6 * v }); break;
    case 'reload': for (let i = 0; i < 2; i++) { tone(t + i * 0.32, 0.04, out, { type: 'square', f: 1800 - i * 500, vol: 0.06, lp: 4000 }); noise(t + i * 0.32, 0.05, out, { type: 'highpass', f: 2500, vol: 0.2 }); } break;
    case 'dry': tone(t, 0.04, out, { type: 'square', f: 900, vol: 0.05, lp: 3000 }); break;
    case 'punch': tone(t, 0.12, out, { f: 120, f2: 50, vol: 0.6 * v }); noise(t, 0.06, out, { type: 'lowpass', f: 900, vol: 0.4 * v }); break;
    case 'swing': noise(t, 0.12, out, { f: 600, f2: 2400, q: 2, vol: 0.15 * v, attack: 0.04 }); break;
    case 'jump': noise(t, 0.08, out, { type: 'lowpass', f: 500, vol: 0.12 }); break;
    case 'step': noise(t, 0.05, out, { type: 'bandpass', f: o.f || 900, q: 1.5, vol: 0.1 * v }); break;
    case 'explosion': noise(t, 1.8, out, { type: 'lowpass', f: 1600, f2: 70, vol: 1, attack: 0.01 }); tone(t, 1.2, out, { f: 70, f2: 25, vol: 0.9 }); noise(t + 0.05, 0.7, out, { f: 300, q: 0.5, vol: 0.45 }); break;
    case 'crash': noise(t, 0.35, out, { f: 500, q: 0.7, vol: 0.75 * v }); tone(t, 0.2, out, { type: 'square', f: 190, f2: 90, vol: 0.12 * v, lp: 1200 }); noise(t + 0.03, 0.22, out, { type: 'highpass', f: 3500, vol: 0.25 * v }); break;
    case 'thud': tone(t, 0.15, out, { f: 90, f2: 40, vol: 0.6 }); noise(t, 0.1, out, { type: 'lowpass', f: 500, vol: 0.4 }); break;
    case 'horn': tone(t, 0.32, out, { type: 'square', f: 392, vol: 0.13 * v, lp: 1800 }); tone(t, 0.32, out, { type: 'square', f: 494, vol: 0.11 * v, lp: 1800 }); break;
    case 'door': noise(t, 0.12, out, { type: 'lowpass', f: 700, vol: 0.4 }); tone(t + 0.08, 0.05, out, { type: 'square', f: 300, vol: 0.06, lp: 900 }); break;
    case 'pickup': [660, 880, 1320].forEach((f, i) => tone(t + i * 0.06, 0.18, out, { type: 'triangle', f, vol: 0.25 })); break;
    case 'cash': tone(t, 0.08, out, { type: 'triangle', f: 1320, vol: 0.2 }); tone(t + 0.07, 0.2, out, { type: 'triangle', f: 1760, vol: 0.2 }); break;
    case 'click': case 'tick': tone(t, 0.04, out, { f: name === 'click' ? 900 : 1400, vol: 0.12 }); break;
    case 'confirm': tone(t, 0.1, out, { type: 'triangle', f: 660, vol: 0.2 }); tone(t + 0.08, 0.2, out, { type: 'triangle', f: 990, vol: 0.2 }); break;
    case 'star': tone(t, 0.15, out, { type: 'square', f: 880, vol: 0.08, lp: 2500 }); tone(t + 0.15, 0.2, out, { type: 'square', f: 660, vol: 0.08, lp: 2500 }); break;
    case 'cleared': [523, 659, 784].forEach((f, i) => tone(t + i * 0.09, 0.3, out, { type: 'triangle', f, vol: 0.18 })); break;
    case 'passed': [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.11, 0.25, out, { type: 'square', f, vol: 0.09, lp: 3000 })); [523, 659, 784, 1047].forEach((f) => tone(t + 0.5, 1.4, out, { type: 'triangle', f, vol: 0.12 })); break;
    case 'failed': [392, 330, 262].forEach((f, i) => tone(t + i * 0.2, 0.4, out, { type: 'square', f, vol: 0.09, lp: 1500 })); break;
    case 'flatline': tone(t, 0.12, out, { f: 1000, vol: 0.15 }); tone(t + 0.6, 0.12, out, { f: 1000, vol: 0.15 }); tone(t + 1.2, 2.4, out, { f: 1000, vol: 0.13 }); break;
    case 'cuffed': for (let i = 0; i < 3; i++) { tone(t + i * 0.09, 0.05, out, { type: 'square', f: 2200, vol: 0.08, lp: 5000 }); noise(t + i * 0.09, 0.05, out, { type: 'highpass', f: 3000, vol: 0.2 }); } break;
    case 'alarm': for (let i = 0; i < 10; i++) tone(t + i * 0.3, 0.28, out, { type: 'square', f: i % 2 ? 700 : 940, vol: 0.1, lp: 2500 }); break;
    case 'save': [784, 988, 1175, 1568].forEach((f, i) => tone(t + i * 0.08, 0.4, out, { f, vol: 0.16 })); break;
    case 'spray': noise(t, 1.0, out, { type: 'highpass', f: 4000, vol: 0.3, attack: 0.1 }); break;
    case 'error': tone(t, 0.2, out, { type: 'square', f: 120, vol: 0.1, lp: 800 }); break;
    case 'whoosh': noise(t, 0.6, out, { f: 300, f2: 2500, q: 1.2, vol: 0.15, attack: 0.25 }); break;
  }
}
export function footstep(x, z, run) { sfx('step', { x, y: 0.1, z, f: run ? 1200 : 800, vol: run ? 1 : 0.7 }); }

// ---------- loops ----------
function loopNoise(type, f, q, positional = false) {
  const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  const g = ac.createGain(); g.gain.value = 0;
  src.connect(fl); fl.connect(g);
  const p = positional ? panner(0, 0, 0) : null;
  g.connect(p || sfxBus); src.start();
  return { src, fl, g, p };
}
function buildLoops() {
  const o1 = ac.createOscillator(); o1.type = 'sawtooth';
  const o2 = ac.createOscillator(); o2.type = 'square';
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 3;
  const g = ac.createGain(); g.gain.value = 0;
  const g2 = ac.createGain(); g2.gain.value = 0.5;
  o1.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(sfxBus); o1.start(); o2.start();
  engine = { o1, o2, f, g };
  screech = loopNoise('bandpass', 2300, 6);
  heli = loopNoise('lowpass', 220, 1, true);
  const lfo = ac.createOscillator(); lfo.frequency.value = 11; const lg = ac.createGain(); lg.gain.value = 0;
  lfo.connect(lg); lg.connect(heli.g.gain); lfo.start(); heli.lfo = lg;
  city = loopNoise('lowpass', 420, 0.5);
  waves = loopNoise('lowpass', 600, 0.7);
  const wl = ac.createOscillator(); wl.frequency.value = 0.12; const wg = ac.createGain(); wg.gain.value = 0;
  wl.connect(wg); wg.connect(waves.g.gain); wl.start(); waves.lfo = wg;
  const so = ac.createOscillator(); so.type = 'triangle';
  const sf = ac.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 2400;
  const sg = ac.createGain(); sg.gain.value = 0;
  const sp = panner(0, 0, 0);
  so.connect(sf); sf.connect(sg); sg.connect(sp); so.start();
  siren = { o: so, g: sg, p: sp };
}

export function updateAudio(dt) {
  if (!ac) return;
  if (ac.state === 'suspended') ac.resume();
  const t = ac.currentTime;
  // listener follows the camera
  const L = ac.listener, c = rig.pos, tg = rig.target;
  const fx = tg[0] - c[0], fy = tg[1] - c[1], fz = tg[2] - c[2], fl = Math.hypot(fx, fy, fz) || 1;
  if (L.positionX) { L.positionX.value = c[0]; L.positionY.value = c[1]; L.positionZ.value = c[2]; L.forwardX.value = fx / fl; L.forwardY.value = fy / fl; L.forwardZ.value = fz / fl; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
  else { L.setPosition(c[0], c[1], c[2]); L.setOrientation(fx / fl, fy / fl, fz / fl, 0, 1, 0); }
  const pl = G.player;
  const playing = G.mode === 'playing' || G.mode === 'cutscene';
  const v = pl && pl.vehicle && playing ? pl.vehicle : null;
  if (v) {
    // fake gearbox: RPM climbs within each gear, drops on a shift
    const sp = Math.abs(v.forwardSpeed), gear = Math.min(5, Math.floor(sp / 11));
    if (gear !== gearPrev) { gearPrev = gear; engine.g.gain.setValueAtTime(0.03, t); }
    const rpm = 0.3 + (sp - gear * 11) / 13 + gear * 0.06;
    const base = 36 + rpm * 70 + (v.ctl.throttle > 0 ? 8 : 0);
    engine.o1.frequency.setTargetAtTime(base, t, 0.05); engine.o2.frequency.setTargetAtTime(base / 2, t, 0.05);
    engine.f.frequency.setTargetAtTime(380 + rpm * 900, t, 0.08);
    engine.g.gain.setTargetAtTime(v.wrecked ? 0 : 0.07 + v.ctl.throttle * 0.05, t, 0.08);
    screech.g.gain.setTargetAtTime(v.skidding * 0.18, t, 0.05);
  } else { engine.g.gain.setTargetAtTime(0, t, 0.1); screech.g.gain.setTargetAtTime(0, t, 0.05); }
  // nearest siren: two-tone, positional, pitch shifted by closing speed (doppler-ish)
  let best = null, bd = Infinity;
  if (playing) for (const car of G.vehicles) if (car.siren && car !== (pl && pl.vehicle)) { const d = Math.hypot(car.x - c[0], car.z - c[2]); if (d < bd) { bd = d; best = car; } }
  if (best) {
    siren.p.positionX.value = best.x; siren.p.positionY.value = 1.5; siren.p.positionZ.value = best.z;
    const closing = lastSirenD !== null ? (lastSirenD - bd) / Math.max(dt, 1e-3) : 0;
    lastSirenD = bd;
    const dop = clamp(1 + closing / 340, 0.85, 1.15);
    siren.o.frequency.setTargetAtTime((Math.floor(t * 1.6) % 2 ? 960 : 720) * dop, t, 0.02);
    siren.g.gain.setTargetAtTime(0.16, t, 0.1);
  } else { lastSirenD = null; siren.g.gain.setTargetAtTime(0, t, 0.2); }
  const h = G.heli;
  if (h && playing) { heli.p.positionX.value = h.x; heli.p.positionY.value = h.y; heli.p.positionZ.value = h.z; heli.g.gain.setTargetAtTime(0.25, t, 0.2); heli.lfo.gain.setTargetAtTime(0.25, t, 0.2); }
  else { heli.g.gain.setTargetAtTime(0, t, 0.3); heli.lfo.gain.setTargetAtTime(0, t, 0.3); }
  const onFoot = pl && !pl.vehicle && playing;
  city.g.gain.setTargetAtTime(onFoot ? 0.035 + G.weather.rain * 0.05 : G.mode === 'title' ? 0.02 : 0, t, 0.5);
  city.fl.frequency.setTargetAtTime(400 + G.weather.rain * 2500, t, 0.5);
  const seaD = pl ? Math.min(Math.abs(pl.z - 1124), Math.abs(pl.x + 36), Math.abs(pl.x - 1102), Math.abs(pl.z + 36)) : 999;
  const wv = onFoot ? clamp(1 - seaD / 80, 0, 1) * 0.12 : 0;
  waves.g.gain.setTargetAtTime(wv, t, 0.6); waves.lfo.gain.setTargetAtTime(wv * 0.8, t, 0.6);
  updateRadio(t, (v && stationName() !== 'Off') || G.mode === 'title' || G.mode === 'credits');
}
