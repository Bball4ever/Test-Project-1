// Wires the pieces together: input → recognizer → what's on the board → renderer.
//
// Milestone 1 has no duel engine yet, so the "state" is just a list of drawn
// strokes kept here. In milestone 2 the engine takes over that job.

import { CONFIG } from './config.js';
import { recognize } from './recognizer/index.js';
import { HumanController } from './controllers/human.js';
import { Board, drawChalk, cacheChalk } from './render/board.js';
import { drawLabel } from './render/feedback.js';
import { drawDebugShapes, debugPanelText } from './render/debug.js';

const canvas = document.getElementById('board');
const panel = document.getElementById('debug-panel');
const toast = document.getElementById('toast');
const board = new Board(canvas);

const strokes = []; // { raw, pointerType, seed, result, cache, box, bornAt }
let debug = false;

const controller = new HumanController(canvas, {
  onStroke(stroke) {
    const result = recognize(stroke.points);
    const color = result.type === 'dud' ? CONFIG.render.dudColor : CONFIG.render.chalkColor;
    const cache = cacheChalk(stroke.points, stroke.seed, board.dpr, color);
    strokes.push({
      raw: stroke.points,
      pointerType: stroke.pointerType,
      seed: stroke.seed,
      result,
      cache,
      box: { x: cache.x, y: cache.y, w: cache.w, h: cache.h },
      bornAt: performance.now(),
    });
    updatePanel();
  },
});

// --- The render loop ---------------------------------------------------------
// requestAnimationFrame asks the browser to call us right before it next paints
// the screen (about 60 times a second). Each call redraws the whole board.

function frame(now) {
  const ctx = board.ctx;
  board.drawBackground();

  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    let alpha = 1;
    if (s.result.type === 'dud') {
      alpha = 1 - (now - s.bornAt) / CONFIG.render.dudFadeMs;
      if (alpha <= 0) {
        strokes.splice(i, 1);
        continue;
      }
    }
    s.alpha = alpha;
  }

  for (const s of strokes) {
    ctx.save();
    ctx.globalAlpha = s.alpha;
    ctx.drawImage(s.cache.canvas, s.cache.x, s.cache.y, s.cache.w, s.cache.h);
    ctx.restore();
    if (debug) drawDebugShapes(ctx, s, s.alpha);
    drawLabel(ctx, s, s.alpha, board.width);
  }

  for (const live of controller.liveStrokes()) drawChalk(ctx, live.points, live.seed);

  requestAnimationFrame(frame);
}

// --- Keys and buttons --------------------------------------------------------

function toggleDebug() {
  debug = !debug;
  panel.hidden = !debug;
  updatePanel();
}

function updatePanel() {
  if (debug) panel.textContent = debugPanelText(strokes[strokes.length - 1]);
}

function clearBoard() {
  strokes.length = 0;
  updatePanel();
}

// Copy the last stroke as JSON, ready to paste into tests/fixtures/recorded.json.
async function saveStroke() {
  const s = strokes[strokes.length - 1];
  if (!s) return showToast('Draw something first');
  const record = {
    expect: s.result.type,
    device: s.pointerType,
    note: s.result.reason ?? `quality ${s.result.quality.toFixed(2)}`,
    points: s.raw.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]),
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
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 3500);
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === 'd') toggleDebug();
  else if (key === 's') saveStroke();
  else if (key === 'c') clearBoard();
});
document.getElementById('btn-debug').addEventListener('click', toggleDebug);
document.getElementById('btn-save').addEventListener('click', saveStroke);
document.getElementById('btn-clear').addEventListener('click', clearBoard);

requestAnimationFrame(frame);
