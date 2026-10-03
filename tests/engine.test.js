import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDuel, addStroke, step, mainWard, styleBonus } from '../src/engine/duel.js';
import { hitSegment, hitCircle, reflect, sectionAt } from '../src/engine/collide.js';
import { dummyCirclePoints } from '../src/controllers/dummy.js';
import { CONFIG } from '../src/config.js';
import { recognize } from '../src/recognizer/index.js';
import * as S from './fixtures/strokes.js';

// These tests aren't about the chalk limit, so give both sides endless chalk.
CONFIG.chalk.supply = Infinity;

const E = CONFIG.engine;

// A duel where both sides already have their main circles.
function duelWithCircles({ leftNoise = 2, right = 'neat' } = {}) {
  const state = createDuel();
  addStroke(state, 'left', S.circle({ cx: 350, cy: 450, r: 120, noise: leftNoise }));
  addStroke(state, 'right', dummyCirclePoints(right));
  return state;
}

// A wave drawn on the left half, travelling right along y.
const waveRight = (y = 450, seed = 1) => S.wave({ x: 520, y, length: 220, amplitude: 20, cycles: 3, noise: 1, seed });

function run(state, steps) {
  for (let i = 0; i < steps; i++) step(state);
}

function events(state, type) {
  return state.events.filter((e) => e.type === type);
}

// --- Geometry -----------------------------------------------------------------

test('paths crossing a segment are detected, misses are not', () => {
  const hit = hitSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 });
  assert.ok(Math.abs(hit.t - 0.5) < 1e-9);
  assert.equal(hitSegment({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 }), null);
  assert.equal(hitSegment({ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 5, y: -5 }, { x: 5, y: 5 }), null);
});

test('paths hit circles from outside and from inside', () => {
  const c = { x: 0, y: 0 };
  assert.ok(Math.abs(hitCircle({ x: -20, y: 0 }, { x: 0, y: 0 }, c, 10).point.x + 10) < 1e-9);
  assert.ok(Math.abs(hitCircle({ x: 0, y: 0 }, { x: 20, y: 0 }, c, 10).point.x - 10) < 1e-9);
  assert.equal(hitCircle({ x: -20, y: 15 }, { x: 20, y: 15 }, c, 10), null);
});

test('reflection works like a mirror', () => {
  // Vertical wall: x velocity flips.
  assert.deepEqual(reflect({ x: 3, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 10 }), { x: -3, y: 1 });
  // 45° wall: moving right turns into moving down (or up).
  const v = reflect({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 });
  assert.ok(Math.abs(v.x) < 1e-9 && Math.abs(Math.abs(v.y) - 1) < 1e-9);
});

test('section numbers go round the circle', () => {
  const c = { x: 0, y: 0 };
  assert.equal(sectionAt(c, { x: 10, y: 0.01 }, 24), 0);
  assert.equal(sectionAt(c, { x: 0, y: 10 }, 24), 6);
  assert.equal(sectionAt(c, { x: -10, y: 0.01 }, 24), 11);
  assert.equal(sectionAt(c, { x: 0, y: -10 }, 24), 18);
});

// --- Placing lines -------------------------------------------------------------

test('the first circle becomes the main circle with 24 sections', () => {
  const state = createDuel();
  const { accepted, result } = addStroke(state, 'left', S.circle({ cx: 350, cy: 450, r: 120, noise: 2 }));
  assert.ok(accepted);
  const ward = mainWard(state, 'left');
  assert.equal(ward.sections.length, E.sections);
  for (const s of ward.sections) {
    assert.ok(s.max <= E.sectionHealth * result.quality + 1e-9);
    assert.ok(s.max > E.sectionHealth * result.quality * 0.7, `section max ${s.max}`);
  }
});

test('lines and waves need a main circle first', () => {
  const state = createDuel();
  const { accepted, result } = addStroke(state, 'left', waveRight());
  assert.equal(accepted, false);
  assert.equal(result.reason, 'draw your circle first');
});

test('strokes must stay on your own side', () => {
  const state = createDuel();
  const r1 = addStroke(state, 'left', S.circle({ cx: 780, cy: 450, r: 100 }));
  assert.equal(r1.result.reason, 'stay on your side');
  const r2 = addStroke(state, 'right', S.circle({ cx: 350, cy: 450, r: 100 }));
  assert.equal(r2.result.reason, 'stay on your side');
  assert.equal(state.wards.length, 0);
});

test('a sloppy circle has weak spots where it wobbles', () => {
  const state = createDuel();
  addStroke(state, 'left', S.circle({ cx: 350, cy: 450, r: 120, noise: 2 }));
  addStroke(state, 'right', dummyCirclePoints('sloppy'));
  const neat = mainWard(state, 'left').sections.map((s) => s.max);
  const sloppy = mainWard(state, 'right').sections.map((s) => s.max);
  assert.ok(Math.min(...sloppy) < Math.min(...neat) / 2);
  assert.ok(Math.max(...sloppy) - Math.min(...sloppy) > 20, 'sloppy sections should vary');
});

// --- Vigor, damage, bouncing, breach ---------------------------------------------

test('a Vigor flies to the enemy circle and damages the section it hits', () => {
  const state = duelWithCircles();
  const { result } = addStroke(state, 'left', waveRight());
  run(state, 120);
  const [hit] = events(state, 'hit');
  assert.ok(hit, 'expected a hit');
  assert.equal(hit.owner, 'right');
  const ward = mainWard(state, 'right');
  assert.equal(hit.section, sectionAt(ward.center, hit.point, E.sections));
  assert.ok(Math.abs(hit.damage - E.vigorDamage * result.quality * styleBonus(E, result.shape, 'circles')) < 1e-9);
  const s = ward.sections[hit.section];
  assert.ok(Math.abs(s.max - s.health - hit.damage) < 1e-9);
  // Only that one section took damage.
  assert.equal(ward.sections.filter((x) => x.health < x.max).length, 1);
  assert.equal(state.vigors.length, 0, 'the Vigor is spent');
});

test('a Vigor passes out of its own circle without hurting it', () => {
  const state = duelWithCircles();
  // Drawn inside the left circle, heading right, out through its own wall.
  addStroke(state, 'left', S.wave({ x: 280, y: 450, length: 120, amplitude: 12, cycles: 3, noise: 0.5 }));
  run(state, 150);
  const own = mainWard(state, 'left');
  assert.ok(own.sections.every((s) => s.health === s.max));
  assert.equal(events(state, 'hit')[0]?.owner, 'right');
});

test("a wall stops a Vigor (no bouncing) and takes the damage", () => {
  const state = duelWithCircles();
  addStroke(state, 'left', S.line({ x1: 780, y1: 300, x2: 780, y2: 600 }));
  const wall = state.walls[0];
  const { result } = addStroke(state, 'left', waveRight());
  run(state, 120);
  const [blocked] = events(state, 'blocked');
  assert.ok(blocked, 'the wall stopped it');
  assert.equal(events(state, 'hit').length, 0, 'nothing behind the wall was hit');
  assert.equal(state.vigors.length, 0, 'the Vigor is gone, not bounced');
  assert.ok(Math.abs(wall.max - wall.health - E.vigorDamage * result.quality * E.wallDamageFromVigor * styleBonus(E, result.shape, 'walls')) < 1e-9);
});

test('waves can break a wall, and then get through', () => {
  const state = duelWithCircles();
  addStroke(state, 'right', S.line({ x1: 900, y1: 300, x2: 900, y2: 600 }));
  let shots = 0;
  while (state.walls.length && shots < 20) {
    addStroke(state, 'left', waveRight(450, ++shots));
    run(state, 60);
  }
  assert.equal(state.walls.length, 0, `wall still standing after ${shots} waves`);
  assert.ok(events(state, 'wallBroken').length === 1);
  addStroke(state, 'left', waveRight(450, 99));
  run(state, 120);
  assert.equal(events(state, 'hit').at(-1).owner, 'right', 'the next wave reaches the circle');
});

test('curved waves hit circles and walls harder; spiky waves hit chalklings harder', () => {
  const hitWith = (zigzag, target) => {
    const state = duelWithCircles();
    if (target === 'wall') addStroke(state, 'right', S.line({ x1: 900, y1: 300, x2: 900, y2: 600 }));
    if (target === 'chalkling') {
      state.chalklings.push({ id: 999, kind: 'chalkling', owner: 'right', pos: { x: 900, y: 450 }, radius: 30, hp: 500, max: 500, mode: 'waiting', strokes: [] });
    }
    const { result } = addStroke(state, 'left', S.wave({ x: 450, y: 450, length: 240, amplitude: 25, cycles: 3, zigzag }));
    if (zigzag) assert.ok(result.shape.spikiness > 0.4, `zigzag spikiness ${result.shape.spikiness}`);
    else assert.ok(result.shape.spikiness < 0.15, `smooth wave spikiness ${result.shape.spikiness}`);
    run(state, 120);
    const e = events(state, target === 'wall' ? 'blocked' : 'hit')[0];
    assert.ok(e, `hit the ${target}`);
    return e.damage / result.quality; // so a neater wave doesn't count
  };
  assert.ok(hitWith(false, 'circle') > hitWith(true, 'circle') * 1.3);
  assert.ok(hitWith(false, 'wall') > hitWith(true, 'wall') * 1.3);
  assert.ok(hitWith(true, 'chalkling') > hitWith(false, 'chalkling') * 1.3);
});

test('spikiness is a sliding scale: the spikier the wave, the more it does to chalklings and the less to lines', () => {
  const at = (s) => ({ spikiness: s });
  for (const target of ['walls', 'circles']) {
    assert.equal(styleBonus(E, at(0), target), E.vigorStyles.curved[target]);
    assert.equal(styleBonus(E, at(1), target), E.vigorStyles.spiky[target]);
    assert.ok(styleBonus(E, at(0.3), target) > styleBonus(E, at(0.7), target));
  }
  assert.ok(styleBonus(E, at(0.7), 'chalklings') > styleBonus(E, at(0.3), 'chalklings'));
  // Real strokes: a sharper spike shape scores spikier than an even zigzag, which is spikier than a curve.
  const spikiness = (shape) => {
    const pts = S.wave({ x: 300, y: 300, length: 240, amplitude: 25, cycles: 3, zigzag: shape !== 'curve' });
    if (shape === 'needles') for (const p of pts) p.y = 300 + Math.sign(p.y - 300) * 25 * (Math.abs(p.y - 300) / 25) ** 1.8;
    return recognize(pts).shape.spikiness;
  };
  assert.ok(spikiness('curve') < spikiness('zigzag') && spikiness('zigzag') < spikiness('needles'));
});

test('only 8 walls at a time', () => {
  const state = duelWithCircles();
  for (let i = 0; i < E.maxWalls; i++) {
    assert.ok(addStroke(state, 'left', S.line({ x1: 520 + i * 25, y1: 200, x2: 520 + i * 25, y2: 330 })).accepted, `wall ${i + 1}`);
  }
  const ninth = addStroke(state, 'left', S.line({ x1: 520, y1: 600, x2: 520, y2: 730 }));
  assert.equal(ninth.accepted, false);
  assert.match(ninth.result.reason, /only 8 walls/);
  // Once one is gone, there's room again.
  state.walls[0].gone = true;
  assert.ok(addStroke(state, 'left', S.line({ x1: 520, y1: 600, x2: 520, y2: 730 })).accepted);
});

test('a Vigor that leaves the board is removed', () => {
  const state = duelWithCircles();
  addStroke(state, 'left', S.wave({ x: 300, y: 820, length: 200, amplitude: 15, cycles: 3, angle: Math.PI / 2 }));
  run(state, 100);
  assert.equal(state.vigors.length, 0);
  assert.equal(events(state, 'offboard').length, 1);
});

test('breaking a main circle section is a breach: the other side wins', () => {
  const state = duelWithCircles();
  let shots = 0;
  while (!state.winner && shots < 20) {
    addStroke(state, 'left', waveRight(450, ++shots));
    run(state, 120);
  }
  assert.equal(state.winner, 'left');
  assert.equal(events(state, 'breach')[0].owner, 'right');
  // No more strokes are accepted after the duel ends.
  assert.equal(addStroke(state, 'right', S.circle({ cx: 1200, cy: 200, r: 60 })).accepted, false);
});

test('a sloppy circle is breached in fewer hits than a neat one', () => {
  const shotsToBreach = (style, seed) => {
    const state = createDuel();
    addStroke(state, 'left', S.circle({ cx: 350, cy: 450, r: 120, noise: 2 }));
    addStroke(state, 'right', dummyCirclePoints(style, seed));
    let shots = 0;
    while (!state.winner && shots < 40) {
      // Spread shots across the front of the circle, like a real player.
      const y = 450 + (((shots * 37) % 120) - 60);
      addStroke(state, 'left', waveRight(y, ++shots));
      run(state, 120);
    }
    return shots;
  };
  for (const seed of [11, 12, 13]) {
    const neat = shotsToBreach('neat', seed);
    const sloppy = shotsToBreach('sloppy', seed);
    assert.ok(sloppy < neat, `seed ${seed}: sloppy ${sloppy} vs neat ${neat}`);
  }
});

test('the same strokes always give the same duel', () => {
  const play = () => {
    const state = duelWithCircles({ right: 'sloppy' });
    addStroke(state, 'left', S.line({ x1: 760, y1: 200, x2: 700, y2: 700, noise: 2 }));
    for (let i = 0; i < 6; i++) {
      addStroke(state, 'left', S.wave({ x: 450, y: 250 + i * 80, length: 200, amplitude: 18, angle: (i - 3) * 0.2, seed: i + 1 }));
      run(state, 45);
    }
    run(state, 200);
    const { cfg, ...rest } = state;
    return JSON.stringify(rest);
  };
  assert.equal(play(), play());
});

// --- The 5-second countdown and the smallest main circle --------------------------------

test('no main circle when the countdown ends: you are out and the other player wins', () => {
  const state = createDuel();
  addStroke(state, 'left', S.circle({ cx: 350, cy: 450, r: 110, noise: 1 }));
  run(state, (E.circleDeadlineMs - 100) / E.stepMs);
  assert.equal(state.winner, null, 'still time');
  run(state, 200 / E.stepMs);
  assert.equal(state.winner, 'left');
  assert.equal(state.outReasons.right, 'noCircle');
  assert.equal(addStroke(state, 'right', S.circle({ cx: 1250, cy: 450, r: 110 })).accepted, false, 'too late');
});

test('if nobody draws a main circle in time, it is a draw', () => {
  const state = createDuel();
  run(state, (E.circleDeadlineMs + 100) / E.stepMs);
  assert.equal(state.winner, 'draw');
  assert.equal(state.drawReason, 'noCircle');
});

test('in a free-for-all, everyone without a circle in time is out; the rest play on', () => {
  const state = createDuel({ players: 4 });
  for (const id of ['left', 'p2']) {
    const h = state.homes[id];
    addStroke(state, id, S.circle({ cx: h.x, cy: h.y, r: 110, noise: 1 }));
  }
  run(state, (E.circleDeadlineMs + 100) / E.stepMs);
  assert.deepEqual([...state.out].sort(), ['p3', 'right']);
  assert.equal(state.winner, null);
});

test('a main circle has to be big enough; small circles are fine later (shields)', () => {
  const state = createDuel();
  const small = addStroke(state, 'left', S.circle({ cx: 350, cy: 450, r: E.minMainRadius - 25, noise: 1 }));
  assert.equal(small.accepted, false);
  assert.match(small.result.reason, /too small/);
  assert.ok(addStroke(state, 'left', S.circle({ cx: 350, cy: 450, r: E.minMainRadius + 15, noise: 1 })).accepted);
  assert.ok(addStroke(state, 'left', S.circle({ cx: 350, cy: 300, r: 45, noise: 1 })).accepted, 'a small shield circle is fine');
});
