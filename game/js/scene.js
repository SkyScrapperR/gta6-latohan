// Per-frame scene assembly: pushes characters, vehicles, signals, particles, light volumes and
// dynamic lights into the renderer, and configures camera + environment + post effects.
import { G } from './core/state.js';
import { mat4 } from './core/math.js';
import { rig } from './camera-rig.js';
import { computeEnvironment } from './engine/sky.js';
import { characterBatch } from './entities/character-model.js';
import { packParticles } from './fx/particles.js';
import { collectLights } from './fx/lights.js';
import { signalState } from './world/roads.js';
import { rebuildLamps } from './world/city-meshes.js';
import { drawHeli } from './ai/police.js';

const tmp = mat4.create();
let beamMeshes = null;
export function setBeamMeshes(m) { beamMeshes = m; }

export function assembleScene(R, dt) {
  computeEnvironment(R.env, G.clock, G.weather.rain);
  // camera
  R.camera.pos = rig.pos; R.camera.target = rig.target; R.camera.fov = rig.fov;
  R.shadowFocus = G.player ? [G.player.x, 0, G.player.z] : rig.target;
  // characters
  const cb = characterBatch();
  cb.clear();
  const cam = rig.pos;
  const near = (x, z, d) => Math.abs(x - cam[0]) < d && Math.abs(z - cam[2]) < d;
  if (G.player) G.player.draw();
  for (const p of G.peds) if (!p.vehicle && near(p.x, p.z, 160)) p.draw();
  // vehicles + wheels
  R.dynamic.length = 0;
  const wb = G.props.wheels; wb.clear();
  for (const v of G.vehicles) if (near(v.x, v.z, 260)) v.pushDraw(R, wb);
  drawHeli(R);
  // traffic signals near the camera
  const sb = G.props.signals; sb.clear();
  for (const s of G.city.signals) {
    if (!near(s.x, s.z, 140)) continue;
    const st = signalState(s.node, s.axis, G.time);
    const ca = Math.cos(-s.yaw), sa = Math.sin(-s.yaw);
    const hx = s.x + ca * 3.25, hz = s.z + sa * 3.25;
    const lamps = [['r', 5.15, [1, 0.08, 0.05]], ['y', 4.8, [1, 0.6, 0.05]], ['g', 4.45, [0.1, 1, 0.35]]];
    for (const [k, y, c] of lamps) {
      const on = st === k;
      for (const side of [-1, 1]) {
        mat4.trs(tmp, hx - sa * 0.31 * side * 0, y, hz, s.yaw);
        mat4.translate(tmp, tmp, 0, 0, 0);
        sb.pushMatrix(tmp, on ? c[0] : c[0] * 0.15, on ? c[1] : c[1] * 0.15, on ? c[2] : c[2] * 0.15, on ? 3.5 : 0);
        break;
      }
    }
  }
  if (G.city.lampsDirty) { rebuildLamps(G.city, G.props.lamps, G.props.broken); G.city.lampsDirty = false; }
  // light volumes (heli spotlight cone, mission markers, waypoint beam)
  R.beams.length = 0;
  G.markerLights = [];
  if (beamMeshes) {
    if (G.heli && G.heli.spotOn) {
      const h = G.heli;
      const dx = h.spotX - h.x, dy = 0 - h.y, dz = h.spotZ - h.z, L = Math.hypot(dx, dy, dz);
      const m = mat4.create();
      mat4.translate(m, m, h.x, h.y - 1.2, h.z);
      const yaw = Math.atan2(dx, dz), pitch = Math.acos(-dy / L);
      mat4.rotateY(m, m, yaw); mat4.rotateX(m, m, -pitch); mat4.rotateX(m, m, Math.PI);
      mat4.scale(m, m, 4.5, L, 4.5);
      R.beams.push({ mesh: beamMeshes.cone, model: m, color: [1, 1, 0.9], alpha: 0.12 + 0.2 * R.env.night, fadeTop: false });
    }
    G.markers = G.collectMarkers ? G.collectMarkers() : [];
    for (const mk of G.markers) {
      const m = mat4.create(); mat4.trs(m, mk.x, mk.y || 0.15, mk.z, 0, mk.r, mk.h || 4, mk.r);
      R.beams.push({ mesh: beamMeshes.cylinder, model: m, color: mk.color, alpha: mk.r > 2.5 ? 0.45 : 0.85, fadeTop: true });
      G.markerLights.push({ x: mk.x, y: 1.5, z: mk.z, r: mk.r * 5, color: mk.color, intensity: 1.8 });
    }
  }
  collectLights(R, dt);
  packParticles(R);
  // post
  const P = R.post_;
  P.blur = G.mode === 'paused' || G.mode === 'map' ? 1 : 0;
  P.desat = G.mode === 'dead' || G.mode === 'busted' ? Math.min(1, (G.deathT || 0) * 0.9) * 0.85 : 0;
  P.grade = G.mode === 'dead' ? [1.1, 0.85, 0.85] : [1, 1, 1];
}
