import {
  applyAction,
  closeClaimWindow,
  createRng,
  legalActions,
  projectView,
  SEATS,
  startHand,
  type HandState,
  type Seat,
} from "@mahjong/engine";
import type { Policy } from "./policy";

/** Results per contestant (not per seat: contestants rotate seats every hand). */
export interface ArenaStats {
  name: string;
  hands: number;
  wins: number;
  selfDraws: number;
  /** Times this contestant's discard (or robbed kong) let someone else win. */
  dealIns: number;
  points: number;
}

export interface ArenaResult {
  hands: number;
  draws: number;
  /** Average number of actions per hand. */
  averageMoves: number;
  stats: ArenaStats[];
}

export interface Contestant {
  name: string;
  /** Called once per hand, so a policy can be seeded per hand. */
  make(random: () => number): Policy;
}

/**
 * Play `hands` hands between four contestants with the engine directly (no server). Contestants rotate
 * round the seats and the dealer moves every hand, so nobody gets a positional edge. Claims are a race:
 * eligible seats answer in a random order and the first claim wins. Fully deterministic for a seed.
 */
export function runArena(contestants: Contestant[], hands: number, seed = 1): ArenaResult {
  if (contestants.length !== 4) throw new Error("The arena needs four contestants");
  const rng = createRng(seed);
  const stats: ArenaStats[] = contestants.map((c) => ({ name: c.name, hands: 0, wins: 0, selfDraws: 0, dealIns: 0, points: 0 }));
  let draws = 0;
  let moves = 0;

  for (let h = 0; h < hands; h++) {
    // Seat s is played by contestant (s + h) % 4.
    const who = (seat: Seat) => (seat + h) % 4;
    const policies = SEATS.map((seat) => contestants[who(seat)]!.make(createRng(Math.floor(rng() * 2 ** 31))));
    let state: HandState = startHand({ seed: Math.floor(rng() * 2 ** 31), dealer: (h % 4) as Seat }).state;

    const act = (seat: Seat, policy: Policy) => {
      const action = policy(projectView(state, seat), legalActions(state, seat));
      const result = applyAction(state, seat, action);
      if (!result.ok) throw new Error(`${contestants[who(seat)]!.name} made an illegal move: ${result.error}`);
      state = result.state;
      moves++;
    };

    while (state.phase.kind !== "handOver") {
      const { phase } = state;
      if (phase.kind === "claimWindow") {
        const order = SEATS.filter((s) => legalActions(state, s).length > 0).sort(() => rng() - 0.5);
        for (const seat of order) {
          if (state.phase.kind !== "claimWindow") break;
          act(seat, policies[seat]!);
        }
        if (state.phase.kind === "claimWindow") state = (closeClaimWindow(state) as { state: HandState }).state;
      } else {
        act(phase.seat, policies[phase.seat]!);
      }
    }

    const { result } = state.phase;
    for (const seat of SEATS) {
      const st = stats[who(seat)]!;
      st.hands++;
      st.points += result.payments[seat]!;
    }
    if (result.kind === "draw") draws++;
    else {
      const winner = stats[who(result.winner)]!;
      winner.wins++;
      if (result.selfDraw) winner.selfDraws++;
      else stats[who(result.from!)]!.dealIns++;
    }
  }
  return { hands, draws, averageMoves: moves / hands, stats };
}
