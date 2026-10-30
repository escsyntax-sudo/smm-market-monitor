export class Hub {
  constructor() {
    this.clients = new Map();
  }

  add(socket) {
    this.clients.set(socket, null);
  }

  remove(socket) {
    this.clients.delete(socket);
  }

  subscribe(socket, symbols) {
    if (!this.clients.has(socket)) {
      return;
    }
    this.clients.set(socket, symbols && symbols.length > 0 ? new Set(symbols) : null);
  }

  get size() {
    return this.clients.size;
  }

  publish(event) {
    const payload = JSON.stringify(event);
    for (const [socket, symbols] of this.clients) {
      if (socket.readyState !== 1) {
        this.clients.delete(socket);
        continue;
      }
      if (symbols && event.symbol && !symbols.has(event.symbol)) {
        continue;
      }
      socket.send(payload);
    }
  }
}
