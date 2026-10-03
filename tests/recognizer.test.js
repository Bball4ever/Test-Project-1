import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { recognize, TYPES } from '../src/recognizer/index.js';
import { resample, pathLength, distance } from '../src/recognizer/clean.js';
import * as S from './fixtures/strokes.js';

const { WARDING, FORBIDDANCE, VIGOR, DUD } = TYPES;

// --- Clean up ---------------------------------------------------------------

test('resampling spaces points evenly', () => {
  // Bunched-up points at the start, big gaps at the end.
  const raw = [0, 1, 2, 3, 50, 120, 200].map((x) => ({ x, y: 0 }));
  const out = resample(raw, 10);
  for (let i = 1; i < out.length - 1; i++) {
    assert.ok(Math.abs(distance(out[i - 1], out[i]) - 10) < 1e-9);
  }
  assert.ok(Math.abs(pathLength(out) - 200) < 1e-9);
});

// --- Warding ------------------------------------------------------------------

test('good circles are Warding with high quality', () => {
  for (const opts of [{}, { noise: 3 }, { clockwise: true, noise: 3 }, { r: 40, noise: 2 }, { r: 200, noise: 4 }]) {
    const r = recognize(S.circle(opts));
    assert.equal(r.type, WARDING, JSON.stringify(opts));
    assert.ok(r.quality > 0.85, `quality ${r.quality} for ${JSON.stringify(opts)}`);
  }
});

test('overshooting the start still counts as a closed circle', () => {
  const r = recognize(S.circle({ sweep: 1.15, noise: 3 }));
  assert.equal(r.type, WARDING);
  assert.ok(r.quality > 0.85);
});

test('wobblier circles score lower than neat ones', () => {
  const scores = [0, 4, 8, 14].map((noise) => recognize(S.circle({ noise, seed: 7 })).quality);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] < scores[i - 1], scores.join(', '));
});

test('a small gap lowers the score but still counts', () => {
  const closed = recognize(S.circle({ sweep: 1.0 }));
  const gappy = recognize(S.circle({ sweep: 0.94 }));
  assert.equal(gappy.type, WARDING);
  assert.ok(gappy.quality < closed.quality);
});

test('an open circle is a dud: "circle not closed"', () => {
  for (const sweep of [0.7, 0.8]) {
    const r = recognize(S.circle({ sweep, noise: 2 }));
    assert.equal(r.type, DUD);
    assert.equal(r.reason, 'circle not closed');
    assert.equal(r.guess, WARDING);
  }
});

test('a squashed ellipse is weak or a dud', () => {
  const round = recognize(S.circle({ noise: 2 }));
  const oval = recognize(S.circle({ squash: 0.7, noise: 2 }));
  const flat = recognize(S.circle({ squash: 0.5, noise: 2 }));
  assert.ok(oval.quality < round.quality - 0.3);
  assert.equal(flat.type, DUD);
  assert.equal(flat.reason, 'circle too lumpy');
});

test('a tiny circle is a dud', () => {
  const r = recognize(S.circle({ r: 10 }));
  assert.equal(r.type, DUD);
  assert.equal(r.reason, 'circle too small');
});

test('circle shape has the right center and radius', () => {
  const r = recognize(S.circle({ cx: 250, cy: 180, r: 90 }));
  assert.ok(distance(r.shape.center, { x: 250, y: 180 }) < 3);
  assert.ok(Math.abs(r.shape.radius - 90) < 3);
});

// --- Forbiddance --------------------------------------------------------------

test('straight lines are Forbiddance at any angle', () => {
  const ends = [
    [100, 100, 400, 100],
    [100, 100, 100, 400],
    [400, 400, 100, 120],
    [50, 300, 260, 60],
  ];
  for (const [x1, y1, x2, y2] of ends) {
    const r = recognize(S.line({ x1, y1, x2, y2, noise: 3 }));
    assert.equal(r.type, FORBIDDANCE, `${x1},${y1} → ${x2},${y2}`);
    assert.ok(r.quality > 0.8, `quality ${r.quality}`);
  }
});

test('shakier lines score lower', () => {
  const scores = [0, 3, 6, 9].map((noise) => recognize(S.line({ noise, seed: 3 })).quality);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] < scores[i - 1], scores.join(', '));
});

test('line shape ends near where it was drawn', () => {
  const r = recognize(S.line({ x1: 100, y1: 100, x2: 400, y2: 160 }));
  assert.ok(distance(r.shape.from, { x: 100, y: 100 }) < 3);
  assert.ok(distance(r.shape.to, { x: 400, y: 160 }) < 3);
});

// --- Vigor --------------------------------------------------------------------

test('regular waves are Vigor with high quality', () => {
  for (const opts of [{}, { noise: 3 }, { cycles: 2 }, { cycles: 5, amplitude: 20 }, { amplitude: 12 }]) {
    const r = recognize(S.wave(opts));
    assert.equal(r.type, VIGOR, JSON.stringify(opts));
    assert.ok(r.quality > 0.85, `quality ${r.quality} for ${JSON.stringify(opts)}`);
  }
});

test('wave direction goes from the start of the stroke to the end', () => {
  for (const angle of [0, Math.PI / 2, Math.PI, -2.3, 0.7]) {
    const r = recognize(S.wave({ x: 300, y: 300, angle, noise: 2 }));
    assert.equal(r.type, VIGOR);
    assert.ok(Math.abs(r.shape.dir.x - Math.cos(angle)) < 0.1, `angle ${angle}`);
    assert.ok(Math.abs(r.shape.dir.y - Math.sin(angle)) < 0.1, `angle ${angle}`);
  }
});

test('uneven waves score lower; sloppy ones still count, really lopsided ones are duds', () => {
  const average = (irregular) => {
    let total = 0;
    for (let seed = 1; seed <= 10; seed++) total += recognize(S.wave({ noise: 2, irregular, seed })).quality;
    return total / 10;
  };
  const scores = [0, 0.2, 0.4, 0.8].map(average);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] < scores[i - 1], scores.join(', '));

  // A sloppy wave still counts, it just scores low (and hits softer)...
  const sloppy = recognize(S.wave({ noise: 2, cycles: 4, pattern: [1.5, 0.4, 0.8] }));
  assert.equal(sloppy.type, VIGOR);
  assert.ok(sloppy.quality < 0.4, `quality ${sloppy.quality}`);
  // ...but a really lopsided one is a dud.
  const lopsided = recognize(S.wave({ noise: 2, cycles: 4, pattern: [1.8, 0.3, 0.9] }));
  assert.equal(lopsided.type, DUD, `quality ${lopsided.quality}`);
  assert.equal(lopsided.reason, 'wave too uneven');
});

test('a wave with fewer than 3 humps is a dud', () => {
  const r = recognize(S.wave({ cycles: 1.2 })); // 2 humps and a little bit
  assert.equal(r.type, DUD);
  assert.equal(r.reason, 'a wave needs at least 3 humps');
});

test('3 humps is enough, curved or spiky', () => {
  for (const zigzag of [false, true]) {
    for (const seed of [1, 2, 3]) {
      const r = recognize(S.wave({ cycles: 1.5, length: 240, amplitude: 30, zigzag, noise: 1, seed }));
      assert.equal(r.type, VIGOR, `${zigzag ? 'zigzag' : 'curve'} seed ${seed}: ${r.reason}`);
      assert.equal(r.metrics.humps, 3);
    }
  }
});

// --- Duds ---------------------------------------------------------------------

test('a tap is "too short"', () => {
  const r = recognize([{ x: 10, y: 10 }, { x: 12, y: 11 }]);
  assert.equal(r.type, DUD);
  assert.equal(r.reason, 'too short');
});

test('scribbles are almost always duds', () => {
  let duds = 0;
  const n = 200;
  for (let seed = 1; seed <= n; seed++) if (recognize(S.scribble({ seed })).type === DUD) duds++;
  assert.ok(duds / n >= 0.95, `only ${duds}/${n} scribbles were duds`);
});

test('a back-and-forth zigzag is a dud', () => {
  assert.equal(recognize(S.zigzagBack()).type, DUD);
});

// --- The "9 out of 10" check ----------------------------------------------------

// Random sizes, angles and a shaky hand, like a trackpad would give.
test('each line type is named correctly at least 9 times out of 10', () => {
  const rng = S.makeRng(2024);
  const between = (a, b) => a + rng() * (b - a);
  const makers = {
    [WARDING]: (seed) =>
      S.circle({
        r: between(40, 180),
        noise: between(1, 8),
        sweep: between(0.97, 1.15),
        squash: between(0.85, 1),
        clockwise: rng() < 0.5,
        startAngle: between(0, 6.28),
        seed,
      }),
    [FORBIDDANCE]: (seed) => {
      const a = between(0, 6.28);
      const len = between(120, 450);
      return S.line({ x1: 300, y1: 300, x2: 300 + len * Math.cos(a), y2: 300 + len * Math.sin(a), noise: between(1, 6), seed });
    },
    [VIGOR]: (seed) =>
      S.wave({
        length: between(250, 500),
        amplitude: between(15, 40),
        cycles: between(2, 5),
        angle: between(0, 6.28),
        noise: between(1, 4),
        irregular: between(0, 0.25),
        seed,
      }),
  };
  for (const [type, make] of Object.entries(makers)) {
    let right = 0;
    const n = 60;
    for (let seed = 1; seed <= n; seed++) if (recognize(make(seed)).type === type) right++;
    assert.ok(right / n >= 0.9, `${type}: ${right}/${n}`);
  }
});

// --- Real strokes recorded in the browser (press S in the game to save one) ---

test('recorded strokes are recognized as expected', () => {
  const recorded = JSON.parse(readFileSync(new URL('./fixtures/recorded.json', import.meta.url)));
  for (const { expect, device, note, points } of recorded) {
    const r = recognize(points.map(([x, y]) => ({ x, y })));
    assert.equal(r.type, expect, `${device ?? '?'} ${note ?? ''}: got ${r.type} (${r.reason ?? r.quality})`);
  }
});

test('waves drawn on a bend (the arm swinging in an arc) still count', () => {
  for (const bend of [-0.6, -0.4, 0.4, 0.6]) {
    for (const seed of [1, 2, 3]) {
      // A wave whose middle line curves by `bend` radians from start to end.
      const pts = S.wave({ x: 100, y: 300, length: 360, amplitude: 25, cycles: 3, noise: 1, seed }).map((p) => {
        const f = (p.x - 100) / 360;
        const a = bend * f;
        const r = p.x - 100;
        return { x: 100 + Math.cos(a) * r - Math.sin(a) * (p.y - 300), y: 300 + Math.sin(a) * r + Math.cos(a) * (p.y - 300) };
      });
      const r = recognize(pts);
      assert.equal(r.type, VIGOR, `bend ${bend} seed ${seed}: ${r.reason}`);
    }
  }
});

test('scribbles and back-and-forth zigzags are still not waves', () => {
  let waves = 0;
  for (let seed = 1; seed <= 100; seed++) if (recognize(S.scribble({ seed })).type === VIGOR) waves++;
  assert.ok(waves <= 6, `${waves} of 100 scribbles counted as waves`);
  for (let seed = 1; seed <= 20; seed++) assert.notEqual(recognize(S.zigzagBack({ seed })).type, VIGOR);
});
