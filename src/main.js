// Wires the pieces together:
//   controllers (you, the dummy) → engine (rules) → renderer (pictures).

import { CONFIG } from './config.js';
import { createDuel, addStroke, step, mainWard } from './engine/duel.js';
import { HumanController } from './controllers/human.js';
import { DummyController } from './controllers/dummy.js';
import { Board } from './render/board.js';
import { DuelRenderer } from './render/duel.js';
import { drawDuelDebug, debugPanelText } from './render/debug.js';

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const board = new Board(canvas);
const renderer = new DuelRenderer(board);

let state = null; // the engine's duel state (null before the first Start)
let dummy = null;
let dummyLive = null; // the part of its circle the dummy has drawn so far
let dummyStyle = 'neat';
let lastStroke = null; // for the debug panel and "Save stroke"
let wavesThrown = 0;
let endShown = false;
let debug = false;

const human = new HumanController(canvas, {
  owner: 'left',
  toWorld: (x, y) => board.toWorld(x, y),
  onStroke(stroke) {
    if (!state || state.winner) return;
    const { accepted, result } = addStroke(state, 'left', stroke.points);
    if (!result) return;
    lastStroke = { result, pointerType: stroke.pointerType, raw: stroke.points };
    if (accepted && result.type === 'vigor') wavesThrown++;
  },
});

function startDuel() {
  state = createDuel();
  dummy = new DummyController({ owner: 'right', style: dummyStyle });
  dummyLive = null;
  renderer.reset();
  human.cancelAll();
  wavesThrown = 0;
  endShown = false;
  lastStroke = null;
  accumulator = 0;
  $('start').hidden = true;
  $('end').hidden = true;
}

function showEnd() {
  endShown = true;
  const won = state.winner === 'left';
  $('end-title').textContent = won ? 'Breach! You win.' : 'You were breached.';
  const secs = (state.timeMs / 1000).toFixed(1);
  $('end-stats').textContent = `${secs} seconds, ${wavesThrown} Line${wavesThrown === 1 ? '' : 's'} of Vigor thrown. Dummy's circle: ${dummyStyle}.`;
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

  if (state) {
    accumulator += elapsed;
    while (accumulator >= CONFIG.engine.stepMs) {
      dummyLive = dummy.update(state);
      step(state);
      accumulator -= CONFIG.engine.stepMs;
    }
    for (const e of state.events.splice(0)) {
      renderer.handleEvent(e, state, now);
      if (e.type === 'breach') breachAt = now;
    }
    if (state.winner && !endShown && now - breachAt > 1400) showEnd();
  }

  board.beginFrame();
  if (state) {
    const live = human.liveStrokes();
    if (dummyLive) live.push(dummyLive);
    renderer.draw(state, live, now);
    if (debug) drawDuelDebug(board.ctx, state);
  }
  updateHud();
  requestAnimationFrame(frame);
}

function updateHud() {
  let hint = 'Choose a dummy and press Start.';
  if (state?.winner) hint = 'The duel is over.';
  else if (state) {
    hint = mainWard(state, 'left')
      ? 'Attack with waves (Vigor). Straight lines (Forbiddance) make walls that waves bounce off.'
      : 'Draw your main circle on the left half.';
  }
  if ($('hint').textContent !== hint) $('hint').textContent = hint;
  if (debug) $('debug-panel').textContent = debugPanelText(lastStroke, state);
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
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === 'd') toggleDebug();
  else if (key === 's') saveStroke();
});
$('btn-debug').addEventListener('click', toggleDebug);
$('btn-save').addEventListener('click', saveStroke);
$('btn-start').addEventListener('click', startDuel);
$('btn-rematch').addEventListener('click', startDuel);
$('btn-change').addEventListener('click', () => {
  $('end').hidden = true;
  $('start').hidden = false;
});
for (const pick of document.querySelectorAll('[data-style]')) {
  pick.addEventListener('click', () => {
    dummyStyle = pick.dataset.style;
    for (const p of document.querySelectorAll('[data-style]')) p.classList.toggle('selected', p === pick);
  });
}

requestAnimationFrame(frame);
