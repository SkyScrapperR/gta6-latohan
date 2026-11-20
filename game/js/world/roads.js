// Road graph on the (NB+1)^2 intersection lattice: left-hand lane geometry, BFS routing,
// lane spawn points, and the cycling traffic lights that AI and pedestrians obey.
import { CELL, ROAD, NB, LANE, nodePos } from './city.js';
import { hash } from '../core/math.js';

export const NN = NB + 1;
export const nodeId = (i, j) => j * NN + i;
export const nodeIJ = (id) => ({ i: id % NN, j: Math.floor(id / NN) });
export const nodeXZ = (id) => { const { i, j } = nodeIJ(id); return nodePos(i, j); };

export function neighbors(id) {
  const { i, j } = nodeIJ(id), out = [];
  if (i > 0) out.push(nodeId(i - 1, j));
  if (i < NN - 1) out.push(nodeId(i + 1, j));
  if (j > 0) out.push(nodeId(i, j - 1));
  if (j < NN - 1) out.push(nodeId(i, j + 1));
  return out;
}
export function nearestNode(x, z) {
  const i = Math.max(0, Math.min(NN - 1, Math.round((x - ROAD / 2) / CELL)));
  const j = Math.max(0, Math.min(NN - 1, Math.round((z - ROAD / 2) / CELL)));
  return nodeId(i, j);
}
/** Left-hand traffic: lanes sit on the left of the travel direction (x east, z south). */
export function laneOffset(dx, dz) { return { x: dz * LANE, z: -dx * LANE }; }

export function bfsPath(from, to) {
  if (from === to) return [from];
  const prev = new Int16Array(NN * NN).fill(-1);
  prev[from] = from;
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const n = q[h];
    if (n === to) break;
    for (const m of neighbors(n)) if (prev[m] === -1) { prev[m] = n; q.push(m); }
  }
  const path = [to];
  let c = to;
  while (c !== from) { c = prev[c]; if (c < 0) return [from]; path.push(c); }
  return path.reverse();
}

// ---------- traffic lights ----------
// Each intersection cycles: N-S green (9 s), amber (2 s), all-red (1 s), E-W green (9 s), amber (2 s), all-red (1 s).
const CYCLE = 24;
export function signalState(node, axis, time) {
  const t = (time + hash(node, 3) * CYCLE) % CYCLE;
  if (axis === 'ns') return t < 9 ? 'g' : t < 11 ? 'y' : 'r';
  return t >= 12 && t < 21 ? 'g' : t >= 21 && t < 23 ? 'y' : 'r';
}
/** Is the crossing over the road on `axis` safe to walk (traffic on that axis stopped)? */
export function pedestrianGreen(node, axis, time) { return signalState(node, axis, time) === 'r'; }

/** A random lane point in a ring around (cx,cz) but outside the avoid predicate. */
export function laneSpawnPoint(rng, cx, cz, rMin, rMax, avoid) {
  for (let tries = 0; tries < 30; tries++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(rMin, rMax);
    const n = nearestNode(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
    const m = rng.pick(neighbors(n));
    const A = nodeXZ(n), B = nodeXZ(m);
    const dx = Math.sign(B.x - A.x), dz = Math.sign(B.z - A.z);
    const t = rng.range(ROAD + 6, CELL - ROAD - 6);
    const off = laneOffset(dx, dz);
    const x = A.x + dx * t + off.x, z = A.z + dz * t + off.z;
    if (avoid && avoid(x, z)) continue;
    return { x, z, angle: Math.atan2(dz, dx), from: n, to: m };
  }
  return null;
}
