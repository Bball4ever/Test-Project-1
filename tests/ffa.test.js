import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDuel, addStroke, step, mainWard } from '../src/engine/duel.js';
import { applyAction } from '../src/engine/actions.js';
import { depthIn, playerIds } from '../src/engine/territory.js';
import { damageSection } from '../src/engine/damage.js';
import { BotController } from '../src/controllers/bot.js';
import { stickFigure } from '../src/data/creatures.js';
import * as S from './fixtures/strokes.js';
import { run, makeChalklingBookWay } from './fixtures/making.js';

const circleAt = (state, id, r = 110) => {
  const h = state.homes[id];
  return addStroke(state, id, S.circle({ cx: h.x, cy: h.y, r, noise: 1 }));
};

test('2 players: the territories are the left and right halves, as always', () => {
  const state = createDuel();
  assert.deepEqual(state.players, ['left', 'right']);
  assert.equal(state.cfg.world.width, 1600);
  assert.ok(depthIn(state, 'left', { x: 790, y: 100 }).depth > 0);
  assert.ok(depthIn(state, 'left', { x: 810, y: 100 }).depth < 0);
  assert.ok(Math.abs(depthIn(state, 'left', { x: 700, y: 450 }).depth - 100) < 1e-9);
});

test('up to 10 players: a bigger board, everyone deep inside their own territory', () => {
  for (const n of [3, 6, 10]) {
    const state = createDuel({ players: n });
    assert.deepEqual(state.players, playerIds(n));
    assert.ok(state.cfg.world.width > 1600);
    for (const id of state.players) assert.ok(depthIn(state, id, state.homes[id]).depth > 300, `${n} players: ${id}`);
  }
  assert.equal(createDuel({ players: 50 }).players.length, 10, 'never more than 10');
});

test("you can't draw in someone else's territory", () => {
  const state = createDuel({ players: 4 });
  circleAt(state, 'left');
  const theirs = state.homes.p2;
  const r = addStroke(state, 'left', S.line({ x1: theirs.x - 60, y1: theirs.y, x2: theirs.x + 60, y2: theirs.y }));
  assert.equal(r.accepted, false);
  assert.equal(r.result.reason, 'stay on your side');
});

test('a breached player is out (their lines are wiped); the last circle standing wins', () => {
  const state = createDuel({ players: 3 });
  for (const id of state.players) circleAt(state, id);
  const h = state.homes.right;
  addStroke(state, 'right', S.line({ x1: h.x - 50, y1: h.y + 200, x2: h.x + 50, y2: h.y + 200 }));
  const breach = (id) => {
    const ward = mainWard(state, id);
    damageSection(state, ward, 0, 1e9, ward.center);
    step(state);
  };
  breach('right');
  assert.deepEqual(state.out, ['right']);
  assert.equal(state.winner, null, 'two are still in');
  assert.ok(!state.walls.some((w) => w.owner === 'right'), "the breached player's wall is gone");
  assert.equal(addStroke(state, 'right', S.circle({ cx: h.x, cy: h.y, r: 90 })).accepted, false, "and they can't draw any more");
  breach('p2');
  assert.equal(state.winner, 'left');
});

test("chalklings march on the nearest enemy circle that's still standing", () => {
  const state = createDuel({ players: 4 });
  for (const id of state.players) circleAt(state, id);
  const c = makeChalklingBookWay(state, 'left', stickFigure(0, 0));
  run(state, 0.5);
  const nearest = (from) =>
    state.wards.filter((w) => w.main && w.owner !== 'left').sort((a, b) => Math.hypot(a.center.x - from.x, a.center.y - from.y) - Math.hypot(b.center.x - from.x, b.center.y - from.y))[0];
  const target = nearest(c.pos);
  const before = Math.hypot(target.center.x - c.pos.x, target.center.y - c.pos.y);
  run(state, 3);
  assert.ok(Math.hypot(target.center.x - c.pos.x, target.center.y - c.pos.y) < before - 50, 'it heads for the nearest enemy circle');
});

test('a free-for-all of bots plays out to a single winner', () => {
  for (const n of [3, 6, 10]) {
    const state = createDuel({ players: n });
    const bots = state.players.map((id, i) => new BotController({ owner: id, level: 'duelist', seed: 40 + i + n }));
    for (let i = 0; i < 60 * 300 && !state.winner; i++) {
      for (const b of bots) b.update(state, (action) => applyAction(state, b.owner, action));
      step(state);
      state.events.length = 0;
    }
    assert.ok(state.players.includes(state.winner), `${n} players: winner ${state.winner}`);
    assert.equal(state.out.length, n - 1);
  }
});
