// Online rooms. Each room holds one duel between two players.
//
// The server is the referee: it runs the one true copy of the duel, using the
// same engine and recognizer as the browser. Players only send what they drew;
// the server decides what it was and what happens, then tells both players.
// Because both screens show the server's state, they can't drift apart.

import { CONFIG } from '../src/config.js';
import { createDuel, step } from '../src/engine/duel.js';
import { applyAction, sanitizeAction } from '../src/engine/actions.js';
import { makeSnapshot } from '../src/net/snapshot.js';

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O (they look like 1 and 0)
const SNAPSHOT_EVERY = 2; // engine steps per snapshot (60 / 2 = 30 per second)
const ACTIONS_PER_SECOND = 25; // room for drawing plus the eraser's 10 updates a second; stops floods
const LIVE_PER_SECOND = 20; // "what I'm drawing right now": the browser sends 10 a second
const LOBBY_PER_SECOND = 2; // creating and joining rooms
const MAX_ROOMS = 500; // on a public server, a cap so nobody can fill its memory with empty rooms
const MAX_LIVE_POINTS = 2000;

export class Rooms {
  constructor({ now = () => performance.now(), random = Math.random } = {}) {
    this.rooms = new Map();
    this.now = now;
    this.random = random;
  }

  // conn: { send(message) } plus whatever the caller likes.
  handle(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'create' || msg.t === 'join') {
      if (!this.allow(conn, 'lobby', LOBBY_PER_SECOND)) return conn.send({ t: 'error', message: 'Too fast: wait a moment and try again.' });
      return msg.t === 'create' ? this.create(conn, msg) : this.join(conn, msg);
    }
    const room = conn.room;
    if (!room) return;
    if (msg.t === 'action') return this.action(room, conn, msg.action);
    if (msg.t === 'live') return this.allow(conn, 'live', LIVE_PER_SECOND) && this.live(room, conn, msg);
    if (msg.t === 'rematch') return this.rematch(room, conn);
  }

  create(conn, msg) {
    if (this.rooms.size >= MAX_ROOMS) return conn.send({ t: 'error', message: 'The server is full right now. Try again in a few minutes.' });
    this.leave(conn);
    let code;
    do {
      code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(this.random() * CODE_LETTERS.length)]).join('');
    } while (this.rooms.has(code));
    const room = { code, conns: { left: null, right: null }, bind: {}, state: null, sent: null, acc: 0, last: 0, pending: [], rematch: new Set() };
    this.rooms.set(code, room);
    this.seat(room, 'left', conn, msg.bind);
    conn.send({ t: 'joined', code, side: 'left' });
  }

  join(conn, msg) {
    const code = String(msg.code ?? '').toUpperCase().trim();
    const room = this.rooms.get(code);
    if (!room) return conn.send({ t: 'error', message: `No room called ${code || '(blank)'}.` });
    if (room.conns.right) return conn.send({ t: 'error', message: `Room ${code} is full.` });
    this.leave(conn);
    this.seat(room, 'right', conn, msg.bind);
    conn.send({ t: 'joined', code, side: 'right' });
    this.start(room);
  }

  seat(room, side, conn, bind) {
    room.conns[side] = conn;
    room.bind[side] = CONFIG.engine.bindPointChoices.includes(Number(bind)) ? Number(bind) : CONFIG.engine.defaultBindPoints;
    conn.room = room;
    conn.side = side;
  }

  start(room) {
    room.state = createDuel({ bindPoints: room.bind });
    room.sent = new Set();
    room.acc = 0;
    room.last = this.now();
    room.pending = [];
    room.rematch.clear();
    this.broadcast(room, { t: 'start', code: room.code, bindPoints: room.bind });
    this.broadcast(room, { t: 'snap', snap: makeSnapshot(room.state, room.sent), events: [] });
  }

  action(room, conn, raw) {
    if (!room.state || !this.allow(conn, 'action', ACTIONS_PER_SECOND)) return;
    const action = sanitizeAction(raw);
    if (!action) return;
    const { result } = applyAction(room.state, conn.side, action);
    if (result) {
      const { points, shape, ...small } = result;
      conn.send({ t: 'result', result: small });
    }
  }

  // Show the opponent what you're drawing right now (not part of the duel).
  live(room, conn, msg) {
    const other = room.conns[conn.side === 'left' ? 'right' : 'left'];
    if (!other) return;
    let points = null;
    if (Array.isArray(msg.points)) {
      points = msg.points.slice(0, MAX_LIVE_POINTS).map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 }));
    }
    other.send({ t: 'live', side: conn.side, points, making: !!msg.making });
  }

  rematch(room, conn) {
    if (!room.state?.winner) return;
    room.rematch.add(conn.side);
    if (room.rematch.size === 2) this.start(room);
    else this.broadcast(room, { t: 'rematchWanted', side: conn.side });
  }

  leave(conn) {
    const room = conn.room;
    if (!room) return;
    conn.room = null;
    room.conns[conn.side] = null;
    const other = room.conns.left ?? room.conns.right;
    if (other) other.send({ t: 'opponentLeft' });
    if (other) other.room = null;
    this.rooms.delete(room.code);
  }

  // A simple "token bucket": each connection gets `perSecond` messages of each
  // kind a second (with a burst of up to that many); extra ones are dropped.
  allow(conn, kind, perSecond) {
    const now = this.now();
    conn.buckets ??= {};
    const b = (conn.buckets[kind] ??= { tokens: perSecond, at: now });
    b.tokens = Math.min(perSecond, b.tokens + ((now - b.at) / 1000) * perSecond);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  // Run every room's duel forward to the current time.
  tick() {
    const now = this.now();
    for (const room of this.rooms.values()) {
      if (!room.state) continue;
      room.acc += Math.min(250, now - room.last);
      room.last = now;
      while (room.acc >= CONFIG.engine.stepMs) {
        room.acc -= CONFIG.engine.stepMs;
        step(room.state);
        room.pending.push(...room.state.events.splice(0));
        if (room.state.tick % SNAPSHOT_EVERY === 0) this.sendSnapshot(room);
      }
    }
  }

  sendSnapshot(room) {
    const events = room.pending;
    room.pending = [];
    this.broadcast(room, { t: 'snap', snap: makeSnapshot(room.state, room.sent), events });
  }

  broadcast(room, message) {
    for (const conn of Object.values(room.conns)) conn?.send(message);
  }
}
