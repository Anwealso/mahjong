import { randomInt, randomUUID } from "node:crypto";
import {
  applyAction,
  closeClaimWindow,
  DEFAULT_RULES,
  legalActions,
  projectEvents,
  projectView,
  SEATS,
  startHand,
  type Action,
  type GameEvent,
  type HandState,
  type RuleConfig,
  type Seat,
  type TileId,
} from "@mahjong/engine";
import type { ErrorCode, MemberInfo } from "@mahjong/protocol";
import {
  autopilotPolicy,
  HumanController,
  PolicyController,
  type Connection,
  type SeatController,
} from "./controllers";

export interface RoomOptions {
  /** How long a claim window stays open at most. */
  claimWindowMs: number;
  /** How long the autopilot waits before acting for a disconnected player. */
  autopilotDelayMs: number;
  rules?: RuleConfig;
  /** Tests only: deal this exact wall instead of a random one. */
  wallForNextHand?: () => TileId[] | undefined;
}

export const DEFAULT_ROOM_OPTIONS: RoomOptions = { claimWindowMs: 5000, autopilotDelayMs: 1000 };

export interface RoomError {
  code: ErrorCode;
  message: string;
}

interface Member {
  id: string;
  name: string;
  /** Secret: proves identity when reconnecting. Only ever sent to this member. */
  token: string;
  seat: Seat | null;
  connection: Connection | null;
}

const error = (code: ErrorCode, message: string): RoomError => ({ code, message });

/**
 * One table: lobby, seats, and the hand being played. All state changes go through here, one message at
 * a time, so claims are naturally first come, first served.
 */
export class Room {
  private readonly members = new Map<string, Member>();
  private readonly seats: (string | null)[] = [null, null, null, null];
  private readonly controllers: (SeatController | null)[] = [null, null, null, null];
  private hand: HandState | null = null;
  /** Bumped whenever something visible happens. Actions must quote the version they were made against. */
  private version = 0;
  private claimTimer: ReturnType<typeof setTimeout> | null = null;
  private claimDeadline: number | null = null;
  /** For tests and the idle sweep. */
  lastActivity = Date.now();

  constructor(
    readonly code: string,
    private readonly options: RoomOptions = DEFAULT_ROOM_OPTIONS,
  ) {}

  get handInProgress(): boolean {
    return this.hand !== null && this.hand.phase.kind !== "handOver";
  }

  get connectedCount(): number {
    return [...this.members.values()].filter((m) => m.connection).length;
  }

  // ---- membership ----------------------------------------------------------------------------------

  /** Join as a new member, or reconnect as an existing one by presenting their session token. */
  join(name: string, sessionToken: string | undefined, connection: Connection): string {
    this.lastActivity = Date.now();
    let member = sessionToken ? [...this.members.values()].find((m) => m.token === sessionToken) : undefined;
    if (member) {
      member.name = name;
      member.connection = connection;
    } else {
      member = { id: randomUUID().slice(0, 8), name, token: randomUUID(), seat: null, connection };
      this.members.set(member.id, member);
    }
    connection.send({ t: "welcome", room: this.code, memberId: member.id, sessionToken: member.token });

    // Back in their seat mid-hand: take over from the autopilot and catch up with a snapshot.
    if (member.seat !== null && this.hand) {
      this.setController(member.seat, new HumanController(connection));
      this.controllers[member.seat]!.update(this.updateFor(member.seat, []));
    }
    this.broadcastLobby();
    return member.id;
  }

  /** The connection closed. Ignored if the member has since reconnected on a newer connection. */
  disconnect(memberId: string, connection: Connection) {
    this.lastActivity = Date.now();
    const member = this.members.get(memberId);
    if (!member || member.connection !== connection) return;
    member.connection = null;
    if (member.seat !== null && this.hand) {
      this.setController(member.seat, this.autopilot(member.seat));
      this.controllers[member.seat]!.update(this.updateFor(member.seat, []));
    }
    this.broadcastLobby();
  }

  takeSeat(memberId: string, seat: Seat): RoomError | null {
    const member = this.members.get(memberId);
    if (!member) return error("notInRoom", "You're not in this room");
    if (this.handInProgress) return error("handInProgress", "Seats can't change during a hand");
    const holder = this.seats[seat];
    if (holder && holder !== memberId) return error("seatTaken", "That seat is taken");
    if (member.seat !== null) this.seats[member.seat] = null;
    this.seats[seat] = memberId;
    member.seat = seat;
    this.broadcastLobby();
    return null;
  }

  leaveSeat(memberId: string): RoomError | null {
    const member = this.members.get(memberId);
    if (!member) return error("notInRoom", "You're not in this room");
    if (this.handInProgress) return error("handInProgress", "Seats can't change during a hand");
    if (member.seat !== null) this.seats[member.seat] = null;
    member.seat = null;
    this.broadcastLobby();
    return null;
  }

  // ---- playing -------------------------------------------------------------------------------------

  startHand(memberId: string): RoomError | null {
    if (!this.members.has(memberId)) return error("notInRoom", "You're not in this room");
    if (this.handInProgress) return error("handInProgress", "A hand is already being played");
    if (this.seats.some((s) => s === null)) return error("notEnoughPlayers", "All four seats must be filled");

    const { state, events } = startHand({
      seed: randomInt(2 ** 32),
      rules: this.options.rules ?? DEFAULT_RULES,
      wall: this.options.wallForNextHand?.(),
    });
    for (const seat of SEATS) {
      const member = this.members.get(this.seats[seat]!)!;
      this.setController(seat, member.connection ? new HumanController(member.connection) : this.autopilot(seat));
    }
    this.broadcastLobbyAfter(() => this.commit(state, events));
    return null;
  }

  /** A player's action, from a socket (`memberId`) or an in-process controller (`seat`). */
  act(memberId: string, action: Action, stateVersion: number): RoomError | null {
    const member = this.members.get(memberId);
    if (!member) return error("notInRoom", "You're not in this room");
    if (member.seat === null) return error("notSeated", "Take a seat first");
    return this.submit(member.seat, action, stateVersion);
  }

  submit(seat: Seat, action: Action, stateVersion: number): RoomError | null {
    this.lastActivity = Date.now();
    if (!this.hand) return error("illegalAction", "No hand is being played");
    if (stateVersion !== this.version) return error("staleState", "The game moved on; try again");
    const result = applyAction(this.hand, seat, action);
    if (!result.ok) return error("illegalAction", result.error);
    if (result.state.phase.kind === "handOver") this.broadcastLobbyAfter(() => this.commit(result.state, result.events));
    else this.commit(result.state, result.events, seat);
    return null;
  }

  /** Stop timers and controllers (the room is being discarded). */
  dispose() {
    this.clearClaimTimer();
    for (const seat of SEATS) this.setController(seat, null);
  }

  // ---- internals -----------------------------------------------------------------------------------

  /** `actor`: the seat whose action caused this change, if any. */
  private commit(state: HandState, events: GameEvent[], actor?: Seat) {
    this.hand = state;
    // A pass inside a claim window changes nothing anyone else can see: don't bump the version (so it never
    // makes another player's pending claim stale) and only tell the player who passed.
    if (events.length === 0 && actor !== undefined) {
      this.controllers[actor]?.update(this.updateFor(actor, events));
      return;
    }

    this.version++; // before starting a claim timer, which remembers the version it belongs to
    if (state.phase.kind !== "claimWindow") this.clearClaimTimer();
    else if (events.some((e) => e.type === "claimWindowOpened")) this.startClaimTimer();
    for (const seat of SEATS) this.controllers[seat]?.update(this.updateFor(seat, events));
  }

  private startClaimTimer() {
    this.clearClaimTimer();
    const version = this.version;
    this.claimDeadline = Date.now() + this.options.claimWindowMs;
    this.claimTimer = setTimeout(() => {
      this.claimTimer = null;
      if (this.version !== version || !this.hand) return;
      const result = closeClaimWindow(this.hand);
      if (!result.ok) return;
      if (result.state.phase.kind === "handOver") this.broadcastLobbyAfter(() => this.commit(result.state, result.events));
      else this.commit(result.state, result.events);
    }, this.options.claimWindowMs);
  }

  private clearClaimTimer() {
    if (this.claimTimer) clearTimeout(this.claimTimer);
    this.claimTimer = null;
    this.claimDeadline = null;
  }

  private updateFor(seat: Seat, events: GameEvent[]) {
    const hand = this.hand!;
    return {
      stateVersion: this.version,
      view: projectView(hand, seat),
      legalActions: legalActions(hand, seat),
      events: projectEvents(events, seat),
      claimMsLeft: this.claimDeadline === null ? null : Math.max(0, this.claimDeadline - Date.now()),
    };
  }

  private setController(seat: Seat, controller: SeatController | null) {
    this.controllers[seat]?.dispose();
    this.controllers[seat] = controller;
  }

  private autopilot(seat: Seat): SeatController {
    return new PolicyController(
      autopilotPolicy,
      (action, stateVersion) => this.submit(seat, action, stateVersion),
      this.options.autopilotDelayMs,
    );
  }

  /** Run a change that may start or end a hand, then tell everyone the lobby's `handInProgress` changed. */
  private broadcastLobbyAfter(change: () => void) {
    change();
    this.broadcastLobby();
  }

  private broadcastLobby() {
    const members: MemberInfo[] = [...this.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      seat: m.seat,
      connected: m.connection !== null,
    }));
    const message = {
      t: "lobby" as const,
      room: this.code,
      members,
      seats: [...this.seats],
      handInProgress: this.handInProgress,
    };
    for (const m of this.members.values()) m.connection?.send(message);
  }
}
