import type { TileId } from "@mahjong/engine";
import { useEffect, useMemo, useState } from "react";
import { EMPTY_ARRANGEMENT, reconcile, type Arrangement } from "./arrangement";

/** Your hand's layout, kept in localStorage per room and member so it survives a refresh. */
export function useArrangement(storageKey: string, hand: readonly TileId[]) {
  const [stored, setStored] = useState<Arrangement>(() => load(storageKey));
  const arrangement = useMemo(() => reconcile(stored, hand), [stored, hand]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(arrangement));
  }, [storageKey, arrangement]);

  return [arrangement, setStored] as const;
}

function load(key: string): Arrangement {
  try {
    const a = JSON.parse(localStorage.getItem(key) ?? "null") as Arrangement | null;
    return a && Array.isArray(a.groups) && Array.isArray(a.loose) ? a : EMPTY_ARRANGEMENT;
  } catch {
    return EMPTY_ARRANGEMENT;
  }
}
