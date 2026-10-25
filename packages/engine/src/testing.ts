import { createRng, shuffle } from "./rng";
import { COPIES_PER_KIND, NUM_KINDS, NUM_TILES, parseKinds, type TileId } from "./tiles";
import type { Seat } from "./types";

export interface StackedWall {
  /** Hands by seat, in tile notation. The dealer needs 14 tiles, everyone else 13. */
  hands: [string, string, string, string];
  dealer?: Seat;
  /** The next tiles drawn from the front of the wall, in order. */
  draws?: string;
  /** Kong replacement tiles drawn from the back of the wall, in order. */
  replacements?: string;
  /** Shuffles the leftover tiles. */
  seed?: number;
}

/**
 * Build a wall that deals exactly the given hands, for tests and debugging.
 * Pass the result to `startHand({ wall })`. Leftover tiles fill the middle of the wall in shuffled order.
 */
export function stackWall({ hands, dealer = 0, draws = "", replacements = "", seed = 1 }: StackedWall): TileId[] {
  const used = new Array<number>(NUM_KINDS).fill(0);
  const take = (notation: string): TileId[] =>
    parseKinds(notation).map((kind) => {
      if (used[kind]! >= COPIES_PER_KIND) throw new Error(`stackWall: more than 4 of kind ${kind}`);
      return kind * COPIES_PER_KIND + used[kind]!++;
    });

  const dealt: TileId[][] = hands.map(take);
  dealt.forEach((h, seat) => {
    const expected = seat === dealer ? 14 : 13;
    if (h.length !== expected) throw new Error(`stackWall: seat ${seat} has ${h.length} tiles, expected ${expected}`);
  });

  const front: TileId[] = [];
  for (let i = 0; i < 4; i++) front.push(...dealt[(dealer + i) % 4]!.slice(0, 13));
  front.push(dealt[dealer]![13]!);
  front.push(...take(draws));
  const back = take(replacements).reverse();

  const placed = new Set([...front, ...back]);
  const rest = shuffle(
    Array.from({ length: NUM_TILES }, (_, i) => i).filter((t) => !placed.has(t)),
    createRng(seed),
  );
  return [...front, ...rest, ...back];
}
