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

// A spiky urchin: a small body with spikes all round and a jagged mouth. (Attacker.)
export function urchin(cx, cy, s = 1) {
  const strokes = [ring(cx, cy, 14 * s, 14 * s, 20)];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    strokes.push(seg(cx + Math.cos(a) * 14 * s, cy + Math.sin(a) * 14 * s, cx + Math.cos(a) * 38 * s, cy + Math.sin(a) * 38 * s, 6));
  }
  const teeth = [];
  for (let k = 0; k <= 6; k++) teeth.push({ x: cx - 9 * s + k * 3 * s, y: cy + (k % 2 ? 5 : -1) * s });
  strokes.push(teeth);
  return strokes;
}

// A bulky turtle: a big round shell, a pattern inside, a head and stubby feet. (Defender.)
export function turtle(cx, cy, s = 1) {
  return [
    ring(cx, cy, 40 * s, 30 * s, 40), // shell
    ring(cx, cy, 26 * s, 18 * s, 32), // shell pattern
    ring(cx, cy, 11 * s, 8 * s, 20),
    ring(cx + 50 * s, cy, 11 * s, 10 * s, 20), // head
    ring(cx - 26 * s, cy + 32 * s, 8 * s, 6 * s, 14), // feet
    ring(cx + 26 * s, cy + 32 * s, 8 * s, 6 * s, 14),
  ];
}

// A leggy centipede: a long thin body and lots of short legs. (Runner.)
export function centipede(cx, cy, s = 1) {
  const strokes = [seg(cx - 60 * s, cy, cx + 60 * s, cy, 30)];
  for (let k = 0; k < 8; k++) {
    const x = cx - 52 * s + k * 15 * s;
    strokes.push(seg(x, cy, x - 4 * s, cy - 14 * s, 4));
    strokes.push(seg(x, cy, x - 4 * s, cy + 14 * s, 4));
  }
  return strokes;
}

// Shrink and move a creature so it fits inside a circle (a holding circle).
export function fitInside(strokes, center, radius) {
  const all = strokes.flat();
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));
  const mid = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const half = Math.hypot(maxX - minX, maxY - minY) / 2 || 1;
  const k = Math.min(1, (radius * 0.85) / half);
  return strokes.map((stroke) => stroke.map((p) => ({ x: center.x + (p.x - mid.x) * k, y: center.y + (p.y - mid.y) * k })));
}
