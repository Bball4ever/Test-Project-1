import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDuel, addStroke, step, mainWard } from '../src/engine/duel.js';
import { applyAction } from '../src/engine/actions.js';
import { BotController } from '../src/controllers/bot.js';
import * as S from './fixtures/strokes.js';

// Run a duel between two bots. Every action goes through applyAction, exactly
// like a person's would, and we record what happened to each one.
function botDuel(leftLevel, rightLevel, seed, maxSeconds = 180) {
  const state = createDuel();
  const bots = {
    left: new BotController({ owner: 'left', level: leftLevel, seed: seed * 2 + 1 }),
    right: new BotController({ owner: 'right', level: rightLevel, seed: seed * 2 + 2 }),
  };
  const results = { left: [], right: [] };
  const placed = [];
  for (let i = 0; i < maxSeconds * 60 && !state.winner; i++) {
    for (const side of ['left', 'right']) {
      bots[side].update(state, (action) => {
        const r = applyAction(state, side, action);
        results[side].push(r.result);
        return r;
      });
    }
    step(state);
    placed.push(...state.events.filter((e) => e.type === 'placed'));
    state.events.length = 0;
  }
  return { state, results, placed };
}

function wins(left, right, n = 8) {
  let count = 0;
  for (let seed = 1; seed <= n; seed++) if (botDuel(left, right, seed).state.winner === 'left') count++;
  return count;
}

test('professor beats student', () => {
  assert.ok(wins('professor', 'student') >= 6);
  assert.ok(wins('student', 'professor') <= 2);
});

test('duelist beats student', () => {
  assert.ok(wins('duelist', 'student') >= 5);
});

test('professor beats duelist more often than not', () => {
  assert.ok(wins('professor', 'duelist') >= 5);
});

test('bots only create lines through the recognizer, and stay on their side', () => {
  const { results, placed } = botDuel('duelist', 'student', 3);
  for (const side of ['left', 'right']) {
    const accepted = results[side].filter((r) => r && r.type !== 'dud').length;
    const madeBySide = placed.filter((e) => e.owner === side).length;
    assert.equal(madeBySide, accepted, `${side}: everything on the board came from a scored stroke`);
    assert.ok(!results[side].some((r) => r?.reason === 'stay on your side'));
  }
});

test("a student's shaky hand draws weaker lines than a professor's", () => {
  const quality = (level) => {
    let total = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const { state } = botDuel(level, 'student', seed, 3);
      total += mainWard(state, 'left')?.quality ?? 0;
    }
    return total / 5;
  };
  assert.ok(quality('student') < quality('professor') - 0.1);
});

test('a professor walls off an incoming Vigor', () => {
  const state = createDuel();
  const bot = new BotController({ owner: 'right', level: 'professor', seed: 9 });
  const act = (action) => applyAction(state, 'right', action);
  addStroke(state, 'left', S.circle({ cx: 350, cy: 450, r: 110, noise: 1 }));
  // Let the bot draw its circle and its defense.
  for (let i = 0; i < 60 * 8; i++) {
    bot.update(state, act);
    step(state);
  }
  const wallsBefore = state.walls.filter((w) => w.owner === 'right').length;
  state.events.length = 0;
  // Throw a wave at it from far away so there's time to react.
  const target = mainWard(state, 'right').center;
  addStroke(state, 'left', S.wave({ x: 120, y: target.y + 60, length: 160, amplitude: 16, angle: -0.05, seed: 4 }));
  for (let i = 0; i < 60 * 3; i++) {
    bot.update(state, act);
    step(state);
  }
  assert.ok(state.walls.filter((w) => w.owner === 'right').length > wallsBefore, 'drew a wall');
  assert.ok(state.events.some((e) => e.type === 'bounce'), 'the wave bounced off it');
});
