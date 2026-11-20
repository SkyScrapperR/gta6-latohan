// All sound is synthesized with the Web Audio API: one-shot SFX, looping engine / tyre
// screech / siren / helicopter / city ambience, and two procedural radio stations driven
// by a step sequencer with a lookahead scheduler.
import { G } from '../state.js';
import { clamp } from '../util.js';

let ac = null, master, sfxBus, musicBus, radioGain, noiseBuf;
let engine = null, screech = null, siren = null, heli = null, ambience = null;
const STATIONS = ['Selara Nights FM', 'Ombak Lo-Fi', 'Off'];
let station = 0;
let seq = { step: 0, next: 0, timer: null, station: -1 };
let mood = 'free';

export function initAudio() {
  if (ac) return;
  try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  master = ac.createGain();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp); comp.connect(ac.destination);
  sfxBus = ac.createGain(); sfxBus.connect(master);
  musicBus = ac.createGain(); musicBus.connect(master);
  radioGain = ac.createGain(); radioGain.gain.value = 0; radioGain.connect(musicBus);
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  applyVolumes();
  buildLoops();
  seq.next = ac.currentTime + 0.1;
  seq.timer = setInterval(schedule, 25);
}

export function applyVolumes() {
  if (!ac) return;
  const s = G.settings;
  master.gain.setTargetAtTime(s.mute ? 0 : s.master, ac.currentTime, 0.05);
  sfxBus.gain.setTargetAtTime(s.sfx, ac.currentTime, 0.05);
  musicBus.gain.setTargetAtTime(s.music * 0.55, ac.currentTime, 0.05);
}

export function setMusicMood(m) { mood = m; }
export function cycleRadio() { station = (station + 1) % STATIONS.length; seq.step = 0; return STATIONS[station]; }
export function stationName() { return STATIONS[station]; }

// ---------------------------------------------------------------------------
// building blocks
function noise(t, dur, { type = 'bandpass', f = 1000, f2 = null, q = 1, vol = 0.5, attack = 0.002, bus = sfxBus } = {}) {
  const src = ac.createBufferSource(); src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const filt = ac.createBiquadFilter(); filt.type = type; filt.frequency.setValueAtTime(f, t); filt.Q.value = q;
  if (f2) filt.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt); filt.connect(g); g.connect(bus);
  src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
}
function tone(t, dur, { type = 'sine', f = 440, f2 = null, vol = 0.3, attack = 0.005, bus = sfxBus, detune = 0, lp = null } = {}) {
  const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (lp) { const f_ = ac.createBiquadFilter(); f_.type = 'lowpass'; f_.frequency.value = lp; o.connect(f_); node = f_; }
  node.connect(g); g.connect(bus);
  o.start(t); o.stop(t + dur + 0.05);
}

/** Distance falloff relative to the listener (player or camera). */
function falloff(x, y) {
  if (x === undefined) return 1;
  const lx = G.player ? G.player.x : G.cam.x, ly = G.player ? G.player.y : G.cam.y;
  return clamp(1 - Math.hypot(x - lx, y - ly) / 1500, 0, 1) ** 1.4;
}

export function sfx(name, o = {}) {
  if (!ac) return;
  const v = (o.vol ?? 1) * falloff(o.x, o.y);
  if (v < 0.01) return;
  const t = ac.currentTime + 0.005;
  switch (name) {
    case 'pistol': noise(t, 0.16, { f: 1900, q: 0.8, vol: 0.55 * v }); tone(t, 0.12, { f: 140, f2: 45, vol: 0.5 * v }); break;
    case 'smg': noise(t, 0.08, { f: 2500, q: 0.9, vol: 0.4 * v }); tone(t, 0.07, { f: 180, f2: 60, vol: 0.3 * v }); break;
    case 'shotgun': noise(t, 0.4, { type: 'lowpass', f: 2400, f2: 300, vol: 0.8 * v }); tone(t, 0.25, { f: 110, f2: 35, vol: 0.6 * v }); break;
    case 'punch': tone(t, 0.12, { f: 120, f2: 50, vol: 0.6 * v }); noise(t, 0.06, { type: 'lowpass', f: 900, vol: 0.4 * v }); break;
    case 'swing': noise(t, 0.12, { f: 600, f2: 2400, q: 2, vol: 0.15 * v, attack: 0.04 }); break;
    case 'explosion': noise(t, 1.6, { type: 'lowpass', f: 1600, f2: 80, vol: 1 * v, attack: 0.01 }); tone(t, 1.1, { f: 70, f2: 25, vol: 0.8 * v }); noise(t + 0.05, 0.6, { f: 300, q: 0.5, vol: 0.4 * v }); break;
    case 'crash': noise(t, 0.35, { f: 500, q: 0.7, vol: 0.7 * v }); tone(t, 0.2, { type: 'square', f: 190, f2: 90, vol: 0.12 * v, lp: 1200 }); noise(t + 0.03, 0.2, { type: 'highpass', f: 3500, vol: 0.2 * v }); break;
    case 'thud': tone(t, 0.15, { f: 90, f2: 40, vol: 0.6 * v }); noise(t, 0.1, { type: 'lowpass', f: 500, vol: 0.4 * v }); break;
    case 'horn': tone(t, 0.32, { type: 'square', f: 392, vol: 0.12 * v, lp: 1800 }); tone(t, 0.32, { type: 'square', f: 494, vol: 0.1 * v, lp: 1800 }); break;
    case 'pickup': [660, 880, 1320].forEach((f, i) => tone(t + i * 0.06, 0.18, { type: 'triangle', f, vol: 0.25 })); break;
    case 'cash': tone(t, 0.08, { type: 'triangle', f: 1320, vol: 0.2 }); tone(t + 0.07, 0.2, { type: 'triangle', f: 1760, vol: 0.2 }); break;
    case 'click': case 'tick': tone(t, 0.04, { f: name === 'click' ? 900 : 1400, vol: 0.12 }); break;
    case 'confirm': tone(t, 0.1, { type: 'triangle', f: 660, vol: 0.2 }); tone(t + 0.08, 0.2, { type: 'triangle', f: 990, vol: 0.2 }); break;
    case 'door': noise(t, 0.12, { type: 'lowpass', f: 700, vol: 0.4 * v }); tone(t + 0.08, 0.05, { type: 'square', f: 300, vol: 0.06 * v, lp: 900 }); break;
    case 'star': tone(t, 0.15, { type: 'square', f: 880, vol: 0.08, lp: 2500 }); tone(t + 0.15, 0.2, { type: 'square', f: 660, vol: 0.08, lp: 2500 }); break;
    case 'cleared': [523, 659, 784].forEach((f, i) => tone(t + i * 0.09, 0.3, { type: 'triangle', f, vol: 0.18 })); break;
    case 'passed': {
      const notes = [523, 659, 784, 1047];
      notes.forEach((f, i) => tone(t + i * 0.11, 0.25, { type: 'square', f, vol: 0.09, lp: 3000 }));
      [523, 659, 784, 1047].forEach((f) => tone(t + 0.5, 1.4, { type: 'triangle', f, vol: 0.12 }));
      noise(t + 0.5, 0.6, { type: 'highpass', f: 6000, vol: 0.12 });
      break;
    }
    case 'failed': [392, 330, 262].forEach((f, i) => tone(t + i * 0.2, 0.4, { type: 'square', f, vol: 0.09, lp: 1500 })); break;
    case 'flatline': tone(t, 0.12, { f: 1000, vol: 0.15 }); tone(t + 0.6, 0.12, { f: 1000, vol: 0.15 }); tone(t + 1.2, 2.4, { f: 1000, vol: 0.13 }); break;
    case 'cuffed': for (let i = 0; i < 3; i++) { tone(t + i * 0.09, 0.05, { type: 'square', f: 2200, vol: 0.08, lp: 5000 }); noise(t + i * 0.09, 0.05, { type: 'highpass', f: 3000, vol: 0.2 }); } break;
    case 'alarm': for (let i = 0; i < 8; i++) tone(t + i * 0.3, 0.28, { type: 'square', f: i % 2 ? 700 : 940, vol: 0.07, lp: 2500 }); break;
    case 'save': [784, 988, 1175, 1568].forEach((f, i) => tone(t + i * 0.08, 0.4, { type: 'sine', f, vol: 0.16 })); break;
    case 'spray': noise(t, 1.0, { type: 'highpass', f: 4000, vol: 0.3, attack: 0.1 }); break;
    case 'error': tone(t, 0.2, { type: 'square', f: 120, vol: 0.1, lp: 800 }); break;
    case 'whoosh': noise(t, 0.5, { f: 300, f2: 2500, q: 1.2, vol: 0.15, attack: 0.2 }); break;
    case 'heli': break;
  }
}

// ---------------------------------------------------------------------------
// loops
function loopNoise(type, f, q = 1) {
  const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const filt = ac.createBiquadFilter(); filt.type = type; filt.frequency.value = f; filt.Q.value = q;
  const g = ac.createGain(); g.gain.value = 0;
  src.connect(filt); filt.connect(g); g.connect(sfxBus); src.start();
  return { src, filt, g };
}
function buildLoops() {
  // engine: sawtooth + sub square through a lowpass
  const o1 = ac.createOscillator(); o1.type = 'sawtooth';
  const o2 = ac.createOscillator(); o2.type = 'square';
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 3;
  const g = ac.createGain(); g.gain.value = 0;
  const g2 = ac.createGain(); g2.gain.value = 0.5;
  o1.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(sfxBus);
  o1.start(); o2.start();
  engine = { o1, o2, f, g };
  screech = loopNoise('bandpass', 2300, 6);
  heli = loopNoise('lowpass', 260, 1);
  const lfo = ac.createOscillator(); lfo.frequency.value = 13; const lg = ac.createGain(); lg.gain.value = 0.5;
  lfo.connect(lg); lg.connect(heli.g.gain); lfo.start(); heli.lfo = lg;
  ambience = loopNoise('lowpass', 420, 0.5);
  const so = ac.createOscillator(); so.type = 'triangle';
  const sg = ac.createGain(); sg.gain.value = 0;
  const sf = ac.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 2200;
  so.connect(sf); sf.connect(sg); sg.connect(sfxBus); so.start();
  siren = { o: so, g: sg };
}

export function setEngine() {}

export function updateAudio(dt) {
  if (!ac) return;
  if (ac.state === 'suspended') ac.resume();
  const t = ac.currentTime;
  const pl = G.player;
  const playing = G.mode === 'playing' || G.mode === 'cutscene';
  const v = pl && pl.vehicle && playing ? pl.vehicle : null;
  // engine pitch follows speed (with a fake gearbox)
  if (v) {
    const sp = v.speed, gear = Math.min(4, Math.floor(sp / 110));
    const rpm = 0.25 + (sp - gear * 110) / 140 + gear * 0.08;
    const base = 38 + rpm * 70 + (v.ctl.throttle > 0 ? 8 : 0);
    engine.o1.frequency.setTargetAtTime(base, t, 0.06);
    engine.o2.frequency.setTargetAtTime(base / 2, t, 0.06);
    engine.f.frequency.setTargetAtTime(380 + rpm * 900, t, 0.08);
    engine.g.gain.setTargetAtTime(v.wrecked ? 0 : 0.07 + v.ctl.throttle * 0.05, t, 0.08);
    screech.g.gain.setTargetAtTime(v.skidding * 0.18, t, 0.05);
  } else {
    engine.g.gain.setTargetAtTime(0, t, 0.1);
    screech.g.gain.setTargetAtTime(0, t, 0.05);
  }
  // nearest siren: two-tone, louder when close
  let sd = Infinity;
  if (playing) for (const c of G.vehicles) if (c.siren && c !== (pl && pl.vehicle)) { const d = Math.hypot(c.x - G.cam.x, c.y - G.cam.y); if (d < sd) sd = d; }
  const sv = sd < Infinity ? clamp(1 - sd / 1300, 0, 1) ** 1.5 * 0.09 : 0;
  siren.o.frequency.setTargetAtTime(Math.floor(t * 2) % 2 ? 960 : 720, t, 0.02);
  siren.g.gain.setTargetAtTime(sv, t, 0.1);
  // helicopter
  const hd = G.heli && playing ? Math.hypot(G.heli.x - G.cam.x, G.heli.y - G.cam.y) : Infinity;
  const hv = hd < Infinity ? clamp(1 - hd / 1800, 0, 1) * 0.35 : 0;
  heli.g.gain.setTargetAtTime(hv * 0.5, t, 0.2); heli.lfo.gain.setTargetAtTime(hv * 0.5, t, 0.2);
  // city ambience on foot
  ambience.g.gain.setTargetAtTime(pl && !pl.vehicle && playing ? 0.035 + G.weather.rain * 0.05 : (G.mode === 'title' ? 0.02 : 0), t, 0.5);
  ambience.filt.frequency.setTargetAtTime(400 + G.weather.rain * 2500, t, 0.5);
  // radio audible in cars, on the title screen and in the credits
  const radioOn = (v && STATIONS[station] !== 'Off') || G.mode === 'title' || G.mode === 'credits';
  radioGain.gain.setTargetAtTime(radioOn ? (G.mode === 'title' ? 0.8 : 1) : 0, t, 0.3);
}

// ---------------------------------------------------------------------------
// music: step sequencer + lookahead scheduler
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const SYNTH = { bpm: 104, prog: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]] };        // Am F C G
const LOFI = { bpm: 78, prog: [[50, 53, 57, 60, 64], [55, 59, 62, 65], [48, 52, 55, 59, 62], [57, 60, 64, 67]] }; // Dm9 G7 Cmaj9 Am7

function schedule() {
  if (!ac) return;
  const st = G.mode === 'title' || G.mode === 'credits' ? 0 : station;
  if (STATIONS[st] === 'Off') { seq.next = ac.currentTime + 0.05; return; }
  if (seq.station !== st) { seq.station = st; seq.step = 0; seq.next = ac.currentTime + 0.05; }
  const song = st === 0 ? SYNTH : LOFI;
  const stepDur = 60 / song.bpm / 4;
  if (seq.next < ac.currentTime - 0.2) seq.next = ac.currentTime + 0.02;
  while (seq.next < ac.currentTime + 0.12) {
    if (st === 0) synthStep(seq.step, seq.next, stepDur); else lofiStep(seq.step, seq.next, stepDur);
    seq.next += stepDur * (st === 1 && seq.step % 2 === 0 ? 1.16 : st === 1 ? 0.84 : 1); // lo-fi swing
    seq.step++;
  }
}

function kick(t, v = 0.5) { tone(t, 0.32, { f: 120, f2: 40, vol: v, bus: radioGain }); }
function snare(t, v = 0.25) { noise(t, 0.2, { f: 1800, q: 0.6, vol: v, bus: radioGain }); tone(t, 0.1, { f: 220, f2: 160, vol: v * 0.6, bus: radioGain }); }
function hat(t, v = 0.06, open = false) { noise(t, open ? 0.18 : 0.04, { type: 'highpass', f: 7000, vol: v, bus: radioGain }); }

function synthStep(i, t, sd) {
  const bar = Math.floor(i / 16), s = i % 16;
  const chord = SYNTH.prog[Math.floor(bar / 2) % 4];
  if (s % 4 === 0) kick(t, 0.45);
  if (s === 4 || s === 12) snare(t, 0.22);
  if (s % 2 === 0) hat(t, 0.045, s % 4 === 2);
  // bass: eighths on the root with an octave jump
  if (s % 2 === 0) tone(t, sd * 1.8, { type: 'sawtooth', f: NOTE(chord[0] - 24 + (s % 8 === 6 ? 12 : 0)), vol: 0.13, bus: radioGain, lp: 520 });
  // arpeggio: sixteenths over chord tones
  const arp = [0, 1, 2, 1, 2, 0, 2, 1];
  const n = chord[arp[s % 8]] + 12 + (s >= 8 ? 12 : 0);
  tone(t, sd * 0.9, { type: 'square', f: NOTE(n), vol: 0.035, bus: radioGain, lp: 2600 });
  // pad on each chord change
  if (s === 0 && bar % 2 === 0) for (const c of chord) { tone(t, sd * 30, { type: 'sawtooth', f: NOTE(c), vol: 0.025, attack: 0.6, bus: radioGain, lp: 1400, detune: -7 }); tone(t, sd * 30, { type: 'sawtooth', f: NOTE(c), vol: 0.025, attack: 0.6, bus: radioGain, lp: 1400, detune: 7 }); }
  // lead hook every 4 bars
  if (bar % 4 === 3 && [0, 3, 6, 10].includes(s)) tone(t, sd * 2.5, { type: 'triangle', f: NOTE(chord[[2, 1, 0, 2][[0, 3, 6, 10].indexOf(s)]] + 24), vol: 0.06, bus: radioGain });
}

function lofiStep(i, t, sd) {
  const bar = Math.floor(i / 16), s = i % 16;
  const chord = LOFI.prog[bar % 4];
  if (s === 0 || s === 7 || s === 10) kick(t, 0.4);
  if (s === 4 || s === 12) snare(t, 0.13);
  if (s % 2 === 0) hat(t, s % 4 === 2 ? 0.03 : 0.045);
  if (s === 0 || s === 8) for (const c of chord) tone(t + Math.random() * 0.02, sd * 7, { type: 'triangle', f: NOTE(c), vol: 0.045, attack: 0.02, bus: radioGain, lp: 1600 });
  if (s === 0 || s === 6 || s === 10) tone(t, sd * 3, { type: 'sine', f: NOTE(chord[0] - 24), vol: 0.2, bus: radioGain });
  if (bar % 2 === 1 && (s === 2 || s === 5 || s === 9 || s === 14)) tone(t, sd * 2, { type: 'sine', f: NOTE(chord[(s % 5) % chord.length] + 12), vol: 0.05, bus: radioGain });
  if (s % 4 === 0) noise(t, 0.05, { type: 'highpass', f: 5000, vol: 0.012, bus: radioGain }); // vinyl crackle
}
