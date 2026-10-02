// Turning a duel state into a message for the network, and back.
//
// The server runs the real duel. About 30 times a second it sends both players
// a "snapshot" of the state. The chalk drawings themselves (lists of points) are
// big and never change, so each one is sent only once, the first time it
// appears; after that, snapshots just say where things are and how healthy.

const LISTS = ['wards', 'walls', 'vigors', 'chalklings', 'chains', 'paths'];

// sent: a Set of ids whose drawings have already been sent.
export function makeSnapshot(state, sent) {
  const snap = {
    tick: state.tick,
    timeMs: state.timeMs,
    winner: state.winner,
    orders: state.orders,
    bindPoints: state.bindPoints,
    erasing: state.erasing,
  };
  for (const list of LISTS) {
    snap[list] = state[list].map((thing) => {
      const { points, strokes, ...rest } = thing;
      if (sent.has(thing.id)) return rest;
      sent.add(thing.id);
      return { ...rest, points, strokes };
    });
  }
  return snap;
}

// cache: a Map from id to { points, strokes }, kept between snapshots.
export function readSnapshot(snap, cache) {
  const state = { ...snap, events: [] };
  for (const list of LISTS) {
    state[list] = (snap[list] ?? []).map((thing) => {
      if (thing.points || thing.strokes) cache.set(thing.id, { points: thing.points, strokes: thing.strokes });
      const drawing = cache.get(thing.id) ?? {};
      return { ...thing, points: thing.points ?? drawing.points, strokes: thing.strokes ?? drawing.strokes };
    });
  }
  return state;
}
