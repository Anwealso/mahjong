import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, type RuleConfig } from "./rules";
import { countKinds, formatKinds, kindOf, parseKinds, type TileId } from "./tiles";
import { decompose, isWinningHand, maxConcealedSets, waitingKinds, winningGroups } from "./win";

const counts = (notation: string) => countKinds(parseKinds(notation));
const wins = (notation: string, exposed = 0, rules: RuleConfig = DEFAULT_RULES) =>
  isWinningHand(counts(notation), exposed, rules);

describe("isWinningHand", () => {
  it("accepts standard 4 sets + pair", () => {
    expect(wins("123c 456d 789b EEE RR")).toBe(true);
    expect(wins("111c 222c 333c 999b WhWh")).toBe(true);
    expect(wins("11223344556677c")).toBe(true); // 123 123 456 456 77
    expect(wins("11122233344455c")).toBe(true); // 111 222 333 444 55
  });

  it("rejects non-winning shapes", () => {
    expect(wins("123c 456d 789b EEE RG")).toBe(false);
    expect(wins("123c 456d 789b EE")).toBe(false); // wrong size
    expect(wins("89c 1d 456d 789b EEE RR")).toBe(false); // chows don't wrap across suits
  });

  it("does not let honors form chows", () => {
    expect(wins("ESW 123c 456c 789c RR")).toBe(false);
  });

  it("accounts for exposed melds", () => {
    // One pung exposed, 11 tiles concealed.
    expect(wins("456d 789b EEE RR", 1)).toBe(true);
    expect(wins("456d 789b EEE RR", 0)).toBe(false);
    // All four sets exposed, waiting on a single pair.
    expect(wins("RR", 4)).toBe(true);
  });

  it("supports optional special hands", () => {
    const orphans = "19c 19d 19b ESWNRGWhWh";
    expect(wins(orphans)).toBe(false);
    expect(wins(orphans, 0, { ...DEFAULT_RULES, thirteenOrphans: true })).toBe(true);
    expect(wins(orphans, 1, { ...DEFAULT_RULES, thirteenOrphans: true })).toBe(false);

    const pairs = "1155c 22d 99b EERRGG";
    expect(wins(pairs)).toBe(false);
    expect(wins(pairs, 0, { ...DEFAULT_RULES, sevenPairs: true })).toBe(true);
    expect(wins("1111c 22d 99b EERRGG", 0, { ...DEFAULT_RULES, sevenPairs: true })).toBe(false);
  });
});

describe("decompose", () => {
  it("finds every split", () => {
    // 111222333c can be three pungs or three chows.
    const ways = decompose(counts("111222333c 55d"));
    expect(ways).toHaveLength(2);
  });
});

describe("waitingKinds", () => {
  const waits = (notation: string, exposed = 0) =>
    formatKinds(waitingKinds(counts(notation), exposed, DEFAULT_RULES));

  it("finds open-ended and pair waits", () => {
    expect(waits("23c 456d 789b EEE RR")).toBe("14c");
    expect(waits("123c 456d 789b EEE R")).toBe("R");
  });

  it("finds the nine-gates wait", () => {
    expect(waits("1112345678999c")).toBe("123456789c");
  });

  it("skips kinds the player holds all four of", () => {
    // A fifth 1c would make 111 + 11, but it doesn't exist.
    expect(waits("1111c 456d 789b EEE")).toBe("");
    expect(waits("1111c 23c 456d 789b E")).toBe("E");
  });
});

describe("maxConcealedSets", () => {
  const sets = (notation: string) => maxConcealedSets(counts(notation));

  it("counts complete sets only, never pairs or partial runs", () => {
    expect(sets("123c 456d 789b EEE RR")).toBe(4);
    expect(sets("11c 23d 46b EE RG")).toBe(0);
    expect(sets("1234c")).toBe(1);
  });

  it("finds the grouping with the most sets", () => {
    expect(sets("111222333c")).toBe(3); // three pungs or three chows
    expect(sets("1112345c")).toBe(2); // 111 + 234 (not 123 + leftover)
    expect(sets("12233c")).toBe(1);
    expect(sets("112233c")).toBe(2);
    expect(sets("1111c")).toBe(1); // four in hand: a pung plus a loose tile until declared as a kong
  });

  it("doesn't run chows across suits or through honors", () => {
    expect(sets("89c 1d")).toBe(0);
    expect(sets("ESW")).toBe(0);
  });
});

describe("winningGroups", () => {
  /** One tile id per kind, using successive copies when a kind repeats. */
  const tiles = (notation: string): TileId[] => {
    const seen = new Map<number, number>();
    return parseKinds(notation).map((k) => {
      const copy = seen.get(k) ?? 0;
      seen.set(k, copy + 1);
      return k * 4 + copy;
    });
  };
  const groups = (notation: string) =>
    winningGroups(tiles(notation))?.map((g) => formatKinds(g.map(kindOf)));

  it("splits a standard hand into its sets, then the pair", () => {
    expect(groups("RR 789b EEE 456d 123c")).toEqual(["123c", "456d", "789b", "EEE", "RR"]);
    expect(groups("11223344556677c")).toEqual(["234c", "234c", "567c", "567c", "11c"]);
  });

  it("uses every tile exactly once", () => {
    const hand = tiles("11122233344455c");
    expect(winningGroups(hand)!.flat().sort((a, b) => a - b)).toEqual([...hand].sort((a, b) => a - b));
  });

  it("works with fewer concealed tiles when sets are exposed", () => {
    expect(groups("456d EEE RR")).toEqual(["456d", "EEE", "RR"]);
  });

  it("splits seven pairs into pairs and keeps thirteen orphans whole", () => {
    expect(groups("1199c 22d 55b EE RR GG")).toEqual(["11c", "99c", "22d", "55b", "EE", "RR", "GG"]);
    expect(groups("119c 19d 19b ESWNRGWh")).toEqual(["119c 19d 19b E S W N R G Wh"]);
  });

  it("prefers the split that keeps the player's own groups, and puts them first", () => {
    const hand = tiles("11223344556677c");
    // The player grouped one 123c (the first copies of each) and the 456c run with the second copies.
    const mine = [[hand[0]!, hand[2]!, hand[4]!], [hand[7]!, hand[9]!, hand[11]!]];
    const result = winningGroups(hand, mine)!;
    expect(result.slice(0, 2)).toEqual(mine);
    expect(result.map((x) => formatKinds(x.map(kindOf)))).toEqual(["123c", "456c", "123c", "456c", "77c"]);
  });

  it("ignores groups that no winning split can keep", () => {
    const hand = tiles("11223344556677c");
    const result = winningGroups(hand, [[hand[1]!, hand[3]!, hand[13]!]])!; // 1 2 7: not a set
    expect(result.map((x) => formatKinds(x.map(kindOf)))).toEqual(["234c", "234c", "567c", "567c", "11c"]);
  });

  it("returns null for a hand that doesn't win", () => {
    expect(winningGroups(tiles("123c 456d 789b EEE RG"))).toBeNull();
  });
});
