// Geometry helpers: best-fit shapes and measurements used to score strokes.

export function centroid(points) {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

export function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function stdDev(values) {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

// "Spread": standard deviation divided by the mean.
// 0 means every value is identical; 0.2 means values typically differ by about 20%.
export function spread(values) {
  const m = mean(values);
  return m === 0 ? Infinity : stdDev(values) / m;
}

// Best-fit circle for an evenly spaced closed loop: the center is the average
// point, and the radius is the average distance to it.
export function fitCircle(points) {
  const center = centroid(points);
  const radii = points.map((p) => Math.hypot(p.x - center.x, p.y - center.y));
  return { center, radius: mean(radii), radii };
}

// Best-fit line through all points (the direction the points are most spread along).
// Returns a point on the line and a unit direction vector.
export function fitLine(points) {
  const c = centroid(points);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { point: c, dir: { x: Math.cos(angle), y: Math.sin(angle) } };
}

// Signed distance from p to a line (positive on one side, negative on the other).
export function sideOfLine(p, line) {
  return (p.x - line.point.x) * line.dir.y - (p.y - line.point.y) * line.dir.x;
}

// Total signed turning of the path in radians. A full counter-clockwise circle
// is about +2π, clockwise about -2π. Waves wiggle both ways and add up to near 0.
export function totalTurning(points) {
  let total = 0;
  for (let i = 2; i < points.length; i++) {
    const a1 = Math.atan2(points[i - 1].y - points[i - 2].y, points[i - 1].x - points[i - 2].x);
    const a2 = Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    total += d;
  }
  return total;
}

export function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
