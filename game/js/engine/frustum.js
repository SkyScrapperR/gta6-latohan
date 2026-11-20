// View-frustum extraction and AABB tests for culling.
export function frustumPlanes(m) {
  const p = [];
  const add = (a, b, c, d) => { const l = Math.hypot(a, b, c); p.push([a / l, b / l, c / l, d / l]); };
  add(m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
  add(m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
  add(m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
  add(m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
  add(m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
  add(m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
  return p;
}
/** aabb = [minx,miny,minz,maxx,maxy,maxz] */
export function aabbVisible(planes, b) {
  for (const p of planes) {
    const x = p[0] > 0 ? b[3] : b[0], y = p[1] > 0 ? b[4] : b[1], z = p[2] > 0 ? b[5] : b[2];
    if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
  }
  return true;
}
export function sphereVisible(planes, x, y, z, r) {
  for (const p of planes) if (p[0] * x + p[1] * y + p[2] * z + p[3] < -r) return false;
  return true;
}
