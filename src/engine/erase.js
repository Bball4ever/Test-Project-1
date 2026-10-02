// Erasing: click one of your lines with the eraser and 3 seconds later it's gone.
//
// The engine does the timing, so nobody can cheat the 3 seconds, even online.
// You can erase your own walls, chains, paths and small circles, but never
// your main circle, and never anything of your opponent's. Each duelist
// erases one line at a time; clicking another line starts over on that one.

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

// The eraser is clicked at `at`. If one of our lines is there, it starts
// being erased. Returns { accepted } so the controller knows it hit a line.
export function eraseAction(state, side, at) {
  const target = at && erasableAt(state, side, at);
  if (!target) return { accepted: false, result: null };
  state.erasing[side] = { targetId: target.id, kind: target.kind, startTick: state.tick, at, progress: 0 };
  emit(state, { type: 'eraseStart', owner: side, id: target.id, point: at });
  return { accepted: true, result: null };
}

// Called every engine step: finish erasing once 3 seconds have passed.
export function stepErasing(state) {
  const ms = state.cfg.stepMs;
  for (const side of ['left', 'right']) {
    const e = state.erasing[side];
    if (!e) continue;
    const stillThere = [...state.walls, ...state.chains, ...state.paths, ...state.wards].some((t) => t.id === e.targetId && !t.gone);
    if (!stillThere) {
      state.erasing[side] = null; // it was destroyed some other way
      continue;
    }
    e.progress = Math.min(1, ((state.tick - e.startTick) * ms) / state.makeCfg.eraseMs);
    if (e.progress >= 1) {
      removeThing(state, side, e.targetId);
      state.erasing[side] = null;
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
