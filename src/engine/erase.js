// Erasing: rub a line for 3 seconds in a row and it's gone.
//
// While the eraser is down, the player's controller keeps telling the engine
// where it is (about 10 times a second). The engine times it, so nobody can
// cheat the 3 seconds, even online. Lifting the eraser, or moving off the line
// for longer than a moment, starts the count again.
//
// You can erase your own walls, chains, paths and small circles, but never
// your main circle, and never anything of your opponent's.

import { closestOnSegment } from './collide.js';
import { emit } from './damage.js';
import { release } from './making.js';

function distToPolyline(p, points) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) best = Math.min(best, closestOnSegment(p, points[i - 1], points[i]).dist);
  return points.length === 1 ? Math.hypot(p.x - points[0].x, p.y - points[0].y) : best;
}

// The line of ours closest to `at`, if it's within reach.
export function erasableAt(state, side, at) {
  const reach = state.makeCfg.eraseReach;
  let best = null;
  const consider = (thing, dist) => {
    if (dist <= reach && (!best || dist < best.dist)) best = { thing, dist };
  };
  for (const w of state.walls) if (w.owner === side && !w.gone) consider(w, distToPolyline(at, w.points));
  for (const c of state.chains) if (c.owner === side) consider(c, distToPolyline(at, c.points));
  for (const p of state.paths) if (p.owner === side) consider(p, distToPolyline(at, p.points));
  for (const w of state.wards) {
    if (w.owner === side && !w.main && !w.gone) consider(w, Math.abs(Math.hypot(at.x - w.center.x, at.y - w.center.y) - w.radius));
  }
  return best?.thing ?? null;
}

// phase: 'start' | 'move' | 'stop'. at: where the eraser is.
export function eraseAction(state, side, phase, at) {
  if (phase === 'stop' || !at) {
    state.erasing[side] = null;
    return { accepted: true, result: null };
  }
  const target = erasableAt(state, side, at);
  const current = state.erasing[side];
  if (!target) {
    if (current) current.at = at; // off the line: the grace timer in step() decides
    return { accepted: true, result: null };
  }
  if (!current || current.targetId !== target.id) {
    state.erasing[side] = { targetId: target.id, kind: target.kind, startTick: state.tick, lastTick: state.tick, at };
  } else {
    current.lastTick = state.tick;
    current.at = at;
  }
  return { accepted: true, result: null };
}

// Called every engine step: finish or cancel erasing.
export function stepErasing(state) {
  const mk = state.makeCfg;
  const ms = state.cfg.stepMs;
  for (const side of ['left', 'right']) {
    const e = state.erasing[side];
    if (!e) continue;
    if ((state.tick - e.lastTick) * ms > mk.eraseGraceMs) {
      state.erasing[side] = { ...e, targetId: null, kind: null }; // wandered off: start again
      continue;
    }
    if (!e.targetId) continue;
    e.progress = Math.min(1, ((state.tick - e.startTick) * ms) / mk.eraseMs);
    if (e.progress >= 1) {
      removeThing(state, side, e.targetId);
      state.erasing[side] = { at: e.at, targetId: null, kind: null };
    }
  }
}

function removeThing(state, side, id) {
  const chain = state.chains.find((c) => c.id === id);
  const point = state.erasing[side]?.at;
  if (chain) {
    emit(state, { type: 'erased', owner: side, id, kind: 'chain', point });
    release(state, chain);
    return;
  }
  const path = state.paths.find((p) => p.id === id);
  if (path) {
    state.paths = state.paths.filter((p) => p !== path);
    emit(state, { type: 'erased', owner: side, id, kind: 'path', point });
    return;
  }
  const thing = state.walls.find((w) => w.id === id) ?? state.wards.find((w) => w.id === id && !w.main);
  if (thing) {
    thing.gone = true;
    emit(state, { type: 'erased', owner: side, id, kind: thing.kind, point });
  }
}
