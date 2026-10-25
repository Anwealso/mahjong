import type { Contestant } from "./arena";
import { easyPolicy } from "./easy";
import { hardPolicy } from "./hard";
import { mediumPolicy } from "./medium";
import type { BotLevel, Policy } from "./policy";
import { randomPolicy } from "./random";

/** Make a policy for a level. `random` seeds any randomness (Easy's mistakes, Hard's sampling). */
export function policyFor(level: BotLevel | "random", random: () => number = Math.random): Policy {
  switch (level) {
    case "easy":
      return easyPolicy(random);
    case "medium":
      return mediumPolicy();
    case "hard":
      return hardPolicy({ random });
    case "random":
      return randomPolicy(random);
  }
}

export const contestant = (level: string): Contestant => ({
  name: level,
  make: (random) => policyFor(level as BotLevel | "random", random),
});
