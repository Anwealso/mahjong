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
  get token(): string {
    const w = this.messages.find((m) => m.t === "welcome");
    if (w?.t !== "welcome") throw new Error("No welcome");
    return w.sessionToken;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Hands are listed from the dealer round the table (the dealer's first, with 14 tiles).
// The dealer discards 5b: the next seat can chow it, the one after can pung it, the last can't claim.
const CHOW_VS_PUNG = ["5b 147c 258d 369b ESWN", "46b 147c 258d EEE RG", "55b 258c 369d NGGGWh", "369c 147d 1b 9b SSS WhWh"];
// Nobody can claim the dealer's 5b.
const QUIET = ["5b 147c 258d 369b ESWN", "147c 258d 369b SWNR", "258c 369d 147b SSGWh", "369c 147d 258b NNRG"];
// The dealer can win straight away by self-draw.
const DEALER_WINS = ["123c 456c 789c 123d 55d", ...QUIET.slice(1)];
// The next seat wins on the dealer's 5b, so the deal passes on.
const NEXT_WINS = ["5b 147c 258d 369b ESWN", "46b 123c 456c 789c 11d", ...QUIET.slice(2)];

/** Seat `s` gets the hand `(s - dealer)` places round from the dealer. */
const wallFor = (hands: string[]) => (dealer: Seat) =>
  stackWall({ hands: [0, 1, 2, 3].map((s) => hands[(s - dealer + 4) % 4]!) as [string, string, string, string], dealer });

const OPTIONS: RoomOptions = { claimWindowMs: 40, botDelayMs: 1, readyMs: 60, idleMs: 60, voteRemoveMs: 40, firstDealer: () => 0 };

function setup(hands?: string[], options: Partial<RoomOptions> = {}) {
  const room = new Room("TEST", { ...OPTIONS, wallForNextHand: hands ? wallFor(hands) : undefined, ...options });
  const conns = [0, 1, 2, 3].map(() => new FakeConnection());
  const ids = conns.map((c, i) => room.join(`P${i}`, undefined, c));
  ids.forEach((id, i) => expect(room.takeSeat(id, i as Seat)).toBeNull());
  return { room, conns, ids };
}

function start(hands?: string[], options: Partial<RoomOptions> = {}) {
  const ctx = setup(hands, options);
  expect(ctx.room.startGame(ctx.ids[0]!)).toBeNull();
  return ctx;
}

type Ctx = ReturnType<typeof start>;

const fiveBamboo = (conn: FakeConnection): TileId =>
  conn.state.view.hand.find((t) => kindOf(t) === parseKinds("5b")[0])!;

function act(ctx: Ctx, seat: Seat, action: Action) {
  expect(ctx.room.act(ctx.ids[seat]!, action, ctx.conns[seat]!.state.stateVersion)).toBeNull();
}

/** With NEXT_WINS: the dealer discards 5b and the next seat claims it and wins. */
function nextSeatWins(ctx: Ctx, dealer: Seat) {
  const next = ((dealer + 1) % 4) as Seat;
  act(ctx, dealer, { type: "discard", tile: fiveBamboo(ctx.conns[dealer]!) });
  act(ctx, next, { type: "claim" });
  act(ctx, next, { type: "win" });
}

const readyAll = (ctx: Ctx) => ctx.ids.forEach((id) => ctx.room.setReady(id));

describe("lobby", () => {
  it("the creator hosts; only the host starts the game, and only with four seats filled", () => {
    const room = new Room("TEST", OPTIONS);
    const a = new FakeConnection();
    const b = new FakeConnection();
    const idA = room.join("Ann", undefined, a);
    const idB = room.join("Ben", undefined, b);
    expect(b.lobby.hostId).toBe(idA);
    room.takeSeat(idA, 0);
    expect(room.takeSeat(idB, 0)?.code).toBe("seatTaken");
    expect(room.startGame(idA)?.code).toBe("notEnoughPlayers");
    expect(room.addBots(idB)?.code).toBe("notHost");
    expect(room.addBots(idA)).toBeNull();
    expect(room.startGame(idB)?.code).toBe("notHost");
    expect(room.startGame(idA)).toBeNull();
    expect(b.lobby.phase).toBe("hand");
    room.dispose();
  });

  it("seats are fixed during a game", () => {
    const ctx = start(QUIET);
    expect(ctx.room.takeSeat(ctx.ids[0]!, 1)?.code).toBe("seatTaken");
    expect(ctx.room.startGame(ctx.ids[0]!)?.code).toBe("handInProgress");
  });

  it("hosting passes to the longest-present connected person", () => {
    const { room, conns, ids } = setup();
    room.disconnect(ids[0]!, conns[0]!);
    expect(conns[2]!.lobby.hostId).toBe(ids[1]);
    room.join("P0", conns[0]!.token, new FakeConnection());
    expect(conns[2]!.lobby.hostId).toBe(ids[1]);
  });

  it("the host can remove someone from their seat", () => {
    const { room, conns, ids } = setup();
    expect(room.removeMember(ids[1]!, ids[2]!)?.code).toBe("notHost");
    expect(room.removeMember(ids[0]!, ids[2]!)).toBeNull();
    expect(conns[0]!.lobby.seats[2]).toBeNull();
  });
});

describe("bots", () => {
  it("fill the empty seats, give them up to people, and play whole hands", async () => {
    const room = new Room("TEST", OPTIONS);
    const conn = new FakeConnection();
    const id = room.join("Ann", undefined, conn);
    room.takeSeat(id, 2);
    expect(room.addBots(id)).toBeNull();
    expect(conn.lobby.members.filter((m) => m.bot).map((m) => m.seat)).toEqual([0, 1, 3]);

    // Taking a bot's seat replaces the bot.
    expect(room.takeSeat(id, 0)).toBeNull();
    expect(conn.lobby.members.filter((m) => m.bot).map((m) => m.seat)).toEqual([1, 3]);
    room.addBots(id);

    // Ann discards whatever she's offered and never claims; the bots play everything else.
    conn.send = (m) => {
      conn.messages.push(m);
      if (m.t !== "state" || m.legalActions.length === 0) return;
      const action = m.legalActions.find((a) => a.type === "pass" || a.type === "discard") ?? m.legalActions[0]!;
      setTimeout(() => room.act(id, action, m.stateVersion));
    };
    expect(room.startGame(id)).toBeNull();
    while (conn.lobby.phase === "hand") await sleep(10);
    expect(conn.state.view.phase.kind).toBe("handOver");
    room.dispose();
  }, 10_000);
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

describe("dropouts", () => {
  it("a disconnected player's turn waits for the host; a bot can take over, and they get the seat back", async () => {
    const ctx = start(QUIET);
    act(ctx, 0, { type: "discard", tile: fiveBamboo(ctx.conns[0]!) });
    ctx.room.disconnect(ctx.ids[1]!, ctx.conns[1]!);
    expect(ctx.conns[0]!.lobby.seatInfo[1]!.issue).toBe("offline");
    await sleep(80);
    expect(ctx.conns[0]!.state.view.phase).toEqual({ kind: "awaitDiscard", seat: 1 }); // nobody plays for them

    expect(ctx.room.replaceWithBot(ctx.ids[2]!, 1)?.code).toBe("notHost");
    expect(ctx.room.replaceWithBot(ctx.ids[0]!, 1)).toBeNull();
    await sleep(30);
    expect(ctx.conns[0]!.state.view.players[1]!.discards).toHaveLength(1);
    expect(ctx.conns[0]!.lobby.seatInfo[1]).toMatchObject({ issue: null, reservedFor: ctx.ids[1] });

    const back = new FakeConnection();
    expect(ctx.room.join("P1", ctx.conns[1]!.token, back)).toBe(ctx.ids[1]);
    expect(back.lobby.seats[1]).toBe(ctx.ids[1]);
    expect(back.state.view.seat).toBe(1);
  });

  it("someone idle for too long can be replaced, then take their seat back", async () => {
    const ctx = start(QUIET);
    await sleep(90);
    expect(ctx.conns[1]!.lobby.seatInfo[0]!.issue).toBe("idle");
    // The host is the idle one here, so hosting stays with them; they hand their own seat to a bot.
    expect(ctx.room.replaceWithBot(ctx.ids[0]!, 0)).toBeNull();
    expect(ctx.conns[1]!.lobby.seatInfo[0]!.reservedFor).toBe(ctx.ids[0]);
    expect(ctx.room.takeSeat(ctx.ids[2]!, 0)?.code).toBe("notAllowed"); // they're seated already
    expect(ctx.room.takeSeat(ctx.ids[0]!, 0)).toBeNull();
    expect(ctx.conns[1]!.lobby.seats[0]).toBe(ctx.ids[0]);
  });

  it("leaving mid-hand empties the seat; the host can cancel the hand and the same dealer redeals", () => {
    const ctx = start(NEXT_WINS);
    expect(ctx.room.leaveSeat(ctx.ids[2]!)).toBeNull();
    expect(ctx.conns[0]!.lobby.seatInfo[2]!.issue).toBe("empty");
    expect(ctx.room.cancelHand(ctx.ids[0]!)).toBeNull();
    expect(ctx.conns[0]!.lobby.phase).toBe("paused");
    expect(ctx.room.resumeGame(ctx.ids[0]!)?.code).toBe("notEnoughPlayers");
    ctx.room.takeSeat(ctx.ids[2]!, 2);
    expect(ctx.room.resumeGame(ctx.ids[0]!)).toBeNull();
    expect(ctx.conns[0]!.lobby.game).toMatchObject({ dealer: 0, handNumber: 1, history: [] });
    expect(ctx.conns[0]!.state.view.dealer).toBe(0);
  });

  it("a watcher can ask to play; when approved they replace a bot mid-hand", () => {
    const ctx = start(QUIET);
    ctx.room.leaveSeat(ctx.ids[3]!);
    ctx.room.replaceWithBot(ctx.ids[0]!, 3);
    const zoe = new FakeConnection();
    const zoeId = ctx.room.join("Zoe", undefined, zoe);
    expect(ctx.room.requestSeat(zoeId)).toBeNull();
    expect(ctx.conns[0]!.lobby.requests).toEqual([{ id: zoeId, name: "Zoe" }]);
    expect(ctx.room.answerRequest(ctx.ids[1]!, zoeId, true)?.code).toBe("notHost");
    expect(ctx.room.answerRequest(ctx.ids[0]!, zoeId, true)).toBeNull();
    expect(zoe.lobby.seats[3]).toBe(zoeId);
    expect(zoe.state.view.seat).toBe(3);
    expect(zoe.lobby.requests).toEqual([]);
  });
});

describe("between hands", () => {
  it("scores the hand, rotates the deal, and deals again once everyone is ready", () => {
    const ctx = start(NEXT_WINS);
    nextSeatWins(ctx, 0);
    const lobby = ctx.conns[0]!.lobby;
    expect(lobby.phase).toBe("handOver");
    expect(lobby.game).toMatchObject({ dealer: 1, scores: [-1, 1, 0, 0], handNumber: 2 });
    expect(ctx.conns[0]!.state.view.phase.kind).toBe("handOver");
    readyAll(ctx);
    expect(ctx.conns[0]!.lobby.phase).toBe("hand");
    expect(ctx.conns[0]!.state.view.dealer).toBe(1);
  });

  it("the deal passes on even after a dealer win, unless the host turned on dealerKeepsDeal", () => {
    const ctx = start(DEALER_WINS);
    act(ctx, 0, { type: "selfDrawWin" });
    expect(ctx.conns[0]!.lobby.game).toMatchObject({ dealer: 1, scores: [3, -1, -1, -1] });

    const keep = setup(DEALER_WINS);
    expect(keep.room.updateSettings(keep.ids[1]!, { dealerKeepsDeal: true })?.code).toBe("notHost");
    expect(keep.room.updateSettings(keep.ids[0]!, { dealerKeepsDeal: true })).toBeNull();
    expect(keep.conns[1]!.lobby.settings).toEqual({ dealerKeepsDeal: true });
    keep.room.startGame(keep.ids[0]!);
    expect(keep.room.updateSettings(keep.ids[0]!, { dealerKeepsDeal: false })?.code).toBe("handInProgress");
    act(keep, 0, { type: "selfDrawWin" });
    expect(keep.conns[0]!.lobby.game).toMatchObject({ dealer: 0, settings: { dealerKeepsDeal: true } });
  });

  it("deals anyway when the countdown runs out, but not while someone is offline", async () => {
    const ctx = start(NEXT_WINS);
    nextSeatWins(ctx, 0);
    expect(ctx.conns[0]!.lobby.readyMsLeft).toBeGreaterThan(0);
    ctx.room.disconnect(ctx.ids[3]!, ctx.conns[3]!);
    expect(ctx.conns[0]!.lobby.readyMsLeft).toBeNull();
    await sleep(100);
    expect(ctx.conns[0]!.lobby.phase).toBe("handOver");
    ctx.room.replaceWithBot(ctx.ids[0]!, 3);
    expect(ctx.conns[0]!.lobby.readyMsLeft).toBeGreaterThan(0);
    await sleep(100);
    expect(ctx.conns[0]!.lobby.phase).toBe("hand");
  });

  it("anyone can pause in the lobby; a newcomer can take a bot's seat and its score", () => {
    const ctx = start(NEXT_WINS);
    nextSeatWins(ctx, 0);
    ctx.room.disconnect(ctx.ids[1]!, ctx.conns[1]!);
    ctx.room.replaceWithBot(ctx.ids[0]!, 1);
    expect(ctx.room.returnToLobby(ctx.ids[2]!)).toBeNull();
    expect(ctx.conns[0]!.lobby.phase).toBe("paused");

    const zoe = new FakeConnection();
    const zoeId = ctx.room.join("Zoe", undefined, zoe);
    expect(ctx.room.takeSeat(zoeId, 1)).toBeNull();
    expect(zoe.lobby.game!.scores[1]).toBe(1);
    expect(ctx.room.resumeGame(ctx.ids[2]!)?.code).toBe("notHost");
    expect(ctx.room.resumeGame(ctx.ids[0]!)).toBeNull();
    expect(zoe.state.view.seat).toBe(1);
  });
});

describe("wind breaks", () => {
  /** Play a whole wind: the deal passes round the table once. */
  function playWind(ctx: Ctx) {
    for (const dealer of [0, 1, 2, 3] as Seat[]) {
      nextSeatWins(ctx, dealer);
      if (dealer < 3) readyAll(ctx);
    }
  }

  it("ends each wind with a vote; continuing needs everyone", () => {
    const ctx = start(NEXT_WINS);
    playWind(ctx);
    const lobby = ctx.conns[0]!.lobby;
    expect(lobby.phase).toBe("windBreak");
    expect(lobby.game).toMatchObject({ prevailingWind: 1, windNumber: 2, dealer: 0, scores: [0, 0, 0, 0] });
    for (const id of ctx.ids.slice(0, 3)) ctx.room.voteContinue(id);
    expect(ctx.conns[0]!.lobby.phase).toBe("windBreak");
    ctx.room.voteContinue(ctx.ids[3]!);
    expect(ctx.conns[0]!.lobby.phase).toBe("hand");
    expect(ctx.conns[0]!.state.view.prevailingWind).toBe(1);
  });

  it("leavers are replaced by bots; non-voters can be removed after a while; nobody left ends the game", async () => {
    const ctx = start(NEXT_WINS);
    playWind(ctx);
    ctx.room.leaveSeat(ctx.ids[1]!);
    expect(ctx.conns[0]!.lobby.members.find((m) => m.seat === 1)!.bot).toBe(true);
    ctx.room.voteContinue(ctx.ids[0]!);
    expect(ctx.room.removeMember(ctx.ids[0]!, ctx.ids[2]!)?.code).toBe("notAllowed"); // too soon
    await sleep(50);
    expect(ctx.room.removeMember(ctx.ids[0]!, ctx.ids[2]!)).toBeNull();
    expect(ctx.conns[0]!.lobby.phase).toBe("windBreak"); // still waiting for seat 3
    ctx.room.leaveSeat(ctx.ids[3]!);
    expect(ctx.conns[0]!.lobby.phase).toBe("hand"); // everyone still seated has voted
  });

  it("the game is over when every person leaves, and the host can start afresh", () => {
    const ctx = start(NEXT_WINS);
    playWind(ctx);
    for (const id of ctx.ids) ctx.room.leaveSeat(id);
    expect(ctx.conns[0]!.lobby.phase).toBe("gameOver");
    expect(ctx.room.newGame(ctx.ids[0]!)).toBeNull();
    expect(ctx.conns[0]!.lobby).toMatchObject({ phase: "lobby", game: null });
  });
});
