import { nextSeat, type HandResult, type Seat, type Wind } from "./types";

/** One finished hand, for the scoreboard and the per-wind podium. */
export interface HandRecord {
  /** 1-based, counting every hand of the game. Cancelled hands aren't recorded. */
  handNumber: number;
  /** 1-based count of winds: wind 5 is East again. */
  windNumber: number;
  prevailingWind: Wind;
  dealer: Seat;
  result: HandResult;
}

/** Chosen by the host before a game starts; fixed for the whole game. See docs/game-flow.md. */
export interface GameSettings {
  /** Dealer keeps the deal after a dealer win or a draw. Off: the deal passes on after every hand. */
  dealerKeepsDeal: boolean;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = { dealerKeepsDeal: false };

/**
 * A whole game: dealer rotation, prevailing winds, and running scores per seat. Games are open-ended:
 * after each wind the players decide whether to continue (see docs/game-flow.md).
 */
export interface GameState {
  settings: GameSettings;
  /** Dealt first in the game. A wind ends when the deal passes back to this seat. */
  firstDealer: Seat;
  dealer: Seat;
  prevailingWind: Wind;
  windNumber: number;
  /** Number of the next hand to be dealt. */
  handNumber: number;
  /** Running totals per seat (scores belong to seats, not people). */
  scores: number[];
  history: HandRecord[];
}

export function newGame(firstDealer: Seat, settings: GameSettings = DEFAULT_GAME_SETTINGS): GameState {
  return {
    settings,
    firstDealer,
    dealer: firstDealer,
    prevailingWind: 0,
    windNumber: 1,
    handNumber: 1,
    scores: [0, 0, 0, 0],
    history: [],
  };
}

/**
 * Record a finished hand: add its payments, and rotate the deal. The deal passes on after every hand,
 * unless `dealerKeepsDeal` is set and the dealer won or the hand was a draw. `windOver` is true when the deal has passed all the way round
 * back to the first dealer, which moves the prevailing wind on (wrapping after North).
 */
export function recordHand(game: GameState, result: HandResult): { game: GameState; windOver: boolean } {
  const record: HandRecord = {
    handNumber: game.handNumber,
    windNumber: game.windNumber,
    prevailingWind: game.prevailingWind,
    dealer: game.dealer,
    result,
  };
  const keepsDeal = game.settings.dealerKeepsDeal && (result.kind === "draw" || result.winner === game.dealer);
  const dealer = keepsDeal ? game.dealer : nextSeat(game.dealer);
  const windOver = !keepsDeal && dealer === game.firstDealer;
  return {
    windOver,
    game: {
      ...game,
      dealer,
      prevailingWind: windOver ? (((game.prevailingWind + 1) % 4) as Wind) : game.prevailingWind,
      windNumber: windOver ? game.windNumber + 1 : game.windNumber,
      handNumber: game.handNumber + 1,
      scores: game.scores.map((s, seat) => s + result.payments[seat]!),
      history: [...game.history, record],
    },
  };
}

/** Points each seat won during one wind. */
export function windScores(game: GameState, windNumber: number): number[] {
  const totals = [0, 0, 0, 0];
  for (const h of game.history) {
    if (h.windNumber === windNumber) h.result.payments.forEach((p, seat) => (totals[seat]! += p));
  }
  return totals;
}

/** 1-based place for each seat, highest score first. Tied seats share a place ("1, 1, 3, 4"). */
export function places(scores: readonly number[]): number[] {
  return scores.map((s) => 1 + scores.filter((other) => other > s).length);
}
