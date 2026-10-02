import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDuel, addStroke, setOrder } from '../src/engine/duel.js';
import { detectPowers } from '../src/engine/powers.js';
import { makeChalkling, measureCreature } from '../src/engine/chalklings.js';
import * as C from '../src/data/creatures.js';
import { CONFIG } from '../src/config.js';
import * as S from './fixtures/strokes.js';
import { run, makeChalklingBookWay } from './fixtures/making.js';

// These tests aren't about the chalk limit, so give both sides endless chalk.
CONFIG.chalk.supply = Infinity;

const P = CONFIG.powers;
const detect = (creature) => detectPowers(C.fitInside(creature(0, 0), { x: 0, y: 0 }, 55), CONFIG.chalkling, P);

function duel() {
  const state = createDuel();
  addStroke(state, 'left', S.circle({ cx: 300, cy: 450, r: 110, noise: 1 }));
  addStroke(state, 'right', S.circle({ cx: 1300, cy: 450, r: 110, noise: 1 }));
  return state;
}

test('each piece of gear is recognised', () => {
  assert.deepEqual(detect(C.knight), ['sword']);
  assert.deepEqual(detect(C.archer), ['bow']);
  assert.deepEqual(detect(C.guardian), ['shield']);
  assert.deepEqual(detect(C.angel), ['wings']);
  assert.deepEqual(detect(C.king), ['crown']);
  assert.deepEqual(detect(C.medic), ['healer']);
  assert.deepEqual(detect(C.whirl), ['whirlwind']);
});

test('ordinary creatures have no powers', () => {
  for (const creature of [C.stickFigure, C.beetle, C.urchin, C.turtle, C.centipede]) {
    assert.deepEqual(detect(creature), [], creature.name);
  }
});

test('gear can be combined', () => {
  const body = C.knight(0, 0);
  const withCross = [...body, ...C.medic(0, 0).slice(1)];
  assert.deepEqual(detect(() => withCross).sort(), ['healer', 'sword']);
});

test('a sword makes it bite harder; wings and a whirlwind make it faster', () => {
  // The same drawing, with and without the power's bonus switched on.
  const make = (creature, pc) => {
    const strokes = C.fitInside(creature(0, 0), { x: 0, y: 0 }, 55);
    return makeChalkling(1, 'left', strokes, measureCreature(strokes, CONFIG.chalkling), CONFIG.chalkling, 'attack', pc);
  };
  const off = { ...P, swordBite: 1, wingSpeed: 1, spiralSpeed: 1 };
  assert.ok(Math.abs(make(C.knight, P).bite / make(C.knight, off).bite - P.swordBite) < 1e-9);
  assert.ok(Math.abs(make(C.angel, P).speed / make(C.angel, off).speed - P.wingSpeed) < 1e-9);
  assert.ok(Math.abs(make(C.whirl, P).speed / make(C.whirl, off).speed - P.spiralSpeed) < 1e-9);
});

test('a shield halves the damage taken', () => {
  const state = duel();
  const shielded = makeChalklingBookWay(state, 'left', C.guardian(0, 0), { k: 1 });
  const hp = shielded.hp;
  addStroke(state, 'right', S.wave({ x: 1050, y: shielded.pos.y, length: 160, amplitude: 16, angle: Math.PI }));
  run(state, 2);
  const hit = state.events.find((e) => e.type === 'hit' && e.chalklingId === shielded.id);
  assert.ok(hit, 'the wave hit it');
  assert.ok(Math.abs(hp - shielded.hp - hit.damage * P.shieldTaken) < 1e-6);
});

test('wings fly over walls without chewing them', () => {
  const state = duel();
  addStroke(state, 'right', S.line({ x1: 950, y1: 0, x2: 950, y2: 460 }));
  addStroke(state, 'right', S.line({ x1: 950, y1: 440, x2: 950, y2: 900 }));
  const angel = makeChalklingBookWay(state, 'left', C.angel(0, 0), { k: 1 });
  run(state, 40);
  assert.ok(angel.pos.x > 950 || angel.gone, 'it got past the walls');
  assert.ok(state.walls.every((w) => w.health === w.max), 'without chewing them');
});

test('a bow shoots enemy chalklings from a distance', () => {
  const state = duel();
  setOrder(state, 'left', 'guard');
  const archer = makeChalklingBookWay(state, 'left', C.archer(0, 0), { k: 1 });
  run(state, 6);
  setOrder(state, 'right', 'guard');
  const target = makeChalklingBookWay(state, 'right', C.stickFigure(0, 0), { k: 1 });
  // Bring the target within range but not touching.
  target.pos = { x: archer.pos.x + 180, y: archer.pos.y };
  target.mode = 'waiting';
  const hp = target.hp;
  run(state, 2);
  assert.ok(state.events.some((e) => e.type === 'arrow' && e.owner === 'left'), 'it fired');
  assert.ok(target.hp < hp || target.gone, 'and hit');
});

test('a healer mends itself and nearby friends', () => {
  const state = duel();
  setOrder(state, 'left', 'guard');
  const medic = makeChalklingBookWay(state, 'left', C.medic(0, 0), { k: 1 });
  const friend = makeChalklingBookWay(state, 'left', C.turtle(0, 0), { k: 3 });
  friend.pos = { x: medic.pos.x + 60, y: medic.pos.y };
  friend.mode = 'waiting';
  medic.mode = 'waiting';
  friend.hp = friend.max / 2;
  const before = friend.hp;
  run(state, 2);
  assert.ok(friend.hp > before + P.healPerSecond * 1.5, `healed from ${before} to ${friend.hp}`);
});

test('a crown makes nearby friends bite harder', () => {
  const state = duel();
  const enemy = makeChalklingBookWay(state, 'right', C.turtle(0, 0), { k: 1 });
  enemy.mode = 'waiting';
  const attacker = makeChalklingBookWay(state, 'left', C.urchin(0, 0), { k: 1 });
  attacker.mode = 'waiting';
  attacker.pos = { x: 700, y: 300 };
  enemy.pos = { x: 700 + attacker.radius + enemy.radius, y: 300 };
  const biteFor = (seconds) => {
    const hp = enemy.hp;
    run(state, seconds);
    return hp - enemy.hp;
  };
  const without = biteFor(1);
  const king = makeChalklingBookWay(state, 'left', C.king(0, 0), { k: 3 });
  king.mode = 'waiting';
  king.pos = { x: 700, y: 300 - 90 };
  const withCrown = biteFor(1);
  assert.ok(withCrown > without * 1.2, `bite went from ${without} to ${withCrown}`);
});
