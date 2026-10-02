// Example strokes for tests, made by code with a "shaky hand" added.
// A seeded random generator means every test run gets exactly the same strokes.

import { makeRng } from '../../src/random.js';

export { makeRng };

// Hand wobble: a slow drift plus a little fast jitter, like a real hand.
function wobbler(rng, amount) {
  let drift = 0;
  return () => {
    drift = drift * 0.9 + (rng() - 0.5) * amount * 0.6;
    return drift + (rng() - 0.5) * amount * 0.5;
  };
}

function rotate(points, angle, cx, cy) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return points.map((p) => ({
    x: cx + (p.x - cx) * c - (p.y - cy) * s,
    y: cy + (p.x - cx) * s + (p.y - cy) * c,
  }));
}

// A circle. `sweep` is how far round it goes (1 = exactly closed, 1.1 = overshoot,
// 0.75 = three-quarters open). `squash` makes it an ellipse.
export function circle({
  cx = 300,
  cy = 300,
  r = 100,
  sweep = 1.02,
  noise = 0,
  squash = 1,
  clockwise = false,
  startAngle = 0,
  seed = 1,
  steps = 90,
} = {}) {
  const rng = makeRng(seed);
  const wx = wobbler(rng, noise);
  const wy = wobbler(rng, noise);
  const pts = [];
  const n = Math.round(steps * sweep);
  for (let i = 0; i <= n; i++) {
    const a = startAngle + (clockwise ? -1 : 1) * (i / steps) * 2 * Math.PI;
    pts.push({ x: cx + r * Math.cos(a) + wx(), y: cy + r * squash * Math.sin(a) + wy() });
  }
  return pts;
}

export function line({ x1 = 100, y1 = 100, x2 = 400, y2 = 160, noise = 0, seed = 1, steps = 60 } = {}) {
  const rng = makeRng(seed);
  const w = wobbler(rng, noise);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const off = w();
    pts.push({ x: x1 + f * (x2 - x1) + nx * off, y: y1 + f * (y2 - y1) + ny * off });
  }
  return pts;
}

// A sine wave drawn along a direction. `irregular` makes bumps vary in size.
export function wave({
  x = 100,
  y = 300,
  length = 400,
  amplitude = 30,
  cycles = 3,
  angle = 0,
  noise = 0,
  irregular = 0,
  pattern = null, // e.g. [1, 0.3]: sizes for each half-bump, repeating
  seed = 1,
  steps = 200,
} = {}) {
  const rng = makeRng(seed);
  const w = wobbler(rng, noise);
  // Each half-bump gets its own random size if irregular > 0.
  const halves = Math.ceil(cycles * 2) + 1;
  const ampScale = Array.from({ length: halves }, (_, i) =>
    pattern ? pattern[i % pattern.length] : 1 + (rng() - 0.5) * 2 * irregular,
  );
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const phase = f * cycles * 2 * Math.PI;
    const half = Math.min(halves - 1, Math.floor(phase / Math.PI));
    pts.push({ x: x + f * length, y: y + amplitude * ampScale[half] * Math.sin(phase) + w() });
  }
  return rotate(pts, angle, x, y);
}

// A random wandering scribble.
export function scribble({ x = 300, y = 300, steps = 120, seed = 1 } = {}) {
  const rng = makeRng(seed);
  const pts = [{ x, y }];
  let heading = rng() * 2 * Math.PI;
  for (let i = 0; i < steps; i++) {
    heading += (rng() - 0.5) * 2.2;
    const p = pts[pts.length - 1];
    pts.push({ x: p.x + Math.cos(heading) * 6, y: p.y + Math.sin(heading) * 6 });
  }
  return pts;
}

// A zig-zag with sharp corners going back and forth (not a wave, not a line).
export function zigzagBack({ seed = 1 } = {}) {
  const rng = makeRng(seed);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const x = i % 2 === 0 ? 100 : 300 + rng() * 40;
    for (let k = 0; k < 20; k++) {
      const from = pts.length ? pts[pts.length - 1] : { x: 100, y: 100 };
      const target = { x, y: 100 + i * 30 };
      pts.push({ x: from.x + (target.x - from.x) * (k / 19), y: from.y + (target.y - from.y) * (k / 19) });
    }
  }
  return pts;
}
