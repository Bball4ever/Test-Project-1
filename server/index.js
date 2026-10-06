// The game server: serves the game's files, and runs online rooms over
// WebSockets (a connection that stays open so the server can push updates to
// the browser at any moment, instead of the browser having to ask).
//
//   npm start             → http://localhost:8000
//   PORT=9000 npm start   → a different port
//
// On your own computer it only listens to this computer (127.0.0.1), so two
// browser tabs here can play each other. When hosted (on Render, or with
// HOST=0.0.0.0) it listens on every network address, so anyone can connect.
// Render tells it which port to use through PORT; see render.yaml.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Rooms } from './rooms.js';

const root = resolve(import.meta.dirname, '..');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
// Only the game's own files are served.
const PUBLIC = ['/index.html', '/style.css', '/src/'];

async function serveFile(req, res) {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  // For the host's health check: "yes, the server is up".
  if (path === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  const wanted = path === '/' ? '/index.html' : path;
  const file = normalize(join(root, wanted));
  if (!file.startsWith(root) || !PUBLIC.some((p) => wanted === p || (p.endsWith('/') && wanted.startsWith(p)))) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

export async function startServer({ port = 8000, host = '127.0.0.1' } = {}) {
  const server = http.createServer(serveFile);
  const rooms = new Rooms();
  let wss = null;
  let timer = null;
  let heartbeat = null;

  try {
    const { WebSocketServer } = await import('ws');
    wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024 });
    wss.on('connection', (ws) => {
      ws.alive = true;
      ws.on('pong', () => (ws.alive = true));
      // A bad message (too big, or broken) closes that one connection. Without
      // this, the error would crash the whole server, for every player.
      ws.on('error', () => ws.terminate());
      const conn = {
        send: (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg)),
      };
      ws.on('message', (data) => {
        let msg;
        try {
          msg = JSON.parse(data);
        } catch {
          return;
        }
        rooms.handle(conn, msg);
      });
      ws.on('close', () => rooms.leave(conn));
    });
    timer = setInterval(() => rooms.tick(), 8);
    // Heartbeat: ping every connection every 30 seconds. One that hasn't
    // answered since the last ping (a closed laptop, a dropped phone signal) is
    // cut off, which frees its room. It also keeps a quiet connection (someone
    // waiting in a room for a friend) from being closed by the host as idle.
    heartbeat = setInterval(() => {
      for (const ws of wss.clients) {
        if (!ws.alive) {
          ws.terminate();
          continue;
        }
        ws.alive = false;
        ws.ping();
      }
    }, 30000);
  } catch {
    console.warn('Online play is off: run "npm install" first to get the ws package.');
  }

  await new Promise((done) => server.listen(port, host, done));
  const actualPort = server.address().port;
  return {
    port: actualPort,
    rooms,
    async close() {
      clearInterval(timer);
      clearInterval(heartbeat);
      for (const client of wss?.clients ?? []) client.terminate();
      wss?.close();
      await new Promise((done) => server.close(done));
    },
  };
}

// Started with `node server/index.js` (rather than imported by a test)?
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Hosted on Render (it sets RENDER), or HOST given: listen on every address.
  const host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
  const { port } = await startServer({ port: Number(process.env.PORT) || 8000, host });
  console.log(host === '127.0.0.1' ? `Rithmatist Duel: http://localhost:${port}` : `Rithmatist Duel: listening on ${host}:${port}`);
}
