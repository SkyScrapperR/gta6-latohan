// Instanced batches: a mesh plus a growable per-instance buffer (mat4 + colour + params).
import { mat4 } from '../core/math.js';
import { INSTANCE_STRIDE } from './gl.js';

export class InstanceBatch {
  constructor(mesh, { castShadow = true, cull = true, name = '' } = {}) {
    this.mesh = mesh; this.castShadow = castShadow; this.cull = cull; this.name = name;
    this.data = new Float32Array(INSTANCE_STRIDE * 64);
    this.count = 0; this.dirty = true;
    this.tmp = mat4.create();
  }
  clear() { this.count = 0; this.dirty = true; }
  ensure(n) {
    if (n * INSTANCE_STRIDE <= this.data.length) return;
    const d = new Float32Array(Math.max(n, this.count * 2) * INSTANCE_STRIDE);
    d.set(this.data); this.data = d;
  }
  /** Add an instance from a full matrix. */
  pushMatrix(m, r = 1, g = 1, b = 1, p0 = 0, p1 = 0, p2 = 0, p3 = 0) {
    this.ensure(this.count + 1);
    const o = this.count * INSTANCE_STRIDE, d = this.data;
    d.set(m, o);
    d[o + 16] = r; d[o + 17] = g; d[o + 18] = b;
    d[o + 19] = p0; d[o + 20] = p1; d[o + 21] = p2; d[o + 22] = p3;
    this.count++; this.dirty = true;
  }
  /** Add an instance from position / yaw / scale. */
  push(x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1, r = 1, g = 1, b = 1, emissive = 0) {
    mat4.trs(this.tmp, x, y, z, yaw, sx, sy, sz);
    this.pushMatrix(this.tmp, r, g, b, emissive);
  }
}
