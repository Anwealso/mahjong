import { createRng, shuffle } from "./rng";
import { NUM_TILES, type TileId } from "./tiles";

/**
 * A freshly shuffled wall. Normal draws come from the front, kong replacement draws from the back.
 * The same seed always produces the same wall.
 */
export function buildWall(seed: number): TileId[] {
  const tiles = Array.from({ length: NUM_TILES }, (_, i) => i);
  return shuffle(tiles, createRng(seed));
}
