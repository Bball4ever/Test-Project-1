// Lines of Making: chalklings, little chalk creatures that walk and fight.
//
// A chalkling is made from one or more strokes. The drawing itself is the
// creature's body, and its stats come from how much effort went into it:
// more chalk, more strokes and more closed shapes make a tougher creature.

import { pathLength, distance } from '../recognizer/clean.js';
import { closestOnSegment, sectionAt } from './collide.js';
import { damageSection, damageWall, damageChalkling, otherSide } from './damage.js';

// Measure a drawing: how much chalk, how many strokes, how many closed shapes.
export function measureCreature(strokes, cc) {
  let ink = 0;
  let closed = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    const len = pathLength(stroke);
    ink += len;
    if (stroke.length > 3 && len >= cc.minClosedInk && distance(stroke[0], stroke[stroke.length - 1]) / len < cc.closedGapRatio) closed++;
    for (const p of stroke) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const detail = Math.min(
    cc.maxDetail,
    ink * cc.detailPerInk + strokes.length * cc.detailPerStroke + closed * cc.detailPerClosedShape,
  );
  const size = Math.max(maxX - minX, maxY - minY);
  return { ink, closed, strokes: strokes.length, detail, size, center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } };
}

export function makeChalkling(id, owner, strokes, measure, cc, order) {
  const health = cc.baseHealth + cc.healthPerDetail * measure.detail;
  return {
    id,
    kind: 'chalkling',
    owner,
    strokes,
    origin: measure.center, // where it was drawn; the drawing is shown relative to this
    pos: { ...measure.center },
    radius: Math.max(cc.minRadius, Math.min(cc.maxRadius, measure.size * 0.4)),
    detail: measure.detail,
    hp: health,
    max: health,
    bite: cc.baseBite + cc.bitePerDetail * measure.detail,
    speed: cc.baseSpeed / (1 + cc.slowPerDetail * measure.detail),
    order,
    action: 'idle', // walk | chew | fight | idle (for the renderer's animation)
    facing: owner === 'left' ? 1 : -1,
  };
}

// Advance every chalkling by one step.
export function stepChalklings(state, dt) {
  for (const c of state.chalklings) {
    if (!c.gone && !state.winner) stepOne(state, c, dt);
  }
}

function stepOne(state, c, dt) {
  const cc = state.chalkCfg;
  const home = mainOf(state, c.owner);
  const enemyMain = mainOf(state, otherSide(c.owner));
  const enemies = state.chalklings.filter((e) => e.owner !== c.owner && !e.gone);

  // 1. Decide what to go after.
  let foe = null;
  let goal = null;
  if (c.order === 'guard' && home) {
    const reach = home.radius + cc.guardRange;
    foe = nearest(c.pos, enemies.filter((e) => distance(e.pos, home.center) < reach));
    if (!foe) {
      const facing = c.owner === 'left' ? 1 : -1;
      goal = { x: home.center.x + facing * (home.radius + cc.guardDistance), y: home.center.y };
    }
  } else {
    foe = nearest(c.pos, enemies.filter((e) => distance(e.pos, c.pos) < cc.aggroRange));
    if (!foe && enemyMain) goal = enemyMain.center;
  }

  // 2. Fight an enemy chalkling we're touching.
  if (foe) {
    if (distance(c.pos, foe.pos) <= c.radius + foe.radius + cc.contactPad) {
      c.action = 'fight';
      c.facing = Math.sign(foe.pos.x - c.pos.x) || c.facing;
      damageChalkling(state, foe, c.bite * dt);
      return;
    }
    goal = foe.pos;
  }
  if (!goal) {
    c.action = 'idle';
    return;
  }

  // 3. Walk toward the goal. Lines in the way block us: enemy lines get
  //    chewed, our own lines we walk around.
  const dist = distance(c.pos, goal);
  if (dist < 3) {
    c.action = 'idle';
    return;
  }
  const stepLen = Math.min(c.speed * dt, dist);
  const step = { x: ((goal.x - c.pos.x) / dist) * stepLen, y: ((goal.y - c.pos.y) / dist) * stepLen };
  if (Math.abs(step.x) > 0.01) c.facing = Math.sign(step.x);

  const blocker = findBlocker(state, c, add(c.pos, step));
  if (!blocker) {
    c.pos = clampToBoard(add(c.pos, step), state.cfg.world);
    c.action = 'walk';
    return;
  }
  if (blocker.thing.owner !== c.owner) {
    c.action = 'chew';
    chew(state, c, blocker, dt);
    return;
  }
  // Our own line: slide along it.
  let slide = project(step, blocker.tangent);
  if (Math.hypot(slide.x, slide.y) < stepLen * 0.2) {
    // Walking straight into it: pick a way round (each creature always picks the same way).
    const sign = c.id % 2 ? 1 : -1;
    slide = { x: blocker.tangent.x * stepLen * sign, y: blocker.tangent.y * stepLen * sign };
  }
  if (!findBlocker(state, c, add(c.pos, slide))) {
    c.pos = clampToBoard(add(c.pos, slide), state.cfg.world);
    c.action = 'walk';
  } else {
    c.action = 'idle'; // stuck
  }
}

function chew(state, c, blocker, dt) {
  const amount = c.bite * dt;
  if (blocker.kind === 'wall') damageWall(state, blocker.thing, amount, blocker.point);
  else {
    const ward = blocker.thing;
    damageSection(state, ward, sectionAt(ward.center, c.pos, ward.sections.length), amount, blocker.point);
  }
}

// Would moving to `next` push this chalkling into a line? Moving away from a
// line it already overlaps is always allowed, so nothing gets stuck forever.
function findBlocker(state, c, next) {
  let best = null;
  for (const wall of state.walls) {
    if (wall.gone) continue;
    const now = closestOnSegment(c.pos, wall.from, wall.to).dist;
    const then = closestOnSegment(next, wall.from, wall.to);
    if (then.dist < c.radius && then.dist < now && (!best || then.dist < best.gap)) {
      const len = Math.hypot(wall.to.x - wall.from.x, wall.to.y - wall.from.y) || 1;
      const tangent = { x: (wall.to.x - wall.from.x) / len, y: (wall.to.y - wall.from.y) / len };
      best = { kind: 'wall', thing: wall, point: then.point, gap: then.dist, tangent };
    }
  }
  for (const ward of state.wards) {
    if (ward.gone) continue;
    const now = Math.abs(distance(c.pos, ward.center) - ward.radius);
    const d = distance(next, ward.center) || 1;
    const then = Math.abs(d - ward.radius);
    if (then < c.radius && then < now && (!best || then < best.gap)) {
      const out = { x: (next.x - ward.center.x) / d, y: (next.y - ward.center.y) / d };
      const point = { x: ward.center.x + out.x * ward.radius, y: ward.center.y + out.y * ward.radius };
      best = { kind: 'ward', thing: ward, point, gap: then, tangent: { x: -out.y, y: out.x } };
    }
  }
  return best;
}

function mainOf(state, side) {
  return state.wards.find((w) => w.owner === side && w.main && !w.gone);
}

function nearest(from, list) {
  let best = null;
  let bestD = Infinity;
  for (const e of list) {
    const d = distance(from, e.pos);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function project(v, dir) {
  const dot = v.x * dir.x + v.y * dir.y;
  return { x: dir.x * dot, y: dir.y * dot };
}

function clampToBoard(p, world) {
  return { x: Math.max(0, Math.min(world.width, p.x)), y: Math.max(0, Math.min(world.height, p.y)) };
}
