// Making chalklings the book way, and commanding them.
//
// While a duelist has Chalkling mode on, their strokes are read as chalkling
// parts instead of ordinary lines:
//   1. Chain:          a straight line from one of your bind points.
//   2. Holding circle: a circle touching the chain's far end.
//   3. Creature:       strokes drawn inside the holding circle (in the main
//                      screen, or zoomed in on the detail screen, which counts
//                      for more detail). As many strokes as you like.
//   4. Path:           a line from the holding circle to where it should go.
//                      Ending it on an enemy chalkling means "hunt that one".
//   5. Release:        erase the chain (3 seconds). The chalkling breaks out.
//
// To give an existing chalkling a new command: chain it (a line from a bind
// point to the chalkling), draw a new path from it, and erase the chain.

import { distance, resample } from '../recognizer/clean.js';
import { recognize } from '../recognizer/index.js';
import { emit } from './damage.js';
import { buildSections } from './wards.js';
import { boundIndex } from './bind.js';
import { measureCreature, makeChalkling, command } from './chalklings.js';
import { onOwnSide, isFoe } from './territory.js';

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

// detail: true if it was drawn in the detail screen (it counts for more).
export function addCreatureStroke(state, ward, points, detail = false, control = 'remote') {
  ward.creature.push(points);
  ward.creatureDetail = [...(ward.creatureDetail ?? []), !!detail];
  ward.control = control; // and how it will be controlled (remote, attack or guard)
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
  const prey = state.chalklings.find((e) => isFoe(state, owner, e.owner) && !e.gone && distance(end, e.pos) <= e.radius + mk.huntReach);
  // A new path replaces an older one from the same place.
  state.paths = state.paths.filter((p) => !(p.holdingId === origin.holdingId && p.chalklingId === origin.chalklingId));
  const path = { id: state.nextId++, kind: 'path', owner, points: clean, ...origin, huntId: prey?.id ?? null };
  state.paths.push(path);
  emit(state, { type: 'path', owner, id: path.id, huntId: path.huntId, point: end });
  return { accepted: true, result: { type: 'path', reason: null, quality: 1, hunt: !!prey } };
}

// A stroke drawn in Chalkling mode. Works out which step it is from what's
// already on the board, and says what's needed next if it doesn't fit.
export function addMakingStroke(state, owner, points, main, detail = false, control = 'remote') {
  const reject = (reason, result = null) => {
    emit(state, { type: 'dud', owner, reason, points });
    return { accepted: false, result: { ...(result ?? {}), type: 'dud', reason, quality: result?.quality ?? 0 } };
  };
  if (!main) return reject('draw your main circle first');

  // 3. A stroke inside one of our holding circles is part of the creature.
  const holding = holdingFor(state, owner, points);
  if (holding) return addCreatureStroke(state, holding, points, detail, control);
  // The detail screen is only for drawing inside a holding circle.
  if (detail) return reject('in the detail screen, draw inside the holding circle');
  // 4. A stroke leading out of a holding circle (or a chained chalkling) is its path.
  const origin = pathOrigin(state, owner, points);
  if (origin) return addPath(state, owner, points, origin);

  const result = recognize(points);
  if (!onOwnSide(state, owner, points)) return reject('stay on your side', result);

  // 1. A straight line from a bind point is a chain. If it ends on one of our
  //    chalklings, that chalkling is chained (ready for a new command).
  if (result.type === 'forbiddance') {
    const line = { from: result.shape.from, to: result.shape.to };
    const end = freeEndFromBindPoint(main, line, state.cfg);
    if (!end) return reject('a chain must start at a green bind point', result);
    const chain = { id: state.nextId++, kind: 'chain', owner, from: line.from, to: line.to, points, holdingId: null, chalklingId: null };
    const c = state.chalklings.find(
      (e) => e.owner === owner && !e.gone && e.mode !== 'held' && near(end, e.pos, e.radius + state.cfg.touchTolerance),
    );
    if (c) {
      chain.chalklingId = c.id;
      c.mode = 'held';
      c.chainId = chain.id;
      c.path = null;
      c.huntId = null;
    }
    state.chains.push(chain);
    emit(state, { type: 'chain', owner, id: chain.id, chalklingId: c?.id ?? null, point: end });
    return { accepted: true, result: { ...result, type: 'chain' } };
  }

  // 2. A circle touching the end of a chain that isn't holding anything yet.
  if (result.type === 'warding') {
    const { center, radius } = result.shape;
    let best = null;
    for (const chain of state.chains) {
      if (chain.owner !== owner || chain.holdingId || chain.chalklingId) continue;
      const end = freeEndFromBindPoint(main, chain, state.cfg);
      const gap = end ? Math.abs(distance(end, center) - radius) : Infinity;
      if (gap < state.cfg.touchTolerance && (!best || gap < best.gap)) best = { chain, gap };
    }
    if (!best) return reject(nextStepReason(state, owner), result);
    const ward = {
      id: state.nextId++,
      kind: 'ward',
      owner,
      main: false,
      center,
      radius,
      quality: result.quality,
      sections: buildSections(result, state.cfg),
      points,
      holding: true,
      chainId: best.chain.id,
      creature: [],
      creatureDetail: [],
    };
    best.chain.holdingId = ward.id;
    state.wards.push(ward);
    emit(state, { type: 'holding', owner, id: ward.id, point: { x: center.x, y: center.y - radius } });
    return { accepted: true, result: { ...result, type: 'holding' } };
  }

  return reject(nextStepReason(state, owner), result);
}

// What the player should draw next, for a stroke that didn't fit.
function nextStepReason(state, owner) {
  if (state.chains.some((c) => c.owner === owner && !c.holdingId && !c.chalklingId)) return 'next: a circle on the end of the chain';
  const holding = state.wards.find((w) => w.owner === owner && w.holding && !w.gone);
  if (holding && !holding.creature.length) return 'draw your chalkling inside the circle';
  if (holding) return 'draw inside the circle, or a path out of it';
  if (state.chalklings.some((c) => c.owner === owner && c.mode === 'held')) return 'next: a path from your chained chalkling';
  return 'start with a straight line from a green bind point';
}

// The chain has been erased: let go of whatever it was holding.
export function release(state, chain) {
  state.chains = state.chains.filter((c) => c.id !== chain.id);
  if (!chain.holdingId && !chain.chalklingId) return; // a chain with nothing on it yet
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
  const detailFlags = ward.creatureDetail ?? [];
  ward.creature = [];
  ward.creatureDetail = [];
  if (!strokes.length) return; // nothing inside: it's just an ordinary small circle now

  const cc = state.chalkCfg;
  const measure = measureCreature(strokes, cc, detailFlags);
  if (measure.ink < cc.minInk) {
    emit(state, { type: 'dud', owner: ward.owner, reason: 'too little chalk to come alive', points: strokes.flat(), strokes });
    return;
  }
  // The creature breaks out and the holding circle is gone.
  ward.gone = true;
  const c = makeChalkling(state.nextId++, ward.owner, strokes, measure, cc, state.orders[ward.owner], ward.control);
  state.chalklings.push(c);
  emit(state, { type: 'placed', owner: c.owner, kind: 'chalkling', id: c.id, quality: measure.detail / cc.maxDetail, role: c.role, control: c.control, detail: c.detail });
  command(state, c, path);
}

// Tidy up after things are destroyed: a broken holding circle loses its
// creature, chain and path; a dead chalkling loses its chain and path.
export function tidy(state) {
  const liveWards = new Set(state.wards.filter((w) => !w.gone).map((w) => w.id));
  const liveChalklings = new Set(state.chalklings.filter((c) => !c.gone).map((c) => c.id));
  const alive = (x) => {
    if (x.holdingId) return liveWards.has(x.holdingId);
    if (x.chalklingId) return liveChalklings.has(x.chalklingId);
    return true; // a chain still waiting for its holding circle
  };
  for (const ward of state.wards) {
    if (ward.gone && ward.holding && ward.creature.length) {
      emit(state, { type: 'creatureLost', owner: ward.owner, wardId: ward.id, point: ward.center });
      ward.creature = [];
    }
  }
  state.chains = state.chains.filter(alive);
  state.paths = state.paths.filter(alive);
}
