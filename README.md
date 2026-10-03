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
| A straight line | **Forbiddance** | A wall. It stops waves (taking their damage until it breaks), and chalklings can't pass it. You can have **8 walls** at a time; erase one to draw another. |
| A wave (3+ humps) | **Vigor** | Your attack. Any wave with at least 3 humps, curved or spiky, is a Line of Vigor. It flies the way you drew it and damages the first circle, wall or chalkling it hits. Even waves hit harder. **How spiky** it is (0–100%) decides what it's good against: fully curved does ×1.4 to circles and walls but ×0.6 to chalklings; fully spiky (sharp, narrow points) does ×1.6 to chalklings but ×0.6 to lines; in between is a mix. The label shows how spiky yours came out. |
| A creature in a holding circle | **Making** | A chalkling: your drawing comes alive, walks its path, and chews through lines. See below. |

**Chalk limit:** each duelist has a set amount of chalk for the whole duel (30,000 to start; see the meters at the top). Every stroke uses chalk equal to its length, even if it fails, so spamming runs you dry. **Waves are half price**: a Line of Vigor uses half its length. If both sides run out and nothing is still moving, the duel is a draw.

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

## Chalkling powers

While Chalkling mode is on, a row of **Power** buttons appears at the top. Pick one before you draw the creature (the last part you draw decides, so you can change your mind until then). **The more chalk you spend on the creature, the stronger its power:** power level = creature chalk ÷ 300, from ×0.5 (a quick stick figure) to ×3 (a big detailed drawing). The hint shows the level so far while you draw, and the label above the chalkling shows it after.

| Power | What it does at level L |
| --- | --- |
| Sword | Bites harder: bite × (1 + 0.5 L) |
| Bow | Shoots an arrow every 1.2 s at the nearest enemy chalkling within 180 + 40 L, for 8 L damage |
| Shield | Takes less damage: damage ÷ (1 + 0.5 L) |
| Wings | Flies over walls, and speed × (1 + 0.15 L) |
| Crown | Friends within 120 + 30 L bite × (1 + 0.15 L) |
| Healer | Heals itself and friends within 150 by 4 L health a second |
| Whirlwind | Much faster: speed × (1 + 0.3 L) |

Bots use powers too, from level 3 up (see below).

## Erasing

Press **Eraser** (or E), then click one of your own lines. The eraser turns itself off, and **3 seconds later** the line is gone (it fades while you wait, and you can keep drawing). You can erase your walls, chains, paths and small circles, but never your main circle or anything of your opponent's.

## Modes

- **Practice dummy:** it draws a neat or sloppy circle and stands still. You can also pick a defense to trace.
- **Bot:** ten levels (below). Bots draw like people do: point by point, with a shaky hand, through the same recognizer.

## Bot levels

| # | Level | What's new at this level |
| --- | --- | --- |
| 1 | Beginner | Very shaky and slow, aims anywhere, rarely blocks |
| 2 | Student | A bit steadier and quicker |
| 3 | Apprentice | Gives its chalklings a random power |
| 4 | Senior student | Draws a shield circle; aims at damaged spots; spikier chalklings |
| 5 | Duelist | Steadier, quicker, blocks more |
| 6 | Champion | Picks powers smartly: a Healer to back up its chalklings, a Bow against yours, else Bow or Shield |
| 7 | Tutor | Full defense (shield and a wall); aims at your weakest spot; beetle chalklings |
| 8 | Professor | Steadier, quicker, blocks almost everything |
| 9 | Master | Stops in the middle of a chalkling to block a wave, then carries on; bigger chalklings (stronger powers) |
| 10 | Grand master | Also attacks while waiting for a chain to erase; biggest chalklings |

Bots throw curved waves at your circle and spiky ones at your chalklings, and keep to the 8-wall limit.

The smart power choice came from testing: in bot-vs-bot duels **Bow** and **Shield** won far more often than the others, and **Wings** and **Whirlwind** actually lost more than having no power. Each level beats the one below it in at least 7 of 12 test duels. All the settings are in `src/config.js` under `bot.levels`.
- **Same screen:** two people on one touchscreen, each drawing on their own half at the same time.
- **Online:** one player presses **Create room** and shares the 4-letter code; the other enters it and presses **Join**. For now this works between tabs on the computer running `npm start`.

## Controls

| Key | Button | Does |
| --- | --- | --- |
| M | Chalkling | Turn Chalkling mode on or off (chain, circle, creature, path). |
| E | Eraser | Turn the eraser on, then click a line: it's gone 3 seconds later. |
| A / G | Attack / Guard | Orders for chalklings that have finished their paths. |
| P | Pause | Freeze the duel (not online). |
| D | Debug | Shows the numbers behind every score, section health, and chalkling stats. |
| S | Save stroke | Copies your last stroke as JSON, to turn into a test. |

## Tuning

Every number lives in `src/config.js`: thresholds, health, damage, speeds and bot levels. Change one, reload the page, and play.

## Tests

```
npm test
```

There are 106 tests covering:
- the recognizer
- the duel engine (damage, how spiky waves are, walls stopping waves, the wall limit, breach)
- bind points
- chalklings (including finding their way around lines, and fighting nearby enemies)
- chalkling powers
- the chalk limit
- the bots (including all ten levels ranking in order)
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
