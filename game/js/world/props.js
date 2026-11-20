// Prop meshes (built once, drawn instanced): trees, palms, street lamps, traffic lights,
// benches, bins, bus stops, beach umbrellas, and the dynamic traffic-signal lamps.
import { MeshBuilder, MAT } from '../engine/mesh-builder.js';

export function treeMesh() {
  const m = new MeshBuilder();
  m.cylinder(0, 0, 0, 0.22, 3.2, [0.36, 0.25, 0.16], { seg: 6, r2: 0.16 });
  m.sphere(0, 4.4, 0, 2.3, [0.2, 0.42, 0.18], { seg: 7, rings: 5, sy: 0.85 });
  m.sphere(0.9, 5.3, 0.5, 1.4, [0.26, 0.5, 0.2], { seg: 6, rings: 4 });
  m.sphere(-0.8, 5.0, -0.6, 1.3, [0.22, 0.46, 0.2], { seg: 6, rings: 4 });
  return m.toArray();
}

export function palmMesh() {
  const m = new MeshBuilder();
  // slightly curved trunk from stacked segments
  let x = 0;
  for (let i = 0; i < 6; i++) {
    const nx = x + 0.12 * i;
    m.cylinder(x, i * 1.25, 0, 0.2 - i * 0.015, 1.3, i % 2 ? [0.5, 0.38, 0.24] : [0.44, 0.33, 0.21], { seg: 6, top: false });
    x = nx;
  }
  const top = [x, 7.5, 0];
  m.sphere(top[0], top[1], top[2], 0.45, [0.4, 0.3, 0.15], { seg: 5, rings: 3 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const L = 3.6, droop = 1.3;
    const tip = [top[0] + ca * L, top[1] - droop, top[2] + sa * L];
    const mid = [top[0] + ca * L * 0.55, top[1] + 0.25, top[2] + sa * L * 0.55];
    const side = [-sa * 0.55, 0, ca * 0.55];
    const g = [0.18 + (i % 3) * 0.03, 0.46 + (i % 2) * 0.06, 0.18];
    m.tri(top, [mid[0] + side[0], mid[1], mid[2] + side[2]], mid, g);
    m.tri(top, mid, [mid[0] - side[0], mid[1], mid[2] - side[2]], g);
    m.tri([mid[0] + side[0], mid[1], mid[2] + side[2]], tip, mid, g);
    m.tri(mid, tip, [mid[0] - side[0], mid[1], mid[2] - side[2]], g);
  }
  return m.toArray();
}

/** Street lamp facing +x (arm reaches over the road). */
export function lampMesh() {
  const m = new MeshBuilder();
  const c = [0.22, 0.24, 0.27];
  m.cylinder(0, 0, 0, 0.11, 7, c, { seg: 6 });
  m.box(0, 6.8, -0.06, 2.2, 6.95, 0.06, c);
  m.box(1.8, 6.6, -0.22, 2.6, 6.85, 0.22, c);
  m.box(1.85, 6.5, -0.18, 2.55, 6.6, 0.18, [1.0, 0.82, 0.55], { mat: MAT.NEON, e: 3.5 });
  return m.toArray();
}

/** Traffic light pole at a corner with its signal housing over the road (+x). */
export function trafficPoleMesh() {
  const m = new MeshBuilder();
  const c = [0.16, 0.17, 0.19];
  m.cylinder(0, 0, 0, 0.12, 5.6, c, { seg: 6 });
  m.box(0, 5.3, -0.07, 3.4, 5.45, 0.07, c);
  m.box(3.0, 4.2, -0.3, 3.5, 5.45, 0.3, [0.1, 0.1, 0.11]);
  m.box(-0.3, 2.0, -0.25, 0.1, 3.1, 0.25, [0.1, 0.1, 0.11]); // pedestrian signal
  return m.toArray();
}
/** One signal lamp (instanced per light, colour/emission set per instance). */
export function signalLampMesh() {
  const m = new MeshBuilder();
  m.box(-0.05, -0.17, -0.17, 0.05, 0.17, 0.17, [1, 1, 1], { mat: MAT.TINT });
  return m.toArray();
}

export function benchMesh() {
  const m = new MeshBuilder();
  const w = [0.55, 0.36, 0.2], f = [0.2, 0.2, 0.22];
  m.box(-0.9, 0.45, -0.25, 0.9, 0.52, 0.25, w);
  m.box(-0.9, 0.55, 0.2, 0.9, 1.0, 0.27, w);
  m.box(-0.8, 0, -0.2, -0.7, 0.45, 0.2, f); m.box(0.7, 0, -0.2, 0.8, 0.45, 0.2, f);
  return m.toArray();
}
export function binMesh() {
  const m = new MeshBuilder();
  m.cylinder(0, 0, 0, 0.3, 0.95, [0.18, 0.42, 0.3], { seg: 8 });
  m.cylinder(0, 0.95, 0, 0.33, 0.06, [0.12, 0.3, 0.2], { seg: 8 });
  return m.toArray();
}
export function busStopMesh() {
  const m = new MeshBuilder();
  const f = [0.25, 0.27, 0.3];
  m.box(-2.2, 0, -0.7, -2.1, 2.6, -0.6, f); m.box(2.1, 0, -0.7, 2.2, 2.6, -0.6, f);
  m.box(-2.3, 2.6, -0.9, 2.3, 2.75, 0.8, [0.2, 0.55, 0.6]);
  m.box(-2.2, 0.2, -0.72, 2.2, 2.5, -0.66, [0.5, 0.65, 0.7], { mat: MAT.GLASS });
  m.box(-1.6, 0.45, -0.6, 1.6, 0.52, -0.2, [0.6, 0.6, 0.62]);
  m.box(1.0, 0.9, -0.64, 2.0, 2.3, -0.6, [0.9, 0.85, 1.0], { mat: MAT.NEON, e: 1.5 });
  return m.toArray();
}
export function umbrellaMesh() {
  const m = new MeshBuilder();
  m.cylinder(0, 0, 0, 0.05, 2.3, [0.85, 0.85, 0.85], { seg: 5 });
  m.cylinder(0, 2.1, 0, 1.6, 0.5, [1, 1, 1], { seg: 8, r2: 0.05, mat: MAT.TINT });
  return m.toArray();
}
export function brokenLampMesh() {
  const m = new MeshBuilder();
  m.box(0, 0.05, -0.1, 7, 0.27, 0.1, [0.22, 0.24, 0.27]);
  return m.toArray();
}
