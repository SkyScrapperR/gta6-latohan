// The frame graph: shadow pass -> HDR scene (sky, static chunks, instanced batches,
// per-draw vehicles, water, particles, light volumes) -> bloom + tone mapping -> screen.
import { mat4, vnorm, vcross, vsub, clamp } from '../core/math.js';
import { compileProgram, createTarget, deleteTarget, uploadInstances, drawMesh, createMesh } from './gl.js';
import { LIT_VS, LIT_FS } from './shaders/lit.js';
import { SHADOW_VS, SHADOW_FS } from './shaders/shadow.js';
import { FULLSCREEN_VS, SKY_FS } from './shaders/sky.js';
import { WATER_VS, WATER_FS } from './shaders/water.js';
import { PARTICLE_VS, PARTICLE_FS } from './shaders/particles.js';
import { BEAM_VS, BEAM_FS } from './shaders/beam.js';
import { frustumPlanes, aabbVisible } from './frustum.js';
import { ShadowMap } from './shadows.js';
import { PostFX } from './post.js';

export const QUALITY = {
  low: { shadow: 0, shadowRadius: 60, bloomLevels: 3, bloom: 0.5, far: 520, lights: 12, scale: 0.6 },
  medium: { shadow: 1024, shadowRadius: 70, bloomLevels: 4, bloom: 0.8, far: 800, lights: 24, scale: 0.8 },
  high: { shadow: 2048, shadowRadius: 90, bloomLevels: 5, bloom: 1.0, far: 1200, lights: 32, scale: 1.0 },
};
const MAX_PARTICLES = 6000;

export class Renderer {
  constructor(gl) {
    this.gl = gl;
    this.lit = compileProgram(gl, LIT_VS, LIT_FS, 'lit');
    this.litInst = compileProgram(gl, LIT_VS, LIT_FS, 'lit-instanced', '#define INSTANCED');
    this.shadowProg = compileProgram(gl, SHADOW_VS, SHADOW_FS, 'shadow');
    this.shadowInst = compileProgram(gl, SHADOW_VS, SHADOW_FS, 'shadow-instanced', '#define INSTANCED');
    this.sky = compileProgram(gl, FULLSCREEN_VS, SKY_FS, 'sky');
    this.water = compileProgram(gl, WATER_VS, WATER_FS, 'water');
    this.particle = compileProgram(gl, PARTICLE_VS, PARTICLE_FS, 'particles');
    this.beam = compileProgram(gl, BEAM_VS, BEAM_FS, 'beam');
    this.emptyVAO = gl.createVertexArray();
    this.shadows = new ShadowMap(gl);
    this.post = new PostFX(gl);
    this.scene = null;
    this.quality = 'high'; this.q = QUALITY.high;
    this.scale = 1; this.adaptive = 1;
    this.camera = { pos: [0, 10, 0], target: [0, 0, 0], fov: 60, near: 0.3, far: 1200, view: mat4.create(), proj: mat4.create(), viewProj: mat4.create(), inv: mat4.create(), right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, -1] };
    this.env = {};
    this.lights = [];
    this.statics = [];          // { mesh, aabb }
    this.batches = [];          // InstanceBatch (persistent and per-frame)
    this.dynamic = [];          // { mesh, model, tint, params, shadow }
    this.beams = [];            // { mesh, model, color, alpha, fadeTop }
    this.particleData = new Float32Array(MAX_PARTICLES * 12);
    this.particleCount = 0; this.additiveStart = 0;
    this.atlas = null;
    this.waterMesh = null; this.land = [0, 0, 1, 1];
    this.post_ = { bloom: 0.9, threshold: 1.5, exposure: 1, saturation: 1.1, vignette: 0.35, blur: 0, grade: [1, 1, 1], lift: [0, 0, 0], desat: 0 };
    this.stats = { draws: 0, culled: 0 };
    this.initParticles();
    this.initWater();
    // 1x1 depth texture so the shadow sampler is always complete
    this.dummyDepth = createTarget(gl, 1, 1, { colour: false, depthTexture: true }).depthTex;
  }

  setQuality(name) { this.quality = name; this.q = QUALITY[name]; this.shadows.configure(this.q.shadow, this.q.shadowRadius); this.needResize = true; }

  resize(w, h) {
    this.screenW = w; this.screenH = h;
    const s = clamp(this.q.scale * this.adaptive, 0.4, 1);
    const rw = Math.max(64, Math.round(w * s)), rh = Math.max(64, Math.round(h * s));
    if (this.scene && this.scene.w === rw && this.scene.h === rh && !this.needResize) return;
    deleteTarget(this.gl, this.scene);
    this.scene = createTarget(this.gl, rw, rh, { hdr: true, depth: true });
    this.post.resize(rw, rh, this.q.bloomLevels);
    this.needResize = false;
  }

  initParticles() {
    const gl = this.gl;
    this.pVAO = gl.createVertexArray();
    gl.bindVertexArray(this.pVAO);
    const q = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, q);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.pBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.particleData.byteLength, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 3; i++) { gl.enableVertexAttribArray(1 + i); gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 48, i * 16); gl.vertexAttribDivisor(1 + i, 1); }
    gl.bindVertexArray(null);
  }

  initWater() {
    // a radial-ish grid that is denser near the camera; moved with the camera each frame
    const v = [], N = 80, S = 5000;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const f = (k) => { const t = k / N * 2 - 1; return Math.sign(t) * Math.abs(t) ** 2.4 * S / 2; };
      const x0 = f(i), x1 = f(i + 1), z0 = f(j), z1 = f(j + 1);
      for (const [x, z] of [[x0, z1], [x1, z1], [x1, z0], [x0, z1], [x1, z0], [x0, z0]]) v.push(x, 0, z, 0, 1, 0, 1, 1, 1, 0, 0, 0, 0);
    }
    this.waterMesh = createMesh(this.gl, new Float32Array(v));
  }

  /** Camera matrices + derived vectors. */
  updateCamera() {
    const c = this.camera;
    const aspect = this.screenW / this.screenH;
    c.far = this.q.far;
    mat4.perspective(c.proj, c.fov * Math.PI / 180, aspect, c.near, c.far);
    mat4.lookAt(c.view, c.pos, c.target, [0, 1, 0]);
    mat4.multiply(c.viewProj, c.proj, c.view);
    mat4.invert(c.inv, c.viewProj);
    c.fwd = vnorm(vsub(c.target, c.pos));
    c.right = vnorm(vcross(c.fwd, [0, 1, 0]));
    c.up = vcross(c.right, c.fwd);
    this.planes = frustumPlanes(c.viewProj);
  }

  /** Common uniforms for lit/water shaders. */
  setFrameUniforms(p) {
    const e = this.env, c = this.camera;
    p.m4('uViewProj', c.viewProj).f3('uCamPos', c.pos).f3('uSunDir', e.sunDir).f3('uSunCol', e.sunCol)
      .f3('uSkyCol', e.skyCol).f3('uGroundCol', e.groundCol).f3('uFogCol', e.fogCol).f1('uFogDensity', e.fogDensity)
      .f1('uTime', this.time).f1('uNight', e.night).f1('uWet', e.wet || 0);
    const gl = this.gl;
    const n = this.lightCount;
    gl.uniform4fv(p.loc('uLightPos'), this.lightPos);
    gl.uniform4fv(p.loc('uLightCol'), this.lightCol);
    const ld = p.loc('uLightDir'); if (ld) gl.uniform4fv(ld, this.lightDir);
    p.i1('uLightCount', n);
  }

  selectLights() {
    const c = this.camera.pos, max = this.q.lights;
    const ls = this.lights;
    for (const l of ls) l.d = (l.x - c[0]) ** 2 + (l.y - c[1]) ** 2 + (l.z - c[2]) ** 2 - l.r * l.r * 0.5 - (l.priority || 0);
    ls.sort((a, b) => a.d - b.d);
    this.lightPos = new Float32Array(128); this.lightCol = new Float32Array(128); this.lightDir = new Float32Array(128);
    let n = 0;
    for (const l of ls) {
      if (n >= max) break;
      if (l.d > 320 * 320) break;
      this.lightPos.set([l.x, l.y, l.z, l.r], n * 4);
      this.lightCol.set([l.color[0], l.color[1], l.color[2], l.intensity], n * 4);
      this.lightDir.set(l.dir ? [l.dir[0], l.dir[1], l.dir[2], l.cos] : [0, 0, 0, 0], n * 4);
      n++;
    }
    this.lightCount = n;
  }

  render(time) {
    const gl = this.gl;
    this.time = time;
    this.stats.draws = 0; this.stats.culled = 0;
    this.updateCamera();
    this.selectLights();
    for (const b of this.batches) if (b.dirty && b.count) { uploadInstances(gl, b.mesh, b.data, b.count); b.dirty = false; }
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    // ---- shadow pass ----
    const sm = this.shadows;
    const shadowOn = sm.target && this.env.sunDir[1] > 0.05;
    if (shadowOn) {
      const lvp = sm.fit(this.shadowFocus || this.camera.target, this.env.sunDir);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sm.target.fb);
      gl.viewport(0, 0, sm.size, sm.size);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
      const lp = frustumPlanes(lvp);
      const sp = this.shadowProg.use(); sp.m4('uLightVP', lvp);
      const I = mat4.create();
      sp.m4('uModel', I);
      for (const s of this.statics) if (aabbVisible(lp, s.aabb)) drawMesh(gl, s.mesh);
      for (const d of this.dynamic) if (d.shadow !== false) { sp.m4('uModel', d.model); drawMesh(gl, d.mesh); }
      const si = this.shadowInst.use(); si.m4('uLightVP', lvp);
      for (const b of this.batches) if (b.castShadow && b.count) drawMesh(gl, b.mesh, b.count);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    // ---- scene ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb);
    gl.viewport(0, 0, this.scene.w, this.scene.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // sky
    gl.depthMask(false);
    const sk = this.sky.use(), e = this.env;
    sk.m4('uInvViewProj', this.camera.inv).f3('uZenith', e.zenith).f3('uHorizon', e.horizon).f3('uSunDir', e.sunDirTrue || e.sunDir)
      .f3('uSunCol', e.sunCol).f3('uMoonDir', e.moonDir).f1('uNight', e.night).f1('uTime', time).f1('uCloud', e.cloud).f1('uRain', e.rain);
    gl.bindVertexArray(this.emptyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);

    const bindShared = (p) => {
      this.setFrameUniforms(p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, shadowOn ? sm.target.depthTex : this.dummyDepth);
      p.i1('uShadowMap', 0).f1('uShadowOn', shadowOn ? 1 : 0).m4('uShadowMat', sm.viewProj).f1('uShadowTexel', 1 / Math.max(1, sm.size));
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.atlas); p.i1('uAtlas', 1);
    };
    // static chunks
    const lp = this.lit.use(); bindShared(lp);
    lp.m4('uModel', mat4.create()).f3('uTint', [1, 1, 1]).f4('uParams', [0, 0, 0, 0]);
    for (const s of this.statics) {
      if (!aabbVisible(this.planes, s.aabb)) { this.stats.culled++; continue; }
      drawMesh(gl, s.mesh); this.stats.draws++;
    }
    // dynamic per-draw meshes (vehicles)
    for (const d of this.dynamic) {
      lp.m4('uModel', d.model).f3('uTint', d.tint || [1, 1, 1]).f4('uParams', d.params || [0, 0, 0, 0]);
      drawMesh(gl, d.mesh); this.stats.draws++;
    }
    // instanced batches
    const ip = this.litInst.use(); bindShared(ip);
    for (const b of this.batches) if (b.count) { drawMesh(gl, b.mesh, b.count); this.stats.draws++; }
    // water
    const wp = this.water.use(); this.setFrameUniforms(wp);
    const cp = this.camera.pos;
    wp.f3('uOrigin', [Math.round(cp[0] / 8) * 8, 0, Math.round(cp[2] / 8) * 8]).f3('uZenith', e.zenith).f3('uHorizon', e.horizon).f4('uLand', this.land);
    drawMesh(gl, this.waterMesh);

    // particles (alpha then additive) and light volumes
    gl.enable(gl.BLEND); gl.depthMask(false);
    if (this.particleCount) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.particleData, 0, this.particleCount * 12);
      const pp = this.particle.use();
      const c = this.camera;
      pp.m4('uViewProj', c.viewProj).f3('uCamRight', c.right).f3('uCamUp', c.up).f3('uCamPos', c.pos);
      gl.bindVertexArray(this.pVAO);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      if (this.additiveStart > 0) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.additiveStart);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      const nAdd = this.particleCount - this.additiveStart;
      if (nAdd > 0) {
        for (let i = 0; i < 3; i++) gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 48, this.additiveStart * 48 + i * 16);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, nAdd);
        for (let i = 0; i < 3; i++) gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 48, i * 16);
      }
    }
    if (this.beams.length) {
      gl.blendFunc(gl.ONE, gl.ONE);
      const bp = this.beam.use();
      bp.m4('uViewProj', this.camera.viewProj).f3('uCamPos', this.camera.pos).f1('uTime', time);
      for (const b of this.beams) {
        bp.m4('uModel', b.model).f3('uColor', b.color).f1('uAlpha', b.alpha).f1('uFadeTop', b.fadeTop ? 1 : 0);
        drawMesh(gl, b.mesh);
      }
    }
    gl.disable(gl.BLEND); gl.depthMask(true);

    // ---- post ----
    const P = this.post_;
    this.post.run(this.scene.tex, this.screenW, this.screenH, {
      threshold: P.blur > 0 ? 0 : P.threshold, bloom: P.blur > 0 ? 0.1 : P.bloom * this.q.bloom, exposure: P.exposure * (e.exposure || 1),
      saturation: P.saturation * (1 - P.desat), vignette: P.vignette, blur: P.blur, grade: [P.grade[0] * e.grade[0], P.grade[1] * e.grade[1], P.grade[2] * e.grade[2]], lift: P.lift,
    });
  }
}
