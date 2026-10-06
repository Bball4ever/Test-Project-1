# Rithmatist Duel

A browser chalk-dueling game based on Brandon Sanderson's *The Rithmatist*. Fan project for learning, not for sale. `PLAN.md` has the full plan.

> **Fan project disclaimer:** Rithmatist Duel is an unofficial, non-commercial fan project based on *The Rithmatist* by Brandon Sanderson. It is not affiliated with, endorsed by, or sponsored by Brandon Sanderson, Dragonsteel Entertainment, or the book's publishers. *The Rithmatist* and its world, names and terms (Lines of Warding, Forbiddance, Vigor and Making, chalklings, and so on) belong to their owners. This project's own code is released under the MIT License (see `LICENSE`); that license does not cover anything from the book. The game is free to play.

Draw chalk lines on a board in real time. The game recognizes what you drew, scores how well you drew it, and brings it to life. Breach the other duelist's main circle to win.

## Running it

You need Node.js 22 or newer.

```
npm install     # once: gets the one dependency (ws, for online play)
npm start       # then open http://localhost:8000 in Chrome
```

Run this way, the server only listens to your own computer (127.0.0.1): two browser tabs on it can play each other online, but nobody else can connect. `PORT=9000 npm start` uses a different port.

## Hosting on Render

The game server is a Node.js web service with WebSocket connections, so it needs a host that keeps a server running (Vercel-style hosts that only run short functions won't work). [Render](https://render.com) runs it as is.

1. Put the repository on GitHub (or GitLab or Bitbucket): Render deploys from a Git repository.
2. In the Render Dashboard, choose **New > Blueprint** and pick the repository. Render reads `render.yaml` from the root of the repository:
   - build: `npm install`
   - start: `npm start`
   - health check: `/healthz` (the server answers `ok`)
   - `HOST=0.0.0.0`, so the server listens on every network address. Render sets `PORT` itself, and the server reads it. (The server also listens on every address whenever Render's own `RENDER` variable is set.)
3. When it's live, open the `https://….onrender.com` address it gives you. The browser connects to the game server with secure WebSockets (`wss://`) on the same address; nothing to configure.

**The free plan:** a free web service goes to sleep after 15 minutes without visitors, and the next visit wakes it in about a minute. Any rooms in progress when it sleeps or redeploys are lost (rooms live in the server's memory). A paid plan stays awake.

**Built in for a public server:**
- each connection may only send so many messages a second (drawing, live strokes, and creating or joining rooms)
- at most 500 rooms at a time
- a heartbeat every 30 seconds cuts off dead connections and frees their rooms

**Online play is 2 players only** (one room = one duel). Free-for-all and teams are for bots and same-screen play.

## Playing without installing anything

`npm run build:page` builds the whole game into one file, `dist/rithmatist-duel.html`, that runs in any browser with no server. This is the version published as a claude.ai page. Online play is hidden there, because it needs the game server.

## The four lines

| Draw | Line | What it does |
| --- | --- | --- |
| A circle | **Warding** | Your first circle is your main circle, and you stand in it. It must be at least as big as the dashed ring (radius 90). It has 24 sections; if any one breaks, you lose. Rounder circles are stronger, and wobbly spots are weak spots. |
| A straight line | **Forbiddance** | A wall. It stops waves (taking their damage until it breaks), and chalklings can't pass it. You can have **8 walls** at a time; erase one to draw another. |
| A wave (3+ humps) | **Vigor** | Your attack. Any wave with at least 3 humps, curved or spiky, is a Line of Vigor. It doesn't have to be neat: waves that bend (your arm swinging in an arc), lean, or have uneven humps still count, though a sloppier wave hits softer. It flies the way you drew it and damages the first circle, wall or chalkling it hits. Even waves hit harder. **How spiky** it is (0–100%) decides what it's good against: fully curved does ×1.4 to circles and walls but ×0.6 to chalklings; fully spiky (sharp, narrow points) does ×1.6 to chalklings but ×0.6 to lines; in between is a mix. The label shows how spiky yours came out. |
| A creature in a holding circle | **Making** | A chalkling: your drawing comes alive, walks its path, and chews through lines. See below. |

**Chalk limit:** each duelist has a set amount of chalk for the whole duel (30,000 to start; see the meters at the top). Every stroke uses chalk equal to its length, even if it fails, so spamming runs you dry. **Waves are half price**: a Line of Vigor uses half its length. If both sides run out and nothing is still moving, the duel is a draw.

**The countdown:** every duel starts with a 5-second countdown to draw your main circle. Anyone without one when it ends is **out**: in a duel the other player wins (if neither drew one, it's a draw); in a free-for-all everyone who missed is out and the rest play on. A dashed ring at your home shows the smallest circle that counts. (A Beginner bot is slow enough that it occasionally misses too.)

**Bind points:** green ticks on your main circle. A line or small circle that touches your circle at a bind point is **bound** (+50% strength). Touching anywhere else weakens that part of your circle (−25%).

## Making a chalkling (the book way)

Press **Chalkling** (or M) first: while it's on, your strokes are chalkling parts instead of ordinary lines.

1. **Chain:** draw a straight line from one of your green bind points.
2. **Holding circle:** draw a circle touching the chain's far end.
3. **Creature:** draw it inside the holding circle, in as many strokes as you like.
4. **Path:** draw a line from the circle to where it should go. It follows the path, going around any wall in its way (or chewing through if there's no way round), and attacks the enemy circle if the path leads there. **End the path on an enemy chalkling** and yours hunts that one until it's dead.
5. **Release:** turn Chalkling off, press **Eraser** and click the chain. 3 seconds later the chain is gone and the chalkling breaks out.

Any chalkling attacks an enemy chalkling that comes close, then carries on with what it was doing (a hunter stays on its target). Chalklings find their own way: they walk **around** walls and circles (using A* route-finding), and only chew through a wall if there's no way round. The enemy circle they're attacking is never avoided: they go straight for it.

When a path ends (or if you didn't draw one), what the chalkling does depends on the **Command** you picked while making it (the buttons that appear at the top in Chalkling mode):
- **Remote** (the default): follows the **Attack / Guard** buttons, and changes when you press them.
- **Always attack**: always marches on the enemy circle, whatever the buttons say.
- **Always guard**: always guards your circle, whatever the buttons say.

Its label says which: "Attacking (remote)", "Always guarding", and so on. After a hunt, it walks back to your side and waits (shown with a "?"). To give it a new command: in Chalkling mode, draw a line from a bind point to it (a new chain) and a new path from it, then erase the chain.

**How strong it is depends on what you draw.** You can use as many strokes as you like.
- **Detail matters most.** It raises both health and bite. Detail counts the separate features you drew, not how much chalk they used: each part, closed shapes (heads, eyes, shells), sharp corners (claws, teeth) and small parts. Drawing the same creature bigger doesn't make it stronger; drawing more features does. Parts drawn in the **detail screen** count ×1.5.
- **Shape:** **rounder** creatures (big closed shapes: shells, round bodies) have **more health**; **pointier** ones (claws, teeth, loose line ends, sharp corners) **bite harder**. Labels say "Round", "Pointy" or "All-rounder".
- **Chalk:** the more chalk a creature uses, the **slower** it walks; a light, quick sketch is **fast**. (A stick figure walks about 100, a big detailed drawing about 45.)

The hint shows the detail, shape and speed so far while you draw, and the label above the chalkling shows its detail, health, bite and speed.

## Split screen (vs. the dummy or a bot)

On the start screen, **Your screen** chooses **Draw on the right** (the default), **Draw on the left**, or **One board** (the old single view).

With a split screen, the screen is split into quarters: the map fills the half away from your drawing side, and your drawing side has two screens, one above the other:
- **The map** (half the screen) shows the whole battle, turned so your home is at the bottom. Drag to move around, scroll or pinch to zoom, double-click to reset. It's for watching; you don't draw on it.
- **Your area** (the top quarter of the screen, on your side) is where you draw. It's a fixed view around your home (it doesn't move or zoom while you play), with room above your circle and below it for chains and holding circles. The chalk meters are along its top.
- **The detail screen** (the bottom quarter of the screen, on your side): press **Detail** (or F), then tap a holding circle in Your area. That circle appears zoomed in, and what you draw there lands inside the real holding circle at its real (small) size. Parts drawn there count ×1.5 detail.

Same-screen play keeps one board, since two players can't each have their own split. This layout is the start of the online version, where the map could hold 2 to 10 players.

## Erasing

Press **Eraser** (or E), then click one of your own lines. The eraser turns itself off, and **3 seconds later** the line is gone (it fades while you wait, and you can keep drawing). You can erase your walls, chains, paths and small circles, but never your main circle or anything of your opponent's.

## Modes

- **Practice dummy:** it draws a neat or sloppy circle and stands still. You can also pick a defense to trace.
- **Bot:** ten levels (below), and **1 to 9 bots**. Bots draw like people do: point by point, with a shaky hand, through the same recognizer.
- **Teams:** you and bot teammates against a team of bots (below).

## Free-for-all (2 to 9 bots)

Pick **How many bots** on the start screen. With 2 or more it's a free-for-all of up to 10 players: everyone against everyone, bots attack each other too, and the **last circle standing wins**. All the bots play at the level you picked.

- The board gets bigger with more players, and everyone's home sits in a ring. Your **territory** is the part of the board closer to your home than to anyone else's (faint dotted borders); you can only draw in yours.
- On the split screen the map is turned so your home is at the bottom. With many players the map is small, so zoom in (scroll or pinch) to look around.
- When a circle is breached, that player is **out** and everything they drew is wiped off the board. If it's you, the end screen says what place you came (for example "4th of 10"); press **Keep watching** to watch the rest of the battle, and the end screen comes back with the winner.
- Chalklings on Attack go for the **nearest** enemy circle still standing. Bots attack the nearest enemy too, and smash walls in the way with curved waves.
- With 1 bot it's the classic duel, left half against right half.

## Teams (2 to 5 per team)

Pick **Teams** and how many **Players per team**. It's you and your bot teammates against a team of bots, all at the level you picked.

- One team lines up down the left half of the board and the other down the right half, facing each other. Each player still has their **own area** to draw in (dotted borders), their own chalk, circle and walls.
- **Teammates can't hurt each other:** a teammate's wave passes through your circles and your chalklings, and chalklings ignore their own team. But **walls stop everyone's waves**, your teammates' included, just like your own: so watch where you put them.
- Guards protect their own player's circle.
- If your circle breaks, you're **out**, but your team plays on: press **Keep watching**. The **last team standing wins.**
- Under every main circle is a tag: **You**, **Teammate** (cool colours) or **Enemy** (warm colours). On the split screen, the map is turned so your team is at the bottom and theirs at the top.

### Two people on one screen

Under **Who's playing**, pick **Two of us, same team** (you two and bot teammates against bots) or **Two of us, against each other** (each of you with bot teammates). Like Same screen, this needs a touchscreen so you can both draw at once.

- **Seating:** **Side by side** means you both sit at the bottom edge. **Facing each other** means one of you sits at the top edge: that player's buttons and name tag are turned round to face them. The board is turned to suit:
  - same team, side by side: your team along the bottom, the enemy at the top
  - same team, facing: your team down the left half, one of you in the top row and one in the bottom row
  - against each other, side by side: you two are the bottom row, Player 1 on the left
  - against each other, facing: Player 1's team at the bottom, Player 2's at the top
- Each stroke belongs to whoever's area it starts in. Each player has their own buttons (Chalkling, Eraser, Attack / Guard); the keyboard controls Player 1.
- Name tags say **Player 1**, **Player 2** or **Bot**, in team colours, with each player's chalk underneath.
- If you're both out but your bot teammates are still in, **Keep watching** to see who wins.

## Bot levels

| # | Level | What's new at this level |
| --- | --- | --- |
| 1 | Beginner | Very shaky and slow, aims anywhere, rarely blocks |
| 2 | Student | A bit steadier and quicker |
| 3 | Apprentice | Steadier and quicker again |
| 4 | Senior student | Draws a shield circle; aims at damaged spots; spikier chalklings |
| 5 | Duelist | Steadier, quicker, blocks more |
| 6 | Champion | Steadier, quicker, makes chalklings more often |
| 7 | Tutor | Full defense (shield and a wall); aims at your weakest spot; beetle chalklings |
| 8 | Professor | Steadier, quicker, blocks almost everything |
| 9 | Master | Stops in the middle of a chalkling to block a wave, then carries on |
| 10 | Grand master | Also attacks while waiting for a chain to erase; the fastest hand |

Bots throw curved waves at your circle and spiky ones at your chalklings, and keep to the 8-wall limit. From Tutor (level 7) up, bots draw their chalklings in the detail screen, so their chalklings have more detail.

Each level beats the one below it in at least 7 of 12 test duels. All the settings are in `src/config.js` under `bot.levels`.
- **Same screen:** two people on one touchscreen, each drawing on their own half at the same time.
- **Online:** one player presses **Create room** and shares the 4-letter code; the other enters it and presses **Join**. Run locally, this works between tabs on the computer running `npm start`; hosted (see Hosting on Render), between any two devices.

## Controls

| Key | Button | Does |
| --- | --- | --- |
| M | Chalkling | Turn Chalkling mode on or off (chain, circle, creature, path). |
| F | Detail | Split screen only: tap a holding circle to draw its creature big in the detail screen. |
| E | Eraser | Turn the eraser on, then click a line: it's gone 3 seconds later. |
| A / G | Attack / Guard | Orders for Remote chalklings that have finished their paths. |
| P | Pause | Freeze the duel (not online). |
| D | Debug | Shows the numbers behind every score, section health, and chalkling stats. |
| S | Save stroke | Copies your last stroke as JSON, to turn into a test. |

## Tuning

Every number lives in `src/config.js`: thresholds, health, damage, speeds and bot levels. Change one, reload the page, and play.

## Tests

```
npm test
```

There are 121 tests covering:
- the recognizer
- the duel engine (the start countdown and smallest main circle, damage, how spiky waves are, walls stopping waves, the wall limit, breach)
- bind points
- chalklings (detail, shape and chalk grading, finding their way around lines, fighting nearby enemies)
- the chalk limit
- the bots (including all ten levels ranking in order)
- free-for-alls of 3 to 10 players (territories, knock-outs, last one standing)
- team games (no friendly damage, walls stopping teammates' waves, last team standing, bot teams playing out)
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
- **Playing online between different houses:** the repository is ready for Render (see Hosting on Render); it still has to be deployed.

## License

The code is under the MIT License: see `LICENSE`. It covers this project's own code only, not *The Rithmatist* (see the disclaimer at the top).
