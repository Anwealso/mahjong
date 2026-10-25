import { clone } from "./clone";
import type { TileId } from "./tiles";
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

/** What everyone at the table can see about a player. */
export interface PublicPlayer {
  seat: Seat;
  wind: Wind;
  handCount: number;
  melds: Meld[];
  discards: TileId[];
}

export type ViewPhase =
  | { kind: "awaitDiscard"; seat: Seat }
  /** `awaitingYou`: you can still claim or pass. Other seats' answers are never revealed. */
  | { kind: "claimWindow"; source: ClaimSource; from: Seat; tile: TileId; awaitingYou: boolean }
  /** At the end of a hand every hand is revealed. */
  | { kind: "handOver"; result: HandResult; hands: TileId[][] };

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

export function projectView(state: HandState, seat: Seat): PlayerView {
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
  } else viewPhase = { kind: "handOver", result: phase.result, hands: state.players.map((p) => [...p.hand]) };

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
