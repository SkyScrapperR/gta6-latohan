// Directional shadow map fitted around the camera focus, snapped to texels to avoid shimmer.
import { mat4, vnorm } from '../core/math.js';
import { createTarget, deleteTarget } from './gl.js';

export class ShadowMap {
  constructor(gl) { this.gl = gl; this.size = 0; this.target = null; this.viewProj = mat4.create(); this.radius = 80; this.enabled = true; }
  configure(size, radius) {
    if (size === this.size && this.target) { this.radius = radius; return; }
    deleteTarget(this.gl, this.target);
    this.size = size; this.radius = radius;
    this.target = size > 0 ? createTarget(this.gl, size, size, { colour: false, depthTexture: true }) : null;
  }
  /** Fit an orthographic light frustum around a focus point. */
  fit(focus, sunDir) {
    const r = this.radius;
    const d = vnorm(sunDir);
    const view = mat4.create();
    const eye = [focus[0] + d[0] * 300, focus[1] + d[1] * 300, focus[2] + d[2] * 300];
    const up = Math.abs(d[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
    mat4.lookAt(view, eye, focus, up);
    // snap the focus to whole shadow texels in light space
    const texel = (2 * r) / this.size;
    const c = mat4.transformPoint(view, focus);
    const sx = Math.round(c[0] / texel) * texel - c[0], sy = Math.round(c[1] / texel) * texel - c[1];
    const proj = mat4.ortho(mat4.create(), -r + sx + c[0], r + sx + c[0], -r + sy + c[1], r + sy + c[1], 1, 700);
    mat4.multiply(this.viewProj, proj, view);
    return this.viewProj;
  }
}
