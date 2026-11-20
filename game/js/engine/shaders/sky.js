// Sky dome as a full-screen pass: time-of-day gradient, sun and moon discs, stars, clouds.
import { GLSL_COMMON } from './common.js';
export const FULLSCREEN_VS = `
out vec2 vUV;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 1.0, 1.0);
}`;
export const SKY_FS = GLSL_COMMON + `
in vec2 vUV;
uniform mat4 uInvViewProj;
uniform vec3 uZenith, uHorizon, uSunDir, uSunCol, uMoonDir;
uniform float uNight, uTime, uCloud, uRain;
out vec4 frag;
void main() {
  vec4 p = uInvViewProj * vec4(vUV * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w);
  float h = clamp(dir.y, -0.2, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
  if (dir.y < 0.0) col = mix(uHorizon, uHorizon * 0.55, clamp(-dir.y * 4.0, 0.0, 1.0));
  // sun glow + disc
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunCol * (pow(sd, 8.0) * 0.28 + smoothstep(0.9985, 0.9992, sd) * 1.6) * (1.0 - uRain * 0.8);
  // moon
  float md = max(dot(dir, uMoonDir), 0.0);
  col += vec3(0.75, 0.82, 1.0) * (smoothstep(0.9993, 0.9996, md) * 2.2 + pow(md, 60.0) * 0.12) * uNight;
  // stars
  if (uNight > 0.01 && dir.y > 0.0) {
    vec2 sp = dir.xz / (dir.y + 0.35) * 220.0;
    vec2 id = floor(sp);
    float s = hash12(id);
    float tw = 0.6 + 0.4 * sin(uTime * 3.0 + s * 40.0);
    float star = step(0.986, s) * smoothstep(0.42, 0.0, length(fract(sp) - 0.5)) * tw;
    col += vec3(star) * uNight * 1.6 * (1.0 - uRain);
  }
  // clouds
  if (dir.y > 0.0) {
    vec2 cp = dir.xz / (dir.y + 0.3) * 1.6 + vec2(uTime * 0.004, uTime * 0.002);
    float c = smoothstep(0.45 - uCloud * 0.25, 0.85, fbm(cp));
    vec3 cc = mix(uHorizon * 1.15 + uSunCol * 0.15, uZenith * 0.6, 0.3) * (1.0 - uNight * 0.75);
    col = mix(col, cc, c * 0.7 * smoothstep(0.02, 0.3, dir.y));
  }
  frag = vec4(col, 1.0);
}`;
