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

/**
 * Every action `seat` may take right now; empty if it's not their decision. Set-forming options list one
 * example choice of tiles: `applyAction` also accepts any other hand tiles of the same kinds.
 */
export function legalActions(state: HandState, seat: Seat): Action[] {
  const { phase } = state;
  if (phase.kind === "awaitDiscard") return phase.seat === seat ? turnOptions(state, seat, phase.drew) : [];
  if (phase.kind === "claimWindow") return phase.passed[seat] ? [] : claimOptions(state, seat, phase);
  return [];
}

function turnOptions(state: HandState, seat: Seat, drew: boolean): Action[] {
  const player = state.players[seat]!;
  const counts = countTiles(player.hand);
  const actions: Action[] = [];

  if (drew && isWinningHand(counts, player.melds.length, state.rules)) actions.push({ type: "selfDrawWin" });

  // A kong needs a replacement tile, so none once the wall is empty.
  if (state.wall.length > 0) {
    counts.forEach((n, kind) => {
      if (n === 4) actions.push({ type: "concealedKong", tiles: player.hand.filter((t) => kindOf(t) === kind) });
    });
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
  const ofKind = (k: TileKind) => player.hand.filter((t) => kindOf(t) === k);
  const actions: Action[] = [];

  const withTile = [...counts];
  withTile[kind]!++;
  if (isWinningHand(withTile, player.melds.length, state.rules)) actions.push({ type: "win" });

  // A tile added to a pung can only be claimed to win (robbing the kong).
  if (window.source === "discard") {
    const same = ofKind(kind);
    if (same.length >= 2) actions.push({ type: "pung", tiles: [same[0]!, same[1]!] });
    if (same.length >= 3 && state.wall.length > 0) actions.push({ type: "kong", tiles: [same[0]!, same[1]!, same[2]!] });
    if (seat === nextSeat(window.from) && isSuited(kind)) {
      for (let start = Math.max(0, kind - 2); start <= kind; start++) {
        if (!canStartChow(start)) continue;
        const [a, b] = [start, start + 1, start + 2].filter((k) => k !== kind) as [TileKind, TileKind];
        const ta = ofKind(a)[0];
        const tb = ofKind(b)[0];
        if (ta !== undefined && tb !== undefined) actions.push({ type: "chow", tiles: [ta, tb] });
      }
    }
  }

  if (actions.length > 0) actions.push({ type: "pass" });
  return actions;
}

/**
 * Identity of an action for legality checks. Set-forming actions are identified by the kinds of their
 * tiles, so any equivalent selection of hand tiles matches the listed option.
 */
function actionKey(action: Action): string {
  switch (action.type) {
    case "discard":
    case "addedKong":
      return `${action.type}:${action.tile}`;
    case "concealedKong":
    case "pung":
    case "kong":
    case "chow":
      return `${action.type}:${action.tiles.map(kindOf).sort((x, y) => x - y).join(",")}`;
    default:
      return action.type;
  }
}

/** The selected tiles are distinct and all in the player's hand. */
function holdsSelection(hand: readonly TileId[], action: Action): boolean {
  if (!("tiles" in action)) return true;
  return new Set(action.tiles).size === action.tiles.length && action.tiles.every((t) => hand.includes(t));
}

/** Apply one seat's action. Pure: `prev` is never modified. Only actions matching `legalActions` are accepted. */
export function applyAction(prev: HandState, seat: Seat, action: Action): ApplyResult {
  const key = actionKey(action);
  if (!legalActions(prev, seat).some((a) => actionKey(a) === key)) {
    return { ok: false, error: `Illegal action ${key} for seat ${seat} in phase ${prev.phase.kind}` };
  }
  if (!holdsSelection(prev.players[seat]!.hand, action)) {
    return { ok: false, error: `Seat ${seat} doesn't hold the selected tiles` };
  }

  const state = clone(prev);
  const events: GameEvent[] = [];
  const phase = state.phase;
  const player = state.players[seat]!;

  if (phase.kind === "claimWindow") {
    if (action.type === "pass") {
      phase.passed[seat] = true;
      if (phase.passed.every(Boolean)) noClaim(state, events);
    } else claim(state, events, seat, action);
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
      finishWin(state, events, seat, state.lastDrawn!, true, null, false);
      break;
    case "concealedKong": {
      removeTiles(player.hand, action.tiles);
      const meld: Meld = { type: "kong", tiles: sortTiles(action.tiles), concealed: true, claimed: null };
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
 * Close the claim window now: everyone who hasn't claimed passes. The server calls this when the claim
 * timer runs out.
 */
export function closeClaimWindow(prev: HandState): ApplyResult {
  if (prev.phase.kind !== "claimWindow") return { ok: false, error: "No claim window is open" };
  const state = clone(prev);
  const events: GameEvent[] = [];
  noClaim(state, events);
  return { ok: true, state, events };
}

/** Seats that can still claim (or pass) in the current claim window. */
export function pendingClaimants(state: HandState): Seat[] {
  const { phase } = state;
  return phase.kind === "claimWindow" ? SEATS.filter((s) => !phase.passed[s]) : [];
}

function openClaimWindow(state: HandState, events: GameEvent[], source: ClaimSource, from: Seat, tile: TileId) {
  const window: ClaimWindow = { kind: "claimWindow", source, from, tile, passed: [false, false, false, false] };
  state.phase = window;
  // Seats with nothing to claim pass immediately, so nobody waits on them.
  for (const s of SEATS) if (claimOptions(state, s, window).length === 0) window.passed[s] = true;

  if (window.passed.every(Boolean)) noClaim(state, events);
  else events.push({ type: "claimWindowOpened", source, from, tile });
}

/** First come, first served: a valid claim takes the tile immediately and closes the window. */
function claim(state: HandState, events: GameEvent[], seat: Seat, action: Action) {
  const { source, from, tile } = state.phase as ClaimWindow;
  const player = state.players[seat]!;
  if (source === "discard") state.players[from]!.discards.pop();

  if (action.type === "win") {
    player.hand = sortTiles([...player.hand, tile]);
    finishWin(state, events, seat, tile, false, from, source === "addedKong");
    return;
  }
  if (action.type !== "pung" && action.type !== "kong" && action.type !== "chow") {
    throw new Error(`Not a claim: ${action.type}`);
  }

  removeTiles(player.hand, action.tiles);
  const meld: Meld = {
    type: action.type,
    tiles: sortTiles([...action.tiles, tile]),
    concealed: false,
    claimed: { tile, from },
  };
  player.melds.push(meld);
  events.push({ type: "melded", seat, meld });

  if (meld.type === "kong") draw(state, events, seat, true);
  else {
    state.phase = { kind: "awaitDiscard", seat, drew: false };
    state.lastDrawn = null;
  }
}

/** Nobody claimed: an added kong completes; a discard stays in the pond and the next player draws. */
function noClaim(state: HandState, events: GameEvent[]) {
  const { source, from, tile } = state.phase as ClaimWindow;
  if (source === "addedKong") completeAddedKong(state, events, from, tile);
  else draw(state, events, nextSeat(from), false);
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
  winner: Seat,
  tile: TileId,
  selfDraw: boolean,
  from: Seat | null,
  robbedKong: boolean,
) {
  const result = {
    kind: "win" as const,
    winner,
    tile,
    selfDraw,
    from,
    robbedKong,
    payments: scoreWin(winner, selfDraw, from),
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
