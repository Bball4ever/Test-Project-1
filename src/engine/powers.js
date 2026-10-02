// Chalkling powers: simple gear drawn on a chalkling's body gives it a power.
//
// The "body" is the biggest closed shape in the drawing (a blob). Gear is
// drawn on it or sticking out of it:
//
//   sword      a long straight stick sticking out of the body   → bites harder
//   bow        a curved line with a straight line across it     → shoots arrows
//   shield     a small closed shape with a + inside it            → takes half damage
//   wings      a curved line on each side of the body           → flies over walls
//   crown      a zigzag on top of the body                      → nearby friends bite harder
//   healer     a + on the body (not inside a shield)            → heals itself and friends
//   whirlwind  a spiral                                         → much faster
//
// Only shapes that are easy to draw and easy to tell apart, so the game can
// recognise them reliably.

import { pathLength, distance, resample } from '../recognizer/clean.js';
import { totalTurning } from '../recognizer/fit.js';
import { polygonArea, countCorners, insidePolygon, crossing } from './shapes.js';

export const POWER_NAMES = {
  sword: 'Sword',
  bow: 'Bow',
  shield: 'Shield',
  wings: 'Wings',
  crown: 'Crown',
  healer: 'Healer',
  whirlwind: 'Whirlwind',
};

function describe(stroke, cc) {
  const pts = resample(stroke, 4);
  const len = pathLength(pts);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const turning = totalTurning(pts);
  // Ends that meet make a closed shape, unless it winds round and round (a spiral).
  const closed = pts.length > 3 && len >= cc.minClosedInk && distance(first, last) / len < cc.closedGapRatio && Math.abs(turning) < 2.6 * Math.PI;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const center = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
  return {
    pts,
    len,
    closed,
    area: closed ? polygonArea(pts) : 0,
    center,
    first,
    last,
    straightness: len ? distance(first, last) / len : 0,
    turning,
    corners: countCorners(stroke, cc.cornerAngle),
    box: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) },
  };
}

// Which powers does this drawing have? Returns a list like ['sword', 'shield'].
export function detectPowers(strokes, cc, pc) {
  const parts = strokes.filter((s) => s.length >= 2).map((s) => describe(s, cc));
  const closedParts = parts.filter((p) => p.closed);
  const body = closedParts.reduce((best, p) => (!best || p.area > best.area ? p : best), null);
  if (!body) return [];
  const bodyR = Math.sqrt(body.area / Math.PI);
  if (bodyR < pc.minBodyRadius) return [];

  const outsideShare = (part) => part.pts.filter((p) => distance(p, body.center) > bodyR * 0.9).length / part.pts.length;
  const open = parts.filter((p) => !p.closed);
  const straight = open.filter((p) => p.straightness >= pc.straightness);
  const used = new Set();
  const powers = new Set();

  // Crosses: two short straight lines crossing near their middles.
  for (let i = 0; i < straight.length; i++) {
    for (let j = i + 1; j < straight.length; j++) {
      const a = straight[i];
      const b = straight[j];
      const x = crossing(a.first, a.last, b.first, b.last);
      if (!x || x.t < 0.2 || x.t > 0.8 || x.u < 0.2 || x.u > 0.8) continue;
      // Inside a small closed shape (not the body): a shield. Otherwise: a healing cross.
      const holder = closedParts.find((c) => c !== body && insidePolygon(x.point, c.pts));
      powers.add(holder ? 'shield' : 'healer');
      used.add(a);
      used.add(b);
    }
  }

  // Curved lines: a bow if a straight line runs across it, otherwise maybe a wing.
  const arcs = open.filter((p) => {
    const turn = Math.abs(p.turning);
    return !used.has(p) && p.straightness < pc.straightness && turn >= pc.arcTurn[0] && turn <= pc.arcTurn[1] && p.corners <= 1;
  });
  const wingArcs = [];
  for (const arc of arcs) {
    const chord = distance(arc.first, arc.last);
    const pad = 10;
    const string = straight.find(
      (s) =>
        !used.has(s) &&
        s.len >= chord * 0.5 &&
        s.center.x >= arc.box.minX - pad &&
        s.center.x <= arc.box.maxX + pad &&
        s.center.y >= arc.box.minY - pad &&
        s.center.y <= arc.box.maxY + pad,
    );
    if (string) {
      powers.add('bow');
      used.add(arc);
      used.add(string);
    } else if (outsideShare(arc) >= 0.5) {
      wingArcs.push(arc);
    }
  }
  if (wingArcs.some((a) => a.center.x < body.center.x) && wingArcs.some((a) => a.center.x > body.center.x)) powers.add('wings');

  // Sword: a long straight stick, mostly outside the body, starting at it.
  for (const s of straight) {
    if (used.has(s) || s.len < pc.swordLength * bodyR || outsideShare(s) < 0.5) continue;
    const near = Math.min(distance(s.first, body.center), distance(s.last, body.center));
    if (near <= bodyR * 1.6) {
      powers.add('sword');
      used.add(s);
    }
  }

  for (const p of open) {
    if (used.has(p)) continue;
    // Crown: a zigzag sitting on top of the body.
    if (p.corners >= pc.crownCorners && p.center.y < body.center.y - bodyR * 0.5) powers.add('crown');
    // Whirlwind: a spiral.
    if (Math.abs(p.turning) >= pc.spiralTurn) powers.add('whirlwind');
  }
  return [...powers];
}
