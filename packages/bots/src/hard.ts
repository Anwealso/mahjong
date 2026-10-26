import type { Action, PlayerView } from "@mahjong/engine";
import { danger, threats } from "./danger";
import { throwPriority, type DiscardOption, type Situation } from "./evaluate";
import { lookahead } from "./lookahead";
import { decide, type DiscardRanker } from "./medium";
import type { Policy } from "./policy";

export interface HardOptions {
  /** Randomness for the lookahead's sampling. */
  random?: () => number;
  /** Lookahead: sampled worlds per discard decision (0 = no lookahead). */
  samples?: number;
  /** Lookahead: stop sampling after this long (the server sets this; the arena uses `samples` only). */
  budgetMs?: number;
  now?: () => number;
  /** How many of the best-ranked discards the lookahead compares. */
  candidates?: number;
  /** How much safety counts against speed at [far from ready (threatened), far, one away, ready]. */
  caution?: readonly [number, number, number, number];
}

/**
 * Tuned in the arena against three Mediums (same seat, same deals). Folding hard when far from ready and
 * someone is one set away, plus a light preference for safe tiles when one tile from ready, beat Medium
 * on fresh seeds: +0.034 points/hand, 14% fewer deal-ins. Caution in other situations made it worse:
 * Chicken Hand rounds are fast, so playing safe early mostly just loses speed.
 */
export const DEFAULT_CAUTION = [10, 0, 0.5, 0] as const;

/**
 * Hard: Medium's speed, plus defence. Each discard is scored on how much it keeps the hand moving
 * against how likely it is to hand someone a win; when an opponent looks close and our hand is far from
 * ready, it folds and throws the safest tiles.
 */
export function hardPolicy(options: HardOptions = {}): Policy {
  const defensive = defensiveRanking(options.caution ?? DEFAULT_CAUTION);
  const samples = options.samples ?? DEFAULT_SAMPLES;
  const rank: DiscardRanker = samples > 0 ? withLookahead(defensive, { ...options, samples }) : defensive;
  return (view: PlayerView, legal: Action[]) => decide(view, legal, rank);
}

/**
 * Off by default. In the arena (2,400 paired hands vs Medium) 40 samples per decision scored no better
 * than defence alone (+5 vs +31 points, within noise) at ~55 ms a decision: the simplified playouts are
 * too crude to beat the tuned heuristic. Kept as an experiment to improve on (better playout policy,
 * more samples); see docs/bots.md.
 */
export const DEFAULT_SAMPLES = 0;

/**
 * Re-order the best few discards by Monte Carlo lookahead. Only when the call is close enough to matter:
 * the candidates must all keep the hand equally close to ready.
 */
function withLookahead(base: DiscardRanker, options: HardOptions & { samples: number }): DiscardRanker {
  const random = options.random ?? Math.random;
  return (s, options_) => {
    const ranked = base(s, options_);
    const top = ranked.slice(0, options.candidates ?? 3).filter((o) => o.shanten === ranked[0]!.shanten);
    if (top.length < 2) return ranked;
    const scores = lookahead(s.view, top.map((o) => o.kind), {
      random,
      samples: options.samples,
      budgetMs: options.budgetMs,
      now: options.now,
    });
    // Stable: ties keep the heuristic's order.
    const order = top.map((o, i) => ({ o, score: scores[i]!, i })).sort((a, b) => b.score - a.score || a.i - b.i);
    return [...order.map((x) => x.o), ...ranked.filter((o) => !top.includes(o))];
  };
}

/** Medium's ranking, traded off against danger. */
export const defensiveRanking = (c: readonly [number, number, number, number]): DiscardRanker => (s: Situation, options: DiscardOption[]) => {
  const threat = threats(s.view);
  const biggest = Math.max(...threat);
  const fewest = Math.min(...options.map((o) => o.shanten));
  // How much we care about safety: a lot when far from ready, less when we're about to win ourselves.
  const caution = fewest >= 2 ? (biggest >= 0.45 ? c[0] : c[1]) : fewest === 1 ? c[2] : c[3];
  // A step in shanten is worth 10, ukeire at most a few points, so with no caution this ranks exactly like
  // Medium; caution 10+ lets safety cost a step from ready (folding).
  const score = (o: DiscardOption) =>
    -10 * o.shanten + o.ukeire / 20 + throwPriority(o.kind) / 100 - caution * danger(s.view, o.kind, s.unseen, threat);
  return [...options].sort((a, b) => score(b) - score(a));
};
