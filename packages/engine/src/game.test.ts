import { describe, expect, it } from "vitest";
import { newGame, places, recordHand, windScores, type GameState } from "./game";
import type { HandResult, Seat } from "./types";
import { scoreWin } from "./scoring";

const win = (winner: Seat, from: Seat | null): HandResult => ({
  kind: "win",
  winner,
  tile: 0,
  selfDraw: from === null,
  from,
  robbedKong: false,
  payments: scoreWin(winner, from === null, from),
});
const draw: HandResult = { kind: "draw", payments: [0, 0, 0, 0] };

function play(game: GameState, ...results: HandResult[]) {
  let windOver = false;
  for (const r of results) ({ game, windOver } = recordHand(game, r));
  return { game, windOver };
}

describe("game", () => {
  it("keeps the deal after a dealer win or a draw, passes it otherwise", () => {
    const g = newGame(2);
    expect(play(g, win(2, 0)).game.dealer).toBe(2);
    expect(play(g, draw).game.dealer).toBe(2);
    expect(play(g, win(1, null)).game.dealer).toBe(3);
  });

  it("ends a wind when the deal passes back to the first dealer, wrapping after North", () => {
    let g = newGame(1);
    // 1 → 2 → 3 → 0 → 1, with a dealer repeat and a draw along the way: 6 hands.
    let r = play(g, win(0, 1), win(2, 3), draw, win(1, null), win(0, 2));
    expect(r.windOver).toBe(false);
    expect(r.game.dealer).toBe(0);
    r = play(r.game, win(3, 0));
    expect(r.windOver).toBe(true);
    expect(r.game).toMatchObject({ dealer: 1, prevailingWind: 1, windNumber: 2, handNumber: 7 });

    g = r.game;
    for (let wind = 0; wind < 3; wind++) g = play(g, win(2, 1), win(3, 2), win(0, 3), win(1, 0)).game;
    expect(g).toMatchObject({ prevailingWind: 0, windNumber: 5 }); // East again
  });

  it("keeps running scores per seat and per wind", () => {
    const { game } = play(newGame(0), win(1, null), win(2, 1), win(3, 2), win(0, 3), win(0, 1));
    // Hands 1–4 are the East wind (self-draw by 1, then three discard wins); hand 5 starts South.
    expect(game.scores).toEqual([1, 1, -1, -1]);
    expect(windScores(game, 1)).toEqual([0, 2, -1, -1]);
    expect(windScores(game, 2)).toEqual([1, -1, 0, 0]);
    expect(game.history.map((h) => h.dealer)).toEqual([0, 1, 2, 3, 0]);
  });

  it("gives tied seats the same place", () => {
    expect(places([3, 5, 3, -1])).toEqual([2, 1, 2, 4]);
  });
});
