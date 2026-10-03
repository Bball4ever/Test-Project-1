import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDuel, addStroke, step, mainWard } from '../src/engine/duel.js';
import { applyAction } from '../src/engine/actions.js';
import { depthIn, isFoe, facingOf } from '../src/engine/territory.js';
import { damageSection } from '../src/engine/damage.js';
import { BotController } from '../src/controllers/bot.js';
import { stickFigure } from '../src/data/creatures.js';
import * as S from './fixtures/strokes.js';
import { run, makeChalklingBookWay } from './fixtures/making.js';

const circleAt = (state, id, r = 110) => {
  const h = state.homes[id];
  return addStroke(state, id, S.circle({ cx: h.x, cy: h.y, r, noise: 1 }));
};
const breach = (state, id) => {
  const ward = mainWard(state, id);
  damageSection(state, ward, 0, 1e9, ward.center);
  step(state);
};

test('teams: even places against odd places; one team down the left half, one down the right', () => {
  const state = createDuel({ players: 4, teams: true });
  assert.deepEqual(state.teams, { left: 0, right: 1, p2: 0, p3: 1 });
  assert.ok(!isFoe(state, 'left', 'p2') && isFoe(state, 'left', 'right') && isFoe(state, 'p2', 'p3'));
  for (const id of state.players) {
    const h = state.homes[id];
    assert.equal(h.x < state.cfg.world.width / 2, state.teams[id] === 0, `${id} on its team's half`);
    assert.ok(depthIn(state, id, h).depth > 300, `${id} has room`);
  }
  assert.deepEqual(facingOf(state, 'p2'), { x: 1, y: 0 });
  assert.deepEqual(facingOf(state, 'p3'), { x: -1, y: 0 });
  // A teammate's territory is still theirs, not yours.
  const theirs = state.homes.p2;
  circleAt(state, 'left');
  const r = addStroke(state, 'left', S.line({ x1: theirs.x - 60, y1: theirs.y, x2: theirs.x + 60, y2: theirs.y }));
  assert.equal(r.result.reason, 'stay on your side');
});

test("teams: a teammate's Vigor passes through your circle, but your walls stop it", () => {
  const state = createDuel({ players: 4, teams: true });
  for (const id of state.players) circleAt(state, id);
  // p2 (bottom left) fires straight up at left's circle (top left), its teammate.
  const fire = () => {
    const h = state.homes.p2;
    const r = addStroke(state, 'p2', S.wave({ x: h.x + 200, y: h.y - 60, length: 220, angle: -Math.PI / 2 }));
    assert.equal(r.result.type, 'vigor');
    const v = state.vigors.at(-1);
    v.pos = { x: state.homes.left.x, y: state.homes.left.y + 300 };
    v.vel = { x: 0, y: -Math.hypot(v.vel.x, v.vel.y) };
    return v;
  };
  const before = mainWard(state, 'left').sections.map((s) => s.health);
  fire();
  run(state, 2);
  assert.deepEqual(mainWard(state, 'left').sections.map((s) => s.health), before, 'no damage to a teammate');
  assert.equal(state.vigors.length, 0);

  const h = state.homes.left;
  addStroke(state, 'left', S.line({ x1: h.x - 80, y1: h.y + 200, x2: h.x + 80, y2: h.y + 200 }));
  const wall = state.walls.at(-1);
  const health = wall.health;
  fire();
  run(state, 2);
  assert.ok(wall.health < health, "your wall blocks your teammate's wave too");
});

test("teams: chalklings leave teammates alone and march on the nearest enemy circle", () => {
  const state = createDuel({ players: 4, teams: true });
  for (const id of state.players) circleAt(state, id);
  const c = makeChalklingBookWay(state, 'left', stickFigure(0, 0));
  run(state, 0.5);
  const target = mainWard(state, 'right');
  const before = Math.hypot(target.center.x - c.pos.x, target.center.y - c.pos.y);
  run(state, 3);
  assert.ok(Math.hypot(target.center.x - c.pos.x, target.center.y - c.pos.y) < before - 50, 'heads for the enemy across from it');
  assert.equal(mainWard(state, 'p2').sections.every((s) => s.health === s.max), true);
});

test('teams: you can be out while your team plays on; the last team standing wins', () => {
  const state = createDuel({ players: 4, teams: true });
  for (const id of state.players) circleAt(state, id);
  breach(state, 'left');
  assert.equal(state.winner, null, 'your teammate is still in');
  breach(state, 'right');
  assert.equal(state.winner, null);
  breach(state, 'p3');
  assert.equal(state.winner, 'team0');
});

test('teams: a whole team without circles when the countdown ends loses', () => {
  const state = createDuel({ players: 4, teams: true });
  circleAt(state, 'right');
  run(state, state.circleDeadlineMs / 1000 + 0.1);
  assert.equal(state.winner, 'team1');
});

test('a team game of bots plays out to a winning team', () => {
  for (const n of [4, 6, 10]) {
    const state = createDuel({ players: n, teams: true });
    const bots = state.players.map((id, i) => new BotController({ owner: id, level: 'duelist', seed: 70 + i + n }));
    for (let i = 0; i < 60 * 300 && !state.winner; i++) {
      for (const b of bots) b.update(state, (action) => applyAction(state, b.owner, action));
      step(state);
      state.events.length = 0;
    }
    assert.ok(['team0', 'team1'].includes(state.winner), `${n} players: winner ${state.winner}`);
    assert.ok(state.players.filter((id) => !state.out.includes(id)).every((id) => `team${state.teams[id]}` === state.winner));
  }
});
