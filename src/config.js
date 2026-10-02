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

    // --- Bind points ---
    bindPointChoices: [2, 4, 6],
    defaultBindPoints: 4,
    touchTolerance: 18, // a line within this many units of the main circle "touches" it
    bindTolerance: 26, // a touch this close (along the circle) to a bind point is "bound"
    boundBonus: 0.5, // bound lines and circles get +50% strength
    offPointPenalty: 0.25, // touching away from a bind point: that section loses 25%

    // --- Lines of Forbiddance ---
    wallHealth: 150, // × line quality (only matters once chalklings exist)
    wallDamageFromBounce: 0, // fraction of a Vigor's power a wall loses per bounce

    // --- Lines of Vigor ---
    vigorDamage: 40, // × wave quality
    vigorSpeed: 520, // units per second
    bounceLoss: 0.3, // power lost per bounce off a wall
    minVigorPower: 5, // a Vigor weaker than this fizzles out
  },

  // --- Lines of Making (chalklings) ---
  chalkling: {
    maxStrokes: 16,
    minInk: 60, // total chalk (units of line) needed to make anything at all
    maxSize: 220, // a creature can't be bigger than this across
    // "Detail" decides how strong a creature is: more chalk, more strokes,
    // and closed shapes (heads, bodies, eyes) all add to it.
    detailPerInk: 1 / 150,
    detailPerStroke: 0.25,
    detailPerClosedShape: 1,
    maxDetail: 15,
    closedGapRatio: 0.15, // a stroke whose ends meet this closely is a closed shape
    minClosedInk: 12, // ...and is at least this long (so a dot doesn't count)
    // Roles: what the drawing looks like shifts its strength around.
    //   spiky (loose line ends, sharp corners: claws, teeth)  → attacker: stronger bite
    //   bulky (big closed shapes: shells, round bodies)        → defender: more health
    //   long and leggy (stretched body, lots of short strokes)  → runner: faster
    cornerAngle: 1.1, // a bend sharper than this (radians, about 63°) is a "corner"
    spikePerLooseEnd: 0.35,
    spikePerCorner: 1,
    bulkPerArea: 1 / 100, // closed area (square units) → bulk points, after a square root
    leggyPerShortStroke: 1,
    shortStroke: 45, // open strokes shorter than this count as legs (on a long body)
    leggyPerStretch: 3, // per unit of length/width beyond 1.5
    roleBoost: 0.9, // how much a role shifts stats (0 = roles don't matter)
    balancedBelow: 0.45, // if no trait has this share, the chalkling is "balanced"
    // Stats from detail.
    baseHealth: 20,
    healthPerDetail: 10,
    baseBite: 3, // damage per second when chewing or fighting
    bitePerDetail: 1,
    baseSpeed: 100, // units per second; more detail makes it slower
    slowPerDetail: 0.05,
    minRadius: 12,
    maxRadius: 60,
    // Behaviour.
    aggroRange: 170, // attackers go after enemy chalklings this close
    guardRange: 300, // guards defend this far from their own circle
    guardDistance: 70, // guards stand this far in front of their circle
    contactPad: 4,
  },

  // --- Making chalklings the book way, and erasing ---
  //   1. a chain from a bind point   2. a holding circle on the chain's end
  //   3. the creature inside the circle   4. a path out of it   5. erase the chain
  making: {
    eraseMs: 3000, // rubbing a line out takes this long, without stopping
    eraseGraceMs: 400, // rubbing back and forth may leave the line this long without restarting
    eraseReach: 24, // the eraser counts as "on" a line within this distance
    insideFraction: 0.75, // a stroke this much inside a holding circle is part of the creature
    pathStartReach: 24, // a path must start this close to the holding circle's line (or the chalkling)
    huntReach: 30, // a path ending this close to an enemy chalkling means "hunt it"
    pathSpacing: 8, // path points are this far apart
    waypointReach: 8, // a chalkling is "at" a path point when this close
    returnDepth: 140, // after a hunt, chalklings walk back this far onto their own side
  },

  // --- The bot (milestone 5) ---
  // noise: how shaky its hand is. speed: how fast it draws (units per second).
  // think: pause before each decision, in ms [min, max]. The rest is how smart it is.
  bot: {
    homeRadius: 125,
    levels: {
      student: {
        noise: 8, speed: 330, think: [1900, 3200],
        defendChance: 0.2, // chance it walls off an incoming Vigor
        counterChance: 0.2, // chance it shoots at an approaching chalkling
        aim: 'random', // random | damaged | weakest
        makeChance: 0.1, creature: 'stick',
        defense: 'none', // none | shield | full (bound shield + walls on bind points)
      },
      duelist: {
        noise: 4, speed: 500, think: [1200, 2100],
        defendChance: 0.55, counterChance: 0.6,
        aim: 'damaged', makeChance: 0.18, creature: 'urchin',
        defense: 'shield',
      },
      professor: {
        noise: 1.8, speed: 680, think: [750, 1350],
        defendChance: 0.9, counterChance: 0.9,
        aim: 'weakest', makeChance: 0.22, creature: 'beetle',
        defense: 'full', // its shield and one wall; the bottom bind point stays free for chains
      },
    },
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
    boundColor: '150, 220, 170', // bind points and bound lines
    makingColor: '190, 175, 255', // a chalkling still being drawn
    teamColors: { left: '150, 220, 170', right: '240, 150, 130' },
    chalkWidth: 4, // px
    chalkStrands: 4, // thin lines layered to make one chalk line
    chalkGrain: 2, // px per chalk texture step (smaller = finer grain, more work)
    dustChance: 0.25, // chance per segment of leaving a speck of dust
    dudFadeMs: 2200, // how long a dud takes to fade away
    labelFont: '15px "Segoe Print", "Comic Sans MS", cursive',
  },
};
