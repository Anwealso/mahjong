import type { Action, GameEvent } from "@mahjong/engine";
import { describe, expect, it } from "vitest";
import { soundsFor } from "./cues";

const sounds = (events: GameEvent[], legal: Action[] = [], me = 0, dealer = 1) =>
  soundsFor(events, me as 0, dealer as 0, legal).map((c) => c.sound);

const meld = (type: "chow" | "pung" | "kong"): GameEvent => ({
  type: "melded",
  seat: 2,
  meld: { type, tiles: [0, 1, 2], concealed: false, claimed: null },
});

describe("soundsFor", () => {
  it("plays the shuffle on the deal, and the turn chime only for the dealer", () => {
    expect(sounds([{ type: "dealt" }])).toEqual(["deal"]);
    expect(sounds([{ type: "dealt" }], [], 1, 1)).toEqual(["deal", "yourTurn"]);
  });

  it("keeps other players' draws silent, and chimes for your own normal draw", () => {
    expect(sounds([{ type: "drew", seat: 3, tile: null, replacement: false }])).toEqual([]);
    expect(sounds([{ type: "drew", seat: 0, tile: 5, replacement: false }])).toEqual(["draw", "yourTurn"]);
    expect(sounds([{ type: "drew", seat: 0, tile: 5, replacement: true }])).toEqual(["draw"]);
  });

  it("uses a quieter clack for other players' discards", () => {
    expect(sounds([{ type: "discarded", seat: 0, tile: 5 }])).toEqual(["discard"]);
    expect(sounds([{ type: "discarded", seat: 2, tile: 5 }])).toEqual(["discardOther"]);
  });

  it("pings for a claim window only when you can claim", () => {
    const events: GameEvent[] = [
      { type: "discarded", seat: 2, tile: 5 },
      { type: "claimWindowOpened", source: "discard", from: 2, tile: 5 },
    ];
    expect(sounds(events, [{ type: "pass" }])).toEqual(["discardOther"]);
    expect(sounds(events, [{ type: "claim" }, { type: "pass" }])).toEqual(["discardOther", "claimPing"]);
  });

  it("plays the kong clack for kongs, not the set clack", () => {
    expect(sounds([meld("pung")])).toEqual(["set"]);
    expect(sounds([meld("chow")])).toEqual(["set"]);
    expect(sounds([meld("kong")])).toEqual(["kong"]);
    expect(sounds([{ type: "kongAdded", seat: 1, tile: 5 }])).toEqual(["kong"]);
    expect(sounds([{ type: "claimed", seat: 1, from: 2, tile: 5 }])).toEqual([]);
  });

  it("plays a bigger fanfare when you win, and a thud for a draw hand", () => {
    const win = (winner: 0 | 1): GameEvent => ({
      type: "handOver",
      result: { kind: "win", winner, tile: 5, selfDraw: true, from: null, robbedKong: false, payments: [0, 0, 0, 0] },
    });
    expect(sounds([win(0)])).toEqual(["winBig"]);
    expect(sounds([win(1)])).toEqual(["win"]);
    expect(sounds([{ type: "handOver", result: { kind: "draw", payments: [0, 0, 0, 0] } }])).toEqual(["drawHand"]);
  });

  it("spaces out sounds that arrive together", () => {
    const cues = soundsFor(
      [
        { type: "discarded", seat: 3, tile: 5 },
        { type: "drew", seat: 0, tile: 9, replacement: false },
      ],
      0,
      1,
      [],
    );
    expect(cues.map((c) => c.delay)).toEqual([0, 150, 300]);
  });
});
