// Road graph: intersections on a 13x13 lattice, lane geometry for left-hand traffic,
// BFS routing for police/AI, and spawn points on lanes.
import { CELL, ROAD, NB, LANE, nodePos } from './city.js';

export const NN = NB + 1; // nodes per side
export const nodeId = (i, j) => j * NN + i;
export const nodeIJ = (id) => ({ i: id % NN, j: Math.floor(id / NN) });
export const nodeXY = (id) => { const { i, j } = nodeIJ(id); return nodePos(i, j); };

export function neighbors(id) {
  const { i, j } = nodeIJ(id);
  const out = [];
  if (i > 0) out.push(nodeId(i - 1, j));
  if (i < NN - 1) out.push(nodeId(i + 1, j));
  if (j > 0) out.push(nodeId(i, j - 1));
  if (j < NN - 1) out.push(nodeId(i, j + 1));
  return out;
}

export function nearestNode(x, y) {
  const i = Math.max(0, Math.min(NN - 1, Math.round((x - ROAD / 2) / CELL)));
  const j = Math.max(0, Math.min(NN - 1, Math.round((y - ROAD / 2) / CELL)));
  return nodeId(i, j);
}

/** Left-hand traffic: the lane sits on the LEFT of the direction of travel (screen y points down). */
export function laneOffset(dx, dy) { return { x: dy * LANE, y: -dx * LANE }; }

/** Shortest node path (inclusive) by BFS on the lattice. */
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

/** Which road edge (from -> to) is the point on, if any; direction chosen from the given heading. */
export function edgeAt(x, y, ax, ay) {
  const fi = (x - ROAD / 2) / CELL, fj = (y - ROAD / 2) / CELL;
  const onV = Math.abs(fi - Math.round(fi)) * CELL < ROAD / 2;
  const onH = Math.abs(fj - Math.round(fj)) * CELL < ROAD / 2;
  if (onH && (!onV || Math.abs(ax) >= Math.abs(ay))) {
    const j = Math.round(fj);
    const i0 = Math.max(0, Math.min(NN - 2, Math.floor(fi)));
    return ax >= 0 ? { from: nodeId(i0, j), to: nodeId(i0 + 1, j) } : { from: nodeId(i0 + 1, j), to: nodeId(i0, j) };
  }
  if (onV) {
    const i = Math.round(fi);
    const j0 = Math.max(0, Math.min(NN - 2, Math.floor(fj)));
    return ay >= 0 ? { from: nodeId(i, j0), to: nodeId(i, j0 + 1) } : { from: nodeId(i, j0 + 1), to: nodeId(i, j0) };
  }
  return null;
}

/** A random point on a lane, inside a ring around (cx,cy) but outside the given rect. */
export function laneSpawnPoint(rng, cx, cy, rMin, rMax, avoidRect) {
  for (let tries = 0; tries < 30; tries++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(rMin, rMax);
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    const n = nearestNode(px, py);
    const nb = neighbors(n);
    const m = rng.pick(nb);
    const A = nodeXY(n), B = nodeXY(m);
    const dx = Math.sign(B.x - A.x), dy = Math.sign(B.y - A.y);
    const t = rng.range(ROAD, CELL - ROAD);
    const off = laneOffset(dx, dy);
    const x = A.x + dx * t + off.x, y = A.y + dy * t + off.y;
    if (avoidRect && x > avoidRect.x0 && x < avoidRect.x1 && y > avoidRect.y0 && y < avoidRect.y1) continue;
    return { x, y, angle: Math.atan2(dy, dx), from: n, to: m };
  }
  return null;
}
