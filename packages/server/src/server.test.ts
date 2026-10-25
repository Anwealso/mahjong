import type { Action } from "@mahjong/engine";
import type { ClientMessage, ServerMessage } from "@mahjong/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket as WsSocket } from "ws";
import { startServer, type RunningServer } from "./app";

/** A test client over a real WebSocket. */
class Client {
  readonly messages: ServerMessage[] = [];
  private waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  onMessage: (m: ServerMessage) => void = () => {};

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(String(e.data)) as ServerMessage;
      this.messages.push(m);
      this.onMessage(m);
      this.waiters = this.waiters.filter((w) => (w.match(m) ? (w.resolve(m), false) : true));
    });
  }

  static async connect(port: number): Promise<Client> {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    return new Client(ws);
  }

  send(message: ClientMessage | string) {
    this.ws.send(typeof message === "string" ? message : JSON.stringify(message));
  }

  next<T extends ServerMessage["t"]>(t: T, match: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true) {
    return new Promise<Extract<ServerMessage, { t: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${t}`)), 3000);
      this.waiters.push({
        match: (m) => m.t === t && match(m as Extract<ServerMessage, { t: T }>),
        resolve: (m) => (clearTimeout(timer), resolve(m as Extract<ServerMessage, { t: T }>)),
      });
    });
  }

  close() {
    this.ws.close();
  }
}

let server: RunningServer;
beforeEach(async () => {
  server = await startServer({ port: 0, room: { claimWindowMs: 30, botDelayMs: 5, readyMs: 50, idleMs: 60_000, voteRemoveMs: 30_000 } });
});
afterEach(async () => {
  await server.close();
});

async function fullTable(): Promise<Client[]> {
  const clients = await Promise.all([0, 1, 2, 3].map(() => Client.connect(server.port)));
  clients[0]!.send({ t: "createRoom", name: "P0" });
  const { room } = await clients[0]!.next("welcome");
  for (const [i, c] of clients.slice(1).entries()) {
    c.send({ t: "join", room: room.toLowerCase(), name: `P${i + 1}` });
    await c.next("welcome");
  }
  for (const [i, c] of clients.entries()) {
    c.send({ t: "takeSeat", seat: i as 0 | 1 | 2 | 3 });
    await c.next("lobby", (m) => m.seats[i] !== null);
  }
  return clients;
}

describe("limits and shutdown", () => {
  it("limits new rooms per connection, rooms per server, and people per room", async () => {
    const limited = await startServer({
      port: 0,
      maxRooms: 3,
      roomsPerMinute: 2,
      room: { claimWindowMs: 30, botDelayMs: 5, readyMs: 50, idleMs: 60_000, voteRemoveMs: 30_000, maxMembers: 2 },
    });
    try {
      const a = await Client.connect(limited.port);
      a.send({ t: "createRoom", name: "A" });
      const { room } = await a.next("welcome");
      a.send({ t: "createRoom", name: "A" });
      await a.next("welcome");
      a.send({ t: "createRoom", name: "A" });
      expect((await a.next("error")).code).toBe("rateLimited");

      const b = await Client.connect(limited.port);
      b.send({ t: "createRoom", name: "B" });
      await b.next("welcome");
      b.send({ t: "createRoom", name: "B" });
      expect((await b.next("error")).code).toBe("serverFull");

      // A is still a member of the first room (offline since creating the second), so B fits and C does not.
      b.send({ t: "join", room, name: "B" });
      await b.next("welcome");
      const c = await Client.connect(limited.port);
      c.send({ t: "join", room, name: "C" });
      expect((await c.next("error")).code).toBe("roomFull");
      for (const x of [a, b, c]) x.close();
    } finally {
      await limited.close();
    }
  });

  it("warns everyone before shutting down", async () => {
    const c = await Client.connect(server.port);
    c.send({ t: "createRoom", name: "A" });
    await c.next("welcome");
    const warned = c.next("serverRestarting");
    await server.close();
    await warned;
    server = await startServer({ port: 0 }); // for afterEach
  });

  it("drops sockets that stop answering pings", async () => {
    const pinged = await startServer({ port: 0, pingMs: 30 });
    try {
      const silent = new WsSocket(`ws://localhost:${pinged.port}/ws`, { autoPong: false });
      const closed = new Promise((resolve) => silent.on("close", resolve));
      const healthy = await Client.connect(pinged.port);
      await closed;
      healthy.send({ t: "createRoom", name: "Still here" });
      expect((await healthy.next("welcome")).room).toHaveLength(4);
      healthy.close();
    } finally {
      await pinged.close();
    }
  });
});

describe("server", () => {
  it("serves a health check", async () => {
    const res = await fetch(`http://localhost:${server.port}/health`);
    expect(await res.json()).toEqual({ ok: true, rooms: 0 });
  });

  it("rejects bad messages and unknown rooms", async () => {
    const c = await Client.connect(server.port);
    c.send("not json");
    expect((await c.next("error")).code).toBe("badMessage");
    c.send({ t: "takeSeat", seat: 0 });
    expect((await c.next("error")).code).toBe("notInRoom");
    c.send({ t: "join", room: "ZZZZ", name: "Ann" });
    expect((await c.next("error")).code).toBe("noSuchRoom");
    c.send(JSON.stringify({ t: "action", action: { type: "pung", tiles: [1] }, stateVersion: 0 }));
    expect((await c.next("error")).code).toBe("badMessage");
    c.close();
  });

  it("four random players play several full hands over real sockets, readying up between them", async () => {
    const clients = await fullTable();
    const HANDS = 6;
    const results: unknown[] = [];
    const unexpectedErrors: ServerMessage[] = [];
    let done: () => void;
    const finished = new Promise<void>((r) => (done = r));

    for (const c of clients) {
      const answered = new Set<string>();
      c.onMessage = (m) => {
        // Stale actions are expected (someone else claimed first); anything else is a bug.
        if (m.t === "error" && m.code !== "staleState") unexpectedErrors.push(m);
        if (m.t === "lobby") {
          if (c === clients[0] && m.game && m.game.history.length > results.length) {
            results.push(m.game.history.at(-1)!.result);
            if (results.length === HANDS) done();
          }
          // Answer each ready-up and vote once (lobby updates repeat while others answer).
          const key = `${m.phase}:${m.game?.handNumber}`;
          if (answered.has(key)) return;
          answered.add(key);
          if (m.phase === "handOver") c.send({ t: "ready" });
          if (m.phase === "windBreak") c.send({ t: "voteContinue" });
          return;
        }
        if (m.t !== "state" || m.legalActions.length === 0) return;
        // Random but sometimes slow, so claim timers expire too. Take wins when offered.
        const win = m.legalActions.find((a) => a.type === "win" || a.type === "selfDrawWin");
        const action: Action = win ?? m.legalActions[Math.floor(Math.random() * m.legalActions.length)]!;
        setTimeout(() => c.send({ t: "action", action, stateVersion: m.stateVersion }), Math.random() < 0.1 ? 40 : 0);
      };
    }
    clients[0]!.send({ t: "startGame" });
    await finished;

    expect(results).toHaveLength(HANDS);
    expect(unexpectedErrors).toEqual([]);
    for (const c of clients) c.close();
  }, 20_000);
});
