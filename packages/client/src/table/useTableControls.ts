import { kindOf, type Action, type TileId } from "@mahjong/engine";
import { useCallback, useEffect, useMemo, useState } from "react";
import { findGroup, group, sortLoose, ungroup, type Arrangement } from "../hand/arrangement";
import { optionForTile, pickTiles, setAction, setOptions, type SetOption } from "../hand/claimOptions";
import { useArrangement } from "../hand/useArrangement";
import type { GameSnapshot } from "../net/store";

/** A button in the floating toolbar above your selection, or in the action bar. */
export interface Command {
  label: string;
  /** Shown as a hint, e.g. "G". */
  key?: string;
  color?: string;
  run(): void;
}

/**
 * Everything you can do at the table, derived from the snapshot and your local selection: the floating
 * selection toolbar, the action bar, and the keyboard shortcuts all use these same commands.
 */
export function useTableControls(game: GameSnapshot, storageKey: string, act: (action: Action) => void) {
  const { view, legalActions } = game;
  const { phase } = view;
  const [arrangement, setArrangement] = useArrangement(storageKey, view.hand);
  const [selection, setSelection] = useState<TileId[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);

  const has = (type: Action["type"]) => legalActions.some((a) => a.type === type);
  const claimedTile = phase.kind === "claimed" && phase.seat === view.seat ? phase.tile : null;
  const claimedByMe = claimedTile !== null;
  const myTurn = phase.kind === "awaitDiscard" && phase.seat === view.seat;

  const options: SetOption[] = useMemo(
    () => (claimedTile !== null ? setOptions(legalActions, view.hand, claimedTile) : []),
    [claimedTile, legalActions, view.hand],
  );
  const loose = useCallback((t: TileId) => arrangement.loose.includes(t), [arrangement]);
  const choose = useCallback(
    (option: SetOption) => {
      setChosen(option.key);
      setSelection(pickTiles(option, loose));
    },
    [loose],
  );

  // Selected tiles that left the hand drop out of the selection.
  useEffect(() => {
    setSelection((s) => (s.every((t) => view.hand.includes(t)) ? s : s.filter((t) => view.hand.includes(t))));
  }, [view.hand]);

  // Just claimed a tile: with only one way to use it, pre-select it so one click (or Enter) confirms.
  const claimKey = claimedByMe ? `${game.stateVersion}` : null;
  useEffect(() => {
    setChosen(null);
    if (claimKey === null) return;
    const only = options.length === 1 && !has("win") ? options[0] : undefined;
    if (only) choose(only);
    else setSelection([]);
  }, [claimKey]);

  const chosenOption = options.find((o) => o.key === chosen) ?? null;

  function clickTile(tile: TileId) {
    if (claimedByMe) {
      const option = optionForTile(options, tile, chosen);
      if (option) choose(option);
      return;
    }
    setSelection((s) => (s.includes(tile) ? s.filter((t) => t !== tile) : [...s, tile]));
  }

  const update = (next: Arrangement | null) => {
    if (next) {
      setArrangement(next);
      setSelection([]);
    }
  };

  // ---- commands ------------------------------------------------------------------------------------

  const groupIndex = findGroup(arrangement, selection);
  const groupCommand: Command | null =
    groupIndex >= 0
      ? { label: "Ungroup", key: "G", run: () => update(ungroup(arrangement, groupIndex)) }
      : group(arrangement, selection)
        ? { label: "Group", key: "G", run: () => update(group(arrangement, selection)) }
        : null;

  const single = selection.length === 1 ? selection[0]! : null;
  const discard = myTurn && single !== null && has("discard") ? single : null;
  const addedKong = myTurn
    ? legalActions.find((a) => a.type === "addedKong" && single !== null && a.tile === single)
    : undefined;
  const concealedKong = myTurn
    ? legalActions.find(
        (a) =>
          a.type === "concealedKong" &&
          selection.length === 4 &&
          selection.every((t) => kindOf(t) === kindOf(a.tiles[0]!)),
      )
    : undefined;

  const run = (action: Action) => {
    act(action);
    setSelection([]);
  };

  /** Floating toolbar above the selected tiles. */
  const selectionCommands: Command[] = [];
  if (chosenOption && selection.length > 0) {
    selectionCommands.push({
      label: chosenOption.label,
      key: "⏎",
      color: chosenOption.color,
      run: () => run(setAction(chosenOption, selection)),
    });
  }
  if (discard !== null) selectionCommands.push({ label: "Discard", key: "⏎", run: () => run({ type: "discard", tile: discard }) });
  if (addedKong) selectionCommands.push({ label: "Add to kong", key: "K", run: () => run(addedKong) });
  if (concealedKong) {
    selectionCommands.push({ label: "Kong", key: "K", run: () => run({ type: "concealedKong", tiles: selection }) });
  }
  if (!claimedByMe && groupCommand) selectionCommands.push(groupCommand);

  /** The action bar: decisions that don't depend on a selection. */
  const barCommands: Command[] = [];
  if (has("claim")) barCommands.push({ label: "Claim", key: "Space", run: () => act({ type: "claim" }) });
  if (has("pass")) barCommands.push({ label: "Pass", key: "Esc", run: () => act({ type: "pass" }) });
  if (has("win")) barCommands.push({ label: "Win 食糊", key: "H", run: () => act({ type: "win" }) });
  if (has("selfDrawWin")) barCommands.push({ label: "Win 自摸", key: "H", run: () => act({ type: "selfDrawWin" }) });
  for (const option of options) {
    barCommands.push({ label: option.label, color: option.color, run: () => act(setAction(option, pickTiles(option, loose))) });
  }

  const sort = () => setArrangement(sortLoose(arrangement));

  // ---- keyboard ------------------------------------------------------------------------------------

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const fire = (cmd: Command | null | undefined) => {
      if (!cmd) return false;
      e.preventDefault();
      cmd.run();
      return true;
    };
    const byLabel = (list: Command[], label: string) => list.find((c) => c.label.startsWith(label));
    const byType = (type: SetOption["type"]) => {
      // Pressing P / C / K again switches between options of that type.
      const ofType = options.filter((o) => o.type === type);
      const next = ofType[(ofType.findIndex((o) => o.key === chosen) + 1) % ofType.length];
      if (!next) return false;
      e.preventDefault();
      choose(next);
      return true;
    };

    if (key === " ") fire(byLabel(barCommands, "Claim"));
    else if (key === "escape") fire(byLabel(barCommands, "Pass")) || setSelection([]);
    else if (key === "enter") fire(selectionCommands[0]?.key === "⏎" ? selectionCommands[0] : null);
    else if (key === "h") fire(byLabel(barCommands, "Win"));
    else if (key === "g") fire(claimedByMe ? null : groupCommand);
    else if (key === "k") claimedByMe ? byType("kong") : fire(byLabel(selectionCommands, "Add to kong") ?? byLabel(selectionCommands, "Kong"));
    else if (key === "p") claimedByMe && byType("pung");
    else if (key === "c") claimedByMe && byType("chow");
    else if (key === "s") sort();
  };

  return {
    arrangement,
    setArrangement,
    selection,
    clickTile,
    options,
    chosenOption,
    claimedTile,
    myTurn,
    selectionCommands,
    barCommands,
    sort,
    ungroupAt: (i: number) => update(ungroup(arrangement, i)),
    onKey,
  };
}

export type TableControls = ReturnType<typeof useTableControls>;
