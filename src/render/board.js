// The chalkboard and the chalk itself. The renderer only reads state; it never changes it.

import { CONFIG } from '../config.js';
import { makeRng } from '../random.js';
import { resample } from '../recognizer/clean.js';

const R = CONFIG.render;

export class Board {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // Match the canvas to its on-screen size. On sharp screens one CSS pixel is
  // several real pixels (devicePixelRatio), so we draw at full resolution.
  resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.background = makeBackground(this.width, this.height, this.dpr);
  }

  drawBackground() {
    this.ctx.drawImage(this.background, 0, 0, this.width, this.height);
  }
}

// The board surface: dark green slate, old eraser smudges, fine grain,
// and a faint line splitting the two duelists' halves.
function makeBackground(width, height, dpr) {
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

// Draw a finished stroke once onto its own small canvas, so each frame we can
// just copy that picture instead of redrawing hundreds of chalk strands.
export function cacheChalk(points, seed, dpr, color) {
  const pad = R.chalkWidth * 3 + 4;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  const w = Math.max(...xs) - x + pad;
  const h = Math.max(...ys) - y + pad;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * dpr);
  c.height = Math.ceil(h * dpr);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.translate(-x, -y);
  drawChalk(ctx, points, seed, color);
  return { canvas: c, x, y, w, h };
}
