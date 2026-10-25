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
 * Drives one seat. The room never talks to sockets directly: humans, the disconnect autopilot, and future
 * bots are all controllers, and swapping who plays a seat means swapping its controller.
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
 * the room synchronously. This is the base for the autopilot and for future bots.
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

/** For a disconnected player: never claim, and discard the tile just drawn (or the last tile in hand). */
export const autopilotPolicy: Policy = (view, legalActions) => {
  const pass = legalActions.find((a) => a.type === "pass");
  if (pass) return pass;
  const tile = view.lastDrawn ?? view.hand[view.hand.length - 1]!;
  return legalActions.find((a) => a.type === "discard" && a.tile === tile) ?? legalActions[0]!;
};

/** Random legal moves, taking wins when offered. Used by tests and handy for filling seats in development. */
export function randomPolicy(random: () => number = Math.random): Policy {
  return (_view, legalActions) => {
    const win = legalActions.find((a) => a.type === "win" || a.type === "selfDrawWin");
    return win ?? legalActions[Math.floor(random() * legalActions.length)]!;
  };
}
