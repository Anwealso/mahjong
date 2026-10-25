# Development guide

## Prerequisites

- Node 24+ (developed on 24.14), npm 11+.

## Commands

```sh
npm install
npm run dev         # server (:8787) + client (http://localhost:5173) together
npm test            # vitest across all packages
npm run test:watch
npm run typecheck   # tsc in every package
```

In development, Vite proxies `/ws` to the server, so the client always connects to the same origin.
`GET http://localhost:8787/health` is a quick check that the server is running.

## Repo layout

```
docs/                 project docs (start at docs/README.md)
packages/
  engine/src/         pure rules engine
    tiles.ts          tile ids/kinds, names, notation parse/format, count helpers
    rng.ts            seeded PRNG + shuffle
    wall.ts           buildWall(seed)
    rules.ts          RuleConfig + DEFAULT_RULES
    win.ts            decompose, isWinningHand, waitingKinds, special hands
    *.test.ts         tests sit next to the code they test
  server/src/         Node + ws server (placeholder until milestone 3)
  client/src/         React + Vite app (engine playground until milestone 4)
package.json          npm workspaces + root scripts
tsconfig.base.json    shared strict TS config
vitest.config.ts      one test runner for all packages
```

## Conventions

**The engine stays pure.** Code in `packages/engine` must not:
- import from other packages, Node built-ins, or the DOM;
- call `Math.random()`, `Date.now()`, or timers. Randomness comes from a seed passed in; time lives in the server;
- mutate its inputs in a way callers can see.

That's what makes games replayable from `seed + action log` and lets bots and tests run the engine directly.

**The server is the authority.** The client renders `PlayerView` + `legalActions` and sends actions. It
never decides what's legal, and it never receives another seat's hidden tiles.

**Packages export source.** Each package's `exports` points at `src/index.ts`, so there's no build step
between packages. Vite (client) and `tsx` (server) compile TypeScript on the fly.

**Tests.** Use the compact tile notation to keep tests readable:

```ts
const counts = countKinds(parseKinds("123c 456d 789b EEE RR"));
expect(isWinningHand(counts, 0, DEFAULT_RULES)).toBe(true);
```

Prefer a property test (random playouts plus invariants) over listing every case for anything involving
turn flow.

**TypeScript.** The settings are strict, including `noUncheckedIndexedAccess`, so array reads are
`T | undefined`. Handle it, or use `!` only where an index is provably in range (as in hot loops over
34-slot count arrays).

**Docs.** When you make a significant choice, add an entry to [decisions.md](decisions.md). If a rule
changes, update [rules.md](rules.md) in the same change as the engine.

## Tooling versions

These were the latest versions at setup time: TypeScript 7, Vite 8, Vitest 5, React 19, Zustand 5,
zod 4, ws 8, tsx 4.
