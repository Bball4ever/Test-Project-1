// Lines of Making: chalklings, little chalk creatures that walk and fight.
//
// The drawing itself is the creature's body. Its strength comes from how much
// effort went into it (more chalk, more strokes, closed shapes), and its role
// comes from what the drawing looks like:
//   spiky  (claws, teeth: loose line ends and sharp corners) → attacker, bites harder
//   bulky  (shells, round bodies: big closed shapes)         → defender, more health
//   leggy  (long stretched body, lots of short strokes)      → runner, faster
//
// What a chalkling is doing is its "mode":
//   held     chained to its maker, standing still (only defends itself)
//   path     walking its path no matter what, chewing through any wall in the way
//   hunt     chasing one enemy chalkling until it's dead, no matter what
//   return   mission done: walking back to its own side of the board
//   waiting  back home, waiting to be chained and given a new command
//   order    following its side's Attack / Guard order

import { pathLength, distance, resample } from '../recognizer/clean.js';
import { closestOnSegment, sectionAt } from './collide.js';
import { damageSection, damageWall, damageChalkling, emit, otherSide } from './damage.js';
import { obstaclesFor, findRoute, pointBlocked } from './route.js';

const REPLAN_TICKS = 30; // look for a fresh route twice a second

// --- Measuring a drawing ---------------------------------------------------------

export function measureCreature(strokes, cc) {
  let ink = 0;
  let closed = 0;
  let area = 0;
  let looseEnds = 0;
  let corners = 0;
  let shortStrokes = 0;
  const all = strokes.flat();
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  for (const stroke of strokes) {
    const len = pathLength(stroke);
    ink += len;
    const isClosed = stroke.length > 3 && len >= cc.minClosedInk && distance(stroke[0], stroke[stroke.length - 1]) / len < cc.closedGapRatio;
    if (isClosed) {
      closed++;
      area += polygonArea(stroke);
    } else {
      looseEnds += 2;
      corners += countCorners(stroke, cc.cornerAngle);
      if (len < cc.shortStroke) shortStrokes++;
    }
  }

  const detail = Math.min(
    cc.maxDetail,
    ink * cc.detailPerInk + strokes.length * cc.detailPerStroke + closed * cc.detailPerClosedShape,
  );
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const stretch = Math.max(w, h) / Math.min(w, h);
  const traits = {
    spiky: looseEnds * cc.spikePerLooseEnd + corners * cc.spikePerCorner,
    bulky: Math.sqrt(area * cc.bulkPerArea),
    // Short strokes only count as legs on a stretched-out body (otherwise they're spikes).
    leggy: Math.max(0, stretch - 1.5) * cc.leggyPerStretch + (stretch > 2 ? shortStrokes * cc.leggyPerShortStroke : 0),
  };
  const total = traits.spiky + traits.bulky + traits.leggy || 1;
  const shares = { spiky: traits.spiky / total, bulky: traits.bulky / total, leggy: traits.leggy / total };
  const top = Object.entries(shares).sort((a, b) => b[1] - a[1])[0];
  const role = top[1] < cc.balancedBelow ? 'balanced' : { spiky: 'attacker', bulky: 'defender', leggy: 'runner' }[top[0]];

  return {
    ink,
    closed,
    strokes: strokes.length,
    detail,
    size: Math.max(w, h),
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    looseEnds,
    corners,
    area,
    shortStrokes,
    stretch,
    shares,
    role,
  };
}

function polygonArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

// Sharp bends in a stroke (each bend counted once).
function countCorners(stroke, limit) {
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

export function makeChalkling(id, owner, strokes, measure, cc, order) {
  // A role shifts strength toward one stat: an attacker's bite goes up,
  // a defender's health goes up, a runner's speed goes up.
  const boost = (share) => 1 - cc.roleBoost / 3 + cc.roleBoost * share;
  const health = (cc.baseHealth + cc.healthPerDetail * measure.detail) * boost(measure.shares.bulky);
  return {
    id,
    kind: 'chalkling',
    owner,
    strokes,
    origin: measure.center, // where it was drawn; the drawing is shown relative to this
    pos: { ...measure.center },
    radius: Math.max(cc.minRadius, Math.min(cc.maxRadius, measure.size * 0.4)),
    detail: measure.detail,
    role: measure.role,
    hp: health,
    max: health,
    bite: (cc.baseBite + cc.bitePerDetail * measure.detail) * boost(measure.shares.spiky),
    speed: (cc.baseSpeed / (1 + cc.slowPerDetail * measure.detail)) * boost(measure.shares.leggy),
    mode: 'order',
    order,
    path: null,
    pathIndex: 0,
    huntId: null,
    chainId: null,
    action: 'idle', // walk | chew | fight | idle (for the renderer's animation)
    facing: owner === 'left' ? 1 : -1,
  };
}

// Give a chalkling its command when its chain is erased.
export function command(state, c, path) {
  c.chainId = null;
  c.path = null;
  c.huntId = null;
  if (path?.huntId) {
    const target = state.chalklings.find((e) => e.id === path.huntId && !e.gone);
    if (target) {
      c.mode = 'hunt';
      c.huntId = target.id;
    } else c.mode = 'return';
  } else if (path) {
    c.mode = 'path';
    c.path = path.points;
    c.pathIndex = 0;
  } else {
    c.mode = 'order';
    c.order = state.orders[c.owner];
  }
  emit(state, { type: 'command', owner: c.owner, id: c.id, mode: c.mode, huntId: c.huntId });
}

// --- Moving and fighting -----------------------------------------------------------

export function stepChalklings(state, dt) {
  for (const c of state.chalklings) {
    if (!c.gone && !state.winner) stepOne(state, c, dt);
  }
}

function stepOne(state, c, dt) {
  const mk = state.makeCfg;
  if (c.mode === 'held') {
    defendSelf(state, c, dt); // chained: it can't move, but it bites back
    return;
  }
  // An enemy chalkling that comes close gets attacked, whatever this one was
  // doing; afterwards it carries on. (Hunters stay locked on their target, and
  // Attack/Guard chalklings already go after enemies, further out.)
  if (c.mode !== 'hunt' && c.mode !== 'order') {
    const foe = closeEnemy(state, c);
    if (foe) {
      if (touching(state, c, foe)) bite(state, c, foe, dt);
      else navigate(state, c, foe.pos, dt);
      return;
    }
  }
  if (c.mode === 'waiting') {
    c.action = 'idle';
    return;
  }
  if (c.mode === 'hunt') {
    const target = state.chalklings.find((e) => e.id === c.huntId && !e.gone);
    if (!target) {
      c.mode = 'return';
      c.huntId = null;
      emit(state, { type: 'missionDone', owner: c.owner, id: c.id, point: { ...c.pos } });
      return;
    }
    if (touching(state, c, target)) {
      bite(state, c, target, dt);
      return;
    }
    // Hunting: go round lines if possible; if there's no way round, chew through.
    navigate(state, c, target.pos, dt, { chewIfNoWayRound: true });
    return;
  }
  if (c.mode === 'path') {
    while (c.pathIndex < c.path.length && distance(c.pos, c.path[c.pathIndex]) < mk.waypointReach) c.pathIndex++;
    // Where the path crosses a wall, aim for the first point past it (so it can go around).
    const walls = { walls: state.walls.filter((w) => !w.gone), wards: [], clearance: c.radius + 2 };
    while (c.pathIndex < c.path.length - 1 && pointBlocked(c.path[c.pathIndex], walls)) c.pathIndex++;
    if (c.pathIndex >= c.path.length) {
      c.mode = 'order';
      c.order = state.orders[c.owner];
      c.path = null;
      emit(state, { type: 'pathDone', owner: c.owner, id: c.id });
      return;
    }
    // On a path: go around walls if there's a way round, chew through them if
    // not. Enemy circles on the path aren't avoided: it attacks them.
    navigate(state, c, c.path[c.pathIndex], dt, { enemyWardsBlock: false, chewIfNoWayRound: true });
    return;
  }
  if (c.mode === 'return') {
    const mid = state.cfg.world.width / 2;
    const goal = { x: mid + (c.owner === 'left' ? -1 : 1) * mk.returnDepth, y: c.pos.y };
    const home = c.owner === 'left' ? c.pos.x <= goal.x + 2 : c.pos.x >= goal.x - 2;
    if (home) {
      c.mode = 'waiting';
      c.action = 'idle';
      emit(state, { type: 'waiting', owner: c.owner, id: c.id, point: { ...c.pos } });
      return;
    }
    navigate(state, c, goal, dt);
    return;
  }
  stepOrder(state, c, dt);
}

// Attack / Guard behaviour.
function stepOrder(state, c, dt) {
  const cc = state.chalkCfg;
  const home = mainOf(state, c.owner);
  const enemyMain = mainOf(state, otherSide(c.owner));
  const enemies = state.chalklings.filter((e) => e.owner !== c.owner && !e.gone);

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

  if (foe) {
    if (touching(state, c, foe)) {
      bite(state, c, foe, dt);
      return;
    }
    goal = foe.pos;
  }
  if (!goal || distance(c.pos, goal) < 3) {
    c.action = 'idle';
    return;
  }
  // Heading for the enemy's circle: that circle is the target, not an obstacle.
  const attacking = !foe && enemyMain && goal === enemyMain.center;
  navigate(state, c, goal, dt, { ignoreWardId: attacking ? enemyMain.id : null });
}

// Walk toward `goal` along a route that goes around lines. The route is worked
// out again every half second (lines appear and break), or if the goal moves.
// If there's no way round at all, it walks straight and chews enemy lines in
// the way (and with chewIfNoWayRound, any wall at all).
function navigate(state, c, goal, dt, { enemyWardsBlock = true, ignoreWardId = null, chewIfNoWayRound = false } = {}) {
  const goalMoved = !c.routeGoal || distance(goal, c.routeGoal) > 25;
  if (goalMoved || state.tick - (c.routeAt ?? -Infinity) >= REPLAN_TICKS) {
    const obstacles = obstaclesFor(state, c, { enemyWardsBlock, ignoreWardId });
    c.route = findRoute(state, c.pos, goal, obstacles);
    c.routeAt = state.tick;
    c.routeGoal = { x: goal.x, y: goal.y };
  }
  let next = goal;
  if (c.route?.length) {
    while (c.route.length > 1 && distance(c.pos, c.route[0]) < 6) c.route.shift();
    // On the last leg, head for where the goal is now (it may have moved).
    if (c.route.length > 1) next = c.route[0];
  }
  walkToward(state, c, next, dt, chewIfNoWayRound && !c.route);
}

// The nearest enemy chalkling within striking distance, if any.
function closeEnemy(state, c) {
  const reach = state.chalkCfg.closeRange;
  return nearest(
    c.pos,
    state.chalklings.filter((e) => e.owner !== c.owner && !e.gone && distance(e.pos, c.pos) < c.radius + e.radius + reach),
  );
}

function touching(state, c, other) {
  return distance(c.pos, other.pos) <= c.radius + other.radius + state.chalkCfg.contactPad;
}

function bite(state, c, foe, dt) {
  c.action = 'fight';
  c.facing = Math.sign(foe.pos.x - c.pos.x) || c.facing;
  damageChalkling(state, foe, c.bite * dt);
}

// Fight back against an enemy that's right next to us. Returns true if it did.
function defendSelf(state, c, dt) {
  const foe = state.chalklings.find((e) => e.owner !== c.owner && !e.gone && touching(state, c, e));
  if (foe) {
    bite(state, c, foe, dt);
    return true;
  }
  if (c.mode === 'held' || c.mode === 'waiting') c.action = 'idle';
  return false;
}

// One step toward `goal`. Lines in the way block us. Enemy lines get chewed;
// when chewAllWalls is on (following a path or hunting) we chew through any
// wall, even our own. We walk around our own circles.
function walkToward(state, c, goal, dt, chewAllWalls) {
  const dist = distance(c.pos, goal);
  if (dist < 0.5) return;
  const stepLen = Math.min(c.speed * dt, dist);
  const step = { x: ((goal.x - c.pos.x) / dist) * stepLen, y: ((goal.y - c.pos.y) / dist) * stepLen };
  if (Math.abs(step.x) > 0.01) c.facing = Math.sign(step.x);

  const blocker = findBlocker(state, c, add(c.pos, step));
  if (!blocker) {
    c.pos = clampToBoard(add(c.pos, step), state.cfg.world);
    c.action = 'walk';
    return;
  }
  const enemy = blocker.thing.owner !== c.owner;
  if (enemy || (blocker.kind === 'wall' && chewAllWalls)) {
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
