// Stage-3 city test.
import { createGL } from './engine/gl.js';
import { Renderer } from './engine/renderer.js';
import { computeEnvironment } from './engine/sky.js';
import { generateCity, LAND, SHORE_Z } from './world/city.js';
import { buildCityMeshes } from './world/city-meshes.js';
import { buildCollision } from './world/collision.js';
import { SignAtlas } from './world/signs.js';
const canvas = document.getElementById('gl');
const gl = createGL(canvas);
const R = new Renderer(gl);
const q = new URLSearchParams(location.search);
R.setQuality(q.get('q') || 'high');
function resize() { canvas.width = innerWidth; canvas.height = innerHeight; R.resize(innerWidth, innerHeight); }
addEventListener('resize', resize); resize();
const t0 = performance.now();
const city = generateCity(1337);
const atlas = new SignAtlas();
const built = buildCityMeshes(gl, city, atlas);
R.atlas = atlas.upload(gl);
buildCollision(city);
R.statics = built.statics;
R.batches = Object.values(built.batches);
R.land = [LAND.x0, LAND.z0, LAND.x1, SHORE_Z];
console.log('city built in', (performance.now() - t0).toFixed(0), 'ms', 'buildings', city.buildings.length, 'chunks', built.statics.length);
window.__city = city; window.__R = R;
const clock = +(q.get('t') || 1080);
const cam = (q.get('cam') || '420,30,560,470,20,420').split(',').map(Number);
let t = 0;
function frame() {
  t += 1 / 60;
  computeEnvironment(R.env, clock, +(q.get('rain') || 0));
  R.camera.pos = cam.slice(0, 3); R.camera.target = cam.slice(3, 6);
  R.camera.fov = 60;
  R.lights = [];
  if (R.env.night > 0.1) for (const l of city.lamps) R.lights.push({ x: l.x + Math.cos(-l.a) * 2.2 * 0, y: 6.4, z: l.z, r: 16, color: [1, 0.75, 0.45], intensity: 2.2 });
  R.render(t);
  window.__frames = (window.__frames || 0) + 1;
  requestAnimationFrame(frame);
}
document.getElementById('boot').classList.add('hidden');
requestAnimationFrame(frame);
