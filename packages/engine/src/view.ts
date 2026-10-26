import { clone } from "./clone";
import { countTiles, type TileId } from "./tiles";
import {
  SEATS,
  seatWind,
  type ClaimSource,
  type GameEvent,
  type HandResult,
  type HandState,
  type Meld,
  type Seat,
  type Wind,
} from "./types";
import { maxConcealedSets } from "./win";

/** What everyone at the table can see about a player. */
export interface PublicPlayer {
  seat: Seat;
  wind: Wind;
  handCount: number;
  /**
   * How many complete sets the server can find in this player's concealed tiles (best grouping). Shown
   * to everyone face-down; pairs, partial runs, and set types are never revealed.
   */
  concealedSets: number;
  melds: Meld[];
  discards: TileId[];
}

export type ViewPhase =
  | { kind: "awaitDiscard"; seat: Seat }
  /** `awaitingYou`: you can still claim or pass. Other seats' answers are never revealed. */
  | { kind: "claimWindow"; source: ClaimSource; from: Seat; tile: TileId; awaitingYou: boolean }
  /** `seat` claimed `tile` and is deciding how to use it. */
  | { kind: "claimed"; seat: Seat; from: Seat; tile: TileId }
  /**
   * At the end of a hand the hands are revealed: everyone's, or (with `revealHands` off) only yours and
   * the winner's. A hidden hand is `null`.
   */
  | { kind: "handOver"; result: HandResult; hands: (TileId[] | null)[] };

/** Everything one seat is allowed to know. This, never `HandState`, is what leaves the server. */
export interface PlayerView {
  seat: Seat;
  dealer: Seat;
  prevailingWind: Wind;
  wallCount: number;
  /** Your concealed tiles, sorted. */
  hand: TileId[];
  /** The tile you just drew, if it's your turn and you drew. */
  lastDrawn: TileId | null;
  players: PublicPlayer[];
  phase: ViewPhase;
}

export interface ViewOptions {
  /** Show every hand at the end of the hand, not just yours and the winner's. Default true. */
  revealHands?: boolean;
}

export function projectView(state: HandState, seat: Seat, options: ViewOptions = {}): PlayerView {
  const { phase } = state;
  let viewPhase: ViewPhase;
  if (phase.kind === "awaitDiscard") viewPhase = { kind: "awaitDiscard", seat: phase.seat };
  else if (phase.kind === "claimWindow") {
    viewPhase = {
      kind: "claimWindow",
      source: phase.source,
      from: phase.from,
      tile: phase.tile,
      awaitingYou: !phase.passed[seat],
    };
  } else if (phase.kind === "claimed") {
    viewPhase = { kind: "claimed", seat: phase.seat, from: phase.from, tile: phase.tile };
  } else {
    const { result } = phase;
    const shown = (s: Seat) => options.revealHands !== false || s === seat || (result.kind === "win" && s === result.winner);
    viewPhase = { kind: "handOver", result, hands: SEATS.map((s) => (shown(s) ? [...state.players[s]!.hand] : null)) };
  }

  return clone({
    seat,
    dealer: state.dealer,
    prevailingWind: state.prevailingWind,
    wallCount: state.wall.length,
    hand: state.players[seat]!.hand,
    lastDrawn: phase.kind === "awaitDiscard" && phase.seat === seat ? state.lastDrawn : null,
    players: SEATS.map((s) => ({
      seat: s,
      wind: seatWind(s, state.dealer),
      handCount: state.players[s]!.hand.length,
      concealedSets: maxConcealedSets(countTiles(state.players[s]!.hand)),
      melds: state.players[s]!.melds,
      discards: state.players[s]!.discards,
    })),
    phase: viewPhase,
  });
}

/** Strip what `seat` mustn't see from events (other players' drawn tiles). */
export function projectEvents(events: readonly GameEvent[], seat: Seat): GameEvent[] {
  return events.map((e) => (e.type === "drew" && e.seat !== seat ? { ...e, tile: null } : e));
}
