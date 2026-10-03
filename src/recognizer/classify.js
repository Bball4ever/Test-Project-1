// Decide what kind of line a cleaned stroke is, and how well it was drawn.
// Checks run in the order from PLAN.md: closed loop, straight, wave, then dud.

import { distance, pathLength } from './clean.js';
import { fitCircle, fitLine, sideOfLine, totalTurning, spread, mean, median, clamp01 } from './fit.js';

export const TYPES = {
  WARDING: 'warding',
  FORBIDDANCE: 'forbiddance',
  VIGOR: 'vigor',
  DUD: 'dud',
};

export function classify(points, cfg) {
  const length = pathLength(points);
  const metrics = { length };

  if (points.length < 3 || length < cfg.minPathLength) {
    return dud('too short', null, metrics);
  }

  // 1. Closed loop → Line of Warding
  const loop = measureLoop(points, length, cfg.warding);
  Object.assign(metrics, loop.metrics);
  if (loop.isClosed) {
    if (loop.circle.radius < cfg.warding.minRadius) {
      return dud('circle too small', TYPES.WARDING, metrics);
    }
    return finish(TYPES.WARDING, loop.quality, 'circle too lumpy', loop.shape, metrics, cfg);
  }
  if (loop.isNearlyClosed) {
    return dud('circle not closed', TYPES.WARDING, metrics);
  }

  // 2. Straight → Line of Forbiddance
  const line = measureLine(points, length, cfg.forbiddance);
  Object.assign(metrics, line.metrics);
  if (line.isStraight) {
    return finish(TYPES.FORBIDDANCE, line.quality, 'line too crooked', line.shape, metrics, cfg);
  }

  // 3. Wave → Line of Vigor
  const wave = measureWave(points, cfg.vigor);
  Object.assign(metrics, wave.metrics);
  if (wave.isWave) {
    // Waves get a lower bar than circles and lines: a sloppy wave still flies, it just hits softer.
    return finish(TYPES.VIGOR, wave.quality, 'wave too uneven', wave.shape, metrics, { ...cfg, minQuality: cfg.vigor.minQuality });
  }

  // 4. Nothing matched. Give the most helpful reason we can.
  if (wave.looksWavy) return dud(`a wave needs at least ${cfg.vigor.minHumps} humps`, TYPES.VIGOR, metrics);
  if (line.isNearlyStraight) return dud('line too crooked', TYPES.FORBIDDANCE, metrics);
  return dud('not a known line', null, metrics);
}

function dud(reason, guess, metrics, quality = 0, shape = null) {
  return { type: TYPES.DUD, quality, reason, guess, shape, metrics };
}

// A recognized shape that scores below minQuality still becomes a dud,
// but we keep its score and best guess so the player can see how close it was.
function finish(type, quality, lowReason, shape, metrics, cfg) {
  if (quality < cfg.minQuality) return dud(lowReason, type, metrics, quality, shape);
  return { type, quality, reason: null, guess: type, shape, metrics };
}

// --- Warding --------------------------------------------------------------

function measureLoop(points, length, cfg) {
  const start = points[0];

  // Find where the stroke comes closest to its start, looking only near the end.
  // If you overshoot past the start, this cuts the extra bit off.
  const tailStart = Math.floor(points.length * (1 - cfg.tailFraction));
  let closeIndex = points.length - 1;
  let gap = Infinity;
  for (let i = tailStart; i < points.length; i++) {
    const d = distance(start, points[i]);
    if (d < gap) {
      gap = d;
      closeIndex = i;
    }
  }
  const loopPoints = points.slice(0, closeIndex + 1);
  const gapRatio = gap / length;
  const turning = Math.abs(totalTurning(loopPoints));
  const endGapRatio = distance(start, points[points.length - 1]) / length;
  const fullTurning = Math.abs(totalTurning(points));
  const fullSpread = spread(fitCircle(points).radii);

  const circle = fitCircle(loopPoints);
  const radiusSpread = spread(circle.radii);
  const roundness = clamp01(1 - radiusSpread / cfg.maxRadiusSpread);
  const closure = clamp01(1 - gapRatio / cfg.maxGapRatio);
  const quality = cfg.roundnessWeight * roundness + cfg.closureWeight * closure;

  return {
    isClosed: gapRatio <= cfg.maxGapRatio && turning >= cfg.minTurning,
    isNearlyClosed:
      Math.min(gapRatio, endGapRatio) <= cfg.nearlyClosedGapRatio &&
      fullTurning >= cfg.nearlyClosedTurning &&
      fullSpread <= cfg.nearlyClosedMaxSpread,
    circle,
    quality,
    shape: { kind: 'circle', center: circle.center, radius: circle.radius },
    metrics: {
      gapRatio,
      turningTurns: turning / (2 * Math.PI),
      radius: circle.radius,
      radiusSpread,
      roundness,
      closure,
    },
  };
}

// --- Forbiddance ----------------------------------------------------------

function measureLine(points, length, cfg) {
  const first = points[0];
  const last = points[points.length - 1];
  const straightness = distance(first, last) / length;

  const fit = fitLine(points);
  const deviation = mean(points.map((p) => Math.abs(sideOfLine(p, fit))));
  const deviationRatio = deviation / length;
  const quality = clamp01(1 - deviationRatio / cfg.maxDeviationRatio);

  // Snap the drawn ends onto the fitted line to get a clean wall segment.
  const project = (p) => {
    const t = (p.x - fit.point.x) * fit.dir.x + (p.y - fit.point.y) * fit.dir.y;
    return { x: fit.point.x + t * fit.dir.x, y: fit.point.y + t * fit.dir.y };
  };

  return {
    isStraight: straightness >= cfg.minStraightness,
    isNearlyStraight: straightness >= cfg.nearlyStraightness,
    quality,
    shape: { kind: 'segment', from: project(first), to: project(last) },
    metrics: { straightness, deviation, deviationRatio },
  };
}

// --- Vigor ----------------------------------------------------------------

// A wave is measured against its middle line. People's waves often bend (the
// arm swings in an arc), so if a straight middle line doesn't fit well we try
// again with one that follows the wave's curve, and keep whichever fits better.
function measureWave(points, cfg) {
  const straight = measureWaveStraight(points, cfg);
  if (straight.isWave && straight.quality >= cfg.goodQuality) return straight;
  const bent = measureWaveBent(points, cfg, Math.max(cfg.minHumps, straight.metrics.crossings + 1));
  if (!bent) return straight;
  // If it already counts as a wave against a straight line, only switch when
  // the wave really does bend (otherwise the bending line can hide lopsided humps).
  const reallyBent = bent.metrics.bend >= cfg.minBend;
  if (bent.isWave && (!straight.isWave || (reallyBent && bent.quality > straight.quality))) return bent;
  if (!straight.isWave && !straight.looksWavy && bent.looksWavy) return bent;
  return straight;
}

function measureWaveStraight(points, cfg) {
  // First guess at the wave's center line: the best-fit line through every point.
  // For a sine wave this comes out slightly tilted, so we refine it: the true
  // center runs through the midpoints between each peak and the next trough.
  let axis = fitLine(points);
  let pass = analyzeAgainst(points, axis, cfg);
  const peaks = pass.bumps.map((b) => points[b.peak]);
  // Needs at least 4 peaks. With 2 or 3, the line through the midpoints sits
  // exactly the same distance from every peak, so all bumps would look equally tall.
  if (peaks.length >= 4) {
    const mids = [];
    for (let k = 1; k < peaks.length; k++) {
      mids.push({ x: (peaks[k - 1].x + peaks[k].x) / 2, y: (peaks[k - 1].y + peaks[k].y) / 2 });
    }
    axis = fitLine(mids);
    pass = analyzeAgainst(points, axis, cfg);
  }
  const { u, dir } = pass;
  const start = { x: axis.point.x + u[0] * dir.x, y: axis.point.y + u[0] * dir.y };
  const end = { x: axis.point.x + u[u.length - 1] * dir.x, y: axis.point.y + u[u.length - 1] * dir.y };
  return scoreWave(points, pass, start, end, cfg);
}

// A middle line that bends with the wave: each point's average with the
// points around it over one whole wave (up and back down), which cancels the
// wiggle and leaves the curve. Near the ends, where a whole wave doesn't fit,
// the middle line carries straight on.
function measureWaveBent(points, cfg, humps) {
  const n = points.length;
  const half = Math.floor(n / humps); // half of one whole wave, in points
  if (half < 3 || n - 2 * half < 3) return null;
  const C = new Array(n);
  for (let i = half; i < n - half; i++) {
    let x = 0;
    let y = 0;
    for (let k = i - half; k <= i + half; k++) {
      x += points[k].x;
      y += points[k].y;
    }
    C[i] = { x: x / (2 * half + 1), y: y / (2 * half + 1) };
  }
  const unit = (a, b) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  };
  const a = half;
  const b = n - half - 1;
  const Ta = unit(C[a], C[Math.min(b, a + 2)]);
  const Tb = unit(C[Math.max(a, b - 2)], C[b]);
  const T = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i < a || i > b) {
      // Past the ends: carry the middle line straight on.
      const [c, t] = i < a ? [C[a], Ta] : [C[b], Tb];
      const along = (points[i].x - c.x) * t.x + (points[i].y - c.y) * t.y;
      C[i] = { x: c.x + t.x * along, y: c.y + t.y * along };
      T[i] = t;
    }
  }
  for (let i = a; i <= b; i++) T[i] = unit(C[Math.max(a, i - 1)], C[Math.min(b, i + 1)]);
  // u: distance along the middle line; v: distance to the side of it.
  const u = new Array(n);
  const v = new Array(n);
  let along = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) along += Math.hypot(C[i].x - C[i - 1].x, C[i].y - C[i - 1].y);
    const dx = points[i].x - C[i].x;
    const dy = points[i].y - C[i].y;
    u[i] = along + dx * T[i].x + dy * T[i].y;
    v[i] = T[i].x * dy - T[i].y * dx;
  }
  const dir = unit(C[0], C[n - 1]);
  const pass = { u, v, dir, ...crossingsAndBumps(u, v, cfg) };
  const result = scoreWave(points, pass, C[0], C[n - 1], cfg);
  // How much the middle line turns, end to end: a wave bends gently; a
  // scribble's middle line wanders all over.
  const bend = Math.abs(totalTurning(C.slice(a, b + 1)));
  const straightness = Math.hypot(C[n - 1].x - C[0].x, C[n - 1].y - C[0].y) / (along || 1);
  result.metrics.bend = bend;
  result.metrics.middleStraightness = straightness;
  if (straightness < cfg.minMiddleStraightness) {
    result.isWave = false;
    result.looksWavy = false;
  }
  return result;
}

// Everything that's measured once we know u and v for every point.
function scoreWave(points, pass, start, end, cfg) {
  const { u, v, crossings, bumps, dir } = pass;

  // How much of the path moves backward along the center line?
  let forward = 0;
  let backward = 0;
  for (let i = 1; i < points.length; i++) {
    const du = u[i] - u[i - 1];
    const step = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (du < 0) backward += step;
    else forward += step;
  }
  const backtrackFraction = backward / (forward + backward);

  const widths = bumps.map((b) => b.width);
  const heights = bumps.map((b) => b.height);
  const maxSide = Math.max(...v.map(Math.abs));
  const amplitude = heights.length ? mean(heights) : maxSide;
  const widthSpread = widths.length >= 2 ? spread(widths) : 0;
  const heightSpread = heights.length >= 2 ? spread(heights) : 0;
  const unevenness = cfg.widthWeight * widthSpread + cfg.heightWeight * heightSpread;
  const quality = clamp01(1 - unevenness / cfg.maxSpread);

  // Spikiness, 0 (round curved bumps) to 1 (sharp spikes), from how full the
  // bumps are. Any wave is a Line of Vigor; this only decides what it's good at.
  const fill = bumps.length ? median(bumps.map((b) => b.fill)) : 0;
  const spikiness = clamp01((cfg.curvedFill - fill) / (cfg.curvedFill - cfg.spikyFill));

  const humps = countHumps(u, v, crossings, bumps, cfg);
  const movesForward = backtrackFraction <= cfg.maxBacktrackFraction;
  const tallEnough = amplitude >= cfg.minAmplitude;

  return {
    isWave: humps >= cfg.minHumps && movesForward && tallEnough,
    looksWavy: crossings.length >= 1 && movesForward && tallEnough,
    quality,
    shape: {
      kind: 'wave',
      dir,
      start,
      end,
      crossings: crossings.map((i) => points[i]),
      amplitude,
      spikiness,
    },
    metrics: {
      crossings: crossings.length,
      humps,
      spikiness,
      amplitude,
      widthSpread,
      heightSpread,
      backtrackFraction,
      fill,
    },
  };
}

// Humps: the bumps between crossings of the center line, plus the piece at
// each end if it's most of a bump (not just a little hook as the chalk lands).
function countHumps(u, v, crossings, bumps, cfg) {
  if (!crossings.length) return 0;
  const refWidth = bumps.length ? median(bumps.map((b) => b.width)) : null;
  const refHeight = bumps.length ? median(bumps.map((b) => b.height)) : null;
  const ends = [
    [0, crossings[0]],
    [crossings[crossings.length - 1], u.length - 1],
  ].map(([a, b]) => {
    let height = 0;
    for (let i = a; i <= b; i++) height = Math.max(height, Math.abs(v[i]));
    return { width: Math.abs(u[b] - u[a]), height };
  });
  // With only one crossing there's no whole bump to compare with: use the bigger end.
  const w = refWidth ?? Math.max(...ends.map((e) => e.width));
  const h = refHeight ?? Math.max(...ends.map((e) => e.height));
  const whole = (e) => e.width >= cfg.endHumpWidth * w && e.height >= cfg.endHumpHeight * h;
  return bumps.length + ends.filter(whole).length;
}

// Measure a stroke against a candidate center line.
// u = how far along the line each point is, v = how far off to the side.
function analyzeAgainst(points, axis, cfg) {
  // Point the line from the start of the stroke toward the end.
  const first = points[0];
  const last = points[points.length - 1];
  let dir = axis.dir;
  if ((last.x - first.x) * dir.x + (last.y - first.y) * dir.y < 0) dir = { x: -dir.x, y: -dir.y };
  const line = { point: axis.point, dir };

  const u = points.map((p) => (p.x - line.point.x) * dir.x + (p.y - line.point.y) * dir.y);
  const v = points.map((p) => sideOfLine(p, line));
  return { u, v, dir, ...crossingsAndBumps(u, v, cfg) };
}

// Where the stroke crosses its middle line, and the bumps between crossings.
function crossingsAndBumps(u, v, cfg) {

  // Count crossings of the center line. A crossing only counts once the stroke
  // gets a real distance to the other side, so small jitter is ignored.
  const maxSide = Math.max(...v.map(Math.abs));
  const threshold = cfg.crossingHysteresis * maxSide;
  const crossings = []; // indices where the stroke crossed the center line
  let side = 0;
  let lastZero = 0;
  for (let i = 0; i < v.length; i++) {
    if (i > 0 && Math.sign(v[i]) !== Math.sign(v[i - 1])) lastZero = i;
    const now = v[i] > threshold ? 1 : v[i] < -threshold ? -1 : 0;
    if (now !== 0 && now !== side) {
      if (side !== 0) crossings.push(lastZero);
      side = now;
    }
  }

  // A crossing right at either end of the stroke only counts if the piece beyond
  // it is a decent size. This ignores little hooks where the chalk lands or lifts.
  if (crossings.length >= 3) {
    const widths = [];
    for (let k = 1; k < crossings.length; k++) widths.push(Math.abs(u[crossings[k]] - u[crossings[k - 1]]));
    const minEnd = cfg.minEndBumpRatio * median(widths);
    if (Math.abs(u[crossings[0]] - u[0]) < minEnd) crossings.shift();
    if (Math.abs(u[u.length - 1] - u[crossings[crossings.length - 1]]) < minEnd) crossings.pop();
  }

  // Each "bump" sits between two crossings. Measure its width, height and peak.
  const bumps = [];
  for (let k = 1; k < crossings.length; k++) {
    const a = crossings[k - 1];
    const b = crossings[k];
    let peak = a;
    for (let i = a; i <= b; i++) if (Math.abs(v[i]) > Math.abs(v[peak])) peak = i;
    // How full the bump is: its average height ÷ its peak height. A rounded
    // (curved) bump is about 0.64 full; a pointed (spiky) one about 0.5.
    // (Measured along the center line, not along the chalk, which has extra
    // points on the steep parts.)
    let area = 0;
    for (let i = a + 1; i <= b; i++) area += (Math.abs(v[i]) + Math.abs(v[i - 1])) / 2 * Math.abs(u[i] - u[i - 1]);
    const fill = area / ((Math.abs(u[b] - u[a]) || 1) * (Math.abs(v[peak]) || 1));
    bumps.push({ width: Math.abs(u[b] - u[a]), height: Math.abs(v[peak]), peak, fill });
  }

  return { crossings, bumps };
}
