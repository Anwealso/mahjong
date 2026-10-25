import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { parseClientMessage, type ServerMessage } from "@mahjong/protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { Connection } from "./controllers";
import { RoomRegistry } from "./registry";
import { DEFAULT_ROOM_OPTIONS, type Room, type RoomError, type RoomOptions } from "./room";
import { serveStatic } from "./static";

export interface ServerOptions {
  /** 0 picks a free port (tests). */
  port: number;
  room?: RoomOptions;
  /** How often to ping each socket; one that hasn't answered the previous ping is dropped. */
  pingMs?: number;
  maxRooms?: number;
  /** New rooms one connection may create per minute. */
  roomsPerMinute?: number;
  /** Serve the built client from this directory (production). */
  staticDir?: string;
}

export interface RunningServer {
  port: number;
  registry: RoomRegistry;
  /** Warn everyone the server is restarting, then shut down. */
  close(): Promise<void>;
}

/** HTTP + WebSocket server. Each socket joins at most one room at a time. */
export async function startServer({
  port,
  room = DEFAULT_ROOM_OPTIONS,
  pingMs = 25_000,
  maxRooms = 100,
  roomsPerMinute = 5,
  staticDir,
}: ServerOptions): Promise<RunningServer> {
  const registry = new RoomRegistry(room, undefined, maxRooms);

  const http = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, rooms: registry.size }));
      return;
    }
    if (staticDir && serveStatic(staticDir, req, res)) return;
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 16 * 1024 });
  // Sockets that answered the last ping. A dropped Wi-Fi often leaves a socket open on our side for minutes;
  // this notices within two pings, so the player shows as offline and the host is prompted.
  const alive = new WeakSet<WebSocket>();
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!alive.has(socket)) {
        socket.terminate();
        continue;
      }
      alive.delete(socket);
      socket.ping();
    }
  }, pingMs);
  heartbeat.unref();

  wss.on("connection", (socket) => {
    alive.add(socket);
    socket.on("pong", () => alive.add(socket));
    const created: number[] = [];
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
        let target: Room | null | undefined;
        if (message.t === "createRoom") {
          const now = Date.now();
          while (created.length && now - created[0]! > 60_000) created.shift();
          if (created.length >= roomsPerMinute) return fail({ code: "rateLimited", message: "Too many new rooms; wait a minute" });
          target = registry.create();
          if (!target) return fail({ code: "serverFull", message: "The server is full right now" });
          created.push(now);
        } else {
          target = registry.get(message.room);
          if (!target) return fail({ code: "noSuchRoom", message: `No room ${message.room}` });
          if (!target.canJoin(message.sessionToken)) return fail({ code: "roomFull", message: "That room is full" });
        }
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
        case "requestSeat":
          return fail(room.requestSeat(memberId));
        case "ready":
          return fail(room.setReady(memberId));
        case "returnToLobby":
          return fail(room.returnToLobby(memberId));
        case "voteContinue":
          return fail(room.voteContinue(memberId));
        case "addBots":
          return fail(room.addBots(memberId));
        case "removeMember":
          return fail(room.removeMember(memberId, message.memberId));
        case "replaceWithBot":
          return fail(room.replaceWithBot(memberId, message.seat));
        case "cancelHand":
          return fail(room.cancelHand(memberId));
        case "answerRequest":
          return fail(room.answerRequest(memberId, message.memberId, message.approve));
        case "updateSettings":
          return fail(room.updateSettings(memberId, message.settings));
        case "startGame":
          return fail(room.startGame(memberId));
        case "resumeGame":
          return fail(room.resumeGame(memberId));
        case "newGame":
          return fail(room.newGame(memberId));
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
      clearInterval(heartbeat);
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ t: "serverRestarting" } satisfies ServerMessage));
      }
      registry.dispose();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
