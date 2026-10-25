import type { RuleConfig } from "./rules";
import type { TileId, TileKind } from "./tiles";

/** Seat index. Turn order is 0 → 1 → 2 → 3 → 0. */
export type Seat = 0 | 1 | 2 | 3;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];

/** 0 East, 1 South, 2 West, 3 North. */
export type Wind = 0 | 1 | 2 | 3;

export const nextSeat = (seat: Seat): Seat => ((seat + 1) % 4) as Seat;
/** The dealer is always East; seat winds follow turn order from there. */
export const seatWind = (seat: Seat, dealer: Seat): Wind => ((seat - dealer + 4) % 4) as Wind;

/** A declared set. Once declared it's locked: its tiles can't be discarded or reused. */
export interface Meld {
  type: "chow" | "pung" | "kong";
  tiles: TileId[];
  /** True only for a concealed kong (declared from four tiles in hand). */
  concealed: boolean;
  /** The discard this set was claimed from, if any. */
  claimed: { tile: TileId; from: Seat } | null;
}

export interface PlayerState {
  /** Concealed tiles, sorted. */
  hand: TileId[];
  melds: Meld[];
  /** This player's discard pond, oldest first. A claimed discard is removed from here. */
  discards: TileId[];
}

export type Action =
  // On your turn
  | { type: "discard"; tile: TileId }
  | { type: "selfDrawWin" }
  | { type: "concealedKong"; kind: TileKind }
  | { type: "addedKong"; tile: TileId }
  // In a claim window
  | { type: "pass" }
  | { type: "win" }
  | { type: "pung" }
  | { type: "kong" }
  /** `tiles` are the two hand tiles that complete the run with the discard. */
  | { type: "chow"; tiles: [TileId, TileId] };

/** What opened the claim window: a normal discard, or a tile added to a pung (only claimable to rob the kong). */
export type ClaimSource = "discard" | "addedKong";

export type Phase =
  /** `seat` must discard (or declare a kong / self-drawn win). `drew` = they got here by drawing, not by claiming. */
  | { kind: "awaitDiscard"; seat: Seat; drew: boolean }
  /**
   * Other seats may claim `tile`. `responses[seat]` is null while that seat is still deciding.
   * The source seat and seats with nothing to claim are pre-filled with a pass.
   */
  | { kind: "claimWindow"; source: ClaimSource; from: Seat; tile: TileId; responses: (Action | null)[] }
  | { kind: "handOver"; result: HandResult };

export type HandResult =
  | {
      kind: "win";
      winners: Seat[];
      tile: TileId;
      selfDraw: boolean;
      /** Who paid for a discard win: the discarder, or the player whose kong was robbed. Null for self-draw. */
      from: Seat | null;
      robbedKong: boolean;
      /** Point change per seat; sums to 0. */
      payments: number[];
    }
  | { kind: "draw"; payments: number[] };

/** The full, secret state of one hand. Lives on the server only. */
export interface HandState {
  rules: RuleConfig;
  seed: number;
  dealer: Seat;
  prevailingWind: Wind;
  /** Remaining wall. Normal draws from the front, kong replacements from the back. */
  wall: TileId[];
  players: PlayerState[];
  phase: Phase;
  /** The tile the current turn seat just drew, if they drew. */
  lastDrawn: TileId | null;
}

export type GameEvent =
  | { type: "dealt" }
  /** `tile` is null in other seats' projections. */
  | { type: "drew"; seat: Seat; tile: TileId | null; replacement: boolean }
  | { type: "discarded"; seat: Seat; tile: TileId }
  /** A set claimed from a discard, or a concealed kong. */
  | { type: "melded"; seat: Seat; meld: Meld }
  | { type: "kongAdded"; seat: Seat; tile: TileId }
  | { type: "claimWindowOpened"; source: ClaimSource; from: Seat; tile: TileId }
  | { type: "handOver"; result: HandResult };

export type ApplyResult =
  | { ok: true; state: HandState; events: GameEvent[] }
  | { ok: false; error: string };
