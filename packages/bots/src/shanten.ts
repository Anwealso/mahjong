import { NUM_KINDS } from "@mahjong/engine";

/**
 * Shanten: how many tiles a hand is from being ready. -1 = complete, 0 = ready (waiting), 1 = one tile
 * from ready, and so on. Standard shape only (4 sets + a pair; locked melds count as sets).
 *
 * The classic formula: with N sets still needed, shanten = 2N - 2·sets - partials - pair, counting at
 * most N sets + partials in total. A partial is two tiles one tile short of a set (a pair, 4-5, 4-6).
 * We find the best split per suit (cached, since suit patterns repeat endlessly), then combine.
 */
export function shanten(counts: readonly number[], lockedMelds: number): number {
  const needed = 4 - lockedMelds;
  const groups = [suitOptions(counts, 0, 9, true), suitOptions(counts, 9, 18, true), suitOptions(counts, 18, 27, true), suitOptions(counts, 27, NUM_KINDS, false)];
  let best = Infinity;
  // Either no pair, or exactly one group supplies the pair.
  for (let pairGroup = -1; pairGroup < 4; pairGroup++) {
    best = Math.min(best, combine(groups, pairGroup, needed));
  }
  return best;
}

type Option = readonly [sets: number, partials: number];
interface GroupOptions {
  withoutPair: Option[];
  withPair: Option[];
}

function combine(groups: GroupOptions[], pairGroup: number, needed: number): number {
  let best = Infinity;
  const walk = (i: number, sets: number, partials: number) => {
    if (i === groups.length) {
      const s = Math.min(sets, needed);
      const p = Math.min(partials, needed - s);
      best = Math.min(best, 2 * needed - 2 * s - p - (pairGroup >= 0 ? 1 : 0));
      return;
    }
    const options = i === pairGroup ? groups[i]!.withPair : groups[i]!.withoutPair;
    for (const [s, p] of options) walk(i + 1, sets + s, partials + p);
  };
  walk(0, 0, 0);
  return best;
}

const suitCache = new Map<number, GroupOptions>();
const honourCache = new Map<number, GroupOptions>();

/**
 * Every useful (sets, partials) split of one suit, `counts[from..to)` (or the honours, which can't make
 * runs). Keyed by the counts as a base-5 number: this runs millions of times in Hard's lookahead.
 */
function suitOptions(counts: readonly number[], from: number, to: number, runs: boolean): GroupOptions {
  let key = 0;
  for (let i = from; i < to; i++) key = key * 5 + counts[i]!;
  const cache = runs ? suitCache : honourCache;
  let cached = cache.get(key);
  if (!cached) {
    const slice = counts.slice(from, to);
    cached = { withoutPair: pareto(splits(slice, runs, false)), withPair: pareto(splits(slice, runs, true)) };
    cache.set(key, cached);
  }
  return cached;
}

/** All (sets, partials) splits, optionally taking exactly one pair out as "the pair". */
function splits(counts: number[], runs: boolean, takePair: boolean): Option[] {
  const out: Option[] = [];
  const work = [...counts];
  const visit = (i: number, sets: number, partials: number, pairTaken: boolean) => {
    while (i < work.length && work[i] === 0) i++;
    if (i >= work.length) {
      if (pairTaken === takePair) out.push([sets, partials]);
      return;
    }
    const at = (d: number) => (runs && i + d < work.length ? work[i + d]! : 0);
    // Set: pung, or run.
    if (work[i]! >= 3) {
      work[i]! -= 3;
      visit(i, sets + 1, partials, pairTaken);
      work[i]! += 3;
    }
    if (at(1) > 0 && at(2) > 0) {
      work[i]!--, work[i + 1]!--, work[i + 2]!--;
      visit(i, sets + 1, partials, pairTaken);
      work[i]!++, work[i + 1]!++, work[i + 2]!++;
    }
    // The pair (once), or a pair as a partial.
    if (work[i]! >= 2) {
      work[i]! -= 2;
      if (takePair && !pairTaken) visit(i, sets, partials, true);
      visit(i, sets, partials + 1, pairTaken);
      work[i]! += 2;
    }
    // Partial runs: 4-5 and 4-6.
    for (const d of [1, 2]) {
      if (at(d) > 0) {
        work[i]!--, work[i + d]!--;
        visit(i, sets, partials + 1, pairTaken);
        work[i]!++, work[i + d]!++;
      }
    }
    // Or leave one tile of this kind loose.
    work[i]!--;
    visit(i, sets, partials, pairTaken);
    work[i]!++;
  };
  visit(0, 0, 0, false);
  return out;
}

/** Drop splits that another split beats on both counts. */
function pareto(options: Option[]): Option[] {
  const unique = [...new Map(options.map((o) => [o.join(","), o])).values()];
  return unique.filter(([s, p]) => !unique.some(([s2, p2]) => s2 >= s && p2 >= p && (s2 > s || p2 > p)));
}
