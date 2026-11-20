// Low-poly vehicle meshes per model (body, cabin, glass, bumpers, emissive head/tail lights,
// model details: spoiler, taxi sign, lightbar, cargo box) and the instanced wheel layout.
import { MeshBuilder, MAT } from '../engine/mesh-builder.js';
import { createMesh } from '../engine/gl.js';

const DARK = [0.06, 0.06, 0.07], TRIM = [0.12, 0.12, 0.13], CHROME = [0.7, 0.72, 0.75];

/** Generic car: L length, W width, h body height, cabin [front, rear] as offsets from centre. */
function car(m, { L, W, body = 0.62, cabinH = 0.5, cf, cr, roofInset = 0.16, nose = 0.18 }) {
  const y0 = 0.32, y1 = y0 + body, hx = L / 2, hz = W / 2;
  // lower body (paint) with a slight nose taper
  m.box(-hx, y0, -hz, hx - nose, y1, hz, [1, 1, 1], { mat: MAT.TINT });
  m.box(hx - nose, y0, -hz + 0.05, hx, y1 - 0.12, hz - 0.05, [1, 1, 1], { mat: MAT.TINT });
  // cabin with glass
  const c0 = cr, c1 = cf, ri = roofInset;
  m.box(c0, y1, -hz + ri, c1, y1 + cabinH, hz - ri, [0.1, 0.12, 0.15], { mat: MAT.GLASS, topColor: [1, 1, 1], topMat: MAT.TINT });
  m.box(c0 + 0.12, y1 + cabinH - 0.06, -hz + ri - 0.01, c1 - 0.18, y1 + cabinH + 0.02, hz - ri + 0.01, [1, 1, 1], { mat: MAT.TINT });
  // pillars
  for (const z of [-hz + ri - 0.005, hz - ri - 0.07]) m.box(c0 + (c1 - c0) * 0.48, y1, z, c0 + (c1 - c0) * 0.48 + 0.08, y1 + cabinH, z + 0.075, [1, 1, 1], { mat: MAT.TINT });
  // bumpers + grille + skirts
  m.box(hx - 0.06, y0 - 0.05, -hz + 0.02, hx + 0.08, y0 + 0.22, hz - 0.02, TRIM);
  m.box(-hx - 0.08, y0 - 0.05, -hz + 0.02, -hx + 0.06, y0 + 0.22, hz - 0.02, TRIM);
  m.box(hx - 0.02, y0 + 0.24, -hz * 0.45, hx + 0.02, y0 + 0.4, hz * 0.45, DARK);
  m.box(-hx + 0.3, y0 - 0.06, -hz - 0.01, hx - 0.3, y0 + 0.08, hz + 0.01, TRIM);
  // lights
  for (const s of [-1, 1]) {
    m.box(hx - 0.02, y1 - 0.24, s * (hz - 0.36) - 0.18, hx + 0.03, y1 - 0.1, s * (hz - 0.36) + 0.18, [1, 1, 0.9], { mat: MAT.HEADLIGHT });
    m.box(-hx - 0.03, y1 - 0.24, s * (hz - 0.3) - 0.2, -hx + 0.02, y1 - 0.1, s * (hz - 0.3) + 0.2, [1, 0.1, 0.1], { mat: MAT.TAILLIGHT });
    // mirrors
    m.box(cf - 0.1, y1 + 0.05, s * (hz + 0.08) - 0.06, cf + 0.05, y1 + 0.18, s * (hz + 0.08) + 0.06, [1, 1, 1], { mat: MAT.TINT });
  }
  // wheel arches (dark)
  for (const x of [L * 0.32, -L * 0.32]) for (const s of [-1, 1]) m.box(x - 0.42, y0 - 0.02, s * hz - 0.02, x + 0.42, y0 + 0.36, s * hz + 0.02, DARK, { top: false });
  return y1;
}

export const MODEL_SHAPES = {
  kancil: (m) => car(m, { L: 3.8, W: 1.7, body: 0.6, cabinH: 0.55, cf: 0.75, cr: -1.45, nose: 0.25 }),
  merpati: (m) => car(m, { L: 4.5, W: 1.84, body: 0.58, cabinH: 0.5, cf: 0.85, cr: -1.15 }),
  taxi: (m) => {
    const y = car(m, { L: 4.5, W: 1.84, body: 0.58, cabinH: 0.5, cf: 0.85, cr: -1.15 });
    m.box(-0.35, y + 0.52, -0.3, 0.25, y + 0.78, 0.3, [1, 0.85, 0.3], { mat: MAT.NEON, e: 2.2 });
    for (let i = 0; i < 8; i++) m.box(-2.0 + i * 0.5, 0.62, 0.925, -1.75 + i * 0.5, 0.72, 0.935, i % 2 ? [0.95, 0.95, 0.95] : [0.08, 0.08, 0.08]);
    for (let i = 0; i < 8; i++) m.box(-2.0 + i * 0.5, 0.62, -0.935, -1.75 + i * 0.5, 0.72, -0.925, i % 2 ? [0.95, 0.95, 0.95] : [0.08, 0.08, 0.08]);
  },
  vesper: (m) => {
    const y = car(m, { L: 4.45, W: 1.96, body: 0.5, cabinH: 0.4, cf: 0.45, cr: -1.2, roofInset: 0.22, nose: 0.4 });
    m.box(-2.35, y + 0.1, -0.85, -2.05, y + 0.16, 0.85, DARK);
    for (const s of [-0.7, 0.7]) m.box(-2.25, y - 0.05, s - 0.04, -2.15, y + 0.12, s + 0.04, DARK);
    m.box(-2.2, 0.83, -0.18, 2.2, 0.835, 0.18, [0.05, 0.05, 0.05]); // racing stripe (overridden by tint area)
    for (const s of [-1, 1]) m.box(0.9, 0.6, s * 0.99 - 0.02, 1.9, 0.7, s * 0.99 + 0.02, DARK);
  },
  bajak: (m) => {
    const L = 4.9, W = 1.98, y0 = 0.36;
    m.box(-L / 2, y0, -W / 2, L / 2 - 0.9, 2.1, W / 2, [1, 1, 1], { mat: MAT.TINT });
    m.box(L / 2 - 0.9, y0, -W / 2 + 0.03, L / 2, 1.15, W / 2 - 0.03, [1, 1, 1], { mat: MAT.TINT });
    m.quad([L / 2 - 0.9, 2.1, W / 2 - 0.05], [L / 2 - 0.9, 2.1, -W / 2 + 0.05], [L / 2 - 0.15, 1.15, -W / 2 + 0.05], [L / 2 - 0.15, 1.15, W / 2 - 0.05], [0.8, 0.6, 0], [0.1, 0.12, 0.15], 0, MAT.GLASS);
    for (const s of [-1, 1]) {
      m.box(L / 2 - 1.5, 1.2, s * W / 2 - 0.02, L / 2 - 0.95, 1.85, s * W / 2 + 0.02, [0.1, 0.12, 0.15], { mat: MAT.GLASS });
      m.box(L / 2 - 0.05, 0.75, s * 0.62 - 0.17, L / 2 + 0.03, 0.92, s * 0.62 + 0.17, [1, 1, 0.9], { mat: MAT.HEADLIGHT });
      m.box(-L / 2 - 0.03, 0.8, s * 0.8 - 0.12, -L / 2 + 0.02, 1.3, s * 0.8 + 0.12, [1, 0.1, 0.1], { mat: MAT.TAILLIGHT });
    }
    m.box(L / 2 - 0.05, y0 - 0.05, -W / 2, L / 2 + 0.1, y0 + 0.22, W / 2, TRIM);
    m.box(-L / 2 - 0.1, y0 - 0.05, -W / 2, -L / 2 + 0.05, y0 + 0.22, W / 2, TRIM);
    m.box(-L / 2 + 0.2, 2.1, -0.7, L / 2 - 1.2, 2.18, 0.7, TRIM);
  },
  bison: (m) => {
    const L = 7.6, W = 2.45;
    // cab
    m.box(L / 2 - 1.9, 0.5, -W / 2, L / 2, 2.4, W / 2, [1, 1, 1], { mat: MAT.TINT });
    m.box(L / 2 - 0.05, 1.35, -W / 2 + 0.15, L / 2 + 0.02, 2.2, W / 2 - 0.15, [0.1, 0.12, 0.15], { mat: MAT.GLASS });
    for (const s of [-1, 1]) {
      m.box(L / 2 - 1.3, 1.4, s * W / 2 - 0.02, L / 2 - 0.3, 2.15, s * W / 2 + 0.02, [0.1, 0.12, 0.15], { mat: MAT.GLASS });
      m.box(L / 2 - 0.02, 0.8, s * 0.85 - 0.18, L / 2 + 0.04, 1.0, s * 0.85 + 0.18, [1, 1, 0.9], { mat: MAT.HEADLIGHT });
      m.box(-L / 2 - 0.03, 0.75, s * 1.0 - 0.12, -L / 2 + 0.02, 1.1, s * 1.0 + 0.12, [1, 0.1, 0.1], { mat: MAT.TAILLIGHT });
    }
    m.box(L / 2 - 0.05, 0.4, -W / 2, L / 2 + 0.12, 0.75, W / 2, TRIM);
    // cargo box
    m.box(-L / 2, 0.75, -W / 2 - 0.05, L / 2 - 2.0, 3.4, W / 2 + 0.05, [0.9, 0.9, 0.88]);
    for (let x = -L / 2 + 0.4; x < L / 2 - 2.2; x += 0.6) for (const s of [-1, 1]) m.box(x, 0.8, s * (W / 2 + 0.05) - 0.02, x + 0.06, 3.35, s * (W / 2 + 0.05) + 0.02, [0.7, 0.7, 0.7], { top: false });
    for (const s of [-1, 1]) m.box(-L / 2 + 0.8, 1.6, s * (W / 2 + 0.08) - 0.01, L / 2 - 2.8, 2.5, s * (W / 2 + 0.08) + 0.01, [1, 1, 1], { mat: MAT.TINT });
    m.box(-L / 2, 0.45, -W / 2 + 0.2, L / 2 - 1.9, 0.75, W / 2 - 0.2, DARK);
  },
  patrol: (m) => {
    const y = car(m, { L: 4.7, W: 1.9, body: 0.6, cabinH: 0.5, cf: 0.85, cr: -1.2 });
    // navy doors over the white paint
    for (const s of [-1, 1]) m.box(-1.0, 0.45, s * 0.95 - 0.015, 0.9, y - 0.05, s * 0.95 + 0.015, [0.08, 0.13, 0.32]);
    m.box(1.4, y - 0.01, -0.7, 2.2, y + 0.005, 0.7, [0.08, 0.13, 0.32]);
    // lightbar
    m.box(-0.3, y + 0.5, -0.75, 0.15, y + 0.58, 0.75, DARK);
    m.box(-0.28, y + 0.58, -0.72, 0.13, y + 0.75, -0.02, [1, 0.1, 0.1], { mat: MAT.SIREN_R });
    m.box(-0.28, y + 0.58, 0.02, 0.13, y + 0.75, 0.72, [0.1, 0.2, 1], { mat: MAT.SIREN_B });
    m.box(2.28, 0.3, -0.8, 2.45, 0.7, 0.8, DARK); // push bar
  },
};

export const WHEELS = {
  kancil: { x: 1.2, z: 0.76, r: 0.3 }, merpati: { x: 1.4, z: 0.82, r: 0.33 }, taxi: { x: 1.4, z: 0.82, r: 0.33 }, vesper: { x: 1.42, z: 0.88, r: 0.35 },
  bajak: { x: 1.6, z: 0.88, r: 0.36 }, bison: { x: 2.8, z: 1.08, r: 0.48, rear: -2.4 }, patrol: { x: 1.48, z: 0.84, r: 0.34 },
};

let meshes = null;
export function buildVehicleMeshes(gl) {
  meshes = {};
  for (const k in MODEL_SHAPES) { const m = new MeshBuilder(); MODEL_SHAPES[k](m); meshes[k] = createMesh(gl, m.toArray()); }
  return meshes;
}
export function vehicleMesh(model) { return meshes[model]; }
