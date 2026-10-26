import { isHonor, isTerminal, kindOf, rankOf, type PlayerView, type TileKind } from "@mahjong/engine";

/**
 * How close each opponent looks to winning, 0–1, from what's public: their locked sets plus their
 * complete concealed sets (everyone can see this count), and how late in the hand it is.
 *   4 sets: they only need a pair, so they're very likely waiting.
 *   3 sets: "one set from winning" — often one tile away.
 */
export function threats(view: PlayerView): number[] {
  const late = 1 - Math.min(1, view.wallCount / 84); // 0 at the start, 1 when the wall is empty
  return view.players.map((p) => {
    if (p.seat === view.seat) return 0;
    const sets = p.melds.length + p.concealedSets;
    const base = sets >= 4 ? 0.9 : sets === 3 ? 0.5 : sets === 2 ? 0.15 : 0.04;
    return Math.min(1, base * (0.75 + 0.5 * late));
  });
}

/**
 * Chance-like score (0–1) that discarding `kind` lets *someone* win. Per opponent: how dangerous the tile
 * is in general (middle tiles are easiest to wait on, honours hardest), scaled by how many copies are
 * still unseen (a kind whose copies are all visible can't be anyone's wait), lowered if they threw that
 * kind themselves, and weighted by how close they look to winning.
 */
export function danger(view: PlayerView, kind: TileKind, unseen: readonly number[], threat: readonly number[]): number {
  if (unseen[kind]! <= 0) return 0;
  const general = isHonor(kind) ? 0.45 : isTerminal(kind) ? 0.6 : rankOf(kind) === 2 || rankOf(kind) === 8 ? 0.8 : 1;
  const live = Math.sqrt(unseen[kind]! / 4);
  let safe = 1;
  for (const p of view.players) {
    if (threat[p.seat]! === 0) continue;
    const theyThrewIt = p.discards.some((t) => kindOf(t) === kind) ? 0.4 : 1;
    safe *= 1 - threat[p.seat]! * general * live * theyThrewIt;
  }
  return 1 - safe;
}
