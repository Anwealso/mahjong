import { isHonor, kindCode, kindName, rankOf, suitOf, type TileKind } from "@mahjong/engine";
import type { CSSProperties } from "react";

const HONOR_GLYPHS: Record<string, string> = { E: "東", S: "南", W: "西", N: "北", R: "中", G: "發", Wh: "" };
const SUIT_GLYPHS = { characters: "萬", dots: "●", bamboo: "|" } as const;

export interface TileProps {
  /** Omit for a face-down tile. */
  kind?: TileKind;
  size?: "md" | "sm" | "xs";
  selected?: boolean;
  /** Outline colours, one ring per colour (a tile can belong to several claim options). */
  rings?: readonly string[];
  /** Pulsing glow: this tile wants your attention (a discard you can claim). */
  glow?: boolean;
  /** Marks the latest discard. */
  latest?: boolean;
  dim?: boolean;
}

/**
 * v1 placeholder tile: a CSS box with a label. Everything that draws a tile goes through here, so an SVG
 * tile set can replace it in one place later.
 */
export function Tile({ kind, size = "md", selected, rings = [], glow, latest, dim }: TileProps) {
  const classes = ["tile", `tile-${size}`];
  if (kind === undefined) classes.push("tile-back");
  else classes.push(`tile-${suitOf(kind)}`);
  if (selected) classes.push("tile-selected");
  if (glow) classes.push("tile-glow");
  if (latest) classes.push("tile-latest");
  if (dim) classes.push("tile-dim");
  const style: CSSProperties | undefined = rings.length
    ? { outline: "none", boxShadow: rings.map((c, i) => `0 0 0 ${3 * (i + 1)}px ${c}`).join(", ") }
    : undefined;

  if (kind === undefined) return <div className={classes.join(" ")} />;
  const suit = suitOf(kind);
  return (
    <div className={classes.join(" ")} style={style} title={kindName(kind)} data-kind={kindCode(kind)}>
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
