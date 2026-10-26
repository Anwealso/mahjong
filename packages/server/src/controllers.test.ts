import type { PlayerView } from "@mahjong/engine";
import { describe, expect, it } from "vitest";
import { humanLikeDelay, type SeatUpdate } from "./controllers";

const update = (kind: string) => ({ view: { phase: { kind } } as unknown as PlayerView }) as SeatUpdate;

describe("bot timing", () => {
  it("is human-like and the same for every level: 0.8–2 s to claim, 1–2.5 s on its turn", () => {
    expect(humanLikeDelay(update("claimWindow"), () => 0)).toBe(800);
    expect(humanLikeDelay(update("claimWindow"), () => 0.999)).toBeCloseTo(1999, 0);
    expect(humanLikeDelay(update("awaitDiscard"), () => 0)).toBe(1000);
    expect(humanLikeDelay(update("claimed"), () => 0.999)).toBeCloseTo(2498.5, 0);
  });
});
