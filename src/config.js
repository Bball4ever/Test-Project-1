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
      minHumps: 3, // a wave needs at least this many humps (bumps to either side)
      // A part-hump at either end counts if it's at least this fraction of a
      // whole hump's width and height. (Height is more lenient: on a short
      // wave the center line comes out a little tilted, which shrinks the ends.)
      endHumpWidth: 0.6,
      endHumpHeight: 0.4,
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
      // How spiky? Each bump's "fill" is its average height ÷ its peak height:
      // a rounded bump is about 0.64 full, an even zigzag about 0.54, sharp
      // narrow spikes 0.45 or less. Spikiness runs from 0 at curvedFill to 1
      // at spikyFill.
      curvedFill: 0.63,
      spikyFill: 0.5,
    },
  },

  engine: {
    // The board is always this many units, whatever the screen size.
    // The renderer scales it to fit.
    world: { width: 1600, height: 900 },
    stepMs: 1000 / 60, // the engine moves forward in steps of exactly this long
    sideMargin: 8, // how far past the border of your territory a stroke may stray
    // With 3 to 10 players the board is a bigger square and the players' homes
    // sit in a ring (see engine/territory.js).
    territory: {
      spacing: 760, // about this far between neighbours' homes
      minRing: 450, // the ring is at least this big (so 3 players aren't cramped)
      margin: 520, // room between the ring and the board's edge
    },

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
    // At the start everyone has this long to draw their main circle. Anyone
    // who hasn't by then is out.
    circleDeadlineMs: 5000,
    minMainRadius: 90, // a main circle must be at least this big (radius)
    touchTolerance: 18, // a line within this many units of the main circle "touches" it
    bindTolerance: 26, // a touch this close (along the circle) to a bind point is "bound"
    boundBonus: 0.5, // bound lines and circles get +50% strength
    offPointPenalty: 0.25, // touching away from a bind point: that section loses 25%

    // --- Lines of Forbiddance ---
    wallHealth: 150, // × line quality
    wallDamageFromVigor: 1, // a wall takes this much of a Vigor's power when it stops one

    // --- Lines of Vigor ---
    vigorDamage: 40, // × wave quality
    vigorSpeed: 520, // units per second
    // Curved waves are better against lines (walls and circles); spiky
    // waves are better against chalklings. Damage × these, for a fully curved
    // and a fully spiky wave; anything in between gets a mix (e.g. 50% spiky:
    // ×1.0 on lines, ×1.1 on chalklings).
    vigorStyles: {
      curved: { walls: 1.4, circles: 1.4, chalklings: 0.6 },
      spiky: { walls: 0.6, circles: 0.6, chalklings: 1.6 },
    },
    maxWalls: 8, // Lines of Forbiddance each duelist can have at once
  },

  // --- Lines of Making (chalklings) ---
  chalkling: {
    minInk: 60, // total chalk (units of line) needed to make anything at all
    maxSize: 220, // a creature can't be bigger than this across
    // "Detail" decides how strong a creature is: the most important thing.
    // It counts the separate features in the drawing, NOT how much chalk they
    // used: each part, closed shapes (heads, eyes, shells), sharp
    // corners (claws, teeth) and small parts. Parts drawn in the detail
    // screen count extra.
    detailPerStroke: 0.3,
    detailPerClosedShape: 0.6,
    detailPerCorner: 0.15,
    detailPerSmallPart: 0.15,
    smallPart: 0.3, // a part smaller than this fraction of the whole creature is "small"
    detailScreenBonus: 1.5, // features drawn in the detail screen × this
    maxDetail: 30, // detail stops counting past this
    closedGapRatio: 0.15, // a stroke whose ends meet this closely is a closed shape
    minClosedInk: 12, // ...and is at least this long (so a dot doesn't count)
    // Shape shifts strength between health and bite:
    //   pointy (loose line ends, sharp corners: claws, teeth) → more bite
    //   round  (big closed shapes: shells, round bodies)      → more health
    cornerAngle: 1.1, // a bend sharper than this (radians, about 63°) is a "corner"
    spikePerLooseEnd: 0.35,
    spikePerCorner: 1,
    bulkPerFill: 20, // round points for closed shapes filling the whole creature (a turtle's shell fills about 0.6)
    shortStroke: 45, // (open strokes shorter than this count as short)
    // A fully pointy creature's bite (or a fully round one's health) is ×(1 + shapeBoost/2),
    // and the other stat ×(1 − shapeBoost/2). An even mix changes nothing.
    shapeBoost: 0.9,
    leaningAbove: 0.6, // over this share pointy (or round), it's called pointy (or round)
    // Health and bite from detail.
    baseHealth: 20,
    healthPerDetail: 10,
    baseBite: 3, // damage per second when chewing or fighting
    bitePerDetail: 1,
    // Speed from chalk: the more chalk in the drawing, the slower it walks.
    // speed = fastSpeed ÷ (1 + chalk × slowPerInk), at least minSpeed. A quick
    // stick figure (~150 chalk) walks about 100; a big detailed drawing (~1000) about 45.
    fastSpeed: 160,
    slowPerInk: 1 / 400,
    minSpeed: 15,
    minRadius: 12,
    maxRadius: 60,
    // Behaviour.
    closeRange: 80, // any chalkling attacks an enemy chalkling that comes this close (edge to edge)
    aggroRange: 170, // chalklings on the Attack order go after enemy chalklings this close
    guardRange: 300, // guards defend this far from their own circle
    guardDistance: 70, // guards stand this far in front of their circle
    contactPad: 4,
  },

  // --- The chalk limit ---
  // Each duelist has this much chalk for the whole duel. Every stroke uses
  // chalk equal to its length (failed strokes too). Out of chalk, out of luck.
  chalk: {
    supply: 30000,
    vigorCost: 0.5, // a Line of Vigor only uses this fraction of its length in chalk
    // If both duelists have less than this left and nothing is moving
    // (no Vigors in flight, no chalklings), the duel is a draw.
    tooLittle: 150,
  },

  // --- Making chalklings the book way, and erasing ---
  //   1. a chain from a bind point   2. a holding circle on the chain's end
  //   3. the creature inside the circle   4. a path out of it   5. erase the chain
  making: {
    eraseMs: 3000, // a line clicked with the eraser disappears this long afterwards
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
    // Ten levels, easiest first. What each setting means:
    //   noise          how shaky its hand is (bigger = wobblier, weaker lines)
    //   speed          how fast it draws (board units per second)
    //   think          how long it pauses between moves (ms, from-to)
    //   defendChance   chance it walls off an incoming Vigor
    //   counterChance  chance it shoots at an approaching chalkling
    //   aim            random | damaged | weakest (which part of your circle it aims at)
    //   makeChance     how often it makes a chalkling instead of attacking
    //   creature       what it draws: stick | urchin | beetle
    //   holdRadius     size of its holding circle (and so of its creature)
    //   defense        none | shield | full (bound shield + walls on bind points)
    //   interrupts     drops what it's drawing to block an incoming wave, then carries on
    //   multitask      attacks while waiting for a chain to be erased
    //   detailScreen   draws its chalklings in the detail screen (more detail)
    levels: {
      beginner: {
        name: 'Beginner',
        noise: 11, speed: 260, think: [2400, 3800],
        defendChance: 0.1, counterChance: 0.1, aim: 'random',
        makeChance: 0.08, creature: 'stick', holdRadius: 55,
        defense: 'none',
      },
      student: {
        name: 'Student',
        noise: 8, speed: 330, think: [1900, 3200],
        defendChance: 0.2, counterChance: 0.2, aim: 'random',
        makeChance: 0.1, creature: 'stick', holdRadius: 60,
        defense: 'none',
      },
      apprentice: {
        name: 'Apprentice',
        noise: 5.8, speed: 410, think: [1550, 2600],
        defendChance: 0.38, counterChance: 0.4, aim: 'random',
        makeChance: 0.13, creature: 'stick', holdRadius: 60,
        defense: 'none',
      },
      senior: {
        name: 'Senior student',
        noise: 5, speed: 450, think: [1400, 2400],
        defendChance: 0.45, counterChance: 0.5, aim: 'damaged',
        makeChance: 0.16, creature: 'urchin', holdRadius: 60,
        defense: 'shield',
      },
      duelist: {
        name: 'Duelist',
        noise: 4, speed: 500, think: [1200, 2100],
        defendChance: 0.55, counterChance: 0.6, aim: 'damaged',
        makeChance: 0.18, creature: 'urchin', holdRadius: 60,
        defense: 'shield',
      },
      champion: {
        name: 'Champion',
        noise: 3.2, speed: 560, think: [1050, 1800],
        defendChance: 0.68, counterChance: 0.7, aim: 'damaged',
        makeChance: 0.2, creature: 'urchin', holdRadius: 62,
        defense: 'shield',
      },
      tutor: {
        name: 'Tutor',
        noise: 2.5, speed: 620, think: [900, 1550],
        defendChance: 0.8, counterChance: 0.8, aim: 'weakest',
        makeChance: 0.21, creature: 'beetle', holdRadius: 64,
        defense: 'full', detailScreen: true,
      },
      professor: {
        name: 'Professor',
        noise: 1.8, speed: 680, think: [750, 1350],
        defendChance: 0.9, counterChance: 0.9, aim: 'weakest',
        makeChance: 0.22, creature: 'beetle', holdRadius: 66,
        defense: 'full', // its shield and one wall; the bottom bind point stays free for chains
        detailScreen: true,
      },
      master: {
        name: 'Master',
        noise: 1.3, speed: 760, think: [620, 1150],
        defendChance: 0.95, counterChance: 0.95, aim: 'weakest',
        makeChance: 0.24, creature: 'beetle', holdRadius: 72,
        defense: 'full', detailScreen: true, interrupts: true,
      },
      grandmaster: {
        name: 'Grand master',
        noise: 0.7, speed: 1050, think: [320, 620],
        defendChance: 0.98, counterChance: 0.98, aim: 'weakest',
        makeChance: 0.26, creature: 'beetle', holdRadius: 80,
        defense: 'full', detailScreen: true, interrupts: true, multitask: true,
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
    // Each player's colour: you ('left'), the first opponent ('right'), then p2 to p9.
    teamColors: {
      left: '150, 220, 170',
      right: '240, 150, 130',
      p2: '130, 180, 250',
      p3: '240, 215, 120',
      p4: '200, 160, 240',
      p5: '120, 220, 225',
      p6: '245, 175, 100',
      p7: '240, 150, 200',
      p8: '190, 230, 110',
      p9: '215, 215, 215',
    },
    chalkWidth: 4, // px
    chalkStrands: 4, // thin lines layered to make one chalk line
    chalkGrain: 2, // px per chalk texture step (smaller = finer grain, more work)
    dustChance: 0.25, // chance per segment of leaving a speck of dust
    dudFadeMs: 2200, // how long a dud takes to fade away
    labelFont: '15px "Segoe Print", "Comic Sans MS", cursive',
  },
};
