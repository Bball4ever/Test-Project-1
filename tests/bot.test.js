import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDuel, addStroke, step, mainWard } from '../src/engine/duel.js';
import { applyAction } from '../src/engine/actions.js';
import { BotController } from '../src/controllers/bot.js';
import { CONFIG } from '../src/config.js';
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

test('bots play by the same rules: strokes, erasing and orders only, on their own side', () => {
  const actions = { left: new Set(), right: new Set() };
  const events = [];
  const results = [];
  // A few duels, so there's time for some chalklings to be made.
  for (let seed = 3; seed < 9; seed++) {
    const state = createDuel();
    const bots = {
      left: new BotController({ owner: 'left', level: 'duelist', seed }),
      right: new BotController({ owner: 'right', level: 'professor', seed: seed + 1 }),
    };
    for (let i = 0; i < 60 * 120 && !state.winner; i++) {
      for (const side of ['left', 'right']) {
        bots[side].update(state, (action) => {
          actions[side].add(action.type);
          const r = applyAction(state, side, action);
          results.push(r.result);
          return r;
        });
      }
      step(state);
      events.push(...state.events.splice(0).map((e) => ({ ...e, seed })));
    }
  }
  for (const side of ['left', 'right']) {
    for (const type of actions[side]) assert.ok(['stroke', 'erase', 'order'].includes(type), `${side} used ${type}`);
  }
  assert.ok(!results.some((r) => r?.reason === 'stay on your side'));
  assert.ok(!results.some((r) => /walls at a time/.test(r?.reason ?? '')), 'bots keep to the wall limit');
  // Every chalkling a bot made came out of a holding circle when its chain was rubbed out.
  const born = events.filter((e) => e.type === 'placed' && e.kind === 'chalkling');
  assert.ok(born.length > 0, 'the bots made chalklings the book way');
  for (const e of born) {
    const erased = events.find((x) => x.type === 'erased' && x.kind === 'chain' && x.owner === e.owner && x.tick === e.tick && x.seed === e.seed);
    assert.ok(erased, 'released by erasing a chain');
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
  assert.ok(state.events.some((e) => e.type === 'blocked'), 'the wall stopped the wave');
});

// --- Ten levels ----------------------------------------------------------------

const LEVELS = Object.keys(CONFIG.bot.levels);

test('there are ten bot levels, and each one beats the level below it', () => {
  assert.equal(LEVELS.length, 10);
  for (let i = 1; i < LEVELS.length; i++) {
    let won = 0;
    for (let seed = 1; seed <= 6; seed++) {
      if (botDuel(LEVELS[i], LEVELS[i - 1], seed).state.winner === 'left') won++;
      if (botDuel(LEVELS[i - 1], LEVELS[i], seed + 50).state.winner === 'right') won++;
    }
    assert.ok(won >= 7, `${LEVELS[i]} won only ${won} of 12 against ${LEVELS[i - 1]}`);
  }
});

test('bots from Apprentice up give their chalklings powers; the first two levels never do', () => {
  const powersOf = (level) => {
    const seen = new Set();
    for (let seed = 1; seed <= 6; seed++) {
      for (const e of botDuel(level, level, seed).placed) if (e.kind === 'chalkling' && e.owner === 'left') seen.add(e.powers?.length ? e.powers.join('+') : 'none');
    }
    return seen;
  };
  for (const level of ['beginner', 'student']) assert.ok([...powersOf(level)].every((p) => p === 'none'), level);
  const smart = powersOf('grandmaster');
  assert.ok(!smart.has('none') && smart.size >= 2, [...smart].join(','));
});

test('a Master stops drawing a chalkling to block a wave, then finishes the chalkling', () => {
  const state = createDuel();
  const bot = new BotController({ owner: 'right', level: 'master', seed: 9 });
  const act = (action) => applyAction(state, 'right', action);
  addStroke(state, 'left', S.circle({ cx: 350, cy: 450, r: 110, noise: 1 }));
  // Run until it's in the middle of drawing a chalkling's creature.
  let i = 0;
  for (; i < 60 * 60; i++) {
    bot.update(state, act);
    step(state);
    if (state.wards.some((w) => w.owner === 'right' && w.holding && w.creature.length)) break;
  }
  assert.ok(i < 60 * 60, 'it started a chalkling');
  const wallsBefore = state.walls.filter((w) => w.owner === 'right').length;
  const born = state.chalklings.filter((c) => c.owner === 'right').length;
  const target = mainWard(state, 'right').center;
  addStroke(state, 'left', S.wave({ x: 120, y: target.y - 40, length: 160, amplitude: 16, angle: 0, seed: 4 }));
  for (let k = 0; k < 60 * 12; k++) {
    bot.update(state, act);
    step(state);
  }
  assert.ok(state.walls.filter((w) => w.owner === 'right').length > wallsBefore, 'drew a wall');
  assert.ok(state.chalklings.filter((c) => c.owner === 'right').length > born, 'and still finished the chalkling');
});
