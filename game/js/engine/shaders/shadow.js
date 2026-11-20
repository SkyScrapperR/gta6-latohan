// Depth-only shaders for the directional shadow map (static + instanced).
export const SHADOW_VS = `
layout(location=0) in vec3 aPos;
layout(location=6) in mat4 iModel;
uniform mat4 uLightVP;
uniform mat4 uModel;
void main() {
#ifdef INSTANCED
  gl_Position = uLightVP * iModel * vec4(aPos, 1.0);
#else
  gl_Position = uLightVP * uModel * vec4(aPos, 1.0);
#endif
}`;
export const SHADOW_FS = `out vec4 frag; void main() { frag = vec4(1.0); }`;
