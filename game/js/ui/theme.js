// Shared UI style: dark translucent panels with teal/magenta accents, heavy outlined type.
import { roundRect } from '../core/math.js';

export const UI = {
  teal: '#2ff3e0', magenta: '#ff3fa4', gold: '#ffd23f', green: '#5dff8a', red: '#ff4d5e', blue: '#4d9dff', purple: '#c45cff',
  panel: 'rgba(10,8,22,0.72)', panelEdge: 'rgba(47,243,224,0.35)',
  font: '"Arial Black", "Arial Bold", Gadget, sans-serif',
  body: '"Trebuchet MS", "Segoe UI", Arial, sans-serif',
};
export function uiScale(G) { return Math.max(0.6, Math.min(1.5, Math.min(G.H / 1080, G.W / 1600))); }

export function panel(ctx, x, y, w, h, r = 10, accent = UI.teal) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = UI.panel; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.save(); ctx.clip();
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, accent); g.addColorStop(1, UI.magenta);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, 3);
  ctx.restore();
}

/** Outlined text. */
export function text(ctx, str, x, y, size, color = '#fff', align = 'left', font = UI.font, outline = true, base = 'alphabetic') {
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = align; ctx.textBaseline = base;
  if (outline) { ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, size * 0.16); ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(str, x, y); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}

/** Shrink a string's font size until it fits a width. */
export function fitText(ctx, str, maxW, size, font = UI.font) {
  ctx.font = `${size}px ${font}`;
  while (size > 8 && ctx.measureText(str).width > maxW) { size -= 1; ctx.font = `${size}px ${font}`; }
  return size;
}

/** Word-wrap into lines no wider than maxW. */
export function wrap(ctx, str, maxW, size, font = UI.body) {
  ctx.font = `${size}px ${font}`;
  const words = str.split(' '), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function star(ctx, x, y, r, fill, stroke = 'rgba(0,0,0,0.8)') {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke();
}

/** Small map icon on a coloured disc. */
export function mapIcon(ctx, icon, x, y, r, color) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#111'; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r - 1.5, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.fillStyle = '#111'; ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.5, r * 0.18);
  const s = r * 0.55;
  ctx.beginPath();
  switch (icon) {
    case 'house': ctx.moveTo(x - s, y); ctx.lineTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x + s * 0.7, y); ctx.lineTo(x + s * 0.7, y + s * 0.8); ctx.lineTo(x - s * 0.7, y + s * 0.8); ctx.lineTo(x - s * 0.7, y); ctx.closePath(); ctx.fill(); break;
    case 'cross': ctx.fillRect(x - s * 0.3, y - s, s * 0.6, s * 2); ctx.fillRect(x - s, y - s * 0.3, s * 2, s * 0.6); break;
    case 'wrench': ctx.moveTo(x - s, y + s); ctx.lineTo(x + s * 0.4, y - s * 0.4); ctx.stroke(); ctx.beginPath(); ctx.arc(x + s * 0.5, y - s * 0.5, s * 0.45, 0, Math.PI * 2); ctx.stroke(); break;
    case 'badge': for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? s * 0.45 : s; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); break;
    case 'orchid': for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; ctx.moveTo(x, y); ctx.arc(x + Math.cos(a) * s * 0.5, y + Math.sin(a) * s * 0.5, s * 0.38, 0, Math.PI * 2); } ctx.fill(); break;
    case 'gun': ctx.fillRect(x - s, y - s * 0.35, s * 1.8, s * 0.55); ctx.fillRect(x - s * 0.9, y, s * 0.5, s * 0.9); break;
    case 'cup': ctx.fillRect(x - s * 0.7, y - s * 0.5, s * 1.1, s * 1.2); ctx.arc(x + s * 0.5, y, s * 0.35, -1.5, 1.5); ctx.stroke(); break;
    default: {
      const letter = { bank: '$', spray: 'K', laptop: 'D', mission: '!', save: 'S', target: '◆', boss: 'V' }[icon] || '?';
      ctx.font = `${Math.round(r * 1.25)}px ${UI.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(letter, x, y + r * 0.08);
    }
  }
}
