// Named defenses, stored as data.
//
// Coordinates are measured in main-circle radii. The main circle's center is
// (0, 0), +x points toward the opponent, and +y points down the board.
// So [1.4, 0] is just in front of the circle, toward the enemy.
//
// IMPORTANT: the real layouts (Matson, Ballintain, Easton, ...) must come from
// the diagrams in the book. Until Zane provides them, those entries have
// `parts: null` and only the clearly-labeled placeholder can be practiced.

export const DEFENSES = [
  {
    id: 'placeholder',
    name: 'Placeholder defense',
    placeholder: true,
    note: 'Made up for testing. NOT from the book.',
    bindPoints: 4,
    parts: [
      // A small circle bound to the front bind point, facing the enemy.
      { type: 'circle', center: [1.35, 0], r: 0.35 },
      // Walls from the top and bottom bind points, angled forward.
      { type: 'line', from: [0, -1], to: [0.75, -1.65] },
      { type: 'line', from: [0, 1], to: [0.75, 1.65] },
    ],
  },
  { id: 'matson', name: 'Matson Defense', parts: null, note: 'Needs the layout from the book.' },
  { id: 'ballintain', name: 'Ballintain Defense', parts: null, note: 'Needs the layout from the book.' },
  { id: 'easton', name: 'Easton Defense', parts: null, note: 'Needs the layout from the book.' },
];

export function findDefense(id) {
  return DEFENSES.find((d) => d.id === id) ?? null;
}

// Turn a defense into board positions around an actual main circle.
// anchor: { center, radius }. side: 'left' or 'right' (right mirrors it).
export function layoutDefense(defense, anchor, side) {
  const flip = side === 'left' ? 1 : -1;
  const at = ([x, y]) => ({
    x: anchor.center.x + flip * x * anchor.radius,
    y: anchor.center.y + y * anchor.radius,
  });
  return (defense.parts ?? []).map((part) =>
    part.type === 'circle'
      ? { type: 'circle', center: at(part.center), radius: part.r * anchor.radius }
      : { type: 'line', from: at(part.from), to: at(part.to) },
  );
}

// Which template parts has the player traced? A part counts as done when one
// of the player's lines or circles sits close enough to it.
export function tracedParts(parts, wards, walls, anchorRadius) {
  const tol = Math.max(22, anchorRadius * 0.25);
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
  return parts.map((part) => {
    if (part.type === 'circle') {
      return wards.some((w) => !w.main && near(w.center, part.center) && Math.abs(w.radius - part.radius) <= tol);
    }
    return walls.some(
      (w) => (near(w.from, part.from) && near(w.to, part.to)) || (near(w.from, part.to) && near(w.to, part.from)),
    );
  });
}
