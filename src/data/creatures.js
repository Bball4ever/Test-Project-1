// Ready-made creature drawings, as lists of strokes (each stroke a list of points).
// Used by tests and by the bot, which "draws" these with a shaky hand.
// Sizes are in board units; (cx, cy) is the middle of the creature.

function ring(cx, cy, rx, ry, steps = 28) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
}

function seg(x1, y1, x2, y2, steps = 8) {
  return Array.from({ length: steps + 1 }, (_, i) => ({
    x: x1 + ((x2 - x1) * i) / steps,
    y: y1 + ((y2 - y1) * i) / steps,
  }));
}

// A quick stick figure: 5 strokes, one closed shape (the head).
export function stickFigure(cx, cy, s = 1) {
  return [
    ring(cx, cy - 28 * s, 9 * s, 9 * s, 18),
    seg(cx, cy - 19 * s, cx, cy + 10 * s),
    seg(cx - 15 * s, cy - 8 * s, cx + 15 * s, cy - 8 * s),
    seg(cx, cy + 10 * s, cx - 11 * s, cy + 32 * s),
    seg(cx, cy + 10 * s, cx + 11 * s, cy + 32 * s),
  ];
}

// A detailed beetle: body, head, eyes, stripes, six legs and antennae.
export function beetle(cx, cy, s = 1) {
  const strokes = [
    ring(cx, cy, 34 * s, 24 * s, 36), // body
    ring(cx + 42 * s, cy, 13 * s, 12 * s, 20), // head
    ring(cx + 46 * s, cy - 5 * s, 3 * s, 3 * s, 10), // eye
    ring(cx + 46 * s, cy + 5 * s, 3 * s, 3 * s, 10), // eye
    seg(cx - 12 * s, cy - 22 * s, cx - 12 * s, cy + 22 * s), // stripes
    seg(cx + 4 * s, cy - 24 * s, cx + 4 * s, cy + 24 * s),
    seg(cx + 20 * s, cy - 18 * s, cx + 20 * s, cy + 18 * s),
  ];
  for (const dx of [-18, 0, 18]) {
    strokes.push(seg(cx + dx * s, cy - 22 * s, cx + (dx - 8) * s, cy - 40 * s)); // legs
    strokes.push(seg(cx + dx * s, cy + 22 * s, cx + (dx - 8) * s, cy + 40 * s));
  }
  strokes.push(seg(cx + 52 * s, cy - 8 * s, cx + 66 * s, cy - 22 * s)); // antennae
  strokes.push(seg(cx + 52 * s, cy + 8 * s, cx + 66 * s, cy + 22 * s));
  return strokes;
}

// Mirror a creature left↔right around its own middle (so it faces the other way).
export function mirror(strokes, cx) {
  return strokes.map((stroke) => stroke.map((p) => ({ x: 2 * cx - p.x, y: p.y })));
}
