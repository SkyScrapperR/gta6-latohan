// Day/night cycle, sun direction for shadows, the multiplicative light map
// (headlights, streetlights, sirens, fire, helicopter spotlight), glow sprites and rain.
import { G } from '../state.js';
import { clamp, lerp, hash, TAU, rgb } from '../util.js';

// ambient light keyframes: [hour, r, g, b]
const KEYS = [
  [0, 0.2, 0.24, 0.44], [4.5, 0.22, 0.25, 0.46], [5.8, 0.55, 0.45, 0.58], [7, 0.9, 0.85, 0.82],
  [9, 1, 0.99, 0.96], [15.5, 1, 0.98, 0.93], [17.2, 1, 0.82, 0.62], [18.2, 0.98, 0.64, 0.46],
  [19.1, 0.55, 0.38, 0.56], [20.2, 0.26, 0.28, 0.5], [24, 0.2, 0.24, 0.44],
];

G.light = { amb: [1, 1, 1], night: 0, sunset: 0, sunX: -1, sunY: -0.3, shadowLen: 0.5, shadowAlpha: 0.3 };
const lights = [];
const glows = [];
let lightCanvas = null, lctx = null;
let rainDrops = [];

export function updateTimeOfDay() {
  const h = (G.clock / 60) % 24;
  let k = 0;
  while (k < KEYS.length - 2 && KEYS[k + 1][0] <= h) k++;
  const a = KEYS[k], b = KEYS[k + 1];
  const t = clamp((h - a[0]) / (b[0] - a[0]), 0, 1);
  const L = G.light;
  const rain = G.weather.rain;
  L.amb = [lerp(a[1], b[1], t) * (1 - rain * 0.22), lerp(a[2], b[2], t) * (1 - rain * 0.18), lerp(a[3], b[3], t) * (1 - rain * 0.08)];
  const lum = (L.amb[0] + L.amb[1] + L.amb[2]) / 3;
  L.night = clamp((0.78 - lum) / 0.42, 0, 1);
  L.sunset = clamp(1 - Math.abs(h - 18) / 1.4, 0, 1);
  // sun travels east -> west between 06:00 and 19:00; shadows fall away from it
  const p = clamp((h - 6) / 13, 0, 1);
  L.sunX = -Math.cos(p * Math.PI);
  L.sunY = -0.38;
  L.shadowLen = clamp(0.22 + 1.5 * Math.pow(1 - Math.sin(p * Math.PI), 1.6), 0.22, 1.5);
  const day = h > 6 && h < 19.3 ? Math.sin(p * Math.PI) ** 0.3 : 0;
  L.shadowAlpha = 0.34 * day * (1 - rain * 0.6) + 0.1 * (1 - day) * (h > 5 && h < 20 ? 1 : 0);
}

/** Register a light for this frame. kind: 'point' | 'cone'. */
export function addLight(x, y, r, color, intensity = 1, kind = 'point', angle = 0, spread = 0.5) {
  lights.push({ x, y, r, color, intensity, kind, angle, spread });
}
/** Additive bright sprite drawn over the world (bulbs, lightbars, flashes). */
export function addGlow(x, y, r, color, alpha = 1) { glows.push({ x, y, r, color, alpha }); }

export function needsLightmap() {
  const a = G.light.amb;
  return a[0] < 0.985 || a[1] < 0.985 || a[2] < 0.985 || lights.some((l) => l.always);
}

/** Composite the light map onto the main canvas (call with identity transform). */
export function renderLightmap(ctx, view) {
  const L = G.light;
  const scale = 0.5;
  const w = Math.ceil(G.W * scale), h = Math.ceil(G.H * scale);
  if (!lightCanvas || lightCanvas.width !== w || lightCanvas.height !== h) {
    lightCanvas = document.createElement('canvas'); lightCanvas.width = w; lightCanvas.height = h;
    lctx = lightCanvas.getContext('2d');
  }
  if (!needsLightmap()) { lights.length = 0; return; }
  lctx.globalCompositeOperation = 'source-over';
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.fillStyle = rgb(L.amb[0] * 255, L.amb[1] * 255, L.amb[2] * 255);
  lctx.fillRect(0, 0, w, h);
  lctx.globalCompositeOperation = 'lighter';
  const z = G.cam.zoom * scale;
  lctx.setTransform(z, 0, 0, z, w / 2 - (G.cam.x + G.cam.sx) * z, h / 2 - (G.cam.y + G.cam.sy) * z);
  const nightK = 0.25 + 0.75 * L.night;
  for (const l of lights) {
    if (l.x + l.r < view.x0 || l.x - l.r > view.x1 || l.y + l.r < view.y0 || l.y - l.r > view.y1) continue;
    const I = clamp(l.intensity * (l.forced ? 1 : nightK), 0, 1);
    if (I < 0.02) continue;
    const g = lctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
    g.addColorStop(0, `rgba(${l.color},${I})`);
    g.addColorStop(0.45, `rgba(${l.color},${I * 0.45})`);
    g.addColorStop(1, `rgba(${l.color},0)`);
    lctx.fillStyle = g;
    lctx.beginPath();
    if (l.kind === 'cone') {
      lctx.moveTo(l.x, l.y);
      lctx.arc(l.x, l.y, l.r, l.angle - l.spread, l.angle + l.spread);
      lctx.closePath();
    } else lctx.arc(l.x, l.y, l.r, 0, TAU);
    lctx.fill();
  }
  lights.length = 0;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(lightCanvas, 0, 0, G.W, G.H);
  ctx.restore();
}

/** Additive glow sprites (world transform active). */
export function renderGlows(ctx) {
  if (!glows.length) return;
  const k = 0.35 + 0.65 * G.light.night;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const g of glows) {
    const a = g.alpha * k;
    if (a < 0.03) continue;
    const gr = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r);
    gr.addColorStop(0, `rgba(${g.color},${a})`);
    gr.addColorStop(1, `rgba(${g.color},0)`);
    ctx.fillStyle = gr;
    ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
  }
  ctx.restore();
  glows.length = 0;
}

/** Streetlights in view feed the light map at night. */
export function addStreetLights(view) {
  if (G.light.night < 0.05) return;
  for (const l of G.city.lights) {
    if (l.x < view.x0 - 120 || l.x > view.x1 + 120 || l.y < view.y0 - 120 || l.y > view.y1 + 120) continue;
    addLight(l.x, l.y, 92, '255,190,120', 0.42);
    addGlow(l.x, l.y, 10, '255,230,180', 0.9);
  }
  // landmark neon washes
  for (const id in G.city.landmarks) {
    const lm = G.city.landmarks[id];
    const b = lm.building;
    if (b.x > view.x1 + 200 || b.x + b.w < view.x0 - 200 || b.y > view.y1 + 200 || b.y + b.h < view.y0 - 200) continue;
    const c = lm.color;
    const n = parseInt(c.slice(1), 16);
    addLight(b.x + b.w / 2, b.y + b.h + 30, Math.min(220, Math.max(b.w * 0.8, 140)), `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`, 0.3);
  }
}

// --- weather -----------------------------------------------------------------
export function updateWeather(dt) {
  const w = G.weather;
  w.timer -= dt;
  if (w.timer <= 0) {
    // deterministic-ish alternation: rain showers every few in-game hours
    w.target = w.target > 0 ? 0 : (hash(Math.floor(G.time)) < 0.45 ? 1 : 0);
    w.timer = w.target > 0 ? 70 + hash(Math.floor(G.time), 3) * 60 : 160 + hash(Math.floor(G.time), 5) * 140;
  }
  w.rain += clamp(w.target - w.rain, -dt * 0.15, dt * 0.15);
}

/** Wet-road sheen in world space. */
export function drawPuddles(ctx, view) {
  const r = G.weather.rain;
  if (r < 0.05) return;
  ctx.fillStyle = `rgba(170,200,230,${(0.18 * r).toFixed(3)})`;
  const S = 90;
  ctx.beginPath();
  for (let gx = Math.floor(view.x0 / S); gx <= Math.floor(view.x1 / S); gx++) for (let gy = Math.floor(view.y0 / S); gy <= Math.floor(view.y1 / S); gy++) {
    if (hash(gx, gy, 31) > 0.35) continue;
    const x = gx * S + hash(gx, gy, 32) * S, y = gy * S + hash(gx, gy, 33) * S;
    const w = 10 + hash(gx, gy, 34) * 22;
    ctx.moveTo(x + w, y); ctx.ellipse(x, y, w, w * 0.45, 0, 0, TAU);
  }
  ctx.fill();
}

/** Screen-space rain streaks and a cool darkening tint. */
export function drawRain(ctx, dt) {
  const r = G.weather.rain;
  if (r < 0.03) { rainDrops.length = 0; return; }
  const want = Math.floor(420 * r * (G.W * G.H) / (1920 * 1080));
  while (rainDrops.length < want) rainDrops.push({ x: Math.random() * G.W, y: Math.random() * G.H, s: 900 + Math.random() * 600, l: 14 + Math.random() * 18 });
  rainDrops.length = Math.min(rainDrops.length, want);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgba(30,40,70,${(0.16 * r).toFixed(3)})`;
  ctx.fillRect(0, 0, G.W, G.H);
  ctx.strokeStyle = `rgba(190,210,240,${(0.42 * r).toFixed(3)})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (const d of rainDrops) {
    d.y += d.s * dt; d.x -= d.s * 0.18 * dt;
    if (d.y > G.H) { d.y = -20; d.x = Math.random() * (G.W + 200); }
    ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * 0.18, d.y - d.l);
  }
  ctx.stroke();
  ctx.restore();
}
