# Rithmatist Duel: Build Plan

This file is the plan for the whole project. Claude Code: read all of it before doing anything, then follow section 2 on how to work with me.

## 1. What this is

A browser game based on the chalk duels in Brandon Sanderson's *The Rithmatist*. Two duelists draw chalk lines on a board in real time. The game recognizes what each drawing is, scores how well it was drawn, and brings it to life. You win by breaching the other duelist's main circle.

The heart of the game is that **drawing skill matters**. A wobbly circle is a weak circle. If a feature ever has to choose between "feels like drawing chalk" and "easier to code," pick the first one and tell me the cost.

This is a fan project for personal use and for learning. It is not for sale.

## 2. How to work with me

I'm Zane. I'm building this mainly to learn coding and design, so these rules matter as much as the game does.

1. **Plan first, then wait.** Before each milestone, tell me in plain language what you're going to build and which files you'll touch. Do not write code until I say OK.
2. **One milestone at a time.** Do not start the next one until I've played the current one and approved it.
3. **Keep the old version.** Commit to git when a milestone works, and tag it (`m1`, `m2`, and so on) so I can always go back.
4. **Say what changed.** After each chunk of work, give me a short summary: what changed, which files, and how to try it.
5. **Explain as you go.** When you use a concept I might not know (modules, game loop, websockets), explain it in two or three sentences.
6. **Ask before anything outside the project folder.** No installing global tools, creating accounts, deploying, deleting files, or spending money without my OK.
7. **Check your own work.** Run the tests and load the game before telling me something is done.
8. **Be blunt.** If one of my ideas is weak or will blow up the scope, say so.

## 3. Tech choices

- Runs in the Chrome browser on a Chromebook. Must work with both a mouse/trackpad and a touchscreen.
- Plain HTML, CSS, and JavaScript using ES modules. No framework. Drawing is done on an HTML canvas.
- Input uses Pointer Events so mouse, touch, and multi-touch all go through one code path.
- Tests use Node's built-in test runner (`node --test`). The engine and the recognizer must be testable without a browser.
- A tiny local dev server is fine. Keep dependencies as close to zero as possible until milestone 6.
- Milestone 6 adds a small Node server with websockets (the `ws` package).

If you think a different choice is clearly better, make the case before milestone 1 starts, not halfway through.

## 4. Architecture: the one big rule

**The duel rules must not know who is holding the chalk.**

The game has four parts that stay separate:

- **Recognizer.** Takes a stroke (a list of points) and returns what kind of line it is and a quality score from 0 to 1. Pure logic, no canvas, no game state.
- **Engine.** Holds the duel state and the rules: line health, Vigor movement, chalklings, breach detection. It advances in fixed time steps. Pure logic, no canvas, no input code.
- **Renderer.** Draws the current state to the canvas with a chalkboard look. It only reads state and never changes it.
- **Controllers.** Anything that produces strokes for a duelist: a human with a pointer, a bot, or a network connection. The engine receives strokes and does not care where they came from.

This is what makes all three play modes (bot, same screen, online) cheap to add later. If a shortcut would break this separation, do not take it.

Suggested layout:

```
rithmatist-duel/
  PLAN.md
  index.html
  src/
    main.js
    config.js            all tuning numbers live here
    recognizer/          stroke cleanup, classify, score
    engine/              state, lines, vigor, chalklings, bind points, rules
    render/              board, chalk strokes, HUD, debug overlay
    controllers/         human.js, bot.js, network.js
    data/defenses.js     named defense layouts
  server/                added in milestone 6
  tests/
```

## 5. Game rules

### The board

- A chalkboard split into two halves, one per duelist. You can only draw in your own half.
- The game is real time. There is no chalk meter or mana. The only limit is how fast and how well you can draw.

### The four lines

**Line of Warding (circle).** Your defense. The first valid circle you draw becomes your main circle, and your duelist stands at its center. The circle is divided into arc segments, each with its own health, so attacks damage the spot they hit. Rounder circles have more health. If any segment of your main circle reaches zero, you are breached and you lose.

**Line of Forbiddance (straight line).** A wall. It blocks Vigor lines and chalklings from both sides, including your own chalklings. Straighter lines are stronger.

**Line of Vigor (wave).** Your attack. A wave shaped like a sine curve that launches in the direction you drew it. It damages the first Warding line or chalkling it hits, then disappears. It bounces off Lines of Forbiddance and loses some power each bounce. Even, regular waves hit harder.

**Line of Making (chalklings).** Drawn creatures. They walk, attack enemy lines, and fight enemy chalklings. Added in milestone 4.

### Bind points (milestone 3)

- A main circle has bind points: 2, 4, or 6, evenly spaced. The duelist picks the circle type before the duel. The first bind point faces the opponent.
- Once the circle is drawn, bind points show as faint tick marks.
- A line or smaller circle that touches the main circle at a bind point is "bound" and gets a strength bonus.
- Anything touching the main circle away from a bind point weakens that arc segment.
- The nine-point circle (uneven spacing, based on a triangle) is a stretch goal.

### Failed drawings

A stroke the game cannot recognize becomes a dud. It fades away, and the game briefly shows why it failed ("circle not closed," "wave too uneven"). This is how players learn to draw better, so the feedback must be clear.

## 6. Drawing recognition

This is the riskiest part of the project. Get it right before building anything else.

Steps for each stroke:

1. Collect points while the pointer is down.
2. Clean up: resample to evenly spaced points and smooth out jitter.
3. Classify, in this order:
   - **Closed loop** (the end is near the start compared to the stroke's length): Warding. Quality comes from how even the radius is around a fitted circle and how small the closing gap is.
   - **Straight** (path length is close to the straight distance between the ends): Forbiddance. Quality comes from how far the stroke strays from a fitted line.
   - **Wave** (crosses its own center line at least 3 times with regular spacing): Vigor. Quality comes from how consistent the height and width of the waves are. Direction is from the start of the stroke to the end.
   - **Anything else**: a dud until milestone 4, when Making mode exists.
4. Return the type, the quality score, and the cleaned up shape.

Requirements:

- A **debug overlay** (toggle with a key) that shows the type, the score, and the numbers behind the score for every stroke. I need this to tune things.
- Thresholds live in `config.js`, never buried in the code.
- Tests with saved example strokes: good circles, bad circles, straight lines, waves, and scribbles.
- Must feel fair on both a trackpad and a touchscreen. Trackpad circles are naturally worse, so thresholds may need to be forgiving.

## 7. Milestones

Each one ends with something I can play. Each one needs my OK before the next one starts.

### M1: Chalkboard and recognition

Build the board, the chalk drawing look, the recognizer, and the debug overlay. No duel yet. Recognized strokes get a label and a score. Duds fade with a reason.

**Done when:** I can draw each of the three line types and the game names them correctly about 9 times out of 10, on both trackpad and touchscreen, and the tests pass.

### M2: Core duel against a practice dummy

Add the engine: main circles with arc segment health, Forbiddance walls, Vigor projectiles, bouncing, damage, and breach detection. The opponent is a dummy that draws a circle at the start and then does nothing. Add win and lose screens and a rematch button.

**Done when:** I can breach the dummy's circle with Vigor lines, a badly drawn circle visibly breaks faster than a good one, and the engine has tests for damage, bouncing, and breach.

### M3: Bind points and named defenses

Add circle types (2, 4, 6 point), bind point marks, bound bonuses, and off-point penalties. Add smaller Warding circles that can attach at bind points. Add `data/defenses.js` and a practice mode that shows a faint template of a named defense for me to trace.

Named defenses to support as data: Matson, Ballintain, Easton, and others from the book. **Do not invent their layouts.** I will give you the layouts from the diagrams in my copy of the book. Until then, use one clearly labeled placeholder.

**Done when:** A defense anchored on bind points measurably outlasts the same shapes placed off them, and I can trace a template in practice mode.

### M4: Chalklings

- **4a:** A Making mode toggle. While it's on, what I draw becomes a chalkling, and my actual drawing is the creature's sprite. Stats are fixed for now. Two orders: attack and guard. Chalklings walk, chew on enemy lines, fight enemy chalklings, and are blocked by any Line of Forbiddance.
- **4b:** Stats come from the drawing. More detail (more strokes, more chalk, closed shapes) means a stronger chalkling that takes longer to draw. Vigor lines can destroy chalklings.

**Done when:** I can win a duel using only chalklings, and a detailed chalkling beats a stick figure.

### M5: A bot that fights back

The bot is a controller that creates strokes the same way a human does: it generates points and sends them through the recognizer. No cheating by placing perfect lines directly.

Difficulty changes three things: how steady its "hand" is (noise added to its strokes), how fast it draws, and how smart its choices are. Three levels: student, duelist, professor.

**Done when:** I beat student easily, duelist is a real fight, and professor beats me most of the time.

### M6: Same screen and online

- **6a, same screen:** Two players on one touchscreen, each drawing on their own half at the same time using multi-touch. With only a mouse, this mode shows a message that it needs a touchscreen.
- **6b, online:** A small Node server runs the same engine and recognizer code as the browser. Clients send their strokes, and the server sends back the state. Join by room code. Test it first with two browser tabs on one machine.

Putting the server on the internet so someone in another house can play is a separate decision. Stop and ask me before signing up for any hosting or anything that could cost money.

**Done when:** Two tabs can play a full duel against each other with no drift between what each one sees.

## 8. Lore check list

These came from memory of the book and need checking against my copy before they are treated as final:

- Whether Vigor lines bounce off Forbiddance lines exactly the way section 5 describes.
- The real bind point layouts for each named defense.
- How ellipses behave as Lines of Warding.
- How duelists give orders to chalklings (the book uses glyphs; this plan uses simple buttons for now).

Where the book and fun gameplay disagree, I decide.

## 9. Tuning values

All of these are starting guesses. Put them in `config.js` and expect to change them a lot.

| Value | Starting guess |
| --- | --- |
| Arc segments per circle | 24 |
| Segment health | 100 x circle quality |
| Forbiddance health | 150 x line quality |
| Vigor damage | 40 x wave quality |
| Vigor power lost per bounce | 30% |
| Bound bonus | +50% strength |
| Off-point penalty | -25% health on that segment |
| Minimum quality to count | 0.4 (below this, the stroke is a dud) |

## 10. Not in this project (for now)

- Accounts, logins, or saved profiles
- Ranked play or matchmaking
- Sound and music (can come after M6)
- Mobile phone layout
- Any story or campaign mode

If I ask for one of these mid-milestone, remind me it's on this list and ask whether I want to finish the milestone first.
