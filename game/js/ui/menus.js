// Title screen, pause menu, settings (volumes, mute), controls (rebinding), stats,
// credits roll and confirmation dialogs. Keyboard (arrows/WASD + Enter) and mouse.
import { G } from '../state.js';
import { input, ACTION_LABELS, keyName, saveBindings, resetBindings } from '../input.js';
import { clamp, formatMoney, formatDuration, roundRect, TAU } from '../util.js';
import { UI, uiScale, panel, text, fitText } from './theme.js';
import * as Save from '../save.js';
import { sfx, applyVolumes } from '../audio/audio.js';

let screen = 'title';
let stack = [];
let sel = 0;
let creditsY = 0;
let creditsReturn = 'title';
let hoverIdx = -1;

export function open(name) { screen = name; stack = []; sel = 0; }
function push(name) { stack.push(screen); screen = name; sel = 0; sfx('click'); }
function back() {
  sfx('click');
  if (stack.length) { screen = stack.pop(); sel = 0; return; }
  if (screen === 'pause') { G.mode = 'playing'; }
}
export function current() { return screen; }

export function startCredits(ret = 'playing') {
  creditsY = 0; creditsReturn = ret; G.mode = 'credits'; screen = 'credits'; stack = [];
}

function items() {
  switch (screen) {
    case 'title': {
      const list = [];
      if (Save.hasSave()) list.push({ label: 'Continue', act: () => { sfx('confirm'); G.continueGame(); } });
      list.push({ label: 'New Game', act: () => { if (Save.hasSave()) push('confirmNew'); else { sfx('confirm'); G.newGame(); } } });
      list.push({ label: 'Controls', act: () => push('controls') });
      list.push({ label: 'Settings', act: () => push('settings') });
      list.push({ label: 'Credits', act: () => startCredits('title') });
      return list;
    }
    case 'pause': return [
      { label: 'Resume', act: () => { G.mode = 'playing'; sfx('click'); } },
      { label: 'Map', act: () => { G.mode = 'map'; } },
      { label: 'Stats', act: () => push('stats') },
      { label: 'Controls', act: () => push('controls') },
      { label: 'Settings', act: () => push('settings') },
      { label: 'Quit to Title', act: () => push('confirmQuit') },
    ];
    case 'confirmNew': return [
      { label: 'Yes — start over', act: () => { Save.deleteSave(); sfx('confirm'); G.newGame(); } },
      { label: 'No', act: back },
    ];
    case 'confirmQuit': return [
      { label: 'Quit to Title', act: () => { G.quitToTitle(); } },
      { label: 'Keep playing', act: back },
    ];
    case 'settings': {
      const s = G.settings;
      const slider = (key, label) => ({ label, slider: key, act: () => {}, value: () => s[key] });
      return [
        slider('master', 'Master volume'), slider('music', 'Music volume'), slider('sfx', 'Effects volume'),
        { label: 'Mute', toggle: true, value: () => s.mute, act: () => { s.mute = !s.mute; applyVolumes(); Save.saveSettings(); } },
        { label: 'Back', act: back },
      ];
    }
    case 'controls': {
      const list = Object.keys(ACTION_LABELS).map((k) => ({ label: ACTION_LABELS[k], bind: k, act: () => { input.rebinding = k; } }));
      list.push({ label: 'Reset to defaults', act: () => { resetBindings(); sfx('click'); } });
      list.push({ label: 'Back', act: () => { saveBindings(); back(); } });
      return list;
    }
    case 'stats': return [{ label: 'Back', act: back }];
    default: return [];
  }
}

export function update(dt) {
  if (screen === 'credits') {
    creditsY += dt * 60 * uiScale(G);
    if (input.pressed.has('Escape') || input.pressed.has('Enter') || input.mouse.clicked || creditsY > creditsHeight() + G.H) {
      if (creditsReturn === 'title') { G.mode = 'title'; screen = 'title'; } else { G.mode = 'playing'; }
    }
    return;
  }
  if (input.rebinding) return;
  const list = items();
  if (!list.length) return;
  const up = input.pressed.has('ArrowUp') || input.pressed.has('KeyW');
  const down = input.pressed.has('ArrowDown') || input.pressed.has('KeyS');
  if (up) { sel = (sel - 1 + list.length) % list.length; sfx('tick'); }
  if (down) { sel = (sel + 1) % list.length; sfx('tick'); }
  sel = clamp(sel, 0, list.length - 1);
  const it = list[sel];
  if (it.slider) {
    const l = input.pressed.has('ArrowLeft') || input.pressed.has('KeyA'), r = input.pressed.has('ArrowRight') || input.pressed.has('KeyD');
    if (l || r) { G.settings[it.slider] = clamp(Math.round((G.settings[it.slider] + (r ? 0.1 : -0.1)) * 10) / 10, 0, 1); applyVolumes(); Save.saveSettings(); sfx('tick'); }
  }
  if (input.pressed.has('Enter') || input.pressed.has('Space')) it.act();
  if ((input.pressed.has('Escape') || input.pressed.has('Backspace')) && screen !== 'title') { if (screen === 'controls') saveBindings(); back(); }
  // mouse
  const rects = layout(list);
  hoverIdx = -1;
  rects.forEach((r, i) => {
    if (input.mouse.x > r.x && input.mouse.x < r.x + r.w && input.mouse.y > r.y && input.mouse.y < r.y + r.h) {
      hoverIdx = i;
      if (sel !== i && G.realTime > 0.2) { sel = i; }
      if (input.mouse.clicked) {
        if (list[i].slider) { G.settings[list[i].slider] = clamp((input.mouse.x - r.sx) / r.sw, 0, 1); applyVolumes(); Save.saveSettings(); sfx('tick'); }
        else list[i].act();
      } else if (input.mouse.down && list[i].slider) { G.settings[list[i].slider] = clamp((input.mouse.x - r.sx) / r.sw, 0, 1); applyVolumes(); }
    }
  });
}

function layout(list) {
  const s = uiScale(G);
  const compact = screen === 'controls';
  const h = (compact ? 34 : 50) * s, gap = (compact ? 4 : 10) * s;
  const w = (screen === 'settings' || screen === 'controls' ? 560 : 380) * s;
  const total = list.length * (h + gap);
  const x = screen === 'title' ? 90 * s : (G.W - w) / 2;
  const y0 = screen === 'title' ? G.H * 0.5 : Math.max(120 * s, (G.H - total) / 2 + 30 * s);
  return list.map((it, i) => ({ x, y: y0 + i * (h + gap), w, h, sx: x + w * 0.5, sw: w * 0.45 - 20 * s }));
}

export function draw(ctx) {
  const s = uiScale(G);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (screen === 'credits') { drawCredits(ctx, s); return; }
  if (screen === 'title' || stack[0] === 'title') drawTitleBackdrop(ctx, s);
  else { ctx.fillStyle = 'rgba(5,4,12,0.72)'; ctx.fillRect(0, 0, G.W, G.H); }
  const list = items();
  const rects = layout(list);
  const headings = { pause: 'PAUSED', settings: 'SETTINGS', controls: 'CONTROLS', stats: 'STATS', confirmNew: 'START A NEW GAME?', confirmQuit: 'QUIT TO TITLE?' };
  if (headings[screen]) {
    const y = rects.length ? rects[0].y - 40 * s : G.H * 0.3;
    ctx.save(); ctx.shadowColor = UI.magenta; ctx.shadowBlur = 18;
    text(ctx, headings[screen], G.W / 2, y, 46 * s, '#fff', 'center');
    ctx.restore();
    if (screen === 'confirmNew') text(ctx, 'Your current save will be overwritten.', G.W / 2, y + 30 * s, 18 * s, '#ccc', 'center', UI.body);
    if (screen === 'confirmQuit') text(ctx, 'Progress since your last save will be lost.', G.W / 2, y + 30 * s, 18 * s, '#ccc', 'center', UI.body);
  }
  if (screen === 'stats') drawStats(ctx, s, rects[0]);
  list.forEach((it, i) => {
    const r = rects[i], active = i === sel;
    roundRect(ctx, r.x, r.y, r.w, r.h, 8 * s);
    ctx.fillStyle = active ? 'rgba(47,243,224,0.16)' : 'rgba(10,8,22,0.66)'; ctx.fill();
    if (active) {
      ctx.strokeStyle = UI.teal; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = UI.magenta; ctx.fillRect(r.x, r.y + 6 * s, 4 * s, r.h - 12 * s);
    }
    const size = fitText(ctx, it.label, r.w * (it.slider || it.bind || it.toggle ? 0.5 : 0.9), (screen === 'controls' ? 17 : 24) * s, it.bind ? UI.body : UI.font);
    text(ctx, it.label, r.x + 20 * s, r.y + r.h / 2 + size * 0.36, size, active ? '#fff' : '#bdb6d6', 'left', it.bind ? UI.body : UI.font);
    if (it.slider) {
      const v = it.value();
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; roundRect(ctx, r.sx, r.y + r.h / 2 - 4 * s, r.sw, 8 * s, 4 * s); ctx.fill();
      const g = ctx.createLinearGradient(r.sx, 0, r.sx + r.sw, 0); g.addColorStop(0, UI.teal); g.addColorStop(1, UI.magenta);
      ctx.fillStyle = g; roundRect(ctx, r.sx, r.y + r.h / 2 - 4 * s, Math.max(8 * s, r.sw * v), 8 * s, 4 * s); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(r.sx + r.sw * v, r.y + r.h / 2, 9 * s, 0, TAU); ctx.fill();
      text(ctx, Math.round(v * 100) + '%', r.x + r.w - 14 * s, r.y + r.h / 2 + 7 * s, 18 * s, '#fff', 'right');
    }
    if (it.toggle) text(ctx, it.value() ? 'ON' : 'OFF', r.x + r.w - 20 * s, r.y + r.h / 2 + 8 * s, 22 * s, it.value() ? UI.magenta : '#888', 'right');
    if (it.bind) {
      const k = input.rebinding === it.bind ? 'press a key…' : input.bindings[it.bind].slice(0, 2).map(keyName).join(' / ');
      text(ctx, k, r.x + r.w - 16 * s, r.y + r.h / 2 + 6 * s, 16 * s, input.rebinding === it.bind ? UI.gold : UI.teal, 'right', UI.body);
    }
  });
  if (screen === 'controls') {
    const r = rects[rects.length - 1];
    text(ctx, 'Mouse: aim · Left click: attack / shoot (also drive-by) · Wheel: switch weapon', G.W / 2, r.y + r.h + 30 * s, 15 * s, '#aaa', 'center', UI.body);
    text(ctx, 'Click an action, then press the new key', G.W / 2, r.y + r.h + 52 * s, 15 * s, '#aaa', 'center', UI.body);
  }
  // cursor
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(input.mouse.x, input.mouse.y); ctx.lineTo(input.mouse.x + 14, input.mouse.y + 10); ctx.lineTo(input.mouse.x + 6, input.mouse.y + 12); ctx.lineTo(input.mouse.x + 3, input.mouse.y + 19); ctx.closePath(); ctx.fill(); ctx.stroke();
}

/** Neon logo over the live dusk city. */
function drawTitleBackdrop(ctx, s) {
  const g = ctx.createLinearGradient(0, 0, G.W * 0.7, 0);
  g.addColorStop(0, 'rgba(8,4,20,0.82)'); g.addColorStop(0.55, 'rgba(8,4,20,0.35)'); g.addColorStop(1, 'rgba(8,4,20,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, G.W, G.H);
  const tg = ctx.createLinearGradient(0, 0, 0, G.H * 0.25);
  tg.addColorStop(0, 'rgba(255,100,60,0.25)'); tg.addColorStop(1, 'rgba(255,100,60,0)');
  ctx.fillStyle = tg; ctx.fillRect(0, 0, G.W, G.H * 0.25);
  if (screen !== 'title') { ctx.fillStyle = 'rgba(5,4,12,0.55)'; ctx.fillRect(0, 0, G.W, G.H); return; }
  const x = 86 * s, y = G.H * 0.3;
  const size = Math.min(150 * s, G.W * 0.11);
  ctx.save();
  ctx.font = `${size}px ${UI.font}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const w = ctx.measureText('SELARA BAY').width;
  const lg = ctx.createLinearGradient(x, y - size, x + w, y);
  lg.addColorStop(0, '#2ff3e0'); lg.addColorStop(0.5, '#8f7bff'); lg.addColorStop(1, '#ff3fa4');
  const flicker = 0.85 + 0.15 * Math.sin(G.realTime * 7) * Math.sin(G.realTime * 2.3);
  ctx.shadowColor = '#ff3fa4'; ctx.shadowBlur = 40 * s * flicker;
  ctx.lineWidth = 6 * s; ctx.strokeStyle = 'rgba(20,0,40,0.9)'; ctx.strokeText('SELARA BAY', x, y);
  ctx.fillStyle = lg; ctx.fillText('SELARA BAY', x, y);
  ctx.shadowColor = '#2ff3e0'; ctx.shadowBlur = 16 * s;
  ctx.lineWidth = 2 * s; ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.strokeText('SELARA BAY', x, y);
  ctx.restore();
  // tagline with neon underline
  text(ctx, 'HEAT ON THE COAST', x + 6 * s, y + 52 * s, 30 * s, '#ffd6ec', 'left');
  const ug = ctx.createLinearGradient(x, 0, x + w, 0); ug.addColorStop(0, UI.teal); ug.addColorStop(1, UI.magenta);
  ctx.fillStyle = ug; ctx.fillRect(x + 6 * s, y + 68 * s, w * 0.62, 4 * s);
  text(ctx, 'v1.0 · Mouse + keyboard · Offline', G.W - 24 * s, G.H - 22 * s, 14 * s, 'rgba(255,255,255,0.55)', 'right', UI.body, false);
}

function statsRows() {
  const st = G.stats;
  return [
    ['Missions completed', `${st.missions} / 6`], ['Orchid tags', `${G.progress.tags.length} / 12`], ['Kills', String(st.kills)],
    ['Cars stolen', String(st.carsStolen)], ['Time played', formatDuration(st.played)], ['Money', formatMoney(G.money)],
    ['Total earned', formatMoney(st.earned)], ['Times flatlined', String(st.deaths)], ['Times cuffed', String(st.arrests)], ['Shots fired', String(st.shots)],
  ];
}

function drawStats(ctx, s, backRect) {
  const rows = statsRows();
  const w = 560 * s, h = rows.length * 36 * s + 30 * s;
  const x = (G.W - w) / 2, y = backRect.y - h - 20 * s;
  panel(ctx, x, y, w, h, 12 * s);
  rows.forEach(([k, v], i) => {
    const yy = y + 40 * s + i * 36 * s;
    text(ctx, k, x + 24 * s, yy, 19 * s, '#cfc8e8', 'left', UI.body, false);
    text(ctx, v, x + w - 24 * s, yy, 20 * s, '#fff', 'right');
  });
}

function creditLines() {
  const st = G.stats;
  return [
    ['h', 'SELARA BAY'], ['s', 'Heat on the Coast'], ['g', ''],
    ['t', 'A story of Kai Santoso'], ['g', ''],
    ['h2', 'CAST'], ['p', 'Kai Santoso — the one who came back'], ['p', 'Mama Lin — keeper of the garage'], ['p', 'Dex — fingers on every keyboard'], ['p', 'Viktor Raza — the Black Orchid'], ['g', ''],
    ['h2', 'MADE WITH'], ['p', 'Canvas 2D · Web Audio · plain JavaScript'], ['p', 'Every pixel and note generated in code'], ['g', ''],
    ['h2', 'YOUR RUN'], ['p', `Missions: ${st.missions} / 6`], ['p', `Orchid tags: ${G.progress.tags.length} / 12`], ['p', `Kills: ${st.kills}`], ['p', `Cars stolen: ${st.carsStolen}`],
    ['p', `Time played: ${formatDuration(st.played)}`], ['p', `Money: ${formatMoney(G.money)}`], ['g', ''],
    ['h2', 'CODE & DESIGN'], ['p', 'I Wayan Bagus Somabawa'], ['g', ''], ['s', 'Thanks for playing.'], ['p', 'The coast is yours.'],
  ];
}
function creditsHeight() { return creditLines().length * 44 * uiScale(G); }

function drawCredits(ctx, s) {
  ctx.fillStyle = 'rgba(4,3,10,0.82)'; ctx.fillRect(0, 0, G.W, G.H);
  let y = G.H - creditsY;
  for (const [type, str] of creditLines()) {
    if (y > -60 && y < G.H + 60) {
      if (type === 'h') { ctx.save(); ctx.shadowColor = UI.magenta; ctx.shadowBlur = 24; text(ctx, str, G.W / 2, y, 72 * s, UI.teal, 'center'); ctx.restore(); }
      else if (type === 'h2') text(ctx, str, G.W / 2, y, 26 * s, UI.magenta, 'center');
      else if (type === 's') text(ctx, str, G.W / 2, y, 26 * s, '#ffd6ec', 'center');
      else if (type === 't') text(ctx, str, G.W / 2, y, 22 * s, '#fff', 'center', UI.body);
      else if (type === 'p') text(ctx, str, G.W / 2, y, 21 * s, '#ddd', 'center', UI.body, false);
    }
    y += 44 * s;
  }
  text(ctx, 'Click or press Enter to skip', G.W - 24 * s, G.H - 20 * s, 14 * s, '#888', 'right', UI.body, false);
}
