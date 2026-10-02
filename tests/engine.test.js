import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDuel, addStroke, step, mainWard } from '../src/engine/duel.js';
import { hitSegment, hitCircle, reflect, sectionAt } from '../src/engine/collide.js';
import { dummyCirclePoints } from '../src/controllers/dummy.js';
import { CONFIG } from '../src/config.js';
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
  assert.ok(Math.abs(hit.damage - E.vigorDamage * result.quality) < 1e-9);
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
  assert.ok(Math.abs(wall.max - wall.health - E.vigorDamage * result.quality * E.wallDamageFromVigor) < 1e-9);
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
