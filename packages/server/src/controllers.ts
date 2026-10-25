import type { Action, GameEvent, PlayerView } from "@mahjong/engine";
import type { ServerMessage } from "@mahjong/protocol";

/** Anything that can receive server messages: a WebSocket in production, a fake in tests. */
export interface Connection {
  send(message: ServerMessage): void;
}

/** Everything a seat learns after a change: exactly what it may see and do. */
export interface SeatUpdate {
  stateVersion: number;
  view: PlayerView;
  legalActions: Action[];
  events: GameEvent[];
  claimMsLeft: number | null;
}

/**
 * Drives one seat. The room never talks to sockets directly: humans and bots are both controllers, and
 * swapping who plays a seat means swapping its controller.
 */
export interface SeatController {
  update(update: SeatUpdate): void;
  dispose(): void;
}

/** A person at a browser: forward every update over their connection. */
export class HumanController implements SeatController {
  constructor(private readonly connection: Connection) {}

  update(update: SeatUpdate) {
    this.connection.send({ t: "state", ...update });
  }

  dispose() {}
}

/** Picks one of the legal actions. Sees only the seat's own view, so it can't cheat. */
export type Policy = (view: PlayerView, legalActions: Action[]) => Action;

/**
 * Plays a seat in-process with a policy, after a short delay so it feels natural and never re-enters
 * the room synchronously. Bots are policies.
 */
export class PolicyController implements SeatController {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly policy: Policy,
    private readonly submit: (action: Action, stateVersion: number) => void,
    private readonly delayMs: number,
  ) {}

  update({ view, legalActions, stateVersion }: SeatUpdate) {
    this.dispose();
    if (legalActions.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.submit(this.policy(view, legalActions), stateVersion);
    }, this.delayMs);
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Random legal moves, taking wins when offered. The lobby's bots play this. */
export function randomPolicy(random: () => number = Math.random): Policy {
  return (_view, legalActions) => {
    const win = legalActions.find((a) => a.type === "win" || a.type === "selfDrawWin");
    return win ?? legalActions[Math.floor(random() * legalActions.length)]!;
  };
}
