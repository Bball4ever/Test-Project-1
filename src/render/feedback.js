// Labels on the board: what each stroke was recognized as, or why it failed.

import { CONFIG } from '../config.js';

const R = CONFIG.render;

export const NAMES = {
  warding: 'Warding',
  forbiddance: 'Forbiddance',
  vigor: 'Vigor',
};

export function labelText(result) {
  const pct = `${Math.round(result.quality * 100)}%`;
  if (result.type !== 'dud') return `${NAMES[result.type]} ${pct}`;
  return result.quality > 0 ? `${result.reason} (${pct})` : result.reason;
}

// entry: { result, box: { x, y, w, h } }, alpha: 0..1 (duds fade out)
export function drawLabel(ctx, entry, alpha, boardWidth) {
  const { result, box } = entry;
  const color = result.type === 'dud' ? R.dudColor : R.chalkColor;
  const text = labelText(result);

  ctx.save();
  ctx.font = R.labelFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const half = ctx.measureText(text).width / 2 + 6;
  const x = Math.max(half, Math.min(boardWidth - half, box.x + box.w / 2));
  const y = Math.max(22, box.y + 2);
  ctx.fillStyle = `rgba(${color}, ${0.85 * alpha})`;
  ctx.fillText(text, x, y);
  ctx.restore();

  if (result.type === 'vigor') drawArrow(ctx, result.shape, alpha);
}

// A small chevron at the end of a Vigor line showing which way it will travel.
function drawArrow(ctx, wave, alpha) {
  const { end, dir } = wave;
  const tip = { x: end.x + dir.x * 22, y: end.y + dir.y * 22 };
  const size = 9;
  ctx.save();
  ctx.strokeStyle = `rgba(${R.chalkColor}, ${0.6 * alpha})`;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const side of [1, -1]) {
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - dir.x * size + side * dir.y * size * 0.7, tip.y - dir.y * size - side * dir.x * size * 0.7);
  }
  ctx.stroke();
  ctx.restore();
}
