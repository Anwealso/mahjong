import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { parseClientMessage, type ServerMessage } from "@mahjong/protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { Connection } from "./controllers";
import { RoomRegistry } from "./registry";
import { DEFAULT_ROOM_OPTIONS, type Room, type RoomError, type RoomOptions } from "./room";

export interface ServerOptions {
  /** 0 picks a free port (tests). */
  port: number;
  room?: RoomOptions;
}

export interface RunningServer {
  port: number;
  registry: RoomRegistry;
  close(): Promise<void>;
}

/** HTTP + WebSocket server. Each socket joins at most one room at a time. */
export async function startServer({ port, room = DEFAULT_ROOM_OPTIONS }: ServerOptions): Promise<RunningServer> {
  const registry = new RoomRegistry(room);

  const http = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, rooms: registry.size }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 16 * 1024 });
  wss.on("connection", (socket) => {
    const connection: Connection = {
      send(message: ServerMessage) {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      },
    };
    let session: { room: Room; memberId: string } | null = null;
    const fail = (e: RoomError | null) => e && connection.send({ t: "error", ...e });

    socket.on("message", (data) => {
      const message = parseClientMessage(data.toString());
      if (!message) return fail({ code: "badMessage", message: "Unrecognised message" });

      if (message.t === "createRoom" || message.t === "join") {
        const target = message.t === "createRoom" ? registry.create() : registry.get(message.room);
        if (!target) return fail({ code: "noSuchRoom", message: `No room ${message.t === "join" ? message.room : ""}` });
        if (session) session.room.disconnect(session.memberId, connection);
        const token = message.t === "join" ? message.sessionToken : undefined;
        session = { room: target, memberId: target.join(message.name, token, connection) };
        return;
      }

      if (!session) return fail({ code: "notInRoom", message: "Join a room first" });
      const { room, memberId } = session;
      switch (message.t) {
        case "takeSeat":
          return fail(room.takeSeat(memberId, message.seat));
        case "leaveSeat":
          return fail(room.leaveSeat(memberId));
        case "addBots":
          return fail(room.addBots(memberId));
        case "startHand":
          return fail(room.startHand(memberId));
        case "action":
          return fail(room.act(memberId, message.action, message.stateVersion));
      }
    });

    socket.on("close", () => session?.room.disconnect(session.memberId, connection));
  });

  const sweeper = setInterval(() => registry.sweep(), 60_000);
  sweeper.unref();

  await new Promise<void>((resolve) => http.listen(port, resolve));
  return {
    port: (http.address() as AddressInfo).port,
    registry,
    async close() {
      clearInterval(sweeper);
      registry.dispose();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
