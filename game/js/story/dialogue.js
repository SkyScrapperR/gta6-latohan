// Cutscenes (letterbox bars, camera focus, speaker portraits, coloured subtitles)
// and in-game radio/phone subtitles.
import { G } from '../state.js';
import { input } from '../input.js';
import { clamp, lerp, TAU, roundRect } from '../util.js';
import { UI, uiScale, text, wrap, panel } from '../ui/theme.js';
import { sfx } from '../audio/audio.js';

export const SPEAKERS = {
  kai: { name: 'KAI', color: '#2ff3e0' },
  lin: { name: 'MAMA LIN', color: '#ffb347' },
  dex: { name: 'DEX', color: '#9dff4d' },
  viktor: { name: 'VIKTOR RAZA', color: '#c45cff' },
  rendy: { name: 'RENDY', color: '#ffe14d' },
  goon: { name: 'ORCHID ENFORCER', color: '#d68cff' },
  radio: { name: 'POLICE RADIO', color: '#6aa8ff' },
};

let cs = null;     // active cutscene
let subs = null;   // in-game subtitles queue

export function playCutscene(lines, opts = {}) {
  cs = { lines, i: 0, t: 0, bars: 0, camX: opts.x ?? G.cam.x, camY: opts.y ?? G.cam.y, zoom: opts.zoom || 1.15, onDone: opts.onDone, done: false };
  G.mode = 'cutscene';
  if (G.player) G.player.controlsLocked = true;
  sfx('whoosh');
}
export function cutsceneActive() { return !!cs; }
export function cancelCutscene() {
  if (!cs) return;
  cs = null; subs = null;
  if (G.mode === 'cutscene') G.mode = 'playing';
  if (G.player) G.player.controlsLocked = false;
}

/** Subtitles during gameplay (phone / radio chatter), no letterbox. */
export function say(lines) { subs = { lines: Array.isArray(lines) ? lines : [lines], i: 0, t: 0 }; }

function lineDur(l) { return Math.max(2.6, l.text.length * 0.058); }

export function update(dt) {
  if (!cs) { if (G.mode === 'cutscene') G.mode = 'playing'; return; }
  cs.t += dt;
  cs.bars = Math.min(1, cs.bars + dt * 2.5);
  const skip = input.pressed.has('Space') || input.pressed.has('Enter') || input.mouse.clicked;
  const l = cs.lines[cs.i];
  if ((skip && cs.t > 0.25) || cs.t > lineDur(l)) {
    cs.i++; cs.t = 0;
    if (cs.i >= cs.lines.length) finish();
    else sfx('tick');
  }
}

function finish() {
  const done = cs.onDone;
  cs = null;
  G.mode = 'playing';
  if (G.player) G.player.controlsLocked = false;
  if (done) done();
}

export function updateCamera(dt) {
  if (!cs) return;
  const c = G.cam;
  const k = 1 - Math.exp(-dt * 2.2);
  c.x = lerp(c.x, cs.camX, k); c.y = lerp(c.y, cs.camY, k);
  c.zoom = lerp(c.zoom, (G.H / 1080) * 1.55 * cs.zoom, k);
  c.sx = c.sy = 0;
}

export function tickSubs(dt) {
  if (!subs) return;
  subs.t += dt;
  if (subs.t > lineDur(subs.lines[subs.i])) { subs.i++; subs.t = 0; if (subs.i >= subs.lines.length) subs = null; }
}

export function draw(ctx) {
  const s = uiScale(G);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (cs) drawCutscene(ctx, s);
  else if (subs && G.mode === 'playing') {
    const l = subs.lines[subs.i];
    drawSubtitle(ctx, s, l, G.H - 110 * s, false);
  }
}

function drawCutscene(ctx, s) {
  const bh = G.H * 0.13 * cs.bars;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, G.W, bh); ctx.fillRect(0, G.H - bh, G.W, bh);
  const l = cs.lines[cs.i];
  if (!l) return;
  const sp = SPEAKERS[l.who] || SPEAKERS.kai;
  // portrait card
  const ps = 170 * s, px = 60 * s, py = G.H - bh - ps * 0.72;
  ctx.save();
  roundRect(ctx, px, py, ps, ps, 16 * s);
  ctx.fillStyle = '#0c0a18'; ctx.fill();
  ctx.clip();
  drawPortrait(ctx, l.who, px, py, ps, cs.t);
  ctx.restore();
  roundRect(ctx, px, py, ps, ps, 16 * s); ctx.strokeStyle = sp.color; ctx.lineWidth = 3 * s; ctx.stroke();
  drawSubtitle(ctx, s, l, G.H - bh * 0.5, true, px + ps + 30 * s);
  text(ctx, 'SPACE / CLICK ›', G.W - 40 * s, G.H - 18 * s, 13 * s, 'rgba(255,255,255,0.5)', 'right', UI.body, false);
}

function drawSubtitle(ctx, s, l, y, inCut, x0 = null) {
  const sp = SPEAKERS[l.who] || SPEAKERS.kai;
  const size = 24 * s;
  const maxW = inCut ? G.W - (x0 || 0) - 120 * s : G.W * 0.6;
  const lines = wrap(ctx, l.text, maxW, size, UI.body);
  const total = lines.length * size * 1.3;
  const align = inCut ? 'left' : 'center';
  const x = inCut ? x0 : G.W / 2;
  const top = y - total / 2 - size * 0.5;
  text(ctx, sp.name, x, top, 17 * s, sp.color, align);
  lines.forEach((ln, i) => text(ctx, ln, x, top + size * 1.25 + i * size * 1.3, size, '#fff', align, UI.body));
}

// ---------------------------------------------------------------------------
// Procedural portraits
const LOOKS = {
  kai: { bg: ['#0b5e66', '#05181f'], skin: '#c98c62', hair: '#1a1412', hairStyle: 'short', shirt: '#1fb5a8', jacket: '#1c2430', eyes: '#2a1a10', stubble: true },
  lin: { bg: ['#6b3a12', '#1e0f05'], skin: '#e0b48c', hair: '#cfd0d6', hairStyle: 'bun', shirt: '#f08c28', glasses: true, eyes: '#3a2a20' },
  dex: { bg: ['#2f5e12', '#0b1805'], skin: '#a8714e', hair: '#1c1a18', hairStyle: 'hood', shirt: '#8cd23c', headphones: true, eyes: '#20140c' },
  viktor: { bg: ['#4a1a6e', '#12051e'], skin: '#d9a982', hair: '#4a4a50', hairStyle: 'slick', shirt: '#f0eef6', tie: '#9b30e0', scar: true, eyes: '#101010' },
  rendy: { bg: ['#6e6212', '#1e1a05'], skin: '#d7a47c', hair: '#2a1d14', hairStyle: 'spiky', shirt: '#ffe14d', shades: true, eyes: '#000' },
  goon: { bg: ['#3e1458', '#10061a'], skin: '#b07850', hair: '#111', hairStyle: 'bald', shirt: '#7a2aa8', bandana: true, eyes: '#000' },
  radio: { bg: ['#14306e', '#050c1e'], radio: true },
};

export function drawPortrait(ctx, who, x, y, size, t) {
  const L = LOOKS[who] || LOOKS.kai;
  const k = size / 100;
  const g = ctx.createLinearGradient(x, y, x, y + size);
  g.addColorStop(0, L.bg[0]); g.addColorStop(1, L.bg[1]);
  ctx.fillStyle = g; ctx.fillRect(x, y, size, size);
  // halftone stripes
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  for (let i = 0; i < 10; i++) ctx.fillRect(x, y + i * 10 * k, size, 4 * k);
  ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
  if (L.radio) {
    ctx.fillStyle = '#1c2236'; roundRect(ctx, 30, 22, 40, 64, 6); ctx.fill();
    ctx.fillStyle = '#8fb3ff'; ctx.fillRect(36, 30, 28, 18);
    ctx.fillStyle = '#333'; ctx.fillRect(56, 6, 4, 18);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = '#556'; ctx.beginPath(); ctx.arc(40 + (i % 2) * 20, 60 + Math.floor(i / 2) * 14, 4, 0, TAU); ctx.fill(); }
    const pulse = (Math.sin(t * 10) + 1) / 2;
    ctx.strokeStyle = `rgba(140,180,255,${pulse})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(50, 39, 20, -0.6, 0.6); ctx.stroke();
    ctx.restore(); return;
  }
  const talk = Math.abs(Math.sin(t * 14)) * (t < 30 ? 1 : 0);
  // shoulders
  ctx.fillStyle = L.jacket || L.shirt;
  ctx.beginPath(); ctx.ellipse(50, 108, 46, 32, 0, Math.PI, TAU); ctx.fill();
  if (L.jacket) { ctx.fillStyle = L.shirt; ctx.beginPath(); ctx.moveTo(40, 80); ctx.lineTo(50, 100); ctx.lineTo(60, 80); ctx.closePath(); ctx.fill(); }
  if (L.tie) { ctx.fillStyle = L.tie; ctx.beginPath(); ctx.moveTo(47, 80); ctx.lineTo(53, 80); ctx.lineTo(55, 100); ctx.lineTo(50, 104); ctx.lineTo(45, 100); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#e8e6ee'; ctx.beginPath(); ctx.moveTo(38, 78); ctx.lineTo(47, 80); ctx.lineTo(44, 92); ctx.closePath(); ctx.moveTo(62, 78); ctx.lineTo(53, 80); ctx.lineTo(56, 92); ctx.closePath(); ctx.fill(); }
  if (L.hairStyle === 'hood') { ctx.fillStyle = L.shirt; ctx.beginPath(); ctx.ellipse(50, 50, 32, 38, 0, 0, TAU); ctx.fill(); }
  // neck + head
  ctx.fillStyle = L.skin; ctx.fillRect(43, 66, 14, 16);
  ctx.beginPath(); ctx.ellipse(50, 50, 22, 27, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.ellipse(57, 54, 14, 22, 0, -1.2, 1.4); ctx.fill();
  // ears
  ctx.fillStyle = L.skin; ctx.beginPath(); ctx.ellipse(28, 52, 4, 7, 0, 0, TAU); ctx.ellipse(72, 52, 4, 7, 0, 0, TAU); ctx.fill();
  // hair
  ctx.fillStyle = L.hair;
  switch (L.hairStyle) {
    case 'short': ctx.beginPath(); ctx.ellipse(50, 32, 24, 13, 0, Math.PI, TAU); ctx.fill(); ctx.fillRect(26, 30, 6, 16); ctx.fillRect(68, 30, 6, 14); ctx.beginPath(); ctx.moveTo(30, 30); ctx.lineTo(56, 22); ctx.lineTo(60, 33); ctx.closePath(); ctx.fill(); break;
    case 'bun': ctx.beginPath(); ctx.ellipse(50, 33, 25, 15, 0, Math.PI, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(50, 14, 9, 0, TAU); ctx.fill(); break;
    case 'slick': ctx.beginPath(); ctx.ellipse(50, 30, 24, 12, -0.1, Math.PI, TAU); ctx.fill(); ctx.strokeStyle = '#6a6a72'; ctx.lineWidth = 1; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(32 + i * 8, 26); ctx.lineTo(60 + i * 3, 20); ctx.stroke(); } break;
    case 'spiky': ctx.beginPath(); for (let i = 0; i < 7; i++) { ctx.lineTo(28 + i * 7.5, i % 2 ? 22 : 12); } ctx.lineTo(74, 34); ctx.lineTo(26, 34); ctx.closePath(); ctx.fill(); break;
    case 'hood': ctx.beginPath(); ctx.ellipse(50, 30, 22, 9, 0, Math.PI, TAU); ctx.fill(); break;
    case 'bald': ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.ellipse(44, 32, 8, 4, -0.4, 0, TAU); ctx.fill(); break;
  }
  if (L.bandana) { ctx.fillStyle = '#c45cff'; ctx.fillRect(27, 34, 46, 7); ctx.beginPath(); ctx.moveTo(72, 36); ctx.lineTo(82, 30); ctx.lineTo(80, 42); ctx.closePath(); ctx.fill(); }
  // eyes / brows
  const blink = Math.sin(t * 2.3) > 0.97 ? 0.2 : 1;
  if (L.shades) { ctx.fillStyle = '#111'; roundRect(ctx, 31, 43, 16, 8, 3); ctx.fill(); roundRect(ctx, 53, 43, 16, 8, 3); ctx.fill(); ctx.fillRect(46, 45, 8, 2); }
  else {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(40, 47, 5, 3.4 * blink, 0, 0, TAU); ctx.ellipse(60, 47, 5, 3.4 * blink, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = L.eyes; ctx.beginPath(); ctx.arc(41, 47, 2.3 * blink, 0, TAU); ctx.arc(61, 47, 2.3 * blink, 0, TAU); ctx.fill();
  }
  ctx.strokeStyle = L.hair === '#cfd0d6' ? '#9a9aa2' : '#1a1210'; ctx.lineWidth = 2.4;
  const angry = who === 'viktor' || who === 'goon';
  ctx.beginPath(); ctx.moveTo(34, angry ? 39 : 40); ctx.lineTo(46, angry ? 42 : 39); ctx.moveTo(54, angry ? 42 : 39); ctx.lineTo(66, angry ? 39 : 40); ctx.stroke();
  if (L.glasses) { ctx.strokeStyle = '#d8b04a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(40, 47, 7, 0, TAU); ctx.moveTo(67, 47); ctx.arc(60, 47, 7, 0, TAU); ctx.moveTo(47, 47); ctx.lineTo(53, 47); ctx.stroke(); }
  // nose + mouth
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(50, 50); ctx.lineTo(48, 58); ctx.lineTo(51, 59); ctx.stroke();
  ctx.fillStyle = '#5a2a22'; ctx.beginPath(); ctx.ellipse(50, 66, 7, 1.5 + talk * 3, 0, 0, TAU); ctx.fill();
  if (L.stubble) { ctx.fillStyle = 'rgba(30,20,15,0.25)'; ctx.beginPath(); ctx.ellipse(50, 66, 15, 10, 0, 0, Math.PI); ctx.fill(); }
  if (L.scar) { ctx.strokeStyle = '#9a5a4a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(62, 38); ctx.lineTo(66, 56); ctx.stroke(); }
  if (L.headphones) { ctx.strokeStyle = '#222'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(50, 46, 26, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); ctx.fillStyle = '#222'; roundRect(ctx, 21, 44, 9, 16, 3); ctx.fill(); roundRect(ctx, 70, 44, 9, 16, 3); ctx.fill(); ctx.fillStyle = '#9dff4d'; ctx.fillRect(23, 50, 5, 4); ctx.fillRect(72, 50, 5, 4); }
  ctx.restore();
}
