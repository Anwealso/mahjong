import type { RuleConfig } from "./rules";
import { canStartChow, isHonor, isTerminal, NUM_KINDS, type TileKind } from "./tiles";

export type Set =
  | { type: "pung"; kind: TileKind }
  | { type: "chow"; kind: TileKind }; // kind = lowest tile of the run

export interface Decomposition {
  pair: TileKind;
  sets: Set[];
}

/**
 * Every way to split the concealed tiles (as a 34-slot count array) into one pair plus sets.
 * The caller passes concealed tiles only; exposed melds are already complete sets.
 * Returns [] if the tiles don't form a standard winning shape.
 */
export function decompose(counts: readonly number[]): Decomposition[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total % 3 !== 2) return [];

  const work = [...counts];
  const results: Decomposition[] = [];
  for (let pair = 0; pair < NUM_KINDS; pair++) {
    if (work[pair]! < 2) continue;
    work[pair]! -= 2;
    for (const sets of decomposeSets(work, 0)) results.push({ pair, sets });
    work[pair]! += 2;
  }
  return results;
}

/** All ways to split `counts` (from index `from` up) entirely into pungs and chows. Mutates and restores `counts`. */
function decomposeSets(counts: number[], from: number): Set[][] {
  let i = from;
  while (i < NUM_KINDS && counts[i] === 0) i++;
  if (i === NUM_KINDS) return [[]];

  const results: Set[][] = [];
  // The lowest remaining tile must be the start of a pung or of a chow.
  if (counts[i]! >= 3) {
    counts[i]! -= 3;
    for (const rest of decomposeSets(counts, i)) results.push([{ type: "pung", kind: i }, ...rest]);
    counts[i]! += 3;
  }
  if (canStartChow(i) && counts[i + 1]! > 0 && counts[i + 2]! > 0) {
    counts[i]!--, counts[i + 1]!--, counts[i + 2]!--;
    for (const rest of decomposeSets(counts, i)) results.push([{ type: "chow", kind: i }, ...rest]);
    counts[i]!++, counts[i + 1]!++, counts[i + 2]!++;
  }
  return results;
}

export function isThirteenOrphans(counts: readonly number[]): boolean {
  let pairs = 0;
  for (let k = 0; k < NUM_KINDS; k++) {
    const orphan = isTerminal(k) || isHonor(k);
    const c = counts[k]!;
    if (!orphan && c > 0) return false;
    if (orphan && c === 0) return false;
    if (c === 2) pairs++;
    if (c > 2) return false;
  }
  return pairs === 1;
}

/** Seven distinct pairs (a kong-in-hand doesn't count as two pairs). */
export function isSevenPairs(counts: readonly number[]): boolean {
  return counts.filter((c) => c === 2).length === 7 && counts.every((c) => c === 0 || c === 2);
}

/**
 * Does this complete hand win? `counts` = concealed tiles including the winning tile.
 * Special hands only count when there are no exposed melds and the rule is enabled.
 */
export function isWinningHand(counts: readonly number[], exposedMelds: number, rules: RuleConfig): boolean {
  const concealed = counts.reduce((a, b) => a + b, 0);
  if (concealed + exposedMelds * 3 !== 14) return false;
  if (decompose(counts).length > 0) return true;
  if (exposedMelds === 0) {
    if (rules.thirteenOrphans && isThirteenOrphans(counts)) return true;
    if (rules.sevenPairs && isSevenPairs(counts)) return true;
  }
  return false;
}

/**
 * The most complete sets (pungs or chows) that can be made from these tiles, ignoring everything else.
 * This is the public "progress" shown to other players: complete sets only, never pairs or partial runs.
 */
export function maxConcealedSets(counts: readonly number[]): number {
  let total = 0;
  for (let k = 27; k < NUM_KINDS; k++) total += counts[k]! >= 3 ? 1 : 0; // honors: pungs only
  for (let suit = 0; suit < 3; suit++) total += suitSets(counts.slice(suit * 9, suit * 9 + 9));
  return total;
}

/** Best set count per suit pattern. Patterns repeat constantly and the answer never changes, so cache it. */
const suitSetsCache = new Map<string, number>();

function suitSets(counts: number[]): number {
  const key = counts.join("");
  let best = suitSetsCache.get(key);
  if (best === undefined) {
    best = maxSuitSets(counts, 0);
    suitSetsCache.set(key, best);
  }
  return best;
}

/** Best number of sets within one suit, from rank `i` up. At each rank, try every mix of pung and chows. */
function maxSuitSets(counts: number[], i: number): number {
  while (i < 9 && counts[i] === 0) i++;
  if (i >= 9) return 0;
  let best = 0;
  for (let pungs = 0; pungs <= (counts[i]! >= 3 ? 1 : 0); pungs++) {
    const left = counts[i]! - pungs * 3;
    const maxChows = i <= 6 ? Math.min(left, counts[i + 1]!, counts[i + 2]!) : 0;
    for (let chows = 0; chows <= maxChows; chows++) {
      const next = [...counts];
      next[i] = 0; // whatever's left at this rank is loose
      if (chows) (next[i + 1]! -= chows), (next[i + 2]! -= chows);
      best = Math.max(best, pungs + chows + maxSuitSets(next, i + 1));
    }
  }
  return best;
}

/**
 * Which kinds would complete this hand (13-tile shape, i.e. waiting)? Used for the "you're waiting on" hint.
 * A kind is excluded when the player already holds all four copies.
 */
export function waitingKinds(counts: readonly number[], exposedMelds: number, rules: RuleConfig): TileKind[] {
  const work = [...counts];
  const waits: TileKind[] = [];
  for (let k = 0; k < NUM_KINDS; k++) {
    if (work[k]! >= 4) continue;
    work[k]!++;
    if (isWinningHand(work, exposedMelds, rules)) waits.push(k);
    work[k]!--;
  }
  return waits;
}
