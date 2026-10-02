// The practice dummy: draws one circle at the start of the duel, then stands still.
//
// It's a controller like the human one. It produces raw points over time and
// hands them to the engine, which recognizes and scores them like any stroke.
// So a "sloppy" dummy really does get a weaker circle.

import { CONFIG } from '../config.js';
import { makeRng } from '../random.js';
import { addStroke } from '../engine/duel.js';

// The points of the dummy's circle, wobble and all.
export function dummyCirclePoints(style = 'neat', seed = 11, cfg = CONFIG.dummy) {
  const { noise, squash, sweep } = cfg[style];
  const rng = makeRng(seed);
  const { x: cx, y: cy } = cfg.center;
  const steps = 120;
  const n = Math.round(steps * sweep);
  const start = Math.PI; // starts on the side facing the opponent
  let drift = 0;
  const points = [];
  for (let i = 0; i <= n; i++) {
    drift = drift * 0.92 + (rng() - 0.5) * noise * 0.5;
    const r = cfg.radius + drift + (rng() - 0.5) * noise * 0.3;
    const a = start + (i / steps) * 2 * Math.PI;
    points.push({ x: cx + r * Math.cos(a), y: cy + r * squash * Math.sin(a) });
  }
  return points;
}

export class DummyController {
  constructor({ owner = 'right', style = 'neat', seed = 11, cfg = CONFIG.dummy } = {}) {
    this.owner = owner;
    this.cfg = cfg;
    this.points = dummyCirclePoints(style, seed, cfg);
    this.done = false;
  }

  // Called every engine step. Returns the part of the stroke drawn so far,
  // so the renderer can show the dummy drawing.
  update(state) {
    if (this.done) return null;
    const t = (state.timeMs - this.cfg.startDelayMs) / this.cfg.drawMs;
    if (t < 0) return null;
    if (t >= 1) {
      this.done = true;
      addStroke(state, this.owner, this.points);
      return null;
    }
    return { owner: this.owner, seed: 4242, points: this.points.slice(0, Math.max(1, Math.floor(t * this.points.length))) };
  }
}
