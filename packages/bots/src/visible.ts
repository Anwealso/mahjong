import { countTiles, kindOf, NUM_KINDS, type PlayerView } from "@mahjong/engine";

/** Kinds in your concealed hand (34-slot counts). */
export const handCounts = (view: PlayerView): number[] => countTiles(view.hand);

/**
 * How many copies of each kind you *can't* see: 4 minus your hand, every pond, and every locked set.
 * These are the tiles that could still be drawn, or be in someone else's hand.
 */
export function unseenCounts(view: PlayerView): number[] {
  const unseen = new Array<number>(NUM_KINDS).fill(4);
  const see = (tile: number) => unseen[kindOf(tile)]!--;
  view.hand.forEach(see);
  for (const p of view.players) {
    p.discards.forEach(see);
    for (const m of p.melds) m.tiles.forEach(see);
  }
  // The tile on offer is still in its pond; a claimed tile is in its claimer's set.
  return unseen.map((n) => Math.max(0, n));
}
