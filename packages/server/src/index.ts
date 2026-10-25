import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { NUM_TILES } from "@mahjong/engine";

// Milestone 3 replaces this with rooms, seat controllers, and the zod-validated protocol (see docs/architecture.md).

const PORT = Number(process.env.PORT ?? 8787);

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, tiles: NUM_TILES }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http, path: "/ws" });
wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ t: "hello" }));
});

http.listen(PORT, () => console.log(`server listening on http://localhost:${PORT}`));
