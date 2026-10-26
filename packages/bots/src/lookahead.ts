import {
  countTiles,
  kindOf,
  maxConcealedSets,
  NUM_KINDS,
  NUM_TILES,
  shuffle,
  type PlayerView,
  type Rng,
  type TileKind,
} from "@mahjong/engine";
import { throwPriority } from "./evaluate";
import { shanten } from "./shanten";
import { couldHelp } from "./ukeire";

/**
 * Monte Carlo lookahead for discards. For each sample we deal the hidden tiles at random (consistent
 * with what's public, including each opponent's complete-set count), then play the rest of the hand out
 * quickly once per candidate discard, on the *same* sampled world so candidates are compared fairly.
 * The candidate with the best average result wins.
 *
 * Playouts are simplified to stay fast: nobody claims sets (only wins), and players keep a drawn tile
 * only if it improves their hand. Results are in points for us: +3 self-draw, +1 win on a discard,
 * -1 when we deal in, -1 when someone else self-draws.
 */
export interface LookaheadOptions {
  random: Rng;
  /** Stop after this many sampled worlds… */
  samples: number;
  /** …or after this long, whichever comes first (none = no time limit; tests and the arena use none). */
  budgetMs?: number;
  now?: () => number;
}

export function lookahead(view: PlayerView, candidates: TileKind[], options: LookaheadOptions): number[] {
  const totals = candidates.map(() => 0);
  const start = options.now?.() ?? 0;
  let samples = 0;
  for (; samples < options.samples; samples++) {
    if (options.budgetMs !== undefined && options.now && options.now() - start > options.budgetMs) break;
    const world = sampleWorld(view, options.random);
    candidates.forEach((kind, i) => (totals[i]! += playout(view, world, kind)));
  }
  return totals.map((t) => (samples ? t / samples : 0));
}

interface World {
  /** Concealed counts per seat (ours is the real hand). */
  hands: number[][];
  /** Remaining wall, in draw order, as kinds. */
  wall: TileKind[];
}

/** Deal the tiles we can't see: opponents' hands (matching their public set counts if we can), then the wall. */
function sampleWorld(view: PlayerView, random: Rng): World {
  const visible = new Set<number>(view.hand);
  for (const p of view.players) {
    p.discards.forEach((t) => visible.add(t));
    p.melds.forEach((m) => m.tiles.forEach((t) => visible.add(t)));
  }
  const hidden: number[] = [];
  for (let t = 0; t < NUM_TILES; t++) if (!visible.has(t)) hidden.push(t);

  for (let attempt = 0; ; attempt++) {
    const pool = shuffle(hidden, random);
    const hands: number[][] = [];
    let at = 0;
    let consistent = true;
    for (const p of view.players) {
      if (p.seat === view.seat) {
        hands[p.seat] = countTiles(view.hand);
        continue;
      }
      const tiles = pool.slice(at, at + p.handCount);
      at += p.handCount;
      hands[p.seat] = countTiles(tiles);
      if (maxConcealedSets(hands[p.seat]!) !== p.concealedSets) consistent = false;
    }
    // Rejection sampling: respect the public set counts, but don't spin forever on unlikely ones.
    if (consistent || attempt >= 20) return { hands, wall: pool.slice(at).map(kindOf) };
  }
}

interface SimPlayer {
  counts: number[];
  melds: number;
  shanten: number;
  /** Kinds that would lower shanten (for 0-shanten hands, these are the winning tiles). */
  accepts: boolean[];
}

function simPlayer(counts: number[], melds: number): SimPlayer {
  const p: SimPlayer = { counts, melds, shanten: 0, accepts: [] };
  refresh(p);
  return p;
}

function refresh(p: SimPlayer) {
  p.shanten = shanten(p.counts, p.melds);
  p.accepts = new Array<boolean>(NUM_KINDS).fill(false);
  for (let k = 0; k < NUM_KINDS; k++) {
    if (p.counts[k]! >= 4 || !couldHelp(p.counts, k)) continue;
    p.counts[k]!++;
    if (shanten(p.counts, p.melds) < p.shanten) p.accepts[k] = true;
    p.counts[k]!--;
  }
}

/** Discard the tile whose loss hurts least (fewest tiles from ready, then honours/terminals first). */
function greedyDiscard(p: SimPlayer): TileKind {
  let best = -1;
  let bestShanten = Infinity;
  for (let k = 0; k < NUM_KINDS; k++) {
    if (p.counts[k] === 0) continue;
    p.counts[k]!--;
    const s = shanten(p.counts, p.melds);
    p.counts[k]!++;
    if (s < bestShanten || (s === bestShanten && throwPriority(k) > throwPriority(best))) {
      best = k;
      bestShanten = s;
    }
  }
  return best;
}

/** Play the rest of the hand after we discard `first`. Returns our points. */
function playout(view: PlayerView, world: World, first: TileKind): number {
  const me = view.seat;
  const players = view.players.map((p) => simPlayer([...world.hands[p.seat]!], p.melds.length));
  players[me]!.counts[first]!--;
  refresh(players[me]!);

  // Someone discards `kind`: the first player round from them who can win on it does.
  const ronFrom = (discarder: number, kind: TileKind): number => {
    for (let d = 1; d < 4; d++) {
      const q = (discarder + d) % 4;
      if (players[q]!.shanten === 0 && players[q]!.accepts[kind]) {
        if (q === me) return 1;
        return discarder === me ? -1 : 0;
      }
    }
    return NaN;
  };

  const settled = ronFrom(me, first);
  if (!Number.isNaN(settled)) return settled;

  let seat = (me + 1) % 4;
  for (const drawn of world.wall) {
    const p = players[seat]!;
    if (p.shanten === 0 && p.accepts[drawn]) return seat === me ? 3 : -1; // self-draw
    let discard = drawn;
    if (p.accepts[drawn]) {
      p.counts[drawn]!++;
      discard = greedyDiscard(p);
      p.counts[discard]!--;
      refresh(p);
    }
    const result = ronFrom(seat, discard);
    if (!Number.isNaN(result)) return result;
    seat = (seat + 1) % 4;
  }
  return 0; // the wall ran out
}
