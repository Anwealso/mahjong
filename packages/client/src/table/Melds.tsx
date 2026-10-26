import { kindOf, type Meld, type TileId } from "@mahjong/engine";
import { Tile } from "../Tile";

/** Locked sets, face up. A concealed kong is shown too: everyone knows its kind. */
export function Melds({ melds, size }: { melds: Meld[]; size: "md" | "sm" | "xs" }) {
  return (
    <>
      {melds.map((m) => (
        <div key={m.tiles.join(",")} className={`meld meld-${m.type}`} title={m.concealed ? "Concealed kong" : m.type}>
          {m.tiles.map((t) => (
            <Tile key={t} kind={kindOf(t)} size={size} dim={m.claimed?.tile === t} />
          ))}
        </div>
      ))}
    </>
  );
}

/** Concealed tiles revealed at the end of the hand, in groups (a winning hand's sets and pair). */
export function RevealedGroups(props: { groups: TileId[][]; size: "md" | "sm" | "xs"; winningTile?: TileId | null }) {
  return (
    <>
      {props.groups.map((g) => (
        <div key={g.join(",")} className="meld revealed-group">
          {g.map((t) => (
            <Tile key={t} kind={kindOf(t)} size={props.size} glow={t === props.winningTile} />
          ))}
        </div>
      ))}
    </>
  );
}
