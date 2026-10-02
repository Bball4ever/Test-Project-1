// Lines of Warding: split a drawn circle into sections, each with its own health.

import { sectionAt } from './collide.js';

// result: a recognizer result of type 'warding'.
// Each section's health = sectionHealth × circle quality × local steadiness.
// Local steadiness drops where the drawn line strays from the perfect circle,
// so a circle that's lumpy on one side is weak exactly there.
export function buildSections(result, cfg) {
  const { center, radius } = result.shape;
  const n = cfg.sections;
  const strays = Array.from({ length: n }, () => []);
  for (const p of result.points) {
    const r = Math.hypot(p.x - center.x, p.y - center.y);
    strays[sectionAt(center, p, n)].push(Math.abs(r - radius) / radius);
  }

  return strays.map((list) => {
    // No chalk at all in this section (the gap where the circle didn't quite close)
    // counts as fully wobbly.
    const wobble = list.length ? list.reduce((a, b) => a + b, 0) / list.length : cfg.wobbleScale;
    const steadiness = Math.max(
      cfg.minSectionFactor,
      1 - cfg.wobblePenalty * Math.min(1, wobble / cfg.wobbleScale),
    );
    const max = cfg.sectionHealth * result.quality * steadiness;
    return { health: max, max, wobble };
  });
}
