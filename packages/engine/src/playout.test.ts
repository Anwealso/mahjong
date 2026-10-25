import { describe, expect, it } from "vitest";
import { applyAction, closeClaimWindow, legalActions, startHand } from "./hand";
import { createRng, type Rng } from "./rng";
import { DEFAULT_RULES, type RuleConfig } from "./rules";
import { NUM_TILES, type TileId } from "./tiles";
import { SEATS, type Action, type HandState, type Seat } from "./types";
import { projectView } from "./view";

/**
 * Property tests: play thousands of hands with random legal moves and check invariants after every
 * step. This is what catches the edge cases nobody thought to write a scenario for.
 */

/** Plain assertion: `expect` is too slow to call hundreds of thousands of times. */
function assert(condition: boolean, message: () => string): asserts condition {
  if (!condition) throw new Error(message());
}

const pick = <T,>(items: readonly T[], rng: Rng): T => items[Math.floor(rng() * items.length)]!;

function chooseAction(actions: Action[], rng: Rng): Action {
  // Take wins most of the time so hands actually end in wins, otherwise play randomly.
  const win = actions.find((a) => a.type === "win" || a.type === "selfDrawWin");
  if (win && rng() < 0.7) return win;
  return pick(actions, rng);
}

/** Every tile is in exactly one place. */
function checkConservation(state: HandState) {
  const all: TileId[] = [...state.wall];
  for (const p of state.players) all.push(...p.hand, ...p.discards, ...p.melds.flatMap((m) => m.tiles));
  // A tile added to a pung is in limbo while others decide whether to rob the kong.
  if (state.phase.kind === "claimWindow" && state.phase.source === "addedKong") all.push(state.phase.tile);
  assert(all.length === NUM_TILES && new Set(all).size === NUM_TILES, () => `tiles not conserved: ${all.length}`);
}

/** Hand sizes: the player to act holds 14 (counting each set as 3), everyone else 13. */
function checkHandSizes(state: HandState) {
  if (state.phase.kind === "handOver") return;
  const acting = state.phase.kind === "awaitDiscard" ? state.phase.seat : null;
  for (const s of SEATS) {
    const p = state.players[s]!;
    const size = p.hand.length + p.melds.length * 3;
    assert(size === (s === acting ? 14 : 13), () => `seat ${s} holds ${size} tiles in ${state.phase.kind}`);
  }
}

const VIEW_KEYS = ["dealer", "hand", "lastDrawn", "phase", "players", "prevailingWind", "seat", "wallCount"].sort().join();

/** No seat's view contains another seat's concealed tiles or any wall tile. */
function checkViews(state: HandState) {
  for (const seat of SEATS) {
    const view = projectView(state, seat);
    const secret = new Set<TileId>([...state.wall]);
    if (state.phase.kind !== "handOver") {
      for (const s of SEATS) if (s !== seat) state.players[s]!.hand.forEach((t) => secret.add(t));
    }
    const visible: TileId[] = [
      ...view.hand,
      ...(view.lastDrawn === null ? [] : [view.lastDrawn]),
      ...view.players.flatMap((p) => [...p.discards, ...p.melds.flatMap((m) => m.tiles)]),
      ...(view.phase.kind === "claimWindow" ? [view.phase.tile] : []),
    ];
    const leaked = visible.filter((t) => secret.has(t));
    assert(leaked.length === 0, () => `seat ${seat} can see secret tiles ${leaked}`);
    assert(view.hand.join() === state.players[seat]!.hand.join(), () => `seat ${seat} sees the wrong hand`);
    assert(Object.keys(view).sort().join() === VIEW_KEYS, () => `unexpected view keys ${Object.keys(view)}`);
  }
}

interface Stats {
  wins: number;
  selfDraws: number;
  draws: number;
  melds: Record<string, number>;
  timeouts: number;
}

function playHand(seed: number, rules: RuleConfig, stats: Stats) {
  const rng = createRng(seed ^ 0x9e3779b9);
  let state = startHand({ seed, rules, dealer: (seed % 4) as Seat }).state;

  for (let step = 0; ; step++) {
    if (step > 2000) throw new Error(`Hand with seed ${seed} didn't finish`);
    checkConservation(state);
    checkHandSizes(state);
    checkViews(state);
    if (state.phase.kind === "handOver") break;

    // Sometimes let the claim timer run out instead of waiting for everyone.
    if (state.phase.kind === "claimWindow" && rng() < 0.1) {
      const closed = closeClaimWindow(state);
      if (!closed.ok) throw new Error(closed.error);
      state = closed.state;
      stats.timeouts++;
      continue;
    }

    const actors = SEATS.filter((s) => legalActions(state, s).length > 0);
    assert(actors.length > 0, () => `seed ${seed}: nobody can act in ${state.phase.kind}`);
    const seat = pick(actors, rng);
    const result = applyAction(state, seat, chooseAction(legalActions(state, seat), rng));
    if (!result.ok) throw new Error(`seed ${seed}: ${result.error}`);
    for (const e of result.events) if (e.type === "melded") stats.melds[e.meld.type] = (stats.melds[e.meld.type] ?? 0) + 1;
    state = result.state;
  }

  const result = (state.phase as Extract<HandState["phase"], { kind: "handOver" }>).result;
  assert(result.payments.reduce((a, b) => a + b, 0) === 0, () => `seed ${seed}: payments don't sum to 0`);
  checkViews(state);
  if (result.kind === "draw") stats.draws++;
  else {
    stats.wins++;
    if (result.selfDraw) stats.selfDraws++;
  }
}

function run(rules: RuleConfig, hands: number): Stats {
  const stats: Stats = { wins: 0, selfDraws: 0, draws: 0, melds: {}, timeouts: 0 };
  for (let seed = 1; seed <= hands; seed++) playHand(seed, rules, stats);
  return stats;
}

describe("random playouts", () => {
  it("default rules: invariants hold and every path gets exercised", () => {
    const stats = run(DEFAULT_RULES, 400);
    expect(stats.wins).toBeGreaterThan(0);
    expect(stats.selfDraws).toBeGreaterThan(0);
    expect(stats.draws).toBeGreaterThan(0);
    expect(stats.melds.chow).toBeGreaterThan(0);
    expect(stats.melds.pung).toBeGreaterThan(0);
    expect(stats.melds.kong).toBeGreaterThan(0);
    expect(stats.timeouts).toBeGreaterThan(0);
  }, 30_000);

  it("every optional rule on: invariants still hold", () => {
    const stats = run(
      { thirteenOrphans: true, sevenPairs: true, robbingKong: true, multipleWinners: "all" },
      400,
    );
    expect(stats.wins + stats.draws).toBe(400);
  }, 30_000);
});
