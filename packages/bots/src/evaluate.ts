import {
  canStartChow,
  isHonor,
  isSuited,
  isTerminal,
  kindOf,
  nextSeat,
  type PlayerView,
  type TileId,
  type TileKind,
} from "@mahjong/engine";
import { shanten } from "./shanten";
import { ukeire } from "./ukeire";
import { handCounts, unseenCounts } from "./visible";

/** How good a hand is while waiting to draw: fewer tiles from ready first, then more ways to improve. */
export interface Shape {
  shanten: number;
  ukeire: number;
}

/** Is `a` better than `b`? */
export const better = (a: Shape, b: Shape): boolean =>
  a.shanten < b.shanten || (a.shanten === b.shanten && a.ukeire > b.ukeire);

/** Everything a bot needs to know about its hand, computed once per decision. */
export interface Situation {
  view: PlayerView;
  counts: number[];
  melds: number;
  unseen: number[];
}

export function situation(view: PlayerView): Situation {
  return {
    view,
    counts: handCounts(view),
    melds: view.players[view.seat]!.melds.length,
    unseen: unseenCounts(view),
  };
}

/** Shape of a waiting-size hand (3n+1 tiles). */
export function shape(counts: number[], melds: number, unseen: readonly number[]): Shape {
  return { shanten: shanten(counts, melds), ukeire: ukeire(counts, melds, unseen).tiles };
}

export interface DiscardOption extends Shape {
  kind: TileKind;
  tile: TileId;
}

/** What the hand looks like after discarding one tile of each kind held. */
export function discardOptions(s: Situation): DiscardOption[] {
  const options: DiscardOption[] = [];
  for (let k = 0; k < s.counts.length; k++) {
    if (s.counts[k] === 0) continue;
    s.counts[k]!--;
    // Prefer to throw the copy we just drew (it doesn't matter which, but it reads naturally).
    const tile = s.view.hand.find((t) => kindOf(t) === k && t === s.view.lastDrawn) ?? s.view.hand.find((t) => kindOf(t) === k)!;
    options.push({ kind: k, tile, ...shape(s.counts, s.melds, s.unseen) });
    s.counts[k]!++;
  }
  return options;
}

/** Best shape reachable by discarding one tile (for a hand that must discard). */
export function bestAfterDiscard(counts: number[], melds: number, unseen: readonly number[]): Shape {
  let best: Shape = { shanten: Infinity, ukeire: -1 };
  for (let k = 0; k < counts.length; k++) {
    if (counts[k] === 0) continue;
    counts[k]!--;
    const s = shape(counts, melds, unseen);
    if (better(s, best)) best = s;
    counts[k]!++;
  }
  return best;
}

/** A way to use a discard: the hand kinds it needs. */
export interface Use {
  type: "pung" | "kong" | "chow";
  kinds: TileKind[];
}

/** The sets we could make with `tile` if we claimed it from `from` (mirrors the engine's rules). */
export function possibleUses(s: Situation, tile: TileId, from: number): Use[] {
  const k = kindOf(tile);
  const uses: Use[] = [];
  if (s.counts[k]! >= 2) uses.push({ type: "pung", kinds: [k, k] });
  if (s.counts[k]! >= 3 && s.view.wallCount > 0) uses.push({ type: "kong", kinds: [k, k, k] });
  if (s.view.seat === nextSeat(from as 0 | 1 | 2 | 3) && isSuited(k)) {
    for (let start = Math.max(0, k - 2); start <= k; start++) {
      if (!canStartChow(start)) continue;
      const others = [start, start + 1, start + 2].filter((x) => x !== k);
      if (others.every((x) => s.counts[x]! > 0)) uses.push({ type: "chow", kinds: others });
    }
  }
  return uses;
}

/** Shape after using a claimed tile: remove the hand tiles, add a locked set, then discard (or, for a kong, draw). */
export function shapeAfterUse(s: Situation, use: Use): Shape {
  const counts = [...s.counts];
  for (const k of use.kinds) counts[k]!--;
  // A kong takes a replacement tile instead of discarding: the hand is already waiting-size.
  return use.type === "kong" ? shape(counts, s.melds + 1, s.unseen) : bestAfterDiscard(counts, s.melds + 1, s.unseen);
}

/** Would this tile complete our hand? */
export function winsWith(s: Situation, tile: TileId): boolean {
  const k = kindOf(tile);
  s.counts[k]!++;
  const win = shanten(s.counts, s.melds) === -1;
  s.counts[k]!--;
  return win;
}

/** Throw away first: isolated honours, then terminals, then the rest. Higher = throw sooner. */
export function throwPriority(kind: TileKind): number {
  if (isHonor(kind)) return 2;
  if (isTerminal(kind)) return 1;
  return 0;
}
