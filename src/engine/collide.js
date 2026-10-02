// Hit and bounce maths. Every function here is pure: numbers in, numbers out.
//
// A moving Vigor is tested along the whole path it travels in one step
// (from → to), not just where it lands. Otherwise a fast Vigor could jump
// straight over a thin wall between two steps.

const EPS = 1e-9;

// Where does the path from→to cross the segment a→b?
// Returns { t, point } with t = 0..1 along the path, or null.
export function hitSegment(from, to, a, b) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < EPS) return null; // parallel
  const fx = a.x - from.x;
  const fy = a.y - from.y;
  const t = (fx * ey - fy * ex) / denom; // along the path
  const s = (fx * dy - fy * dx) / denom; // along the segment
  if (t < EPS || t > 1 || s < 0 || s > 1) return null;
  return { t, point: { x: from.x + t * dx, y: from.y + t * dy } };
}

// Where does the path from→to first touch the circle's line?
// Works from inside or outside. Returns { t, point } or null.
export function hitCircle(from, to, center, radius) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const fx = from.x - center.x;
  const fy = from.y - center.y;
  const a = dx * dx + dy * dy;
  if (a < EPS) return null;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
    if (t > EPS && t <= 1) return { t, point: { x: from.x + t * dx, y: from.y + t * dy } };
  }
  return null;
}

// Bounce a velocity off a wall running from a to b, like light off a mirror.
export function reflect(vel, a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const dot = vel.x * nx + vel.y * ny;
  return { x: vel.x - 2 * dot * nx, y: vel.y - 2 * dot * ny };
}

// The closest point on segment a→b to point p, and how far away it is.
export function closestOnSegment(p, a, b) {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len2 = ex * ex + ey * ey || EPS;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2));
  const point = { x: a.x + t * ex, y: a.y + t * ey };
  return { point, dist: Math.hypot(p.x - point.x, p.y - point.y) };
}

// Which numbered section of a circle does a point fall in?
// Section 0 starts at angle 0 (pointing right) and they go round clockwise on screen.
export function sectionAt(center, point, count) {
  const angle = Math.atan2(point.y - center.y, point.x - center.x);
  const turn = (angle / (2 * Math.PI) + 1) % 1;
  return Math.min(count - 1, Math.floor(turn * count));
}
