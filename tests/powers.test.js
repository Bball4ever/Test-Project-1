import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDuel, addStroke, step } from '../src/engine/duel.js';
import { applyAction, sanitizeAction } from '../src/engine/actions.js';
import { measureCreature } from '../src/engine/chalklings.js';
import { powerLevel } from '../src/engine/powers.js';
import { damageChalkling } from '../src/engine/damage.js';
import { stickFigure, beetle, urchin, turtle } from '../src/data/creatures.js';
import { CONFIG } from '../src/config.js';
import * as S from './fixtures/strokes.js';
import { run, makeChalklingBookWay } from './fixtures/making.js';

// These tests aren't about the chalk limit, so give both sides endless chalk.
CONFIG.chalk.supply = Infinity;

const P = CONFIG.powers;

function duel() {
  const state = createDuel();
  addStroke(state, 'left', S.circle({ cx: 300, cy: 450, r: 110, noise: 1 }));
  addStroke(state, 'right', S.circle({ cx: 1300, cy: 450, r: 110, noise: 1 }));
  return state;
}

// A chalkling of `side`, made the book way with `power`, then parked at `at` doing nothing.
function parked(state, side, creature, power, at, r = 55) {
  const c = makeChalklingBookWay(state, side, creature, { power, r, k: 1 });
  assert.ok(c, 'chalkling made');
  c.mode = 'waiting';
  c.pos = { ...at };
  return c;
}

test('the picked power goes with the chalkling, and more chalk makes it stronger', () => {
  const state = duel();
  const small = makeChalklingBookWay(state, 'left', stickFigure(0, 0), { power: 'sword', r: 40 });
  const big = makeChalklingBookWay(state, 'left', beetle(0, 0), { power: 'sword', r: 90, k: 2 });
  assert.equal(small.power, 'sword');
  assert.equal(big.power, 'sword');
  assert.ok(big.powerLevel > small.powerLevel * 2, `${big.powerLevel} vs ${small.powerLevel}`);
  assert.equal(big.powerLevel, powerLevel(measureCreature(big.strokes, CONFIG.chalkling).ink, P));
});

test('power level follows the chalk, within its limits', () => {
  assert.equal(powerLevel(P.chalkPerLevel, P), 1);
  assert.equal(powerLevel(P.chalkPerLevel * 2, P), 2);
  assert.equal(powerLevel(1, P), P.minLevel);
  assert.equal(powerLevel(1e6, P), P.maxLevel);
});

test('no power picked means no power', () => {
  const state = duel();
  const c = makeChalklingBookWay(state, 'left', beetle(0, 0));
  assert.equal(c.power, null);
});

test('sword bites harder; whirlwind and wings are faster', () => {
  const base = makeChalklingBookWay(duel(), 'left', urchin(0, 0));
  const sword = makeChalklingBookWay(duel(), 'left', urchin(0, 0), { power: 'sword' });
  const whirl = makeChalklingBookWay(duel(), 'left', urchin(0, 0), { power: 'whirlwind' });
  const wings = makeChalklingBookWay(duel(), 'left', urchin(0, 0), { power: 'wings' });
  const L = sword.powerLevel;
  assert.ok(Math.abs(sword.bite - base.bite * (1 + P.swordBite * L)) < 1e-9);
  assert.ok(Math.abs(whirl.speed - base.speed * (1 + P.whirlwindSpeed * L)) < 1e-9);
  assert.ok(wings.speed > base.speed && wings.speed < whirl.speed);
});

test('a shield takes less damage, more so with more chalk', () => {
  const state = duel();
  const c = parked(state, 'left', beetle(0, 0), 'shield', { x: 500, y: 200 });
  const before = c.hp;
  damageChalkling(state, c, 10);
  assert.ok(Math.abs(before - c.hp - 10 / (1 + P.shieldBlock * c.powerLevel)) < 1e-9);
});

test('a bow shoots enemy chalklings in range', () => {
  const state = duel();
  const archer = parked(state, 'left', beetle(0, 0), 'bow', { x: 600, y: 200 });
  const foe = parked(state, 'right', beetle(0, 0), null, { x: 600 + P.bowRange, y: 200 });
  const before = foe.hp;
  step(state);
  assert.ok(state.events.some((e) => e.type === 'arrow') || foe.hp < before);
  assert.ok(Math.abs(before - foe.hp - P.arrowDamage * archer.powerLevel) < 1e-9);
});

test('a healer heals friends nearby', () => {
  const state = duel();
  parked(state, 'left', beetle(0, 0), 'healer', { x: 500, y: 200 });
  const friend = parked(state, 'left', beetle(0, 0), null, { x: 560, y: 200 });
  friend.hp = friend.max / 2;
  run(state, 1);
  assert.ok(friend.hp > friend.max / 2 + 1);
});

test('a crown makes nearby friends bite harder', () => {
  const state = duel();
  const friend = parked(state, 'left', urchin(0, 0), null, { x: 600, y: 200 });
  const foe = parked(state, 'right', turtle(0, 0), null, { x: 600 + friend.radius + 20, y: 200 });
  const king = parked(state, 'left', beetle(0, 0), 'crown', { x: 520, y: 320 });
  foe.pos = { x: friend.pos.x + friend.radius + foe.radius, y: 200 };
  const before = foe.hp;
  step(state);
  const expected = friend.bite * (1 + P.crownBite * king.powerLevel) * (state.cfg.stepMs / 1000);
  assert.ok(Math.abs(before - foe.hp - expected) < 1e-6, `${before - foe.hp} vs ${expected}`);
});

test('wings fly over walls', () => {
  const state = duel();
  const c = parked(state, 'left', beetle(0, 0), 'wings', { x: 500, y: 450 });
  c.mode = 'order';
  c.order = 'attack';
  // A long wall right across the board in front of it.
  addStroke(state, 'left', S.line({ x1: 620, y1: 20, x2: 620, y2: 880, noise: 0.5 }));
  const wall = state.walls[state.walls.length - 1];
  run(state, 3);
  assert.ok(c.pos.x > 660, `got to x=${c.pos.x.toFixed(0)}`);
  assert.ok(!wall.gone && wall.health === wall.max, 'it flew over instead of chewing');
});

test('the power comes over the network only if it is a real one', () => {
  const pts = [{ x: 1, y: 2 }];
  assert.equal(sanitizeAction({ type: 'stroke', points: pts, making: true, power: 'bow' }).power, 'bow');
  assert.equal(sanitizeAction({ type: 'stroke', points: pts, making: true, power: 'laser' }).power, null);
  const state = duel();
  assert.equal(applyAction(state, 'left', { type: 'stroke', points: pts, power: 'nope' }).accepted, false);
});
