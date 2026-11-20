// Keyboard + mouse input: remappable action bindings, mouse deltas for camera orbit,
// pointer lock (requested on click while playing, released gracefully on Esc).
import { G } from './state.js';

export const DEFAULT_BINDINGS = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], enter: ['KeyF'], handbrake: ['Space'], horn: ['KeyH'],
  reload: ['KeyR'], radio: ['KeyR'], prevWeapon: ['KeyQ'], nextWeapon: ['KeyE'], map: ['KeyM'], pause: ['Escape', 'KeyP'],
  cinematic: ['KeyC'], skip: ['Enter', 'Space'],
};
export const ACTION_LABELS = {
  up: 'Forward / accelerate', down: 'Back / brake', left: 'Left / steer left', right: 'Right / steer right', sprint: 'Sprint', jump: 'Jump',
  enter: 'Enter / exit vehicle', handbrake: 'Handbrake', horn: 'Horn', reload: 'Reload (on foot)', radio: 'Radio (in car)',
  prevWeapon: 'Previous weapon', nextWeapon: 'Next weapon', map: 'City map', pause: 'Pause', cinematic: 'Cinematic camera', skip: 'Skip dialogue',
};

export const input = {
  bindings: JSON.parse(JSON.stringify(DEFAULT_BINDINGS)),
  down: new Set(), pressed: new Set(),
  mouse: { x: 0, y: 0, dx: 0, dy: 0, left: false, right: false, clicked: false, rclicked: false, wheel: 0, moved: 0 },
  locked: false, rebinding: null, onFirstGesture: null,
};
export const isDown = (a) => input.bindings[a].some((c) => input.down.has(c));
export const wasPressed = (a) => input.bindings[a].some((c) => input.pressed.has(c));
export function keyName(code) {
  if (!code) return '—';
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' L').replace('Right', ' R').replace('Arrow', '↑ ').replace('Escape', 'Esc');
}

let gestured = false;
const gesture = () => { if (!gestured) { gestured = true; input.onFirstGesture && input.onFirstGesture(); } };

export function initInput(el) {
  addEventListener('keydown', (e) => {
    gesture();
    if (input.rebinding) { e.preventDefault(); if (e.code !== 'Escape') input.bindings[input.rebinding][0] = e.code; input.rebinding = null; return; }
    if (!input.down.has(e.code)) input.pressed.add(e.code);
    input.down.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => input.down.delete(e.code));
  addEventListener('blur', () => { input.down.clear(); input.mouse.left = input.mouse.right = false; });
  el.addEventListener('mousemove', (e) => {
    input.mouse.x = e.clientX; input.mouse.y = e.clientY;
    input.mouse.dx += e.movementX || 0; input.mouse.dy += e.movementY || 0;
    input.mouse.moved = G.realTime;
  });
  el.addEventListener('mousedown', (e) => {
    gesture(); el.focus();
    if (e.button === 0) { input.mouse.left = true; input.mouse.clicked = true; }
    if (e.button === 2) { input.mouse.right = true; input.mouse.rclicked = true; }
    if (G.mode === 'playing' && !input.locked && el.requestPointerLock && !G.noPointerLock) { try { const p = el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* ignore */ } }
  });
  addEventListener('mouseup', (e) => { if (e.button === 0) input.mouse.left = false; if (e.button === 2) input.mouse.right = false; });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('wheel', (e) => { input.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === el;
    // Esc releases the lock in the browser: treat losing it while playing as a pause request
    if (!input.locked && G.mode === 'playing' && G.onPointerLockLost) G.onPointerLockLost();
  });
}
export function releasePointer() { if (document.pointerLockElement) document.exitPointerLock(); }

export function endFrameInput() {
  input.pressed.clear();
  input.mouse.clicked = input.mouse.rclicked = false;
  input.mouse.wheel = 0; input.mouse.dx = 0; input.mouse.dy = 0;
}
export function saveBindings() { try { localStorage.setItem('selarabay3d.bindings.v1', JSON.stringify(input.bindings)); } catch (e) { /* ignore */ } }
export function loadBindings() {
  try { const s = JSON.parse(localStorage.getItem('selarabay3d.bindings.v1') || 'null'); if (s) for (const k in DEFAULT_BINDINGS) if (Array.isArray(s[k]) && s[k].length) input.bindings[k] = s[k]; } catch (e) { /* ignore */ }
}
export function resetBindings() { input.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS)); saveBindings(); }
