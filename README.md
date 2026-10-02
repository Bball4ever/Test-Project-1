# Rithmatist Duel

A browser chalk-dueling game based on Brandon Sanderson's *The Rithmatist*. Fan project for learning. See `PLAN.md` for the full plan.

## Play it locally

Needs Node.js 22 or newer.

```
npm start
```

Then open http://localhost:8000 in Chrome.

## Controls (Milestone 1)

- Draw a **circle** (Line of Warding), a **straight line** (Line of Forbiddance) or a **wave** (Line of Vigor).
- **D**: debug overlay with the numbers behind each score
- **S**: copy your last stroke as JSON (to turn it into a test)
- **C**: clear the board

## Tests

```
npm test
```

Real strokes saved with **S** go into `tests/fixtures/recorded.json`, where the tests check that each one is still recognized as the expected type.
