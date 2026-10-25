import { SEATS, type Seat } from "./types";

/** Chicken Hand: every win is worth the same flat amount. Kongs pay nothing. */
export const POINTS_PER_WIN = 1;

/**
 * Point changes per seat for a win.
 * Discard win (or robbed kong): `payer` pays each winner. Self-draw: the other three each pay the winner.
 */
export function scoreWin(winners: readonly Seat[], selfDraw: boolean, payer: Seat | null): number[] {
  const payments = [0, 0, 0, 0];
  for (const winner of winners) {
    const payers = selfDraw ? SEATS.filter((s) => s !== winner) : [payer!];
    for (const p of payers) {
      payments[p]! -= POINTS_PER_WIN;
      payments[winner]! += POINTS_PER_WIN;
    }
  }
  return payments;
}
