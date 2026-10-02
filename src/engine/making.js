// Making chalklings the book way, and commanding them.
//
//   1. Chain:          a straight line from one of your bind points.
//   2. Holding circle: a circle touching the chain's far end.
//   3. Creature:       strokes drawn inside the holding circle.
//   4. Path:           a line from the holding circle to where it should go.
//                      Ending it on an enemy chalkling means "hunt that one".
//   5. Release:        erase the chain (3 seconds). The chalkling breaks out.
//
// To give an existing chalkling a new command: chain it (a line from a bind
// point to the chalkling), draw a new path from it, and erase the chain.

import { distance, resample } from '../recognizer/clean.js';
import { emit } from './damage.js';
import { boundIndex } from './bind.js';
import { measureCreature, makeChalkling, command } from './chalklings.js';

const near = (a, b, d) => distance(a, b) <= d;

// The far end of a line that starts at a bind point of its owner's main circle,
// or null if it doesn't start at one.
function freeEndFromBindPoint(main, wall, cfg) {
  if (!main) return null;
  for (const [end, other] of [
    [wall.from, wall.to],
    [wall.to, wall.from],
  ]) {
    const onCircle = Math.abs(distance(end, main.center) - main.radius) < cfg.touchTolerance;
    if (onCircle && boundIndex(main, end, cfg) >= 0 && distance(other, main.center) > distance(end, main.center)) return other;
  }
  return null;
}

// Is this stroke part of a creature being drawn inside one of our holding circles?
export function holdingFor(state, owner, points) {
  const mk = state.makeCfg;
  for (const ward of state.wards) {
    if (ward.owner !== owner || !ward.holding || ward.gone) continue;
    const inside = points.filter((p) => distance(p, ward.center) < ward.radius * 0.97).length;
    if (inside / points.length >= mk.insideFraction) return ward;
  }
  return null;
}

export function addCreatureStroke(state, ward, points) {
  if (ward.creature.length >= state.chalkCfg.maxStrokes) return { accepted: false, result: { type: 'dud', reason: 'creature has enough strokes', quality: 0 } };
  ward.creature.push(points);
  emit(state, { type: 'creatureStroke', owner: ward.owner, wardId: ward.id });
  return { accepted: true, result: { type: 'creature', reason: null, quality: 1, strokes: ward.creature.length } };
}

// Does this stroke start at one of our holding circles (with a creature in it)
// or at a chained chalkling, and lead away from it? Then it's a path.
export function pathOrigin(state, owner, points) {
  const mk = state.makeCfg;
  const start = points[0];
  const end = points[points.length - 1];
  for (const ward of state.wards) {
    if (ward.owner !== owner || !ward.holding || ward.gone || !ward.creature.length) continue;
    if (distance(start, ward.center) <= ward.radius + mk.pathStartReach && distance(end, ward.center) > ward.radius + mk.pathStartReach) {
      return { holdingId: ward.id, chalklingId: null };
    }
  }
  for (const c of state.chalklings) {
    if (c.owner !== owner || c.mode !== 'held' || c.gone) continue;
    if (distance(start, c.pos) <= c.radius + mk.pathStartReach && distance(end, c.pos) > c.radius + mk.pathStartReach) {
      return { holdingId: null, chalklingId: c.id };
    }
  }
  return null;
}

export function addPath(state, owner, points, origin) {
  const mk = state.makeCfg;
  const { width, height } = state.cfg.world;
  const clean = resample(points, mk.pathSpacing).map((p) => ({
    x: Math.max(0, Math.min(width, p.x)),
    y: Math.max(0, Math.min(height, p.y)),
  }));
  const end = clean[clean.length - 1];
  const prey = state.chalklings.find((e) => e.owner !== owner && !e.gone && distance(end, e.pos) <= e.radius + mk.huntReach);
  // A new path replaces an older one from the same place.
  state.paths = state.paths.filter((p) => !(p.holdingId === origin.holdingId && p.chalklingId === origin.chalklingId));
  const path = { id: state.nextId++, kind: 'path', owner, points: clean, ...origin, huntId: prey?.id ?? null };
  state.paths.push(path);
  emit(state, { type: 'path', owner, id: path.id, huntId: path.huntId, point: end });
  return { accepted: true, result: { type: 'path', reason: null, quality: 1, hunt: !!prey } };
}

// A new straight line from a bind point that ends on one of our chalklings
// chains that chalkling. Returns true if it did.
export function chainToChalkling(state, owner, wall, main) {
  const end = freeEndFromBindPoint(main, wall, state.cfg);
  if (!end) return false;
  const c = state.chalklings.find(
    (e) => e.owner === owner && !e.gone && e.mode !== 'held' && near(end, e.pos, e.radius + state.cfg.touchTolerance),
  );
  if (!c) return false;
  const chain = { id: wall.id, kind: 'chain', owner, from: wall.from, to: wall.to, points: wall.points, holdingId: null, chalklingId: c.id };
  state.chains.push(chain);
  c.mode = 'held';
  c.chainId = chain.id;
  c.path = null;
  c.huntId = null;
  emit(state, { type: 'chain', owner, id: chain.id, chalklingId: c.id, point: end });
  return true;
}

// A new circle touching the far end of one of our lines from a bind point turns
// that line into a chain and the circle into a holding circle. Returns true if it did.
export function holdOnChain(state, owner, ward, main) {
  let best = null;
  for (const wall of state.walls) {
    if (wall.owner !== owner || wall.gone) continue;
    const end = freeEndFromBindPoint(main, wall, state.cfg);
    if (!end) continue;
    const gap = Math.abs(distance(end, ward.center) - ward.radius);
    if (gap < state.cfg.touchTolerance && (!best || gap < best.gap)) best = { wall, gap, end };
  }
  if (!best) return false;
  const { wall } = best;
  state.walls = state.walls.filter((w) => w !== wall); // it's a chain now, not a wall
  const chain = { id: wall.id, kind: 'chain', owner, from: wall.from, to: wall.to, points: wall.points, holdingId: ward.id, chalklingId: null };
  state.chains.push(chain);
  ward.holding = true;
  ward.chainId = chain.id;
  ward.creature = [];
  emit(state, { type: 'chain', owner, id: chain.id, holdingId: ward.id, point: best.end });
  return true;
}

// The chain has been erased: let go of whatever it was holding.
export function release(state, chain) {
  state.chains = state.chains.filter((c) => c.id !== chain.id);
  const path = state.paths.find((p) => (chain.holdingId ? p.holdingId === chain.holdingId : p.chalklingId === chain.chalklingId));
  if (path) state.paths = state.paths.filter((p) => p !== path);

  if (chain.chalklingId) {
    const c = state.chalklings.find((e) => e.id === chain.chalklingId && !e.gone);
    if (c) command(state, c, path);
    return;
  }

  const ward = state.wards.find((w) => w.id === chain.holdingId && !w.gone);
  if (!ward) return;
  ward.holding = false;
  ward.chainId = null;
  const strokes = ward.creature;
  ward.creature = [];
  if (!strokes.length) return; // nothing inside: it's just an ordinary small circle now

  const cc = state.chalkCfg;
  const measure = measureCreature(strokes, cc);
  if (measure.ink < cc.minInk) {
    emit(state, { type: 'dud', owner: ward.owner, reason: 'too little chalk to come alive', points: strokes.flat(), strokes });
    return;
  }
  // The creature breaks out and the holding circle is gone.
  ward.gone = true;
  const c = makeChalkling(state.nextId++, ward.owner, strokes, measure, cc, state.orders[ward.owner]);
  state.chalklings.push(c);
  emit(state, { type: 'placed', owner: c.owner, kind: 'chalkling', id: c.id, quality: measure.detail / cc.maxDetail, role: c.role });
  command(state, c, path);
}

// Tidy up after things are destroyed: a broken holding circle loses its
// creature, chain and path; a dead chalkling loses its chain and path.
export function tidy(state) {
  const liveWards = new Set(state.wards.filter((w) => !w.gone).map((w) => w.id));
  const liveChalklings = new Set(state.chalklings.filter((c) => !c.gone).map((c) => c.id));
  const alive = (x) => (x.holdingId ? liveWards.has(x.holdingId) : liveChalklings.has(x.chalklingId));
  for (const ward of state.wards) {
    if (ward.gone && ward.holding && ward.creature.length) {
      emit(state, { type: 'creatureLost', owner: ward.owner, wardId: ward.id, point: ward.center });
      ward.creature = [];
    }
  }
  state.chains = state.chains.filter(alive);
  state.paths = state.paths.filter(alive);
}
