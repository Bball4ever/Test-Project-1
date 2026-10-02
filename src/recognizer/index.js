// The recognizer: takes a stroke (a list of points) and says what line it is.
// Pure logic: no canvas, no game state, so it runs the same in Node tests and the browser.

import { CONFIG } from '../config.js';
import { cleanStroke } from './clean.js';
import { classify, TYPES } from './classify.js';

export { TYPES };

// points: [{ x, y }, ...] in board pixels.
// Returns { type, quality, reason, guess, shape, metrics, points }.
//   type    'warding' | 'forbiddance' | 'vigor' | 'dud'
//   quality 0..1, how well it was drawn
//   reason  why it's a dud (null if it isn't one)
//   guess   for duds, what it looked closest to (or null)
//   shape   the fitted shape (circle, segment or wave), when there is one
//   metrics the numbers behind the score, for the debug overlay
//   points  the cleaned-up stroke
export function recognize(points, cfg = CONFIG.recognizer) {
  const clean = cleanStroke(points, cfg);
  return { ...classify(clean, cfg), points: clean };
}
