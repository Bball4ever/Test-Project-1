// Debug overlay (press D): fitted shapes, section health, and the numbers behind scores.

const INK = '120, 210, 255'; // a blue that won't be confused with chalk

export function drawDuelDebug(ctx, state) {
  ctx.save();
  ctx.strokeStyle = `rgba(${INK}, 0.8)`;
  ctx.fillStyle = `rgba(${INK}, 0.95)`;
  ctx.lineWidth = 1;
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const ward of state.wards) {
    const { x, y } = ward.center;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(x, y, ward.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Each section's health, printed just outside it.
    const n = ward.sections.length;
    ward.sections.forEach((s, k) => {
      const a = ((k + 0.5) / n) * Math.PI * 2;
      const r = ward.radius + 34;
      ctx.fillText(Math.round(s.health), x + Math.cos(a) * r, y + Math.sin(a) * r);
      // Section boundaries.
      const b = (k / n) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(b) * (ward.radius - 6), y + Math.sin(b) * (ward.radius - 6));
      ctx.lineTo(x + Math.cos(b) * (ward.radius + 6), y + Math.sin(b) * (ward.radius + 6));
      ctx.stroke();
    });
  }

  for (const wall of state.walls) {
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(wall.from.x, wall.from.y);
    ctx.lineTo(wall.to.x, wall.to.y);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  for (const c of state.chalklings) {
    ctx.beginPath();
    ctx.arc(c.pos.x, c.pos.y, c.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(`${c.role} ${Math.round(c.hp)}hp bite ${c.bite.toFixed(1)} speed ${Math.round(c.speed)}`, c.pos.x, c.pos.y + c.radius + 12);
    ctx.fillText(`${c.mode}${c.mode === 'order' ? ` (${c.order})` : ''} ${c.action}`, c.pos.x, c.pos.y + c.radius + 25);
  }
  for (const v of state.vigors) {
    ctx.beginPath();
    ctx.arc(v.pos.x, v.pos.y, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(v.power.toFixed(0), v.pos.x, v.pos.y - 14);
  }
  ctx.restore();
}

// The text panel: the latest stroke's details, plus a little duel info.
export function debugPanelText(last, state) {
  const lines = [];
  if (state) lines.push(`tick ${state.tick}   vigors ${state.vigors.length}   chalklings ${state.chalklings.length}`, '');
  if (!last) {
    lines.push('Draw something.');
    return lines.join('\n');
  }
  const r = last.result;
  lines.push(
    `type      ${r.type}`,
    `quality   ${(r.quality ?? 0).toFixed(3)}`,
    `reason    ${r.reason ?? '-'}`,
    `guess     ${r.guess ?? '-'}`,
    ...(r.detail !== undefined ? [`detail    ${r.detail.toFixed(2)}`] : []),
    `device    ${last.pointerType}`,
    `raw pts   ${last.raw.length}`,
    '',
  );
  for (const [k, v] of Object.entries(r.metrics ?? {})) {
    if (typeof v === 'object') continue;
    lines.push(`${k.padEnd(18)} ${typeof v === 'number' ? v.toFixed(3) : v}`);
  }
  return lines.join('\n');
}
