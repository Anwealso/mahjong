import type { Action, GameEvent, PlayerView, Seat } from "@mahjong/engine";
import { z } from "zod";

/**
 * Every message between browser and server. Client → server messages are validated with zod at the
 * socket boundary (never trust the client). Server → client messages are plain types.
 */

// ---- shared pieces ---------------------------------------------------------------------------------

const tileId = z.number().int().min(0).max(135);
export const seatSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

/** 4 letters, no I or O (they look like 1 and 0). */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z]{4}$/, "Room codes are 4 letters");

export const playerNameSchema = z.string().trim().min(1).max(20);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("discard"), tile: tileId }),
  z.object({ type: z.literal("selfDrawWin") }),
  z.object({ type: z.literal("concealedKong"), tiles: z.array(tileId).length(4) }),
  z.object({ type: z.literal("addedKong"), tile: tileId }),
  z.object({ type: z.literal("claim") }),
  z.object({ type: z.literal("pass") }),
  z.object({ type: z.literal("win") }),
  z.object({ type: z.literal("pung"), tiles: z.tuple([tileId, tileId]) }),
  z.object({ type: z.literal("kong"), tiles: z.tuple([tileId, tileId, tileId]) }),
  z.object({ type: z.literal("chow"), tiles: z.tuple([tileId, tileId]) }),
]);

// Compile-time guarantee that the schema and the engine's Action type stay identical.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const actionSchemaMatchesEngine: Equals<z.infer<typeof actionSchema>, Action> = true;
void actionSchemaMatchesEngine;

// ---- client → server -------------------------------------------------------------------------------

export const clientMessageSchema = z.discriminatedUnion("t", [
  /** Create a new room and join it. */
  z.object({ t: z.literal("createRoom"), name: playerNameSchema }),
  /** Join a room. With a `sessionToken` from an earlier `welcome`, reclaim that identity (and seat). */
  z.object({ t: z.literal("join"), room: roomCodeSchema, name: playerNameSchema, sessionToken: z.string().max(100).optional() }),
  z.object({ t: z.literal("takeSeat"), seat: seatSchema }),
  z.object({ t: z.literal("leaveSeat") }),
  /** Fill every empty seat with a random-move bot. A person taking a bot's seat replaces it. */
  z.object({ t: z.literal("addBots") }),
  /** Deal a new hand. Needs all four seats filled and no hand in progress. */
  z.object({ t: z.literal("startHand") }),
  /** `stateVersion` is the version of the state the player was looking at when they acted. */
  z.object({ t: z.literal("action"), action: actionSchema, stateVersion: z.number().int().min(0) }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---- server → client -------------------------------------------------------------------------------

export interface MemberInfo {
  id: string;
  name: string;
  seat: Seat | null;
  connected: boolean;
  bot: boolean;
}

export type ServerMessage =
  /** Sent once after createRoom/join. Store `sessionToken` to reconnect as the same member. */
  | { t: "welcome"; room: string; memberId: string; sessionToken: string }
  /** Sent to everyone in the room whenever membership, seats, or connection status change. */
  | { t: "lobby"; room: string; members: MemberInfo[]; seats: (string | null)[]; handInProgress: boolean }
  /**
   * Sent to each seated player after every change to the hand. A full snapshot: the client replaces
   * whatever it had. Echo `stateVersion` back with your next action.
   */
  | {
      t: "state";
      stateVersion: number;
      view: PlayerView;
      legalActions: Action[];
      /** What just happened, for animation. Already filtered for this seat. */
      events: GameEvent[];
      /** Milliseconds left in the claim window, or null when there's no window. */
      claimMsLeft: number | null;
    }
  | { t: "error"; code: ErrorCode; message: string };

export type ErrorCode =
  | "badMessage"
  | "noSuchRoom"
  | "notInRoom"
  | "seatTaken"
  | "handInProgress"
  | "notEnoughPlayers"
  | "notSeated"
  | "staleState"
  | "illegalAction";

/** Parse an incoming raw WebSocket message. */
export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const result = clientMessageSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
