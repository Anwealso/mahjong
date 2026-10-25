import { formatKinds, kindOf, type Action, type TileId, type TileKind } from "@mahjong/engine";

export type SetAction = Extract<Action, { type: "pung" | "kong" | "chow" }>;

/** One way to use a claimed tile to form a set. */
export interface SetOption {
  key: string;
  type: SetAction["type"];
  /** The hand kinds this set needs (the claimed tile completes it). */
  kinds: TileKind[];
  /** Every hand tile that could be used: all tiles of the needed kinds. */
  candidates: TileId[];
  label: string;
  color: string;
}

/** Each option gets its own highlight colour. */
export const OPTION_COLORS = ["#4cc9f0", "#ff9f1c", "#c77dff", "#80ed99"] as const;

const TYPE_NAMES = { pung: "Pung", kong: "Kong", chow: "Chow" } as const;

/**
 * The set-forming options among `legalActions` after we've claimed `claimed`. The engine lists one
 * example choice of tiles per option; any tiles of the same kinds are accepted, so we work by kind.
 */
export function setOptions(legalActions: readonly Action[], hand: readonly TileId[], claimed: TileId): SetOption[] {
  const sets = legalActions.filter((a): a is SetAction => a.type === "pung" || a.type === "kong" || a.type === "chow");
  return sets.map((a, i) => {
    const kinds = a.tiles.map(kindOf);
    return {
      key: `${a.type}:${kinds.join(",")}`,
      type: a.type,
      kinds,
      candidates: hand.filter((t) => kinds.includes(kindOf(t))),
      label: `${TYPE_NAMES[a.type]} ${formatKinds([...kinds, kindOf(claimed)])}`,
      color: OPTION_COLORS[i % OPTION_COLORS.length]!,
    };
  });
}

/** Choose actual tiles for an option: one per needed kind, taking tiles `prefer` likes first. */
export function pickTiles(option: SetOption, prefer: (tile: TileId) => boolean): TileId[] {
  const ranked = [...option.candidates].sort((a, b) => Number(prefer(b)) - Number(prefer(a)));
  const picked: TileId[] = [];
  for (const kind of option.kinds) {
    const tile = ranked.find((t) => kindOf(t) === kind && !picked.includes(t));
    if (tile !== undefined) picked.push(tile);
  }
  return picked;
}

/** The action that forms `option` with exactly these tiles. */
export function setAction(option: SetOption, tiles: TileId[]): SetAction {
  return { type: option.type, tiles } as SetAction;
}

/**
 * Clicking `tile` while choosing: pick the next option that uses it, after `current` (so clicking a tile
 * shared by two options switches between them). Null if no option uses the tile.
 */
export function optionForTile(options: readonly SetOption[], tile: TileId, current: string | null): SetOption | null {
  const using = options.filter((o) => o.candidates.includes(tile));
  if (using.length === 0) return null;
  const at = using.findIndex((o) => o.key === current);
  return using[(at + 1) % using.length]!;
}
