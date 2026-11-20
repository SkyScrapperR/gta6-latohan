// Keyboard + mouse input with a remappable action binding table.
import { G } from './state.js';

/** Default action → key codes. The Controls screen can rebind the first key of each action. */
export const DEFAULT_BINDINGS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  enter: ['KeyF'],
  handbrake: ['Space'],
  horn: ['KeyH'],
  prevWeapon: ['KeyQ'],
  nextWeapon: ['KeyE'],
  radio: ['KeyR'],
  map: ['KeyM'],
  pause: ['Escape', 'KeyP'],
  skip: ['Enter', 'Space'],
};
export const ACTION_LABELS = {
  up: 'Move up / Accelerate', down: 'Move down / Brake', left: 'Move left / Steer left', right: 'Move right / Steer right',
  sprint: 'Sprint', enter: 'Enter / exit vehicle', handbrake: 'Handbrake', horn: 'Horn', prevWeapon: 'Previous weapon',
  nextWeapon: 'Next weapon', radio: 'Cycle radio station', map: 'City map', pause: 'Pause', skip: 'Skip dialogue',
};

export const input = {
  bindings: JSON.parse(JSON.stringify(DEFAULT_BINDINGS)),
  down: new Set(),       // codes currently held
  pressed: new Set(),    // codes pressed this frame
  mouse: { x: 0, y: 0, wx: 0, wy: 0, down: false, clicked: false, rclicked: false, wheel: 0 },
  rebinding: null,       // action waiting for a new key
  onFirstGesture: null,
  anyKey: false,
};

export function isDown(action) {
  for (const c of input.bindings[action]) if (input.down.has(c)) return true;
  return false;
}
export function wasPressed(action) {
  for (const c of input.bindings[action]) if (input.pressed.has(c)) return true;
  return false;
}
export function keyName(code) {
  if (!code) return '—';
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' L').replace('Right', ' R').replace('Arrow', '↑ ').replace('Escape', 'Esc');
}

let gestured = false;
function gesture() {
  if (!gestured) { gestured = true; if (input.onFirstGesture) input.onFirstGesture(); }
}

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => {
    gesture();
    if (input.rebinding) {
      e.preventDefault();
      if (e.code !== 'Escape') input.bindings[input.rebinding][0] = e.code;
      input.rebinding = null;
      return;
    }
    if (!input.down.has(e.code)) input.pressed.add(e.code);
    input.down.add(e.code);
    input.anyKey = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => input.down.delete(e.code));
  window.addEventListener('blur', () => input.down.clear());
  canvas.addEventListener('mousemove', (e) => { input.mouse.x = e.clientX; input.mouse.y = e.clientY; });
  canvas.addEventListener('mousedown', (e) => {
    gesture(); canvas.focus();
    input.mouse.x = e.clientX; input.mouse.y = e.clientY;
    if (e.button === 0) { input.mouse.down = true; input.mouse.clicked = true; }
    if (e.button === 2) input.mouse.rclicked = true;
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) input.mouse.down = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { input.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
}

/** Mouse world position, refreshed each frame from the camera. */
export function updateMouseWorld() {
  const c = G.cam;
  input.mouse.wx = (input.mouse.x - G.W / 2) / c.zoom + c.x;
  input.mouse.wy = (input.mouse.y - G.H / 2) / c.zoom + c.y;
}

export function endFrameInput() {
  input.pressed.clear();
  input.mouse.clicked = false;
  input.mouse.rclicked = false;
  input.mouse.wheel = 0;
  input.anyKey = false;
}

export function saveBindings() {
  try { localStorage.setItem('selarabay.bindings.v1', JSON.stringify(input.bindings)); } catch (e) { /* storage unavailable */ }
}
export function loadBindings() {
  try {
    const s = JSON.parse(localStorage.getItem('selarabay.bindings.v1') || 'null');
    if (s) for (const k in DEFAULT_BINDINGS) if (Array.isArray(s[k]) && s[k].length) input.bindings[k] = s[k];
  } catch (e) { /* ignore */ }
}
export function resetBindings() { input.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS)); saveBindings(); }
