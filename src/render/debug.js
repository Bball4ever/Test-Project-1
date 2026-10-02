// Debug overlay (press D): the fitted shapes and the numbers behind every score.

const INK = '120, 210, 255'; // a blue that won't be confused with chalk

// Draw what the recognizer "saw" for one stroke.
export function drawDebugShapes(ctx, entry, alpha) {
  const { result } = entry;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = `rgba(${INK}, 0.8)`;
  ctx.fillStyle = `rgba(${INK}, 0.9)`;
  ctx.lineWidth = 1;

  // The cleaned-up points.
  for (const p of result.points) ctx.fillRect(p.x - 1, p.y - 1, 2, 2);

  const shape = result.shape;
  ctx.setLineDash([5, 5]);
  if (shape?.kind === 'circle') {
    ctx.beginPath();
    ctx.arc(shape.center.x, shape.center.y, shape.radius, 0, Math.PI * 2);
    ctx.stroke();
    cross(ctx, shape.center);
  } else if (shape?.kind === 'segment') {
    ctx.beginPath();
    ctx.moveTo(shape.from.x, shape.from.y);
    ctx.lineTo(shape.to.x, shape.to.y);
    ctx.stroke();
  } else if (shape?.kind === 'wave') {
    ctx.beginPath();
    ctx.moveTo(shape.start.x, shape.start.y);
    ctx.lineTo(shape.end.x, shape.end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const c of shape.crossings) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function cross(ctx, p) {
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(p.x - 6, p.y);
  ctx.lineTo(p.x + 6, p.y);
  ctx.moveTo(p.x, p.y - 6);
  ctx.lineTo(p.x, p.y + 6);
  ctx.stroke();
}

// Fill the text panel with the latest stroke's details.
export function debugPanelText(entry) {
  if (!entry) return 'Debug on. Draw something.';
  const r = entry.result;
  const lines = [
    `type      ${r.type}`,
    `quality   ${r.quality.toFixed(3)}`,
    `reason    ${r.reason ?? '-'}`,
    `guess     ${r.guess ?? '-'}`,
    `device    ${entry.pointerType}`,
    `raw pts   ${entry.raw.length}`,
    `clean pts ${r.points.length}`,
    '',
  ];
  for (const [k, v] of Object.entries(r.metrics)) {
    lines.push(`${k.padEnd(18)} ${typeof v === 'number' ? v.toFixed(3) : v}`);
  }
  return lines.join('\n');
}
