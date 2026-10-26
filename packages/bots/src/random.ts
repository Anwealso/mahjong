import type { Policy } from "./policy";

/** Random legal moves, taking wins when offered. Only for tests and the arena. */
export function randomPolicy(random: () => number = Math.random): Policy {
  return (_view, legalActions) => {
    const win = legalActions.find((a) => a.type === "win" || a.type === "selfDrawWin");
    return win ?? legalActions[Math.floor(random() * legalActions.length)]!;
  };
}
