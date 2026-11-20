// Time-of-day environment: sun/moon direction, sky gradient, ambient, fog and colour grade.
import { clamp, lerp, vnorm } from '../core/math.js';

// keyframes: hour -> { zenith, horizon, sun colour, ambient sky, ambient ground, fog, grade }
const K = [
  { h: 0, zen: [0.004, 0.006, 0.02], hor: [0.02, 0.03, 0.07], sun: [0.08, 0.1, 0.18], sky: [0.035, 0.045, 0.09], gnd: [0.012, 0.012, 0.02], fog: [0.025, 0.03, 0.06], grade: [0.9, 0.95, 1.12], exp: 1.0 },
  { h: 5.0, zen: [0.01, 0.015, 0.05], hor: [0.08, 0.06, 0.12], sun: [0.1, 0.1, 0.2], sky: [0.05, 0.05, 0.1], gnd: [0.02, 0.02, 0.03], fog: [0.06, 0.05, 0.1], grade: [0.95, 0.95, 1.1], exp: 1.0 },
  { h: 6.2, zen: [0.18, 0.28, 0.5], hor: [0.95, 0.55, 0.38], sun: [1.6, 0.85, 0.45], sky: [0.3, 0.3, 0.4], gnd: [0.12, 0.09, 0.07], fog: [0.75, 0.55, 0.45], grade: [1.05, 0.98, 0.92], exp: 1.0 },
  { h: 8.0, zen: [0.22, 0.45, 0.85], hor: [0.7, 0.8, 0.9], sun: [2.0, 1.85, 1.6], sky: [0.42, 0.5, 0.62], gnd: [0.2, 0.18, 0.14], fog: [0.62, 0.72, 0.85], grade: [1, 1, 1], exp: 0.85 },
  { h: 15.5, zen: [0.2, 0.42, 0.82], hor: [0.72, 0.8, 0.9], sun: [2.05, 1.88, 1.62], sky: [0.42, 0.5, 0.62], gnd: [0.2, 0.18, 0.14], fog: [0.62, 0.72, 0.85], grade: [1.02, 1, 0.97], exp: 0.85 },
  { h: 17.3, zen: [0.22, 0.3, 0.6], hor: [1.0, 0.62, 0.35], sun: [2.8, 1.6, 0.7], sky: [0.4, 0.36, 0.42], gnd: [0.2, 0.13, 0.08], fog: [0.95, 0.62, 0.42], grade: [1.1, 0.98, 0.86], exp: 1.05 },
  { h: 18.4, zen: [0.15, 0.12, 0.35], hor: [1.0, 0.42, 0.25], sun: [2.2, 0.8, 0.35], sky: [0.3, 0.22, 0.35], gnd: [0.12, 0.07, 0.07], fog: [0.75, 0.38, 0.35], grade: [1.12, 0.95, 0.92], exp: 1.1 },
  { h: 19.3, zen: [0.05, 0.04, 0.16], hor: [0.35, 0.14, 0.28], sun: [0.4, 0.15, 0.2], sky: [0.1, 0.07, 0.16], gnd: [0.03, 0.02, 0.04], fog: [0.2, 0.09, 0.2], grade: [1.0, 0.92, 1.1], exp: 1.05 },
  { h: 20.4, zen: [0.006, 0.008, 0.03], hor: [0.03, 0.035, 0.08], sun: [0.08, 0.1, 0.18], sky: [0.035, 0.045, 0.09], gnd: [0.012, 0.012, 0.02], fog: [0.03, 0.035, 0.07], grade: [0.9, 0.95, 1.12], exp: 1.0 },
  { h: 24, zen: [0.004, 0.006, 0.02], hor: [0.02, 0.03, 0.07], sun: [0.08, 0.1, 0.18], sky: [0.035, 0.045, 0.09], gnd: [0.012, 0.012, 0.02], fog: [0.025, 0.03, 0.06], grade: [0.9, 0.95, 1.12], exp: 1.0 },
];
const mixv = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Fill env (renderer environment) for a clock in minutes, rain 0..1. */
export function computeEnvironment(env, minutes, rain = 0) {
  const h = (minutes / 60) % 24;
  let i = 0;
  while (i < K.length - 2 && K[i + 1].h <= h) i++;
  const a = K[i], b = K[i + 1];
  const t = clamp((h - a.h) / (b.h - a.h), 0, 1);
  const rk = 1 - rain * 0.55;
  env.zenith = mixv(a.zen, b.zen, t).map((v) => v * (1 - rain * 0.5));
  env.horizon = mixv(mixv(a.hor, b.hor, t), [0.25, 0.27, 0.3].map((v) => v * mixv(a.sky, b.sky, t)[1] * 2.2), rain * 0.7);
  env.sunCol = mixv(a.sun, b.sun, t).map((v) => v * rk);
  env.skyCol = mixv(a.sky, b.sky, t);
  env.groundCol = mixv(a.gnd, b.gnd, t);
  env.fogCol = mixv(mixv(a.fog, b.fog, t), env.horizon, rain * 0.5);
  env.grade = mixv(a.grade, b.grade, t);
  env.exposure = lerp(a.exp, b.exp, t);
  // sun path: rises east (+x) at 06:00, sets west at 19:00; moon opposite
  const p = (h - 6) / 13;
  const ang = p * Math.PI;
  const sun = vnorm([Math.cos(ang), Math.sin(ang) * 0.95 + 0.02, 0.35]);
  env.sunDirTrue = sun;
  env.moonDir = vnorm([-Math.cos(ang), Math.max(0.25, -Math.sin(ang)) , -0.3]);
  const day = clamp(Math.sin(ang) * 3, 0, 1);
  env.night = clamp(1 - Math.max(Math.sin(ang) * 2.2 + 0.25, 0), 0, 1) * (h > 4 && h < 21 ? 1 : 1);
  if (h >= 19.6 || h < 5.6) env.night = 1;
  else if (h > 18.4) env.night = clamp((h - 18.4) / 1.2, 0, 1);
  else if (h < 6.6) env.night = clamp((6.6 - h) / 1.0, 0, 1);
  else env.night = 0;
  // the light used for shading/shadows: sun by day, moon at night
  env.lightDir = day > 0.02 ? [sun[0], Math.max(sun[1], 0.08), sun[2]] : env.moonDir;
  if (day <= 0.02) env.sunCol = [0.12, 0.15, 0.26].map((v) => v * rk);
  env.sunDir = vnorm(env.lightDir);
  env.fogDensity = 0.0011 + rain * 0.0035 + env.night * 0.0009;
  env.cloud = 0.25 + rain * 0.7;
  env.rain = rain;
  env.wet = Math.min(1, rain * 1.4);
  env.saturation = 1.12 - rain * 0.2;
  return env;
}
