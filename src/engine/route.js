// Route-finding for chalklings, so they walk around lines instead of getting
// caught on them.
//
// The board is split into a grid of small squares. A square is "blocked" if a
// chalkling standing there would touch a line. Then A* ("A-star") finds the
// shortest chain of open squares to the goal: it explores outward from the
// start, always trying the square that looks closest to the goal first.
// Finally the route is straightened, skipping corners it can see past.

import { closestOnSegment } from './collide.js';
import { isFoe } from './territory.js';

const CELL = 20; // grid square size, in board units
const MAX_SEARCH = 6000; // give up after looking at this many squares

// Which lines count as obstacles for this chalkling right now.
//   wallsBlock: walls are obstacles (otherwise it will chew through them)
//   ignoreWardId: a circle it's heading for (to chew it), so not an obstacle
export function obstaclesFor(state, c, { wallsBlock = true, ignoreWardId = null, enemyWardsBlock = true } = {}) {
  const walls = wallsBlock ? state.walls.filter((w) => !w.gone) : [];
  const wards = state.wards.filter(
    (w) => !w.gone && w.id !== ignoreWardId && (enemyWardsBlock || !isFoe(state, c.owner, w.owner)),
  );
  return { walls, wards, clearance: c.radius + 2 };
}

// Is the point `p` too close to a line?
export function pointBlocked(p, obs) {
  for (const w of obs.walls) if (closestOnSegment(p, w.from, w.to).dist < obs.clearance) return true;
  for (const w of obs.wards) {
    if (Math.abs(Math.hypot(p.x - w.center.x, p.y - w.center.y) - w.radius) < obs.clearance) return true;
  }
  return false;
}

// Can a chalkling walk straight from a to b without touching a line?
export function lineClear(a, b, obs) {
  for (const w of obs.walls) if (segmentDistance(a, b, w.from, w.to) < obs.clearance) return false;
  for (const w of obs.wards) {
    // The segment's distances from the circle's center run from `near` to `far`.
    // It touches the circle's line if that range overlaps the line's band.
    const near = closestOnSegment(w.center, a, b).dist;
    const far = Math.max(Math.hypot(a.x - w.center.x, a.y - w.center.y), Math.hypot(b.x - w.center.x, b.y - w.center.y));
    if (far > w.radius - obs.clearance && near < w.radius + obs.clearance) return false;
  }
  return true;
}

function segmentDistance(a, b, c, d) {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(
    closestOnSegment(a, c, d).dist,
    closestOnSegment(b, c, d).dist,
    closestOnSegment(c, a, b).dist,
    closestOnSegment(d, a, b).dist,
  );
}

function segmentsCross(a, b, c, d) {
  const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// Find a route from the chalkling to `goal`. Returns a list of points to walk
// through (ending at the goal), or null if there's no way round.
export function findRoute(state, from, goal, obs) {
  const { width, height } = state.cfg.world;
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  if (lineClear(from, goal, obs)) return [goal];

  const blockedCache = new Map();
  const blocked = (i) => {
    let b = blockedCache.get(i);
    if (b === undefined) {
      b = pointBlocked(center(i), obs);
      blockedCache.set(i, b);
    }
    return b;
  };
  const index = (p) => Math.min(rows - 1, Math.max(0, Math.floor(p.y / CELL))) * cols + Math.min(cols - 1, Math.max(0, Math.floor(p.x / CELL)));
  const center = (i) => ({ x: (i % cols) * CELL + CELL / 2, y: Math.floor(i / cols) * CELL + CELL / 2 });

  const start = index(from);
  let end = index(goal);
  if (blocked(end)) end = nearestOpen(end, cols, rows, blocked);
  if (end === null) return null;

  // A*: always expand the open square with the lowest (distance so far + guess to goal).
  const h = (i) => {
    const dx = Math.abs((i % cols) - (end % cols));
    const dy = Math.abs(Math.floor(i / cols) - Math.floor(end / cols));
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * CELL;
  };
  const cost = new Map([[start, 0]]);
  const came = new Map();
  const open = new MinHeap();
  open.push(start, h(start));
  const closed = new Set();
  let searched = 0;

  while (open.size && searched < MAX_SEARCH) {
    const cur = open.pop();
    if (cur === end) break;
    if (closed.has(cur)) continue;
    closed.add(cur);
    searched++;
    const cx = cur % cols;
    const cy = Math.floor(cur / cols);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const next = ny * cols + nx;
        if (blocked(next) && next !== end) continue;
        // No cutting diagonally between two blocked squares.
        if (dx && dy && (blocked(cy * cols + nx) || blocked(ny * cols + cx))) continue;
        const step = dx && dy ? Math.SQRT2 * CELL : CELL;
        const g = cost.get(cur) + step;
        if (g < (cost.get(next) ?? Infinity)) {
          cost.set(next, g);
          came.set(next, cur);
          open.push(next, g + h(next));
        }
      }
    }
  }
  if (!came.has(end) && end !== start) return null;

  // Walk back from the goal to get the squares in order.
  const cells = [];
  for (let i = end; i !== undefined && i !== start; i = came.get(i)) cells.push(center(i));
  cells.reverse();
  if (end === index(goal) || lineClear(cells[cells.length - 1] ?? from, goal, obs)) cells.push(goal);

  // Straighten it: from each point, jump to the farthest point we can see.
  const route = [];
  let here = from;
  let k = 0;
  while (k < cells.length) {
    let far = k;
    for (let j = cells.length - 1; j > k; j--) {
      if (lineClear(here, cells[j], obs)) {
        far = j;
        break;
      }
    }
    route.push(cells[far]);
    here = cells[far];
    k = far + 1;
  }
  return route;
}

function nearestOpen(i, cols, rows, blocked) {
  const x0 = i % cols;
  const y0 = Math.floor(i / cols);
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        if (!blocked(y * cols + x)) return y * cols + x;
      }
    }
  }
  return null;
}

// A tiny priority queue: pop() always returns the item with the smallest score.
// Ties go to whichever was pushed first, so routes are always the same.
class MinHeap {
  constructor() {
    this.items = [];
    this.count = 0;
  }
  get size() {
    return this.items.length;
  }
  push(value, score) {
    const items = this.items;
    items.push({ value, score, order: this.count++ });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!less(items[i], items[parent])) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && less(items[l], items[m])) m = l;
        if (r < items.length && less(items[r], items[m])) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m], items[i]];
        i = m;
      }
    }
    return top.value;
  }
}

function less(a, b) {
  return a.score < b.score || (a.score === b.score && a.order < b.order);
}
