// Wires the pieces together:
//   controllers (you, the dummy, a bot...) → engine (rules) → renderer (pictures).
//
// Each side of the board is a "seat". A seat is filled by a human (using the
// pointer), the practice dummy, or a bot. The engine doesn't know or care which.

import { CONFIG } from './config.js';
import { createDuel, step, mainWard, SIDES } from './engine/duel.js';
import { applyAction } from './engine/actions.js';
import { HumanController } from './controllers/human.js';
import { DummyController } from './controllers/dummy.js';
import { BotController } from './controllers/bot.js';
import { MakingDraft } from './controllers/making.js';
import { Board } from './render/board.js';
import { DuelRenderer } from './render/duel.js';
import { drawDuelDebug, debugPanelText } from './render/debug.js';
import { DEFENSES, findDefense, layoutDefense, tracedParts } from './data/defenses.js';

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const board = new Board(canvas);
const renderer = new DuelRenderer(board);

// Choices from the start screen.
const choices = { mode: 'dummy', dummy: 'neat', level: 'duelist', bind: '4', template: '' };
// Where the practice template sits until you draw your own main circle.
const TEMPLATE_HOME = { center: { x: 380, y: 450 }, radius: 140 };

let session = null; // { state, seats: { left, right } } while a duel is on
let lastStroke = null; // for the debug panel and "Save stroke"
let endShown = false;
let debug = false;

function makeSeat(kind, controller = null) {
  return { kind, controller, live: null, making: false, draft: new MakingDraft(), waves: 0 };
}

// --- Input ---------------------------------------------------------------------

const human = new HumanController(canvas, {
  toWorld: (x, y) => board.toWorld(x, y),
  // Which side does a new stroke belong to? The human's side, or on a shared
  // screen, whichever half the stroke starts in.
  owner(point) {
    if (!session || session.state.winner) return null;
    const humans = SIDES.filter((s) => session.seats[s].kind === 'human');
    if (humans.length === 1) return humans[0];
    return point.x < CONFIG.engine.world.width / 2 ? 'left' : 'right';
  },
  onStroke(stroke) {
    if (!session || session.state.winner) return;
    const seat = session.seats[stroke.owner];
    if (seat.making) {
      seat.draft.add(stroke.points, performance.now());
      return;
    }
    const { accepted, result } = act(stroke.owner, { type: 'stroke', points: stroke.points });
    if (result) lastStroke = { result, pointerType: stroke.pointerType, raw: stroke.points };
    if (accepted && result.type === 'vigor') seat.waves++;
  },
});

// Every action, from any seat, goes through here.
function act(side, action) {
  return applyAction(session.state, side, action);
}

// --- Starting and ending ---------------------------------------------------------

function startDuel() {
  const state = createDuel({ bindPoints: { left: Number(choices.bind) } });
  session = {
    state,
    seats: {
      left: makeSeat('human'),
      right: opponentSeat(),
    },
  };
  renderer.reset();
  human.cancelAll();
  endShown = false;
  lastStroke = null;
  accumulator = 0;
  breachAt = null;
  $('start').hidden = true;
  $('end').hidden = true;
  updateControls();
}

function opponentSeat() {
  if (choices.mode === 'bot') {
    const seed = Math.floor(Math.random() * 1e9);
    return makeSeat('bot', new BotController({ owner: 'right', level: choices.level, seed }));
  }
  return makeSeat('dummy', new DummyController({ owner: 'right', style: choices.dummy }));
}

function opponentName() {
  if (choices.mode === 'bot') return `the ${choices.level} bot`;
  return `the ${choices.dummy} dummy`;
}

function showEnd() {
  endShown = true;
  const { state, seats } = session;
  const won = state.winner === 'left';
  $('end-title').textContent = won ? 'Breach! You win.' : 'You were breached.';
  const secs = (state.timeMs / 1000).toFixed(1);
  const waves = seats.left.waves;
  $('end-stats').textContent = `${secs} seconds against ${opponentName()}. You threw ${waves} Line${waves === 1 ? '' : 's'} of Vigor.`;
  $('end').hidden = false;
}

// --- The game loop -------------------------------------------------------------
// The engine moves in fixed steps (1/60 s). Each frame we work out how much real
// time has passed and run that many steps, so the duel runs at the same speed on
// a slow Chromebook and a fast PC. Then we draw whatever the state is now.

let accumulator = 0;
let lastTime = performance.now();
let breachAt = null;

function frame(now) {
  const elapsed = Math.min(250, now - lastTime); // after a pause, don't try to catch up forever
  lastTime = now;

  if (session) {
    const { state, seats } = session;
    accumulator += elapsed;
    while (accumulator >= CONFIG.engine.stepMs) {
      for (const side of SIDES) {
        const seat = seats[side];
        if (seat.controller) seat.live = seat.controller.update(state, (action) => act(side, action));
      }
      step(state);
      accumulator -= CONFIG.engine.stepMs;
    }
    releaseFinishedChalklings(now);
    for (const e of state.events.splice(0)) {
      renderer.handleEvent(e, state, now);
      if (e.type === 'breach') breachAt = now;
    }
    if (state.winner && !endShown && now - breachAt > 1400) showEnd();
  }

  board.beginFrame();
  if (session) {
    const { state, seats } = session;
    const live = human.liveStrokes().map((s) => ({ ...s, making: seats[s.owner].making }));
    const drafts = [];
    for (const side of SIDES) {
      const seatLive = seats[side].live;
      if (seatLive) live.push(seatLive);
      if (seatLive?.draft?.length) drafts.push(seatLive.draft);
      if (seats[side].draft.strokes.length) drafts.push(seats[side].draft.strokes);
    }
    renderer.draw(state, live, now, practiceTemplate(), drafts);
    if (debug) drawDuelDebug(board.ctx, state);
  }
  updateHud();
  requestAnimationFrame(frame);
}

// In Making mode, a creature comes alive once its artist pauses.
function releaseFinishedChalklings(now) {
  for (const side of SIDES) {
    const seat = session.seats[side];
    if (seat.kind !== 'human') continue;
    const drawing = human.liveStrokes().some((s) => s.owner === side);
    const strokes = seat.draft.takeIfIdle(now, drawing);
    if (strokes) releaseChalkling(side, strokes);
  }
}

function releaseChalkling(side, strokes) {
  const { result } = act(side, { type: 'chalkling', strokes });
  if (result) lastStroke = { result, pointerType: 'making', raw: strokes.flat() };
}

// --- Making mode and orders ------------------------------------------------------

function toggleMaking(side) {
  if (!session) return;
  const seat = session.seats[side];
  if (seat?.kind !== 'human') return;
  seat.making = !seat.making;
  if (!seat.making) {
    const strokes = seat.draft.take();
    if (strokes) releaseChalkling(side, strokes);
  }
  updateControls();
}

function giveOrder(side, order) {
  if (!session || session.seats[side]?.kind !== 'human') return;
  act(side, { type: 'order', order });
  updateControls();
}

// The human's side for keyboard shortcuts (on a shared screen, the left player).
function keyboardSide() {
  return session && SIDES.find((s) => session.seats[s].kind === 'human');
}

function updateControls() {
  for (const box of document.querySelectorAll('.side-controls')) {
    const side = box.dataset.side;
    const seat = session?.seats[side];
    box.hidden = !seat || seat.kind !== 'human';
    if (box.hidden) continue;
    box.querySelector('[data-act="making"]').classList.toggle('selected', seat.making);
    for (const order of ['attack', 'guard']) {
      box.querySelector(`[data-act="${order}"]`).classList.toggle('selected', session.state.orders[side] === order);
    }
  }
}

// --- Practice template -----------------------------------------------------------

// The faint defense to trace, placed around your real circle once you've drawn it.
function practiceTemplate() {
  const defense = choices.template && findDefense(choices.template);
  if (!defense?.parts || session.seats.left.kind !== 'human') return null;
  const { state } = session;
  const main = mainWard(state, 'left');
  const anchor = main ? { center: main.center, radius: main.radius } : TEMPLATE_HOME;
  const parts = layoutDefense(defense, anchor, 'left');
  return { parts, anchor, showMain: !main, done: tracedParts(parts, state.wards, state.walls, anchor.radius) };
}

// --- Heads-up display --------------------------------------------------------------

function updateHud() {
  let hint = 'Choose your duel and press Start.';
  if (session?.state.winner) hint = 'The duel is over.';
  else if (session) hint = duelHint();
  if ($('hint').textContent !== hint) $('hint').textContent = hint;
  if (debug) $('debug-panel').textContent = debugPanelText(lastStroke, session?.state);
}

function duelHint() {
  const { state, seats } = session;
  const side = keyboardSide();
  if (seats[side].making) return 'Making mode: draw a creature. It comes alive when you pause. More detail = stronger.';
  const template = practiceTemplate();
  const main = mainWard(state, side);
  if (template && main) {
    const n = template.done.filter(Boolean).length;
    return n < template.parts.length
      ? `Trace the faint ${findDefense(choices.template).name}: ${n} of ${template.parts.length} parts done. Bind points are the green ticks.`
      : 'Defense complete! Now attack.';
  }
  if (template) return 'Trace the faint circle first: it becomes your main circle.';
  if (!main) return `Draw your main circle on the ${side} half.`;
  return 'Waves attack, straight lines make walls, Making mode (M) draws chalklings. Green ticks are bind points.';
}

// --- Keys and buttons ----------------------------------------------------------

function toggleDebug() {
  debug = !debug;
  $('debug-panel').hidden = !debug;
}

// Copy the last stroke as JSON, ready to paste into tests/fixtures/recorded.json.
async function saveStroke() {
  if (!lastStroke) return showToast('Draw something first');
  const r = lastStroke.result;
  const record = {
    expect: r.type === 'dud' && r.guess ? r.guess : r.type,
    device: lastStroke.pointerType,
    note: r.reason ?? `quality ${r.quality.toFixed(2)}`,
    points: lastStroke.raw.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]),
  };
  const json = JSON.stringify(record);
  console.log(json);
  try {
    await navigator.clipboard.writeText(json);
    showToast('Stroke copied. If the game named it wrong, say what you meant to draw.');
  } catch {
    showToast("Couldn't copy. The stroke is in the browser console (Ctrl+Shift+J).");
  }
}

let toastTimer;
function showToast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 3500);
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.tagName === 'INPUT') return;
  const key = e.key.toLowerCase();
  const side = keyboardSide();
  if (key === 'd') toggleDebug();
  else if (key === 's') saveStroke();
  else if (key === 'm') toggleMaking(side);
  else if (key === 'a') giveOrder(side, 'attack');
  else if (key === 'g') giveOrder(side, 'guard');
});
$('btn-debug').addEventListener('click', toggleDebug);
$('btn-save').addEventListener('click', saveStroke);
$('btn-start').addEventListener('click', startDuel);
$('btn-rematch').addEventListener('click', startDuel);
$('btn-change').addEventListener('click', () => {
  $('end').hidden = true;
  $('start').hidden = false;
});
for (const box of document.querySelectorAll('.side-controls')) {
  const side = box.dataset.side;
  box.querySelector('[data-act="making"]').addEventListener('click', () => toggleMaking(side));
  box.querySelector('[data-act="attack"]').addEventListener('click', () => giveOrder(side, 'attack'));
  box.querySelector('[data-act="guard"]').addEventListener('click', () => giveOrder(side, 'guard'));
}

// Start-screen choices: one button per option, grouped by data-group.
for (const d of DEFENSES) {
  const b = document.createElement('button');
  b.className = 'pick';
  b.dataset.group = 'template';
  b.dataset.value = d.id;
  b.textContent = d.parts ? d.name : `${d.name} (needs layout)`;
  b.title = d.note ?? '';
  b.disabled = !d.parts;
  $('template-choices').append(b);
}
// Rows like "Bot level" only show for the opponent they belong to.
function showChoiceRows() {
  for (const row of document.querySelectorAll('[data-show]')) row.hidden = !row.dataset.show.split(' ').includes(choices.mode);
}
for (const pick of document.querySelectorAll('.pick')) {
  pick.addEventListener('click', () => {
    const group = pick.dataset.group;
    choices[group] = pick.dataset.value;
    for (const p of document.querySelectorAll(`.pick[data-group="${group}"]`)) p.classList.toggle('selected', p === pick);
    showChoiceRows();
    // A defense needs a particular circle type.
    const defense = group === 'template' && findDefense(pick.dataset.value);
    if (defense?.bindPoints) document.querySelector(`.pick[data-group="bind"][data-value="${defense.bindPoints}"]`).click();
  });
}

showChoiceRows();
updateControls();
requestAnimationFrame(frame);
