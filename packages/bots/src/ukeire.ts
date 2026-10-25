import { NUM_KINDS } from "@mahjong/engine";
import { shanten } from "./shanten";

/**
 * Ukeire: for a hand waiting to draw (3n+1 tiles), how many unseen tiles would lower its shanten, and
 * which kinds they are. More is better: more ways to improve.
 */
export function ukeire(counts: number[], lockedMelds: number, unseen: readonly number[]): { tiles: number; kinds: number[] } {
  const base = shanten(counts, lockedMelds);
  const kinds: number[] = [];
  let tiles = 0;
  for (let k = 0; k < NUM_KINDS; k++) {
    if (unseen[k]! <= 0) continue;
    counts[k]!++;
    if (shanten(counts, lockedMelds) < base) {
      kinds.push(k);
      tiles += unseen[k]!;
    }
    counts[k]!--;
  }
  return { tiles, kinds };
}
