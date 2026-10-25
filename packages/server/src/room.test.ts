import { kindOf, parseKinds, stackWall, type Action, type Seat, type TileId } from "@mahjong/engine";
import type { ServerMessage } from "@mahjong/protocol";
import { describe, expect, it } from "vitest";
import type { Connection } from "./controllers";
import { Room, type RoomOptions } from "./room";

type StateMessage = Extract<ServerMessage, { t: "state" }>;
type LobbyMessage = Extract<ServerMessage, { t: "lobby" }>;

class FakeConnection implements Connection {
  readonly messages: ServerMessage[] = [];
  send(message: ServerMessage) {
    this.messages.push(message);
  }
  get state(): StateMessage {
    const s = this.messages.findLast((m) => m.t === "state");
    if (!s) throw new Error("No state received");
    return s as StateMessage;
  }
  get lobby(): LobbyMessage {
    return this.messages.findLast((m) => m.t === "lobby") as LobbyMessage;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Seat 0 discards 5b: seat 1 (next) can chow it, seat 2 can pung it, seat 3 can't claim.
const CHOW_VS_PUNG = ["5b 147c 258d 369b ESWN", "46b 147c 258d EEE RG", "55b 258c 369d NGGGWh", "369c 147d 1b 9b SSS WhWh"];
// Nobody can claim seat 0's 5b.
const QUIET = ["5b 147c 258d 369b ESWN", "147c 258d 369b SWNR", "258c 369d 147b SSGWh", "369c 147d 258b NNRG"];

function setup(hands?: string[], options: Partial<RoomOptions> = {}) {
  const room = new Room("TEST", {
    claimWindowMs: 40,
    autopilotDelayMs: 5,
    wallForNextHand: () => (hands ? stackWall({ hands: hands as [string, string, string, string] }) : undefined),
    ...options,
  });
  const conns = [0, 1, 2, 3].map(() => new FakeConnection());
  const ids = conns.map((c, i) => room.join(`P${i}`, undefined, c));
  ids.forEach((id, i) => expect(room.takeSeat(id, i as Seat)).toBeNull());
  return { room, conns, ids };
}

function start(hands?: string[], options: Partial<RoomOptions> = {}) {
  const ctx = setup(hands, options);
  expect(ctx.room.startHand(ctx.ids[0]!)).toBeNull();
  return ctx;
}

const fiveBamboo = (conn: FakeConnection): TileId =>
  conn.state.view.hand.find((t) => kindOf(t) === parseKinds("5b")[0])!;

function act(ctx: ReturnType<typeof start>, seat: Seat, action: Action) {
  expect(ctx.room.act(ctx.ids[seat]!, action, ctx.conns[seat]!.state.stateVersion)).toBeNull();
}

describe("lobby", () => {
  it("needs all four seats to start, and locks seats during a hand", () => {
    const room = new Room("TEST");
    const a = new FakeConnection();
    const b = new FakeConnection();
    const idA = room.join("Ann", undefined, a);
    const idB = room.join("Ben", undefined, b);
    room.takeSeat(idA, 0);
    expect(room.takeSeat(idB, 0)?.code).toBe("seatTaken");
    expect(room.startHand(idA)?.code).toBe("notEnoughPlayers");

    const ctx = start(QUIET);
    expect(ctx.room.takeSeat(ctx.ids[0]!, 1)?.code).toBe("handInProgress");
    expect(ctx.room.startHand(ctx.ids[0]!)?.code).toBe("handInProgress");
    expect(ctx.conns[3]!.lobby.handInProgress).toBe(true);
  });

  it("broadcasts members and seats to everyone", () => {
    const { conns } = setup();
    expect(conns[0]!.lobby.members.map((m) => [m.name, m.seat])).toEqual([
      ["P0", 0],
      ["P1", 1],
      ["P2", 2],
      ["P3", 3],
    ]);
  });
});

describe("hand flow", () => {
  it("sends each seat only its own view and legal actions", () => {
    const { conns } = start(QUIET);
    for (const [seat, conn] of conns.entries()) {
      expect(conn.state.view.seat).toBe(seat);
      expect(conn.state.view.hand).toHaveLength(seat === 0 ? 14 : 13);
      expect(conn.state.legalActions.length > 0).toBe(seat === 0);
    }
    expect(JSON.stringify(conns[1]!.state)).not.toContain("wall\"");
  });

  it("rejects actions made against an old state", () => {
    const ctx = start(QUIET);
    const { stateVersion } = ctx.conns[0]!.state;
    const discard: Action = { type: "discard", tile: fiveBamboo(ctx.conns[0]!) };
    expect(ctx.room.act(ctx.ids[0]!, discard, stateVersion - 1)?.code).toBe("staleState");
    expect(ctx.room.act(ctx.ids[0]!, discard, stateVersion)).toBeNull();
    expect(ctx.room.act(ctx.ids[1]!, { type: "pass" }, stateVersion)?.code).toBe("staleState");
  });

  it("rejects illegal actions", () => {
    const ctx = start(QUIET);
    expect(ctx.room.act(ctx.ids[1]!, { type: "pass" }, ctx.conns[1]!.state.stateVersion)?.code).toBe("illegalAction");
  });

  it("one player passing doesn't make another player's claim stale", () => {
    const ctx = start(CHOW_VS_PUNG);
    act(ctx, 0, { type: "discard", tile: fiveBamboo(ctx.conns[0]!) });
    const seat2 = ctx.conns[2]!.state;
    act(ctx, 1, { type: "pass" });
    expect(ctx.room.act(ctx.ids[2]!, { type: "claim" }, seat2.stateVersion)).toBeNull();
    const pung = ctx.conns[2]!.state.legalActions.find((a) => a.type === "pung")!;
    act(ctx, 2, pung);
    expect(ctx.conns[2]!.state.view.phase).toEqual({ kind: "awaitDiscard", seat: 2 });
  });

  it("closes the claim window when the timer runs out", async () => {
    const ctx = start(CHOW_VS_PUNG);
    act(ctx, 0, { type: "discard", tile: fiveBamboo(ctx.conns[0]!) });
    const window = ctx.conns[1]!.state;
    expect(window.view.phase.kind).toBe("claimWindow");
    expect(window.claimMsLeft).toBeGreaterThan(0);
    expect(window.claimMsLeft).toBeLessThanOrEqual(40);

    await sleep(80);
    const after = ctx.conns[1]!.state;
    expect(after.view.phase).toEqual({ kind: "awaitDiscard", seat: 1 });
    expect(after.claimMsLeft).toBeNull();
    expect(ctx.room.act(ctx.ids[2]!, window.legalActions[0]!, window.stateVersion)?.code).toBe("staleState");
  });
});

describe("disconnects", () => {
  it("the autopilot plays for a disconnected player", async () => {
    const ctx = start(QUIET);
    ctx.room.disconnect(ctx.ids[1]!, ctx.conns[1]!);
    expect(ctx.conns[0]!.lobby.members[1]!.connected).toBe(false);
    act(ctx, 0, { type: "discard", tile: fiveBamboo(ctx.conns[0]!) });
    await sleep(30);
    expect(ctx.conns[0]!.state.view.players[1]!.discards).toHaveLength(1);
    expect(ctx.conns[0]!.state.view.phase).toMatchObject({ seat: 2 });
  });

  it("reconnecting with the session token reclaims the seat and gets a snapshot", async () => {
    const ctx = start(QUIET);
    const welcome = ctx.conns[1]!.messages.find((m) => m.t === "welcome")!;
    if (welcome.t !== "welcome") throw new Error();
    ctx.room.disconnect(ctx.ids[1]!, ctx.conns[1]!);

    const fresh = new FakeConnection();
    const id = ctx.room.join("P1 again", welcome.sessionToken, fresh);
    expect(id).toBe(ctx.ids[1]);
    expect(fresh.state.view.seat).toBe(1);
    expect(fresh.lobby.members[1]).toMatchObject({ name: "P1 again", connected: true, seat: 1 });

    // Back under human control: the autopilot no longer acts for seat 1.
    ctx.conns[1] = fresh;
    act(ctx, 0, { type: "discard", tile: fiveBamboo(ctx.conns[0]!) });
    await sleep(30);
    expect(fresh.state.view.phase).toEqual({ kind: "awaitDiscard", seat: 1 });
    expect(fresh.state.legalActions.length).toBeGreaterThan(0);
  });

  it("a stale connection closing doesn't disconnect the member's newer connection", () => {
    const ctx = start(QUIET);
    const welcome = ctx.conns[1]!.messages.find((m) => m.t === "welcome");
    if (welcome?.t !== "welcome") throw new Error();
    const fresh = new FakeConnection();
    ctx.room.join("P1", welcome.sessionToken, fresh);
    ctx.room.disconnect(ctx.ids[1]!, ctx.conns[1]!);
    expect(fresh.lobby.members[1]!.connected).toBe(true);
  });

  it("the autopilot finishes a claim if the player disconnects mid-claim", async () => {
    const ctx = start(CHOW_VS_PUNG);
    act(ctx, 0, { type: "discard", tile: fiveBamboo(ctx.conns[0]!) });
    act(ctx, 2, { type: "claim" });
    expect(ctx.conns[0]!.state.view.phase).toMatchObject({ kind: "claimed", seat: 2 });
    ctx.room.disconnect(ctx.ids[2]!, ctx.conns[2]!);
    await sleep(30);
    expect(ctx.conns[0]!.state.view.players[2]!.melds).toHaveLength(1);
  });
});

describe("end of hand", () => {
  it("reports the result, clears handInProgress, and allows a new hand", () => {
    const ctx = start(["123c 456c 789c 123d 55d", ...QUIET.slice(1)]);
    act(ctx, 0, { type: "selfDrawWin" });
    expect(ctx.conns[2]!.state.view.phase).toMatchObject({ kind: "handOver", result: { winner: 0 } });
    expect(ctx.conns[2]!.lobby.handInProgress).toBe(false);
    expect(ctx.room.startHand(ctx.ids[2]!)).toBeNull();
    expect(ctx.conns[2]!.state.view.phase.kind).toBe("awaitDiscard");
  });
});

describe("bots", () => {
  it("fill the empty seats, give them up to people, and play whole hands", async () => {
    const room = new Room("TEST", { claimWindowMs: 20, autopilotDelayMs: 5, botDelayMs: 1 });
    const conn = new FakeConnection();
    const id = room.join("Ann", undefined, conn);
    room.takeSeat(id, 2);
    expect(room.addBots(id)).toBeNull();
    expect(conn.lobby.seats.every((s) => s !== null)).toBe(true);
    expect(conn.lobby.members.filter((m) => m.bot).map((m) => m.seat)).toEqual([0, 1, 3]);

    // Taking a bot's seat replaces the bot.
    expect(room.takeSeat(id, 0)).toBeNull();
    expect(conn.lobby.members.filter((m) => m.bot).map((m) => m.seat)).toEqual([1, 3]);
    expect(conn.lobby.seats[2]).toBeNull();
    room.addBots(id);

    // Ann discards whatever she's offered and never claims; the bots play everything else.
    conn.send = (m) => {
      conn.messages.push(m);
      if (m.t !== "state" || m.legalActions.length === 0) return;
      const action = m.legalActions.find((a) => a.type === "pass" || a.type === "discard") ?? m.legalActions[0]!;
      setTimeout(() => room.act(id, action, m.stateVersion));
    };
    expect(room.startHand(id)).toBeNull();
    while (room.handInProgress) await sleep(10);
    expect(conn.state.view.phase.kind).toBe("handOver");
    room.dispose();
  }, 10_000);

  it("can't be added during a hand", () => {
    const ctx = start(QUIET);
    expect(ctx.room.addBots(ctx.ids[0]!)?.code).toBe("handInProgress");
  });
});
