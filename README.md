# Rithmatist Duel

A browser chalk-dueling game based on Brandon Sanderson's *The Rithmatist*. Fan project for learning. See `PLAN.md` for the full plan.

## Play it locally

Needs Node.js 22 or newer.

```
npm start
```

Then open http://localhost:8000 in Chrome.

## How to play (Milestone 2: practice duel)

1. Pick the dummy's circle (neat or sloppy) and press **Start duel**.
2. On the **left** half, draw a **circle** first. That's your main Line of Warding, and you stand in it.
3. Draw **waves** (Lines of Vigor) to attack. They fly the way you drew them.
4. Draw **straight lines** (Lines of Forbiddance) as walls. Waves bounce off them and lose 30% power each bounce.
5. Break any one section of the dummy's circle to win.

Keys: **D** shows the debug overlay (section health, the numbers behind each score). **S** copies your last stroke as JSON for tests.

## Tests

```
npm test
```

Real strokes saved with **S** go into `tests/fixtures/recorded.json`, where the tests check that each one is still recognized as the expected type.
