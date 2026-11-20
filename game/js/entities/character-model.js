// Low-poly humanoid built from beveled boxes with hierarchical transforms and procedural
// animation: idle breathing, walk/run cycles with knee bend and bob, aim pose, punch,
// hit reaction, death fall, jump, and a seated pose. All characters share one instanced batch.
import { mat4, clamp, lerp } from '../core/math.js';
import { MeshBuilder, MAT } from '../engine/mesh-builder.js';
import { createMesh } from '../engine/gl.js';
import { InstanceBatch } from '../engine/instancing.js';

export const SKINS = [[1.0, 0.86, 0.72], [0.93, 0.74, 0.58], [0.8, 0.58, 0.42], [0.66, 0.45, 0.31], [0.5, 0.33, 0.22], [0.38, 0.25, 0.17]];
export const HAIRS = [[0.12, 0.09, 0.08], [0.24, 0.16, 0.1], [0.44, 0.28, 0.16], [0.78, 0.62, 0.36], [0.06, 0.06, 0.06], [0.6, 0.6, 0.6], [0.66, 0.24, 0.16]];
export const SHIRTS = [[0.9, 0.27, 0.27], [0.27, 0.55, 0.86], [0.98, 0.82, 0.27], [0.35, 0.75, 0.47], [0.94, 0.94, 0.94], [0.94, 0.51, 0.2], [0.63, 0.35, 0.78], [0.16, 0.2, 0.24], [0.98, 0.59, 0.75], [0.31, 0.78, 0.82]];
export const PANTS = [[0.16, 0.2, 0.31], [0.24, 0.24, 0.26], [0.47, 0.39, 0.31], [0.12, 0.12, 0.13], [0.78, 0.75, 0.63]];

export const OUTFITS = {
  kai: { skin: [0.8, 0.58, 0.42], hair: [0.08, 0.07, 0.06], shirt: [0.92, 0.92, 0.9], jacket: [0.1, 0.69, 0.66], pants: [0.14, 0.16, 0.22], hairStyle: 1 },
  cop: { hair: [0.1, 0.1, 0.12], shirt: [0.16, 0.25, 0.5], pants: [0.09, 0.12, 0.2], cap: [0.1, 0.13, 0.27] },
  gang: { hair: [0.08, 0.08, 0.09], shirt: [0.46, 0.16, 0.66], jacket: [0.3, 0.1, 0.42], pants: [0.11, 0.09, 0.13], bandana: [0.78, 0.27, 0.9] },
  boss: { skin: [0.84, 0.66, 0.5], hair: [0.3, 0.3, 0.32], shirt: [0.6, 0.2, 0.86], jacket: [0.93, 0.92, 0.95], pants: [0.93, 0.92, 0.95], hairStyle: 2 },
  dex: { skin: [0.7, 0.49, 0.35], hair: [0.12, 0.11, 0.1], shirt: [0.55, 0.82, 0.24], jacket: [0.45, 0.72, 0.2], pants: [0.16, 0.16, 0.18], hood: true },
  lin: { skin: [0.87, 0.7, 0.55], hair: [0.8, 0.8, 0.84], shirt: [0.94, 0.55, 0.16], pants: [0.24, 0.24, 0.28], hairStyle: 3 },
  rendy: { skin: [0.84, 0.64, 0.48], hair: [0.16, 0.11, 0.08], shirt: [1, 0.88, 0.3], pants: [0.9, 0.9, 0.88], hairStyle: 1 },
};

let batch = null;
export function createCharacterBatch(gl) {
  const m = new MeshBuilder();
  m.bevelBox(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.12, [1, 1, 1], { mat: MAT.TINT, bottom: true });
  batch = new InstanceBatch(createMesh(gl, m.toArray()), { name: 'characters' });
  return batch;
}
export function characterBatch() { return batch; }

/** Random look for a pedestrian. */
export function randomLook(rng) {
  return {
    skin: rng.pick(SKINS), hair: rng.pick(HAIRS), shirt: rng.pick(SHIRTS), pants: rng.pick(PANTS),
    hairStyle: rng.int(0, 3), width: rng.range(0.9, 1.15), height: rng.range(0.92, 1.08),
    jacket: rng.chance(0.25) ? rng.pick(SHIRTS) : null,
  };
}
export function outfitLook(name, rng) {
  const base = rng ? randomLook(rng) : { skin: SKINS[2], hairStyle: 0, width: 1, height: 1 };
  return { ...base, ...OUTFITS[name] };
}

const M = mat4.create(), T = mat4.create(), J = mat4.create();
const stack = [];
function push(m) { stack.push(Float32Array.from(m)); }
function pop(m) { m.set(stack.pop()); }
/** Emit a box: current joint matrix j, offset (cx,cy,cz), size (sx,sy,sz), colour. */
function part(j, cx, cy, cz, sx, sy, sz, c, emissive = 0) {
  mat4.translate(T, j, cx, cy, cz);
  mat4.scale(T, T, sx, sy, sz);
  batch.pushMatrix(T, c[0], c[1], c[2], emissive);
}

/**
 * Emit a character into the shared batch.
 * a = { x, y, z, yaw, look, walk (phase), speed (0 idle .. 1 walk .. 2 run), aim (0..1), punch (0..1),
 *       hit (0..1), dead (0..1 fall progress), jump (height), seated, weapon, phone, gesture, breath }
 */
export function drawCharacter(a) {
  const L = a.look, h = L.height || 1, w = L.width || 1;
  const sp = a.speed || 0;
  const run = clamp(sp - 1, 0, 1), walk = clamp(sp, 0, 1);
  const ph = a.walk || 0;
  const swing = Math.sin(ph) * (0.45 * walk + 0.35 * run);
  const bob = Math.abs(Math.sin(ph)) * 0.05 * walk + (a.breath ? Math.sin(a.breath) * 0.006 : 0);
  // root: position, heading, death fall (pivot at the feet)
  mat4.trs(M, a.x, a.y + (a.jump || 0), a.z, a.yaw);
  if (a.dead) { mat4.translate(M, M, -0.2 * a.dead, 0.12 * a.dead, 0); mat4.rotateZ(M, M, -a.dead * Math.PI / 2 * 0.98); }
  mat4.scale(M, M, w, h, w);
  const skin = L.skin, shirt = L.shirt, pants = L.pants, jacket = L.jacket || shirt;
  const seated = !!a.seated;
  // pelvis
  mat4.translate(J, M, 0, seated ? 0.55 : 0.95 + bob, 0);
  const lean = run * 0.18 + (a.hit || 0) * -0.25 + (a.punch ? Math.sin(a.punch * Math.PI) * 0.15 : 0);
  mat4.rotateZ(J, J, -lean);
  part(J, 0, 0.02, 0, 0.26, 0.2, 0.36, pants);
  // legs
  for (const side of [-1, 1]) {
    push(J);
    mat4.translate(J, J, 0, -0.04, side * 0.11);
    const legSwing = seated ? Math.PI / 2 : swing * side;
    mat4.rotateZ(J, J, legSwing);
    part(J, 0, -0.22, 0, 0.17, 0.46, 0.16, pants);
    mat4.translate(J, J, 0, -0.44, 0);
    const knee = seated ? -Math.PI / 2 : -Math.max(0, Math.sin(ph + (side > 0 ? 0 : Math.PI) - 0.6)) * (0.5 * walk + 0.7 * run) - (a.jump ? 0.6 : 0);
    mat4.rotateZ(J, J, knee);
    part(J, 0, -0.22, 0, 0.14, 0.44, 0.14, pants);
    part(J, 0.06, -0.47, 0, 0.27, 0.08, 0.14, [0.08, 0.08, 0.09]);
    pop(J);
  }
  // torso
  mat4.translate(J, J, 0, 0.1, 0);
  const twist = a.aim ? -0.25 * a.aim : 0;
  if (twist) mat4.rotateY(J, J, twist);
  part(J, 0, 0.29, 0, 0.27, 0.56, 0.44, jacket);
  if (L.jacket) part(J, 0.12, 0.3, 0, 0.06, 0.5, 0.16, shirt);
  if (L.bandana) part(J, 0.0, 0.52, 0, 0.29, 0.06, 0.46, L.bandana);
  // head
  push(J);
  mat4.translate(J, J, 0, 0.6, 0);
  if (a.phone) mat4.rotateZ(J, J, -0.35);
  part(J, 0, 0.05, 0, 0.07, 0.1, 0.07, skin);
  part(J, 0.01, 0.2, 0, 0.24, 0.26, 0.22, skin);
  if (L.cap) { part(J, 0, 0.33, 0, 0.26, 0.08, 0.24, L.cap); part(J, 0.14, 0.3, 0, 0.12, 0.03, 0.2, L.cap); }
  else if (L.hood) part(J, -0.03, 0.24, 0, 0.27, 0.3, 0.27, jacket);
  else {
    const hs = L.hairStyle || 0, hc = L.hair;
    if (hs === 0) part(J, -0.02, 0.32, 0, 0.26, 0.07, 0.24, hc);
    else if (hs === 1) { part(J, -0.02, 0.33, 0, 0.27, 0.1, 0.25, hc); part(J, 0.1, 0.36, 0.03, 0.08, 0.06, 0.16, hc); }
    else if (hs === 2) { part(J, -0.03, 0.31, 0, 0.27, 0.06, 0.24, hc); part(J, -0.12, 0.22, 0, 0.05, 0.2, 0.22, hc); }
    else { part(J, -0.02, 0.32, 0, 0.26, 0.08, 0.24, hc); part(J, -0.14, 0.36, 0, 0.12, 0.12, 0.12, hc); }
  }
  pop(J);
  // arms
  for (const side of [-1, 1]) {
    push(J);
    mat4.translate(J, J, 0, 0.5, side * 0.27);
    let sh, el, raise = 0;
    if (seated) { sh = 1.2; el = 0.3; }
    else if (a.aim && side > 0) { sh = Math.PI / 2 * a.aim + (-swing) * (1 - a.aim); el = 0; raise = 0.0; }
    else if (a.aim && side < 0) { sh = 1.2 * a.aim + (swing) * (1 - a.aim); el = 0.7 * a.aim; }
    else if (a.punch && side > 0) { const p = Math.sin(a.punch * Math.PI); sh = 0.3 + p * 1.25; el = 1.2 * (1 - p); }
    else if (a.phone && side > 0) { sh = 0.6; el = 2.2; }
    else if (a.gesture) { sh = 0.5 + Math.sin(a.gesture * 3 + side) * 0.4; el = 0.6; }
    else { sh = -swing * side * 1.1 + (a.hit ? 0.6 : 0); el = 0.25 + run * 0.9; }
    if (a.dead) { sh = 2.6; el = 0.2; }
    mat4.rotateZ(J, J, sh);
    if (side < 0 && a.aim) mat4.rotateX(J, J, 0.55 * a.aim);
    part(J, 0, -0.15, 0, 0.12, 0.32, 0.12, jacket);
    mat4.translate(J, J, 0, -0.3, 0);
    mat4.rotateZ(J, J, el);
    part(J, 0, -0.13, 0, 0.1, 0.28, 0.1, L.jacket ? jacket : skin);
    part(J, 0, -0.3, 0, 0.09, 0.1, 0.09, skin);
    if (side > 0 && a.weapon && a.weapon !== 'fists') {
      const len = a.weapon === 'thunder' ? 0.62 : a.weapon === 'wasp' ? 0.42 : 0.24;
      part(J, len / 2 - 0.05, -0.33, 0, len, 0.07, 0.05, [0.08, 0.08, 0.09]);
      part(J, 0.02, -0.4, 0, 0.06, 0.14, 0.05, [0.08, 0.08, 0.09]);
      if (a.weapon === 'thunder') part(J, -0.12, -0.33, 0, 0.18, 0.09, 0.06, [0.4, 0.25, 0.12]);
    }
    if (side > 0 && a.phone) part(J, 0.02, -0.36, 0.05, 0.03, 0.14, 0.08, [0.1, 0.1, 0.12], 0.6);
    pop(J);
  }
}

/** Muzzle position in world space for an armed character (approximate). */
export function muzzlePoint(x, y, z, yaw, weapon) {
  const len = weapon === 'thunder' ? 1.2 : weapon === 'wasp' ? 1.0 : 0.85;
  const ca = Math.cos(-yaw), sa = Math.sin(-yaw);
  return [x + ca * len - sa * 0.27, y + 1.45, z + sa * len + ca * 0.27];
}
