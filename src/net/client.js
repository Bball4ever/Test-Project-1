// The browser's end of an online duel: a WebSocket connection to the game server.

export class OnlineClient {
  // handlers: { message(msg), closed() }
  constructor(handlers) {
    this.handlers = handlers;
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${scheme}://${location.host}/ws`);
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('no server'));
      ws.onmessage = (e) => this.handlers.message(JSON.parse(e.data));
      ws.onclose = () => {
        if (this.ws === ws) this.handlers.closed();
      };
      this.ws = ws;
    });
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}
