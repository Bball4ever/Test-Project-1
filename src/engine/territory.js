// Players and their territories.
//
// Every player has a HOME point. Their territory is the part of the board that
// is closer to their home than to anyone else's: that's where they may draw.
//
// With 2 players (the classic duel) the homes are at (400, 450) and
// (1200, 450) on the 1600 × 900 board, so the territories are exactly the left
// and right halves. With 3 to 10 players (you against several bots) the board
// is a bigger square, and the homes sit evenly around a ring, so each
// territory is a slice of it. Player ids: 'left' and 'right' for the first
// two, then 'p2', 'p3', … 'p9'.

export const MAX_PLAYERS = 10;

export function playerIds(count) {
  const n = Math.max(2, Math.min(MAX_PLAYERS, count));
  return Array.from({ length: n }, (_, i) => (i === 0 ? 'left' : i === 1 ? 'right' : `p${i}`));
}

// The board size and everyone's home for these players.
//   cfg: CONFIG.engine (world, territory settings)
export function makeTerritories(players, cfg) {
  if (players.length <= 2) {
    const { width, height } = cfg.world;
    return {
      world: { width, height },
      homes: { [players[0]]: { x: width / 4, y: height / 2 }, [players[1]]: { x: (width * 3) / 4, y: height / 2 } },
    };
  }
  // Neighbours on the ring are about `spacing` apart; the board leaves `margin`
  // around the ring for each player's circle, chains and holding circles.
  const t = cfg.territory;
  const n = players.length;
  const ring = Math.max(t.minRing, t.spacing / 2 / Math.sin(Math.PI / n));
  const side = Math.round(2 * (ring + t.margin));
  const mid = side / 2;
  const homes = {};
  players.forEach((id, i) => {
    // The first player (you) is at the bottom; the rest go round from there.
    const a = Math.PI / 2 + (i * 2 * Math.PI) / n;
    homes[id] = { x: mid + Math.cos(a) * ring, y: mid + Math.sin(a) * ring };
  });
  return { world: { width: side, height: side }, homes };
}

// How far inside its owner's territory a point is (negative = outside, in
// someone else's). It's the distance to the nearest border with a neighbour.
// Also returns that border's direction into the territory (`inward`).
export function depthIn(state, owner, p) {
  const me = state.homes[owner];
  let best = { depth: Infinity, inward: { x: 0, y: 0 } };
  for (const [id, other] of Object.entries(state.homes)) {
    if (id === owner) continue;
    const dx = me.x - other.x;
    const dy = me.y - other.y;
    const gap = Math.hypot(dx, dy) || 1;
    // Signed distance from the border halfway between the two homes.
    const depth = ((p.x - (me.x + other.x) / 2) * dx + (p.y - (me.y + other.y) / 2) * dy) / gap;
    if (depth < best.depth) best = { depth, inward: { x: dx / gap, y: dy / gap } };
  }
  return best;
}

// Is every point on the owner's side (allowing `margin` past the border)?
export function onOwnSide(state, owner, points, margin = state.cfg.sideMargin) {
  return points.every((p) => depthIn(state, owner, p).depth >= -margin);
}

// The direction from a player's home toward the middle of the board: the way
// they face. (With 2 players, that's straight at the opponent.)
export function facingOf(state, owner) {
  const home = state.homes[owner];
  const dx = state.cfg.world.width / 2 - home.x;
  const dy = state.cfg.world.height / 2 - home.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

// Players still in the duel.
export function alivePlayers(state) {
  return state.players.filter((id) => !state.out.includes(id));
}
