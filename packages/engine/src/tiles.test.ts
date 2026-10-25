import { describe, expect, it } from "vitest";
import { formatKinds, kindCode, kindName, kindOf, parseKinds } from "./tiles";

describe("tiles", () => {
  it("maps ids to kinds, four copies each", () => {
    expect([0, 1, 2, 3].map(kindOf)).toEqual([0, 0, 0, 0]);
    expect(kindOf(135)).toBe(33);
  });

  it("names kinds", () => {
    expect(kindCode(0)).toBe("1c");
    expect(kindCode(17)).toBe("9d");
    expect(kindCode(27)).toBe("E");
    expect(kindCode(33)).toBe("Wh");
    expect(kindName(31)).toBe("Red Dragon");
    expect(kindName(22)).toBe("5 Bamboo");
  });

  it("parses and formats notation", () => {
    expect(parseKinds("123c")).toEqual([0, 1, 2]);
    expect(parseKinds("WWh")).toEqual([29, 33]);
    expect(parseKinds("WhW")).toEqual([33, 29]);
    const hand = "123c 456d 789b EEE RR";
    expect(formatKinds(parseKinds(hand))).toBe(hand);
    expect(() => parseKinds("12x")).toThrow();
  });
});
