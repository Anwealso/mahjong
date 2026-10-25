import { randomInt, randomUUID } from "node:crypto";
import {
  applyAction,
  closeClaimWindow,
  DEFAULT_RULES,
  legalActions,
  newGame,
  projectEvents,
  projectView,
  recordHand,
  SEATS,
  startHand,
  type Action,
  type GameEvent,
  type GameState,
  type HandState,
  type RuleConfig,
  type Seat,
  type TileId,
} from "@mahjong/engine";
import type { ErrorCode, LobbyMessage, MemberInfo, RoomPhase, SeatIssue, SeatInfo } from "@mahjong/protocol";
import { HumanController, PolicyController, randomPolicy, type Connection, type SeatController } from "./controllers";

export interface RoomOptions {
  /** How long a claim window stays open at most. */
  claimWindowMs: number;
  /** How long a bot waits before acting. */
  botDelayMs: number;
  /** Countdown between hands before the next one is dealt anyway. */
  readyMs: number;
  /** How long a person can sit on a decision before the host may replace them. */
  idleMs: number;
  /** How long after a wind break starts the host may remove people who haven't voted. */
  voteRemoveMs: number;
  rules?: RuleConfig;
  /** Tests only: deal this exact wall (given who deals) instead of a random one. */
  wallForNextHand?: (dealer: Seat) => TileId[] | undefined;
  /** Tests only: who deals first (normally random). */
  firstDealer?: () => Seat;
}

export const DEFAULT_ROOM_OPTIONS: RoomOptions = {
  claimWindowMs: 5000,
  botDelayMs: 1500,
  readyMs: 10_000,
  idleMs: 60_000,
  voteRemoveMs: 30_000,
};

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
  /** A server-side bot: never connected, plays its seat with a policy. */
  bot: boolean;
}

/** A seat a bot is keeping for the person it replaced, who can take it back. */
interface Reservation {
  memberId: string;
  /** "offline": they get it back automatically on reconnecting. "idle": they click to take it back. */
  reason: "offline" | "idle";
}

const error = (code: ErrorCode, message: string): RoomError => ({ code, message });
const EMPTY = <T>(value: T): T[] => [value, value, value, value];

/**
 * One table: lobby, seats, the game (a run of hands with rotating dealer and running scores), and the
 * hand being played. All changes go through here one message at a time, so claims are naturally first
 * come, first served. The flow is specified in docs/game-flow.md.
 */
export class Room {
  private readonly members = new Map<string, Member>();
  private readonly seats: (string | null)[] = EMPTY(null);
  private readonly controllers: (SeatController | null)[] = EMPTY(null);
  private readonly reserved: (Reservation | null)[] = EMPTY(null);
  private hostId: string | null = null;
  private phase: RoomPhase = "lobby";
  private game: GameState | null = null;
  private hand: HandState | null = null;
  /** Bumped whenever something visible happens. Actions must quote the version they were made against. */
  private version = 0;
  private claimTimer: ReturnType<typeof setTimeout> | null = null;
  private claimDeadline: number | null = null;
  /** The seat that has been sitting on a decision for `idleMs`. */
  private idleSeat: Seat | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private ready: boolean[] = EMPTY(false);
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private readyDeadline: number | null = null;
  private votes: boolean[] = EMPTY(false);
  private windBreakAt = 0;
  /** Watchers asking the host to let them play (member ids, oldest first). */
  private requests: string[] = [];
  /** For tests and the idle sweep. */
  lastActivity = Date.now();

  constructor(
    readonly code: string,
    private readonly options: RoomOptions = DEFAULT_ROOM_OPTIONS,
  ) {}

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
      member = { id: randomUUID().slice(0, 8), name, token: randomUUID(), seat: null, connection, bot: false };
      this.members.set(member.id, member);
    }
    this.hostId ??= member.id;
    connection.send({ t: "welcome", room: this.code, memberId: member.id, sessionToken: member.token });

    const reclaim = SEATS.find((s) => this.reserved[s]?.memberId === member.id && this.reserved[s]!.reason === "offline");
    if (member.seat !== null) this.attach(member.seat);
    else if (reclaim !== undefined) this.seatPerson(reclaim, member);
    this.afterSeatsChanged();
    return member.id;
  }

  /** The connection closed. Ignored if the member has since reconnected on a newer connection. */
  disconnect(memberId: string, connection: Connection) {
    this.lastActivity = Date.now();
    const member = this.members.get(memberId);
    if (!member || member.connection !== connection) return;
    member.connection = null;
    if (member.seat !== null) this.setController(member.seat, null);
    this.requests = this.requests.filter((id) => id !== memberId);
    this.afterSeatsChanged();
  }

  takeSeat(memberId: string, seat: Seat): RoomError | null {
    const member = this.members.get(memberId);
    if (!member) return error("notInRoom", "You're not in this room");
    const holder = this.seats[seat] ? this.members.get(this.seats[seat]!)! : null;
    if (holder?.id === memberId) return null;
    if (holder && !holder.bot) return error("seatTaken", "That seat is taken");

    if (this.phase === "lobby") {
      if (member.seat !== null) this.vacate(member.seat);
    } else {
      // During a game people can't hop between seats (scores belong to seats).
      if (member.seat !== null) return error("notAllowed", "You already have a seat");
      const mine = this.reserved[seat]?.memberId === memberId;
      const between = this.phase === "paused" || this.phase === "windBreak";
      if (this.phase === "gameOver") return error("notAllowed", "The game is over");
      if (!between && !mine) return error("handInProgress", "Ask the host to let you play");
      if (this.phase === "windBreak" && !holder) return error("notAllowed", "Pick a bot to take over from");
    }
    this.seatPerson(seat, member);
    this.afterSeatsChanged();
    return null;
  }

  leaveSeat(memberId: string): RoomError | null {
    const member = this.members.get(memberId);
    if (!member) return error("notInRoom", "You're not in this room");
    if (member.seat === null) return null;
    if (this.phase === "gameOver") return error("notAllowed", "The game is over");
    const seat = member.seat;
    // At a wind break, leaving hands the seat to a bot. Elsewhere it's left empty: the host decides.
    if (this.phase === "windBreak") this.seatBot(seat);
    else this.vacate(seat);
    this.afterSeatsChanged();
    return null;
  }

  // ---- host ----------------------------------------------------------------------------------------

  /** Fill every empty seat with a bot that plays random legal moves (testing, or a short table). */
  addBots(memberId: string): RoomError | null {
    const denied = this.requireHost(memberId) ?? this.requirePhase(["lobby", "paused"]);
    if (denied) return denied;
    for (const seat of SEATS) if (this.seats[seat] === null) this.seatBot(seat);
    this.afterSeatsChanged();
    return null;
  }

  /** Take a person out of their seat. During a game a bot takes over (scores belong to seats). */
  removeMember(memberId: string, targetId: string): RoomError | null {
    const denied = this.requireHost(memberId);
    if (denied) return denied;
    const target = this.members.get(targetId);
    if (!target || target.bot || target.seat === null) return error("notAllowed", "They don't have a seat");
    const seat = target.seat;
    if (this.phase === "windBreak") {
      if (this.votes[seat]) return error("notAllowed", "They've already voted");
      if (Date.now() - this.windBreakAt < this.options.voteRemoveMs) return error("notAllowed", "Give them a moment to vote");
    }
    if (this.phase === "lobby" || this.phase === "paused") this.vacate(seat);
    else this.seatBot(seat);
    this.afterSeatsChanged();
    return null;
  }

  /** Mid-hand or between hands: hand an empty, offline, or idle seat to a bot. */
  replaceWithBot(memberId: string, seat: Seat): RoomError | null {
    const denied = this.requireHost(memberId) ?? this.requirePhase(["hand", "handOver"]);
    if (denied) return denied;
    const issue = this.seatIssue(seat);
    if (!issue) return error("notAllowed", "That seat is being played");
    const holder = this.seats[seat] ? this.members.get(this.seats[seat]!)! : null;
    this.seatBot(seat);
    if (holder) this.reserved[seat] = { memberId: holder.id, reason: issue === "offline" ? "offline" : "idle" };
    this.afterSeatsChanged();
    return null;
  }

  /** Throw the current hand away and pause the game in the lobby. The same dealer deals again. */
  cancelHand(memberId: string): RoomError | null {
    const denied = this.requireHost(memberId) ?? this.requirePhase(["hand"]);
    if (denied) return denied;
    this.endHandTimers();
    this.hand = null;
    this.version++;
    this.phase = "paused";
    this.broadcastLobby();
    return null;
  }

  startGame(memberId: string): RoomError | null {
    const denied = this.requireHost(memberId) ?? this.requirePhase(["lobby"]) ?? this.requireFull();
    if (denied) return denied;
    this.game = newGame(this.options.firstDealer?.() ?? (randomInt(4) as Seat));
    this.dealHand();
    return null;
  }

  resumeGame(memberId: string): RoomError | null {
    const denied = this.requireHost(memberId) ?? this.requirePhase(["paused"]) ?? this.requireFull();
    if (denied) return denied;
    this.dealHand();
    return null;
  }

  /** After the game is over: back to the lobby with scores reset. */
  newGame(memberId: string): RoomError | null {
    const denied = this.requireHost(memberId) ?? this.requirePhase(["gameOver"]);
    if (denied) return denied;
    this.game = null;
    this.hand = null;
    this.reserved.fill(null);
    this.phase = "lobby";
    this.broadcastLobby();
    return null;
  }

  answerRequest(memberId: string, targetId: string, approve: boolean): RoomError | null {
    const denied = this.requireHost(memberId);
    if (denied) return denied;
    if (!this.requests.includes(targetId)) return error("notAllowed", "No such request");
    this.requests = this.requests.filter((id) => id !== targetId);
    const target = this.members.get(targetId);
    const seat = approve && target && target.seat === null ? this.seatForNewcomer() : null;
    if (seat !== null) this.seatPerson(seat, target!);
    this.afterSeatsChanged();
    return null;
  }

  // ---- everyone ------------------------------------------------------------------------------------

  /** A watcher asks the host to let them play (replacing a bot, or filling an empty seat). */
  requestSeat(memberId: string): RoomError | null {
    const member = this.members.get(memberId);
    if (!member) return error("notInRoom", "You're not in this room");
    if (member.seat !== null) return error("notAllowed", "You already have a seat");
    const denied = this.requirePhase(["hand", "handOver"]);
    if (denied) return denied;
    if (this.seatForNewcomer() === null) return error("notAllowed", "There's no seat to take over");
    if (!this.requests.includes(memberId)) this.requests.push(memberId);
    this.broadcastLobby();
    return null;
  }

  /** Between hands: ready for the next one. */
  setReady(memberId: string): RoomError | null {
    const member = this.members.get(memberId);
    if (member?.seat == null) return error("notSeated", "Take a seat first");
    const denied = this.requirePhase(["handOver"]);
    if (denied) return denied;
    this.ready[member.seat] = true;
    this.afterSeatsChanged();
    return null;
  }

  /** Between hands: pause the game in the lobby. Anyone seated may. */
  returnToLobby(memberId: string): RoomError | null {
    if (this.members.get(memberId)?.seat == null) return error("notSeated", "Take a seat first");
    const denied = this.requirePhase(["handOver"]);
    if (denied) return denied;
    this.phase = "paused";
    this.clearReadyTimer();
    this.broadcastLobby();
    return null;
  }

  /** At a wind break: vote to continue. Continuing needs every seated person. */
  voteContinue(memberId: string): RoomError | null {
    const member = this.members.get(memberId);
    if (member?.seat == null) return error("notSeated", "Take a seat first");
    const denied = this.requirePhase(["windBreak"]);
    if (denied) return denied;
    this.votes[member.seat] = true;
    this.afterSeatsChanged();
    return null;
  }

  /** A player's action, from a socket. */
  act(memberId: string, action: Action, stateVersion: number): RoomError | null {
    const member = this.members.get(memberId);
    if (!member) return error("notInRoom", "You're not in this room");
    if (member.seat === null) return error("notSeated", "Take a seat first");
    return this.submit(member.seat, action, stateVersion);
  }

  /** An action for `seat`, from a socket or an in-process controller. */
  submit(seat: Seat, action: Action, stateVersion: number): RoomError | null {
    this.lastActivity = Date.now();
    if (!this.hand || this.phase !== "hand") return error("illegalAction", "No hand is being played");
    if (stateVersion !== this.version) return error("staleState", "The game moved on; try again");
    const result = applyAction(this.hand, seat, action);
    if (!result.ok) return error("illegalAction", result.error);
    this.commit(result.state, result.events, seat);
    return null;
  }

  /** Stop timers and controllers (the room is being discarded). */
  dispose() {
    this.endHandTimers();
    this.clearReadyTimer();
    for (const seat of SEATS) this.setController(seat, null);
  }

  // ---- hands ---------------------------------------------------------------------------------------

  private dealHand() {
    const game = this.game!;
    const { state, events } = startHand({
      seed: randomInt(2 ** 32),
      rules: this.options.rules ?? DEFAULT_RULES,
      dealer: game.dealer,
      prevailingWind: game.prevailingWind,
      wall: this.options.wallForNextHand?.(game.dealer),
    });
    this.clearReadyTimer();
    this.phase = "hand";
    for (const seat of SEATS) this.setController(seat, this.controllerFor(seat));
    this.commit(state, events);
    this.broadcastLobby();
  }

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
    if (state.phase.kind === "handOver") this.finishHand(state.phase.result);
    else this.startIdleTimer();
    for (const seat of SEATS) this.controllers[seat]?.update(this.updateFor(seat, events));
    if (state.phase.kind === "handOver") this.afterSeatsChanged();
  }

  /** Score the hand and move on: a ready-up between hands, or a wind break if the wind is over. */
  private finishHand(result: Parameters<typeof recordHand>[1]) {
    this.endHandTimers();
    const recorded = recordHand(this.game!, result);
    this.game = recorded.game;
    if (recorded.windOver) {
      this.phase = "windBreak";
      this.votes = EMPTY(false);
      this.windBreakAt = Date.now();
    } else {
      this.phase = "handOver";
      this.ready = EMPTY(false);
    }
  }

  private startClaimTimer() {
    this.clearClaimTimer();
    const version = this.version;
    this.claimDeadline = Date.now() + this.options.claimWindowMs;
    this.claimTimer = setTimeout(() => {
      this.claimTimer = null;
      if (this.version !== version || !this.hand || this.phase !== "hand") return;
      const result = closeClaimWindow(this.hand);
      if (result.ok) this.commit(result.state, result.events);
    }, this.options.claimWindowMs);
  }

  private clearClaimTimer() {
    if (this.claimTimer) clearTimeout(this.claimTimer);
    this.claimTimer = null;
    this.claimDeadline = null;
  }

  /** Whoever must decide now (their turn, or using a tile they claimed) gets `idleMs` before the host is told. */
  private startIdleTimer() {
    this.clearIdle();
    const phase = this.hand?.phase;
    if (!phase || (phase.kind !== "awaitDiscard" && phase.kind !== "claimed")) return;
    const seat = phase.seat;
    if (!this.isConnectedPerson(seat)) return;
    const version = this.version;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.version !== version || this.phase !== "hand") return;
      this.idleSeat = seat;
      this.broadcastLobby();
    }, this.options.idleMs);
  }

  private clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const wasIdle = this.idleSeat !== null;
    this.idleSeat = null;
    if (wasIdle) this.broadcastLobby();
  }

  private endHandTimers() {
    this.clearClaimTimer();
    this.clearIdle();
  }

  // ---- between hands -------------------------------------------------------------------------------

  /** Re-check everything that depends on who's where: ready-up, wind-break votes, then tell everyone. */
  private afterSeatsChanged() {
    if (this.phase === "handOver") this.checkReady();
    if (this.phase === "windBreak") this.checkVotes();
    if (this.phase === "hand" && this.idleSeat !== null && !this.isConnectedPerson(this.idleSeat)) this.clearIdle();
    this.broadcastLobby();
  }

  /** Deal when every seated person is ready; otherwise run the countdown, unless a seat needs filling. */
  private checkReady() {
    const blocked = SEATS.some((s) => this.seatIssue(s) !== null);
    if (blocked) return this.clearReadyTimer();
    const people = SEATS.filter((s) => !this.isBot(s));
    if (people.every((s) => this.ready[s])) return this.dealHand();
    if (this.readyTimer) return;
    this.readyDeadline = Date.now() + this.options.readyMs;
    this.readyTimer = setTimeout(() => {
      this.readyTimer = null;
      if (this.phase === "handOver") this.dealHand();
    }, this.options.readyMs);
  }

  private clearReadyTimer() {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    this.readyDeadline = null;
  }

  /** Continue when every seated person has voted to; the game is over when nobody is left. */
  private checkVotes() {
    const people = SEATS.filter((s) => this.seats[s] !== null && !this.isBot(s));
    if (people.length === 0) {
      this.phase = "gameOver";
      this.reserved.fill(null);
      this.requests = [];
    } else if (people.every((s) => this.votes[s]) && SEATS.every((s) => this.seats[s] !== null)) {
      this.dealHand();
    }
  }

  // ---- seats ---------------------------------------------------------------------------------------

  /** Put a person in a seat, replacing a bot if there is one. They inherit the seat's score. */
  private seatPerson(seat: Seat, member: Member) {
    const holder = this.seats[seat] ? this.members.get(this.seats[seat]!)! : null;
    if (holder?.bot) this.members.delete(holder.id);
    if (member.seat !== null && member.seat !== seat) this.vacate(member.seat);
    this.seats[seat] = member.id;
    member.seat = seat;
    this.reserved[seat] = null;
    this.ready[seat] = false;
    this.votes[seat] = false;
    this.requests = this.requests.filter((id) => id !== member.id);
    this.attach(seat);
  }

  /** Put a new bot in a seat (unseating whoever was there). */
  private seatBot(seat: Seat) {
    const holder = this.seats[seat] ? this.members.get(this.seats[seat]!)! : null;
    if (holder?.bot) return;
    if (holder) holder.seat = null;
    const bot: Member = { id: randomUUID().slice(0, 8), name: `Bot ${seat + 1}`, token: randomUUID(), seat, connection: null, bot: true };
    this.members.set(bot.id, bot);
    this.seats[seat] = bot.id;
    this.reserved[seat] = null;
    this.attach(seat);
  }

  private vacate(seat: Seat) {
    const holder = this.seats[seat] ? this.members.get(this.seats[seat]!)! : null;
    if (holder?.bot) this.members.delete(holder.id);
    else if (holder) holder.seat = null;
    this.seats[seat] = null;
    this.setController(seat, null);
  }

  /** Give the seat's current occupant control, and a snapshot if a hand is on the table. */
  private attach(seat: Seat) {
    this.setController(seat, this.controllerFor(seat));
    if (this.hand && (this.phase === "hand" || this.phase === "handOver" || this.phase === "windBreak")) {
      this.controllers[seat]?.update(this.updateFor(seat, []));
    }
  }

  private controllerFor(seat: Seat): SeatController | null {
    const holder = this.seats[seat] ? this.members.get(this.seats[seat]!)! : null;
    if (!holder) return null;
    if (holder.bot) {
      return new PolicyController(
        randomPolicy(),
        (action, stateVersion) => this.submit(seat, action, stateVersion),
        this.options.botDelayMs,
      );
    }
    return holder.connection ? new HumanController(holder.connection) : null;
  }

  private setController(seat: Seat, controller: SeatController | null) {
    this.controllers[seat]?.dispose();
    this.controllers[seat] = controller;
  }

  /** Where an approved newcomer goes: an empty seat, else a random bot (bots keeping a seat for someone last). */
  private seatForNewcomer(): Seat | null {
    const empty = SEATS.filter((s) => this.seats[s] === null);
    const bots = SEATS.filter((s) => this.isBot(s) && !this.reserved[s]);
    const keeping = SEATS.filter((s) => this.isBot(s) && this.reserved[s]);
    const pool = empty.length ? empty : bots.length ? bots : keeping;
    return pool.length ? pool[randomInt(pool.length)]! : null;
  }

  /** Why a seat isn't being played during a game: empty, its person is offline, or they've gone idle. */
  private seatIssue(seat: Seat): SeatIssue | null {
    if (this.phase !== "hand" && this.phase !== "handOver") return null;
    const holder = this.seats[seat] ? this.members.get(this.seats[seat]!)! : null;
    if (!holder) return "empty";
    if (!holder.bot && !holder.connection) return "offline";
    if (this.idleSeat === seat) return "idle";
    return null;
  }

  private isBot(seat: Seat): boolean {
    return this.seats[seat] !== null && this.members.get(this.seats[seat]!)!.bot;
  }

  private isConnectedPerson(seat: Seat): boolean {
    const holder = this.seats[seat] ? this.members.get(this.seats[seat]!)! : null;
    return !!holder && !holder.bot && holder.connection !== null;
  }

  // ---- checks --------------------------------------------------------------------------------------

  private requireHost(memberId: string): RoomError | null {
    if (!this.members.has(memberId)) return error("notInRoom", "You're not in this room");
    return this.currentHost() === memberId ? null : error("notHost", "Only the host can do that");
  }

  private requirePhase(phases: RoomPhase[]): RoomError | null {
    if (phases.includes(this.phase)) return null;
    return this.phase === "hand" ? error("handInProgress", "Not during a hand") : error("notAllowed", "Not right now");
  }

  private requireFull(): RoomError | null {
    return this.seats.every((s) => s !== null) ? null : error("notEnoughPlayers", "All four seats must be filled");
  }

  /** The host, handing over to the longest-present connected person if they've gone. */
  private currentHost(): string | null {
    const host = this.hostId ? this.members.get(this.hostId) : undefined;
    if (!host?.connection) {
      const next = [...this.members.values()].find((m) => !m.bot && m.connection);
      if (next) this.hostId = next.id;
    }
    return this.hostId;
  }

  // ---- messages ------------------------------------------------------------------------------------

  private updateFor(seat: Seat, events: GameEvent[]) {
    const hand = this.hand!;
    return {
      stateVersion: this.version,
      view: projectView(hand, seat),
      legalActions: this.phase === "hand" ? legalActions(hand, seat) : [],
      events: projectEvents(events, seat),
      claimMsLeft: this.claimDeadline === null ? null : Math.max(0, this.claimDeadline - Date.now()),
    };
  }

  private broadcastLobby() {
    const now = Date.now();
    const members: MemberInfo[] = [...this.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      seat: m.seat,
      connected: m.connection !== null,
      bot: m.bot,
    }));
    const seatInfo: SeatInfo[] = SEATS.map((s) => ({
      issue: this.seatIssue(s),
      reservedFor: this.reserved[s]?.memberId ?? null,
      ready: this.phase === "handOver" && (this.ready[s]! || this.isBot(s)),
      voted: this.phase === "windBreak" && this.votes[s]!,
    }));
    const message: LobbyMessage = {
      t: "lobby",
      room: this.code,
      hostId: this.currentHost(),
      phase: this.phase,
      members,
      seats: [...this.seats],
      seatInfo,
      game: this.game,
      readyMsLeft: this.readyDeadline === null ? null : Math.max(0, this.readyDeadline - now),
      voteRemoveMsLeft: this.phase === "windBreak" ? Math.max(0, this.windBreakAt + this.options.voteRemoveMs - now) : null,
      requests: this.requests.map((id) => ({ id, name: this.members.get(id)?.name ?? "?" })),
    };
    for (const m of this.members.values()) m.connection?.send(message);
  }
}
