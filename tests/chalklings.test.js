import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDuel, addStroke, addChalkling, setOrder, step, mainWard } from '../src/engine/duel.js';
import { measureCreature } from '../src/engine/chalklings.js';
import { stickFigure, beetle, mirror } from '../src/data/creatures.js';
import { dummyCirclePoints } from '../src/controllers/dummy.js';
import { CONFIG } from '../src/config.js';
import * as S from './fixtures/strokes.js';

const C = CONFIG.chalkling;

function duel() {
  const state = createDuel();
  addStroke(state, 'left', S.circle({ cx: 300, cy: 450, r: 110, noise: 1 }));
  addStroke(state, 'right', S.circle({ cx: 1300, cy: 450, r: 110, noise: 1 }));
  return state;
}

function runUntil(state, done, maxSeconds) {
  const max = (maxSeconds * 1000) / state.cfg.stepMs;
  for (let i = 0; i < max && !done(); i++) step(state);
}

test('more detail makes a stronger, slower chalkling', () => {
  const stick = measureCreature(stickFigure(0, 0), C);
  const bug = measureCreature(beetle(0, 0), C);
  assert.equal(stick.closed, 1);
  assert.ok(bug.closed >= 4);
  assert.ok(bug.detail > stick.detail * 2);
  const state = duel();
  addChalkling(state, 'left', stickFigure(520, 300));
  addChalkling(state, 'left', beetle(520, 600));
  const [s, b] = state.chalklings;
  assert.ok(b.hp > s.hp && b.bite > s.bite && b.speed < s.speed);
});

test('chalklings need a main circle, enough chalk, your own side, and to be outside your circle', () => {
  const state = createDuel();
  assert.equal(addChalkling(state, 'left', stickFigure(500, 450)).result.reason, 'draw your circle first');
  addStroke(state, 'left', S.circle({ cx: 300, cy: 450, r: 110 }));
  const tiny = [S.line({ x1: 500, y1: 500, x2: 520, y2: 500 })];
  assert.equal(addChalkling(state, 'left', tiny).result.reason, 'too little chalk to come alive');
  assert.equal(addChalkling(state, 'left', stickFigure(900, 450)).result.reason, 'stay on your side');
  assert.equal(addChalkling(state, 'left', stickFigure(300, 450)).result.reason, 'draw it outside your circle');
  assert.equal(addChalkling(state, 'left', stickFigure(550, 450)).accepted, true);
});

test('a duel can be won with chalklings alone', () => {
  const state = createDuel();
  addStroke(state, 'left', S.circle({ cx: 300, cy: 450, r: 110, noise: 1 }));
  addStroke(state, 'right', dummyCirclePoints('neat'));
  addChalkling(state, 'left', beetle(520, 300));
  addChalkling(state, 'left', stickFigure(520, 600));
  runUntil(state, () => state.winner, 120);
  assert.equal(state.winner, 'left');
  assert.ok(state.events.some((e) => e.type === 'breach' && e.owner === 'right'));
});

test('a detailed chalkling beats a stick figure', () => {
  for (const [y1, y2] of [[450, 450], [400, 500]]) {
    const state = duel();
    addChalkling(state, 'left', beetle(600, y1));
    addChalkling(state, 'right', mirror(stickFigure(1000, y2), 1000));
    runUntil(state, () => state.chalklings.length < 2, 30);
    assert.equal(state.chalklings.length, 1);
    assert.equal(state.chalklings[0].owner, 'left');
  }
});

test('any Line of Forbiddance blocks chalklings; enemy walls get chewed through', () => {
  // Own wall: the chalkling can't pass and doesn't damage it.
  const own = duel();
  addStroke(own, 'left', S.line({ x1: 650, y1: 50, x2: 650, y2: 850 }));
  addChalkling(own, 'left', stickFigure(560, 450));
  runUntil(own, () => false, 15);
  assert.ok(own.chalklings[0].pos.x < 650, 'stopped by its own wall');
  assert.equal(own.walls[0].health, own.walls[0].max, 'own wall is not chewed');

  // Enemy wall: chewed until it breaks.
  const enemy = duel();
  addStroke(enemy, 'right', S.line({ x1: 950, y1: 50, x2: 950, y2: 850 }));
  addChalkling(enemy, 'left', beetle(600, 450));
  runUntil(enemy, () => enemy.walls.length === 0, 60);
  assert.equal(enemy.walls.length, 0, 'enemy wall chewed through');
  assert.ok(enemy.events.some((e) => e.type === 'wallBroken'));
});

test('a Line of Vigor can destroy a chalkling', () => {
  const state = duel();
  addChalkling(state, 'right', mirror(stickFigure(900, 450), 900));
  setOrder(state, 'right', 'guard'); // keep it still-ish near its circle
  const hp = state.chalklings[0].hp;
  let shots = 0;
  while (state.chalklings.length && shots < 6) {
    const target = state.chalklings[0].pos;
    addStroke(state, 'left', S.wave({ x: 500, y: target.y, length: 180, amplitude: 16, seed: ++shots }));
    runUntil(state, () => false, 1.5);
  }
  assert.equal(state.chalklings.length, 0, `still alive after ${shots} waves (hp ${hp})`);
  assert.ok(state.events.some((e) => e.type === 'chalklingDied'));
});

test('guards stay home and intercept attackers', () => {
  const state = duel();
  addChalkling(state, 'left', beetle(560, 300));
  setOrder(state, 'left', 'guard');
  runUntil(state, () => false, 8);
  const guard = state.chalklings[0];
  const home = mainWard(state, 'left');
  assert.ok(Math.hypot(guard.pos.x - home.center.x, guard.pos.y - home.center.y) < home.radius + C.guardDistance + 20);
  addChalkling(state, 'right', mirror(stickFigure(1000, 450), 1000));
  runUntil(state, () => state.chalklings.length < 2, 40);
  assert.equal(state.chalklings.length, 1);
  assert.equal(state.chalklings[0].owner, 'left', 'the guard won');
  assert.ok(home.sections.every((s) => s.health === s.max), 'home circle untouched');
});

test('chalkling duels are deterministic', () => {
  const play = () => {
    const state = duel();
    addChalkling(state, 'left', beetle(600, 300));
    addChalkling(state, 'left', stickFigure(600, 650));
    addChalkling(state, 'right', mirror(beetle(1000, 500), 1000));
    runUntil(state, () => state.winner, 40);
    const { cfg, chalkCfg, ...rest } = state;
    return JSON.stringify(rest);
  };
  assert.equal(play(), play());
});
