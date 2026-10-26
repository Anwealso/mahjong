import { countTiles, kindOf, type Action, type PlayerView } from "@mahjong/engine";
import {
  better,
  discardOptions,
  possibleUses,
  shape,
  shapeAfterUse,
  situation,
  throwPriority,
  winsWith,
  type DiscardOption,
  type Shape,
  type Situation,
} from "./evaluate";
import { find, type Policy } from "./policy";
import { shanten } from "./shanten";

/**
 * Medium: plays for speed. Discards to the fewest tiles from ready, then the most unseen tiles that
 * improve the hand. Claims a discard only when it gets closer to ready. Always takes a win.
 */
export function mediumPolicy(): Policy {
  return (view, legal) => decide(view, legal, rankDiscards);
}

/** A discard ranking: best first. Hard swaps in its own (with defence). */
export type DiscardRanker = (s: Situation, options: DiscardOption[]) => DiscardOption[];

export const rankDiscards: DiscardRanker = (_s, options) =>
  [...options].sort(
    (a, b) => a.shanten - b.shanten || b.ukeire - a.ukeire || throwPriority(b.kind) - throwPriority(a.kind),
  );

/** The shared decision logic for Medium and Hard. */
export function decide(view: PlayerView, legal: Action[], rank: DiscardRanker): Action {
  const win = find(legal, "win") ?? find(legal, "selfDrawWin");
  if (win) return win;
  const s = situation(view);
  const { phase } = view;

  if (phase.kind === "claimWindow") {
    const claim = find(legal, "claim");
    const pass = find(legal, "pass")!;
    if (!claim) return pass;
    if (winsWith(s, phase.tile)) return claim;
    const now = shape(s.counts, s.melds, s.unseen);
    const best = bestUse(s, phase.tile, phase.from);
    return best && best.shanten < now.shanten ? claim : pass;
  }

  if (phase.kind === "claimed") return bestSetOption(s, legal);

  // Our turn: kongs first if they don't hurt, then discard.
  const options = rank(s, discardOptions(s));
  const discardBest = options[0]!;
  const concealed = find(legal, "concealedKong");
  if (concealed) {
    const counts = [...s.counts];
    counts[kindOf(concealed.tiles[0]!)]! -= 4;
    if (shanten(counts, s.melds + 1) <= discardBest.shanten) return concealed;
  }
  const added = legal.find((a) => a.type === "addedKong");
  if (added && added.type === "addedKong") {
    const counts = countTiles(view.hand.filter((t) => t !== added.tile));
    if (shanten(counts, s.melds) <= discardBest.shanten) return added;
  }
  return legal.find((a) => a.type === "discard" && kindOf(a.tile) === discardBest.kind) ?? find(legal, "discard")!;
}

/** The best set we could make with a discard, or null if none. */
export function bestUse(s: Situation, tile: number, from: number): Shape | null {
  let best: Shape | null = null;
  for (const use of possibleUses(s, tile, from)) {
    const after = shapeAfterUse(s, use);
    if (!best || better(after, best)) best = after;
  }
  return best;
}

/** After claiming: pick the set option that leaves the best hand. */
export function bestSetOption(s: Situation, legal: Action[]): Action {
  let best: { action: Action; shape: Shape } | null = null;
  for (const a of legal) {
    if (a.type !== "pung" && a.type !== "kong" && a.type !== "chow") continue;
    const after = shapeAfterUse(s, { type: a.type, kinds: a.tiles.map(kindOf) });
    if (!best || better(after, best.shape)) best = { action: a, shape: after };
  }
  return best?.action ?? legal[0]!;
}
