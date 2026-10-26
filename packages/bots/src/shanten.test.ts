import { buildWall, countKinds, countTiles, DEFAULT_RULES, isWinningHand, parseKinds } from "@mahjong/engine";
import { describe, expect, it } from "vitest";
import { shanten } from "./shanten";
import { ukeire } from "./ukeire";

const counts = (notation: string) => countKinds(parseKinds(notation));
const full = () => new Array<number>(34).fill(4);

describe("shanten", () => {
  it.each([
    ["123c 456c 789c 123d 55d", 0, -1],
    ["123c 456c 789c 123d 5d", 0, 0],
    ["123c 456c 789c 12d 55d", 0, 0],
    ["123c 456c 78c 13d 5d 9b E", 0, 2],
    ["147c 258d 369b ESWN", 0, 8],
    ["EEE SSS WW NN RR GG", 0, 1],
    ["123c 5d", 3, 0],
    ["12c 55d", 3, 0],
    ["1c 5c 9d E", 3, 2],
  ])("%s with %i locked sets is %i", (hand, melds, expected) => {
    expect(shanten(counts(hand), melds)).toBe(expected);
  });

  it("agrees with the engine's win check on random 14-tile hands", () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const hand = countTiles(buildWall(seed).slice(0, 14));
      expect(shanten(hand, 0) === -1).toBe(isWinningHand(hand, 0, DEFAULT_RULES));
    }
  });

  it("drawing a tile improves shanten by at most one", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const wall = buildWall(seed);
      const hand = countTiles(wall.slice(0, 13));
      const after = countTiles(wall.slice(0, 14));
      expect(shanten(after, 0)).toBeGreaterThanOrEqual(shanten(hand, 0) - 1);
    }
  });
});

describe("ukeire", () => {
  it("counts the unseen tiles that improve the hand", () => {
    const hand = counts("123c 456c 789c 123d 5d");
    const unseen = full();
    parseKinds("123c 456c 789c 123d 5d").forEach((k) => unseen[k]!--);
    expect(ukeire(hand, 0, unseen)).toEqual({ tiles: 3, kinds: parseKinds("5d") });
  });

  it("ignores kinds with no copies left", () => {
    const unseen = full();
    unseen[parseKinds("3d")[0]!] = 0;
    expect(ukeire(counts("123c 456c 789c 12d 55d"), 0, unseen).tiles).toBe(0);
  });
});
