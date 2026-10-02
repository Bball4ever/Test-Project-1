import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

import { startServer } from '../server/index.js';
import { readSnapshot } from '../src/net/snapshot.js';
import * as S from './fixtures/strokes.js';

// A test player: connects, remembers every message, and rebuilds the duel
// state from snapshots the same way the browser does.
async function player(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((done, fail) => {
    ws.on('open', done);
    ws.on('error', fail);
  });
  const p = { ws, messages: [], cache: new Map(), state: null, events: [] };
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    p.messages.push(msg);
    if (msg.t === 'snap') {
      p.state = readSnapshot(msg.snap, p.cache);
      p.events.push(...msg.events);
    }
  });
  p.send = (msg) => ws.send(JSON.stringify(msg));
  p.waitFor = async (check, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = check();
      if (found) return found;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out');
  };
  p.got = (t) => p.messages.find((m) => m.t === t);
  return p;
}

const stroke = (points) => ({ t: 'action', action: { type: 'stroke', points } });

test('two players can play a full duel online, and both see the same thing', async () => {
  const server = await startServer({ port: 0 });
  try {
    const a = await player(server.port);
    const b = await player(server.port);

    a.send({ t: 'create', bind: 4 });
    const { code } = await a.waitFor(() => a.got('joined'));
    assert.match(code, /^[A-Z]{4}$/);
    b.send({ t: 'join', code: code.toLowerCase(), bind: 6 });
    assert.equal((await b.waitFor(() => b.got('joined'))).side, 'right');
    await a.waitFor(() => a.got('start'));
    await b.waitFor(() => b.got('start'));

    a.send(stroke(S.circle({ cx: 350, cy: 450, r: 110, noise: 1 })));
    b.send(stroke(S.circle({ cx: 1250, cy: 450, r: 110, noise: 1 })));
    await a.waitFor(() => a.state?.wards.length === 2);
    assert.equal(a.state.wards.find((w) => w.owner === 'right').bindAngles.length, 6);

    // A drawing on the wrong side is refused by the server, not trusted.
    b.send(stroke(S.wave({ x: 300, y: 200, length: 150 })));
    await b.waitFor(() => b.messages.some((m) => m.t === 'result' && m.result.reason === 'stay on your side'));

    // Left attacks until the right circle is breached.
    for (let shot = 1; !a.state.winner && shot < 25; shot++) {
      a.send(stroke(S.wave({ x: 700, y: 450, length: 90, amplitude: 10, cycles: 3, seed: shot })));
      await new Promise((r) => setTimeout(r, 250));
    }
    await a.waitFor(() => a.state.winner);
    await b.waitFor(() => b.state?.winner);
    assert.equal(a.state.winner, 'left');

    // No drift: once the same snapshot has arrived, both players' states match.
    await new Promise((r) => setTimeout(r, 200));
    const lastTick = Math.min(a.state.tick, b.state.tick);
    await a.waitFor(() => a.state.tick >= lastTick);
    const snapAt = (p) => p.messages.filter((m) => m.t === 'snap').find((m) => m.snap.tick === lastTick);
    assert.deepEqual(readSnapshot(snapAt(a).snap, a.cache), readSnapshot(snapAt(b).snap, b.cache));
    assert.ok(b.events.some((e) => e.type === 'breach' && e.owner === 'right'));

    // Rematch needs both players.
    a.send({ t: 'rematch' });
    await b.waitFor(() => b.got('rematchWanted'));
    b.send({ t: 'rematch' });
    await a.waitFor(() => a.messages.filter((m) => m.t === 'start').length === 2);
    await a.waitFor(() => a.state.wards.length === 0 && !a.state.winner);

    // Leaving tells the other player.
    b.ws.close();
    await a.waitFor(() => a.got('opponentLeft'));
    a.ws.close();
  } finally {
    await server.close();
  }
});

test('joining a missing room gives a clear error', async () => {
  const server = await startServer({ port: 0 });
  try {
    const p = await player(server.port);
    p.send({ t: 'join', code: 'ZZZZ' });
    const err = await p.waitFor(() => p.got('error'));
    assert.match(err.message, /No room called ZZZZ/);
    p.ws.close();
  } finally {
    await server.close();
  }
});

test('the server only serves game files', async () => {
  const server = await startServer({ port: 0 });
  try {
    const get = async (path) => (await fetch(`http://127.0.0.1:${server.port}${path}`)).status;
    assert.equal(await get('/'), 200);
    assert.equal(await get('/src/main.js'), 200);
    assert.equal(await get('/server/rooms.js'), 404);
    assert.equal(await get('/package.json'), 404);
    assert.equal(await get('/../../etc/passwd'), 404);
  } finally {
    await server.close();
  }
});
