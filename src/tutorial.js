// The tutorial: a practice board where a new player learns the game one step
// at a time. Each step says what to do, shows a faint dashed "ghost" of what to
// draw and where, and moves on as soon as the player has done it.
//
// This file only holds the steps and decides when each one is done. main.js
// shows the step card, draws the ghosts and passes in what it needs (the `api`):
//   state       the duel (you are 'left', the practice dummy is 'right')
//   seat        your seat (Chalkling mode on? Eraser on?)
//   split       true on the split screen (there is a detail screen)
//   detailShown true when the detail screen is showing a holding circle
//   now         the time, in ms
//   act(action), dummyAct(action)  draw for you / for the dummy
//   setMaking(on), pickDetail(wardId), eraseAt(point)  what the buttons do
// While you learn, both main circles are kept whole, so nobody can lose by
// accident. Only the last step lets you breach the dummy.

import { mainWard } from './engine/duel.js';
import { stickFigure, fitInside } from './data/creatures.js';

const ME = 'left';
const DUMMY = 'right';

// --- Shapes (lists of points) ------------------------------------------------------

function circlePoints(c, r, n = 72) {
  return Array.from({ length: n + 3 }, (_, i) => ({ x: c.x + r * Math.cos((i / n) * 2 * Math.PI), y: c.y + r * Math.sin((i / n) * 2 * Math.PI) }));
}

function linePoints(a, b, n = 24) {
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}

// A wave from `from` to `to` with 4 humps (2 up, 2 down).
export function wavePoints(from, to, amp = 20, n = 96) {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const d = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const side = Math.sin(t * 4 * Math.PI) * amp;
    return { x: from.x + d.x * len * t - d.y * side, y: from.y + d.y * len * t + d.x * side };
  });
}

const norm = (v) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};
const along = (p, d, k) => ({ x: p.x + d.x * k, y: p.y + d.y * k });

// --- Where things go, worked out from your real circle ---------------------------------

const mine = (state) => mainWard(state, ME);
const dummyCircle = (state) => mainWard(state, DUMMY);
const myHolding = (state) => state.wards.find((w) => w.owner === ME && w.holding && !w.gone);

// Step 2's wall: a short line in front of your circle, toward the dummy.
function wallSpot(state) {
  const c = mine(state);
  const x = c.center.x + c.radius + 50;
  return { from: { x, y: c.center.y - 90 }, to: { x, y: c.center.y + 90 } };
}

// Step 3's wave: above your circle, aimed at the dummy.
function waveSpot(state) {
  const c = mine(state);
  const target = dummyCircle(state)?.center ?? { x: 1200, y: 450 };
  const from = { x: c.center.x - 40, y: c.center.y - c.radius - 80 };
  const d = norm({ x: target.x - from.x, y: target.y - from.y });
  return { from, to: along(from, d, 220) };
}

// Step 4: the dummy's wave comes straight at your circle; the wall goes across its path.
function incoming(state) {
  const c = mine(state);
  const tip = { x: 900, y: c.center.y };
  const x = c.center.x + c.radius + 70;
  return { tip, d: { x: -1, y: 0 }, wall: { from: { x, y: c.center.y - 90 }, to: { x, y: c.center.y + 90 } } };
}

// The chalkling: a chain from the bind point that points most downward, and a
// holding circle on its end.
function chainSpot(state) {
  const c = mine(state);
  const a = c.bindAngles.reduce((best, x) => (Math.sin(x) > Math.sin(best) ? x : best));
  const d = { x: Math.cos(a), y: Math.sin(a) };
  const from = along(c.center, d, c.radius);
  const to = along(from, d, 80);
  return { from, to, d, center: along(to, d, 50), r: 50 };
}

function pathSpot(state) {
  const h = myHolding(state);
  const dummy = dummyCircle(state);
  if (!h || !dummy) return null;
  const d = norm({ x: dummy.center.x - h.center.x, y: dummy.center.y - h.center.y });
  return { from: along(h.center, d, h.radius * 0.9), to: along(dummy.center, d, -(dummy.radius + 25)) };
}

// --- The steps ---------------------------------------------------------------------------
// group: which of the numbered lessons it belongs to (the card says "Step 3 of 7").

const GROUPS = ['Your main circle', 'Walls', 'Attacking with waves', 'Blocking', 'Making a chalkling', 'Commanding chalklings', 'Breach!'];

const STEPS = [
  {
    group: 0,
    text: () =>
      'Everything starts with a circle: your <b>Line of Warding</b>. You stand inside it, and if it breaks, you lose. Draw a circle around your duelist, at least as big as the dashed ring. Try to make it round: rounder circles are stronger.',
    guides: (api) => [{ kind: 'circle', center: api.state.homes[ME], r: 120 }],
    done: (api) => !!mine(api.state),
    autofill: (api) => api.act({ type: 'stroke', points: circlePoints(api.state.homes[ME], 120) }),
    praise: (api) => `Circle drawn: it scored ${Math.round(mine(api.state).quality * 100)}%. The score is how round and closed it is.`,
  },
  {
    group: 1,
    text: () =>
      'A straight line is a <b>Line of Forbiddance</b>: a wall. Walls stop waves, and chalklings can\'t walk through them. Draw a straight line along the dashed one, in front of your circle.',
    guides: (api) => [{ kind: 'line', ...wallSpot(api.state) }],
    enter: (api, data) => (data.walls = api.state.walls.filter((w) => w.owner === ME).length),
    done: (api, data) => api.state.walls.filter((w) => w.owner === ME).length > data.walls,
    autofill: (api) => {
      const { from, to } = wallSpot(api.state);
      api.act({ type: 'stroke', points: linePoints(from, to) });
    },
    praise: () => 'Wall up! You can have up to 8 at a time.',
  },
  {
    group: 2,
    text: () =>
      'A wave is a <b>Line of Vigor</b>: your attack. Draw a wavy line with at least <b>3 humps</b>, along the dashed one. It flies the way you drew it, so draw it toward the dummy. Curved humps hit circles and walls harder; spiky, pointed humps hit chalklings harder.',
    guides: (api) => [{ kind: 'wave', arrow: true, ...waveSpot(api.state) }],
    onEvent: (e, api, data) => {
      if (e.type === 'placed' && e.kind === 'vigor' && e.owner === ME) data.spikiness = e.spikiness ?? 0;
    },
    done: (api, data) => data.spikiness != null,
    hold: 1600, // watch it fly
    autofill: (api) => {
      const { from, to } = waveSpot(api.state);
      api.act({ type: 'stroke', points: wavePoints(from, to) });
    },
    praise: (api, data) => `Wave thrown! Yours came out ${Math.round(data.spikiness * 100)}% spiky. (While you learn, circles heal themselves.)`,
  },
  {
    group: 3,
    text: (api, data) =>
      (data.missed ? '<b>It got through.</b> Here it comes again: draw the wall sooner. ' : '') +
      'The dummy is throwing a slow wave at you! (Your first wall is cleared away.) Draw a wall along the dashed line, across its path, before it reaches your circle.',
    guides: (api) => [{ kind: 'line', ...incoming(api.state).wall }],
    enter: (api, data) => {
      data.throwAt = api.now + 1200;
      for (const w of api.state.walls) if (w.owner === ME) w.gone = true;
    },
    tick: (api, data) => {
      if (data.vigorId || api.now < data.throwAt) return;
      const { tip, d } = incoming(api.state);
      const r = api.dummyAct({ type: 'stroke', points: wavePoints(along(tip, d, -170), tip, 18) });
      const v = api.state.vigors.find((x) => x.id === r?.id);
      if (!v) return;
      // Slow, so there's time to read and draw; and harmless.
      v.vel = { x: v.vel.x * 0.2, y: v.vel.y * 0.2 };
      v.power = 0.01;
      data.vigorId = v.id;
    },
    onEvent: (e, api, data) => {
      if (e.id !== data.vigorId) return;
      if (e.type === 'blocked') data.blocked = true;
      if (e.type === 'hit' || e.type === 'offboard') {
        data.missed = true;
        data.vigorId = null;
        data.throwAt = api.now + 1500;
      }
    },
    done: (api, data) => !!data.blocked,
    autofill: (api) => {
      const { from, to } = incoming(api.state).wall;
      api.act({ type: 'stroke', points: linePoints(from, to) });
      for (const v of api.state.vigors) if (v.owner === DUMMY) v.gone = true;
    },
    praise: () => 'Blocked! The wall took the hit. Walls wear down, so a strong attack can break through.',
  },
  {
    group: 4,
    text: () =>
      'Now the best part: a <b>chalkling</b>, a chalk creature that comes alive. It takes a few steps. First, turn on <b>Chalkling</b> mode: press the Chalkling button (or M).',
    done: (api) => api.seat.making,
    autofill: (api) => api.setMaking(true),
  },
  {
    group: 4,
    text: () =>
      'Draw a <b>chain</b>: a short straight line starting on one of the little green ticks on your circle (a bind point), going outward, along the dashed line.',
    guides: (api) => {
      const { from, to } = chainSpot(api.state);
      return [{ kind: 'line', arrow: true, from, to }];
    },
    done: (api) => api.state.chains.some((c) => c.owner === ME),
    autofill: (api) => {
      const { from, to } = chainSpot(api.state);
      api.setMaking(true);
      api.act({ type: 'stroke', points: linePoints(from, to), making: true });
    },
  },
  {
    group: 4,
    text: () => 'On the end of the chain, draw a small circle: the <b>holding circle</b>. Your creature goes inside it.',
    guides: (api) => {
      const { center, r } = chainSpot(api.state);
      return [{ kind: 'circle', center, r }];
    },
    done: (api) => !!myHolding(api.state),
    autofill: (api) => {
      const { center, r } = chainSpot(api.state);
      api.setMaking(true);
      api.act({ type: 'stroke', points: circlePoints(center, r), making: true });
    },
  },
  {
    group: 4,
    skip: (api) => !api.split, // the detail screen is only on the split screen
    text: () =>
      'Creatures are easier to draw big. Press <b>Detail</b> (or F), then tap your holding circle. It appears large in the <b>detail screen</b> (bottom right). Parts drawn there count extra.',
    done: (api) => api.detailShown,
    autofill: (api) => api.pickDetail(myHolding(api.state)?.id),
  },
  {
    group: 4,
    text: (api) =>
      'Draw your creature inside the holding circle' +
      (api.split ? ', in the detail screen' : '') +
      ', in <b>3 or more strokes</b> (a stick figure is fine). More detail makes a stronger chalkling. Round shapes give it more health; pointy ones, more bite; less chalk makes it faster.',
    guides: (api) => {
      const h = myHolding(api.state);
      return h ? fitInside(stickFigure(0, 0), h.center, h.radius * 0.7).map((points) => ({ kind: 'poly', points })) : [];
    },
    done: (api) => (myHolding(api.state)?.creature?.length ?? 0) >= 3,
    autofill: (api) => {
      const h = myHolding(api.state);
      if (!h) return;
      api.setMaking(true);
      for (const points of fitInside(stickFigure(0, 0), h.center, h.radius * 0.7)) api.act({ type: 'stroke', points, making: true, detail: api.split });
    },
  },
  {
    group: 4,
    text: () => 'Now draw its <b>path</b>: a line from the edge of the holding circle to where it should go. Send it at the dummy, along the dashed line.',
    guides: (api) => {
      const p = pathSpot(api.state);
      return p ? [{ kind: 'line', arrow: true, ...p }] : [];
    },
    done: (api) => api.state.paths.some((p) => p.owner === ME),
    autofill: (api) => {
      const p = pathSpot(api.state);
      if (!p) return;
      api.setMaking(true);
      api.act({ type: 'stroke', points: linePoints(p.from, p.to), making: true });
    },
  },
  {
    group: 4,
    text: () =>
      'Last, set it free: press <b>Eraser</b> (or E) and tap the <b>chain</b> (the marked spot). Three seconds later the chain is gone and your chalkling comes alive.',
    guides: (api) => {
      const c = api.state.chains.find((x) => x.owner === ME);
      return c ? [{ kind: 'ring', center: { x: (c.from.x + c.to.x) / 2, y: (c.from.y + c.to.y) / 2 }, r: 16 }] : [];
    },
    done: (api) => api.state.chalklings.some((c) => c.owner === ME && c.mode !== 'held' && c.mode !== 'waiting'),
    autofill: (api) => {
      const c = api.state.chains.find((x) => x.owner === ME);
      if (c) api.eraseAt({ x: (c.from.x + c.to.x) / 2, y: (c.from.y + c.to.y) / 2 });
    },
    praise: () => 'It\'s alive! It walks its path, then attacks. It chews through enemy lines in its way.',
  },
  {
    group: 5,
    text: () =>
      'Chalklings that finish their path follow your orders. Press <b>Guard</b> (or G): they defend your circle. Then press <b>Attack</b> (or A): they march on the enemy. (When making one, the Command buttons can set it to <b>Always attack</b> or <b>Always guard</b> instead, ignoring these orders.)',
    tick: (api, data) => {
      if (api.state.orders[ME] === 'guard') data.guarded = true;
    },
    done: (api, data) => data.guarded && api.state.orders[ME] === 'attack',
    autofill: (api) => api.act({ type: 'order', order: 'attack' }),
    praise: () => 'Orders work! Your chalklings are on the attack.',
  },
  {
    group: 6,
    final: true,
    text: () =>
      'The dummy\'s circle is cracked. <b>Breach it</b> to win: throw waves at it (curved ones hit circles hardest), and your chalkling will help. Breaking any one part of a main circle wins.',
    enter: (api) => {
      const d = dummyCircle(api.state);
      if (d) for (const s of d.sections) s.health = Math.min(s.health, s.max * 0.3);
    },
    guides: (api) => [{ kind: 'wave', arrow: true, ...waveSpot(api.state) }],
    done: (api) => api.state.winner === ME,
    autofill: (api) => {
      const d = dummyCircle(api.state);
      if (d) for (const s of d.sections) s.health = Math.min(s.health, 0.5);
      const { from, to } = waveSpot(api.state);
      api.act({ type: 'stroke', points: wavePoints(from, to) });
    },
  },
];

// Why a stroke didn't count, in plain words.
function explain(reason) {
  const plain = {
    'stay on your side': 'stay on your own half of the board',
    'draw your circle first': 'draw your main circle first',
    'not a known line': "the game couldn't tell what that was. It knows circles, straight lines and waves (3 or more humps)",
    'circle not closed': 'the circle has a gap: end where you started',
    'line too crooked': 'that line is too wobbly for a wall: keep it straight',
    'too short': 'that was too short: draw it longer',
    'circle too small': 'that circle is too small',
  };
  return plain[reason] ?? reason;
}

export class Tutorial {
  constructor() {
    this.index = -1;
    this.data = {};
    this.feedback = ''; // praise for the last step, or why a stroke didn't count
    this.finished = false;
    this.nextAt = null; // a step is done: move on at this time (after a short pause)
  }

  get step() {
    return STEPS[this.index] ?? null;
  }

  start(api) {
    this.goto(0, api);
  }

  goto(i, api) {
    while (STEPS[i]?.skip?.(api)) i++;
    this.index = i;
    this.data = {};
    this.nextAt = null;
    if (!this.step) {
      this.finished = true;
      return;
    }
    this.step.enter?.(api, this.data);
  }

  // Called every frame.
  update(api) {
    const step = this.step;
    if (!step || this.finished) return;
    // Nobody loses by accident while learning.
    if (!step.final) {
      for (const w of api.state.wards) if (w.main) for (const s of w.sections) s.health = s.max;
    }
    step.tick?.(api, this.data);
    if (this.nextAt === null && step.done(api, this.data)) {
      if (step.praise) this.feedback = step.praise(api, this.data);
      else this.feedback = '';
      this.nextAt = api.now + (step.hold ?? 350);
    }
    if (this.nextAt !== null && api.now >= this.nextAt) this.goto(this.index + 1, api);
  }

  onEvent(e, api) {
    if (!this.step) return;
    if (e.type === 'dud' && e.owner === ME && e.reason) this.feedback = `That didn't count: ${explain(e.reason)}. Try again along the dashed line.`;
    this.step.onEvent?.(e, api, this.data);
  }

  // "Skip step": do it for the player, then move on (whether or not the step
  // would count it as done: pressing Skip always moves on, exactly once).
  skip(api) {
    if (!this.step || this.nextAt !== null) return;
    this.step.autofill?.(api, this.data);
    this.feedback = 'Skipped: done for you.';
    this.nextAt = api.now + 600;
  }

  // The dashed ghosts to draw for this step.
  guides(api) {
    if (!this.step?.guides || this.nextAt !== null) return [];
    try {
      return this.step.guides(api, this.data);
    } catch {
      return []; // (something it needs isn't on the board yet)
    }
  }

  card(api) {
    if (this.finished || !this.step) return null;
    return {
      number: this.step.group + 1,
      of: GROUPS.length,
      title: GROUPS[this.step.group],
      text: this.step.text(api, this.data),
      feedback: this.feedback,
    };
  }
}
