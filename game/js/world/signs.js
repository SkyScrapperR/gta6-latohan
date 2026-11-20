// Text/emblem atlas: shop names, brands, landmark labels and the orchid emblem are drawn
// into one canvas texture; meshes reference cells by uv rect.
import { textureFromCanvas } from '../engine/gl.js';

const W = 2048, CW = 512, CH = 128;
export class SignAtlas {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = 2048;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, W, 2048);
    this.col = 0; this.row = 0; this.cells = new Map();
  }
  alloc(wc = 1, hc = 1) {
    if (this.col + wc > W / CW) { this.col = 0; this.row += this.rowH || 1; this.rowH = 0; }
    const x = this.col * CW, y = this.row * CH;
    this.col += wc; this.rowH = Math.max(this.rowH || 0, hc);
    return { x, y, w: wc * CW, h: hc * CH, uv: [x / W, y / 2048, (x + wc * CW) / W, (y + hc * CH) / 2048] };
  }
  /** A neon/backlit text sign. style: { fg, bg, glow, font } */
  text(key, str, { fg = '#fff', bg = '#111', glow = null, border = null } = {}) {
    if (this.cells.has(key)) return this.cells.get(key).uv;
    const c = this.alloc(1, 1), g = this.ctx;
    g.save();
    g.fillStyle = bg; g.fillRect(c.x, c.y, c.w, c.h);
    if (border) { g.strokeStyle = border; g.lineWidth = 8; g.strokeRect(c.x + 6, c.y + 6, c.w - 12, c.h - 12); }
    let size = 78;
    g.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
    while (g.measureText(str).width > c.w - 40 && size > 20) { size -= 2; g.font = `900 ${size}px "Arial Black", Arial, sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (glow) { g.shadowColor = glow; g.shadowBlur = 18; }
    g.fillStyle = fg; g.fillText(str, c.x + c.w / 2, c.y + c.h / 2 + 4);
    g.restore();
    this.cells.set(key, c);
    return c.uv;
  }
  /** Large billboard (2x2 cells): brand + slogan. */
  billboard(key, brand, slogan, colors) {
    if (this.cells.has(key)) return this.cells.get(key).uv;
    const c = this.alloc(2, 2), g = this.ctx;
    g.save();
    const gr = g.createLinearGradient(c.x, c.y, c.x + c.w, c.y + c.h);
    gr.addColorStop(0, colors[0]); gr.addColorStop(1, colors[1]);
    g.fillStyle = gr; g.fillRect(c.x, c.y, c.w, c.h);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(c.x + c.w * (0.1 + i * 0.13), c.y + c.h * 0.8, 40 + i * 6, 0, Math.PI * 2); g.fill(); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 96px "Arial Black", Arial, sans-serif'; g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 12;
    g.fillText(brand, c.x + c.w / 2, c.y + c.h * 0.42);
    g.font = 'bold 40px Arial, sans-serif'; g.fillText(slogan, c.x + c.w / 2, c.y + c.h * 0.72);
    g.restore();
    this.cells.set(key, c);
    return c.uv;
  }
  /** Square emblem drawn with a callback (ctx, x, y, size). */
  emblem(key, draw) {
    if (this.cells.has(key)) return this.cells.get(key).uv;
    const c = this.alloc(1, 4), g = this.ctx;
    g.save(); g.fillStyle = '#000'; g.fillRect(c.x, c.y, c.w, c.h); draw(g, c.x, c.y, c.w); g.restore();
    this.cells.set(key, c);
    return c.uv;
  }
  upload(gl) { this.texture = textureFromCanvas(gl, this.canvas, true); return this.texture; }
}

export function drawOrchid(g, x, y, s) {
  const cx = x + s / 2, cy = y + s / 2;
  g.translate(cx, cy);
  g.shadowColor = '#ff5cf0'; g.shadowBlur = 30;
  for (let i = 0; i < 5; i++) {
    g.save(); g.rotate(i / 5 * Math.PI * 2);
    const gr = g.createLinearGradient(0, 0, 0, -s * 0.42);
    gr.addColorStop(0, '#ffb8ff'); gr.addColorStop(1, '#c43cff');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(0, -s * 0.22, s * 0.1, s * 0.21, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  g.fillStyle = '#ffe14d'; g.beginPath(); g.arc(0, 0, s * 0.06, 0, Math.PI * 2); g.fill();
}

export const BRAND_SLOGANS = {
  'OMBAK COLA': ['Ride the wave', ['#ff3f5e', '#ff9f43']], 'NUSA MOBILE': ['Signal everywhere', ['#2f6bff', '#2ff3e0']],
  'LUMEN TV': ['Brighter than noon', ['#8f3cff', '#ff3fa4']], 'BINTANG AIR': ['Fly the coast', ['#0f9bd7', '#7ff0ff']],
  'KOPI SENJA': ['Sunset in a cup', ['#7a3b1c', '#ffb347']], 'MERAK BANK': ['Your money, proud', ['#1f7a4a', '#9dff4d']],
  'SURYA ENERGY': ['Power the bay', ['#ff8c00', '#ffe14d']], 'GECKO RIDE': ['Get there sticky', ['#10b981', '#d9f99d']],
};
