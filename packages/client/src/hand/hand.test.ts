import { parseKinds, type Action, type TileId } from "@mahjong/engine";
import { describe, expect, it } from "vitest";
import { findGroup, group, moveLoose, reconcile, setType, sortLoose, ungroup, EMPTY_ARRANGEMENT } from "./arrangement";
import { optionForTile, pickTiles, setAction, setOptions } from "./claimOptions";

/** The `copy`th physical tile (0–3) of a kind written in notation, e.g. tile("5b", 1). */
const tile = (code: string, copy = 0): TileId => parseKinds(code)[0]! * 4 + copy;

describe("arrangement", () => {
  const hand = [tile("1c"), tile("2c"), tile("3c"), tile("5d"), tile("5d", 1), tile("5d", 2), tile("E")];

  it("starts with the hand's own order and appends new tiles at the end", () => {
    const a = reconcile(EMPTY_ARRANGEMENT, hand);
    expect(a.loose).toEqual(hand);
    const moved = moveLoose(a, tile("E"), tile("1c"));
    expect(moved.loose[0]).toBe(tile("E"));
    const drawn = reconcile(moved, [...hand, tile("9b")].sort((x, y) => x - y));
    expect(drawn.loose).toEqual([...moved.loose, tile("9b")]);
  });

  it("returns the same object when nothing changed", () => {
    const a = reconcile(EMPTY_ARRANGEMENT, hand);
    expect(reconcile(a, hand)).toBe(a);
  });

  it("only groups complete sets of loose tiles", () => {
    expect(setType([tile("1c"), tile("2c"), tile("3c")])).toBe("chow");
    expect(setType([tile("5d"), tile("5d", 1), tile("5d", 2)])).toBe("pung");
    expect(setType([tile("8c"), tile("9c"), tile("1d")])).toBeNull(); // no wrapping across suits
    expect(setType([tile("5d"), tile("5d", 1)])).toBeNull();

    const a = reconcile(EMPTY_ARRANGEMENT, hand);
    expect(group(a, [tile("1c"), tile("2c"), tile("E")])).toBeNull();
    const g = group(a, [tile("3c"), tile("1c"), tile("2c")])!;
    expect(g.groups).toEqual([[tile("1c"), tile("2c"), tile("3c")]]);
    expect(g.loose).not.toContain(tile("1c"));
    expect(group(g, [tile("1c"), tile("2c"), tile("3c")])).toBeNull(); // already grouped
  });

  it("ungroups back to the front of the loose tiles", () => {
    const g = group(reconcile(EMPTY_ARRANGEMENT, hand), [tile("1c"), tile("2c"), tile("3c")])!;
    const i = findGroup(g, [tile("2c"), tile("1c"), tile("3c")]);
    expect(i).toBe(0);
    expect(ungroup(g, i).loose.slice(0, 3)).toEqual([tile("1c"), tile("2c"), tile("3c")]);
  });

  it("breaks up a group that lost a tile, keeping its other tiles", () => {
    const g = group(reconcile(EMPTY_ARRANGEMENT, hand), [tile("1c"), tile("2c"), tile("3c")])!;
    const after = reconcile(g, hand.filter((t) => t !== tile("2c")));
    expect(after.groups).toEqual([]);
    expect(after.loose).toContain(tile("1c"));
    expect(after.loose).toContain(tile("3c"));
    expect(after.loose).not.toContain(tile("2c"));
  });

  it("sorts only the loose tiles", () => {
    const g = group(reconcile(EMPTY_ARRANGEMENT, [...hand].reverse()), [tile("1c"), tile("2c"), tile("3c")])!;
    const sorted = sortLoose(g);
    expect(sorted.groups).toBe(g.groups);
    expect(sorted.loose).toEqual([tile("5d"), tile("5d", 1), tile("5d", 2), tile("E")]);
  });
});

describe("claim options", () => {
  // Holding 3-4 and 6-7 of bamboo plus three 5s; a 5b was claimed from the player on our left.
  const hand = [tile("3b"), tile("4b"), tile("5b"), tile("5b", 1), tile("5b", 2), tile("6b"), tile("7b")];
  const claimed = tile("5b", 3);
  const legal: Action[] = [
    { type: "pung", tiles: [tile("5b"), tile("5b", 1)] },
    { type: "kong", tiles: [tile("5b"), tile("5b", 1), tile("5b", 2)] },
    { type: "chow", tiles: [tile("3b"), tile("4b")] },
    { type: "chow", tiles: [tile("4b"), tile("6b")] },
    { type: "chow", tiles: [tile("6b"), tile("7b")] },
  ];

  it("lists each set with its candidate tiles, a label, and its own colour", () => {
    const options = setOptions([{ type: "win" }, ...legal], hand, claimed);
    expect(options.map((o) => o.label)).toEqual(["Pung 555b", "Kong 5555b", "Chow 345b", "Chow 456b", "Chow 567b"]);
    expect(options[0]!.candidates).toEqual([tile("5b"), tile("5b", 1), tile("5b", 2)]);
    expect(new Set(options.slice(0, 4).map((o) => o.color)).size).toBe(4);
  });

  it("picks one tile per needed kind, preferring the ones asked for", () => {
    const [pung] = setOptions(legal, hand, claimed);
    expect(pickTiles(pung!, () => false)).toEqual([tile("5b"), tile("5b", 1)]);
    expect(pickTiles(pung!, (t) => t !== tile("5b"))).toEqual([tile("5b", 1), tile("5b", 2)]);
    expect(setAction(pung!, [tile("5b", 1), tile("5b", 2)])).toEqual({ type: "pung", tiles: [tile("5b", 1), tile("5b", 2)] });
  });

  it("clicking a tile shared by several options cycles through them", () => {
    const options = setOptions(legal, hand, claimed);
    const first = optionForTile(options, tile("4b"), null)!;
    expect(first.label).toBe("Chow 345b");
    const second = optionForTile(options, tile("4b"), first.key)!;
    expect(second.label).toBe("Chow 456b");
    expect(optionForTile(options, tile("4b"), second.key)!.key).toBe(first.key);
    expect(optionForTile(options, tile("E"), null)).toBeNull();
  });
});
