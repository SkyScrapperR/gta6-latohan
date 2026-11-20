// Additive light volumes: helicopter spotlight cone, mission marker cylinders, waypoint beam.
export const BEAM_VS = `
layout(location=0) in vec3 aPos;
layout(location=5) in vec2 aUV;
uniform mat4 uViewProj, uModel;
uniform vec3 uCamPos;
out vec2 vUV; out vec3 vWorld; out vec3 vN;
layout(location=1) in vec3 aNormal;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorld = wp.xyz; vUV = aUV; vN = normalize(mat3(uModel) * aNormal);
  gl_Position = uViewProj * wp;
}`;
export const BEAM_FS = `
in vec2 vUV; in vec3 vWorld; in vec3 vN;
uniform vec3 uColor, uCamPos;
uniform float uAlpha, uTime, uFadeTop;
out vec4 frag;
void main() {
  vec3 V = normalize(uCamPos - vWorld);
  float edge = abs(dot(normalize(vN), V));
  float h = vUV.y;
  float fade = uFadeTop > 0.5 ? (1.0 - h) : h;
  float band = 0.75 + 0.25 * sin(h * 30.0 - uTime * 4.0);
  float a = uAlpha * pow(edge, 1.5) * fade * band;
  frag = vec4(uColor * a, a);
}`;
