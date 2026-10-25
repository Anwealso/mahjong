import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, type RuleConfig } from "./rules";
import { countKinds, formatKinds, parseKinds } from "./tiles";
import { decompose, isWinningHand, maxConcealedSets, waitingKinds } from "./win";

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
