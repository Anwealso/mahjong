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
    if (unseen[k]! <= 0 || !couldHelp(counts, k)) continue;
    counts[k]!++;
    if (shanten(counts, lockedMelds) < base) {
      kinds.push(k);
      tiles += unseen[k]!;
    }
    counts[k]!--;
  }
  return { tiles, kinds };
}

/**
 * A drawn tile can only improve the hand if it can pair or run with something held: the same kind, or
 * (suited) a kind within two ranks in the same suit. Skipping the rest roughly halves the work.
 */
export function couldHelp(counts: readonly number[], k: number): boolean {
  if (counts[k]! > 0) return true;
  if (k >= 27) return false;
  const suitStart = k - (k % 9);
  for (let d = -2; d <= 2; d++) {
    const j = k + d;
    if (d !== 0 && j >= suitStart && j < suitStart + 9 && counts[j]! > 0) return true;
  }
  return false;
}
