import { isHonor, kindCode, kindName, rankOf, suitOf, type TileKind } from "@mahjong/engine";

const HONOR_GLYPHS: Record<string, string> = { E: "東", S: "南", W: "西", N: "北", R: "中", G: "發", Wh: "" };
const SUIT_GLYPHS = { characters: "萬", dots: "●", bamboo: "|" } as const;

/** v1 placeholder tile: a CSS box with a label. Swapped for an SVG tile set later. */
export function Tile({ kind, highlight = false }: { kind: TileKind; highlight?: boolean }) {
  const suit = suitOf(kind);
  return (
    <div className={`tile tile-${suit}${highlight ? " tile-highlight" : ""}`} title={kindName(kind)}>
      {isHonor(kind) ? (
        <span className="tile-honor">{HONOR_GLYPHS[kindCode(kind)]}</span>
      ) : (
        <>
          <span className="tile-rank">{rankOf(kind)}</span>
          <span className="tile-suit">{SUIT_GLYPHS[suit as keyof typeof SUIT_GLYPHS]}</span>
        </>
      )}
    </div>
  );
}
