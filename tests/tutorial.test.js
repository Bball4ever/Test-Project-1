import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDuel, step, mainWard } from '../src/engine/duel.js';
import { applyAction } from '../src/engine/actions.js';
import { damageSection } from '../src/engine/damage.js';
import { DummyController } from '../src/controllers/dummy.js';
import { Tutorial } from '../src/tutorial.js';
import * as S from './fixtures/strokes.js';

// The tutorial's board, as main.js sets it up, with a stand-in for its buttons.
function setup({ split = true } = {}) {
  const state = createDuel({ circleDeadlineMs: Infinity, chalk: Infinity });
  const dummy = new DummyController({ owner: 'right' });
  const seat = { making: false, eraser: false };
  const ui = { detail: null };
  const api = () => ({
    state,
    seat,
    split,
    detailShown: ui.detail !== null,
    now: state.timeMs,
    act: (action) => applyAction(state, 'left', action),
    dummyAct: (action) => applyAction(state, 'right', action),
    setMaking: (on) => (seat.making = on),
    pickDetail: (id) => (ui.detail = id ?? null),
    eraseAt: (at) => applyAction(state, 'left', { type: 'erase', at }),
  });
  const tutorial = new Tutorial();
  // Run the game for `seconds`, as the page does: engine steps, then the tutorial.
  const run = (seconds) => {
    for (let i = 0; i < seconds * 60 && !tutorial.finished; i++) {
      dummy.update(state, (a) => applyAction(state, 'right', a));
      step(state);
      for (const e of state.events.splice(0)) tutorial.onEvent(e, api());
      tutorial.update(api());
    }
  };
  run(2.5); // the dummy draws its circle
  tutorial.start(api());
  return { state, tutorial, api, run };
}

test('tutorial: pressing Skip on every step goes through all 7 lessons to a breached dummy', () => {
  for (const split of [true, false]) {
    const { state, tutorial, api, run } = setup({ split });
    const groups = new Set();
    for (let n = 0; n < 30 && !tutorial.finished; n++) {
      groups.add(tutorial.card(api()).number);
      tutorial.skip(api());
      run(4);
    }
    assert.ok(tutorial.finished, `${split ? 'split screen' : 'one board'}: finished`);
    assert.deepEqual([...groups].sort(), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(state.winner, 'left', 'the last step is a real breach');
  }
});

test("tutorial: on one board there's no detail screen step", () => {
  const { tutorial, api, run } = setup({ split: false });
  const texts = [];
  for (let n = 0; n < 30 && !tutorial.finished; n++) {
    texts.push(tutorial.card(api()).text);
    tutorial.skip(api());
    run(4);
  }
  assert.ok(!texts.some((t) => t.includes('Press <b>Detail</b>')));
});

test('tutorial: doing the steps yourself moves it on; a bad stroke is explained', () => {
  const { state, tutorial, api, run } = setup();
  const home = state.homes.left;
  applyAction(state, 'left', { type: 'stroke', points: S.circle({ cx: home.x, cy: home.y, r: 120, noise: 1 }) });
  run(1);
  assert.equal(tutorial.card(api()).title, 'Walls');
  assert.match(tutorial.card(api()).feedback, /scored \d+%/);
  // A scribble isn't a wall.
  const scribble = Array.from({ length: 40 }, (_, i) => ({ x: home.x + 170 + 30 * Math.sin(i * 1.7), y: home.y - 60 + i * 3 + 25 * Math.cos(i * 2.3) }));
  applyAction(state, 'left', { type: 'stroke', points: scribble });
  run(0.2);
  assert.equal(tutorial.card(api()).title, 'Walls', 'still on the same step');
  assert.match(tutorial.card(api()).feedback, /didn't count/);
});

test("tutorial: nobody's circle can break before the last step", () => {
  const { state, tutorial, api, run } = setup();
  tutorial.skip(api()); // your circle
  run(1);
  for (const id of ['left', 'right']) {
    const w = mainWard(state, id);
    damageSection(state, w, 0, w.sections[0].max * 0.9, w.center);
  }
  run(0.1);
  assert.equal(state.winner, null);
  for (const id of ['left', 'right']) assert.equal(mainWard(state, id).sections[0].health, mainWard(state, id).sections[0].max, `${id} healed`);
});

test("tutorial: the dummy's wave comes again if it gets through, and a wall in its path finishes the step", () => {
  const { state, tutorial, api, run } = setup();
  for (let i = 0; i < 3; i++) {
    tutorial.skip(api());
    run(2);
  }
  assert.equal(tutorial.card(api()).title, 'Blocking');
  run(10); // do nothing: it gets through
  assert.match(tutorial.card(api()).text, /It got through/);
  assert.equal(tutorial.card(api()).title, 'Blocking');
  const c = mainWard(state, 'left');
  const x = c.center.x + c.radius + 70;
  applyAction(state, 'left', { type: 'stroke', points: S.line({ x1: x, y1: c.center.y - 90, x2: x, y2: c.center.y + 90 }) });
  run(10);
  assert.equal(tutorial.card(api()).title, 'Making a chalkling');
});
