// Everything a duelist can do, as plain data "actions":
//   { type: 'stroke', points: [{x, y}, ...] }        draw one line
//   { type: 'chalkling', strokes: [[{x, y}, ...], ...] } finish a chalkling
//   { type: 'order', order: 'attack' | 'guard' }      command your chalklings
//
// Using plain data means the same action can come from the mouse, the bot,
// or over the network, and the engine treats them all the same.

import { addStroke, addChalkling, setOrder, ORDERS } from './duel.js';

export function applyAction(state, side, action) {
  if (action.type === 'stroke') return addStroke(state, side, action.points);
  if (action.type === 'chalkling') return addChalkling(state, side, action.strokes);
  if (action.type === 'order') {
    setOrder(state, side, action.order);
    return { accepted: true, result: null };
  }
  return { accepted: false, result: null };
}

const MAX_POINTS = 3000;
const MAX_STROKES = 30;

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
    return points && { type: 'stroke', points };
  }
  if (raw?.type === 'chalkling') {
    if (!Array.isArray(raw.strokes) || raw.strokes.length < 1 || raw.strokes.length > MAX_STROKES) return null;
    const strokes = raw.strokes.map(cleanPoints);
    return strokes.every(Boolean) ? { type: 'chalkling', strokes } : null;
  }
  if (raw?.type === 'order' && ORDERS.includes(raw.order)) return { type: 'order', order: raw.order };
  return null;
}
