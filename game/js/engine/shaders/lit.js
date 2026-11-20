// Main lit shader for static chunks, instanced props/characters and per-draw vehicles.
// Sun/moon directional light + hemisphere ambient + PCF shadows + up to 32 point/spot lights,
// procedural building windows, wet roads with puddles, glass fresnel, emissive signs/neon/lights.
import { GLSL_COMMON } from './common.js';

export const LIT_VS = `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in float aEmissive;
layout(location=4) in float aMat;
layout(location=5) in vec2 aUV;
layout(location=6) in mat4 iModel;
layout(location=10) in vec3 iColor;
layout(location=11) in vec4 iParams;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec3 uTint;
uniform vec4 uParams;
out vec3 vWorld; out vec3 vNormal; out vec3 vColor; out float vEmissive; flat out float vMat; out vec2 vUV; flat out vec4 vParams;
void main() {
#ifdef INSTANCED
  mat4 M = iModel; vec4 P = iParams;
  bool tinted = aMat > 1.5 && aMat < 2.5;
  vColor = tinted ? iColor : aColor * iColor;
#else
  mat4 M = uModel; vec4 P = uParams;
  vColor = (aMat > 1.5 && aMat < 2.5) ? uTint : aColor;
#endif
  vec4 wp = M * vec4(aPos, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(M) * aNormal);
  vEmissive = aEmissive + P.x;
  vMat = aMat; vUV = aUV; vParams = P;
  gl_Position = uViewProj * wp;
}`;

export const LIT_FS = GLSL_COMMON + `
in vec3 vWorld; in vec3 vNormal; in vec3 vColor; in float vEmissive; flat in float vMat; in vec2 vUV; flat in vec4 vParams;
uniform vec3 uCamPos, uSunDir, uSunCol, uSkyCol, uGroundCol, uFogCol;
uniform float uFogDensity, uTime, uNight, uWet, uShadowOn, uShadowTexel;
uniform sampler2DShadow uShadowMap;
uniform mat4 uShadowMat;
uniform sampler2D uAtlas;
uniform vec4 uLightPos[32];   // xyz, radius
uniform vec4 uLightCol[32];   // rgb, intensity
uniform vec4 uLightDir[32];   // xyz dir, cos cutoff (0 = point light)
uniform int uLightCount;
out vec4 frag;

float shadowAt(vec3 wp, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 sp = uShadowMat * vec4(wp + n * 0.12, 1.0);
  vec3 p = sp.xyz / sp.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float s = 0.0, t = uShadowTexel;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) s += texture(uShadowMap, vec3(p.xy + vec2(x, y) * t, p.z - 0.0015));
  return s / 9.0;
}

void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(uCamPos - vWorld);
  vec3 albedo = vColor;
  vec3 emissive = vColor * vEmissive;
  float spec = 0.0, specPow = 16.0, reflectK = 0.0;
  int mat = int(vMat + 0.5);
  float fmat = vMat;

  if (fmat >= 0.95 && fmat < 1.95) {
    // ----- building walls with procedural windows -----
    float seed = fract(fmat) * 977.0;
    if (abs(n.y) < 0.5) {
      float u = abs(n.x) > 0.5 ? vWorld.z : vWorld.x;
      vec2 cell = vec2(u / 2.7, (vWorld.y - 0.4) / 3.4);
      vec2 f = fract(cell), id = floor(cell);
      bool win = f.x > 0.16 && f.x < 0.84 && f.y > 0.24 && f.y < 0.86 && vWorld.y > 4.2;
      if (win) {
        float h = hash13(vec3(id, seed + n.x * 3.0 + n.z * 7.0));
        float fres = pow(1.0 - max(dot(n, V), 0.0), 2.5);
        albedo = mix(vec3(0.05, 0.08, 0.11), uSkyCol * 0.55, 0.25 + 0.6 * fres);
        reflectK = 0.35 + 0.4 * fres; spec = 0.9; specPow = 60.0;
        float lit = step(h, 0.58 * uNight + 0.02);
        vec3 tint = h * 13.7 - floor(h * 13.7) > 0.72 ? vec3(0.6, 0.78, 1.0) : vec3(1.0, 0.7, 0.38);
        float flick = 0.75 + 0.25 * hash12(id + 3.1);
        emissive += lit * tint * 2.6 * flick;
        if (lit > 0.5) albedo *= 0.3;
      } else if (f.y < 0.12 && vWorld.y > 4.2) {
        albedo *= 0.82; // floor band
      }
    }
  } else if (mat == 3) {
    // ----- asphalt: grain + wet puddles -----
    float g = vnoise(vWorld.xz * 1.7) * 0.5 + vnoise(vWorld.xz * 9.0) * 0.5;
    albedo *= 0.86 + 0.28 * g;
    float puddle = smoothstep(0.52, 0.62, fbm(vWorld.xz * 0.11)) * uWet;
    float wet = uWet * 0.55 + puddle;
    albedo *= 1.0 - 0.35 * wet;
    spec = 0.25 + 1.6 * wet; specPow = 30.0 + 120.0 * puddle;
    reflectK = 0.55 * puddle + 0.08 * uWet;
  } else if (mat == 4) {
    // ----- car glass -----
    float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    albedo = vec3(0.04, 0.06, 0.08);
    reflectK = 0.3 + 0.6 * fres; spec = 1.2; specPow = 80.0;
  } else if (mat == 5) {
    // ----- emissive sign (text atlas) -----
    vec4 t = texture(uAtlas, vUV);
    albedo = t.rgb;
    emissive = t.rgb * vEmissive * (0.35 + 1.4 * uNight);
  } else if (mat == 6) {
    albedo *= 0.8 + 0.4 * vnoise(vWorld.xz * 0.6) * (0.7 + 0.3 * vnoise(vWorld.xz * 5.0));
  } else if (mat == 13) {
    albedo *= 0.9 + 0.2 * vnoise(vWorld.xz * 3.0);
  } else if (mat == 7) {
    emissive = vec3(1.0, 0.06, 0.04) * (0.5 + 0.6 * vParams.x + 3.0 * vParams.y);
  } else if (mat == 8) {
    emissive = vec3(1.0, 0.95, 0.8) * (0.25 + 3.5 * vParams.x);
  } else if (mat == 9) {
    emissive = vec3(1.0, 0.05, 0.08) * (vParams.z > 0.5 ? 6.0 : 0.15);
  } else if (mat == 10) {
    emissive = vec3(0.1, 0.25, 1.0) * (vParams.z > 0.5 && vParams.z < 1.5 ? 0.15 : (vParams.z > 1.5 ? 6.0 : 0.15));
  } else if (mat == 11) {
    float w = vnoise(vWorld.xz * 2.0 + uTime * 0.6);
    albedo = mix(vec3(0.1, 0.55, 0.7), vec3(0.4, 0.85, 0.95), w);
    spec = 1.0; specPow = 60.0; reflectK = 0.2;
    emissive += vec3(0.05, 0.25, 0.35) * uNight;
  } else if (mat == 12) {
    emissive = vColor * vEmissive * (0.25 + 1.3 * uNight);
  }

  // ----- lighting -----
  float ndl = max(dot(n, uSunDir), 0.0);
  float sh = ndl > 0.0 ? shadowAt(vWorld, n) : 0.0;
  vec3 amb = mix(uGroundCol, uSkyCol, n.y * 0.5 + 0.5);
  vec3 light = amb + uSunCol * ndl * sh;
  vec3 H = normalize(uSunDir + V);
  vec3 specCol = uSunCol * pow(max(dot(n, H), 0.0), specPow) * spec * sh;
  vec3 R = reflect(-V, n);
  for (int i = 0; i < 32; i++) {
    if (i >= uLightCount) break;
    vec3 Lv = uLightPos[i].xyz - vWorld;
    float d = length(Lv);
    float r = uLightPos[i].w;
    if (d > r) continue;
    vec3 L = Lv / d;
    float att = 1.0 - d / r; att *= att;
    vec4 dir = uLightDir[i];
    if (dir.w > 0.0) {
      float c = dot(-L, dir.xyz);
      att *= smoothstep(dir.w, dir.w + 0.12, c);
    }
    vec3 lc = uLightCol[i].rgb * uLightCol[i].w * att;
    light += lc * (max(dot(n, L), 0.0) * 0.85 + 0.15);
    specCol += lc * pow(max(dot(R, L), 0.0), specPow) * spec * 1.5;
  }
  vec3 col = albedo * light + specCol + emissive;
  if (reflectK > 0.0) {
    vec3 env = mix(uFogCol, uSkyCol * 1.2, clamp(R.y * 2.0 + 0.3, 0.0, 1.0));
    col = mix(col, env + emissive, reflectK * 0.6);
  }
  col = applyFog(col, vWorld, uCamPos, uFogCol, uFogDensity);
  frag = vec4(col, 1.0);
}`;
