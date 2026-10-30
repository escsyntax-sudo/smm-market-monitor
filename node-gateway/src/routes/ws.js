export async function websocketRoutes(app, { hub, store }) {
  app.get("/ws", { websocket: true }, (socket, request) => {
    hub.add(socket);
    socket.send(
      JSON.stringify({
        type: "ws.ready",
        symbols: store.list().map((item) => item.symbol),
        hint: 'send {"op":"subscribe","symbols":["BTC-USD"]} to filter',
      }),
    );

    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ type: "error", error: "invalid_json" }));
        return;
      }
      if (message.op === "subscribe") {
        const symbols = Array.isArray(message.symbols)
          ? message.symbols
              .map((item) => String(item).toUpperCase())
              .filter((item) => item.length > 0 && item.length <= 32)
          : [];
        hub.subscribe(socket, symbols);
        socket.send(JSON.stringify({ type: "subscribed", symbols }));
        return;
      }
      if (message.op === "unsubscribe") {
        hub.subscribe(socket, []);
        socket.send(JSON.stringify({ type: "subscribed", symbols: [] }));
        return;
      }
      if (message.op === "ping") {
        socket.send(JSON.stringify({ type: "pong", at: Date.now() }));
        return;
      }
      socket.send(JSON.stringify({ type: "error", error: "unknown_operation" }));
    });

    const heartbeat = setInterval(() => {
      if (socket.readyState === socket.OPEN) {
        socket.ping();
      }
    }, 30_000);

    const cleanup = () => {
      clearInterval(heartbeat);
      hub.remove(socket);
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
    request.log.debug({ clients: hub.size }, "websocket connected");
  });
}
