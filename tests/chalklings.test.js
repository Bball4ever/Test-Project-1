import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDuel, addStroke, setOrder, mainWard } from '../src/engine/duel.js';
import { measureCreature, speedFor } from '../src/engine/chalklings.js';
import { sanitizeAction } from '../src/engine/actions.js';
import { stickFigure, beetle, urchin, turtle, centipede } from '../src/data/creatures.js';
import { dummyCirclePoints } from '../src/controllers/dummy.js';
import { CONFIG } from '../src/config.js';
import * as S from './fixtures/strokes.js';
import { run, bindPoint, line, chainAndCircle, drawCreature, drawPath, erase, makeChalklingBookWay, MAKING } from './fixtures/making.js';

// These tests aren't about the chalk limit, so give both sides endless chalk.
CONFIG.chalk.supply = Infinity;

const C = CONFIG.chalkling;
const MID = CONFIG.engine.world.width / 2;

function duel() {
  const state = createDuel();
  addStroke(state, 'left', S.circle({ cx: 300, cy: 450, r: 110, noise: 1 }));
  addStroke(state, 'right', S.circle({ cx: 1300, cy: 450, r: 110, noise: 1 }));
  return state;
}

// How much shape boosted a stat compared to a plain chalkling of the same detail.
const biteBoost = (c) => c.bite / (C.baseBite + C.bitePerDetail * c.detail);
const healthBoost = (c) => c.max / (C.baseHealth + C.healthPerDetail * c.detail);

// --- Grading -------------------------------------------------------------------------

test('what a creature looks like decides whether it is pointy or round', () => {
  assert.equal(measureCreature(urchin(0, 0), C).role, 'attacker'); // pointy
  assert.equal(measureCreature(turtle(0, 0), C).role, 'defender'); // round
});

test('rounder creatures have more health; pointier creatures bite harder', () => {
  const state = duel();
  const pointy = makeChalklingBookWay(state, 'left', urchin(0, 0), { k: 1 });
  const round = makeChalklingBookWay(state, 'left', turtle(0, 0), { k: 3 });
  assert.ok(biteBoost(pointy) > 1 && biteBoost(pointy) > biteBoost(round));
  assert.ok(healthBoost(round) > 1 && healthBoost(round) > healthBoost(pointy));
});

test('more detail still means a stronger chalkling', () => {
  assert.ok(measureCreature(beetle(0, 0), C).detail > measureCreature(stickFigure(0, 0), C).detail * 2);
});

test("detail is about features, not chalk: the same drawing bigger isn't stronger, just slower", () => {
  const small = makeChalklingBookWay(duel(), 'left', urchin(0, 0), { r: 40 });
  const big = makeChalklingBookWay(duel(), 'left', urchin(0, 0), { r: 90 });
  assert.ok(Math.abs(small.detail - big.detail) < 1e-9, `${small.detail} vs ${big.detail}`);
  assert.ok(Math.abs(small.max - big.max) < 1e-6, 'same health');
  assert.ok(big.speed < small.speed, 'more chalk is slower');
});

test('the more chalk a creature uses, the slower it is; less chalk, faster', () => {
  assert.ok(speedFor(150, C) > speedFor(500, C) && speedFor(500, C) > speedFor(1500, C));
  assert.ok(speedFor(1e9, C) >= C.minSpeed);
  const quick = makeChalklingBookWay(duel(), 'left', stickFigure(0, 0));
  const heavy = makeChalklingBookWay(duel(), 'left', beetle(0, 0));
  assert.ok(quick.speed > heavy.speed);
  assert.equal(heavy.speed, speedFor(measureCreature(heavy.strokes, C).ink, C));
});

test('drawing in the detail screen makes the same creature stronger', () => {
  const normal = makeChalklingBookWay(duel(), 'left', urchin(0, 0));
  const zoomed = makeChalklingBookWay(duel(), 'left', urchin(0, 0), { detail: true });
  assert.equal(zoomed.detailStrokes, zoomed.strokes.length);
  assert.equal(normal.detailStrokes, 0);
  assert.ok(Math.abs(zoomed.detail - normal.detail * C.detailScreenBonus) < 1e-9);
  assert.ok(zoomed.max > normal.max && zoomed.bite > normal.bite);
});

test('the detail screen only takes strokes inside a holding circle', () => {
  const state = duel();
  const r = addStroke(state, 'left', S.line({ x1: 450, y1: 300, x2: 450, y2: 400 }), { detail: true });
  assert.equal(r.accepted, false);
  assert.match(r.result.reason, /detail screen/);
});

test('no limit on how many strokes go into a creature', () => {
  const state = duel();
  const { center, r } = chainAndCircle(state, 'left', 1);
  let accepted = 0;
  for (let i = 0; i < 40; i++) {
    const y = center.y - r * 0.6 + i * ((r * 1.2) / 40);
    if (addStroke(state, 'left', S.line({ x1: center.x - 20, y1: y, x2: center.x + 20, y2: y + 3 }), MAKING).accepted) accepted++;
  }
  assert.equal(accepted, 40);
  assert.equal(state.wards.find((w) => w.holding).creature.length, 40);
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

test('a line clicked with the eraser is gone 3 seconds later, not before', () => {
  const state = duel();
  addStroke(state, 'left', S.line({ x1: 600, y1: 200, x2: 600, y2: 450 }));
  const at = { x: 600, y: 300 };
  assert.equal(erase(state, 'left', at, 2.8).accepted, true);
  assert.equal(state.walls.length, 1, 'still there after 2.8 s');
  run(state, 0.3);
  assert.equal(state.walls.length, 0, 'gone after 3 s');
  assert.ok(state.events.some((e) => e.type === 'erased'));
});

test('clicking empty board with the eraser does nothing', () => {
  const state = duel();
  assert.equal(erase(state, 'left', { x: 600, y: 800 }).accepted, false);
  assert.equal(state.erasing.left, null);
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

test('a chalkling on its path attacks an enemy that comes close, then carries on', () => {
  const state = duel();
  setOrder(state, 'right', 'guard');
  const enemy = makeChalklingBookWay(state, 'right', stickFigure(0, 0), { k: 1 });
  run(state, 6);
  // Our path runs right past the guarding stick figure.
  const goal = { x: enemy.pos.x - 40, y: enemy.pos.y - 260 };
  const ours = makeChalklingBookWay(state, 'left', beetle(0, 0), { k: 1, to: goal });
  let fought = false;
  for (let i = 0; i < 60 * 60 && !state.events.some((e) => e.type === 'pathDone' && e.id === ours.id); i++) {
    run(state, 1 / 60);
    if (ours.action === 'fight') fought = true;
  }
  assert.ok(fought, 'it stopped to fight');
  assert.ok(enemy.gone || !state.chalklings.includes(enemy), 'and won');
  assert.ok(state.events.some((e) => e.type === 'pathDone' && e.id === ours.id), 'then finished its path');
});

test('a waiting chalkling attacks an enemy that comes close', () => {
  const state = duel();
  setOrder(state, 'right', 'guard');
  const prey = makeChalklingBookWay(state, 'right', stickFigure(0, 0), { k: 1 });
  run(state, 6);
  const hunter = makeChalklingBookWay(state, 'left', urchin(0, 0), { k: 1, to: prey.pos });
  run(state, 40);
  assert.equal(hunter.mode, 'waiting');
  // A new enemy walks up to it.
  const visitor = makeChalklingBookWay(state, 'right', stickFigure(0, 0), { k: 3, to: hunter.pos });
  run(state, 40);
  assert.ok(visitor.gone || !state.chalklings.includes(visitor), 'it dealt with the visitor');
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

test('Command: Remote follows the buttons; Always attack / Always guard ignore them', () => {
  const state = duel();
  const remote = makeChalklingBookWay(state, 'left', stickFigure(0, 0), { k: 1 });
  const attacker = makeChalklingBookWay(state, 'left', stickFigure(0, 0), { k: 2, control: 'attack' });
  const guard = makeChalklingBookWay(state, 'left', stickFigure(0, 0), { k: 3, control: 'guard' });
  assert.deepEqual([remote.control, attacker.control, guard.control], ['remote', 'attack', 'guard']);
  assert.equal(guard.order, 'guard', 'starts guarding even though the buttons say attack');
  setOrder(state, 'left', 'guard');
  assert.deepEqual([remote.order, attacker.order, guard.order], ['guard', 'attack', 'guard']);
  setOrder(state, 'left', 'attack');
  assert.deepEqual([remote.order, attacker.order, guard.order], ['attack', 'attack', 'guard']);
});

test('an Always guard chalkling guards when its path is done, whatever the buttons say', () => {
  const state = duel();
  const c = makeChalklingBookWay(state, 'left', stickFigure(0, 0), { k: 1, to: { x: 520, y: 640 }, control: 'guard' });
  assert.equal(c.mode, 'path');
  run(state, 8);
  assert.equal(c.mode, 'order');
  assert.equal(c.order, 'guard');
});

test('a made-up command over the network becomes Remote', () => {
  const pts = [{ x: 1, y: 2 }];
  assert.equal(sanitizeAction({ type: 'stroke', points: pts, control: 'guard' }).control, 'guard');
  assert.equal(sanitizeAction({ type: 'stroke', points: pts, control: 'dance' }).control, 'remote');
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
