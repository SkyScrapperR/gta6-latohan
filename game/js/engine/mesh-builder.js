// Procedural mesh construction: boxes (optionally beveled), cylinders, cones, quads,
// low-poly spheres, gable roofs and wheels, written into one interleaved vertex stream.
import { STATIC_STRIDE } from './gl.js';

/** Material ids interpreted by the lit shader (aMat attribute). */
export const MAT = {
  PLAIN: 0, WINDOWS: 1, TINT: 2, ROAD: 3, GLASS: 4, SIGN: 5, GRASS: 6,
  TAILLIGHT: 7, HEADLIGHT: 8, SIREN_R: 9, SIREN_B: 10, WATER_POOL: 11, NEON: 12, SAND: 13,
};

export class MeshBuilder {
  constructor() { this.v = []; this.n = 0; }
  get vertexCount() { return this.n; }

  vert(x, y, z, nx, ny, nz, c, e = 0, mat = 0, u = 0, v = 0) {
    this.v.push(x, y, z, nx, ny, nz, c[0], c[1], c[2], e, mat, u, v);
    this.n++;
  }
  /** Quad from 4 corners (counter-clockwise when seen from the normal side). */
  quad(p0, p1, p2, p3, nrm, c, e = 0, mat = 0, uv = null) {
    const [nx, ny, nz] = nrm;
    const u = uv || [0, 0, 1, 0, 1, 1, 0, 1];
    this.vert(...p0, nx, ny, nz, c, e, mat, u[0], u[1]); this.vert(...p1, nx, ny, nz, c, e, mat, u[2], u[3]); this.vert(...p2, nx, ny, nz, c, e, mat, u[4], u[5]);
    this.vert(...p0, nx, ny, nz, c, e, mat, u[0], u[1]); this.vert(...p2, nx, ny, nz, c, e, mat, u[4], u[5]); this.vert(...p3, nx, ny, nz, c, e, mat, u[6], u[7]);
  }
  tri(p0, p1, p2, c, e = 0, mat = 0) {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.vert(...p0, nx, ny, nz, c, e, mat); this.vert(...p1, nx, ny, nz, c, e, mat); this.vert(...p2, nx, ny, nz, c, e, mat);
  }

  /**
   * Axis-aligned box from (x0,y0,z0) to (x1,y1,z1).
   * opts: { top, bottom=false, sides, mat, e, topMat, topColor, skip:{n,s,e,w} }
   */
  box(x0, y0, z0, x1, y1, z1, c, opts = {}) {
    const mat = opts.mat ?? 0, e = opts.e ?? 0;
    const tc = opts.topColor || c, tm = opts.topMat ?? mat;
    const sk = opts.skip || {};
    if (opts.top !== false) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], tc, e, tm);
    if (opts.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], c, e, mat);
    if (!sk.s) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], c, e, mat);   // +z (south)
    if (!sk.n) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], c, e, mat);  // -z (north)
    if (!sk.e) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], c, e, mat);   // +x (east)
    if (!sk.w) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], c, e, mat);  // -x (west)
  }

  /** Box centred on (cx,cz) with half sizes, bottom at y0. */
  boxC(cx, y0, cz, hx, h, hz, c, opts) { this.box(cx - hx, y0, cz - hz, cx + hx, y0 + h, cz + hz, c, opts); }

  /** Box with chamfered vertical edges and top edges (cheap bevel). */
  bevelBox(x0, y0, z0, x1, y1, z1, b, c, opts = {}) {
    const mat = opts.mat ?? 0, e = opts.e ?? 0;
    const tc = opts.topColor || c;
    // core sides inset by b
    const pts = [[x0 + b, z0], [x1 - b, z0], [x1, z0 + b], [x1, z1 - b], [x1 - b, z1], [x0 + b, z1], [x0, z1 - b], [x0, z0 + b]];
    const yt = y1 - b;
    for (let i = 0; i < 8; i++) {
      const a = pts[i], d = pts[(i + 1) % 8];
      const nx = d[1] - a[1], nz = -(d[0] - a[0]); const l = Math.hypot(nx, nz) || 1;
      this.quad([d[0], y0, d[1]], [a[0], y0, a[1]], [a[0], yt, a[1]], [d[0], yt, d[1]], [nx / l, 0, nz / l], c, e, mat);
      // bevel strip to the top face
      const ia = inset(a, x0, z0, x1, z1, b), id = inset(d, x0, z0, x1, z1, b);
      const ny = 0.7, k = 0.7;
      this.quad([d[0], yt, d[1]], [a[0], yt, a[1]], [ia[0], y1, ia[1]], [id[0], y1, id[1]], [nx / l * k, ny, nz / l * k], c, e, mat);
    }
    // top octagon (fan)
    const top = pts.map((p) => inset(p, x0, z0, x1, z1, b));
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    for (let i = 0; i < 8; i++) {
      const a = top[i], d = top[(i + 1) % 8];
      this.vert(cx, y1, cz, 0, 1, 0, tc, e, mat); this.vert(d[0], y1, d[1], 0, 1, 0, tc, e, mat); this.vert(a[0], y1, a[1], 0, 1, 0, tc, e, mat);
    }
    if (opts.bottom) for (let i = 0; i < 8; i++) {
      const a = pts[i], d = pts[(i + 1) % 8];
      this.vert(cx, y0, cz, 0, -1, 0, c, e, mat); this.vert(a[0], y0, a[1], 0, -1, 0, c, e, mat); this.vert(d[0], y0, d[1], 0, -1, 0, c, e, mat);
    }
  }

  /** Vertical cylinder (open/closed) centred on (cx,cz). */
  cylinder(cx, y0, cz, r, h, c, { seg = 10, mat = 0, e = 0, top = true, r2 = null } = {}) {
    const rt = r2 ?? r;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const nm = [(c0 + c1) / 2, 0, (s0 + s1) / 2];
      this.quad([cx + c1 * r, y0, cz + s1 * r], [cx + c0 * r, y0, cz + s0 * r], [cx + c0 * rt, y0 + h, cz + s0 * rt], [cx + c1 * rt, y0 + h, cz + s1 * rt], nm, c, e, mat);
      if (top && rt > 0) { this.vert(cx, y0 + h, cz, 0, 1, 0, c, e, mat); this.vert(cx + c1 * rt, y0 + h, cz + s1 * rt, 0, 1, 0, c, e, mat); this.vert(cx + c0 * rt, y0 + h, cz + s0 * rt, 0, 1, 0, c, e, mat); }
    }
  }

  /** Low-poly sphere (lat/long) — good for tree canopies and heads. */
  sphere(cx, cy, cz, r, c, { seg = 7, rings = 5, mat = 0, e = 0, sy = 1 } = {}) {
    for (let j = 0; j < rings; j++) {
      const t0 = (j / rings) * Math.PI, t1 = ((j + 1) / rings) * Math.PI;
      for (let i = 0; i < seg; i++) {
        const p0 = (i / seg) * Math.PI * 2, p1 = ((i + 1) / seg) * Math.PI * 2;
        const P = (t, p) => [cx + Math.sin(t) * Math.cos(p) * r, cy + Math.cos(t) * r * sy, cz + Math.sin(t) * Math.sin(p) * r];
        const a = P(t0, p0), b = P(t0, p1), d = P(t1, p0), f = P(t1, p1);
        if (j > 0) this.tri(a, b, f, c, e, mat);
        if (j < rings - 1) this.tri(a, f, d, c, e, mat);
      }
    }
  }

  /** Gable roof over a rectangle; ridge along x if ridgeX. */
  gable(x0, z0, x1, z1, y, h, c, ridgeX = true, overhang = 0.4) {
    x0 -= overhang; z0 -= overhang; x1 += overhang; z1 += overhang;
    const c2 = [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8];
    if (ridgeX) {
      const zm = (z0 + z1) / 2;
      this.tri([x0, y, z1], [x1, y, z1], [x1, y + h, zm], c); this.tri([x0, y, z1], [x1, y + h, zm], [x0, y + h, zm], c);
      this.tri([x1, y, z0], [x0, y, z0], [x0, y + h, zm], c2); this.tri([x1, y, z0], [x0, y + h, zm], [x1, y + h, zm], c2);
      this.tri([x0, y, z0], [x0, y, z1], [x0, y + h, zm], c2); this.tri([x1, y, z1], [x1, y, z0], [x1, y + h, zm], c2);
    } else {
      const xm = (x0 + x1) / 2;
      this.tri([x1, y, z1], [x1, y, z0], [xm, y + h, z0], c); this.tri([x1, y, z1], [xm, y + h, z0], [xm, y + h, z1], c);
      this.tri([x0, y, z0], [x0, y, z1], [xm, y + h, z1], c2); this.tri([x0, y, z0], [xm, y + h, z1], [xm, y + h, z0], c2);
      this.tri([x1, y, z0], [x0, y, z0], [xm, y + h, z0], c2); this.tri([x0, y, z1], [x1, y, z1], [xm, y + h, z1], c2);
    }
  }

  /** Horizontal flat quad at height y (for markings, decals). */
  flat(x0, z0, x1, z1, y, c, mat = 0, e = 0) { this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], c, e, mat); }

  /** Vertical textured sign facing +z/-z/+x/-x using atlas uv rect [u0,v0,u1,v1]. */
  sign(cx, y0, cz, w, h, facing, uv, e = 1.6) {
    const [u0, v0, u1, v1] = uv, c = [1, 1, 1], hw = w / 2;
    const uvs = [u0, v1, u1, v1, u1, v0, u0, v0];
    if (facing === 's') this.quad([cx - hw, y0, cz], [cx + hw, y0, cz], [cx + hw, y0 + h, cz], [cx - hw, y0 + h, cz], [0, 0, 1], c, e, MAT.SIGN, uvs);
    else if (facing === 'n') this.quad([cx + hw, y0, cz], [cx - hw, y0, cz], [cx - hw, y0 + h, cz], [cx + hw, y0 + h, cz], [0, 0, -1], c, e, MAT.SIGN, uvs);
    else if (facing === 'e') this.quad([cx, y0, cz + hw], [cx, y0, cz - hw], [cx, y0 + h, cz - hw], [cx, y0 + h, cz + hw], [1, 0, 0], c, e, MAT.SIGN, uvs);
    else if (facing === 'w') this.quad([cx, y0, cz - hw], [cx, y0, cz + hw], [cx, y0 + h, cz + hw], [cx, y0 + h, cz - hw], [-1, 0, 0], c, e, MAT.SIGN, uvs);
    else if (facing === 'up') this.quad([cx - hw, y0, cz + h / 2], [cx + hw, y0, cz + h / 2], [cx + hw, y0, cz - h / 2], [cx - hw, y0, cz - h / 2], [0, 1, 0], c, e, MAT.SIGN, uvs);
  }

  /** Wheel: cylinder lying along z (axle) centred at origin, radius r, width w. */
  wheel(r, w, c, hub = [0.75, 0.75, 0.78], seg = 12) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a, z) => [Math.cos(a) * r, Math.sin(a) * r, z];
      const nm = [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0];
      this.quad(p(a0, -w / 2), p(a1, -w / 2), p(a1, w / 2), p(a0, w / 2), nm, c);
      for (const [z, nz] of [[w / 2, 1], [-w / 2, -1]]) {
        const col = (i % 2) ? c : hub;
        const q = (a) => [Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, z];
        if (nz > 0) { this.vert(0, 0, z, 0, 0, 1, hub); this.vert(...p(a0, z), 0, 0, 1, c); this.vert(...p(a1, z), 0, 0, 1, c); }
        else { this.vert(0, 0, z, 0, 0, -1, hub); this.vert(...p(a1, z), 0, 0, -1, c); this.vert(...p(a0, z), 0, 0, -1, c); }
        void col; void q;
      }
    }
  }

  toArray() { return new Float32Array(this.v); }
}

function inset(p, x0, z0, x1, z1, b) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const dx = p[0] - cx, dz = p[1] - cz;
  const sx = Math.sign(dx) * Math.min(Math.abs(dx), (x1 - x0) / 2 - b * 0.7);
  const sz = Math.sign(dz) * Math.min(Math.abs(dz), (z1 - z0) / 2 - b * 0.7);
  return [cx + sx, cz + sz];
}

export const STRIDE = STATIC_STRIDE;
