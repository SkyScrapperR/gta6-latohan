// HDR post chain: bright pass -> bloom mip pyramid (down + additive up) -> composite.
import { compileProgram, createTarget, deleteTarget } from './gl.js';
import { FULLSCREEN_VS } from './shaders/sky.js';
import { BRIGHT_FS, DOWN_FS, UP_FS, COMPOSITE_FS } from './shaders/post.js';

export class PostFX {
  constructor(gl) {
    this.gl = gl;
    this.bright = compileProgram(gl, FULLSCREEN_VS, BRIGHT_FS, 'bright');
    this.down = compileProgram(gl, FULLSCREEN_VS, DOWN_FS, 'down');
    this.up = compileProgram(gl, FULLSCREEN_VS, UP_FS, 'up');
    this.comp = compileProgram(gl, FULLSCREEN_VS, COMPOSITE_FS, 'composite');
    this.vao = gl.createVertexArray();
    this.mips = []; this.w = 0; this.h = 0; this.levels = 5;
  }
  resize(w, h, levels) {
    if (w === this.w && h === this.h && levels === this.levels && this.mips.length) return;
    for (const m of this.mips) deleteTarget(this.gl, m);
    this.mips = []; this.w = w; this.h = h; this.levels = levels;
    let mw = Math.max(1, w >> 1), mh = Math.max(1, h >> 1);
    for (let i = 0; i < levels; i++) { this.mips.push(createTarget(this.gl, mw, mh, { hdr: true })); mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1); }
  }
  pass(prog, target, tex, setup) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    if (target) gl.viewport(0, 0, target.w, target.h);
    prog.use();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); prog.i1('uTex', 0);
    if (setup) setup(prog);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  /** Run bloom + composite from the HDR scene texture to the screen. */
  run(sceneTex, screenW, screenH, o) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    const m = this.mips;
    this.pass(this.bright, m[0], sceneTex, (p) => p.f1('uThreshold', o.threshold));
    for (let i = 1; i < m.length; i++) this.pass(this.down, m[i], m[i - 1].tex, (p) => p.f2('uTexel', 1 / m[i - 1].w, 1 / m[i - 1].h));
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = m.length - 1; i > 0; i--) this.pass(this.up, m[i - 1], m[i].tex, (p) => p.f2('uTexel', 1 / m[i].w, 1 / m[i].h));
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, screenW, screenH);
    const c = this.comp.use();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneTex); c.i1('uScene', 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, m[0].tex); c.i1('uBloom', 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, m[Math.min(1, m.length - 1)].tex); c.i1('uBlur', 2);
    c.f1('uBloomStrength', o.bloom).f1('uExposure', o.exposure).f1('uSaturation', o.saturation).f1('uVignette', o.vignette).f1('uBlurMix', o.blur);
    c.f3('uGrade', o.grade).f3('uLift', o.lift || [0, 0, 0]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
