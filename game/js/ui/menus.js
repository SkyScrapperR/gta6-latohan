import { G } from '../core/state.js';
export function open() {} export function update() { if (G.mode === 'title' && !G.debug.shot) G.newGame(); } export function draw() {}
