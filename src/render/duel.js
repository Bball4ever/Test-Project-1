// Draws a duel. It reads the engine's state and never changes it.
//
// Short-lived visual effects (dust puffs, labels, fading duds) live here, not in
// the engine: they're just decoration, and the duel plays out the same without them.

import { CONFIG } from '../config.js';
import { drawChalk, cacheChalk, cacheChalkStrokes } from './board.js';
import { NAMES } from './feedback.js';

const R = CONFIG.render;

export class DuelRenderer {
  constructor(board) {
    this.board = board;
    this.reset();
  }

  reset() {
    this.caches = new Map(); // id → pre-drawn chalk picture
    this.bands = new Map(); // ward id → how far its chalk strays from the circle
    this.effects = [];
    this.version = this.board.version;
  }

  // Pre-draw a line's chalk once; redraw only if the screen was resized.
  cached(key, points, seed, color = R.chalkColor, strokes = null) {
    if (this.version !== this.board.version) {
      this.caches.clear();
      this.version = this.board.version;
    }
    let c = this.caches.get(key);
    if (!c) {
      c = strokes
        ? cacheChalkStrokes(strokes, seed, this.board.resolution, color)
        : cacheChalk(points, seed, this.board.resolution, color);
      this.caches.set(key, c);
    }
    return c;
  }

  // Turn an engine event into something to see.
  handleEvent(e, state, now) {
    const fx = this.effects;
    if (e.type === 'placed') {
      const thing = [...state.wards, ...state.walls, ...state.vigors, ...state.chalklings].find((t) => t.id === e.id);
      if (!thing) return;
      const top = topOf(thing.points ?? thing.strokes.flat());
      const text =
        e.kind === 'chalkling'
          ? `Chalkling: ${Math.round(thing.hp)} health, bite ${thing.bite.toFixed(0)}`
          : `${thing.main ? 'Main circle' : NAMES[e.kind]} ${Math.round(e.quality * 100)}%`;
      fx.push({ kind: 'label', text, x: top.x, y: top.y - 10, born: now, life: 2500, color: R.chalkColor });
    } else if (e.type === 'dud') {
      if (!e.points.length) return;
      const top = topOf(e.points);
      const cache = e.strokes
        ? cacheChalkStrokes(e.strokes, e.tick * 31 + 7, this.board.resolution, R.dudColor)
        : cacheChalk(e.points, e.tick * 31 + 7, this.board.resolution, R.dudColor);
      fx.push({ kind: 'dud', cache, born: now, life: R.dudFadeMs });
      fx.push({ kind: 'label', text: e.reason, x: top.x, y: top.y - 10, born: now, life: R.dudFadeMs, color: R.dudColor });
    } else if (e.type === 'attach') {
      const text = e.bound ? `Bound +${Math.round(CONFIG.engine.boundBonus * 100)}%` : `Off point -${Math.round(CONFIG.engine.offPointPenalty * 100)}%`;
      fx.push({ kind: 'label', text, x: e.point.x, y: e.point.y + 30, rise: -12, born: now, life: 2200, color: e.bound ? R.boundColor : R.dudColor, size: 15 });
      fx.push(dust(e.point, now, 6, 30));
    } else if (e.type === 'hit') {
      fx.push(dust(e.point, now, 16, 70));
      fx.push({ kind: 'label', text: `-${Math.round(e.damage)}`, x: e.point.x, y: e.point.y - 14, rise: 30, born: now, life: 1100, color: R.dudColor });
    } else if (e.type === 'bounce' || e.type === 'fizzle') {
      fx.push(dust(e.point, now, 8, 40));
    } else if (e.type === 'chalklingDied') {
      fx.push(dust(e.point, now, 28, 90));
    } else if (e.type === 'wallBroken') {
      fx.push(dust(e.point, now, 24, 80));
    } else if (e.type === 'shieldBroken') {
      fx.push(dust(e.point, now, 30, 110));
    } else if (e.type === 'breach') {
      fx.push(dust(e.point, now, 60, 180));
      fx.push({ kind: 'ring', x: e.point.x, y: e.point.y, born: now, life: 900 });
      fx.push({ kind: 'label', text: 'BREACH!', x: e.point.x, y: e.point.y - 30, rise: 40, born: now, life: 2200, color: R.dudColor, size: 34 });
    }
  }

  // template: optional { parts, done, anchor, showMain } from a practice defense.
  // drafts: chalklings still being drawn in Making mode (lists of strokes).
  draw(state, liveStrokes, now, template = null, drafts = []) {
    const ctx = this.board.ctx;
    if (template) drawTemplate(ctx, template);

    for (const wall of state.walls) {
      const c = this.cached(wall.id, wall.points, wall.id * 7919);
      ctx.drawImage(c.canvas, c.x, c.y, c.w, c.h);
    }

    for (const ward of state.wards) {
      const c = this.cached(ward.id, ward.points, ward.id * 7919);
      ctx.drawImage(c.canvas, c.x, c.y, c.w, c.h);
      this.drawDamage(ctx, ward);
      if (ward.main) {
        drawBindPoints(ctx, ward);
        drawDuelist(ctx, ward.center);
      }
    }

    for (const v of state.vigors) {
      // The Vigor is your actual drawing, slid along and turned to face where it's going.
      const c = this.cached(v.id, v.points, v.id * 7919);
      const turn = Math.atan2(v.vel.y, v.vel.x) - Math.atan2(v.launchDir.y, v.launchDir.x);
      ctx.save();
      ctx.translate(v.pos.x, v.pos.y);
      ctx.rotate(turn);
      ctx.translate(-v.launchTip.x, -v.launchTip.y);
      ctx.globalAlpha = 0.4 + 0.6 * Math.min(1, v.power / (CONFIG.engine.vigorDamage * v.quality));
      ctx.drawImage(c.canvas, c.x, c.y, c.w, c.h);
      ctx.restore();
    }

    for (const c of state.chalklings) this.drawChalkling(ctx, c, now);

    for (const draft of drafts) draft.forEach((stroke, i) => drawChalk(ctx, stroke, 900 + i, R.makingColor));
    for (const live of liveStrokes) drawChalk(ctx, live.points, live.seed, live.making ? R.makingColor : R.chalkColor);

    this.drawEffects(ctx, now);
  }

  // A chalkling is its own drawing, moved to where it is now, with a little
  // animation: bobbing as it walks, shaking as it chews or fights.
  drawChalkling(ctx, c, now) {
    const pic = this.cached(`c${c.id}`, null, c.id * 7919, R.chalkColor, c.strokes);
    const phase = now / 90 + c.id;
    let dx = 0;
    let dy = 0;
    let tilt = 0;
    if (c.action === 'walk') {
      dy = -Math.abs(Math.sin(phase)) * 4;
      tilt = Math.sin(phase) * 0.05;
    } else if (c.action === 'chew' || c.action === 'fight') {
      dx = Math.sin(phase * 3) * 2.5 * c.facing;
      tilt = Math.sin(phase * 3) * 0.06;
    } else {
      dy = Math.sin(now / 400 + c.id) * 1.2;
    }

    ctx.save();
    // Team shadow underneath.
    ctx.fillStyle = `rgba(${R.teamColors[c.owner]}, 0.18)`;
    ctx.beginPath();
    ctx.ellipse(c.pos.x, c.pos.y + c.radius * 0.8, c.radius, c.radius * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(c.pos.x + dx, c.pos.y + dy);
    ctx.rotate(tilt);
    ctx.translate(-c.origin.x, -c.origin.y);
    ctx.drawImage(pic.canvas, pic.x, pic.y, pic.w, pic.h);
    ctx.restore();

    if (c.hp < c.max) {
      const w = Math.max(30, c.radius * 1.4);
      const x = c.pos.x - w / 2;
      const y = c.pos.y - c.radius - 14;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x, y, w, 4);
      ctx.fillStyle = `rgba(${R.teamColors[c.owner]}, 0.9)`;
      ctx.fillRect(x, y, (w * c.hp) / c.max, 4);
      ctx.restore();
    }
  }

  // Rub out damaged sections: draw the bare board back over them,
  // more strongly the more damage they've taken.
  drawDamage(ctx, ward) {
    const n = ward.sections.length;
    const band = this.bandFor(ward);
    const { x, y } = ward.center;
    const { width, height } = this.board.world;
    ward.sections.forEach((s, k) => {
      const lost = 1 - s.health / s.max;
      if (lost <= 0) return;
      const a0 = (k / n) * Math.PI * 2;
      const a1 = ((k + 1) / n) * Math.PI * 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, ward.radius + band, a0, a1);
      ctx.arc(x, y, Math.max(0, ward.radius - band), a1, a0, true);
      ctx.closePath();
      ctx.clip();
      ctx.globalAlpha = s.health <= 0 ? 1 : Math.min(0.92, 0.2 + lost * 0.8);
      ctx.drawImage(this.board.background, 0, 0, width, height);
      ctx.restore();
    });
  }

  bandFor(ward) {
    let band = this.bands.get(ward.id);
    if (band === undefined) {
      band = 0;
      for (const p of ward.points) band = Math.max(band, Math.abs(Math.hypot(p.x - ward.center.x, p.y - ward.center.y) - ward.radius));
      band += R.chalkWidth * 2 + 4;
      this.bands.set(ward.id, band);
    }
    return band;
  }

  drawEffects(ctx, now) {
    this.effects = this.effects.filter((f) => now - f.born < f.life);
    for (const f of this.effects) {
      const t = (now - f.born) / f.life; // 0 → 1 over the effect's life
      ctx.save();
      if (f.kind === 'dud') {
        ctx.globalAlpha = 1 - t;
        ctx.drawImage(f.cache.canvas, f.cache.x, f.cache.y, f.cache.w, f.cache.h);
      } else if (f.kind === 'label') {
        ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
        ctx.font = R.labelFont.replace(/^\d+px/, `${f.size ?? 18}px`);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = `rgba(${f.color}, 0.9)`;
        ctx.fillText(f.text, clampX(f.x, this.board.world.width), Math.max(24, f.y - (f.rise ?? 0) * t));
      } else if (f.kind === 'dust') {
        ctx.fillStyle = `rgba(${R.chalkColor}, ${0.7 * (1 - t)})`;
        const secs = (now - f.born) / 1000;
        for (const p of f.specks) ctx.fillRect(p.x + p.vx * secs, p.y + p.vy * secs + 40 * secs * secs, p.size, p.size);
      } else if (f.kind === 'ring') {
        ctx.strokeStyle = `rgba(${R.dudColor}, ${1 - t})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 10 + t * 90, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

// A puff of chalk dust. (Math.random is fine here: it's only decoration.)
function dust(point, now, count, speed) {
  const specks = Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.3 + Math.random() * 0.7);
    return { x: point.x, y: point.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: 1.5 + Math.random() * 2 };
  });
  return { kind: 'dust', specks, born: now, life: 700 };
}

// Faint tick marks where the bind points are.
function drawBindPoints(ctx, ward) {
  if (!ward.bindAngles) return;
  ctx.save();
  ctx.strokeStyle = `rgba(${R.boundColor}, 0.55)`;
  ctx.fillStyle = `rgba(${R.boundColor}, 0.55)`;
  ctx.lineWidth = 2;
  for (const a of ward.bindAngles) {
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(ward.center.x + cos * (ward.radius - 9), ward.center.y + sin * (ward.radius - 9));
    ctx.lineTo(ward.center.x + cos * (ward.radius + 13), ward.center.y + sin * (ward.radius + 13));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ward.center.x + cos * (ward.radius + 18), ward.center.y + sin * (ward.radius + 18), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// A practice template: faint dashed shapes to trace. Traced parts turn solid.
function drawTemplate(ctx, { parts, done, anchor, showMain }) {
  ctx.save();
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 9]);
  const shape = (p) => {
    ctx.beginPath();
    if (p.type === 'circle') ctx.arc(p.center.x, p.center.y, p.radius, 0, Math.PI * 2);
    else {
      ctx.moveTo(p.from.x, p.from.y);
      ctx.lineTo(p.to.x, p.to.y);
    }
    ctx.stroke();
  };
  if (showMain) {
    ctx.strokeStyle = `rgba(${R.chalkColor}, 0.2)`;
    shape({ type: 'circle', center: anchor.center, radius: anchor.radius });
  }
  parts.forEach((p, i) => {
    ctx.strokeStyle = done[i] ? `rgba(${R.boundColor}, 0.35)` : `rgba(${R.chalkColor}, 0.22)`;
    shape(p);
  });
  ctx.restore();
}

// A little chalk figure standing in the middle of a main circle.
function drawDuelist(ctx, c) {
  ctx.save();
  ctx.strokeStyle = `rgba(${R.chalkColor}, 0.75)`;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(c.x, c.y - 24, 8, 0, Math.PI * 2);
  ctx.moveTo(c.x, c.y - 16);
  ctx.lineTo(c.x, c.y + 8);
  ctx.moveTo(c.x - 12, c.y - 6);
  ctx.lineTo(c.x + 12, c.y - 6);
  ctx.moveTo(c.x, c.y + 8);
  ctx.lineTo(c.x - 9, c.y + 26);
  ctx.moveTo(c.x, c.y + 8);
  ctx.lineTo(c.x + 9, c.y + 26);
  ctx.stroke();
  ctx.restore();
}

function topOf(points) {
  let top = points[0];
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of points) {
    if (p.y < top.y) top = p;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
  }
  return { x: (minX + maxX) / 2, y: top.y };
}

function clampX(x, width) {
  return Math.max(90, Math.min(width - 90, x));
}
