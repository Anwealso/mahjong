import {
  buildWall,
  countTiles,
  DEFAULT_RULES,
  formatKinds,
  isWinningHand,
  kindOf,
  sortTiles,
  waitingKinds,
} from "@mahjong/engine";
import { useMemo, useState } from "react";
import { Tile } from "./Tile";

/**
 * Engine playground until the real lobby/table lands (milestone 4).
 * Deals a hand from a seeded wall; click a tile to discard it and draw the next one.
 */
export function App() {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2 ** 32));
  const wall = useMemo(() => buildWall(seed), [seed]);
  const [drawn, setDrawn] = useState(14);
  const [hand, setHand] = useState(() => sortTiles(wall.slice(0, 14)));

  const redeal = () => {
    const next = Math.floor(Math.random() * 2 ** 32);
    setSeed(next);
    setHand(sortTiles(buildWall(next).slice(0, 14)));
    setDrawn(14);
  };

  const discard = (tile: number) => {
    const next = wall[drawn];
    if (next === undefined) return;
    setHand(sortTiles([...hand.filter((t) => t !== tile), next]));
    setDrawn(drawn + 1);
  };

  const won = isWinningHand(countTiles(hand), 0, DEFAULT_RULES);
  const bestWaits = useMemo(() => {
    // For each possible discard, what would we be waiting on?
    const options = hand.map((t) => ({ tile: t, waits: waitingKinds(countTiles(hand.filter((x) => x !== t)), 0, DEFAULT_RULES) }));
    return new Set(options.filter((o) => o.waits.length > 0).map((o) => o.tile));
  }, [hand]);

  return (
    <main className="playground">
      <h1>雞糊 Chicken Hand — engine playground</h1>
      <p className="muted">
        Seed {seed} · wall {136 - drawn} left · click a tile to discard it and draw the next.
        {bestWaits.size > 0 && " Highlighted tiles put you one tile from winning."}
      </p>
      <div className="hand">
        {hand.map((t) => (
          <button key={t} className="tile-button" onClick={() => discard(t)} disabled={won}>
            <Tile kind={kindOf(t)} highlight={bestWaits.has(t)} />
          </button>
        ))}
      </div>
      <p className="mono">{formatKinds(hand.map(kindOf))}</p>
      {won && <p className="win">食糊! Winning hand.</p>}
      <button onClick={redeal}>Deal again</button>
    </main>
  );
}
