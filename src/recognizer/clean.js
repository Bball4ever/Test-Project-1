// Stroke clean-up: turn raw pointer samples into evenly spaced, smoothed points.
// Points are plain objects: { x, y } (raw points may also carry t, the time in ms).

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

// Walk along the stroke and drop a new point every `spacing` pixels.
// Fast strokes have big gaps between samples and slow ones bunch up,
// so without this the maths would weigh slow parts more than fast parts.
export function resample(points, spacing) {
  if (points.length === 0) return [];
  const out = [{ x: points[0].x, y: points[0].y }];
  let carried = 0; // distance travelled since the last dropped point
  for (let i = 1; i < points.length; i++) {
    let prev = points[i - 1];
    const next = points[i];
    let seg = distance(prev, next);
    while (carried + seg >= spacing) {
      const f = (spacing - carried) / seg;
      const p = { x: prev.x + f * (next.x - prev.x), y: prev.y + f * (next.y - prev.y) };
      out.push(p);
      prev = p;
      seg = distance(prev, next);
      carried = 0;
    }
    carried += seg;
  }
  const last = points[points.length - 1];
  if (distance(out[out.length - 1], last) > spacing * 0.25) out.push({ x: last.x, y: last.y });
  return out;
}

// Replace each point with the average of itself and its neighbours.
// Near the ends the window shrinks, so the endpoints stay where they were drawn.
export function smooth(points, radius) {
  if (radius <= 0) return points.map((p) => ({ ...p }));
  const n = points.length;
  return points.map((_, i) => {
    const r = Math.min(radius, i, n - 1 - i);
    let sx = 0;
    let sy = 0;
    for (let j = i - r; j <= i + r; j++) {
      sx += points[j].x;
      sy += points[j].y;
    }
    const count = 2 * r + 1;
    return { x: sx / count, y: sy / count };
  });
}

export function cleanStroke(points, { resampleSpacing, smoothRadius }) {
  return smooth(resample(points, resampleSpacing), smoothRadius);
}
