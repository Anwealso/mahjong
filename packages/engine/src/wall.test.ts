import { describe, expect, it } from "vitest";
import { NUM_TILES } from "./tiles";
import { buildWall } from "./wall";

describe("buildWall", () => {
  it("contains every tile exactly once", () => {
    const wall = buildWall(42);
    expect(wall).toHaveLength(NUM_TILES);
    expect(new Set(wall).size).toBe(NUM_TILES);
  });

  it("is deterministic per seed", () => {
    expect(buildWall(7)).toEqual(buildWall(7));
    expect(buildWall(7)).not.toEqual(buildWall(8));
  });
});
