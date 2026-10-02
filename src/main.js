// Wires the pieces together:
//   controllers (you, the dummy, a bot, the network) → engine (rules) → renderer (pictures).
//
// Each side of the board is a "seat". A seat is filled by a human (using the
// pointer), the practice dummy, a bot, or a remote player. The engine doesn't
// know or care which.
//
// Modes:
//   dummy   you vs. the practice dummy        (engine runs here)
//   bot     you vs. a bot                     (engine runs here)
//   local   two people on one touchscreen     (engine runs here)
//   online  you vs. someone in another tab    (engine runs on the server)

import { CONFIG } from './config.js';
import { createDuel, step, mainWard, SIDES } from './engine/duel.js';
import { applyAction } from './engine/actions.js';
import { erasableAt } from './engine/erase.js';
import { POWER_NAMES, powerLevel } from './engine/powers.js';
import { pathLength } from './recognizer/clean.js';
import { HumanController } from './controllers/human.js';
import { DummyController } from './controllers/dummy.js';
import { BotController } from './controllers/bot.js';
import { Board } from './render/board.js';
import { DuelRenderer } from './render/duel.js';
import { drawDuelDebug, debugPanelText } from './render/debug.js';
import { DEFENSES, findDefense, layoutDefense, tracedParts } from './data/defenses.js';
import { OnlineClient } from './net/client.js';
import { readSnapshot } from './net/snapshot.js';

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const board = new Board(canvas);
const renderer = new DuelRenderer(board);
const hasTouch = navigator.maxTouchPoints > 0;

// Choices from the start screen.
const choices = { mode: 'dummy', dummy: 'neat', level: 'duelist', bind: '4', template: '' };
// Where the practice template sits until you draw your own main circle.
const TEMPLATE_HOME = { center: { x: 380, y: 450 }, radius: 140 };

// While a duel is on: { mode, state, seats: { left, right }, net?, mySide?, snapAt? }
let session = null;
let net = null; // the online connection, if any
let lastStroke = null; // for the debug panel and "Save stroke"
let lastSentRaw = null; // online: the points of our last stroke, until the server's verdict arrives
let endShown = false;
let debug = false;
let paused = false;
let tryWithoutTouch = false;

function makeSeat(kind, controller = null) {
  return { kind, controller, live: null, eraser: false, making: false, power: null, waves: 0 };
}

// --- Input ---------------------------------------------------------------------

const human = new HumanController(canvas, {
  toWorld: (x, y) => board.toWorld(x, y),
  // Which side does a new stroke belong to? The human's side, or on a shared
  // screen, whichever half the stroke starts in.
  owner(point) {
    if (!session?.state || session.state.winner) return null;
    const humans = SIDES.filter((s) => session.seats[s].kind === 'human');
    if (humans.length === 1) return humans[0];
    return point.x < CONFIG.engine.world.width / 2 ? 'left' : 'right';
  },
  // With the eraser on, a click erases the line under it (after 3 seconds)
  // instead of drawing, and the eraser turns itself off.
  onBegin(stroke) {
    const seat = session.seats[stroke.owner];
    if (!seat.eraser) return;
    stroke.erasing = true; // this press is the eraser, not a stroke
    const at = stroke.points[0];
    if (!erasableAt(session.state, stroke.owner, at)) {
      showToast('Click one of your own lines to erase it.');
      return;
    }
    act(stroke.owner, { type: 'erase', at });
    seat.eraser = false;
    updateControls();
  },
  onStroke(stroke) {
    if (!session?.state || stroke.erasing) return;
    if (session.state.winner) return;
    if (session.net) session.net.send({ t: 'live', points: null });
    const { making, power } = session.seats[stroke.owner];
    const action = { type: 'stroke', points: stroke.points, making, power: making ? power : null };
    const { result } = act(stroke.owner, action, stroke.pointerType);
    if (result) lastStroke = { result, pointerType: stroke.pointerType, raw: stroke.points };
  },
});

// Every action, from any seat, goes through here. Online, it goes to the server
// instead, and the verdict comes back later.
function act(side, action, pointerType = 'mouse') {
  if (session.net) {
    session.net.send({ t: 'action', action });
    if (action.type === 'stroke') lastSentRaw = { pointerType, raw: action.points };
    return { accepted: false, result: null };
  }
  return applyAction(session.state, side, action);
}

// --- Starting and ending ---------------------------------------------------------

function startLocalDuel() {
  closeNet();
  const bind = Number(choices.bind);
  const local = choices.mode === 'local';
  session = {
    mode: choices.mode,
    state: createDuel({ bindPoints: { left: bind, right: local ? bind : CONFIG.engine.defaultBindPoints } }),
    seats: { left: makeSeat('human'), right: local ? makeSeat('human') : opponentSeat() },
  };
  beginDuel();
}

function beginDuel() {
  setPaused(false);
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

function showEnd() {
  endShown = true;
  const { state, seats, mode } = session;
  const secs = (state.timeMs / 1000).toFixed(1);
  if (state.winner === 'draw') {
    $('end-title').textContent = 'Out of chalk: a draw.';
    $('end-stats').textContent = `${secs} seconds. Both sides ran out of chalk without a breach.`;
  } else if (mode === 'local') {
    $('end-title').textContent = `Breach! The ${state.winner} player wins.`;
    $('end-stats').textContent = `${secs} seconds. Left threw ${seats.left.waves} Lines of Vigor, right threw ${seats.right.waves}.`;
  } else {
    const me = mode === 'online' ? session.mySide : 'left';
    const waves = seats[me].waves;
    const against = { dummy: `the ${choices.dummy} dummy`, bot: `the ${CONFIG.bot.levels[choices.level].name} bot`, online: 'your online opponent' }[mode];
    $('end-title').textContent = state.winner === me ? 'Breach! You win.' : 'You were breached.';
    $('end-stats').textContent = `${secs} seconds against ${against}. You threw ${waves} Line${waves === 1 ? '' : 's'} of Vigor.`;
  }
  $('end').hidden = false;
}

function backToMenu() {
  setPaused(false);
  closeNet();
  session = null;
  $('end').hidden = true;
  $('start').hidden = false;
  setOnlineStatus('');
  updateControls();
}

function rematch() {
  if (session?.net) {
    session.net.send({ t: 'rematch' });
    $('end-stats').textContent = 'Waiting for your opponent to press Rematch too...';
  } else startLocalDuel();
}

// --- Online ----------------------------------------------------------------------

async function goOnline(message) {
  if (!net) {
    const client = new OnlineClient({ message: onNetMessage, closed: onNetClosed });
    try {
      setOnlineStatus('Connecting...');
      await client.connect();
    } catch {
      setOnlineStatus('Online play needs the game server. Run "npm start" and open http://localhost:8000.');
      return;
    }
    net = client;
  }
  net.send({ ...message, bind: Number(choices.bind) });
}

function closeNet() {
  if (session?.net) session = null;
  net?.close();
  net = null;
}

function onNetMessage(msg) {
  const now = performance.now();
  if (msg.t === 'joined') {
    session = {
      mode: 'online',
      net,
      mySide: msg.side,
      state: null,
      cache: new Map(),
      seats: { left: makeSeat(msg.side === 'left' ? 'human' : 'remote'), right: makeSeat(msg.side === 'right' ? 'human' : 'remote') },
    };
    setOnlineStatus(
      msg.side === 'left'
        ? `Room code: ${msg.code}. Waiting for someone to join... (open another tab, choose Online, and enter ${msg.code})`
        : `Joined room ${msg.code}.`,
    );
  } else if (msg.t === 'start' && session?.net) {
    session.cache = new Map();
    session.state = null;
    for (const side of SIDES) Object.assign(session.seats[side], { live: null, eraser: false, making: false, power: null, waves: 0 });
    beginDuel();
    showToast(`Duel on! You are on the ${session.mySide.toUpperCase()} half.`);
  } else if (msg.t === 'snap' && session?.net) {
    const first = !session.state;
    session.state = readSnapshot(msg.snap, session.cache);
    session.snapAt = now;
    for (const e of msg.events) onEvent(e, now);
    if (first || msg.events.some((e) => e.type === 'order')) updateControls();
  } else if (msg.t === 'result' && lastSentRaw) {
    lastStroke = { result: msg.result, ...lastSentRaw };
  } else if (msg.t === 'live' && session?.net) {
    session.seats[msg.side].live = msg.points ? { owner: msg.side, seed: 77, points: msg.points, making: !!msg.making } : null;
  } else if (msg.t === 'rematchWanted' && session?.net && msg.side !== session.mySide) {
    showToast('Your opponent wants a rematch.');
  } else if (msg.t === 'opponentLeft') {
    showToast('Your opponent left the duel.');
    backToMenu();
  } else if (msg.t === 'error') {
    setOnlineStatus(msg.message);
  }
}

function onNetClosed() {
  net = null;
  if (session?.net) {
    showToast('Lost the connection to the server.');
    backToMenu();
  }
}

// Online, send what we're drawing about 10 times a second so the opponent sees it.
let liveSentAt = 0;
function sendLiveStroke(now) {
  if (!session?.net || now - liveSentAt < 100) return;
  const mine = human.liveStrokes().find((s) => !s.erasing);
  if (!mine) return;
  liveSentAt = now;
  const step = Math.max(1, Math.floor(mine.points.length / 400));
  const points = mine.points.filter((_, i) => i % step === 0).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  session.net.send({ t: 'live', points, making: session.seats[session.mySide].making });
}

function setOnlineStatus(text) {
  $('online-status').textContent = text;
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

  if (session?.state && !paused) {
    const { state, seats } = session;
    if (!session.net) {
      accumulator += elapsed;
      while (accumulator >= CONFIG.engine.stepMs) {
        for (const side of SIDES) {
          const seat = seats[side];
          if (seat.controller) seat.live = seat.controller.update(state, (action) => act(side, action));
        }
        step(state);
        accumulator -= CONFIG.engine.stepMs;
      }
      for (const e of state.events.splice(0)) onEvent(e, now);
    }
    sendLiveStroke(now);
    if (state.winner && !endShown && now - breachAt > 1400) showEnd();
  }

  board.beginFrame();
  if (session?.state) {
    const { seats } = session;
    const state = session.net ? predicted(session.state, now - session.snapAt) : session.state;
    // Strokes drawn in Chalkling mode are shown in the Making colour.
    const live = human
      .liveStrokes()
      .filter((s) => !s.erasing)
      .map((s) => ({ ...s, making: seats[s.owner].making }));
    for (const side of SIDES) if (seats[side].live?.points) live.push(seats[side].live);
    renderer.draw(state, live, now, practiceTemplate());
    if (debug) drawDuelDebug(board.ctx, state);
  }
  updateHud();
  requestAnimationFrame(frame);
}

function onEvent(e, now) {
  renderer.handleEvent(e, session.state, now);
  if (e.type === 'breach' || e.type === 'draw') breachAt = now;
  if (e.type === 'placed' && e.kind === 'vigor') session.seats[e.owner].waves++;
}

// Online snapshots arrive ~30 times a second. In between, slide flying Vigors
// along so they move smoothly. (Only the picture moves; the server decides hits.)
function predicted(state, ms) {
  const dt = Math.min(ms, 100) / 1000;
  if (!dt || state.winner) return state;
  return { ...state, vigors: state.vigors.map((v) => ({ ...v, pos: { x: v.pos.x + v.vel.x * dt, y: v.pos.y + v.vel.y * dt } })) };
}

// --- Pause ------------------------------------------------------------------------
// Only for duels running on this computer: online, one player can't freeze the other.

function canPause() {
  return !!session?.state && !session.net && !session.state.winner;
}

function setPaused(on) {
  paused = on;
  human.enabled = !on;
  if (on) human.cancelAll();
  $('paused').hidden = !on;
  updatePauseButton();
}

function togglePause() {
  if (paused) setPaused(false);
  else if (canPause()) setPaused(true);
}

function updatePauseButton() {
  $('btn-pause').hidden = !canPause();
}

// --- Eraser and orders ----------------------------------------------------------

function toggleEraser(side) {
  const seat = session?.state && session.seats[side];
  if (seat?.kind !== 'human') return;
  seat.eraser = !seat.eraser;
  if (seat.eraser) seat.making = false;
  updateControls();
}

// Chalkling mode: while it's on, your strokes are chalkling parts
// (chain, holding circle, creature, path) instead of ordinary lines.
function toggleMaking(side) {
  const seat = session?.state && session.seats[side];
  if (seat?.kind !== 'human') return;
  seat.making = !seat.making;
  if (seat.making) seat.eraser = false;
  updateControls();
}

// The power the next chalkling gets (null = none). Only matters in Chalkling mode.
function pickPower(side, power) {
  const seat = session?.state && session.seats[side];
  if (seat?.kind !== 'human') return;
  seat.power = power || null;
  updateControls();
}

function giveOrder(side, order) {
  if (!session?.state || session.seats[side]?.kind !== 'human') return;
  act(side, { type: 'order', order });
  if (session.net) session.state.orders = { ...session.state.orders, [side]: order };
  updateControls();
}

// The side keyboard shortcuts control (on a shared screen, the left player).
function keyboardSide() {
  if (!session) return null;
  if (session.net) return session.mySide;
  return SIDES.find((s) => session.seats[s].kind === 'human');
}

function updateControls() {
  for (const box of document.querySelectorAll('.side-controls')) {
    const side = box.dataset.side;
    const seat = session?.state ? session.seats[side] : null;
    box.hidden = seat?.kind !== 'human';
    if (box.hidden) continue;
    box.querySelector('[data-act="eraser"]').classList.toggle('selected', seat.eraser);
    box.querySelector('[data-act="making"]').classList.toggle('selected', seat.making);
    box.querySelector('.power-picker').hidden = !seat.making;
    for (const b of box.querySelectorAll('[data-power]')) b.classList.toggle('selected', (b.dataset.power || null) === seat.power);
    for (const order of ['attack', 'guard']) {
      box.querySelector(`[data-act="${order}"]`).classList.toggle('selected', session.state.orders[side] === order);
    }
    // Keyboard hints only make sense for the keyboard player.
    for (const kbd of box.querySelectorAll('kbd')) kbd.hidden = side !== keyboardSide();
  }
}

// --- Practice template -----------------------------------------------------------

// The faint defense to trace, placed around your real circle once you've drawn it.
function practiceTemplate() {
  const defense = choices.template && findDefense(choices.template);
  if (!defense?.parts || !['dummy', 'bot'].includes(session.mode)) return null;
  const { state } = session;
  const main = mainWard(state, 'left');
  const anchor = main ? { center: main.center, radius: main.radius } : TEMPLATE_HOME;
  const parts = layoutDefense(defense, anchor, 'left');
  return { parts, anchor, showMain: !main, done: tracedParts(parts, state.wards, state.walls, anchor.radius) };
}

// --- Heads-up display --------------------------------------------------------------

function updateHud() {
  let hint = 'Choose your duel and press Start.';
  if (session?.state?.winner) hint = 'The duel is over.';
  else if (session?.state) hint = duelHint();
  else if (session?.net) hint = 'Waiting for an opponent...';
  if ($('hint').textContent !== hint) $('hint').textContent = hint;
  if (debug) $('debug-panel').textContent = debugPanelText(lastStroke, session?.state);
  updatePauseButton();
}

function duelHint() {
  const { state, seats, mode } = session;
  if (mode === 'local') {
    const waiting = SIDES.filter((s) => !mainWard(state, s));
    if (waiting.length) return `Both players: draw your main circle on your own half (${waiting.join(' and ')} still to go).`;
    return 'Draw at the same time! Waves attack, straight lines block. Chalklings: chain from a green tick, circle, creature, path, erase the chain.';
  }
  const side = keyboardSide();
  const where = mode === 'online' ? `You are on the ${side.toUpperCase()} half. ` : '';
  if (state.chalk && state.chalk[side] < CONFIG.chalk.tooLittle) return `${where}You're out of chalk. Your chalklings and waves already out there are all you have left.`;
  if (state.chalk && state.chalk[side] < 500) return `${where}Almost out of chalk: ${Math.round(state.chalk[side])} left. Only short strokes will fit now.`;
  if (seats[side].eraser) return `${where}Eraser on: click one of your lines. It disappears 3 seconds later. (Press E again to cancel.)`;
  const erasing = state.erasing?.[side];
  if (erasing?.targetId) {
    const secs = Math.max(0, (CONFIG.making.eraseMs * (1 - (erasing.progress ?? 0))) / 1000).toFixed(1);
    return `${where}Erasing${erasing.kind === 'chain' ? ' the chain' : ''}... ${secs} s to go.`;
  }
  if (seats[side].making) return where + makingHint(state, side);
  if (state.chains.some((c) => c.owner === side && (c.holdingId || c.chalklingId))) {
    return `${where}To set your chalkling loose, erase its chain: press Eraser (E), then click the chain.`;
  }
  const template = practiceTemplate();
  const main = mainWard(state, side);
  if (template && main) {
    const n = template.done.filter(Boolean).length;
    return n < template.parts.length
      ? `Trace the faint ${findDefense(choices.template).name}: ${n} of ${template.parts.length} parts done. Bind points are the green ticks.`
      : 'Defense complete! Now attack.';
  }
  if (template) return 'Trace the faint circle first: it becomes your main circle.';
  if (!main) return `${where}Draw your main circle on the ${side} half.`;
  return `${where}Waves attack, straight lines make walls. To make a chalkling, press Chalkling (M).`;
}

// "Sword ×1.4 so far (more chalk, stronger). " for a creature still being drawn.
function powerSoFar(holding) {
  if (!holding.power || !holding.creature?.length) return '';
  const ink = holding.creature.reduce((sum, s) => sum + pathLength(s), 0);
  return `${POWER_NAMES[holding.power]} ×${powerLevel(ink, CONFIG.powers).toFixed(1)} so far (more chalk, stronger). `;
}

// Step-by-step help while Chalkling mode is on.
function makingHint(state, side) {
  const steps = 'Chalkling mode:';
  if (state.chains.some((c) => c.owner === side && !c.holdingId && !c.chalklingId)) return `${steps} 2. Draw a circle on the end of the chain.`;
  const holding = state.wards.find((w) => w.owner === side && w.holding);
  if (holding && !holding.creature?.length) {
    return `${steps} 3. Pick a power above if you want one, then draw your chalkling inside the circle. Spiky = attacker, bulky = defender, long and leggy = runner.`;
  }
  const power = holding ? powerSoFar(holding) : '';
  if (holding && !state.paths.some((p) => p.holdingId === holding.id)) {
    return `${steps} ${power}4. Add detail, or draw a path out of the circle to where it should go (end it on an enemy chalkling to hunt it).`;
  }
  const held = state.chalklings.find((c) => c.owner === side && c.mode === 'held');
  if (held && !state.paths.some((p) => p.chalklingId === held.id)) return `${steps} Chained! Draw a new path from your chalkling.`;
  if (state.chains.some((c) => c.owner === side)) return `${steps} Done! Turn it off (M), then erase the chain (E, then click the chain) to set it loose.`;
  if (state.chalklings.some((c) => c.owner === side && c.mode === 'waiting')) {
    return `${steps} 1. Draw a straight line from a green bind point (or from one to your waiting chalkling to give it a new command).`;
  }
  return `${steps} 1. Draw a straight line out from one of the green bind points on your circle.`;
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
    note: r.reason ?? `quality ${(r.quality ?? 0).toFixed(2)}`,
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
  else if (key === 'p') togglePause();
  else if (paused) return; // nothing else while paused
  else if (key === 'e') toggleEraser(side);
  else if (key === 'm') toggleMaking(side);
  else if (key === 'a') giveOrder(side, 'attack');
  else if (key === 'g') giveOrder(side, 'guard');
});
$('btn-debug').addEventListener('click', toggleDebug);
$('btn-pause').addEventListener('click', togglePause);
$('btn-resume').addEventListener('click', () => setPaused(false));
$('btn-paused-menu').addEventListener('click', backToMenu);
$('btn-save').addEventListener('click', saveStroke);
$('btn-start').addEventListener('click', startLocalDuel);
$('btn-rematch').addEventListener('click', rematch);
$('btn-menu').addEventListener('click', backToMenu);
$('btn-create').addEventListener('click', () => goOnline({ t: 'create' }));
$('btn-join').addEventListener('click', () => goOnline({ t: 'join', code: $('room-code').value }));
$('room-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-join').click();
});
$('btn-try-anyway').addEventListener('click', () => {
  tryWithoutTouch = true;
  showChoiceRows();
});
for (const box of document.querySelectorAll('.side-controls')) {
  const side = box.dataset.side;
  box.querySelector('[data-act="eraser"]').addEventListener('click', () => toggleEraser(side));
  box.querySelector('[data-act="making"]').addEventListener('click', () => toggleMaking(side));
  for (const b of box.querySelectorAll('[data-power]')) b.addEventListener('click', () => pickPower(side, b.dataset.power));
  box.querySelector('[data-act="attack"]').addEventListener('click', () => giveOrder(side, 'attack'));
  box.querySelector('[data-act="guard"]').addEventListener('click', () => giveOrder(side, 'guard'));
}

// Start-screen choices: one button per option, grouped by data-group.
// Bot levels come from the config, easiest first, numbered 1 to 10.
Object.entries(CONFIG.bot.levels).forEach(([id, level], i) => {
  const b = document.createElement('button');
  b.className = 'pick' + (id === choices.level ? ' selected' : '');
  b.dataset.group = 'level';
  b.dataset.value = id;
  b.textContent = `${i + 1}. ${level.name}`;
  $('level-choices').append(b);
});
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

// Rows like "Bot level" only show for the mode they belong to.
function showChoiceRows() {
  for (const row of document.querySelectorAll('[data-show]')) row.hidden = !row.dataset.show.split(' ').includes(choices.mode);
  // Same-screen play needs a touchscreen (two people drawing at once).
  const blocked = choices.mode === 'local' && !hasTouch && !tryWithoutTouch;
  $('touch-note').hidden = !blocked;
  $('btn-start').disabled = blocked;
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

// The single-file version (published page) has no game server, so no online play.
if (window.RITHMATIST_STATIC) document.querySelector('.pick[data-group="mode"][data-value="online"]')?.remove();

showChoiceRows();
updateControls();
requestAnimationFrame(frame);
