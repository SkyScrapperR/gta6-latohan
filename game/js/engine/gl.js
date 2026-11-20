// Thin WebGL2 layer: context creation, shader compilation with uniform caching,
// vertex layouts / VAOs, dynamic instance buffers, textures and framebuffers.

export const STATIC_LAYOUT = [
  // name, size  — interleaved per-vertex attributes (13 floats)
  ['aPos', 3], ['aNormal', 3], ['aColor', 3], ['aEmissive', 1], ['aMat', 1], ['aUV', 2],
];
export const STATIC_STRIDE = 13;
export const ATTR = { aPos: 0, aNormal: 1, aColor: 2, aEmissive: 3, aMat: 4, aUV: 5, iModel: 6, iColor: 10, iParams: 11 };

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  return gl;
}

export function compileProgram(gl, vs, fs, name = 'program', defines = '') {
  const header = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2DShadow;\n' + defines + '\n';
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, header + src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = (header + src).split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
      throw new Error(`${name} ${type === gl.VERTEX_SHADER ? 'VS' : 'FS'} compile error:\n${log}\n${lines}`);
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  for (const k in ATTR) gl.bindAttribLocation(p, ATTR[k], k);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name} link error: ${gl.getProgramInfoLog(p)}`);
  const cache = new Map();
  const loc = (n) => { if (!cache.has(n)) cache.set(n, gl.getUniformLocation(p, n)); return cache.get(n); };
  return {
    prog: p, name, loc,
    use() { gl.useProgram(p); return this; },
    f1(n, v) { const l = loc(n); if (l) gl.uniform1f(l, v); return this; },
    i1(n, v) { const l = loc(n); if (l) gl.uniform1i(l, v); return this; },
    f2(n, a, b) { const l = loc(n); if (l) gl.uniform2f(l, a, b); return this; },
    f3(n, v) { const l = loc(n); if (l) gl.uniform3fv(l, v); return this; },
    f4(n, v) { const l = loc(n); if (l) gl.uniform4fv(l, v); return this; },
    m4(n, m) { const l = loc(n); if (l) gl.uniformMatrix4fv(l, false, m); return this; },
  };
}

/** Static mesh VAO from an interleaved Float32Array (STATIC_LAYOUT) and optional Uint32 indices. */
export function createMesh(gl, data, indices = null) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  let off = 0;
  for (const [name, size] of STATIC_LAYOUT) {
    const l = ATTR[name];
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, size, gl.FLOAT, false, STATIC_STRIDE * 4, off * 4);
    off += size;
  }
  let ibo = null, count = data.length / STATIC_STRIDE;
  if (indices) {
    ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    count = indices.length;
  }
  // instance attributes (model mat4 + color + params) live in a separate buffer bound per draw
  const inst = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  const istride = 16 + 3 + 4;
  for (let i = 0; i < 4; i++) {
    gl.enableVertexAttribArray(ATTR.iModel + i);
    gl.vertexAttribPointer(ATTR.iModel + i, 4, gl.FLOAT, false, istride * 4, i * 16);
    gl.vertexAttribDivisor(ATTR.iModel + i, 1);
  }
  gl.enableVertexAttribArray(ATTR.iColor);
  gl.vertexAttribPointer(ATTR.iColor, 3, gl.FLOAT, false, istride * 4, 64);
  gl.vertexAttribDivisor(ATTR.iColor, 1);
  gl.enableVertexAttribArray(ATTR.iParams);
  gl.vertexAttribPointer(ATTR.iParams, 4, gl.FLOAT, false, istride * 4, 76);
  gl.vertexAttribDivisor(ATTR.iParams, 1);
  gl.bindVertexArray(null);
  return { vao, vbo, ibo, inst, count, indexed: !!indices, instCap: 0 };
}
export const INSTANCE_STRIDE = 23; // mat4 + color3 + params4

/** Upload instance data (Float32Array of INSTANCE_STRIDE floats each) into the mesh's instance buffer. */
export function uploadInstances(gl, mesh, data, count) {
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.inst);
  const bytes = count * INSTANCE_STRIDE * 4;
  if (bytes > mesh.instCap) { gl.bufferData(gl.ARRAY_BUFFER, Math.max(bytes, 4096) * 2, gl.DYNAMIC_DRAW); mesh.instCap = Math.max(bytes, 4096) * 2; }
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * INSTANCE_STRIDE);
}

export function drawMesh(gl, mesh, instances = 0) {
  gl.bindVertexArray(mesh.vao);
  if (instances > 0) {
    if (mesh.indexed) gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0, instances);
    else gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.count, instances);
  } else {
    // non-instanced draws still read the instance attributes: feed an identity default
    for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(ATTR.iModel + i);
    gl.disableVertexAttribArray(ATTR.iColor); gl.disableVertexAttribArray(ATTR.iParams);
    if (mesh.indexed) gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    else gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    for (let i = 0; i < 4; i++) gl.enableVertexAttribArray(ATTR.iModel + i);
    gl.enableVertexAttribArray(ATTR.iColor); gl.enableVertexAttribArray(ATTR.iParams);
  }
}

export function createTexture(gl, w, h, { internal = gl.RGBA8, format = gl.RGBA, type = gl.UNSIGNED_BYTE, filter = gl.LINEAR, wrap = gl.CLAMP_TO_EDGE, data = null } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return t;
}

export function textureFromCanvas(gl, canvas, mips = true) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** Framebuffer with an HDR (or LDR) colour texture and optional depth (renderbuffer or texture). */
export function createTarget(gl, w, h, { hdr = true, depth = false, depthTexture = false, colour = true } = {}) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  let tex = null, depthTex = null, rb = null;
  if (colour) {
    tex = createTexture(gl, w, h, hdr ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT } : {});
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  }
  if (depthTexture) {
    depthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
  } else if (depth) {
    rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  }
  if (!colour) { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex, depthTex, rb, w, h };
}

export function deleteTarget(gl, t) {
  if (!t) return;
  gl.deleteFramebuffer(t.fb);
  if (t.tex) gl.deleteTexture(t.tex);
  if (t.depthTex) gl.deleteTexture(t.depthTex);
  if (t.rb) gl.deleteRenderbuffer(t.rb);
}
