// Usage: npm run arena -w @mahjong/bots -- [hands] [level level level level]
//   e.g. npm run arena -w @mahjong/bots -- 2000 hard medium easy random
import { runArena } from "./arena";
import { contestant } from "./levels";

const args = process.argv.slice(2);
const hands = Number(args[0] ?? 1000);
const levels = args.length > 1 ? args.slice(1) : ["hard", "medium", "easy", "random"];
const started = performance.now();
const result = runArena(levels.map(contestant), hands, 1);
const seconds = (performance.now() - started) / 1000;

console.log(`${result.hands} hands, ${result.draws} draws (${pct(result.draws, result.hands)}), ${result.averageMoves.toFixed(0)} moves/hand, ${seconds.toFixed(1)} s\n`);
console.log("level     wins   win%   self-draws   deal-ins   points/hand");
for (const s of result.stats) {
  console.log(
    `${s.name.padEnd(8)} ${String(s.wins).padStart(5)} ${pct(s.wins, s.hands).padStart(6)} ${String(s.selfDraws).padStart(12)} ${String(s.dealIns).padStart(10)} ${(s.points / s.hands).toFixed(3).padStart(13)}`,
  );
}

function pct(n: number, of: number) {
  return `${((100 * n) / of).toFixed(1)}%`;
}
