# Rithmatist Duel

A browser chalk-dueling game based on Brandon Sanderson's *The Rithmatist*. Fan project for learning, not for sale. `PLAN.md` has the full plan.

Draw chalk lines on a board in real time. The game recognizes what you drew, scores how well you drew it, and brings it to life. Breach the other duelist's main circle to win.

## Running it

You need Node.js 22 or newer.

```
npm install     # once: gets the one dependency (ws, for online play)
npm start       # then open http://localhost:8000 in Chrome
```

## Playing without installing anything

`npm run build:page` builds the whole game into one file, `dist/rithmatist-duel.html`, that runs in any browser with no server. This is the version published as a claude.ai page. Online play is hidden there, because it needs the game server.

## The four lines

| Draw | Line | What it does |
| --- | --- | --- |
| A circle | **Warding** | Your first circle is your main circle, and you stand in it. It has 24 sections; if any one breaks, you lose. Rounder circles are stronger, and wobbly spots are weak spots. |
| A straight line | **Forbiddance** | A wall. It stops waves (taking their damage until it breaks), and chalklings can't pass it. |
| A wave | **Vigor** | Your attack. It flies the way you drew it and damages the first circle or chalkling it hits. Even waves hit harder. |
| A creature in a holding circle | **Making** | A chalkling: your drawing comes alive, walks its path, and chews through lines. See below. |

**Chalk limit:** each duelist has a set amount of chalk for the whole duel (8,000 to start; see the meters at the top). Every stroke uses chalk equal to its length, even if it fails, so spamming runs you dry. If both sides run out and nothing is still moving, the duel is a draw.

**Bind points:** green ticks on your main circle. A line or small circle that touches your circle at a bind point is **bound** (+50% strength). Touching anywhere else weakens that part of your circle (−25%).

## Making a chalkling (the book way)

Press **Chalkling** (or M) first: while it's on, your strokes are chalkling parts instead of ordinary lines.

1. **Chain:** draw a straight line from one of your green bind points.
2. **Holding circle:** draw a circle touching the chain's far end.
3. **Creature:** draw it inside the holding circle, in as many strokes as you like.
4. **Path:** draw a line from the circle to where it should go. It follows the path, going around any wall in its way (or chewing through if there's no way round), and attacks the enemy circle if the path leads there. **End the path on an enemy chalkling** and yours hunts that one until it's dead.
5. **Release:** turn Chalkling off, press **Eraser** and click the chain. 3 seconds later the chain is gone and the chalkling breaks out.

Any chalkling attacks an enemy chalkling that comes close, then carries on with what it was doing (a hunter stays on its target). Chalklings find their own way: they walk **around** walls and circles (using A* route-finding), and only chew through a wall if there's no way round. The enemy circle they're attacking is never avoided: they go straight for it.

When a path ends, the chalkling follows the **Attack / Guard** buttons. After a hunt, it walks back to your side and waits (shown with a "?"). To give it a new command: in Chalkling mode, draw a line from a bind point to it (a new chain) and a new path from it, then erase the chain.

**What it's good at depends on what you draw.**
- **Spiky** drawings (claws, teeth, lots of loose line ends) are **attackers**: they bite harder.
- **Bulky** drawings (shells, big round closed shapes) are **defenders**: they have more health.
- **Long, leggy** drawings are **runners**: they're faster.
- More chalk and detail makes any of them stronger, but slower.

## Erasing

Press **Eraser** (or E), then click one of your own lines. The eraser turns itself off, and **3 seconds later** the line is gone (it fades while you wait, and you can keep drawing). You can erase your walls, chains, paths and small circles, but never your main circle or anything of your opponent's.

## Modes

- **Practice dummy:** it draws a neat or sloppy circle and stands still. You can also pick a defense to trace.
- **Bot:** student, duelist or professor. Bots draw like people do: point by point, with a shaky hand, through the same recognizer.
- **Same screen:** two people on one touchscreen, each drawing on their own half at the same time.
- **Online:** one player presses **Create room** and shares the 4-letter code; the other enters it and presses **Join**. For now this works between tabs on the computer running `npm start`.

## Controls

| Key | Button | Does |
| --- | --- | --- |
| M | Chalkling | Turn Chalkling mode on or off (chain, circle, creature, path). |
| E | Eraser | Turn the eraser on, then click a line: it's gone 3 seconds later. |
| A / G | Attack / Guard | Orders for chalklings that have finished their paths. |
| D | Debug | Shows the numbers behind every score, section health, and chalkling stats. |
| S | Save stroke | Copies your last stroke as JSON, to turn into a test. |

## Tuning

Every number lives in `src/config.js`: thresholds, health, damage, speeds and bot levels. Change one, reload the page, and play.

## Tests

```
npm test
```

There are 87 tests covering:
- the recognizer
- the duel engine (damage, walls stopping waves, breach)
- bind points
- chalklings (including finding their way around lines, and fighting nearby enemies)
- the chalk limit
- the bots (including bot-vs-bot ranking)
- online play (two real connections, checking both see the same duel)

Real strokes saved with **S** go into `tests/fixtures/recorded.json` and are checked on every run.

## How the code is organized

```
src/
  config.js        every tuning number
  recognizer/      stroke clean-up, classify, score (no canvas, no game state)
  engine/          the duel rules, in fixed 1/60 s steps (no canvas, no input)
  render/          draws the state; never changes it
  controllers/     things that make strokes: human, dummy, bot
  data/            named defenses and ready-made creature drawings
  net/             online snapshots and the browser's connection
server/            the game server: serves the files, runs online rooms
tests/
```

The big rule: **the duel rules don't know who is holding the chalk.** A person, a bot or a network player all send the same kind of action, and the engine treats them all the same.

## Still to do

- **Named defenses:** Matson, Ballintain and Easton are listed but disabled until their real layouts come from the book. Only a clearly labeled placeholder can be traced. Add layouts in `src/data/defenses.js`.
- **Lore checks:** see section 8 of `PLAN.md`.
- **Playing online between different houses:** this needs the server put on the internet, which is a separate decision (it may need an account or cost money).
