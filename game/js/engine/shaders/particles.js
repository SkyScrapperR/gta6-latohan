// Camera-facing billboard particles (smoke/fire/sparks/glows) and velocity-stretched tracers.
export const PARTICLE_VS = `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iPosSize;   // xyz, size
layout(location=2) in vec4 iColor;     // rgba (rgb may be HDR)
layout(location=3) in vec4 iStretch;   // world-space stretch vector xyz, kind
uniform mat4 uViewProj;
uniform vec3 uCamRight, uCamUp, uCamPos;
out vec2 vC; out vec4 vCol; flat out float vKind;
void main() {
  vec3 p = iPosSize.xyz;
  vec3 s = iStretch.xyz;
  vec3 offs;
  if (iStretch.w > 2.5) {
    offs = vec3(aCorner.x, 0.0, aCorner.y) * iPosSize.w;   // flat ground decal
    if (dot(s, s) > 0.0001) { vec3 side = normalize(vec3(-s.z, 0.0, s.x)) * iPosSize.w; offs = side * aCorner.x + s * (aCorner.y * 0.5); }
  } else if (dot(s, s) > 0.0001) {
    vec3 view = normalize(uCamPos - p);
    vec3 side = normalize(cross(s, view)) * iPosSize.w;
    offs = side * aCorner.x + s * (aCorner.y * 0.5);
  } else {
    offs = (uCamRight * aCorner.x + uCamUp * aCorner.y) * iPosSize.w;
  }
  vC = aCorner; vCol = iColor; vKind = iStretch.w;
  gl_Position = uViewProj * vec4(p + offs, 1.0);
}`;
export const PARTICLE_FS = `
in vec2 vC; in vec4 vCol; flat in float vKind;
out vec4 frag;
void main() {
  float d = length(vC);
  float a;
  if (vKind > 0.5 && vKind < 1.5) a = 1.0 - smoothstep(0.0, 1.0, abs(vC.x)); // tracer / streak
  else a = smoothstep(1.0, 0.15, d);
  if (vKind > 1.5 && vKind < 2.5) a *= a; // soft glow
  if (vKind > 3.5) a = smoothstep(1.0, 0.3, d) * (0.6 + 0.4 * fract(sin(dot(floor(vC * 4.0), vec2(12.9, 78.2))) * 43758.5)); // scorch
  frag = vec4(vCol.rgb, vCol.a * a);
}`;
