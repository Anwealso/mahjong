/** One physical tile, 0–135. Four copies of each kind: `kind = id >> 2`. */
export type TileId = number;

/**
 * A tile face, 0–33.
 *   0–8   Characters 1–9 (萬)
 *   9–17  Dots 1–9 (筒)
 *   18–26 Bamboo 1–9 (索)
 *   27–30 East, South, West, North
 *   31–33 Red, Green, White dragons
 */
export type TileKind = number;

export const NUM_TILES = 136;
export const NUM_KINDS = 34;
export const COPIES_PER_KIND = 4;

export type Suit = "characters" | "dots" | "bamboo" | "wind" | "dragon";

export const kindOf = (tile: TileId): TileKind => tile >> 2;

export const isSuited = (kind: TileKind): boolean => kind < 27;
export const isHonor = (kind: TileKind): boolean => kind >= 27;
export const isTerminal = (kind: TileKind): boolean => isSuited(kind) && (kind % 9 === 0 || kind % 9 === 8);

export function suitOf(kind: TileKind): Suit {
  if (kind < 9) return "characters";
  if (kind < 18) return "dots";
  if (kind < 27) return "bamboo";
  if (kind < 31) return "wind";
  return "dragon";
}

/** 1–9 for suited tiles, 1–4 for winds (E S W N), 1–3 for dragons (R G W). */
export function rankOf(kind: TileKind): number {
  if (kind < 27) return (kind % 9) + 1;
  if (kind < 31) return kind - 27 + 1;
  return kind - 31 + 1;
}

/** Can `kind` start a chow (i.e. kind, kind+1, kind+2 are in the same suit)? */
export const canStartChow = (kind: TileKind): boolean => isSuited(kind) && kind % 9 <= 6;

const SUIT_LETTERS = ["c", "d", "b"] as const;
const HONOR_CODES = ["E", "S", "W", "N", "R", "G", "Wh"] as const;
const HONOR_NAMES = ["East", "South", "West", "North", "Red Dragon", "Green Dragon", "White Dragon"] as const;
const SUIT_NAMES = ["Characters", "Dots", "Bamboo"] as const;

/** Short code: "3c", "9b", "E", "R", "Wh". */
export function kindCode(kind: TileKind): string {
  if (isSuited(kind)) return `${rankOf(kind)}${SUIT_LETTERS[Math.floor(kind / 9)]}`;
  return HONOR_CODES[kind - 27]!;
}

/** Human name: "3 Characters", "East", "Red Dragon". */
export function kindName(kind: TileKind): string {
  if (isSuited(kind)) return `${rankOf(kind)} ${SUIT_NAMES[Math.floor(kind / 9)]}`;
  return HONOR_NAMES[kind - 27]!;
}

/**
 * Parse compact notation into kinds. Groups are whitespace separated.
 *   Suited: digits followed by a suit letter — "123c", "55d", "789b".
 *   Honors: repeated codes — "EEE", "RR", "WhWh", "ESWN".
 * Example: parseKinds("123c 456d 789b EEE RR")
 */
export function parseKinds(notation: string): TileKind[] {
  const out: TileKind[] = [];
  for (const group of notation.trim().split(/\s+/).filter(Boolean)) {
    const suited = /^([1-9]+)([cdb])$/.exec(group);
    if (suited) {
      const base = SUIT_LETTERS.indexOf(suited[2] as (typeof SUIT_LETTERS)[number]) * 9;
      for (const digit of suited[1]!) out.push(base + Number(digit) - 1);
      continue;
    }
    let rest = group;
    while (rest.length > 0) {
      // "Wh" must be tried before "W".
      const code = HONOR_CODES.find((c) => c.length === 2 && rest.startsWith(c)) ??
        HONOR_CODES.find((c) => rest.startsWith(c));
      if (!code) throw new Error(`Bad tile notation: "${group}"`);
      out.push(27 + HONOR_CODES.indexOf(code));
      rest = rest.slice(code.length);
    }
  }
  return out;
}

/** Format kinds back into compact notation, sorted and grouped by suit. */
export function formatKinds(kinds: readonly TileKind[]): string {
  const sorted = [...kinds].sort((a, b) => a - b);
  const groups: string[] = [];
  for (let s = 0; s < 3; s++) {
    const ranks = sorted.filter((k) => Math.floor(k / 9) === s && isSuited(k)).map(rankOf);
    if (ranks.length) groups.push(`${ranks.join("")}${SUIT_LETTERS[s]}`);
  }
  for (let k = 27; k < NUM_KINDS; k++) {
    const n = sorted.filter((x) => x === k).length;
    if (n) groups.push(kindCode(k).repeat(n));
  }
  return groups.join(" ");
}

/** 34-slot histogram of kinds. */
export function countKinds(kinds: Iterable<TileKind>): number[] {
  const counts = new Array<number>(NUM_KINDS).fill(0);
  for (const k of kinds) counts[k]!++;
  return counts;
}

export const countTiles = (tiles: Iterable<TileId>): number[] => countKinds(Array.from(tiles, kindOf));

/** Sort tiles for display: by kind, then by id. */
export const sortTiles = (tiles: readonly TileId[]): TileId[] => [...tiles].sort((a, b) => a - b);
