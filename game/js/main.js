// Boot, fixed-timestep main loop and the top-level state machine (stage 4 harness).
import { G } from './core/state.js';
import { input, initInput, endFrameInput, wasPressed, loadBindings } from './core/input.js';
import { createGL, createMesh } from './engine/gl.js';
import { Renderer } from './engine/renderer.js';
import { MeshBuilder } from './engine/mesh-builder.js';
import { InstanceBatch } from './engine/instancing.js';
import { generateCity, LAND, SHORE_Z } from './world/city.js';
import { buildCityMeshes } from './world/city-meshes.js';
import { buildCollision } from './world/collision.js';
import { SignAtlas } from './world/signs.js';
import { rig, updateCamera } from './camera-rig.js';
import { createCharacterBatch } from './entities/character-model.js';
import { Player } from './entities/player.js';
import { updateParticles } from './fx/particles.js';
import { assembleScene, setBeamMeshes } from './scene.js';

const canvas = document.getElementById('gl');
const hud = document.getElementById('hud');
const params = new URLSearchParams(location.search);
G.debug.shot = +(params.get('shot') || 0);
window.__G = G;

function resize() {
  G.W = innerWidth; G.H = innerHeight;
  canvas.width = G.W; canvas.height = G.H; hud.width = G.W; hud.height = G.H;
  if (G.renderer) G.renderer.resize(G.W, G.H);
}

function buildBeamMeshes(gl) {
  const cyl = new MeshBuilder(); cylinderUV(cyl, 1, 1, 18);
  const cone = new MeshBuilder(); cylinderUV(cone, 0.08, 1, 16, true);
  return { cylinder: createMesh(gl, cyl.toArray()), cone: createMesh(gl, cone.toArray()) };
}
function cylinderUV(m, r0, r1, seg, cone = false) {
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const p = (c, s, r, y) => [c * r, y, s * r];
    m.quad(p(c0, s0, r0, 0), p(c1, s1, r0, 0), p(c1, s1, r1, 1), p(c0, s0, r1, 1), [(c0 + c1) / 2, 0, (s0 + s1) / 2], [1, 1, 1], 0, 0, [0, 0, 1, 0, 1, 1, 0, 1]);
  }
}

let last = 0, acc = 0;
function frame(now) {
  let dtReal = Math.min(0.1, (now - last) / 1000); last = now;
  G.realTime += dtReal;
  const step = 1 / 60;
  acc += dtReal * G.simSpeed * G.timeScale;
  let n = 0;
  while (acc >= step && n < 12) { tick(step); acc -= step; n++; }
  if (n >= 12) acc = 0;
  updateCamera(dtReal);
  assembleScene(G.renderer, dtReal);
  G.renderer.render(G.time);
  endFrameInput();
  window.__frames = (window.__frames || 0) + 1;
  requestAnimationFrame(frame);
}

function tick(dt) {
  G.time += dt; G.dt = dt;
  if (!G.clockFrozen) G.clock = (G.clock + dt) % 1440;
  if (G.player) G.player.update(dt);
  updateParticles(dt);
}

async function boot() {
  const fill = document.getElementById('boot-fill'), msg = document.getElementById('boot-msg');
  const step = (p, m) => new Promise((res) => { fill.style.width = p + '%'; msg.textContent = m; setTimeout(res, 20); });
  await step(5, 'Starting the engine…');
  G.gl = createGL(canvas);
  G.renderer = new Renderer(G.gl);
  G.renderer.setQuality(params.get('q') || 'high');
  resize(); addEventListener('resize', resize);
  await step(20, 'Laying roads…');
  G.city = generateCity(1337);
  await step(45, 'Raising towers…');
  G.atlas = new SignAtlas();
  const built = buildCityMeshes(G.gl, G.city, G.atlas);
  G.renderer.atlas = G.atlas.upload(G.gl);
  G.renderer.statics = built.statics;
  G.props = built.batches;
  G.props.characters = createCharacterBatch(G.gl);
  G.props.wheels = new InstanceBatch(createMesh(G.gl, (() => { const m = new MeshBuilder(); m.wheel(0.34, 0.24, [0.07, 0.07, 0.08]); return m.toArray(); })()), { name: 'wheels' });
  G.renderer.batches = Object.values(G.props);
  G.renderer.land = [LAND.x0, LAND.z0, LAND.x1, SHORE_Z];
  setBeamMeshes(buildBeamMeshes(G.gl));
  await step(70, 'Mapping collisions…');
  buildCollision(G.city);
  loadBindings();
  initInput(hud);
  const L = G.city.landmarks;
  G.player = new Player(L.safehouse.x, L.safehouse.z + 6);
  G.clock = +(params.get('t') || 1050);
  rig.yaw = -Math.PI / 2;
  G.mode = 'playing';
  await step(100, 'Ready');
  document.getElementById('boot').classList.add('hidden');
  hud.focus();
  requestAnimationFrame((t) => { last = t; frame(t); });
}
boot().catch((e) => { console.error(e); document.getElementById('boot-msg').textContent = 'Error: ' + e.message; });
