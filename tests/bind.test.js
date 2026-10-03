import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDuel, addStroke, step, mainWard } from '../src/engine/duel.js';
import { bindAngles } from '../src/engine/bind.js';
import { DEFENSES, findDefense, layoutDefense, tracedParts } from '../src/data/defenses.js';
import { CONFIG } from '../src/config.js';
import * as S from './fixtures/strokes.js';

// These tests aren't about the chalk limit, so give both sides endless chalk.
CONFIG.chalk.supply = Infinity;

const E = CONFIG.engine;
const HOME = { center: { x: 350, y: 450 }, radius: 120 };

function duel(bindPoints = 4) {
  const state = createDuel({ bindPoints: { left: bindPoints, right: 4 } });
  addStroke(state, 'left', S.circle({ cx: HOME.center.x, cy: HOME.center.y, r: HOME.radius, noise: 1.5 }));
  addStroke(state, 'right', S.circle({ cx: 1250, cy: 450, r: 100, noise: 1.5 }));
  return state;
}

// Draw a template part as a slightly shaky stroke.
function drawPart(state, part, seed = 1) {
  const points =
    part.type === 'circle'
      ? S.circle({ cx: part.center.x, cy: part.center.y, r: part.radius, noise: 1, seed })
      : S.line({ x1: part.from.x, y1: part.from.y, x2: part.to.x, y2: part.to.y, noise: 1, seed });
  return addStroke(state, 'left', points);
}

function rotateParts(parts, angle, c) {
  const rot = (p) => ({
    x: c.x + (p.x - c.x) * Math.cos(angle) - (p.y - c.y) * Math.sin(angle),
    y: c.y + (p.x - c.x) * Math.sin(angle) + (p.y - c.y) * Math.cos(angle),
  });
  return parts.map((p) => (p.type === 'circle' ? { ...p, center: rot(p.center) } : { ...p, from: rot(p.from), to: rot(p.to) }));
}

test('bind points are evenly spaced and the first faces the opponent', () => {
  const facingRight = { x: 1, y: 0 }; // the left duelist faces right
  const facingLeft = { x: -1, y: 0 };
  assert.deepEqual(bindAngles(4, facingRight), [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]);
  assert.equal(bindAngles(2, facingLeft)[0], Math.PI);
  for (const n of E.bindPointChoices) assert.equal(bindAngles(n, facingRight).length, n);
});

test('the main circle gets the chosen number of bind points', () => {
  for (const n of [2, 4, 6]) assert.equal(mainWard(duel(n), 'left').bindAngles.length, n);
});

test('a wall touching a bind point is bound and gets +50%', () => {
  const state = duel();
  // From the top bind point (angle 3π/2 = straight up) outward.
  addStroke(state, 'left', S.line({ x1: 350, y1: 330, x2: 350, y2: 200 }));
  const wall = state.walls[0];
  assert.equal(wall.bound, true);
  assert.ok(Math.abs(wall.max - E.wallHealth * wall.quality * (1 + E.boundBonus)) < 1e-9);
  assert.ok(state.events.some((e) => e.type === 'attach' && e.bound));
});

test('touching away from a bind point weakens that section by 25%', () => {
  const state = duel();
  const main = mainWard(state, 'left');
  const before = main.sections.map((s) => s.max);
  // Touch at 45°, halfway between two bind points.
  const a = Math.PI / 4;
  const x1 = 350 + Math.cos(a) * 120;
  const y1 = 450 + Math.sin(a) * 120;
  addStroke(state, 'left', S.line({ x1, y1, x2: x1 + 100, y2: y1 + 100 }));
  const wall = state.walls[0];
  assert.notEqual(wall.bound, true);
  const changed = main.sections.map((s, k) => s.max / before[k]).filter((r) => r < 1);
  assert.equal(changed.length, 1);
  assert.ok(Math.abs(changed[0] - (1 - E.offPointPenalty)) < 1e-9);
});

test('a small circle at a bind point is bound and gets +50% per section', () => {
  const bound = duel();
  addStroke(bound, 'left', S.circle({ cx: 350 + 120 + 40, cy: 450, r: 40, noise: 1 }));
  const loose = createDuel();
  addStroke(loose, 'left', S.circle({ cx: 350, cy: 450, r: 120, noise: 1.5 }));
  addStroke(loose, 'left', S.circle({ cx: 350, cy: 200, r: 40, noise: 1 })); // not touching
  const b = bound.wards.find((w) => !w.main);
  const l = loose.wards.find((w) => !w.main);
  assert.equal(b.bound, true);
  assert.notEqual(l.bound, true);
  assert.ok(b.sections[0].max > l.sections[0].max * 1.3);
});

test('a defense on bind points outlasts the same shapes placed off them', () => {
  const placeholder = findDefense('placeholder');
  const parts = layoutDefense(placeholder, HOME, 'left');

  const wavesToBreach = (shapes) => {
    const state = duel(4);
    shapes.forEach((p, i) => drawPart(state, p, i + 1));
    // The right side attacks straight at the shield in front of the circle.
    const shield = shapes.find((p) => p.type === 'circle');
    let shots = 0;
    while (!state.winner && shots < 60) {
      addStroke(state, 'right', S.wave({ x: 1050, y: shield.center.y, length: 200, amplitude: 18, angle: Math.PI, seed: ++shots }));
      for (let i = 0; i < 140; i++) step(state);
    }
    return { shots, bound: state.events.filter((e) => e.type === 'attach' && e.bound).length };
  };

  const on = wavesToBreach(parts);
  const off = wavesToBreach(rotateParts(parts, 0.45, HOME.center));
  assert.equal(on.bound, 3, 'all three parts should be bound');
  assert.equal(off.bound, 0, 'the rotated parts should miss every bind point');
  assert.ok(on.shots > off.shots, `on bind points: ${on.shots} waves, off: ${off.shots} waves`);
});

test('defenses: only the placeholder has a layout until the book layouts arrive', () => {
  for (const d of DEFENSES) {
    if (d.placeholder) assert.ok(d.parts.length > 0);
    else assert.equal(d.parts, null, `${d.name} must not have an invented layout`);
  }
});

test('traced template parts are recognized', () => {
  const state = duel();
  const parts = layoutDefense(findDefense('placeholder'), HOME, 'left');
  assert.deepEqual(tracedParts(parts, state.wards, state.walls, HOME.radius), [false, false, false]);
  drawPart(state, parts[1]);
  drawPart(state, parts[0]);
  assert.deepEqual(tracedParts(parts, state.wards, state.walls, HOME.radius), [true, true, false]);
});

test('the right side gets a mirrored layout', () => {
  const parts = layoutDefense(findDefense('placeholder'), { center: { x: 1200, y: 450 }, radius: 100 }, 'right');
  assert.ok(parts[0].center.x < 1200, 'front shield faces left, toward the enemy');
});
