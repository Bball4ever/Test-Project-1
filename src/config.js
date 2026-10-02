// Every tuning number for the game lives here.
// If you find yourself typing a "magic number" anywhere else, move it here instead.

export const CONFIG = {
  recognizer: {
    // --- Clean up ---
    resampleSpacing: 4, // pixels between points after resampling
    smoothRadius: 2, // average each point with this many neighbours on each side
    minPathLength: 40, // strokes shorter than this (px) are duds: "too short"

    // Below this quality, a recognized shape still becomes a dud.
    minQuality: 0.4,

    // --- Line of Warding (circle) ---
    warding: {
      // How far from the start the stroke may end, as a fraction of its length.
      maxGapRatio: 0.12,
      // Only look for the closing point in the last part of the stroke,
      // so overshooting past the start still counts as closed.
      tailFraction: 0.3,
      // A loop has to turn most of the way around (2π is a full circle).
      minTurning: 1.6 * Math.PI,
      minRadius: 15, // px
      // Radius spread (std / mean) at which roundness drops to zero.
      maxRadiusSpread: 0.2,
      // How much each part counts toward quality (should add up to 1).
      roundnessWeight: 0.8,
      closureWeight: 0.2,
      // An open curve that turns this much and nearly closes gets "circle not closed".
      nearlyClosedGapRatio: 0.4,
      nearlyClosedTurning: 1.25 * Math.PI,
      nearlyClosedMaxSpread: 0.3, // ...and is roundish (radius spread at most this)
    },

    // --- Line of Forbiddance (straight) ---
    forbiddance: {
      // Straight-line distance between ends / path length. 1.0 is perfectly straight.
      minStraightness: 0.97,
      // Below this it's not even trying to be a line.
      nearlyStraightness: 0.85,
      // Average distance from the fitted line, as a fraction of length,
      // at which quality drops to zero.
      maxDeviationRatio: 0.04,
    },

    // --- Line of Vigor (wave) ---
    vigor: {
      minCrossings: 3, // times the wave must cross its own center line
      // Ignore wobbles smaller than this fraction of the biggest bump,
      // so jitter near the center line doesn't count as a crossing.
      crossingHysteresis: 0.2,
      // A crossing at either end only counts if the piece past it is at least
      // this fraction of a normal bump's width (ignores hooks at the ends).
      minEndBumpRatio: 0.4,
      minAmplitude: 6, // px, the average bump must be at least this tall
      // A real wave keeps moving forward. If more than this fraction of the
      // path moves backward, it's a scribble, not a wave.
      maxBacktrackFraction: 0.15,
      // Spread (std / mean) of bump widths/heights at which quality drops to zero.
      maxSpread: 0.4,
      widthWeight: 0.5,
      heightWeight: 0.5,
    },
  },

  engine: {
    // The board is always this many units, whatever the screen size.
    // The renderer scales it to fit.
    world: { width: 1600, height: 900 },
    stepMs: 1000 / 60, // the engine moves forward in steps of exactly this long
    sideMargin: 8, // how far past the center line a stroke may stray

    // --- Lines of Warding ---
    sections: 24, // arc sections per circle, each with its own health
    sectionHealth: 100, // × circle quality
    // Sections where your line wobbles get weaker. Wobble is measured as how far
    // the drawn line strays from the perfect circle there (fraction of the radius).
    wobblePenalty: 1, // 0 turns this off, 1 is full strength
    wobbleScale: 0.15, // this much local wobble counts as "fully wobbly"
    minSectionFactor: 0.2, // a section never drops below this fraction of its health

    // --- Lines of Forbiddance ---
    wallHealth: 150, // × line quality (only matters once chalklings exist)
    wallDamageFromBounce: 0, // fraction of a Vigor's power a wall loses per bounce

    // --- Lines of Vigor ---
    vigorDamage: 40, // × wave quality
    vigorSpeed: 520, // units per second
    bounceLoss: 0.3, // power lost per bounce off a wall
    minVigorPower: 5, // a Vigor weaker than this fizzles out
  },

  dummy: {
    center: { x: 1200, y: 450 },
    radius: 150,
    drawMs: 1400, // how long the dummy takes to draw its circle
    startDelayMs: 600,
    neat: { noise: 1.5, squash: 1, sweep: 1.03 },
    sloppy: { noise: 11, squash: 0.86, sweep: 0.98 },
  },

  render: {
    boardColor: '#1d2a23',
    chalkColor: '235, 238, 228', // r, g, b
    dudColor: '240, 150, 130',
    chalkWidth: 4, // px
    chalkStrands: 4, // thin lines layered to make one chalk line
    chalkGrain: 2, // px per chalk texture step (smaller = finer grain, more work)
    dustChance: 0.25, // chance per segment of leaving a speck of dust
    dudFadeMs: 2200, // how long a dud takes to fade away
    labelFont: '15px "Segoe Print", "Comic Sans MS", cursive',
  },
};
