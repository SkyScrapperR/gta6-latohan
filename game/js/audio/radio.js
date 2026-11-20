// In-car radio: a step sequencer with a lookahead scheduler driving three original stations —
// "Selara Nights FM" (synthwave), "Ombak Lo-Fi" (mellow beats) and "Gamelan Wave"
// (metallic bell tones over a beat) — plus Off.
const STATIONS = ['Selara Nights FM', 'Ombak Lo-Fi', 'Gamelan Wave', 'Off'];
let ac = null, out = null, gain = null, noiseBuf = null, station = 0;
const seq = { step: 0, next: 0, station: -1 };
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const SYNTH = { bpm: 104, prog: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]] };
const LOFI = { bpm: 78, prog: [[50, 53, 57, 60, 64], [55, 59, 62, 65], [48, 52, 55, 59, 62], [57, 60, 64, 67]] };
const GAMELAN = { bpm: 96, scale: [62, 63, 65, 69, 70, 74, 75, 77, 81] }; // pelog-flavoured

export function createRadio(ctx, bus, noise) {
  ac = ctx; noiseBuf = noise;
  gain = ac.createGain(); gain.gain.value = 0; gain.connect(bus); out = gain;
  seq.next = ac.currentTime + 0.1;
  setInterval(schedule, 25);
}
export function cycleStation() { station = (station + 1) % STATIONS.length; seq.step = 0; return STATIONS[station]; }
export function stationName() { return STATIONS[station]; }
let audible = false, titleMode = false;
export function updateRadio(t, on) {
  audible = on;
  titleMode = !!(window.__G && (window.__G.mode === 'title' || window.__G.mode === 'credits'));
  if (gain) gain.gain.setTargetAtTime(on ? 1 : 0, t, 0.3);
}

function tone(t, dur, { type = 'sine', f = 440, f2 = null, vol = 0.3, attack = 0.005, lp = null, detune = 0 } = {}) {
  const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let n = o; if (lp) { const f_ = ac.createBiquadFilter(); f_.type = 'lowpass'; f_.frequency.value = lp; o.connect(f_); n = f_; }
  n.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
}
function noise(t, dur, { type = 'bandpass', f = 1000, q = 1, vol = 0.3 } = {}) {
  const s = ac.createBufferSource(); s.buffer = noiseBuf;
  const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
const kick = (t, v = 0.5) => tone(t, 0.32, { f: 120, f2: 40, vol: v });
const snare = (t, v = 0.25) => { noise(t, 0.2, { f: 1800, q: 0.6, vol: v }); tone(t, 0.1, { f: 220, f2: 160, vol: v * 0.6 }); };
const hat = (t, v = 0.06, open = false) => noise(t, open ? 0.18 : 0.04, { type: 'highpass', f: 7000, vol: v });
/** Metallic bell: inharmonic partials (gamelan-like). */
function bell(t, f, vol = 0.08, dur = 1.6) { for (const [r, a] of [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.12]]) tone(t, dur / r * 1.5, { f: f * r, vol: vol * a, attack: 0.002 }); }

function schedule() {
  if (!ac || (!audible && !titleMode)) { if (ac) seq.next = ac.currentTime + 0.05; return; }
  const st = titleMode ? 0 : station;
  if (STATIONS[st] === 'Off') { seq.next = ac.currentTime + 0.05; return; }
  if (seq.station !== st) { seq.station = st; seq.step = 0; seq.next = ac.currentTime + 0.05; }
  const bpm = st === 0 ? SYNTH.bpm : st === 1 ? LOFI.bpm : GAMELAN.bpm, sd = 60 / bpm / 4;
  if (seq.next < ac.currentTime - 0.2) seq.next = ac.currentTime + 0.02;
  while (seq.next < ac.currentTime + 0.12) {
    if (st === 0) synthStep(seq.step, seq.next, sd); else if (st === 1) lofiStep(seq.step, seq.next, sd); else gamelanStep(seq.step, seq.next, sd);
    seq.next += sd * (st === 1 ? (seq.step % 2 === 0 ? 1.16 : 0.84) : 1);
    seq.step++;
  }
}
function synthStep(i, t, sd) {
  const bar = Math.floor(i / 16), s = i % 16, chord = SYNTH.prog[Math.floor(bar / 2) % 4];
  if (s % 4 === 0) kick(t, 0.45);
  if (s === 4 || s === 12) snare(t, 0.22);
  if (s % 2 === 0) hat(t, 0.045, s % 4 === 2);
  if (s % 2 === 0) tone(t, sd * 1.8, { type: 'sawtooth', f: NOTE(chord[0] - 24 + (s % 8 === 6 ? 12 : 0)), vol: 0.13, lp: 520 });
  const arp = [0, 1, 2, 1, 2, 0, 2, 1];
  tone(t, sd * 0.9, { type: 'square', f: NOTE(chord[arp[s % 8]] + 12 + (s >= 8 ? 12 : 0)), vol: 0.035, lp: 2600 });
  if (s === 0 && bar % 2 === 0) for (const c of chord) { tone(t, sd * 30, { type: 'sawtooth', f: NOTE(c), vol: 0.025, attack: 0.6, lp: 1400, detune: -7 }); tone(t, sd * 30, { type: 'sawtooth', f: NOTE(c), vol: 0.025, attack: 0.6, lp: 1400, detune: 7 }); }
  if (bar % 4 === 3 && [0, 3, 6, 10].includes(s)) tone(t, sd * 2.5, { type: 'triangle', f: NOTE(chord[[2, 1, 0, 2][[0, 3, 6, 10].indexOf(s)]] + 24), vol: 0.06 });
}
function lofiStep(i, t, sd) {
  const bar = Math.floor(i / 16), s = i % 16, chord = LOFI.prog[bar % 4];
  if (s === 0 || s === 7 || s === 10) kick(t, 0.4);
  if (s === 4 || s === 12) snare(t, 0.13);
  if (s % 2 === 0) hat(t, s % 4 === 2 ? 0.03 : 0.045);
  if (s === 0 || s === 8) for (const c of chord) tone(t + Math.random() * 0.02, sd * 7, { type: 'triangle', f: NOTE(c), vol: 0.045, attack: 0.02, lp: 1600 });
  if (s === 0 || s === 6 || s === 10) tone(t, sd * 3, { f: NOTE(chord[0] - 24), vol: 0.2 });
  if (bar % 2 === 1 && [2, 5, 9, 14].includes(s)) tone(t, sd * 2, { f: NOTE(chord[(s % 5) % chord.length] + 12), vol: 0.05 });
  if (s % 4 === 0) noise(t, 0.05, { type: 'highpass', f: 5000, vol: 0.012 });
}
function gamelanStep(i, t, sd) {
  const bar = Math.floor(i / 16), s = i % 16, sc = GAMELAN.scale;
  if (s % 4 === 0) kick(t, 0.38);
  if (s === 6 || s === 14) snare(t, 0.12);
  if (s % 2 === 1) hat(t, 0.03);
  // interlocking bell figures (kotekan-style)
  const fig = [0, 2, 4, 2, 5, 4, 2, 1, 0, 3, 4, 6, 5, 3, 2, 1];
  if (s % 2 === 0) bell(t, NOTE(sc[fig[s]] + (bar % 4 === 3 ? 5 : 0)), 0.05, 1.2);
  else bell(t, NOTE(sc[(fig[s] + 2) % sc.length] + 12), 0.025, 0.8);
  // gong every 4 bars
  if (s === 0 && bar % 4 === 0) { tone(t, 4, { f: NOTE(38), vol: 0.22, attack: 0.02 }); tone(t, 4, { f: NOTE(38) * 1.5, vol: 0.06, attack: 0.02 }); }
  if (s === 0 || s === 8) tone(t, sd * 6, { type: 'triangle', f: NOTE(sc[bar % 3] - 24), vol: 0.14 });
}
