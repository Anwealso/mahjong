import { kindOf, type Meld } from "@mahjong/engine";
import { Tile } from "../Tile";

/** Locked sets, face up. A concealed kong is shown too: everyone knows its kind. */
export function Melds({ melds, size }: { melds: Meld[]; size: "md" | "sm" }) {
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
