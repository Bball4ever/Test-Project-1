// A bot that duels. It plays by exactly the same rules as a person: it "draws"
// strokes point by point at its own drawing speed, with a shaky hand, and hands
// the raw points to the engine through `act`. The recognizer scores its lines
// like anyone else's, so a wobbly student draws weaker lines than a professor.
//
// What it can see: the duel state (where everything is). It decides what to do
// next after a short "thinking" pause.

import { CONFIG } from '../config.js';
import { makeRng } from '../random.js';
import { pathLength, resample } from '../recognizer/clean.js';
import { hitSegment, hitCircle } from '../engine/collide.js';
import { mainWard, wallCount } from '../engine/duel.js';
import { depthIn, facingOf } from '../engine/territory.js';
import { findDefense, layoutDefense } from '../data/defenses.js';
import { stickFigure, beetle, urchin, turtle, mirror, fitInside } from '../data/creatures.js';

const PEN_LIFT_MS = 120; // pause between strokes
const CREATURES = { stick: stickFigure, beetle, urchin, turtle };

export class BotController {
  constructor({ owner = 'right', level = 'duelist', seed = 1, cfg = CONFIG } = {}) {
    this.owner = owner;
    this.levelName = level;
    this.level = cfg.bot.levels[level];
    this.cfg = cfg;
    this.rng = makeRng(seed);
    this.plan = null; // what it's drawing right now
    this.saved = null; // a plan put aside to block a wave (top levels)
    this.waitUntil = 500 + this.thinkTime(); // ms of duel time
    this.handled = new Set(); // ids of things it has already reacted to
    this.defenseDone = 0; // how many parts of its defense it has built
    this.state = null; // the duel it's in (set on the first update)
  }

  // Learn where we are on the board: our home, and which way we face (toward
  // the middle). Down-the-side is the direction across that, pointing down
  // the screen when it can (so a 2-player duel is laid out as it always was).
  setup(state) {
    this.state = state;
    this.home = state.homes[this.owner];
    this.facing = facingOf(state, this.owner);
    const across = { x: -this.facing.y, y: this.facing.x };
    this.across = across.y < 0 || (across.y === 0 && across.x < 0) ? { x: -across.x, y: -across.y } : across;
  }

  // The enemy circle to attack: the nearest one still standing.
  targetFoe(state) {
    let best = null;
    for (const w of state.wards) {
      if (!w.main || w.gone || w.owner === this.owner) continue;
      if (!best || dist(this.home, w.center) < dist(this.home, best.center)) best = w;
    }
    return best;
  }

  thinkTime() {
    const [a, b] = this.level.think;
    return a + this.rng() * (b - a);
  }

  // Called every engine step. Returns what it's drawing right now (for the
  // renderer), or null.
  update(state, act) {
    if (state.winner || state.out.includes(this.owner)) return null;
    if (this.state !== state) this.setup(state);
    const now = state.timeMs;
    if (this.plan) {
      // Top levels drop what they're drawing to block an incoming wave, then
      // carry on where they left off.
      if (this.level.interrupts && !this.saved && state.tick % 6 === 0) this.tryInterrupt(state, now);
      // The very best also attack while a chain is being erased, instead of waiting.
      if (this.level.multitask && !this.saved && this.plan.erasing && now - this.plan.startedAt > 300) this.attackWhileErasing(state, now);
      return this.continuePlan(state, act, now);
    }

    // While "thinking", it still glances at incoming danger every so often.
    if (now >= this.waitUntil || (state.tick % 6 === 0 && this.urgent(state))) {
      let plan = this.decide(state);
      // Can it afford all that chalk? If not, don't start.
      const cost = plan?.steps.reduce((sum, s) => sum + (s.kind === 'stroke' ? pathLength(s.points) : 0), 0) ?? 0;
      if (plan && cost > state.chalk[this.owner]) plan = null;
      if (plan) {
        this.plan = { ...plan, index: 0, startedAt: now + (plan.delayMs ?? 0), seed: Math.floor(this.rng() * 1e6) };
      } else {
        this.waitUntil = now + 250;
      }
    }
    return null;
  }

  // A plan is a list of steps: strokes to draw, lines to erase, and checks.
  continuePlan(state, act, now) {
    const plan = this.plan;
    const stepNow = plan.steps[plan.index];
    if (now < plan.startedAt) return null;
    let done = false;
    let live = null;

    if (stepNow.kind === 'stroke') {
      const stroke = stepNow.points;
      const duration = Math.max(120, (pathLength(stroke) / this.level.speed) * 1000);
      const t = (now - plan.startedAt) / duration;
      if (t < 1) {
        live = {
          owner: this.owner,
          seed: plan.seed + plan.index,
          making: !!stepNow.making,
          points: stroke.slice(0, Math.max(2, Math.ceil(t * stroke.length))),
        };
      } else {
        act({ type: 'stroke', points: stroke, making: !!stepNow.making, detail: !!stepNow.detail });
        done = true;
      }
    } else if (stepNow.kind === 'erase') {
      // Click the line with the eraser, then wait the 3 seconds for it to go.
      const elapsed = now - plan.startedAt;
      if (!plan.erasing) {
        act({ type: 'erase', at: stepNow.at });
        plan.erasing = true;
      }
      if (elapsed >= stepNow.ms) {
        plan.erasing = false;
        done = true;
      }
    } else if (stepNow.kind === 'check') {
      if (!stepNow.test(state)) {
        this.endPlan(now);
        return null;
      }
      done = true;
    }

    if (done) {
      plan.index++;
      plan.startedAt = now + PEN_LIFT_MS;
      if (plan.index >= plan.steps.length) this.endPlan(now);
    }
    return live;
  }

  endPlan(now) {
    if (this.saved) {
      // Back to what it was doing before it was interrupted. (An erase keeps
      // its own clock: the line has been fading the whole time.)
      this.plan = this.saved;
      this.saved = null;
      if (!this.plan.erasing) this.plan.startedAt = now + PEN_LIFT_MS;
      return;
    }
    this.plan = null;
    this.waitUntil = now + this.thinkTime();
  }

  attackWhileErasing(state, now) {
    const foe = this.targetFoe(state);
    const wave = foe && this.vigorPlan(state, foe);
    const cost = wave?.steps.reduce((sum, s) => sum + pathLength(s.points), 0) ?? Infinity;
    if (cost > state.chalk[this.owner]) return;
    this.saved = this.plan;
    this.plan = { ...wave, index: 0, startedAt: now, seed: Math.floor(this.rng() * 1e6) };
  }

  tryInterrupt(state, now) {
    const me = mainWard(state, this.owner);
    const vigor = me && this.incomingVigor(state, me);
    if (!vigor) return;
    this.handled.add(vigor.v.id);
    if (this.rng() >= this.level.defendChance) return;
    const wall = this.wallPlan(state, me, vigor);
    const cost = wall?.steps.reduce((sum, s) => sum + pathLength(s.points), 0) ?? Infinity;
    if (cost > state.chalk[this.owner]) return;
    this.saved = this.plan;
    this.plan = { ...wall, index: 0, startedAt: now + (wall.delayMs ?? 0), seed: Math.floor(this.rng() * 1e6) };
  }

  // --- Deciding what to do ---------------------------------------------------

  urgent(state) {
    const me = mainWard(state, this.owner);
    return me && (this.incomingVigor(state, me) || this.incomingChalkling(state, me));
  }

  decide(state) {
    const me = mainWard(state, this.owner);
    if (!me) return this.circlePlan();

    // 1. Block a Line of Vigor that's about to hit us.
    const vigor = this.incomingVigor(state, me);
    if (vigor) {
      this.handled.add(vigor.v.id);
      if (this.rng() < this.level.defendChance) {
        const wall = this.wallPlan(state, me, vigor);
        if (wall) return wall;
      }
    }

    // 2. Shoot an enemy chalkling marching on us.
    const creature = this.incomingChalkling(state, me);
    if (creature) {
      this.handled.add(creature.id);
      if (this.rng() < this.level.counterChance) {
        const shot = this.shootAt(state, me, creature);
        if (shot) return shot;
      }
    }

    // A chain left over from a chalkling that didn't work out (say, it ended
    // up on one of our own chalklings): rub it out, or it blocks new ones.
    const stray = state.chains.find((c) => c.owner === this.owner);
    if (stray) {
      const at = { x: (stray.from.x + stray.to.x) / 2, y: (stray.from.y + stray.to.y) / 2 };
      return { steps: [{ kind: 'erase', at, ms: this.cfg.making.eraseMs + 300 }] };
    }

    // 3. Build its defense, a piece at a time.
    const defense = this.defensePlan(state, me);
    if (defense) return defense;

    // 4. Attack.
    const foe = this.targetFoe(state);
    if (!foe) return null;
    if (this.rng() < this.level.makeChance) return this.chalklingPlan(state, me, foe) ?? this.vigorPlan(state, foe);
    return this.vigorPlan(state, foe) ?? this.chalklingPlan(state, me, foe);
  }

  // An enemy Vigor heading for our main circle, not yet reacted to.
  // `hit` is where it would first strike one of our circles (maybe a shield).
  incomingVigor(state, me) {
    for (const v of state.vigors) {
      if (this.handled.has(v.id) || v.owner === this.owner) continue;
      const ahead = { x: v.pos.x + v.vel.x * 3, y: v.pos.y + v.vel.y * 3 };
      if (!hitCircle(v.pos, ahead, me.center, me.radius)) continue;
      let hit = null;
      for (const w of state.wards) {
        if (w.owner !== this.owner) continue;
        const h = hitCircle(v.pos, ahead, w.center, w.radius);
        if (h && (!hit || h.t < hit.t)) hit = h;
      }
      if (state.walls.some((w) => hitSegment(v.pos, hit.point, w.from, w.to))) continue;
      return { v, hit };
    }
    return null;
  }

  incomingChalkling(state, me) {
    return state.chalklings.find(
      (c) =>
        c.owner !== this.owner &&
        !this.handled.has(c.id) &&
        Math.hypot(c.pos.x - me.center.x, c.pos.y - me.center.y) < me.radius + 420,
    );
  }

  // --- Plans: each is a list of strokes to draw ---------------------------------

  circlePlan() {
    const r = this.cfg.bot.homeRadius;
    const shift = (this.rng() - 0.5) * 60; // a little to one side of home
    const center = { x: this.home.x + this.across.x * shift, y: this.home.y + this.across.y * shift };
    const start = Math.atan2(this.facing.y, this.facing.x); // start on the side facing the middle
    const points = [];
    for (let i = 0; i <= 92; i++) {
      const a = start + (i / 88) * 2 * Math.PI;
      points.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
    }
    return this.strokePlan(points);
  }

  // A wall across the Vigor's path, a little before it would hit us.
  wallPlan(state, me, { v, hit }) {
    if (wallCount(state, this.owner) >= this.cfg.engine.maxWalls) return null;
    const speed = Math.hypot(v.vel.x, v.vel.y);
    const dir = { x: v.vel.x / speed, y: v.vel.y / speed };
    const center = { x: hit.point.x - dir.x * 60, y: hit.point.y - dir.y * 60 };
    const n = { x: -dir.y, y: dir.x };
    const half = 80;
    let from = { x: center.x - n.x * half, y: center.y - n.y * half };
    let to = { x: center.x + n.x * half, y: center.y + n.y * half };
    if (!this.onMySide(from) || !this.onMySide(to)) return null;
    // Is there time to draw it before the Vigor gets there?
    const reaction = this.level.think[0] * 0.5;
    const drawMs = ((2 * half) / this.level.speed) * 1000;
    const arriveMs = (Math.hypot(center.x - v.pos.x, center.y - v.pos.y) / speed) * 1000;
    if (reaction + drawMs > arriveMs) return null;
    return { ...this.strokePlan(line(from, to)), delayMs: reaction };
  }

  // A Vigor aimed at an enemy chalkling, from just outside our own circle.
  shootAt(state, me, c) {
    const away = norm({ x: c.pos.x - me.center.x, y: c.pos.y - me.center.y });
    const tip = { x: me.center.x + away.x * (me.radius + 45), y: me.center.y + away.y * (me.radius + 45) };
    if (!this.onMySide(tip) || Math.hypot(c.pos.x - tip.x, c.pos.y - tip.y) < 60) return null;
    // Lead the target a little: it's walking toward us.
    const flight = Math.hypot(c.pos.x - tip.x, c.pos.y - tip.y) / this.cfg.engine.vigorSpeed;
    const aim = { x: c.pos.x - away.x * c.speed * flight, y: c.pos.y - away.y * c.speed * flight };
    return this.wavePlan(tip, norm({ x: aim.x - tip.x, y: aim.y - tip.y }), 'spiky');
  }

  defensePlan(state, me) {
    const want = { none: 0, shield: 1, full: 2 }[this.level.defense];
    if (this.defenseDone >= want) return null;
    if (wallCount(state, this.owner) >= this.cfg.engine.maxWalls) return null;
    const parts = layoutDefense(findDefense('placeholder'), me, this.owner === 'left' || this.owner === 'right' ? this.owner : this.facing);
    const part = parts[this.defenseDone++];
    if (part.type === 'circle') {
      const points = [];
      for (let i = 0; i <= 40; i++) {
        const a = Math.PI + (i / 38) * 2 * Math.PI;
        points.push({ x: part.center.x + part.radius * Math.cos(a), y: part.center.y + part.radius * Math.sin(a) });
      }
      return this.strokePlan(points);
    }
    return this.strokePlan(line(part.from, part.to));
  }

  // Waves are launched from near the edge of our territory, toward the foe:
  // 110 to 150 inside the border, and up to 330 to either side.
  vigorPlan(state, foe) {
    const targets = this.pickTargets(foe);
    const toward = norm({ x: state.homes[foe.owner].x - this.home.x, y: state.homes[foe.owner].y - this.home.y });
    const across = { x: -toward.y, y: toward.x };
    const side = across.y < 0 || (across.y === 0 && across.x < 0) ? { x: -across.x, y: -across.y } : across;
    for (const target of targets) {
      for (let tries = 0; tries < 4; tries++) {
        const base = this.pointAtDepth(state, toward, 110 + this.rng() * 40);
        const off = Math.max(-330, Math.min(330, (target.x - base.x) * side.x + (target.y - base.y) * side.y + (this.rng() - 0.5) * 260));
        const tip = { x: base.x + side.x * off, y: base.y + side.y * off };
        const dir = norm({ x: target.x - tip.x, y: target.y - tip.y });
        if (this.level.aim === 'random' || this.laneIsClear(state, foe, tip, target, dir)) return this.wavePlan(tip, dir);
      }
    }
    // With several players, if every lane is blocked, throw a curved wave
    // anyway: it smashes the walls in the way (curved waves are best at that).
    if (state.players.length > 2 && targets.length) {
      const base = this.pointAtDepth(state, toward, 130);
      if (this.onMySide(base)) return this.wavePlan(base, norm({ x: targets[0].x - base.x, y: targets[0].y - base.y }));
    }
    return null;
  }

  // The point straight out from home toward `dir` that is `depth` inside our
  // territory (found by halving the search range).
  pointAtDepth(state, dir, depth) {
    let lo = 0;
    let hi = Math.hypot(state.cfg.world.width, state.cfg.world.height);
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const p = { x: this.home.x + dir.x * mid, y: this.home.y + dir.y * mid };
      if (depthIn(state, this.owner, p).depth > depth) lo = mid;
      else hi = mid;
    }
    return { x: this.home.x + dir.x * lo, y: this.home.y + dir.y * lo };
  }

  // Which spots on the enemy circle to aim at, best first.
  pickTargets(foe) {
    const n = foe.sections.length;
    const theirHome = this.state.homes[foe.owner];
    const facing = Math.atan2(this.home.y - theirHome.y, this.home.x - theirHome.x); // the side of their circle facing us
    const options = [];
    foe.sections.forEach((s, k) => {
      const a = ((k + 0.5) / n) * Math.PI * 2;
      let diff = Math.abs(a - facing) % (2 * Math.PI);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff > (70 * Math.PI) / 180) return;
      const point = { x: foe.center.x + Math.cos(a) * foe.radius, y: foe.center.y + Math.sin(a) * foe.radius };
      options.push({ ...point, health: s.health, ratio: s.health / s.max });
    });
    const shuffled = options.map((o) => ({ o, r: this.rng() })).sort((a, b) => a.r - b.r).map((x) => x.o);
    if (this.level.aim === 'random') return shuffled.slice(0, 1);
    if (this.level.aim === 'damaged' && this.rng() < 0.5) return shuffled.slice(0, 3);
    const key = this.level.aim === 'weakest' ? 'health' : 'ratio';
    return shuffled.sort((a, b) => a[key] - b[key]).slice(0, 3);
  }

  // Would a Vigor from tip toward target actually reach that spot?
  laneIsClear(state, foe, tip, target, dir) {
    const past = { x: target.x + dir.x * 2, y: target.y + dir.y * 2 };
    if (state.walls.some((w) => hitSegment(tip, past, w.from, w.to))) return false;
    if (state.wards.some((w) => w !== foe && w.owner !== this.owner && hitCircle(tip, past, w.center, w.radius))) return false;
    const first = hitCircle(tip, past, foe.center, foe.radius);
    return first && Math.hypot(first.point.x - target.x, first.point.y - target.y) < 25;
  }

  // A wave that ends at `tip` and travels along `dir`.
  // A wave ending at `tip`, flying along `dir`. Curved waves are for circles
  // and walls; spiky (zigzag) ones are for chalklings.
  wavePlan(tip, dir, style = 'curved') {
    const length = 170;
    const amplitude = style === 'spiky' ? 26 : 18;
    const cycles = 3;
    const n = { x: -dir.y, y: dir.x };
    const points = [];
    for (let i = 0; i <= 80; i++) {
      const f = i / 80;
      const along = -length + f * length;
      const phase = f * cycles * 2 * Math.PI;
      // Spiky: narrow points (a zigzag pinched toward the center line).
      const zig = (2 / Math.PI) * Math.asin(Math.sin(phase));
      const swing = style === 'spiky' ? Math.sign(zig) * Math.abs(zig) ** 1.6 : Math.sin(phase);
      const side = amplitude * swing;
      points.push({ x: tip.x + dir.x * along + n.x * side, y: tip.y + dir.y * along + n.y * side });
    }
    if (!points.every((p) => this.onMySide(p))) return null;
    return this.strokePlan(points);
  }

  // Make a chalkling the book way: a chain from the bind point facing down
  // (or up), a holding circle on its end, the creature inside, a path to the
  // enemy circle, then erase the chain to set it loose.
  chalklingPlan(state, me, foe) {
    if (state.chains.some((c) => c.owner === this.owner)) return null; // one at a time
    const r = this.level.holdRadius ?? 60;
    for (const sign of [1, -1]) {
      // The bind point pointing most nearly sideways (across the way we face):
      // in a 2-player duel, straight down, then straight up.
      const want = { x: this.across.x * sign, y: this.across.y * sign };
      const angle = me.bindAngles.reduce((best, a) => {
        const fit = Math.cos(a) * want.x + Math.sin(a) * want.y;
        return fit > 0.6 && (best === undefined || fit > Math.cos(best) * want.x + Math.sin(best) * want.y) ? a : best;
      }, undefined);
      if (angle === undefined) continue;
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      const bind = { x: me.center.x + dir.x * me.radius, y: me.center.y + dir.y * me.radius };
      const end = { x: bind.x + dir.x * 80, y: bind.y + dir.y * 80 };
      const center = { x: end.x + dir.x * r, y: end.y + dir.y * r };
      // Not where one of our own chalklings is standing (the chain would grab it).
      const crowded = state.chalklings.some((c) => c.owner === this.owner && !c.gone && dist(c.pos, center) < r + c.radius + 30);
      if (crowded) continue;
      if (!this.onMySide({ x: center.x + dir.x * r, y: center.y + dir.y * r })) continue; // the far edge of the holding circle

      const ring = [];
      const start = Math.atan2(-dir.y, -dir.x); // start drawing where the chain touches
      for (let i = 0; i <= 44; i++) {
        const a = start + (i / 42) * 2 * Math.PI;
        ring.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
      }
      let creature = CREATURES[this.level.creature](0, 0);
      if (foe.center.x < me.center.x) creature = mirror(creature, 0); // face the enemy
      creature = fitInside(creature, center, r * 0.92);

      const toEnemy = norm({ x: foe.center.x - center.x, y: foe.center.y - center.y });
      const pathStart = { x: center.x + toEnemy.x * r * 0.92, y: center.y + toEnemy.y * r * 0.92 };
      const chainMid = { x: (bind.x + end.x) / 2, y: (bind.y + end.y) / 2 };

      return {
        steps: [
          // Chalkling mode on for the chain, circle, creature and path.
          { kind: 'stroke', points: this.shaky(line(bind, end)), making: true },
          { kind: 'stroke', points: this.shaky(ring), making: true },
          { kind: 'check', test: (s) => s.wards.some((w) => w.owner === this.owner && w.holding) },
          // Top levels draw the creature in the detail screen (it counts for more).
          ...creature.map((stroke) => ({ kind: 'stroke', points: this.shaky(stroke), making: true, detail: !!this.level.detailScreen })),
          // A path straight at the enemy circle, unless that would run through
          // our own circle: then no path, and it marches there by itself.
          ...(hitCircle(pathStart, foe.center, me.center, me.radius + 10) ? [] : [{ kind: 'stroke', points: this.shaky(line(pathStart, foe.center)), making: true }]),
          { kind: 'erase', at: chainMid, ms: this.cfg.making.eraseMs + 300 },
        ],
      };
    }
    return null;
  }

  strokePlan(points) {
    return { steps: [{ kind: 'stroke', points: this.shaky(points) }] };
  }

  // Add a hand wobble: a slow drift plus a little jitter.
  shaky(points) {
    const even = resample(points, 4);
    const noise = this.level.noise;
    let dx = 0;
    let dy = 0;
    return even.map((p) => {
      dx = dx * 0.9 + (this.rng() - 0.5) * noise * 0.6;
      dy = dy * 0.9 + (this.rng() - 0.5) * noise * 0.6;
      return { x: p.x + dx + (this.rng() - 0.5) * noise * 0.4, y: p.y + dy + (this.rng() - 0.5) * noise * 0.4 };
    });
  }

  onMySide(p) {
    const { width, height } = this.state.cfg.world;
    const inBoard = p.x > 10 && p.x < width - 10 && p.y > 10 && p.y < height - 10;
    return inBoard && depthIn(this.state, this.owner, p).depth > 6;
  }
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function line(a, b) {
  return Array.from({ length: 31 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / 30, y: a.y + ((b.y - a.y) * i) / 30 }));
}

function norm(v) {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}
