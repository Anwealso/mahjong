import type { Policy } from "@mahjong/bots";
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

/**
 * Plays a seat in-process with a policy (bots live in @mahjong/bots), after a delay so it feels natural
 * and never re-enters the room synchronously.
 */
export class PolicyController implements SeatController {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly policy: Policy,
    private readonly submit: (action: Action, stateVersion: number) => void,
    private readonly delay: (update: SeatUpdate) => number,
  ) {}

  update(update: SeatUpdate) {
    this.dispose();
    const { view, legalActions, stateVersion } = update;
    if (legalActions.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.submit(this.policy(view, legalActions), stateVersion);
    }, this.delay(update));
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * How long a bot "thinks", the same at every level so difficulty never means winning the claim race by
 * being faster: 0.8–2 s to claim or pass, 1–2.5 s on its own turn.
 */
export function humanLikeDelay({ view }: SeatUpdate, random: () => number = Math.random): number {
  const [min, max] = view.phase.kind === "claimWindow" ? [800, 2000] : [1000, 2500];
  return min + random() * (max - min);
}
