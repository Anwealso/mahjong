import { legalActions, projectView, startHand, stackWall, applyAction, parseKinds, kindOf } from "@mahjong/engine";
import { describe, expect, it } from "vitest";
import { runArena } from "./arena";
import { easyPolicy } from "./easy";
import { contestant } from "./levels";
import { mediumPolicy } from "./medium";

const points = (r: ReturnType<typeof runArena>, name: string) => r.stats.find((s) => s.name === name)!.points;

describe("levels", () => {
  it("are ordered in a seeded arena: Medium beats Easy beats Random", () => {
    const r = runArena(["medium", "easy", "random", "random"].map(contestant), 160, 7);
    expect(points(r, "medium")).toBeGreaterThan(points(r, "easy"));
    expect(points(r, "easy")).toBeGreaterThan(points(r, "random"));
    // Smarter bots finish hands: draws should be rare, unlike an all-random table.
    expect(r.draws / r.hands).toBeLessThan(0.2);
  }, 30_000);
});

describe("hard", () => {
  it("deals in less than Medium would in the same seat, on the same deals", () => {
    const hard = runArena(["hard", "medium", "medium", "medium"].map(contestant), 300, 8).stats[0]!;
    const medium = runArena(["medium", "medium", "medium", "medium"].map(contestant), 300, 8).stats[0]!;
    expect(hard.dealIns).toBeLessThan(medium.dealIns);
  }, 60_000);
});

describe("medium", () => {
  it("throws a lone honour before breaking up a useful shape", () => {
    // Seat 0 holds three sets, 1-2 of dots, a pair, and one useless North.
    const s2 = startHand({
      seed: 1,
      wall: stackWall({ hands: ["123c 456c 789c 12d 55d N", "147c 258d 369b SWNR", "258c 369d 147b SSGWh", "369c 147d 258b NNRG"] }),
    }).state;
    const action = mediumPolicy()(projectView(s2, 0), legalActions(s2, 0));
    expect(action.type).toBe("discard");
    expect(action.type === "discard" && kindOf(action.tile)).toBe(parseKinds("N")[0]);
  });

  it("always takes a win, and claims a pung that brings it closer to ready", () => {
    // Seat 0 discards 5b; seat 2 holds 55b and benefits from the pung.
    let s = startHand({
      seed: 1,
      wall: stackWall({ hands: ["5b 147c 258d 369b ESWN", "147c 258d 369b SWNR", "55b 123c 456c 78d EE S", "369c 147d 258b NNRG"] }),
    }).state;
    const five = s.players[0]!.hand.find((t) => kindOf(t) === parseKinds("5b")[0])!;
    s = (applyAction(s, 0, { type: "discard", tile: five }) as { state: typeof s }).state;
    expect(mediumPolicy()(projectView(s, 2), legalActions(s, 2))).toEqual({ type: "claim" });
  });

  it("easy always takes a win", () => {
    const s = startHand({
      seed: 1,
      wall: stackWall({ hands: ["123c 456c 789c 123d 55d", "147c 258d 369b SWNR", "258c 369d 147b SSGWh", "369c 147d 258b NNRG"] }),
    }).state;
    expect(easyPolicy(() => 0.99)(projectView(s, 0), legalActions(s, 0))).toEqual({ type: "selfDrawWin" });
  });
});
