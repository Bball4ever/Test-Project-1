import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDuel, addStroke, mainWard } from '../src/engine/duel.js';
import { findRoute, lineClear, obstaclesFor } from '../src/engine/route.js';
import { stickFigure, urchin } from '../src/data/creatures.js';
import * as S from './fixtures/strokes.js';
import { run, makeChalklingBookWay } from './fixtures/making.js';
import { CONFIG } from '../src/config.js';

// These tests aren't about the chalk limit, so give both sides endless chalk.
CONFIG.chalk.supply = Infinity;

function duel() {
  const state = createDuel();
  addStroke(state, 'left', S.circle({ cx: 300, cy: 450, r: 110, noise: 1 }));
  addStroke(state, 'right', S.circle({ cx: 1300, cy: 450, r: 110, noise: 1 }));
  return state;
}

const wall = (state, side, x1, y1, x2, y2) => addStroke(state, side, S.line({ x1, y1, x2, y2, noise: 0.5 }));
const damaged = (ward) => ward.sections.some((s) => s.health < s.max);

test('the route-finder goes around a wall, and every leg is clear', () => {
  const state = duel();
  wall(state, 'left', 600, 250, 600, 650);
  const c = { radius: 15, owner: 'left' };
  const obstacles = obstaclesFor(state, c);
  const from = { x: 500, y: 450 };
  const goal = { x: 750, y: 450 };
  assert.equal(lineClear(from, goal, obstacles), false);
  const route = findRoute(state, from, goal, obstacles);
  assert.ok(route, 'found a way round');
  let here = from;
  for (const p of route) {
    assert.ok(lineClear(here, p, obstacles), 'each leg avoids the lines');
    here = p;
  }
  assert.deepEqual(route.at(-1), goal);
  assert.ok(route.some((p) => p.y < 250 || p.y > 650), 'it went past an end of the wall');
});

test('a chalkling gets out of a dead-end pocket made of its own walls', () => {
  const state = duel();
  const c = makeChalklingBookWay(state, 'left', stickFigure(0, 0), { k: 1 }); // released below its circle
  // A pocket around it that only opens backwards, away from the enemy.
  const { x, y } = c.pos;
  wall(state, 'left', x + 70, y - 90, x + 70, y + 90); // front
  wall(state, 'left', x - 60, y - 90, x + 70, y - 90); // top
  wall(state, 'left', x - 60, y + 90, x + 70, y + 90); // bottom
  const walls = state.walls.map((w) => w.health);
  const enemy = mainWard(state, 'right');
  run(state, 60);
  assert.ok(damaged(enemy) || state.winner === 'left', 'it reached the enemy circle');
  assert.deepEqual(state.walls.map((w) => w.health), walls, 'without chewing its own walls');
});

test('an attacking chalkling walks around an enemy wall instead of chewing it', () => {
  const state = duel();
  wall(state, 'right', 900, 300, 900, 640);
  const enemyWall = state.walls[0];
  makeChalklingBookWay(state, 'left', urchin(0, 0), { k: 1 });
  run(state, 45);
  assert.ok(damaged(mainWard(state, 'right')), 'it reached the enemy circle');
  assert.equal(enemyWall.health, enemyWall.max, 'the wall was left alone');
});

test('a chalkling behind its own circle walks around it', () => {
  const state = duel();
  makeChalklingBookWay(state, 'left', stickFigure(0, 0), { k: 2 }); // the back bind point, facing away
  run(state, 45);
  assert.ok(damaged(mainWard(state, 'right')), 'it reached the enemy circle');
  assert.ok(!damaged(mainWard(state, 'left')), 'without hurting its own circle');
});

test('if there is no way round, it chews through', () => {
  const state = duel();
  // Box the enemy circle in with walls.
  wall(state, 'right', 1120, 260, 1120, 640);
  wall(state, 'right', 1110, 270, 1500, 270);
  wall(state, 'right', 1110, 630, 1500, 630);
  wall(state, 'right', 1490, 260, 1490, 640);
  makeChalklingBookWay(state, 'left', urchin(0, 0), { k: 1 });
  run(state, 60);
  assert.ok(state.walls.some((w) => w.health < w.max) || state.walls.length < 4, 'it chewed a wall');
});
