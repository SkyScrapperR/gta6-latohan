// Post-processing: bright pass, bloom down/upsample chain, composite with ACES tone mapping,
// colour grade, desaturation, vignette and pause blur.
export const BRIGHT_FS = `
in vec2 vUV; uniform sampler2D uTex; uniform float uThreshold; out vec4 frag;
void main() {
  vec3 c = texture(uTex, vUV).rgb;
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  float l = max(c.r, max(c.g, c.b));
  float k = uThreshold <= 0.0 ? 1.0 : smoothstep(uThreshold, uThreshold * 1.8, l);
  frag = vec4(min(c * k, vec3(40.0)), 1.0);
}`;
export const DOWN_FS = `
in vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; out vec4 frag;
void main() {
  vec3 c = texture(uTex, vUV + uTexel * vec2(-1, -1)).rgb + texture(uTex, vUV + uTexel * vec2(1, -1)).rgb
         + texture(uTex, vUV + uTexel * vec2(-1, 1)).rgb + texture(uTex, vUV + uTexel * vec2(1, 1)).rgb;
  frag = vec4(c * 0.25, 1.0);
}`;
export const UP_FS = `
in vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; out vec4 frag;
void main() {
  vec3 c = texture(uTex, vUV).rgb * 4.0;
  c += texture(uTex, vUV + vec2(uTexel.x, 0)).rgb * 2.0 + texture(uTex, vUV - vec2(uTexel.x, 0)).rgb * 2.0;
  c += texture(uTex, vUV + vec2(0, uTexel.y)).rgb * 2.0 + texture(uTex, vUV - vec2(0, uTexel.y)).rgb * 2.0;
  c += texture(uTex, vUV + uTexel).rgb + texture(uTex, vUV - uTexel).rgb + texture(uTex, vUV + vec2(uTexel.x, -uTexel.y)).rgb + texture(uTex, vUV + vec2(-uTexel.x, uTexel.y)).rgb;
  frag = vec4(c / 16.0, 1.0);
}`;
export const COMPOSITE_FS = `
in vec2 vUV;
uniform sampler2D uScene, uBloom, uBlur;
uniform float uBloomStrength, uExposure, uSaturation, uVignette, uBlurMix;
uniform vec3 uGrade, uLift;
out vec4 frag;
vec3 aces(vec3 x) { const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0); }
void main() {
  vec3 c = texture(uScene, vUV).rgb;
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  c = mix(c, texture(uBlur, vUV).rgb, uBlurMix);
  c += texture(uBloom, vUV).rgb * uBloomStrength;
  c *= uExposure * uGrade;
  c = aces(c);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSaturation);
  c += uLift;
  vec2 q = vUV - 0.5;
  c *= 1.0 - uVignette * dot(q, q) * 1.8;
  c = pow(c, vec3(1.0 / 1.08));
  frag = vec4(c, 1.0);
}`;
