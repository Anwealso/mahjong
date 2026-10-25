import type { Action } from "@mahjong/engine";
import type { ClientMessage, ServerMessage } from "@mahjong/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  server = await startServer({ port: 0, room: { claimWindowMs: 30, autopilotDelayMs: 5 } });
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

  it("four random players play several full hands over real sockets", async () => {
    const clients = await fullTable();
    const HANDS = 5;
    const results: unknown[] = [];
    const unexpectedErrors: ServerMessage[] = [];
    let done: () => void;
    const finished = new Promise<void>((r) => (done = r));

    for (const [seat, c] of clients.entries()) {
      c.onMessage = (m) => {
        // Stale actions are expected (someone else claimed first); anything else is a bug.
        if (m.t === "error" && m.code !== "staleState") unexpectedErrors.push(m);
        if (m.t !== "state") return;
        if (m.view.phase.kind === "handOver") {
          if (seat === 0) {
            results.push(m.view.phase.result);
            if (results.length === HANDS) done();
            else c.send({ t: "startHand" });
          }
          return;
        }
        if (m.legalActions.length === 0) return;
        // Random but sometimes slow, so claim timers expire too. Take wins when offered.
        const win = m.legalActions.find((a) => a.type === "win" || a.type === "selfDrawWin");
        const action: Action = win ?? m.legalActions[Math.floor(Math.random() * m.legalActions.length)]!;
        setTimeout(() => c.send({ t: "action", action, stateVersion: m.stateVersion }), Math.random() < 0.1 ? 40 : 0);
      };
    }
    clients[0]!.send({ t: "startHand" });
    await finished;

    expect(results).toHaveLength(HANDS);
    expect(unexpectedErrors).toEqual([]);
    for (const c of clients) c.close();
  }, 20_000);
});
