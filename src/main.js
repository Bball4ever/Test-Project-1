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
import { measureCreature, speedFor } from './engine/chalklings.js';
import { HumanController } from './controllers/human.js';
import { DummyController } from './controllers/dummy.js';
import { BotController } from './controllers/bot.js';
import { Board, makeView, viewStep } from './render/board.js';
import { DuelRenderer, ordinal } from './render/duel.js';
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
// screen: 'right' or 'left' = split screen, drawing on that side; 'classic' = one board.
// bots: how many bots to play against (1 to 9; 2 or more is a free-for-all).
const choices = { mode: 'dummy', dummy: 'neat', level: 'duelist', bots: '1', teamSize: '2', who: 'solo', seating: 'side', bind: '4', template: '', screen: 'right' };
// Where the practice template sits until you draw your own main circle.
const TEMPLATE_HOME = { center: { x: 380, y: 450 }, radius: 140 };

// While a duel is on: { mode, state, seats: { left, right }, net?, mySide?, snapAt? }
let session = null;
let net = null; // the online connection, if any
let lastStroke = null; // for the debug panel and "Save stroke"
let lastSentRaw = null; // online: the points of our last stroke, until the server's verdict arrives
let endShown = false;
let watching = false; // knocked out of a free-for-all, but watching the rest
let debug = false;
let paused = false;
let tryWithoutTouch = false;

function makeSeat(kind, controller = null) {
  return { kind, controller, live: null, eraser: false, making: false, detailPick: false, control: 'remote', waves: 0 };
}

// --- Input ---------------------------------------------------------------------

const human = new HumanController(canvas, {
  // Strokes are drawn in the main or detail drawing screen (or, on one board,
  // anywhere). The map is only for watching.
  viewAt(x, y) {
    if (!board.views) return board.fullView();
    const view = board.viewAt(x, y);
    return view && !view.empty && view.name !== 'map' ? view : null;
  },
  toWorld: (view, x, y) => board.viewToWorld(view, x, y),
  // Which side does a new stroke belong to? The human's side, or on a shared
  // screen, whichever half the stroke starts in.
  owner(point) {
    if (!session?.state || session.state.winner) return null;
    const humans = Object.keys(session.seats).filter((s) => session.seats[s].kind === 'human');
    if (humans.length === 1) return humans[0];
    // Whose area is it in? If it's a bot's, the nearest person's (the engine
    // will then say "stay on your side").
    const { homes } = session.state;
    const near = (ids) => ids.reduce((a, b) => (dist2(homes[a], point) <= dist2(homes[b], point) ? a : b));
    const here = near(session.state.players);
    return humans.includes(here) ? here : near(humans);
  },
  // With the eraser on, a click erases the line under it (after 3 seconds)
  // instead of drawing, and the eraser turns itself off.
  onBegin(stroke) {
    const seat = session.seats[stroke.owner];
    if (seat.detailPick) return pickDetailCircle(stroke, seat);
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
    // Strokes in the detail screen are always chalkling parts, and count extra.
    const detail = stroke.view?.name === 'detail';
    const making = session.seats[stroke.owner].making || detail;
    const { control } = session.seats[stroke.owner];
    const action = { type: 'stroke', points: stroke.points, making, detail, control };
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
  // Against bots there can be up to 9 of them (10 players in all).
  // In a team game, two teams of teamSize (you and your bot teammates against
  // bots, or two people on one screen: see teamSeating).
  const teams = choices.mode === 'teams';
  const players = choices.mode === 'bot' ? 1 + Number(choices.bots) : teams ? 2 * Number(choices.teamSize) : 2;
  const seating = teams ? teamSeating(players) : { humans: local ? ['left', 'right'] : ['left'], angle: 0, edges: {} };
  const bindPoints = Object.fromEntries(seating.humans.map((id) => [id, bind]));
  const state = createDuel({ players, teams, bindPoints });
  const seats = {};
  for (const id of state.players) seats[id] = seating.humans.includes(id) ? makeSeat('human') : opponentSeat(id);
  const shared = seating.humans.length > 1;
  session = {
    mode: choices.mode,
    // The split screen is for one player (same-screen play keeps one board).
    screen: shared ? 'classic' : choices.screen,
    state,
    seats,
    shared, // two people on one screen
    humans: seating.humans, // Player 1, Player 2
    angle: seating.angle, // how the one board is turned
    edges: seating.edges, // which edge of the screen each person sits at
  };
  beginDuel();
}

function beginDuel() {
  setPaused(false);
  // A bigger board for a bigger game (online, the board comes with the first snapshot).
  if (session.state) board.setWorld(session.state.cfg.world, session.state.homes);
  else board.setWorld(CONFIG.engine.world);
  resetSplit();
  renderer.reset();
  human.cancelAll();
  endShown = false;
  watching = false;
  lastStroke = null;
  accumulator = 0;
  breachAt = null;
  $('start').hidden = true;
  $('end').hidden = true;
  updateControls();
}

// Who sits where in a team game. Just you: you're 'left'. Two people on one
// screen, either teammates or on opposite teams, sitting side by side (both at
// the bottom edge) or facing each other (one at the bottom, one at the top,
// with their buttons turned to face them). The board is turned to suit.
//   Team 0 is 'left', 'p2', 'p4', … ; team 1 is 'right', 'p3', … ; one row per pair.
function teamSeating(players) {
  const solo = { humans: ['left'], angle: 0, edges: {} };
  if (choices.who === 'solo') return solo;
  const lastOfTeam0 = `p${players - 2}`;
  const facing = choices.seating === 'facing';
  if (choices.who === 'same') {
    // Side by side: your team along the bottom. Facing: the board as it is, your
    // team down the left half, one of you at the top row and one at the bottom.
    return facing
      ? { humans: ['left', lastOfTeam0], angle: 0, edges: { left: 'top', [lastOfTeam0]: 'bottom' } }
      : { humans: ['left', 'p2'], angle: -Math.PI / 2, edges: {} };
  }
  // Against each other. Side by side: you two are the bottom row, Player 1's
  // team down the left half. Facing: Player 1's team at the bottom, Player 2's
  // at the top.
  return facing
    ? { humans: ['left', 'right'], angle: -Math.PI / 2, edges: { right: 'top' } }
    : { humans: [`p${players - 2}`, `p${players - 1}`], angle: 0, edges: {} };
}

function dist2(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function opponentSeat(id) {
  if (choices.mode === 'bot' || choices.mode === 'teams') {
    const seed = Math.floor(Math.random() * 1e9);
    return makeSeat('bot', new BotController({ owner: id, level: choices.level, seed }));
  }
  return makeSeat('dummy', new DummyController({ owner: 'right', style: choices.dummy }));
}

function showEnd() {
  endShown = true;
  const { state, seats, mode } = session;
  const secs = (state.timeMs / 1000).toFixed(1);
  const me = mode === 'online' ? session.mySide : 'left';
  if (state.winner === 'draw' && state.drawReason === 'noCircle') {
    $('end-title').textContent = 'Nobody drew a circle in time: a draw.';
    $('end-stats').textContent = `You have ${CONFIG.engine.circleDeadlineMs / 1000} seconds at the start to draw your main circle.`;
  } else if (state.winner === 'draw') {
    $('end-title').textContent = 'Out of chalk: a draw.';
    $('end-stats').textContent = `${secs} seconds. Both sides ran out of chalk without a breach.`;
  } else if (mode !== 'local' && !state.teams && state.outReasons?.[me] === 'noCircle') {
    $('end-title').textContent = 'Too slow! No main circle in time.';
    $('end-stats').textContent = `You have ${CONFIG.engine.circleDeadlineMs / 1000} seconds at the start to draw your main circle (at least as big as the dashed ring).`;
  } else if (mode === 'local') {
    $('end-title').textContent = `Breach! The ${state.winner} player wins.`;
    $('end-stats').textContent = `${secs} seconds. Left threw ${seats.left.waves} Lines of Vigor, right threw ${seats.right.waves}.`;
  } else if (session.shared && state.teams) {
    sharedTeamEnd(state, secs);
  } else if (state.teams && !state.winner) {
    // Out, but your team is still in it.
    $('end-title').textContent = state.outReasons.left === 'noCircle' ? 'Too slow! No main circle in time.' : 'You were breached.';
    $('end-stats').textContent = `You're out, but your team plays on. Keep watching to see if they win.`;
  } else if (state.teams) {
    const mine = `team${state.teams.left}`;
    const size = state.players.length / 2;
    const level = CONFIG.bot.levels[choices.level].name;
    const standing = state.players.filter((id) => !state.out.includes(id) && `team${state.teams[id]}` === state.winner).length;
    $('end-title').textContent = state.winner === mine ? 'Your team wins!' : 'Your team was breached.';
    const you = state.out.includes('left') ? 'You were knocked out along the way.' : 'You were still standing at the end.';
    const waves = seats.left.waves;
    $('end-stats').textContent = `${secs} seconds, ${size} against ${size} with ${level} bots. ${standing} of ${size} on the winning team made it. ${you} You threw ${waves} Line${waves === 1 ? '' : 's'} of Vigor.`;
  } else if (state.players?.length > 2) {
    // Free-for-all: what place you came.
    const n = state.players.length;
    const won = state.winner === 'left';
    const place = won ? 1 : n - state.out.indexOf('left');
    const waves = seats.left.waves;
    const bots = `${n - 1} ${CONFIG.bot.levels[choices.level].name} bots`;
    $('end-title').textContent = won ? 'Last circle standing! You win.' : `You were breached: ${ordinal(place)} of ${n}.`;
    const winner = state.winner && !won ? ` The last circle standing: ${playerName(state.winner)}.` : '';
    $('end-stats').textContent = `${secs} seconds against ${bots}. You threw ${waves} Line${waves === 1 ? '' : 's'} of Vigor.${winner}`;
  } else {
    const waves = seats[me].waves;
    const against = { dummy: `the ${choices.dummy} dummy`, bot: `the ${CONFIG.bot.levels[choices.level].name} bot`, online: 'your online opponent' }[mode];
    $('end-title').textContent = state.winner === me ? 'Breach! You win.' : 'You were breached.';
    $('end-stats').textContent = `${secs} seconds against ${against}. You threw ${waves} Line${waves === 1 ? '' : 's'} of Vigor.`;
  }
  // Knocked out of a free-for-all that's still going: you can watch the rest.
  $('btn-watch').hidden = !(state.players?.length > 2 && !state.winner);
  $('end').hidden = false;
}

// The end of a team game with two people on one screen.
function sharedTeamEnd(state, secs) {
  const [p1, p2] = humansOf();
  const same = state.teams[p1] === state.teams[p2];
  const level = CONFIG.bot.levels[choices.level].name;
  const size = state.players.length / 2;
  const waves = `Player 1 threw ${session.seats[p1].waves} Lines of Vigor, Player 2 threw ${session.seats[p2].waves}.`;
  if (!state.winner) {
    // Both people are out, but the bots play on.
    $('end-title').textContent = same ? "You're both out." : 'Both players are out.';
    $('end-stats').textContent = same ? 'But your bot teammates play on: keep watching to see if they win.' : 'The bots play on: keep watching to see which team wins.';
    return;
  }
  if (same) {
    $('end-title').textContent = state.winner === `team${state.teams[p1]}` ? 'Your team wins!' : 'Your team was breached.';
  } else {
    const winner = state.winner === `team${state.teams[p1]}` ? 'Player 1' : 'Player 2';
    $('end-title').textContent = `${winner}'s team wins!`;
  }
  $('end-stats').textContent = `${secs} seconds, ${size} against ${size} with ${level} bots. ${waves}`;
}

// "Player 1" and "Player 2" on a shared screen.
function personName(id) {
  return `Player ${humansOf().indexOf(id) + 1}`;
}

// The tag under each main circle in a team game: whose it is, and for people,
// how much chalk they have left.
function circleTags(state) {
  if (!state.teams) return null;
  const humans = humansOf();
  const me = humans[0];
  const tags = {};
  for (const id of state.players) {
    const person = humans.includes(id);
    let text;
    if (session.shared) text = person ? personName(id) : 'Bot';
    else text = id === me ? 'You' : state.teams[id] === state.teams[me] ? 'Teammate' : 'Enemy';
    tags[id] = { text, chalk: person ? state.chalk[id] : null, flip: session.edges?.[id] === 'top' };
  }
  return tags;
}

function keepWatching() {
  watching = true;
  endShown = false; // the end screen comes back when someone wins
  $('end').hidden = true;
  showToast("You're out. Watching the rest of the battle: the map shows everyone.");
}

// "You", or "Bot 3" (bots are numbered in the order they sit round the ring).
function playerName(id) {
  return id === 'left' ? 'You' : `Bot ${session.state.players.indexOf(id)}`;
}

function backToMenu() {
  setPaused(false);
  closeNet();
  session = null;
  board.setWorld(CONFIG.engine.world);
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
    // Split screen (map, Your area and the detail screen) or one board, as picked.
    session.screen = choices.screen;
    session.cache = new Map();
    session.state = null;
    for (const side of SIDES) Object.assign(session.seats[side], { live: null, eraser: false, making: false, detailPick: false, control: 'remote', waves: 0 });
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
        for (const [side, seat] of Object.entries(seats)) {
          if (seat.controller) seat.live = seat.controller.update(state, (action) => act(side, action));
        }
        step(state);
        accumulator -= CONFIG.engine.stepMs;
      }
      for (const e of state.events.splice(0)) onEvent(e, now);
    }
    sendLiveStroke(now);
    // The duel is over for you when someone has won, or (with several bots)
    // when you've been breached.
    const over = state.winner || (!watching && humansOf().every((id) => state.out?.includes(id)));
    if (over && !endShown && now - breachAt > 1400) showEnd();
  }

  layoutViews();
  board.beginFrame();
  const views = board.views ?? [board.fullView()];
  if (session?.state) {
    const { seats } = session;
    const state = session.net ? predicted(session.state, now - session.snapAt) : session.state;
    // Strokes drawn in Chalkling mode (or in the detail screen) are shown in the Making colour.
    const live = human
      .liveStrokes()
      .filter((s) => !s.erasing)
      .map((s) => ({ ...s, making: seats[s.owner].making || s.view?.name === 'detail' }));
    for (const seat of Object.values(seats)) if (seat.live?.points) live.push(seat.live);
    const template = practiceTemplate();
    const target = detailWard();
    for (const view of views) {
      if (view.empty) continue;
      board.beginView(view);
      // The chalk meters are shown once: on the map (or the one board).
      renderer.draw(state, live, now, template, { meters: view.name === 'full', angle: view.angle ?? 0, tags: circleTags(state) });
      if (target && view.name !== 'detail') markDetailCircle(board.ctx, target);
      drawCircleGuides(board.ctx, state);
      if (debug) drawDuelDebug(board.ctx, state);
      board.endView();
    }
  } else {
    for (const view of views) {
      board.beginView(view);
      board.endView();
    }
  }
  if (isSplit()) drawPanelFrames(board.ctx, board.views, board.dpr, session?.state);
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

// --- Split screen ----------------------------------------------------------------
// Against the dummy or a bot you can split the screen: one half is the MAP (the
// whole battle; drag to move around, scroll or pinch to zoom, double-click to
// reset), the other half is for drawing: your MAIN drawing screen on top (your
// own area: your circle and everything attached to it) and the DETAIL drawing
// screen below (press Detail, tap a holding circle, and draw the creature big;
// the detail drawn there counts extra).

const camera = { zoom: 1, focus: null }; // the map's zoom and the world point at its middle
let detailTarget = null; // id of the holding circle shown in the detail screen
let shownDetail = null; // the one shown last frame (to notice when it changes)
const mapPointers = new Map(); // fingers / mouse dragging the map

function isSplit() {
  return !!session?.state && (session.screen === 'left' || session.screen === 'right');
}

function resetSplit() {
  camera.zoom = 1;
  camera.focus = null;
  detailTarget = null;
  mapPointers.clear();
}

// The holding circle in the detail screen, while it's still a holding circle.
function detailWard() {
  if (detailTarget === null || !session?.state) return null;
  const ward = session.state.wards.find((w) => w.id === detailTarget && !w.gone && w.holding);
  if (!ward) detailTarget = null;
  return ward ?? null;
}

// Work out the three panels for this frame (or one board).
function layoutViews() {
  const split = isSplit();
  document.body.dataset.split = split ? session.screen : '';
  if (!split) {
    delete document.body.dataset.split;
    // One board, turned to suit where the players sit (see teamSeating).
    const angle = session?.state ? (session.angle ?? 0) : 0;
    board.views = angle
      ? [makeView('full', { x: 0, y: 0, w: canvas.clientWidth, h: canvas.clientHeight }, { x: 0, y: 0, w: board.world.width, h: board.world.height }, { angle, pad: 4 })]
      : null;
    placeControls();
    return;
  }
  placeControls();
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const { width, height } = board.world;
  // The screen in quarters: the map fills the half away from your drawing
  // side; Your area is the top quarter of your side, and the detail screen the
  // bottom quarter (bottom-right when you draw on the right).
  const half = Math.round(W / 2);
  const drawX = session.screen === 'right' ? half : 0;
  const mapX = session.screen === 'right' ? 0 : half;
  const top = Math.round(H / 2);
  document.body.style.setProperty('--map-w', `${half}px`);
  // The map is turned so that your home is at the bottom (in a team game, your
  // team's side, with the enemy team at the top).
  const home = session.state.homes?.[keyboardSide()] ?? { x: width / 4, y: height / 2 };
  const teams = session.state.teams;
  const away = teams ? { x: teams[keyboardSide()] === 0 ? -1 : 1, y: 0 } : { x: home.x - width / 2, y: home.y - height / 2 };
  const angle = Math.PI / 2 - Math.atan2(away.y, away.x);
  const map = makeView('map', { x: mapX, y: 0, w: half, h: H }, { x: 0, y: 0, w: width, h: height }, { zoom: camera.zoom, focus: camera.focus, pad: 8, angle });
  const mainRect = { x: drawX, y: 0, w: W - half, h: top };
  const main = makeView('main', mainRect, myArea(mainRect.w / mainRect.h), { pad: 6 });
  const ward = detailWard();
  if ((ward?.id ?? null) !== shownDetail) {
    shownDetail = ward?.id ?? null;
    updateControls(); // the Command buttons show while a creature can be drawn
  }
  const detailRect = { x: drawX, y: top, w: W - half, h: H - top };
  const r = ward ? ward.radius * 1.08 : 0;
  const detail = ward
    ? makeView('detail', detailRect, { x: ward.center.x - r, y: ward.center.y - r, w: 2 * r, h: 2 * r }, { pad: 10 })
    : { name: 'detail', rect: detailRect, empty: true };
  board.views = [map, main, detail];
}

// Your area of the map, for the main drawing screen: a fixed view around your
// home (it doesn't move or zoom while you play). It's 640 board units tall,
// from a little above your circle to below where chains and holding circles
// go, and as wide as the screen's shape allows, kept on the board.
function myArea(aspect) {
  const { width, height } = board.world;
  const home = session.state.homes?.[keyboardSide()] ?? { x: width / 4, y: height / 2 };
  const h = Math.min(640, height);
  const w = Math.min(h * aspect, width);
  const x = Math.max(0, Math.min(width - w, home.x - w / 2));
  const y = Math.max(0, Math.min(height - h, home.y + 90 - h / 2));
  return { x, y, w, h };
}

// Detail mode: the next tap picks which holding circle goes in the detail screen.
function toggleDetailPick(side) {
  const seat = session?.state && session.seats[side];
  if (seat?.kind !== 'human' || !isSplit()) return;
  seat.detailPick = !seat.detailPick;
  if (seat.detailPick) seat.eraser = false;
  updateControls();
}

function pickDetailCircle(stroke, seat) {
  stroke.erasing = true; // this tap picks a circle; it isn't a stroke
  const at = stroke.points[0];
  const ward = session.state.wards.find(
    (w) => w.owner === stroke.owner && w.holding && !w.gone && Math.hypot(at.x - w.center.x, at.y - w.center.y) < w.radius,
  );
  if (!ward) {
    showToast('Tap inside one of your holding circles (the circle on the end of a chain).');
    return;
  }
  detailTarget = ward.id;
  seat.detailPick = false;
  updateControls();
  showToast('Now draw your chalkling in the detail screen. Detail drawn there counts extra.');
}

// A dashed ring around the circle that's in the detail screen.
function markDetailCircle(ctx, ward) {
  ctx.save();
  ctx.strokeStyle = `rgba(${CONFIG.render.makingColor}, 0.8)`;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(ward.center.x, ward.center.y, ward.radius + 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Borders and names for the three panels, drawn over everything.
function drawPanelFrames(ctx, views, dpr, state) {
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const captions = { map: 'MAP · drag, scroll or pinch', main: 'YOUR AREA', detail: 'DETAIL' };
  for (const v of views) {
    const { x, y, w, h } = v.rect;
    if (v.empty) {
      ctx.fillStyle = 'rgba(8, 12, 10, 0.9)';
      ctx.fillRect(x, y, w, h);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(235, 238, 228, 0.7)';
      ctx.fillText('Detail screen: press Detail (F), then tap a holding circle', x + w / 2, y + h / 2 - 10);
      ctx.fillText('in Your Area to draw its chalkling big here.', x + w / 2, y + h / 2 + 12);
    }
    ctx.strokeStyle = 'rgba(235, 238, 228, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(235, 238, 228, 0.55)';
    ctx.textBaseline = 'top';
    ctx.textAlign = v.name === 'map' ? 'right' : 'left';
    const cap = v.name === 'map' ? { x: x + w - 10, y: h - 22 + y } : { x: x + 10, y: y + 8 };
    ctx.fillText(captions[v.name], cap.x, cap.y);
    if (v.name === 'main' && state?.chalk) drawChalkStrip(ctx, v.rect, state);
  }
  ctx.restore();
}

// Both duelists' chalk, as two small meters along the top of Your area.
function drawChalkStrip(ctx, rect, state) {
  if (!Number.isFinite(state.chalkStart)) return;
  const me = keyboardSide();
  const players = state.players ?? ['left', 'right'];
  const rows = [
    ['You', me],
    ...(players.length > 2 ? [] : [['Enemy', me === 'left' ? 'right' : 'left']]),
  ];
  if (players.length > 2) {
    // Free-for-all (or teams): how many are still in.
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(235, 238, 228, 0.75)';
    const inOf = (list) => list.filter((id) => !state.out?.includes(id)).length;
    let text = `${inOf(players)} of ${players.length} still in`;
    if (state.teams) {
      // Team game: how many are still in on each side.
      const mine = players.filter((id) => state.teams[id] === state.teams[me]);
      const theirs = players.filter((id) => state.teams[id] !== state.teams[me]);
      text = `Your team: ${inOf(mine)} of ${mine.length} in · Enemy team: ${inOf(theirs)} of ${theirs.length}`;
    }
    ctx.fillText(text, rect.x + rect.w - 10, rect.y + 24);
  }
  let x = rect.x + rect.w - 10;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  for (const [label, side] of rows.reverse()) {
    const left = Math.max(0, state.chalk[side] ?? 0);
    const share = left / state.chalkStart;
    const barW = 90;
    x -= barW;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x, rect.y + 10, barW, 7);
    ctx.fillStyle = share < 0.15 ? `rgba(${CONFIG.render.dudColor}, 0.9)` : `rgba(${CONFIG.render.chalkColor}, 0.85)`;
    ctx.fillRect(x, rect.y + 10, barW * share, 7);
    const text = `${label} ${Math.round(left).toLocaleString()}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(235, 238, 228, 0.75)';
    ctx.fillText(text, x - 6, rect.y + 7);
    x -= ctx.measureText(text).width + 22;
  }
}

// Moving and zooming the map: drag with one finger or the mouse, pinch with
// two fingers, or use the mouse wheel.
function mapView() {
  return board.views?.find((v) => v.name === 'map') ?? null;
}

function zoomMap(factor, clientX, clientY) {
  const view = mapView();
  if (!view) return;
  const at = board.viewToWorld(view, clientX, clientY);
  const zoom = Math.max(1, Math.min(6, camera.zoom * factor));
  const focus = camera.focus ?? { x: board.world.width / 2, y: board.world.height / 2 };
  const k = camera.zoom / zoom; // keep the point under the cursor where it is
  camera.zoom = zoom;
  camera.focus = clampFocus({ x: at.x - (at.x - focus.x) * k, y: at.y - (at.y - focus.y) * k });
}

function clampFocus(f) {
  return { x: Math.max(0, Math.min(board.world.width, f.x)), y: Math.max(0, Math.min(board.world.height, f.y)) };
}

function resetCamera() {
  camera.zoom = 1;
  camera.focus = null;
}

canvas.addEventListener('pointerdown', (e) => {
  const view = board.views && board.viewAt(e.clientX, e.clientY);
  if (view?.name === 'map') {
    mapPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
  } else if (view?.empty) {
    showToast('Press Detail (F), then tap a holding circle in Your Area.');
  }
});
canvas.addEventListener('pointermove', (e) => {
  const last = mapPointers.get(e.pointerId);
  const view = mapView();
  if (!last || !view) return;
  const now = { x: e.clientX, y: e.clientY };
  if (mapPointers.size === 1) {
    const focus = camera.focus ?? { x: board.world.width / 2, y: board.world.height / 2 };
    const moved = viewStep(view, now.x - last.x, now.y - last.y); // the map is turned, so ask the view
    camera.focus = clampFocus({ x: focus.x - moved.x, y: focus.y - moved.y });
  } else if (mapPointers.size === 2) {
    const other = [...mapPointers].find(([id]) => id !== e.pointerId)[1];
    const before = Math.hypot(last.x - other.x, last.y - other.y);
    const after = Math.hypot(now.x - other.x, now.y - other.y);
    if (before > 10) zoomMap(after / before, (now.x + other.x) / 2, (now.y + other.y) / 2);
  }
  mapPointers.set(e.pointerId, now);
});
for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, (e) => mapPointers.delete(e.pointerId));
canvas.addEventListener(
  'wheel',
  (e) => {
    const view = board.views && board.viewAt(e.clientX, e.clientY);
    if (view?.name !== 'map') return;
    e.preventDefault();
    zoomMap(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  },
  { passive: false },
);
canvas.addEventListener('dblclick', (e) => {
  if (board.views && board.viewAt(e.clientX, e.clientY)?.name === 'map') resetCamera();
});

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

// How the next chalkling will be controlled: 'remote' (follows the Attack /
// Guard buttons), or 'attack' / 'guard' (always does that, whatever the buttons say).
function pickControl(side, control) {
  const seat = session?.state && session.seats[side];
  if (seat?.kind !== 'human') return;
  seat.control = control;
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
  return Object.keys(session.seats).find((s) => session.seats[s].kind === 'human');
}

// The people playing on this screen (Player 1 first).
function humansOf() {
  if (!session) return [];
  if (session.net) return [session.mySide];
  return session.humans ?? Object.keys(session.seats).filter((s) => session.seats[s].kind === 'human');
}

// Each person gets a bar of buttons: the first box for Player 1, the second
// for Player 2. Each sits at the person's edge of the screen, on their side
// (turned to face them if they sit at the top).
function placeControls() {
  const boxes = document.querySelectorAll('.side-controls');
  const humans = session?.state ? humansOf() : [];
  const view = board.views?.find((v) => v.name === 'full') ?? board.fullView();
  boxes.forEach((box, i) => {
    const id = humans[i] ?? '';
    set(box, 'side', id);
    // On the split screen the buttons sit at the bottom of the map half (style.css
    // moves them across when the map is on the right); otherwise on your side.
    let x = id === 'right' && !isSplit() ? 'right' : 'left';
    if (humans.length > 1 && session.state.homes?.[id]) {
      const h = session.state.homes[id];
      x = view.ox + view.a * h.x + view.c * h.y < view.rect.w / 2 ? 'left' : 'right';
    }
    set(box, 'x', x);
    set(box, 'edge', session?.edges?.[id] ?? 'bottom');
  });
  // Someone sits at the top edge: the top of the screen is theirs (see style.css).
  const facing = humans.some((id) => session?.edges?.[id] === 'top');
  if ('facing' in document.body.dataset !== facing) document.body.toggleAttribute('data-facing', facing);
}

// (Only touch the page when something changed: this runs every frame.)
function set(el, key, value) {
  if (el.dataset[key] !== value) el.dataset[key] = value;
}

function updateControls() {
  placeControls();
  for (const box of document.querySelectorAll('.side-controls')) {
    const side = box.dataset.side;
    const seat = session?.state ? session.seats[side] : null;
    box.hidden = seat?.kind !== 'human';
    if (box.hidden) continue;
    box.querySelector('[data-act="eraser"]').classList.toggle('selected', seat.eraser);
    box.querySelector('[data-act="making"]').classList.toggle('selected', seat.making);
    box.querySelector('.chalkling-picker').hidden = !(seat.making || detailWard());
    for (const b of box.querySelectorAll('[data-control]')) b.classList.toggle('selected', b.dataset.control === seat.control);
    const detailBtn = box.querySelector('[data-act="detail"]');
    detailBtn.hidden = !isSplit();
    detailBtn.classList.toggle('selected', seat.detailPick);
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
  if (!defense?.parts || !['dummy', 'bot', 'teams'].includes(session.mode) || session.shared) return null;
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
  updateCountdown();
  if (debug) $('debug-panel').textContent = debugPanelText(lastStroke, session?.state);
  updatePauseButton();
}

function duelHint() {
  const { state, seats, mode } = session;
  if (session.shared && state.teams) {
    const humans = humansOf();
    const waiting = humans.filter((s) => !mainWard(state, s) && !state.out.includes(s)).map((s) => personName(s));
    if (waiting.length) return `Both players: quick, draw your main circle in your own area, at least as big as the dashed ring (${waiting.join(' and ')} still to go).`;
    const same = state.teams[humans[0]] === state.teams[humans[1]];
    return same
      ? 'You two are a team: the cool colours. Waves pass through your teammates, but walls stop everyone. Last team standing wins.'
      : 'Player 1 is cool colours, Player 2 warm, each with bot teammates. Last team standing wins.';
  }
  if (mode === 'local') {
    const waiting = SIDES.filter((s) => !mainWard(state, s));
    if (waiting.length) return `Both players: draw your main circle on your own half (${waiting.join(' and ')} still to go).`;
    return 'Draw at the same time! Waves attack, straight lines block. Chalklings: chain from a green tick, circle, creature, path, erase the chain.';
  }
  const side = keyboardSide();
  if (watching) return `You're out. Watching the rest of the battle: ${state.players.length - state.out.length} of ${state.players.length} still in.`;
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
  const big = 'at least as big as the dashed ring';
  if (!main && state.teams) {
    const size = state.players.length / 2;
    return `${size} against ${size}! Quick: draw your main circle in your own area (${big}). Your teammates are the cool colours; the last team standing wins.`;
  }
  if (!main && state.players?.length > 2) return `Free-for-all with ${state.players.length - 1} bots! Quick: draw your main circle in your territory (${big}). Last circle standing wins.`;
  if (!main) return `${where}Quick: draw your main circle on the ${side} half, ${big}. No circle when the countdown ends and you're out!`;
  return `${where}Waves need 3+ humps: curved humps smash lines, spiky humps smash chalklings. Straight lines make walls (8 at most). To make a chalkling, press Chalkling (M).`;
}

// "So far: detail 6.2, round (more health), speed 64. " for a creature still being drawn.
function creatureSoFar(holding) {
  if (!holding.creature?.length) return '';
  const cc = CONFIG.chalkling;
  const m = measureCreature(holding.creature, cc, holding.creatureDetail);
  const shape = { attacker: 'pointy (more bite)', defender: 'round (more health)', balanced: 'even mix' }[m.role];
  return `So far: detail ${m.detail.toFixed(1)}, ${shape}, speed ${Math.round(speedFor(m.ink, cc))}. `;
}

// Step-by-step help while Chalkling mode is on.
function makingHint(state, side) {
  const steps = 'Chalkling mode:';
  if (state.chains.some((c) => c.owner === side && !c.holdingId && !c.chalklingId)) return `${steps} 2. Draw a circle on the end of the chain.`;
  const holding = state.wards.find((w) => w.owner === side && w.holding);
  if (holding && !holding.creature?.length) {
    const zoom = isSplit() ? ' Tip: press Detail (F) and tap the circle to draw it big in the detail screen; detail there counts extra.' : '';
    return `${steps} 3. Pick a command above (Remote follows Attack/Guard; Always attack/guard ignores them), then draw your chalkling inside the circle, in as many strokes as you like. More detail = stronger; rounder = more health, pointier = more bite; less chalk = faster.${zoom}`;
  }
  const sofar = holding ? creatureSoFar(holding) : '';
  if (holding && !state.paths.some((p) => p.holdingId === holding.id)) {
    return `${steps} ${sofar}4. Add detail, or draw a path out of the circle to where it should go (end it on an enemy chalkling to hunt it).`;
  }
  const held = state.chalklings.find((c) => c.owner === side && c.mode === 'held');
  if (held && !state.paths.some((p) => p.chalklingId === held.id)) return `${steps} Chained! Draw a new path from your chalkling.`;
  if (state.chains.some((c) => c.owner === side)) return `${steps} Done! Turn it off (M), then erase the chain (E, then click the chain) to set it loose.`;
  if (state.chalklings.some((c) => c.owner === side && c.mode === 'waiting')) {
    return `${steps} 1. Draw a straight line from a green bind point (or from one to your waiting chalkling to give it a new command).`;
  }
  return `${steps} 1. Draw a straight line out from one of the green bind points on your circle.`;
}

// --- The countdown ------------------------------------------------------------------
// At the start, everyone has 5 seconds to draw their main circle; anyone who
// hasn't by then is out. A big countdown shows over your drawing area, and a
// dashed ring at each player's home shows the smallest circle that counts.

function updateCountdown() {
  const el = $('countdown');
  const state = session?.state;
  const left = state ? (state.circleDeadlineMs ?? Infinity) - state.timeMs : -1;
  const show = state && !state.winner && left > 0 && Number.isFinite(left);
  if (!show) {
    el.hidden = true;
    return;
  }
  const side = keyboardSide();
  const done = session.shared ? humansOf().every((s) => mainWard(state, s)) : !!mainWard(state, side);
  el.hidden = false;
  el.classList.toggle('done', done);
  el.querySelector('b').textContent = String(Math.ceil(left / 1000));
  el.querySelector('span').textContent = done ? 'Circle drawn! Get ready...' : 'Draw your main circle!';
  // Over your drawing area but out of the way of your circle: the far side of
  // Your area on the split screen, else near the top of your half.
  const main = board.views?.find((v) => v.name === 'main');
  const rect = canvas.getBoundingClientRect();
  const home = state.homes?.[side];
  const homeX = main && home ? main.ox + home.x * main.scale : 0;
  const at = main
    ? { x: main.rect.x + main.rect.w * (homeX < main.rect.x + main.rect.w / 2 ? 0.78 : 0.22), y: main.rect.y + main.rect.h * 0.5 }
    : { x: rect.width * (session.shared ? 0.5 : side === 'right' ? 0.75 : 0.25), y: rect.height * ('facing' in document.body.dataset ? 0.5 : 0.14) };
  el.style.left = `${rect.left + at.x}px`;
  el.style.top = `${rect.top + at.y}px`;
}

// A dashed ring at each home that still needs its main circle: the smallest
// main circle that counts.
function drawCircleGuides(ctx, state) {
  if (state.winner || !(state.timeMs < (state.circleDeadlineMs ?? 0)) || !state.homes) return;
  for (const [id, seat] of Object.entries(session.seats)) {
    if (seat.kind !== 'human' || mainWard(state, id)) continue;
    const home = state.homes[id];
    ctx.save();
    ctx.strokeStyle = `rgba(${CONFIG.render.chalkColor}, 0.35)`;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.arc(home.x, home.y, CONFIG.engine.minMainRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
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
  else if (key === 'f') toggleDetailPick(side);
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
$('btn-watch').addEventListener('click', keepWatching);
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
// (Which person a box belongs to is set at the start of each duel: placeControls.)
for (const box of document.querySelectorAll('.side-controls')) {
  const side = () => box.dataset.side;
  box.querySelector('[data-act="eraser"]').addEventListener('click', () => toggleEraser(side()));
  box.querySelector('[data-act="making"]').addEventListener('click', () => toggleMaking(side()));
  box.querySelector('[data-act="detail"]').addEventListener('click', () => toggleDetailPick(side()));
  for (const b of box.querySelectorAll('[data-control]')) b.addEventListener('click', () => pickControl(side(), b.dataset.control));
  box.querySelector('[data-act="attack"]').addEventListener('click', () => giveOrder(side(), 'attack'));
  box.querySelector('[data-act="guard"]').addEventListener('click', () => giveOrder(side(), 'guard'));
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
  // In a team game, the Seating rows are for two people, and the Your screen
  // rows (split screen) for one.
  const pair = choices.mode === 'teams' && choices.who !== 'solo';
  for (const row of document.querySelectorAll('[data-show]')) {
    row.hidden = !row.dataset.show.split(' ').includes(choices.mode) || ('pair' in row.dataset && !pair) || ('solo' in row.dataset && pair);
  }
  // Same-screen play needs a touchscreen (two people drawing at once).
  const blocked = (choices.mode === 'local' || pair) && !hasTouch && !tryWithoutTouch;
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

// For automated browser tests: where each panel is right now (read-only).
window.rithmatistViews = () => board.views ?? [board.fullView()];
window.rithmatistHomes = () => session?.state?.homes ?? null;
window.rithmatistState = () => session?.state ?? null;

showChoiceRows();
updateControls();
requestAnimationFrame(frame);
