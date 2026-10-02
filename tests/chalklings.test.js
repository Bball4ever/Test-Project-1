import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDuel, addStroke, setOrder, mainWard } from '../src/engine/duel.js';
import { measureCreature } from '../src/engine/chalklings.js';
import { sanitizeAction } from '../src/engine/actions.js';
import { stickFigure, beetle, urchin, turtle, centipede } from '../src/data/creatures.js';
import { dummyCirclePoints } from '../src/controllers/dummy.js';
import { CONFIG } from '../src/config.js';
import * as S from './fixtures/strokes.js';
import { run, bindPoint, line, chainAndCircle, drawCreature, drawPath, erase, makeChalklingBookWay, MAKING } from './fixtures/making.js';

const C = CONFIG.chalkling;
const MID = CONFIG.engine.world.width / 2;

function duel() {
  const state = createDuel();
  addStroke(state, 'left', S.circle({ cx: 300, cy: 450, r: 110, noise: 1 }));
  addStroke(state, 'right', S.circle({ cx: 1300, cy: 450, r: 110, noise: 1 }));
  return state;
}

// How much a role boosted a stat compared to a plain chalkling of the same detail.
const biteBoost = (c) => c.bite / (C.baseBite + C.bitePerDetail * c.detail);
const healthBoost = (c) => c.max / (C.baseHealth + C.healthPerDetail * c.detail);
const speedBoost = (c) => c.speed / (C.baseSpeed / (1 + C.slowPerDetail * c.detail));

// --- Grading -------------------------------------------------------------------------

test('what a creature looks like decides its role', () => {
  assert.equal(measureCreature(urchin(0, 0), C).role, 'attacker');
  assert.equal(measureCreature(turtle(0, 0), C).role, 'defender');
  assert.equal(measureCreature(centipede(0, 0), C).role, 'runner');
});

test('roles shift strength: attackers bite, defenders last, runners run', () => {
  const state = duel();
  const spiky = makeChalklingBookWay(state, 'left', urchin(0, 0), { k: 1 });
  const bulky = makeChalklingBookWay(state, 'left', turtle(0, 0), { k: 3 });
  const leggy = makeChalklingBookWay(state, 'right', centipede(0, 0), { k: 1 });
  assert.ok(biteBoost(spiky) > biteBoost(bulky) && biteBoost(spiky) > biteBoost(leggy));
  assert.ok(healthBoost(bulky) > healthBoost(spiky) && healthBoost(bulky) > healthBoost(leggy));
  assert.ok(speedBoost(leggy) > speedBoost(spiky) && speedBoost(leggy) > speedBoost(bulky));
});

test('more detail still means a stronger chalkling', () => {
  assert.ok(measureCreature(beetle(0, 0), C).detail > measureCreature(stickFigure(0, 0), C).detail * 2);
});

// --- Making one, step by step ------------------------------------------------------------

test('a chalkling only comes alive after chain, circle, creature, path, and erasing the chain', () => {
  const state = duel();
  const { center, r, chainMid } = chainAndCircle(state, 'left', 1);
  assert.equal(state.chains.length, 1, 'the line from the bind point became a chain');
  const holding = state.wards.find((w) => w.holding);
  assert.ok(holding, 'the circle on its end is a holding circle');

  const results = drawCreature(state, 'left', beetle(0, 0), center, r);
  assert.ok(results.every((x) => x.result.type === 'creature'), 'strokes inside the circle are the creature');
  assert.equal(state.chalklings.length, 0);

  const target = mainWard(state, 'right').center;
  assert.equal(drawPath(state, 'left', center, r, target).result.type, 'path');
  run(state, 2);
  assert.equal(state.chalklings.length, 0, 'still chained');

  erase(state, 'left', chainMid);
  assert.equal(state.chalklings.length, 1, 'erasing the chain releases it');
  assert.equal(state.chains.length, 0);
  assert.ok(!state.wards.some((w) => w.id === holding.id), 'the holding circle is gone');
  assert.equal(state.chalklings[0].mode, 'path');
});

test('in Chalkling mode, the chain has to start at a bind point', () => {
  const state = duel();
  const a = Math.PI / 4; // halfway between bind points
  const start = { x: 300 + Math.cos(a) * 110, y: 450 + Math.sin(a) * 110 };
  const end = { x: start.x + Math.cos(a) * 90, y: start.y + Math.sin(a) * 90 };
  const r = addStroke(state, 'left', line(start, end), MAKING);
  assert.equal(r.result.reason, 'a chain must start at a green bind point');
  assert.equal(state.chains.length, 0);
});

test('Chalkling mode says what to draw next', () => {
  const state = duel();
  const wave = S.wave({ x: 450, y: 200, length: 150 });
  assert.equal(addStroke(state, 'left', wave, MAKING).result.reason, 'start with a straight line from a green bind point');
  const { point, dir } = bindPoint(state, 'left', 1);
  addStroke(state, 'left', line(point, { x: point.x + dir.x * 90, y: point.y + dir.y * 90 }), MAKING);
  assert.equal(addStroke(state, 'left', wave, MAKING).result.reason, 'next: a circle on the end of the chain');
  assert.equal(state.walls.length, 0, 'nothing drawn in Chalkling mode became a wall');
  assert.equal(state.vigors.length, 0, 'or a wave');
});

test('without Chalkling mode, a line from a bind point and a circle on its end are just a wall and a shield', () => {
  const state = duel();
  const { point, dir } = bindPoint(state, 'left', 1);
  const end = { x: point.x + dir.x * 90, y: point.y + dir.y * 90 };
  addStroke(state, 'left', line(point, end));
  addStroke(state, 'left', S.circle({ cx: end.x + dir.x * 55, cy: end.y + dir.y * 55, r: 55, noise: 1 }));
  assert.equal(state.chains.length, 0);
  assert.equal(state.walls.length, 1);
  assert.ok(!state.wards.some((w) => w.holding));
});

test('there is no shortcut: a "make a chalkling" action is refused', () => {
  assert.equal(sanitizeAction({ type: 'chalkling', strokes: [beetle(500, 450)[0]] }), null);
});

// --- Erasing --------------------------------------------------------------------------------

test('erasing takes 3 seconds in a row', () => {
  const state = duel();
  addStroke(state, 'left', S.line({ x1: 600, y1: 200, x2: 600, y2: 450 }));
  const at = { x: 600, y: 300 };
  erase(state, 'left', at, 2.5);
  erase(state, 'left', at, 2.5);
  assert.equal(state.walls.length, 1, 'two 2.5 s rubs do not add up');
  erase(state, 'left', at, 3.1);
  assert.equal(state.walls.length, 0, '3 s in a row erases it');
  assert.ok(state.events.some((e) => e.type === 'erased'));
});

test('you can only erase your own lines, and never your main circle', () => {
  const state = duel();
  addStroke(state, 'right', S.line({ x1: 1000, y1: 200, x2: 1000, y2: 450 }));
  erase(state, 'left', { x: 1000, y: 300 });
  assert.equal(state.walls.length, 1, "can't erase the enemy's wall");
  erase(state, 'left', { x: 300, y: 340 });
  assert.ok(mainWard(state, 'left'), "can't erase your main circle");
});

test('erasing a holding circle before release loses the creature', () => {
  const state = duel();
  const { center, r } = chainAndCircle(state, 'left', 1);
  drawCreature(state, 'left', stickFigure(0, 0), center, r);
  erase(state, 'left', { x: center.x + r, y: center.y });
  assert.ok(state.events.some((e) => e.type === 'creatureLost'));
  assert.equal(state.chains.length, 0, 'its chain goes too');
  assert.equal(state.chalklings.length, 0);
});

// --- Commands ---------------------------------------------------------------------------------

test('a chalkling follows its path no matter what, ignoring enemy chalklings', () => {
  const state = duel();
  // An enemy chalkling standing guard right on our path.
  setOrder(state, 'right', 'guard');
  const enemy = makeChalklingBookWay(state, 'right', turtle(0, 0), { k: 1 });
  run(state, 6);
  const goal = { x: enemy.pos.x + 150, y: enemy.pos.y - 200 };
  const ours = makeChalklingBookWay(state, 'left', centipede(0, 0), { k: 1, to: goal });
  let fought = false;
  for (let i = 0; i < 60 * 30 && ours.mode === 'path'; i++) {
    run(state, 1 / 60);
    if (ours.action === 'fight') fought = true;
  }
  assert.equal(fought, false, 'it never stopped to fight');
  assert.ok(state.events.some((e) => e.type === 'pathDone' && e.id === ours.id), 'it reached the end of its path');
});

test('on a path, it goes around a wall if it can, and still attacks the enemy circle', () => {
  const state = duel();
  addStroke(state, 'right', S.line({ x1: 950, y1: 300, x2: 950, y2: 640 }));
  const wall = state.walls[0];
  makeChalklingBookWay(state, 'left', beetle(0, 0), { k: 1, to: mainWard(state, 'right').center });
  run(state, 60);
  assert.equal(wall.health, wall.max, 'it went around the wall');
  assert.ok(mainWard(state, 'right').sections.some((s) => s.health < s.max), 'and attacked the circle');
});

test('on a path, it chews through walls when there is no way round', () => {
  const state = duel();
  // Walls right across the board.
  addStroke(state, 'right', S.line({ x1: 950, y1: 0, x2: 950, y2: 460 }));
  addStroke(state, 'right', S.line({ x1: 950, y1: 440, x2: 950, y2: 900 }));
  makeChalklingBookWay(state, 'left', beetle(0, 0), { k: 1, to: mainWard(state, 'right').center });
  run(state, 60);
  assert.ok(state.walls.length < 2 || state.walls.some((w) => w.health < w.max), 'it chewed a wall');
});

test('a path ending on an enemy chalkling means hunt it; afterwards it comes home and waits', () => {
  const state = duel();
  setOrder(state, 'right', 'guard');
  const prey = makeChalklingBookWay(state, 'right', stickFigure(0, 0), { k: 1 });
  run(state, 6);
  const hunter = makeChalklingBookWay(state, 'left', urchin(0, 0), { k: 1, to: prey.pos });
  assert.equal(hunter.mode, 'hunt');
  run(state, 40);
  assert.ok(prey.gone || !state.chalklings.includes(prey), 'the prey is dead');
  assert.ok(state.events.some((e) => e.type === 'missionDone' && e.id === hunter.id));
  assert.equal(hunter.mode, 'waiting');
  assert.ok(hunter.pos.x <= MID - CONFIG.making.returnDepth + 3, 'it walked back to its own side');

  // The Attack / Guard buttons don't move a waiting chalkling.
  setOrder(state, 'left', 'attack');
  const spot = { ...hunter.pos };
  run(state, 2);
  assert.deepEqual(hunter.pos, spot);

  // Chain it, give it a new path, erase the chain: it goes.
  const { point } = bindPoint(state, 'left', 0);
  assert.equal(addStroke(state, 'left', line(point, hunter.pos), MAKING).result.type, 'chain');
  assert.equal(hunter.mode, 'held');
  drawPath(state, 'left', hunter.pos, hunter.radius, mainWard(state, 'right').center);
  const chain = state.chains[0];
  erase(state, 'left', { x: (chain.from.x + chain.to.x) / 2, y: (chain.from.y + chain.to.y) / 2 });
  assert.equal(hunter.mode, 'path');
});

test('Attack / Guard only command chalklings that finished their paths', () => {
  const state = duel();
  const free = makeChalklingBookWay(state, 'left', stickFigure(0, 0), { k: 1 });
  const onPath = makeChalklingBookWay(state, 'left', stickFigure(0, 0), { k: 3, to: { x: 700, y: 100 } });
  setOrder(state, 'left', 'guard');
  assert.equal(free.order, 'guard');
  assert.equal(onPath.mode, 'path');
  assert.equal(onPath.order, 'attack');
});

// --- Fighting ------------------------------------------------------------------------------------

test('a duel can be won with chalklings alone', () => {
  const state = createDuel();
  addStroke(state, 'left', S.circle({ cx: 300, cy: 450, r: 110, noise: 1 }));
  addStroke(state, 'right', dummyCirclePoints('neat'));
  const target = mainWard(state, 'right').center;
  makeChalklingBookWay(state, 'left', beetle(0, 0), { k: 1, to: target });
  makeChalklingBookWay(state, 'left', urchin(0, 0), { k: 3, to: target });
  run(state, 120);
  assert.equal(state.winner, 'left');
});

test('a detailed chalkling beats a stick figure', () => {
  const state = duel();
  makeChalklingBookWay(state, 'left', beetle(0, 0), { k: 0 });
  makeChalklingBookWay(state, 'right', stickFigure(0, 0), { k: 0 });
  for (let i = 0; i < 60 && state.chalklings.length === 2; i++) run(state, 1);
  assert.equal(state.chalklings.length, 1);
  assert.equal(state.chalklings[0].owner, 'left');
});

test('a Line of Vigor can destroy a chalkling', () => {
  const state = duel();
  setOrder(state, 'right', 'guard');
  const c = makeChalklingBookWay(state, 'right', stickFigure(0, 0), { k: 1 });
  run(state, 5);
  let shots = 0;
  while (!c.gone && shots < 8) {
    addStroke(state, 'left', S.wave({ x: 480, y: c.pos.y, length: 180, amplitude: 16, seed: ++shots }));
    run(state, 1.5);
  }
  assert.ok(c.gone, `still alive after ${shots} waves`);
});

test('chalkling duels are deterministic', () => {
  const play = () => {
    const state = duel();
    makeChalklingBookWay(state, 'left', beetle(0, 0), { k: 1, to: { x: 1000, y: 700 } });
    makeChalklingBookWay(state, 'right', turtle(0, 0), { k: 3 });
    run(state, 30);
    const { cfg, chalkCfg, makeCfg, ...rest } = state;
    return JSON.stringify(rest);
  };
  assert.equal(play(), play());
});
