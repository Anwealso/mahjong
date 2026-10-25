import { canStartChow, kindOf, type TileId } from "@mahjong/engine";

/**
 * How a player has laid out their concealed tiles: private groups (complete sets, shown on the left),
 * then the loose tiles in the order they dragged them into. Client-only; the server never sees it.
 */
export interface Arrangement {
  groups: TileId[][];
  loose: TileId[];
}

export const EMPTY_ARRANGEMENT: Arrangement = { groups: [], loose: [] };

/**
 * Fit an arrangement to the hand the server says we hold. Tiles that left the hand are dropped, and a
 * group that lost a tile breaks up (its other tiles become loose). New tiles go at the end. Returns the
 * same object if nothing changed.
 */
export function reconcile(arrangement: Arrangement, hand: readonly TileId[]): Arrangement {
  const inHand = new Set(hand);
  const groups = arrangement.groups.filter((g) => g.every((t) => inHand.has(t)));
  const broken = arrangement.groups.filter((g) => !groups.includes(g)).flat().filter((t) => inHand.has(t));
  const placed = new Set([...groups.flat(), ...arrangement.loose, ...broken]);
  const loose = [
    ...arrangement.loose.filter((t) => inHand.has(t)),
    ...broken,
    ...hand.filter((t) => !placed.has(t)),
  ];
  const unchanged =
    groups.length === arrangement.groups.length &&
    loose.length === arrangement.loose.length &&
    loose.every((t, i) => t === arrangement.loose[i]);
  return unchanged ? arrangement : { groups, loose };
}

/** "pung", "chow", or null if these three tiles aren't a complete set. Only complete sets can be grouped. */
export function setType(tiles: readonly TileId[]): "pung" | "chow" | null {
  if (tiles.length !== 3) return null;
  const [a, b, c] = tiles.map(kindOf).sort((x, y) => x - y) as [number, number, number];
  if (a === b && b === c) return "pung";
  if (canStartChow(a) && b === a + 1 && c === a + 2) return "chow";
  return null;
}

/** Put these loose tiles in a new group (sorted), placed after the existing groups. Null if not allowed. */
export function group(arrangement: Arrangement, tiles: readonly TileId[]): Arrangement | null {
  if (!setType(tiles) || !tiles.every((t) => arrangement.loose.includes(t))) return null;
  return {
    groups: [...arrangement.groups, [...tiles].sort((a, b) => a - b)],
    loose: arrangement.loose.filter((t) => !tiles.includes(t)),
  };
}

/** The group made of exactly these tiles, or -1. */
export function findGroup(arrangement: Arrangement, tiles: readonly TileId[]): number {
  return arrangement.groups.findIndex((g) => g.length === tiles.length && g.every((t) => tiles.includes(t)));
}

/** Break up a group; its tiles go back to the front of the loose tiles, next to where they were. */
export function ungroup(arrangement: Arrangement, index: number): Arrangement {
  const g = arrangement.groups[index];
  if (!g) return arrangement;
  return { groups: arrangement.groups.filter((_, i) => i !== index), loose: [...g, ...arrangement.loose] };
}

/** Sort the loose tiles by kind. Groups stay as they are. */
export const sortLoose = (arrangement: Arrangement): Arrangement => ({
  ...arrangement,
  loose: [...arrangement.loose].sort((a, b) => a - b),
});

/** Move a loose tile to where another loose tile is (drag and drop). */
export function moveLoose(arrangement: Arrangement, tile: TileId, over: TileId): Arrangement {
  const from = arrangement.loose.indexOf(tile);
  const to = arrangement.loose.indexOf(over);
  if (from < 0 || to < 0 || from === to) return arrangement;
  const loose = [...arrangement.loose];
  loose.splice(from, 1);
  loose.splice(to, 0, tile);
  return { ...arrangement, loose };
}
