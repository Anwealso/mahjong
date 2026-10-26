import type { Action, GameEvent, GameSettings, GameState, PlayerView, Seat } from "@mahjong/engine";
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

/** How well bots play (docs/bots.md). */
export const botLevelSchema = z.enum(["easy", "medium", "hard"]);
export type BotLevel = z.infer<typeof botLevelSchema>;

/** The room's settings: the game settings (fixed once a game starts) plus the level for new bots. */
export type RoomSettings = GameSettings & { botLevel: BotLevel };

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
  /** Create a new room and join it (as its host). */
  z.object({ t: z.literal("createRoom"), name: playerNameSchema }),
  /** Join a room. With a `sessionToken` from an earlier `welcome`, reclaim that identity (and seat). */
  z.object({ t: z.literal("join"), room: roomCodeSchema, name: playerNameSchema, sessionToken: z.string().max(100).optional() }),
  /**
   * Before a game: any free seat (or a bot's). During a game: a bot's seat while paused or at a wind
   * break, or your own seat back from the bot keeping it for you.
   */
  z.object({ t: z.literal("takeSeat"), seat: seatSchema }),
  /**
   * Leave the room for good (your seat is given up as with leaveSeat). If you're the host, hosting passes
   * to another person; with no other person left, the room is closed.
   */
  z.object({ t: z.literal("leaveRoom") }),
  /** Give up your seat. At a wind break a bot takes it over; otherwise it's left empty for the host. */
  z.object({ t: z.literal("leaveSeat") }),
  /** Watcher, during a game: ask the host to let you play. */
  z.object({ t: z.literal("requestSeat") }),
  /** Between hands. */
  z.object({ t: z.literal("ready") }),
  /** Between hands: pause the game in the lobby. */
  z.object({ t: z.literal("returnToLobby") }),
  /** At a wind break: vote to play the next wind. */
  z.object({ t: z.literal("voteContinue") }),
  // Host only:
  /** Fill every empty seat with a random-move bot (before a game, or while paused). */
  z.object({ t: z.literal("addBots") }),
  z.object({ t: z.literal("removeMember"), memberId: z.string().max(20) }),
  /** Hand an empty, offline, or idle seat to a bot (during a hand or between hands). */
  z.object({ t: z.literal("replaceWithBot"), seat: seatSchema }),
  /** Throw away the hand being played and pause in the lobby. */
  z.object({ t: z.literal("cancelHand") }),
  z.object({ t: z.literal("answerRequest"), memberId: z.string().max(20), approve: z.boolean() }),
  /**
   * Change settings (only the ones given). Game settings only before a game; the bot level also while
   * paused (it changes every bot in the room).
   */
  z.object({
    t: z.literal("updateSettings"),
    settings: z.object({ dealerKeepsDeal: z.boolean(), botLevel: botLevelSchema }).partial(),
  }),
  /** Change one bot's level (before a game, or while paused). */
  z.object({ t: z.literal("setBotLevel"), seat: seatSchema, level: botLevelSchema }),
  /** Needs all four seats filled. The first dealer is random. */
  z.object({ t: z.literal("startGame") }),
  z.object({ t: z.literal("resumeGame") }),
  /** After the game is over: back to the lobby with scores reset. */
  z.object({ t: z.literal("newGame") }),
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
  /** For bots: how well it plays. */
  botLevel: BotLevel | null;
}

/**
 * Where the room is (see docs/game-flow.md): `lobby` (no game), `hand` (playing), `handOver` (ready-up
 * between hands), `paused` (game held in the lobby), `windBreak` (end-of-wind vote), `gameOver`.
 */
export type RoomPhase = "lobby" | "hand" | "handOver" | "paused" | "windBreak" | "gameOver";

/** Why a seat isn't being played during a game. The host is prompted to deal with it. */
export type SeatIssue = "empty" | "offline" | "idle";

export interface SeatInfo {
  issue: SeatIssue | null;
  /** A bot is keeping this seat for this member, who can take it back. */
  reservedFor: string | null;
  /** Between hands: ready for the next (bots always are). */
  ready: boolean;
  /** At a wind break: voted to continue. */
  voted: boolean;
}

/** Sent to everyone in the room whenever anything outside the hand itself changes. */
export interface LobbyMessage {
  t: "lobby";
  room: string;
  hostId: string | null;
  phase: RoomPhase;
  members: MemberInfo[];
  /** Member id in each seat. */
  seats: (string | null)[];
  seatInfo: SeatInfo[];
  /** Game settings for the next game (the current one copied them when it started), and the bot level. */
  settings: RoomSettings;
  /** Dealer, wind, running scores per seat, and every finished hand. Null before a game starts. */
  game: GameState | null;
  /** Between hands: time left before the next hand is dealt anyway. Null while the countdown is stopped. */
  readyMsLeft: number | null;
  /** At a wind break: time until the host may remove people who haven't voted (0 = now). */
  voteRemoveMsLeft: number | null;
  /** Watchers asking to play, oldest first. */
  requests: { id: string; name: string }[];
}

export type ServerMessage =
  /** Sent once after createRoom/join. Store `sessionToken` to reconnect as the same member. */
  | { t: "welcome"; room: string; memberId: string; sessionToken: string }
  | LobbyMessage
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
  | { t: "error"; code: ErrorCode; message: string }
  /** The server is about to restart (e.g. a deploy). Games in progress will be lost. */
  | { t: "serverRestarting" };

export type ErrorCode =
  | "badMessage"
  | "noSuchRoom"
  | "notInRoom"
  | "seatTaken"
  | "handInProgress"
  | "notEnoughPlayers"
  | "notSeated"
  | "staleState"
  | "illegalAction"
  | "notHost"
  | "notAllowed"
  | "serverFull"
  | "roomFull"
  | "rateLimited";

/** Parse an incoming raw WebSocket message. */
export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const result = clientMessageSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
