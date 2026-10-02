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
import { mainWard, otherSide } from '../engine/duel.js';
import { findDefense, layoutDefense } from '../data/defenses.js';
import { stickFigure, beetle, mirror } from '../data/creatures.js';

const PEN_LIFT_MS = 120; // pause between strokes of a chalkling

export class BotController {
  constructor({ owner = 'right', level = 'duelist', seed = 1, cfg = CONFIG } = {}) {
    this.owner = owner;
    this.levelName = level;
    this.level = cfg.bot.levels[level];
    this.cfg = cfg;
    this.rng = makeRng(seed);
    this.plan = null; // what it's drawing right now
    this.waitUntil = 500 + this.thinkTime(); // ms of duel time
    this.handled = new Set(); // ids of things it has already reacted to
    this.defenseDone = 0; // how many parts of its defense it has built
    const mid = cfg.engine.world.width / 2;
    this.dirToEnemy = owner === 'left' ? 1 : -1;
    this.home = { x: mid - this.dirToEnemy * 400, y: 450 };
    this.launchX = mid - this.dirToEnemy * 110; // where its waves are aimed from
  }

  thinkTime() {
    const [a, b] = this.level.think;
    return a + this.rng() * (b - a);
  }

  // Called every engine step. Returns what it's drawing right now (for the
  // renderer), or null.
  update(state, act) {
    if (state.winner) return null;
    const now = state.timeMs;
    if (this.plan) return this.continuePlan(state, act, now);

    // While "thinking", it still glances at incoming danger every so often.
    if (now >= this.waitUntil || (state.tick % 6 === 0 && this.urgent(state))) {
      const plan = this.decide(state);
      if (plan) {
        this.plan = { ...plan, index: 0, startedAt: now + (plan.delayMs ?? 0) };
      } else {
        this.waitUntil = now + 250;
      }
    }
    return null;
  }

  continuePlan(state, act, now) {
    const plan = this.plan;
    const stroke = plan.strokes[plan.index];
    const duration = Math.max(120, (pathLength(stroke) / this.level.speed) * 1000);
    const t = (now - plan.startedAt) / duration;
    if (t < 0) return null;
    if (t < 1) {
      return {
        owner: this.owner,
        seed: plan.seed + plan.index,
        making: plan.kind === 'chalkling',
        points: stroke.slice(0, Math.max(2, Math.ceil(t * stroke.length))),
        draft: plan.kind === 'chalkling' ? plan.strokes.slice(0, plan.index) : null,
      };
    }
    // Finished this stroke.
    if (plan.kind === 'chalkling' && plan.index < plan.strokes.length - 1) {
      plan.index++;
      plan.startedAt = now + PEN_LIFT_MS;
      return null;
    }
    if (plan.kind === 'chalkling') act({ type: 'chalkling', strokes: plan.strokes });
    else act({ type: 'stroke', points: stroke });
    this.plan = null;
    this.waitUntil = now + this.thinkTime();
    return null;
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

    // 3. Build its defense, a piece at a time.
    const defense = this.defensePlan(me);
    if (defense) return defense;

    // 4. Attack.
    const foe = mainWard(state, otherSide(this.owner));
    if (!foe) return null;
    if (this.rng() < this.level.makeChance) return this.chalklingPlan();
    return this.vigorPlan(state, foe) ?? this.chalklingPlan();
  }

  // An enemy Vigor heading for our main circle, not yet reacted to.
  // `hit` is where it would first strike one of our circles (maybe a shield).
  incomingVigor(state, me) {
    for (const v of state.vigors) {
      if (this.handled.has(v.id) || (v.owner === this.owner && !v.armed)) continue;
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
    const cy = this.home.y + (this.rng() - 0.5) * 60;
    const start = this.owner === 'left' ? 0 : Math.PI;
    const points = [];
    for (let i = 0; i <= 92; i++) {
      const a = start + (i / 88) * 2 * Math.PI;
      points.push({ x: this.home.x + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return this.strokePlan(points);
  }

  // A wall across the Vigor's path, a little before it would hit us.
  wallPlan(state, me, { v, hit }) {
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
    return this.wavePlan(tip, norm({ x: aim.x - tip.x, y: aim.y - tip.y }));
  }

  defensePlan(me) {
    const want = { none: 0, shield: 1, full: 3 }[this.level.defense];
    if (this.defenseDone >= want) return null;
    const parts = layoutDefense(findDefense('placeholder'), me, this.owner);
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

  vigorPlan(state, foe) {
    const targets = this.pickTargets(foe);
    for (const target of targets) {
      for (let tries = 0; tries < 4; tries++) {
        const tip = {
          x: this.launchX - this.dirToEnemy * this.rng() * 40,
          y: Math.max(120, Math.min(780, target.y + (this.rng() - 0.5) * 260)),
        };
        const dir = norm({ x: target.x - tip.x, y: target.y - tip.y });
        if (this.level.aim === 'random' || this.laneIsClear(state, foe, tip, target, dir)) return this.wavePlan(tip, dir);
      }
    }
    return null;
  }

  // Which spots on the enemy circle to aim at, best first.
  pickTargets(foe) {
    const n = foe.sections.length;
    const facing = this.owner === 'left' ? Math.PI : 0; // the side of their circle facing us
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
  wavePlan(tip, dir) {
    const length = 170;
    const amplitude = 18;
    const cycles = 3;
    const n = { x: -dir.y, y: dir.x };
    const points = [];
    for (let i = 0; i <= 80; i++) {
      const f = i / 80;
      const along = -length + f * length;
      const side = amplitude * Math.sin(f * cycles * 2 * Math.PI);
      points.push({ x: tip.x + dir.x * along + n.x * side, y: tip.y + dir.y * along + n.y * side });
    }
    if (!points.every((p) => this.onMySide(p))) return null;
    return this.strokePlan(points);
  }

  chalklingPlan() {
    const mid = this.cfg.engine.world.width / 2;
    const cx = mid - this.dirToEnemy * (170 + this.rng() * 60);
    const cy = 220 + this.rng() * 460;
    const draw = this.level.creature === 'beetle' ? beetle : stickFigure;
    let strokes = draw(cx, cy);
    if (this.dirToEnemy < 0) strokes = mirror(strokes, cx);
    return { kind: 'chalkling', strokes: strokes.map((s) => this.shaky(s)), seed: Math.floor(this.rng() * 1e6) };
  }

  strokePlan(points) {
    return { kind: 'stroke', strokes: [this.shaky(points)], seed: Math.floor(this.rng() * 1e6) };
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
    const mid = this.cfg.engine.world.width / 2;
    const { width, height } = this.cfg.engine.world;
    const inBoard = p.x > 10 && p.x < width - 10 && p.y > 10 && p.y < height - 10;
    return inBoard && (this.owner === 'left' ? p.x < mid - 6 : p.x > mid + 6);
  }
}

function line(a, b) {
  return Array.from({ length: 31 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / 30, y: a.y + ((b.y - a.y) * i) / 30 }));
}

function norm(v) {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}
