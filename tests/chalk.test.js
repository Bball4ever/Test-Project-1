import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDuel, addStroke, step } from '../src/engine/duel.js';
import { pathLength } from '../src/recognizer/clean.js';
import { CONFIG } from '../src/config.js';
import * as S from './fixtures/strokes.js';

test('each duelist starts with the same supply of chalk', () => {
  const state = createDuel();
  assert.deepEqual(state.chalk, { left: CONFIG.chalk.supply, right: CONFIG.chalk.supply });
});

test('a stroke uses chalk equal to its length, even if it fails', () => {
  const state = createDuel();
  const circle = S.circle({ cx: 350, cy: 450, r: 110, noise: 1 });
  addStroke(state, 'left', circle);
  const after = CONFIG.chalk.supply - pathLength(circle);
  assert.ok(Math.abs(state.chalk.left - after) < 1e-6);
  const scribble = S.scribble({ x: 400, y: 200 });
  assert.equal(addStroke(state, 'left', scribble).result.type, 'dud');
  assert.ok(Math.abs(state.chalk.left - (after - pathLength(scribble))) < 1e-6, 'the dud cost chalk too');
  assert.equal(state.chalk.right, CONFIG.chalk.supply, "the other side's chalk is untouched");
});

test("you can't draw with chalk you don't have", () => {
  const state = createDuel({ chalk: 1000 });
  addStroke(state, 'left', S.circle({ cx: 350, cy: 450, r: 110, noise: 1 })); // about 700
  const left = state.chalk.left;
  const wave = S.wave({ x: 500, y: 450, length: 250, amplitude: 25 }); // about 400
  const r = addStroke(state, 'left', wave);
  assert.equal(r.accepted, false);
  assert.equal(r.result.reason, 'out of chalk');
  assert.equal(state.chalk.left, left, 'a refused stroke costs nothing');
  assert.equal(state.vigors.length, 0);
});

test('spamming runs out: endless waves stop working', () => {
  const state = createDuel();
  addStroke(state, 'left', S.circle({ cx: 350, cy: 450, r: 110, noise: 1 }));
  let accepted = 0;
  for (let i = 0; i < 100; i++) {
    if (addStroke(state, 'left', S.wave({ x: 500, y: 450, length: 200, amplitude: 20, seed: i + 1 })).accepted) accepted++;
  }
  assert.ok(accepted < 30, `only so many waves fit in the supply (got ${accepted})`);
  assert.ok(state.chalk.left < CONFIG.chalk.tooLittle + 400);
});

test('if both sides are out of chalk and nothing is moving, the duel is a draw', () => {
  const state = createDuel({ chalk: 1200 });
  addStroke(state, 'left', S.circle({ cx: 350, cy: 450, r: 110, noise: 1 }));
  addStroke(state, 'right', S.circle({ cx: 1250, cy: 450, r: 110, noise: 1 }));
  step(state);
  assert.equal(state.winner, null, 'they still have a little chalk');
  state.chalk.left = 10;
  state.chalk.right = 10;
  step(state);
  assert.equal(state.winner, 'draw');
  assert.ok(state.events.some((e) => e.type === 'draw'));
});
