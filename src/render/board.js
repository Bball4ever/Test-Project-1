// The chalkboard and the chalk itself. The renderer only reads state; it never changes it.

import { CONFIG } from '../config.js';
import { makeRng } from '../random.js';
import { resample } from '../recognizer/clean.js';

const R = CONFIG.render;

// The board is a fixed-size world (CONFIG.engine.world). We scale it to fit the
// screen, keeping its shape, and leave dark bars at the sides if needed.
//
// The screen can also be split into several "views": rectangles that each show
// part of the world at their own zoom (the split-screen layout's map, main
// drawing screen and detail drawing screen). Normally there's just one view
// showing the whole board.
export class Board {
  constructor(canvas, world = CONFIG.engine.world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.version = 0; // goes up on every resize, so cached pictures know to redraw
    this.views = null; // null = one view of the whole board
    this.homes = null; // players' homes, for drawing territory borders
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // The whole board, fitted to the whole screen.
  fullView() {
    return makeView('full', { x: 0, y: 0, w: this.canvas.clientWidth, h: this.canvas.clientHeight }, { x: 0, y: 0, w: this.world.width, h: this.world.height });
  }

  // Which view is at this screen position? (null if none)
  viewAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const views = this.views ?? [this.fullView()];
    return views.find((v) => x >= v.rect.x && x < v.rect.x + v.rect.w && y >= v.rect.y && y < v.rect.y + v.rect.h) ?? null;
  }

  // Screen position → world position, through a view.
  viewToWorld(view, clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return viewStep(view, clientX - rect.left - view.ox, clientY - rect.top - view.oy);
  }

  // Start drawing one view: clip to its rectangle and set it up so everything
  // is drawn in world units. Call endView() afterwards.
  beginView(view) {
    const ctx = this.ctx;
    const d = this.dpr;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(view.rect.x * d, view.rect.y * d, view.rect.w * d, view.rect.h * d);
    ctx.clip();
    ctx.setTransform(view.a * d, view.b * d, view.c * d, view.d * d, view.ox * d, view.oy * d);
    ctx.drawImage(this.background, 0, 0, this.world.width, this.world.height);
    // Cached chalk pictures are drawn at about this many real pixels per world
    // unit (rounded to a few fixed steps, so zooming doesn't redraw every frame).
    this.resolution = 2 ** (Math.round(Math.log2(view.scale * d) * 2) / 2);
  }

  endView() {
    this.ctx.restore();
    this.resolution = this.baseResolution;
  }

  // Match the canvas to its on-screen size. On sharp screens one CSS pixel is
  // several real pixels (devicePixelRatio), so we draw at full resolution.
  resize() {
    this.dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.scale = Math.min(cssW / this.world.width, cssH / this.world.height);
    this.offsetX = (cssW - this.world.width * this.scale) / 2;
    this.offsetY = (cssH - this.world.height * this.scale) / 2;
    // Real screen pixels per world unit: used to draw cached pictures sharply.
    this.resolution = this.dpr * this.scale;
    this.baseResolution = this.resolution;
    // The board surface is pre-drawn too; at least 0.6 pixels a unit so it isn't
    // too blurry when zoomed in, but never a giant picture.
    const bgRes = Math.min(Math.max(this.resolution, 0.6 * this.dpr), 4096 / Math.max(this.world.width, this.world.height));
    this.background = makeBackground(this.world.width, this.world.height, bgRes, this.homes);
    this.version++;
  }

  // A new duel with a different board size or players (more than 2 players
  // means a bigger board with territory borders).
  setWorld(world, homes = null) {
    const players = homes ? Object.keys(homes).length : 2;
    const same = JSON.stringify(players > 2 ? homes : null) === JSON.stringify(this.homes);
    if (world.width === this.world.width && world.height === this.world.height && same) return;
    this.world = { ...world };
    this.homes = players > 2 ? homes : null;
    this.resize();
  }

  // Screen position (from a pointer event) → world position.
  toWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.offsetX) / this.scale,
      y: (clientY - rect.top - this.offsetY) / this.scale,
    };
  }

  // Clear the screen. Then draw each view between beginView() and endView().
  beginFrame() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d130f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

// A view showing the world rectangle `area` inside the screen rectangle `rect`
// (CSS pixels), as big as fits. zoom > 1 zooms in on `focus` (a world point,
// default the middle of `area`).
//
// angle: turn the world this much (radians) on screen. The map uses it so
// your own home is at the BOTTOM (in a 2-player duel, -90° for the left
// duelist: the board's left edge at the bottom, its right edge at the top).
export function makeView(name, rect, area, { zoom = 1, focus = null, pad = 0, angle = 0 } = {}) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // How big the (turned) area looks on screen.
  const aw = Math.abs(cos) * area.w + Math.abs(sin) * area.h;
  const ah = Math.abs(sin) * area.w + Math.abs(cos) * area.h;
  const scale = Math.min((rect.w - pad * 2) / aw, (rect.h - pad * 2) / ah) * zoom;
  const f = focus ?? { x: area.x + area.w / 2, y: area.y + area.h / 2 };
  // screen x = a·x + c·y + ox,  screen y = b·x + d·y + oy  (x, y in the world)
  const round = (v) => (Math.abs(v) < 1e-12 ? 0 : v);
  const [a, b, c, d] = [round(scale * cos), round(scale * sin), round(-scale * sin), round(scale * cos)];
  return {
    name,
    rect,
    scale,
    angle,
    a,
    b,
    c,
    d,
    ox: rect.x + rect.w / 2 - (a * f.x + c * f.y), // where world (0, 0) lands on screen
    oy: rect.y + rect.h / 2 - (b * f.x + d * f.y),
  };
}

// A screen-sized step (dx, dy) as a world-sized step, through a view.
export function viewStep(view, dx, dy) {
  const det = view.a * view.d - view.b * view.c;
  return { x: (view.d * dx - view.c * dy) / det, y: (-view.b * dx + view.a * dy) / det };
}

// The board surface: dark green slate, old eraser smudges, fine grain,
// and a faint line splitting the two duelists' halves.
function makeBackground(width, height, dpr, homes = null) {
  const c = document.createElement('canvas');
  c.width = Math.round(width * dpr);
  c.height = Math.round(height * dpr);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const rng = makeRng(7);

  ctx.fillStyle = R.boardColor;
  ctx.fillRect(0, 0, width, height);

  // Vignette: slightly darker toward the edges.
  const g = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.hypot(width, height) / 1.6);
  g.addColorStop(0, 'rgba(255,255,255,0.03)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  // Eraser smudges: big soft pale blobs.
  for (let i = 0; i < 14; i++) {
    const x = rng() * width;
    const y = rng() * height;
    const r = 60 + rng() * 220;
    const s = ctx.createRadialGradient(x, y, 0, x, y, r);
    s.addColorStop(0, `rgba(${R.chalkColor}, ${0.025 + rng() * 0.03})`);
    s.addColorStop(1, `rgba(${R.chalkColor}, 0)`);
    ctx.fillStyle = s;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Grain.
  const specks = Math.floor((width * height) / 90);
  for (let i = 0; i < specks; i++) {
    ctx.fillStyle = rng() < 0.5 ? `rgba(${R.chalkColor}, ${rng() * 0.05})` : `rgba(0,0,0,${rng() * 0.12})`;
    ctx.fillRect(rng() * width, rng() * height, 1, 1);
  }

  if (homes) {
    // Territory borders: a faint dotted line wherever the nearest home changes.
    const owner = (x, y) => {
      let best = null;
      let bestD = Infinity;
      for (const [id, h] of Object.entries(homes)) {
        const d = (x - h.x) ** 2 + (y - h.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      return best;
    };
    ctx.fillStyle = `rgba(${R.chalkColor}, 0.16)`;
    const step = 12;
    for (let y = step / 2; y < height; y += step) {
      for (let x = step / 2; x < width; x += step) {
        const here = owner(x, y);
        if (owner(x + step, y) !== here || owner(x, y + step) !== here) ctx.fillRect(x + step / 2 - 1.5, y + step / 2 - 1.5, 3, 3);
      }
    }
  } else {
    // Center line.
    ctx.save();
    ctx.strokeStyle = `rgba(${R.chalkColor}, 0.12)`;
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 12]);
    ctx.beginPath();
    ctx.moveTo(width / 2, 12);
    ctx.lineTo(width / 2, height - 12);
    ctx.stroke();
    ctx.restore();
  }

  return c;
}

// Draw a stroke so it looks like chalk: a soft core line plus several thin,
// slightly offset "strands" with uneven brightness, and specks of dust.
// The seed keeps the roughness identical every time the same stroke is drawn.
export function drawChalk(ctx, rawPoints, seed, color = R.chalkColor) {
  if (rawPoints.length === 0) return;
  const rng = makeRng(seed);
  // Short, even steps make fine grain instead of long chunky dashes.
  const points = resample(rawPoints, R.chalkGrain);
  const w = R.chalkWidth;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Core: one continuous soft line so the stroke never looks broken.
  ctx.strokeStyle = `rgba(${color}, 0.45)`;
  ctx.lineWidth = w * 0.7;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points) ctx.lineTo(p.x, p.y);
  if (points.length === 1) ctx.lineTo(points[0].x + 0.1, points[0].y);
  ctx.stroke();

  // Strands: rough, grainy edges.
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    for (let s = 0; s < R.chalkStrands; s++) {
      const off = (s / (R.chalkStrands - 1) - 0.5) * w + (rng() - 0.5) * w * 0.5;
      const alpha = rng() < 0.2 ? 0.04 : 0.2 + rng() * 0.5;
      ctx.strokeStyle = `rgba(${color}, ${alpha})`;
      ctx.lineWidth = 0.6 + rng() * 1.3;
      ctx.beginPath();
      ctx.moveTo(a.x + nx * off, a.y + ny * off);
      ctx.lineTo(b.x + nx * off, b.y + ny * off);
      ctx.stroke();
    }
    // Dust that fell off the chalk.
    if (rng() < R.dustChance) {
      ctx.fillStyle = `rgba(${color}, ${0.15 + rng() * 0.3})`;
      const spread = w * 2.2;
      ctx.fillRect(b.x + (rng() - 0.5) * spread, b.y + (rng() - 0.5) * spread, 1 + rng(), 1 + rng());
    }
  }
  ctx.restore();
}

// Like cacheChalk, but for a drawing made of several strokes (a chalkling).
export function cacheChalkStrokes(strokes, seed, resolution, color) {
  const pad = R.chalkWidth * 3 + 4;
  const all = strokes.flat();
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  const w = Math.max(...xs) - x + pad;
  const h = Math.max(...ys) - y + pad;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * resolution);
  c.height = Math.ceil(h * resolution);
  const ctx = c.getContext('2d');
  ctx.scale(resolution, resolution);
  ctx.translate(-x, -y);
  strokes.forEach((stroke, i) => drawChalk(ctx, stroke, seed + i * 101, color));
  return { canvas: c, x, y, w, h };
}

// Draw a finished stroke once onto its own small canvas, so each frame we can
// just copy that picture instead of redrawing hundreds of chalk strands.
export function cacheChalk(points, seed, resolution, color) {
  const pad = R.chalkWidth * 3 + 4;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  const w = Math.max(...xs) - x + pad;
  const h = Math.max(...ys) - y + pad;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * resolution);
  c.height = Math.ceil(h * resolution);
  const ctx = c.getContext('2d');
  ctx.scale(resolution, resolution);
  ctx.translate(-x, -y);
  drawChalk(ctx, points, seed, color);
  return { canvas: c, x, y, w, h };
}
