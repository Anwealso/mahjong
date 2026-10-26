import { describe, expect, it } from "vitest";
import { applyAction, closeClaimWindow, legalActions, pendingClaimants, startHand } from "./hand";
import { DEFAULT_RULES, type RuleConfig } from "./rules";
import { stackWall, type StackedWall } from "./testing";
import { kindOf, parseKinds, type TileId } from "./tiles";
import type { Action, HandState, Seat } from "./types";
import { projectEvents, projectView } from "./view";

// ---- helpers ---------------------------------------------------------------------------------------

function setup(wall: StackedWall, rules: Partial<RuleConfig> = {}): HandState {
  return startHand({ seed: 1, wall: stackWall(wall), rules: { ...DEFAULT_RULES, ...rules } }).state;
}

function act(state: HandState, seat: Seat, action: Action): HandState {
  const result = applyAction(state, seat, action);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

/** The first tile of this kind in a seat's hand. */
function tile(state: HandState, seat: Seat, code: string): TileId {
  const kind = parseKinds(code)[0];
  const t = state.players[seat]!.hand.find((x) => kindOf(x) === kind);
  if (t === undefined) throw new Error(`Seat ${seat} has no ${code}`);
  return t;
}

/** Discard, then let the claim window (if any) time out. */
function discardNoClaims(state: HandState, seat: Seat, code: string): HandState {
  const next = act(state, seat, { type: "discard", tile: tile(state, seat, code) });
  if (next.phase.kind !== "claimWindow") return next;
  const closed = closeClaimWindow(next);
  if (!closed.ok) throw new Error(closed.error);
  return closed.state;
}

const types = (actions: Action[]) => [...new Set(actions.map((a) => a.type))].sort();

// Hands that can't claim anything in these scenarios.
const QUIET: [string, string, string] = ["147c 258d 369b SWNR", "258c 369d 147b SSGWh", "369c 147d 258b NNRG"];

// ---- tests -----------------------------------------------------------------------------------------

describe("deal", () => {
  it("deals 13 to everyone and 14 to the dealer, who opens", () => {
    const { state } = startHand({ seed: 42, dealer: 2 });
    expect(state.players.map((p) => p.hand.length)).toEqual([13, 13, 14, 13]);
    expect(state.wall).toHaveLength(136 - 53);
    expect(state.phase).toEqual({ kind: "awaitDiscard", seat: 2, drew: true });
  });
});

describe("self-drawn win", () => {
  it("lets the dealer win on the deal, and everyone else pays", () => {
    const state = setup({ hands: ["123c 456c 789c 123d 55d", ...QUIET] });
    expect(types(legalActions(state, 0))).toContain("selfDrawWin");
    const after = act(state, 0, { type: "selfDrawWin" });
    expect(after.phase).toMatchObject({
      kind: "handOver",
      result: { kind: "win", winner: 0, selfDraw: true, from: null, payments: [3, -1, -1, -1] },
    });
  });

  it("isn't forced: the dealer can discard instead", () => {
    const state = setup({ hands: ["123c 456c 789c 123d 55d", ...QUIET] });
    const after = discardNoClaims(state, 0, "5d");
    expect(after.phase).toMatchObject({ kind: "awaitDiscard", seat: 1 });
  });
});

/** The listed option of this type for a seat (with example tiles). */
function option<T extends Action["type"]>(state: HandState, seat: Seat, type: T): Extract<Action, { type: T }> {
  const a = legalActions(state, seat).find((x) => x.type === type);
  if (!a) throw new Error(`Seat ${seat} has no ${type} option`);
  return a as Extract<Action, { type: T }>;
}

/** Claim the tile on offer, then use it with the listed option of this type. */
function claimAndUse(state: HandState, seat: Seat, type: "win" | "pung" | "kong" | "chow"): HandState {
  const claimed = act(state, seat, { type: "claim" });
  return act(claimed, seat, option(claimed, seat, type));
}

describe("claims", () => {
  // Seat 0 discards 5b. Seat 1 (next) can chow it, seat 2 can pung it, seat 3 can't claim.
  const chowVsPung: StackedWall = {
    hands: ["5b 147c 258d 369b ESWN", "46b 147c 258d EEE RG", "55b 258c 369d NGGGWh", "369c 147d 1b 9b SSS WhWh"],
  };

  function discardFiveBamboo(wall: StackedWall = chowVsPung, rules: Partial<RuleConfig> = {}) {
    const state = setup(wall, rules);
    return act(state, 0, { type: "discard", tile: tile(state, 0, "5b") });
  }

  it("skips the claim window when nobody can claim", () => {
    const state = setup({ hands: ["5b 147c 258d 369b ESWN", ...QUIET] });
    const after = act(state, 0, { type: "discard", tile: tile(state, 0, "5b") });
    expect(after.phase).toMatchObject({ kind: "awaitDiscard", seat: 1, drew: true });
  });

  it("offers a claim to anyone who could use the tile (chow only for the next player)", () => {
    const state = discardFiveBamboo();
    expect(state.phase.kind).toBe("claimWindow");
    expect(types(legalActions(state, 1))).toEqual(["claim", "pass"]); // could chow
    expect(types(legalActions(state, 2))).toEqual(["claim", "pass"]); // could pung
    expect(legalActions(state, 3)).toEqual([]); // nothing to claim: auto-passed
    expect(pendingClaimants(state)).toEqual([1, 2]);

    // Same hands with seats 1 and 3 swapped: seat 3 holds 4b 6b but isn't next, so can't chow or claim.
    const h = chowVsPung.hands;
    const swapped = discardFiveBamboo({ hands: [h[0], h[3], h[2], h[1]] });
    expect(legalActions(swapped, 3)).toEqual([]);
  });

  it("claiming takes the tile and closes the window; the claimer must then use it", () => {
    let state = discardFiveBamboo();
    state = act(state, 2, { type: "claim" });
    expect(state.phase).toMatchObject({ kind: "claimed", seat: 2, from: 0 });
    expect(state.players[0]!.discards).toEqual([]); // the claimed tile left the pond
    expect(legalActions(state, 1)).toEqual([]); // too late for anyone else
    expect(types(legalActions(state, 2))).toEqual(["pung"]); // no pass, no discard: must form a set
    expect(applyAction(state, 2, { type: "pass" }).ok).toBe(false);

    state = act(state, 2, option(state, 2, "pung"));
    expect(state.phase).toEqual({ kind: "awaitDiscard", seat: 2, drew: false }); // play skips to the claimer
    expect(state.players[2]!.melds[0]).toMatchObject({ type: "pung", claimed: { from: 0 } });
  });

  it("first come, first served: whoever claims first gets it, whatever they want it for", () => {
    let state = discardFiveBamboo();
    state = claimAndUse(state, 1, "chow");
    expect(state.phase).toEqual({ kind: "awaitDiscard", seat: 1, drew: false });
    expect(state.players[1]!.melds[0]).toMatchObject({ type: "chow", claimed: { from: 0 } });
    expect(applyAction(state, 2, { type: "claim" }).ok).toBe(false);
  });

  it("when a tile fits several sets, the claimer chooses which to form", () => {
    // Seat 1 holds 3b 4b 5b 6b 7b, so a discarded 5b fits three different chows.
    const wall: StackedWall = {
      hands: ["5b 147c 258d 369b ESWN", "34567b 147c 258d RG", "369c 147d 1b 9b SSS WhWh", "258c 369d NGGGWh EE"],
    };
    let state = discardFiveBamboo(wall);
    state = act(state, 1, { type: "claim" });
    const chows = legalActions(state, 1).filter((a) => a.type === "chow");
    expect(chows).toHaveLength(3); // 345, 456, 567
    state = act(state, 1, chows[2]!);
    expect(state.players[1]!.melds[0]!.tiles.map(kindOf)).toEqual(parseKinds("567b"));
  });

  it("waits for everyone who can claim; passing doesn't end the window for others", () => {
    let state = discardFiveBamboo();
    state = act(state, 1, { type: "pass" });
    expect(pendingClaimants(state)).toEqual([2]);
    state = claimAndUse(state, 2, "pung");
    expect(state.phase).toEqual({ kind: "awaitDiscard", seat: 2, drew: false });
  });

  it("moves on to the next player's draw when everyone passes", () => {
    let state = discardFiveBamboo();
    state = act(state, 1, { type: "pass" });
    state = act(state, 2, { type: "pass" });
    expect(state.phase).toEqual({ kind: "awaitDiscard", seat: 1, drew: true });
    expect(state.players[0]!.discards).toHaveLength(1);
  });

  it("when the window times out with no claim, the next player draws", () => {
    const closed = closeClaimWindow(discardFiveBamboo());
    expect(closed.ok && closed.state.phase).toEqual({ kind: "awaitDiscard", seat: 1, drew: true });
  });

  it("uses exactly the tiles the player selected", () => {
    // Seat 2 holds three 5b and chooses which two go into the pung.
    const wall: StackedWall = {
      hands: ["5b 147c 258d 369b ESWN", "369c 147d 1b 9b SSS WhWh", "555b 258c 369d GGG Wh", "46b 147c 258d EEE RG"],
    };
    let state = act(discardFiveBamboo(wall), 2, { type: "claim" });
    expect(types(legalActions(state, 2))).toEqual(["kong", "pung"]);
    const fives = state.players[2]!.hand.filter((t) => kindOf(t) === kindOf((state.phase as { tile: TileId }).tile));
    const chosen: [TileId, TileId] = [fives[2]!, fives[0]!];
    state = act(state, 2, { type: "pung", tiles: chosen });
    expect(state.players[2]!.melds[0]!.tiles).toEqual(expect.arrayContaining(chosen));
    expect(state.players[2]!.hand).toContain(fives[1]);
  });

  it("rejects selections that don't form the set or aren't in hand", () => {
    const state = act(discardFiveBamboo(), 2, { type: "claim" });
    const pung = option(state, 2, "pung");
    const other = state.players[2]!.hand.find((t) => !pung.tiles.includes(t))!;
    expect(applyAction(state, 2, { type: "pung", tiles: [pung.tiles[0], other] }).ok).toBe(false); // wrong kind
    expect(applyAction(state, 2, { type: "pung", tiles: [pung.tiles[0], pung.tiles[0]] }).ok).toBe(false); // same tile twice
    const notHeld = (state.phase as { tile: TileId }).tile; // right kind, but it's the claimed tile itself
    expect(applyAction(state, 2, { type: "pung", tiles: [pung.tiles[0], notHeld] }).ok).toBe(false);
    expect(applyAction(state, 2, { type: "chow", tiles: pung.tiles }).ok).toBe(false); // seat 2 can't chow
  });
});

describe("winning on a discard", () => {
  // Seat 0 discards 5b. Seats 1 and 3 can both win on it; seat 2 can pung it.
  const doubleWin: StackedWall = {
    hands: ["5b 147c 258d 369b ESWN", "46b 123c 456c 789c EE", "55b 258c 369d NGGGWh", "5b 123d 456d 789d SSS"],
  };

  function discardFiveBamboo() {
    const state = setup(doubleWin);
    return act(state, 0, { type: "discard", tile: tile(state, 0, "5b") });
  }

  it("claim, then win: the discarder pays", () => {
    let state = act(discardFiveBamboo(), 3, { type: "claim" });
    expect(types(legalActions(state, 3))).toEqual(["win"]);
    state = act(state, 3, { type: "win" });
    expect(state.phase).toMatchObject({
      kind: "handOver",
      result: { kind: "win", winner: 3, selfDraw: false, from: 0, payments: [-1, 0, 0, 1] },
    });
    expect(state.players[3]!.hand.map(kindOf)).toContain(parseKinds("5b")[0]);
  });

  it("after claiming, a player who could win may form a set instead", () => {
    const state = act(discardFiveBamboo(), 1, { type: "claim" });
    expect(types(legalActions(state, 1))).toEqual(["chow", "win"]);
  });

  it("a pung claimed first beats a win", () => {
    let state = claimAndUse(discardFiveBamboo(), 2, "pung");
    expect(state.phase).toEqual({ kind: "awaitDiscard", seat: 2, drew: false });
    expect(applyAction(state, 3, { type: "claim" }).ok).toBe(false);
  });

  it("lets a player pass up a win", () => {
    let state = discardFiveBamboo();
    for (const seat of [1, 2, 3] as Seat[]) state = act(state, seat, { type: "pass" });
    expect(state.phase).toEqual({ kind: "awaitDiscard", seat: 1, drew: true });
  });
});

describe("kongs", () => {
  it("exposed kong: claims the discard, then draws a replacement from the back", () => {
    let state = setup({
      hands: ["5b 147c 258d 369b ESWN", "369c 147d 1b 9b SSS WhWh", "555b 258c 369d GGG Wh", "46b 147c 258d EEE RG"],
      replacements: "R",
    });
    const wallBefore = state.wall.length;
    state = act(state, 0, { type: "discard", tile: tile(state, 0, "5b") });
    state = act(state, 2, { type: "claim" });
    expect(types(legalActions(state, 2))).toEqual(["kong", "pung"]);
    state = act(state, 2, option(state, 2, "kong"));

    expect(state.players[2]!.melds[0]).toMatchObject({ type: "kong", concealed: false });
    expect(state.players[2]!.melds[0]!.tiles).toHaveLength(4);
    expect(state.phase).toEqual({ kind: "awaitDiscard", seat: 2, drew: true });
    expect(kindOf(state.lastDrawn!)).toBe(parseKinds("R")[0]);
    expect(state.wall).toHaveLength(wallBefore - 1);
  });

  it("concealed kong: four in hand, then a replacement draw", () => {
    let state = setup({ hands: ["EEEE 123c 456c 789c 1d", ...QUIET], replacements: "Wh" });
    const easts = state.players[0]!.hand.filter((t) => kindOf(t) === parseKinds("E")[0]);
    expect(legalActions(state, 0)).toContainEqual({ type: "concealedKong", tiles: easts });
    expect(applyAction(state, 0, { type: "concealedKong", tiles: easts.slice(0, 3) }).ok).toBe(false);
    state = act(state, 0, { type: "concealedKong", tiles: easts });
    expect(state.players[0]!.melds[0]).toMatchObject({ type: "kong", concealed: true, claimed: null });
    expect(state.players[0]!.hand).toHaveLength(11);
    expect(state.phase).toEqual({ kind: "awaitDiscard", seat: 0, drew: true });
    expect(kindOf(state.lastDrawn!)).toBe(parseKinds("Wh")[0]);
  });

  // Seat 1 pungs seat 0's 5b, then later draws the fourth 5b. Seat 3 is waiting on 5b throughout.
  const addedKong: StackedWall = {
    hands: ["5b 147c 258d 369b ESWN", "55b 258c 369d NGGGWh", "369c 147d 1b 9b SSS WhWh", "46b 123c 456c 789c EE"],
    draws: "R N R 5b",
    replacements: "G",
  };

  function untilFourthFiveBamboo(rules: Partial<RuleConfig> = {}): HandState {
    let state = setup(addedKong, rules);
    state = act(state, 0, { type: "discard", tile: tile(state, 0, "5b") });
    state = act(state, 3, { type: "pass" }); // passes up a win: no penalty, can still win later
    state = claimAndUse(state, 1, "pung");
    state = discardNoClaims(state, 1, "2c");
    state = discardNoClaims(state, 2, "R");
    state = discardNoClaims(state, 3, "N");
    state = discardNoClaims(state, 0, "R");
    expect(state.phase).toEqual({ kind: "awaitDiscard", seat: 1, drew: true });
    return state;
  }

  it("locks declared sets: their tiles can't be discarded", () => {
    let state = setup(addedKong);
    state = act(state, 0, { type: "discard", tile: tile(state, 0, "5b") });
    state = act(state, 3, { type: "pass" });
    state = claimAndUse(state, 1, "pung");
    const meldTiles = state.players[1]!.melds[0]!.tiles;
    const discardable = legalActions(state, 1).flatMap((a) => (a.type === "discard" ? [a.tile] : []));
    expect(discardable.some((t) => meldTiles.includes(t))).toBe(false);
    expect(applyAction(state, 1, { type: "discard", tile: meldTiles[0]! }).ok).toBe(false);
  });

  it("added kong: the fourth tile joins the exposed pung, then a replacement draw", () => {
    let state = untilFourthFiveBamboo();
    const fourth = tile(state, 1, "5b");
    expect(legalActions(state, 1)).toContainEqual({ type: "addedKong", tile: fourth });
    state = act(state, 1, { type: "addedKong", tile: fourth });
    expect(state.players[1]!.melds[0]).toMatchObject({ type: "kong" });
    expect(state.players[1]!.melds[0]!.tiles).toHaveLength(4);
    expect(state.phase).toEqual({ kind: "awaitDiscard", seat: 1, drew: true });
    expect(kindOf(state.lastDrawn!)).toBe(parseKinds("G")[0]);
  });

  it("robbing the kong (when enabled): win on the added tile; the kong's owner pays", () => {
    let state = untilFourthFiveBamboo({ robbingKong: true });
    state = act(state, 1, { type: "addedKong", tile: tile(state, 1, "5b") });
    expect(state.phase).toMatchObject({ kind: "claimWindow", source: "addedKong", from: 1 });
    expect(types(legalActions(state, 3))).toEqual(["claim", "pass"]);
    state = claimAndUse(state, 3, "win");
    expect(state.phase).toMatchObject({
      kind: "handOver",
      result: { winner: 3, from: 1, robbedKong: true, selfDraw: false, payments: [0, -1, 0, 1] },
    });
  });

  it("if nobody robs, the added kong completes", () => {
    let state = untilFourthFiveBamboo({ robbingKong: true });
    state = act(state, 1, { type: "addedKong", tile: tile(state, 1, "5b") });
    state = act(state, 3, { type: "pass" });
    expect(state.players[1]!.melds[0]!.type).toBe("kong");
    expect(state.phase).toEqual({ kind: "awaitDiscard", seat: 1, drew: true });
  });
});

describe("end of the wall", () => {
  it("plays to the last tile, then the hand is a draw with no payments", () => {
    let state = startHand({ seed: 99 }).state;
    for (let step = 0; step < 500 && state.phase.kind !== "handOver"; step++) {
      if (state.phase.kind === "claimWindow") {
        const closed = closeClaimWindow(state);
        if (!closed.ok) throw new Error(closed.error);
        state = closed.state;
      } else if (state.phase.kind === "awaitDiscard") {
        const seat = state.phase.seat;
        state = act(state, seat, { type: "discard", tile: state.lastDrawn ?? state.players[seat]!.hand[0]! });
      }
    }
    expect(state.wall).toHaveLength(0);
    expect(state.phase).toEqual({ kind: "handOver", result: { kind: "draw", payments: [0, 0, 0, 0] } });
  });
});

describe("validation", () => {
  it("rejects actions out of turn or out of phase, without changing state", () => {
    const state = setup({ hands: ["5b 147c 258d 369b ESWN", ...QUIET] });
    const snapshot = JSON.stringify(state);
    expect(applyAction(state, 1, { type: "discard", tile: state.players[1]!.hand[0]! }).ok).toBe(false);
    expect(applyAction(state, 0, { type: "pass" }).ok).toBe(false);
    expect(applyAction(state, 0, { type: "discard", tile: state.players[1]!.hand[0]! }).ok).toBe(false);
    expect(closeClaimWindow(state).ok).toBe(false);
    act(state, 0, { type: "discard", tile: tile(state, 0, "5b") });
    expect(JSON.stringify(state)).toBe(snapshot); // applyAction never mutates its input
  });
});

describe("views", () => {
  it("shows a seat only its own tiles and other players' public info", () => {
    const { state, events } = startHand({ seed: 5 });
    const view = projectView(state, 1);
    expect(view.hand).toEqual(state.players[1]!.hand);
    expect(view.lastDrawn).toBeNull(); // it's the dealer's turn
    expect(view.players[0]!.handCount).toBe(14);
    expect(JSON.stringify(view)).not.toMatch(/wall"|seed|responses/);
    expect(projectView(state, 0).lastDrawn).toBe(state.lastDrawn);
    expect(projectEvents(events, 1)).toEqual(events);
  });

  it("shows everyone each player's complete concealed sets, but nothing more", () => {
    const state = setup({ hands: ["123c 456c 789c 123d 55d", "147c 258d 369b SWNR", "258c 369d 147b SSGWh", "369c 147d 258b NNRG"] });
    const view = projectView(state, 2);
    expect(view.players.map((p) => p.concealedSets)).toEqual([4, 0, 0, 0]);
    expect(Object.keys(view.players[0]!).sort()).toEqual(["concealedSets", "discards", "handCount", "melds", "seat", "wind"]);
  });

  it("shows that someone claimed the tile, not what for", () => {
    let state = setup({
      hands: ["5b 147c 258d 369b ESWN", "46b 147c 258d EEE RG", "55b 258c 369d NGGGWh", "369c 147d 1b 9b SSS WhWh"],
    });
    state = act(state, 0, { type: "discard", tile: tile(state, 0, "5b") });
    state = act(state, 2, { type: "claim" });
    expect(projectView(state, 3).phase).toEqual({ kind: "claimed", seat: 2, from: 0, tile: (state.phase as { tile: TileId }).tile });
  });

  it("reveals every hand at the end of the hand, or only yours and the winner's", () => {
    const state = act(setup({ hands: ["123c 456c 789c 123d 55d", ...QUIET] }), 0, { type: "selfDrawWin" });
    const hands = state.players.map((p) => p.hand);
    expect(projectView(state, 2).phase).toMatchObject({ kind: "handOver", hands });
    expect(projectView(state, 2, { revealHands: false }).phase).toMatchObject({ hands: [hands[0], null, hands[2], null] });
  });

  it("hides other players' drawn tiles in events", () => {
    const state = setup({ hands: ["5b 147c 258d 369b ESWN", ...QUIET] });
    const result = applyAction(state, 0, { type: "discard", tile: tile(state, 0, "5b") });
    if (!result.ok) throw new Error(result.error);
    const drew = (seat: Seat) => projectEvents(result.events, seat).find((e) => e.type === "drew");
    expect(drew(1)).toMatchObject({ seat: 1, tile: result.state.lastDrawn });
    expect(drew(2)).toMatchObject({ seat: 1, tile: null });
  });
});
