// Helpers that make chalklings the book way in tests, with Chalkling mode on:
// chain from a bind point → holding circle → creature inside → path → erase the chain.

import { addStroke, step, mainWard } from '../../src/engine/duel.js';
import { applyAction } from '../../src/engine/actions.js';
import { fitInside } from '../../src/data/creatures.js';
import * as S from './strokes.js';

// Strokes drawn with Chalkling mode on.
export const MAKING = { making: true };

export function run(state, seconds) {
  const steps = Math.round((seconds * 1000) / state.cfg.stepMs);
  for (let i = 0; i < steps; i++) step(state);
}

// Where bind point k is, and which way is "outward" from the circle there.
export function bindPoint(state, side, k) {
  const main = mainWard(state, side);
  const a = main.bindAngles[k];
  const dir = { x: Math.cos(a), y: Math.sin(a) };
  return { point: { x: main.center.x + dir.x * main.radius, y: main.center.y + dir.y * main.radius }, dir };
}

export function line(a, b) {
  return S.line({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, noise: 0.5 });
}

// Steps 1 and 2: a chain straight out from bind point k, and a holding circle on its end.
export function chainAndCircle(state, side, k = 1, { chainLength = 90, r = 55 } = {}) {
  const { point, dir } = bindPoint(state, side, k);
  const end = { x: point.x + dir.x * chainLength, y: point.y + dir.y * chainLength };
  addStroke(state, side, line(point, end), MAKING);
  const center = { x: end.x + dir.x * r, y: end.y + dir.y * r };
  addStroke(state, side, S.circle({ cx: center.x, cy: center.y, r, noise: 1 }), MAKING);
  return { center, r, chainMid: { x: (point.x + end.x) / 2, y: (point.y + end.y) / 2 } };
}

// Step 3: draw the creature inside the circle.
export function drawCreature(state, side, strokes, center, r) {
  return fitInside(strokes, center, r).map((s) => addStroke(state, side, s, MAKING));
}

// Step 4: a path from the edge of the circle (or a chalkling) to `to`.
export function drawPath(state, side, from, r, to) {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  const start = { x: from.x + ((to.x - from.x) / d) * r * 0.9, y: from.y + ((to.y - from.y) / d) * r * 0.9 };
  return addStroke(state, side, line(start, to), MAKING);
}

// Rub the eraser at `at` for `seconds`, then lift it.
export function erase(state, side, at, seconds = 3.1) {
  const act = (phase) => applyAction(state, side, { type: 'erase', phase, at });
  act('start');
  const steps = Math.round((seconds * 1000) / state.cfg.stepMs);
  for (let i = 0; i < steps; i++) {
    if (i % 6 === 0) act('move');
    step(state);
  }
  act('stop');
}

// All five steps. Returns the new chalkling (or null).
export function makeChalklingBookWay(state, side, creature, { k = 1, to = null, r = 55 } = {}) {
  const before = new Set(state.chalklings.map((c) => c.id));
  const { center, chainMid } = chainAndCircle(state, side, k, { r });
  drawCreature(state, side, creature, center, r);
  if (to) drawPath(state, side, center, r, to);
  erase(state, side, chainMid);
  return state.chalklings.find((c) => !before.has(c.id)) ?? null;
}
