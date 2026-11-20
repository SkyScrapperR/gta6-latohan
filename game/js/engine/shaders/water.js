// Animated sea: vertex waves, fresnel tint toward the sky, sun glints, shoreline foam.
import { GLSL_COMMON } from './common.js';
export const WATER_VS = `
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform vec3 uOrigin;
uniform float uTime;
out vec3 vWorld; out vec3 vNormal;
float wave(vec2 p, vec2 d, float f, float a, float s) { return a * sin(dot(p, d) * f + uTime * s); }
void main() {
  vec3 p = aPos + uOrigin;
  float h = 0.0;
  vec2 d1 = normalize(vec2(1.0, 0.6)), d2 = normalize(vec2(-0.4, 1.0)), d3 = normalize(vec2(0.8, -0.3));
  h += wave(p.xz, d1, 0.11, 0.35, 1.3) + wave(p.xz, d2, 0.23, 0.18, 1.9) + wave(p.xz, d3, 0.5, 0.06, 2.6);
  float e = 0.5;
  float hx = wave(p.xz + vec2(e, 0), d1, 0.11, 0.35, 1.3) + wave(p.xz + vec2(e, 0), d2, 0.23, 0.18, 1.9) + wave(p.xz + vec2(e, 0), d3, 0.5, 0.06, 2.6);
  float hz = wave(p.xz + vec2(0, e), d1, 0.11, 0.35, 1.3) + wave(p.xz + vec2(0, e), d2, 0.23, 0.18, 1.9) + wave(p.xz + vec2(0, e), d3, 0.5, 0.06, 2.6);
  vNormal = normalize(vec3(h - hx, e, h - hz));
  p.y = -0.45 + h;
  vWorld = p;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;
export const WATER_FS = GLSL_COMMON + `
in vec3 vWorld; in vec3 vNormal;
uniform vec3 uCamPos, uSunDir, uSunCol, uSkyCol, uZenith, uHorizon, uFogCol;
uniform float uFogDensity, uTime, uNight;
uniform vec4 uLand;   // x0, z0, x1, z1 of the island
uniform vec4 uLightPos[32]; uniform vec4 uLightCol[32]; uniform int uLightCount;
out vec4 frag;
void main() {
  vec3 n = normalize(vNormal + vec3(vnoise(vWorld.xz * 0.8 + uTime * 0.4) - 0.5, 0.0, vnoise(vWorld.zx * 0.8 - uTime * 0.3) - 0.5) * 0.25);
  vec3 V = normalize(uCamPos - vWorld);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uHorizon, uZenith, clamp(R.y, 0.0, 1.0));
  vec3 deep = vec3(0.01, 0.09, 0.14) * (0.3 + 0.7 * (1.0 - uNight)), shallow = vec3(0.05, 0.36, 0.42) * (0.25 + 0.75 * (1.0 - uNight));
  // distance to the island edge (shallow band + foam)
  vec2 q = vWorld.xz;
  vec2 dd = max(vec2(uLand.x - q.x, uLand.y - q.y), vec2(q.x - uLand.z, q.y - uLand.w));
  float edge = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0);
  float shore = 1.0 - smoothstep(0.0, 40.0, edge);
  vec3 base = mix(deep, shallow, shore);
  vec3 col = mix(base, sky, fres);
  float sun = pow(max(dot(R, uSunDir), 0.0), 220.0);
  col += uSunCol * sun * 4.0;
  for (int i = 0; i < 32; i++) {
    if (i >= uLightCount) break;
    vec3 L = uLightPos[i].xyz - vWorld; float d = length(L);
    if (d > uLightPos[i].w * 3.0) continue;
    col += uLightCol[i].rgb * uLightCol[i].w * pow(max(dot(R, L / d), 0.0), 40.0) * (1.0 - d / (uLightPos[i].w * 3.0)) * 1.5;
  }
  float foam = (1.0 - smoothstep(0.0, 3.5 + 1.5 * sin(uTime * 1.3 + q.x * 0.2), edge)) * (0.6 + 0.4 * vnoise(q * 0.9 + uTime));
  col = mix(col, vec3(0.9, 0.95, 1.0) * (0.25 + 0.75 * (1.0 - uNight * 0.85)), clamp(foam, 0.0, 1.0));
  col = applyFog(col, vWorld, uCamPos, uFogCol, uFogDensity * 0.8);
  frag = vec4(col, 1.0);
}`;
