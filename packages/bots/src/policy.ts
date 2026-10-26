import type { Action, PlayerView } from "@mahjong/engine";

/** Picks one of the legal actions, seeing only its own seat's view (so it can't cheat). */
export type Policy = (view: PlayerView, legalActions: Action[]) => Action;

/** The levels people can pick. Random exists for tests and the arena. */
export type BotLevel = "easy" | "medium" | "hard";
export const BOT_LEVELS: readonly BotLevel[] = ["easy", "medium", "hard"];

export const find = <T extends Action["type"]>(legal: Action[], type: T) =>
  legal.find((a): a is Extract<Action, { type: T }> => a.type === type);
