// Everything a duelist can do, as plain data "actions":
//   { type: 'stroke', points: [{x, y}, ...], making }       draw one line
//                                   (making: true when Chalkling mode is on)
//   { type: 'erase', at: {x, y} }                            erase the line there (takes 3 s)
//   { type: 'order', order: 'attack' | 'guard' }             command your chalklings
//
// There's deliberately no "make a chalkling" action: chalklings can only be
// made by drawing (chain, holding circle, creature, path) and erasing.
//
// Using plain data means the same action can come from the mouse, the bot,
// or over the network, and the engine treats them all the same.

import { addStroke, setOrder, ORDERS } from './duel.js';
import { eraseAction } from './erase.js';

export function applyAction(state, side, action) {
  if (action.type === 'stroke') return addStroke(state, side, action.points, { making: !!action.making });
  if (action.type === 'erase') return eraseAction(state, side, action.at);
  if (action.type === 'order') {
    setOrder(state, side, action.order);
    return { accepted: true, result: null };
  }
  return { accepted: false, result: null };
}

const MAX_POINTS = 3000;

function cleanPoints(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_POINTS) return null;
  const points = [];
  for (const p of raw) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push({ x, y });
  }
  return points;
}

// Check an action that came from somewhere we don't trust (the network).
// Returns a clean copy, or null if it's malformed.
export function sanitizeAction(raw) {
  if (raw?.type === 'stroke') {
    const points = cleanPoints(raw.points);
    return points && { type: 'stroke', points, making: raw.making === true };
  }
  if (raw?.type === 'erase') {
    const at = raw.at ? cleanPoints([raw.at])?.[0] : null;
    return at ? { type: 'erase', at } : null;
  }
  if (raw?.type === 'order' && ORDERS.includes(raw.order)) return { type: 'order', order: raw.order };
  return null;
}
