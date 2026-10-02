// Making mode: collects the strokes of a chalkling while you draw it.
//
// A creature can take many strokes (head, body, legs...). We can't know when
// you've finished, so the creature comes alive once you stop drawing for a
// moment (CONFIG.chalkling.idleMs), or when you switch Making mode off.

import { CONFIG } from '../config.js';

export class MakingDraft {
  constructor(idleMs = CONFIG.chalkling.idleMs) {
    this.idleMs = idleMs;
    this.strokes = [];
    this.lastAt = 0;
  }

  add(points, now) {
    this.strokes.push(points);
    this.lastAt = now;
  }

  // The finished strokes, if you've paused long enough (and aren't mid-stroke).
  takeIfIdle(now, drawing) {
    if (!this.strokes.length || drawing || now - this.lastAt < this.idleMs) return null;
    return this.take();
  }

  take() {
    const strokes = this.strokes;
    this.strokes = [];
    return strokes.length ? strokes : null;
  }

  clear() {
    this.strokes = [];
  }
}
