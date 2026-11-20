// Shared GLSL chunks: hashing, value noise, fog.
export const GLSL_COMMON = `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
vec3 applyFog(vec3 col, vec3 world, vec3 cam, vec3 fogCol, float density) {
  float d = length(world - cam);
  float hf = exp(-max(world.y, 0.0) * 0.012);
  float f = 1.0 - exp(-d * density * hf);
  return mix(col, fogCol, clamp(f, 0.0, 1.0));
}
`;
