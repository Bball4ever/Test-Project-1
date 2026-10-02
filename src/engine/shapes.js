// Small shape measurements shared by chalklings and their powers.

import { resample } from '../recognizer/clean.js';

export function polygonArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

// Sharp bends in a stroke (each bend counted once).
export function countCorners(stroke, limit) {
  const pts = resample(stroke, 4);
  let count = 0;
  let cooldown = 0;
  for (let i = 3; i < pts.length - 3; i++) {
    if (cooldown > 0) {
      cooldown--;
      continue;
    }
    const a1 = Math.atan2(pts[i].y - pts[i - 3].y, pts[i].x - pts[i - 3].x);
    const a2 = Math.atan2(pts[i + 3].y - pts[i].y, pts[i + 3].x - pts[i].x);
    let turn = Math.abs(a2 - a1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > limit) {
      count++;
      cooldown = 4;
    }
  }
  return count;
}

// Is point p inside the closed shape `points`? (Counts how many edges a ray
// from p to the right crosses: odd means inside.)
export function insidePolygon(p, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Where two straight segments a→b and c→d cross, as fractions along each, or null.
export function crossing(a, b, c, d) {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, point: { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) } };
}
