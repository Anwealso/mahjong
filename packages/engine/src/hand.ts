import { clone } from "./clone";
import { DEFAULT_RULES, type RuleConfig } from "./rules";
import { scoreWin } from "./scoring";
import { canStartChow, countTiles, isSuited, kindOf, NUM_TILES, sortTiles, type TileId, type TileKind } from "./tiles";
import {
  nextSeat,
  SEATS,
  type Action,
  type ApplyResult,
  type ClaimSource,
  type GameEvent,
  type HandState,
  type Meld,
  type Phase,
  type Seat,
  type Wind,
} from "./types";
import { buildWall } from "./wall";
import { isWinningHand } from "./win";

export interface StartHandOptions {
  seed: number;
  rules?: RuleConfig;
  dealer?: Seat;
  prevailingWind?: Wind;
  /** Use this exact wall instead of shuffling from `seed` (tests use `stackWall`). */
  wall?: readonly TileId[];
}

const HAND_SIZE = 13;

/**
 * Shuffle (or take the given wall), deal 13 to each seat starting with the dealer, then one more to the
 * dealer, who opens by discarding.
 */
export function startHand(options: StartHandOptions): { state: HandState; events: GameEvent[] } {
  const dealer = options.dealer ?? 0;
  const wall = options.wall ? [...options.wall] : buildWall(options.seed);
  if (wall.length !== NUM_TILES || new Set(wall).size !== NUM_TILES) {
    throw new Error("Wall must contain each of the 136 tiles exactly once");
  }

  const players = SEATS.map(() => ({ hand: [] as TileId[], melds: [] as Meld[], discards: [] as TileId[] }));
  for (let i = 0; i < 4; i++) players[(dealer + i) % 4]!.hand = wall.splice(0, HAND_SIZE);
  const extra = wall.shift()!;
  players[dealer]!.hand.push(extra);
  for (const p of players) p.hand = sortTiles(p.hand);

  const state: HandState = {
    rules: options.rules ?? DEFAULT_RULES,
    seed: options.seed,
    dealer,
    prevailingWind: options.prevailingWind ?? 0,
    wall,
    players,
    phase: { kind: "awaitDiscard", seat: dealer, drew: true },
    lastDrawn: extra,
  };
  return { state, events: [{ type: "dealt" }] };
}

/** Every action `seat` may take right now. Empty if it's not their decision. */
export function legalActions(state: HandState, seat: Seat): Action[] {
  const { phase } = state;
  if (phase.kind === "awaitDiscard") return phase.seat === seat ? turnOptions(state, seat, phase.drew) : [];
  if (phase.kind === "claimWindow") return phase.responses[seat] === null ? claimOptions(state, seat, phase) : [];
  return [];
}

function turnOptions(state: HandState, seat: Seat, drew: boolean): Action[] {
  const player = state.players[seat]!;
  const counts = countTiles(player.hand);
  const actions: Action[] = [];

  if (drew && isWinningHand(counts, player.melds.length, state.rules)) actions.push({ type: "selfDrawWin" });

  // A kong needs a replacement tile, so none once the wall is empty.
  if (state.wall.length > 0) {
    counts.forEach((n, kind) => n === 4 && actions.push({ type: "concealedKong", kind }));
    for (const tile of player.hand) {
      if (player.melds.some((m) => m.type === "pung" && kindOf(m.tiles[0]!) === kindOf(tile))) {
        actions.push({ type: "addedKong", tile });
      }
    }
  }

  for (const tile of player.hand) actions.push({ type: "discard", tile });
  return actions;
}

type ClaimWindow = Extract<Phase, { kind: "claimWindow" }>;

/** What `seat` could do with the tile in the window. Includes `pass` only when there's something to pass on. */
function claimOptions(state: HandState, seat: Seat, window: ClaimWindow): Action[] {
  if (seat === window.from) return [];
  const player = state.players[seat]!;
  const kind = kindOf(window.tile);
  const counts = countTiles(player.hand);
  const actions: Action[] = [];

  const withTile = [...counts];
  withTile[kind]!++;
  if (isWinningHand(withTile, player.melds.length, state.rules)) actions.push({ type: "win" });

  // A tile added to a pung can only be claimed to win (robbing the kong).
  if (window.source === "discard") {
    if (counts[kind]! >= 2) actions.push({ type: "pung" });
    if (counts[kind]! >= 3 && state.wall.length > 0) actions.push({ type: "kong" });
    if (seat === nextSeat(window.from) && isSuited(kind)) {
      for (let start = Math.max(0, kind - 2); start <= kind; start++) {
        if (!canStartChow(start)) continue;
        const [a, b] = [start, start + 1, start + 2].filter((k) => k !== kind) as [TileKind, TileKind];
        const ta = player.hand.find((t) => kindOf(t) === a);
        const tb = player.hand.find((t) => kindOf(t) === b);
        if (ta !== undefined && tb !== undefined) actions.push({ type: "chow", tiles: [ta, tb] });
      }
    }
  }

  if (actions.length > 0) actions.push({ type: "pass" });
  return actions;
}

/** Identity of an action for legality checks, independent of object key order. */
function actionKey(action: Action): string {
  switch (action.type) {
    case "discard":
    case "addedKong":
      return `${action.type}:${action.tile}`;
    case "concealedKong":
      return `${action.type}:${action.kind}`;
    case "chow":
      return `chow:${[...action.tiles].sort((x, y) => x - y).join(",")}`;
    default:
      return action.type;
  }
}

/** Apply one seat's action. Pure: `prev` is never modified. Only actions from `legalActions` are accepted. */
export function applyAction(prev: HandState, seat: Seat, action: Action): ApplyResult {
  const key = actionKey(action);
  if (!legalActions(prev, seat).some((a) => actionKey(a) === key)) {
    return { ok: false, error: `Illegal action ${key} for seat ${seat} in phase ${prev.phase.kind}` };
  }

  const state = clone(prev);
  const events: GameEvent[] = [];
  const phase = state.phase;
  const player = state.players[seat]!;

  if (phase.kind === "claimWindow") {
    phase.responses[seat] = action;
    if (phase.responses.every((r) => r !== null)) resolveClaims(state, events);
    return { ok: true, state, events };
  }

  switch (action.type) {
    case "discard":
      removeTiles(player.hand, [action.tile]);
      player.discards.push(action.tile);
      state.lastDrawn = null;
      events.push({ type: "discarded", seat, tile: action.tile });
      openClaimWindow(state, events, "discard", seat, action.tile);
      break;
    case "selfDrawWin":
      finishWin(state, events, [seat], state.lastDrawn!, true, null, false);
      break;
    case "concealedKong": {
      const tiles = player.hand.filter((t) => kindOf(t) === action.kind);
      removeTiles(player.hand, tiles);
      const meld: Meld = { type: "kong", tiles, concealed: true, claimed: null };
      player.melds.push(meld);
      events.push({ type: "melded", seat, meld });
      draw(state, events, seat, true);
      break;
    }
    case "addedKong":
      removeTiles(player.hand, [action.tile]);
      state.lastDrawn = null;
      if (state.rules.robbingKong) openClaimWindow(state, events, "addedKong", seat, action.tile);
      else completeAddedKong(state, events, seat, action.tile);
      break;
  }
  return { ok: true, state, events };
}

/**
 * Close the claim window now: every seat that hasn't answered passes. The server calls this when the
 * claim timer runs out.
 */
export function closeClaimWindow(prev: HandState): ApplyResult {
  if (prev.phase.kind !== "claimWindow") return { ok: false, error: "No claim window is open" };
  const state = clone(prev);
  const phase = state.phase as ClaimWindow;
  phase.responses = phase.responses.map((r) => r ?? { type: "pass" });
  const events: GameEvent[] = [];
  resolveClaims(state, events);
  return { ok: true, state, events };
}

/** Seats that still owe an answer in the current claim window. */
export function pendingClaimants(state: HandState): Seat[] {
  const { phase } = state;
  return phase.kind === "claimWindow" ? SEATS.filter((s) => phase.responses[s] === null) : [];
}

function openClaimWindow(state: HandState, events: GameEvent[], source: ClaimSource, from: Seat, tile: TileId) {
  const window: ClaimWindow = { kind: "claimWindow", source, from, tile, responses: [null, null, null, null] };
  state.phase = window;
  // Seats with nothing to claim pass immediately, so nobody waits on them.
  for (const s of SEATS) if (claimOptions(state, s, window).length === 0) window.responses[s] = { type: "pass" };

  if (window.responses.every((r) => r !== null)) resolveClaims(state, events);
  else events.push({ type: "claimWindowOpened", source, from, tile });
}

/** Everyone has answered: apply the highest-priority claim (win > pung/kong > chow), or move on. */
function resolveClaims(state: HandState, events: GameEvent[]) {
  const window = state.phase as ClaimWindow;
  const { from, tile, responses } = window;
  // Turn order after the claimed tile's owner: also the head-bump order.
  const order = [1, 2, 3].map((i) => ((from + i) % 4) as Seat);
  const chose = (s: Seat, type: Action["type"]) => responses[s]!.type === type;

  const winners = order.filter((s) => chose(s, "win"));
  if (winners.length > 0) {
    const chosen = state.rules.multipleWinners === "headBump" ? [winners[0]!] : winners;
    if (window.source === "discard") state.players[from]!.discards.pop();
    // The tile joins the (first) winner's hand so every tile stays accounted for.
    state.players[chosen[0]!]!.hand = sortTiles([...state.players[chosen[0]!]!.hand, tile]);
    finishWin(state, events, chosen, tile, false, from, window.source === "addedKong");
    return;
  }

  if (window.source === "addedKong") {
    completeAddedKong(state, events, from, tile);
    return;
  }

  const setClaimer = order.find((s) => chose(s, "pung") || chose(s, "kong"));
  const chowClaimer = order.find((s) => chose(s, "chow"));
  const claimer = setClaimer ?? chowClaimer;
  if (claimer === undefined) {
    draw(state, events, nextSeat(from), false);
    return;
  }

  const action = responses[claimer]!;
  const player = state.players[claimer]!;
  state.players[from]!.discards.pop();

  let fromHand: TileId[];
  if (action.type === "chow") fromHand = [...action.tiles];
  else fromHand = player.hand.filter((t) => kindOf(t) === kindOf(tile)).slice(0, action.type === "kong" ? 3 : 2);
  removeTiles(player.hand, fromHand);

  const meld: Meld = {
    type: action.type === "chow" ? "chow" : action.type === "kong" ? "kong" : "pung",
    tiles: sortTiles([...fromHand, tile]),
    concealed: false,
    claimed: { tile, from },
  };
  player.melds.push(meld);
  events.push({ type: "melded", seat: claimer, meld });

  if (meld.type === "kong") draw(state, events, claimer, true);
  else {
    state.phase = { kind: "awaitDiscard", seat: claimer, drew: false };
    state.lastDrawn = null;
  }
}

function completeAddedKong(state: HandState, events: GameEvent[], seat: Seat, tile: TileId) {
  const meld = state.players[seat]!.melds.find((m) => m.type === "pung" && kindOf(m.tiles[0]!) === kindOf(tile))!;
  meld.type = "kong";
  meld.tiles = sortTiles([...meld.tiles, tile]);
  events.push({ type: "kongAdded", seat, tile });
  draw(state, events, seat, true);
}

/** Draw for `seat` (from the back for a kong replacement). An empty wall ends the hand as a draw. */
function draw(state: HandState, events: GameEvent[], seat: Seat, replacement: boolean) {
  const tile = replacement ? state.wall.pop() : state.wall.shift();
  if (tile === undefined) {
    const result = { kind: "draw" as const, payments: [0, 0, 0, 0] };
    state.phase = { kind: "handOver", result };
    state.lastDrawn = null;
    events.push({ type: "handOver", result });
    return;
  }
  const player = state.players[seat]!;
  player.hand = sortTiles([...player.hand, tile]);
  state.lastDrawn = tile;
  state.phase = { kind: "awaitDiscard", seat, drew: true };
  events.push({ type: "drew", seat, tile, replacement });
}

function finishWin(
  state: HandState,
  events: GameEvent[],
  winners: Seat[],
  tile: TileId,
  selfDraw: boolean,
  from: Seat | null,
  robbedKong: boolean,
) {
  const result = {
    kind: "win" as const,
    winners,
    tile,
    selfDraw,
    from,
    robbedKong,
    payments: scoreWin(winners, selfDraw, from),
  };
  state.phase = { kind: "handOver", result };
  events.push({ type: "handOver", result });
}

function removeTiles(hand: TileId[], tiles: readonly TileId[]) {
  for (const t of tiles) {
    const i = hand.indexOf(t);
    if (i < 0) throw new Error(`Tile ${t} not in hand`);
    hand.splice(i, 1);
  }
}
