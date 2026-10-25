import { kindOf } from "@mahjong/engine";
import { discardOptions, possibleUses, shapeAfterUse, situation, winsWith } from "./evaluate";
import { bestSetOption } from "./medium";
import { find, type Policy } from "./policy";
import { shanten } from "./shanten";

/** The unseen counts a beginner uses: only their own hand counted, nothing on the table. */
const naiveUnseen = (counts: number[]) => counts.map((n) => 4 - n);

/**
 * Easy: a beginner. Knows roughly which tiles are useful but often throws a random "reasonable" tile,
 * doesn't read the table, and claims erratically. Always takes a win; always declares kongs.
 */
export function easyPolicy(random: () => number = Math.random): Policy {
  return (view, legal) => {
    const win = find(legal, "win") ?? find(legal, "selfDrawWin");
    if (win) return win;
    const s = situation(view);
    s.unseen = naiveUnseen(s.counts);
    const { phase } = view;

    if (phase.kind === "claimWindow") {
      const claim = find(legal, "claim");
      const pass = find(legal, "pass")!;
      if (!claim) return pass;
      if (winsWith(s, phase.tile)) return claim;
      const now = shanten(s.counts, s.melds);
      for (const use of possibleUses(s, phase.tile, phase.from)) {
        if (shapeAfterUse(s, use).shanten >= now) continue;
        const keen = use.type === "chow" ? 0.2 : 0.5;
        if (random() < keen) return claim;
      }
      return pass;
    }

    if (phase.kind === "claimed") return bestSetOption(s, legal);

    const kong = find(legal, "concealedKong") ?? find(legal, "addedKong");
    if (kong) return kong;

    const options = discardOptions(s);
    const fewest = Math.min(...options.map((o) => o.shanten));
    const reasonable = options.filter((o) => o.shanten === fewest);
    const pick =
      random() < 0.4
        ? reasonable[Math.floor(random() * reasonable.length)]!
        : reasonable.reduce((a, b) => (b.ukeire > a.ukeire ? b : a));
    return legal.find((a) => a.type === "discard" && kindOf(a.tile) === pick.kind) ?? find(legal, "discard")!;
  };
}
