// The duel engine: holds the state of a duel and applies the rules.
//
// It never touches the canvas or the mouse. Anything that wants to draw
// (a person, the dummy, later a bot or a network player) calls addStroke()
// with raw points, and the engine runs the recognizer itself. Time only moves
// when step() is called, in fixed slices of CONFIG.engine.stepMs.

import { CONFIG } from '../config.js';
import { recognize } from '../recognizer/index.js';
import { pathLength } from '../recognizer/clean.js';
import { hitSegment, hitCircle, sectionAt } from './collide.js';
import { buildSections } from './wards.js';
import { bindAngles, attach } from './bind.js';
import { emit, otherSide, damageSection, damageWall, damageChalkling } from './damage.js';
import { stepChalklings } from './chalklings.js';
import { addMakingStroke, tidy } from './making.js';
import { stepErasing } from './erase.js';

export { otherSide };
export const SIDES = ['left', 'right'];
export const ORDERS = ['attack', 'guard'];

// options.bindPoints: how many bind points each duelist's main circle has,
// e.g. { left: 4, right: 6 }.
// options.chalk: how much chalk each duelist starts with (CONFIG.chalk.supply).
export function createDuel({ cfg = CONFIG.engine, chalkCfg = CONFIG.chalkling, makeCfg = CONFIG.making, powerCfg = CONFIG.powers, bindPoints = {}, chalk = CONFIG.chalk.supply } = {}) {
  return {
    cfg,
    chalkCfg,
    makeCfg,
    powerCfg,
    chalk: { left: chalk, right: chalk }, // chalk each duelist has left
    chalkStart: chalk,
    orders: { left: 'attack', right: 'attack' }, // what each side's chalklings do
    bindPoints: {
      left: bindPoints.left ?? cfg.defaultBindPoints,
      right: bindPoints.right ?? cfg.defaultBindPoints,
    },
    tick: 0,
    timeMs: 0,
    winner: null, // 'left' | 'right' once someone is breached, or 'draw'
    wards: [], // Lines of Warding (circles)
    walls: [], // Lines of Forbiddance
    vigors: [], // Lines of Vigor in flight
    chalklings: [], // Lines of Making, walking about
    chains: [], // chains from bind points to holding circles or chalklings
    paths: [], // paths drawn for chalklings, waiting for their chain to be erased
    erasing: { left: null, right: null }, // the line each side is erasing right now
    events: [], // things that just happened, for the renderer's effects
    nextId: 1,
  };
}

export function mainWard(state, side) {
  return state.wards.find((w) => w.owner === side && w.main);
}

// A duelist draws a stroke. Returns { accepted, result } where result is the
// recognizer's verdict (turned into a dud if a duel rule rejects it).
// making: true when the duelist has Chalkling mode on (see making.js).
export function addStroke(state, owner, rawPoints, { making = false } = {}) {
  if (state.winner || !rawPoints.length) return { accepted: false, result: null };
  const cfg = state.cfg;
  const points = rawPoints.map((p) => ({ x: p.x, y: p.y }));

  // Every stroke uses up chalk equal to its length, whether or not it works.
  const cost = pathLength(points);
  if (cost > state.chalk[owner]) {
    emit(state, { type: 'dud', owner, reason: 'out of chalk', points });
    return { accepted: false, result: { type: 'dud', reason: 'out of chalk', quality: 0, metrics: { length: cost } } };
  }
  state.chalk[owner] -= cost;

  if (making) return addMakingStroke(state, owner, points, mainWard(state, owner));

  const result = recognize(points);

  const reject = (reason) => {
    const dud = { ...result, type: 'dud', reason, guess: result.guess ?? null };
    emit(state, { type: 'dud', owner, reason, points });
    return { accepted: false, result: dud };
  };

  if (!onOwnSide(points, owner, cfg)) return reject('stay on your side');
  if (result.type === 'dud') return reject(result.reason);
  if (result.type !== 'warding' && !mainWard(state, owner)) return reject('draw your circle first');

  const id = state.nextId++;
  const home = mainWard(state, owner);
  if (result.type === 'warding') {
    const ward = {
      id,
      kind: 'ward',
      owner,
      main: !home,
      center: result.shape.center,
      radius: result.shape.radius,
      quality: result.quality,
      sections: buildSections(result, cfg),
      points,
    };
    if (ward.main) ward.bindAngles = bindAngles(state.bindPoints[owner], owner);
    else attachTo(state, home, ward);
    state.wards.push(ward);
  } else if (result.type === 'forbiddance') {
    const health = cfg.wallHealth * result.quality;
    const wall = { id, kind: 'wall', owner, from: result.shape.from, to: result.shape.to, quality: result.quality, health, max: health, points };
    attachTo(state, home, wall);
    state.walls.push(wall);
  } else if (result.type === 'vigor') {
    const { dir, end } = result.shape;
    state.vigors.push({
      id,
      owner,
      quality: result.quality,
      power: cfg.vigorDamage * result.quality,
      pos: { ...end }, // the front tip of the wave
      vel: { x: dir.x * cfg.vigorSpeed, y: dir.y * cfg.vigorSpeed },
      launchTip: { ...end },
      launchDir: { ...dir },
      points,
    });
  }
  emit(state, { type: 'placed', owner, kind: result.type, id, quality: result.quality });
  return { accepted: true, result, id };
}

// Give a side's chalklings an order: 'attack' or 'guard'. It applies to
// chalklings that have finished their paths; ones on a mission, or waiting to
// be chained for a new command, aren't affected.
export function setOrder(state, owner, order) {
  if (!ORDERS.includes(order)) return;
  state.orders[owner] = order;
  for (const c of state.chalklings) if (c.owner === owner && c.mode === 'order') c.order = order;
  emit(state, { type: 'order', owner, order });
}

function attachTo(state, main, thing) {
  for (const touch of attach(main, thing, state.cfg)) {
    emit(state, { type: 'attach', owner: thing.owner, id: thing.id, ...touch });
  }
}

function onOwnSide(points, owner, cfg) {
  const mid = cfg.world.width / 2;
  return owner === 'left'
    ? points.every((p) => p.x <= mid + cfg.sideMargin)
    : points.every((p) => p.x >= mid - cfg.sideMargin);
}

// Advance the duel by one fixed step.
export function step(state) {
  const cfg = state.cfg;
  const dt = cfg.stepMs / 1000;
  state.tick++;
  state.timeMs = state.tick * cfg.stepMs;

  stepErasing(state);
  for (const v of state.vigors) moveVigor(state, v, dt);
  stepChalklings(state, dt);
  tidy(state);
  state.vigors = state.vigors.filter((v) => !v.gone);
  state.wards = state.wards.filter((w) => !w.gone);
  state.walls = state.walls.filter((w) => !w.gone);
  state.chalklings = state.chalklings.filter((c) => !c.gone);

  // Both out of chalk and nothing left moving: nobody can win, so it's a draw.
  const low = CONFIG.chalk.tooLittle;
  if (!state.winner && state.chalk.left < low && state.chalk.right < low && !state.vigors.length && !state.chalklings.length) {
    state.winner = 'draw';
    emit(state, { type: 'draw' });
  }
}

function moveVigor(state, v, dt) {
  const cfg = state.cfg;
  const from = v.pos;
  const to = { x: from.x + v.vel.x * dt, y: from.y + v.vel.y * dt };

  // Find the first thing along the path.
  let first = null;
  for (const wall of state.walls) {
    if (wall.gone) continue;
    const hit = hitSegment(from, to, wall.from, wall.to);
    if (hit && (!first || hit.t < first.t)) first = { ...hit, wall };
  }
  for (const ward of state.wards) {
    if (ward.gone || ward.owner === v.owner) continue; // a Vigor passes through its owner's own circles
    const hit = hitCircle(from, to, ward.center, ward.radius);
    if (hit && (!first || hit.t < first.t)) first = { ...hit, ward };
  }
  for (const c of state.chalklings) {
    if (c.gone || c.owner === v.owner) continue; // ...and its owner's own chalklings
    const hit = hitCircle(from, to, c.pos, c.radius);
    if (hit && (!first || hit.t < first.t)) first = { ...hit, chalkling: c };
  }

  if (!first) {
    v.pos = to;
    const { width, height } = cfg.world;
    if (to.x < 0 || to.x > width || to.y < 0 || to.y > height) {
      v.gone = true;
      emit(state, { type: 'offboard', id: v.id });
    }
    return;
  }

  v.pos = first.point;
  v.gone = true;

  // Hit a wall: Lines of Vigor don't bounce. The wall stops it and takes the damage.
  if (first.wall) {
    const damage = v.power * cfg.wallDamageFromVigor;
    emit(state, { type: 'blocked', id: v.id, wallId: first.wall.id, owner: first.wall.owner, damage, point: first.point });
    damageWall(state, first.wall, damage, first.point);
    return;
  }

  // Hit a chalkling: hurt it, and the Vigor is spent.
  if (first.chalkling) {
    emit(state, { type: 'hit', id: v.id, chalklingId: first.chalkling.id, owner: first.chalkling.owner, damage: v.power, point: first.point });
    damageChalkling(state, first.chalkling, v.power);
    return;
  }

  // Hit a circle: damage the section it struck, then the Vigor is spent.
  const ward = first.ward;
  const index = sectionAt(ward.center, first.point, ward.sections.length);
  emit(state, { type: 'hit', id: v.id, wardId: ward.id, owner: ward.owner, section: index, damage: v.power, point: first.point });
  damageSection(state, ward, index, v.power, first.point);
}
