// Bind points: special spots on a main circle where other lines can attach.
//
// A line or smaller circle that touches the main circle at a bind point is
// "bound" and gets stronger. Touching anywhere else weakens that part of the
// main circle.

import { sectionAt } from './collide.js';

// Angles of the bind points. The first one faces the way the duelist faces
// (`facing`, a direction): toward the middle of the board. In a 2-player duel
// the left duelist faces right (angle 0), the right duelist faces left (π).
export function bindAngles(count, facing) {
  const start = Math.atan2(facing.y, facing.x);
  return Array.from({ length: count }, (_, k) => start + (k * 2 * Math.PI) / count);
}

export function bindPointPositions(ward) {
  return ward.bindAngles.map((a) => ({
    x: ward.center.x + Math.cos(a) * ward.radius,
    y: ward.center.y + Math.sin(a) * ward.radius,
  }));
}

// Where (if anywhere) a new wall or circle touches the main circle.
// Returns a list of touch points on the main circle's line.
export function touchPoints(main, thing, cfg) {
  const tol = cfg.touchTolerance;
  const onCircle = (p) => Math.abs(Math.hypot(p.x - main.center.x, p.y - main.center.y) - main.radius) < tol;
  const project = (p) => {
    const d = Math.hypot(p.x - main.center.x, p.y - main.center.y) || 1;
    return {
      x: main.center.x + ((p.x - main.center.x) / d) * main.radius,
      y: main.center.y + ((p.y - main.center.y) / d) * main.radius,
    };
  };

  if (thing.kind === 'wall') {
    return [thing.from, thing.to].filter(onCircle).map(project);
  }
  // A smaller circle touches if it sits just outside or just inside the main one.
  const d = Math.hypot(thing.center.x - main.center.x, thing.center.y - main.center.y);
  const outside = Math.abs(d - (main.radius + thing.radius)) < tol;
  const inside = Math.abs(d - (main.radius - thing.radius)) < tol;
  return outside || inside ? [project(thing.center)] : [];
}

// For one touch point: is it at a bind point? Returns the bind point's index or -1.
export function boundIndex(main, point, cfg) {
  const angle = Math.atan2(point.y - main.center.y, point.x - main.center.x);
  for (let k = 0; k < main.bindAngles.length; k++) {
    let diff = Math.abs(angle - main.bindAngles[k]) % (2 * Math.PI);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    if (diff * main.radius <= cfg.bindTolerance) return k;
  }
  return -1;
}

// Work out how a new wall/circle attaches to its owner's main circle, and apply
// the bonus or penalties. Returns a list of { point, bound, section } for events.
export function attach(main, thing, cfg) {
  const results = [];
  let bound = false;
  for (const point of touchPoints(main, thing, cfg)) {
    const section = sectionAt(main.center, point, main.sections.length);
    if (boundIndex(main, point, cfg) >= 0) {
      bound = true;
      results.push({ point, bound: true, section });
    } else {
      const s = main.sections[section];
      s.max *= 1 - cfg.offPointPenalty;
      s.health = Math.min(s.health, s.max);
      results.push({ point, bound: false, section });
    }
  }
  if (bound) {
    thing.bound = true;
    const factor = 1 + cfg.boundBonus;
    if (thing.kind === 'wall') {
      thing.max *= factor;
      thing.health *= factor;
    } else {
      for (const s of thing.sections) {
        s.max *= factor;
        s.health *= factor;
      }
    }
  }
  return results;
}
