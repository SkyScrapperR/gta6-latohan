// Stage-2 engine test scene.
import { createGL, createMesh } from './engine/gl.js';
import { Renderer } from './engine/renderer.js';
import { MeshBuilder, MAT } from './engine/mesh-builder.js';
import { computeEnvironment } from './engine/sky.js';
import { InstanceBatch } from './engine/instancing.js';
const canvas = document.getElementById('gl');
const gl = createGL(canvas);
const R = new Renderer(gl);
window.__R = R;
const q = new URLSearchParams(location.search);
R.setQuality('high');
function resize() { canvas.width = innerWidth; canvas.height = innerHeight; R.resize(innerWidth, innerHeight); }
addEventListener('resize', resize); resize();
const mb = new MeshBuilder();
mb.box(-200, -2, -200, 200, 0, 200, [0.3, 0.32, 0.3], { mat: MAT.ROAD });
for (let i = 0; i < 6; i++) mb.box(-60 + i * 24, 0, -40, -44 + i * 24, 20 + i * 15, -24, [0.55, 0.6, 0.7], { mat: MAT.WINDOWS + i * 0.1 + 0.05, topColor: [0.4, 0.4, 0.42], topMat: 0 });
mb.box(-3, 0, 4, 3, 1.4, 6, [0.9, 0.1, 0.1], { mat: MAT.TINT });
mb.box(10, 0, 0, 14, 4, 4, [1, 0.3, 0.8], { mat: MAT.NEON, e: 3 });
R.statics.push({ mesh: createMesh(gl, mb.toArray()), aabb: [-200, -2, -200, 200, 120, 200] });
const tb = new MeshBuilder(); tb.cylinder(0, 0, 0, 0.3, 3, [0.4, 0.25, 0.1]); tb.sphere(0, 4, 0, 2, [0.2, 0.5, 0.2]);
const trees = new InstanceBatch(createMesh(gl, tb.toArray()));
for (let i = 0; i < 10; i++) trees.push(-40 + i * 9, 0, 14, 0, 1, 1, 1, 0.9 + (i % 3) * 0.1, 1, 0.9);
R.batches.push(trees);
R.land = [-150, -150, 150, 150];
const clock = +(q.get('t') || 1080);
let t = 0;
function frame() {
  t += 1 / 60;
  computeEnvironment(R.env, clock, +(q.get('rain') || 0));
  R.camera.pos = [40 * Math.cos(t * 0.1), 18, 60 + 10 * Math.sin(t * 0.1)];
  R.camera.target = [0, 8, -10];
  R.lights = [{ x: 0, y: 3, z: 10, r: 25, color: [1, 0.6, 0.3], intensity: 3 }, { x: 12, y: 2, z: 6, r: 18, color: [1, 0.2, 0.8], intensity: 3 }];
  R.render(t);
  window.__frames = (window.__frames || 0) + 1;
  requestAnimationFrame(frame);
}
document.getElementById('boot').classList.add('hidden');
requestAnimationFrame(frame);
