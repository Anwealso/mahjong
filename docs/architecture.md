# Architecture

> Why each choice was made (and what else was considered) lives in [decisions.md](decisions.md).

Browser-based, real-time, 4-player **Hong Kong "Chicken Hand" (雞糊)** mahjong for a group of friends
playing together over a voice call. Desktop only (for now).

## Decisions at a glance

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One type system across engine, server, and client |
| Repo | npm workspaces monorepo (`packages/*`) | Engine is shared by server and client; no publishing step |
| Rules engine | Pure TS, no I/O, no clock, no randomness except a seeded PRNG | Deterministic → unit-testable, replayable, bot-friendly |
| Server | Node + [`ws`](https://github.com/websockets/ws), in-memory rooms, single process | Friends-scale; easiest to run and debug locally |
| Message validation | `zod` schemas at the socket boundary | Never trust client input |
| Client | React + Vite, Zustand for state, CSS/SVG tiles | Tiles are just DOM elements; no canvas engine needed |
| Tests | Vitest | Fast, TS-native, same runner for all packages |
| Hosting | One service on Fly.io or Railway that serves the built client **and** the WebSocket on the same origin | ~$0–5/mo, no CORS, one deploy |
| Persistence | None in v1 (room codes + nicknames). Optional SQLite action log later | Deterministic replay makes adding it cheap |

## Ruleset

The game rules (Hong Kong Chicken Hand, v1 defaults and configurable variants) are specified in
[rules.md](rules.md). The engine must match that document; if they disagree, fix one of them.

## Packages

```
packages/
  engine/    pure rules: tiles, wall, win detection, the hand state machine, scoring, view projection
  protocol/  (milestone 3) zod schemas + TS types for every client↔server message
  server/    rooms, lobby, seat controllers, claim timers, WebSocket transport
  client/    React UI: lobby, table, hand, action bar
```

Dependencies point one way: `client` and `server` → `protocol` → `engine`. The engine imports nothing.

Packages export their TypeScript source directly (`"exports": "./src/index.ts"`); Vite and `tsx` compile on
the fly, so there's no build step between packages during development.

## The core idea: server-authoritative, view-projected

```
          ┌────────────────────────── server (one Room per game) ──────────────────────────┐
          │                                                                                │
 action → │  validate (zod) → engine.applyAction(state, seat, action) → new state + events │
          │                                     │                                          │
          │                     for each seat:  engine.projectView(state, seat)            │
          │                                     │                                          │
          │          ┌──────────────┬───────────┴───┬──────────────┐                       │
          │       Seat 0         Seat 1         Seat 2         Seat 3   (SeatControllers)  │
          └──────────┼──────────────┼───────────────┼──────────────┼───────────────────────┘
                     │ ws           │ ws            │ (future bot) │ ws
                  browser        browser        in-process      browser
```

1. The **full `GameState` never leaves the server.** It contains every hand and the wall order.
2. After every state change the server computes a **`PlayerView`** per seat: your own tiles, everyone's
   exposed melds and discards, tile *counts* for opponents' hands, the wall count, whose turn, the claim
   deadline, scores. This is what gets sent, along with that seat's **`legalActions`**.
3. The client is "dumb": it renders the view and shows buttons for exactly the legal actions the server
   sent. It never decides what's legal, so client and server can't disagree.
4. Every message carries a full snapshot (a view is a few KB). No diffing means reconnecting is just
   "send the current snapshot again". Each update also carries a short list of seat-filtered **events**
   (`drew`, `discarded`, `claimed pung`, …) purely so the client can animate.

### Seat controllers (this is what makes bots possible)

The `Room` never talks to sockets directly. Each seat has a controller:

```ts
interface SeatController {
  /** Called after every state change with exactly what this seat may see and do. */
  update(view: PlayerView, legalActions: Action[], events: GameEvent[]): void;
  dispose(): void;
}
// The controller answers by calling room.submit(seat, action, stateVersion).
```

- `HumanController` forwards updates over that player's WebSocket and passes incoming actions to the room.
- `BotController` (future) runs a strategy function in the same process. It receives the same
  `PlayerView` as a human, so a bot can't cheat by looking at hidden tiles, and its actions go through the
  same validation path.
- `AutopilotController` (v1, tiny): used when a human disconnects. It passes on claims and discards the
  tile it just drew once a timeout expires, so the game never stalls. It's the simplest possible bot, so
  the bot interface gets exercised from day one.

Swapping a seat between human, autopilot, and bot is just replacing its controller.

## Engine design

### Tiles

- `TileId` = 0–135: one id per **physical** tile. `TileKind` = 0–33: `kind = id >> 2`.
  - 0–8 Characters 1–9, 9–17 Dots 1–9, 18–26 Bamboo 1–9, 27–30 E S W N, 31–33 Red Green White.
- Hands are stored as `TileId[]` so animations can track individual tiles. Analysis (win checks, waits)
  works on a 34-slot count array.
- There's a compact notation for tests and debugging: `"123c 456d 789b EEE RR"`.

### Randomness

- A seeded PRNG (`mulberry32`) and Fisher–Yates shuffle. The server picks the seed with `crypto`; the
  engine never calls `Math.random()`.
- `game seed + action log` fully determines a game: replays, bug reports, and (later) crash recovery.

### Hand state machine

```
           ┌─────────────── deal ───────────────┐
           ▼                                    │
   ┌──────────────┐  discard   ┌──────────────┐ │ no claims / all pass
   │ AwaitDiscard │──────────▶│ ClaimWindow  │─┼──────────────▶ next player draws ──┐
   │ (turn seat)  │            │ (other seats)│ │                                    │
   └──────────────┘            └──────────────┘ │                                    │
     ▲  │  │ concealed/added kong      │ resolve by priority                         │
     │  │  └─ replacement draw ─▶(self)│                                             │
     │  │ self-draw win                ├─ chow/pung ──▶ AwaitDiscard (claimer)       │
     │  ▼                              ├─ kong ───────▶ replacement draw → AwaitDiscard
     │ HandOver ◀──────── win ─────────┘                                             │
     │    ▲                                                                          │
     │    └────────────── wall exhausted ────────────────────────────────────────────┤
     └───────────────────────────────────────────────────────────────────────────────┘
```

Phases (`Phase` in `engine/src/types.ts`): `awaitDiscard`, `claimWindow`, `handOver`. Draws are automatic
transitions, not player actions.

| Phase | Actor | Actions |
|---|---|---|
| `awaitDiscard` | turn seat | `discard(tile)`, `concealedKong(kind)`, `addedKong(tile)`, `selfDrawWin` (only if they drew) |
| `claimWindow` (discard) | each other seat | `pass`, `win`, `pung`, `kong`, `chow(tiles)` (chow: next seat only) |
| `claimWindow` (added kong) | each other seat | `pass`, `win`. Only opened when `robbingKong` is on |
| `handOver` | — | Nothing. Starting the next hand belongs to the game layer (milestone 5) |

Engine API (all pure; `engine/src/hand.ts` and `view.ts`). The engine models **one hand**; the multi-hand
game (dealer rotation, winds, running scores) wraps it in milestone 5.

```ts
startHand({ seed, rules?, dealer?, prevailingWind?, wall? }): { state: HandState, events }
legalActions(state, seat): Action[]                  // [] if it's not this seat's decision
applyAction(state, seat, action): { ok: true, state, events } | { ok: false, error }
closeClaimWindow(state): same result type            // server calls this when the 5s timer runs out
pendingClaimants(state): Seat[]                      // who the claim window is still waiting on
projectView(state, seat): PlayerView                 // the only thing that leaves the server
projectEvents(events, seat): GameEvent[]             // hides other players' drawn tiles
stackWall({ hands, draws?, replacements? })          // build an exact wall for tests and debugging
```

`applyAction` only accepts actions that appear in `legalActions`, so legality is defined in one place. It
never modifies its input; it deep-copies the state first (a few microseconds; a full random hand of ~100
moves runs in about 2.5 ms including view projection).

**The engine has no clock.** The server owns timers. When the claim deadline passes, it calls
`closeClaimWindow`, which treats every seat that hasn't answered as having passed. The window also closes
early once every seat that *can* claim has answered. Seats with no legal claim are auto-passed instantly,
and if nobody can claim at all, no window opens and the next player draws straight away (see
[D10](decisions.md#d10-claim-window-at-most-5-seconds-closes-early)).

Claim resolution: a win beats pung/kong, which beats chow. Ties between winners are settled by turn order after the
discarder (head bump), unless `multipleWinners: "all"`.

### Scoring

`scoreWin(winners, selfDraw, payer) → payments[4]` in `engine/src/scoring.ts`: the flat Chicken Hand
payment from [rules.md](rules.md). It's isolated so faan scoring can replace it later.

### Tests

- `hand.test.ts`: one scenario per rule, built with `stackWall` (priority, head bump, chow only from the
  left, all kong types, robbing, locked sets, passing up a win, end of wall, validation, views).
- `playout.test.ts`: 800 random hands (default rules and every option on). After every move it checks
  that every tile is in exactly one place, hand sizes are right, the game never gets stuck, payments sum
  to 0, and no player's view contains another player's concealed tiles or the wall.

## Server design

- **Room**: `code` (4 letters), lobby members, 4 seats, `GameState`, `stateVersion` (incremented on every
  change), action log, claim timer, controllers.
- **Stale-action protection**: clients send `stateVersion` with each action, and the server rejects
  mismatches. For example, clicking "Pung" just after the window closed gets rejected instead of applied
  to the wrong state.
- **Sessions & reconnect**: on first join the server issues a random `sessionToken`, which the client keeps
  in `localStorage`. Reconnecting with the token reattaches the same seat (the autopilot gives control
  back) and the current snapshot is sent straight away.
- **Lifecycle**: rooms live in a `Map<code, Room>` and are removed after ~30 min with nobody connected. A
  server restart loses in-progress games in v1. Persisting `seed + action log` to SQLite would make them
  recoverable later.

### Protocol (milestone 3, sketch)

Client → server:

```ts
{ t: "join", room: string, name: string, sessionToken?: string }
{ t: "takeSeat", seat: 0|1|2|3 } | { t: "startGame" }
{ t: "action", action: Action, stateVersion: number }
```

Server → client:

```ts
{ t: "welcome", sessionToken, you: { seat? } }
{ t: "lobby", members, seats }
{ t: "state", stateVersion, view: PlayerView, legalActions: Action[], events: GameEvent[] }
{ t: "error", code, message }
```

## Client design

- Zustand store holding `{ connection, lobby, latest snapshot }`, plus one WebSocket hook that reconnects
  automatically.
- Screens: **Join** (room code + nickname) → **Lobby** (pick a seat, start) → **Table**.
- Table layout: your hand along the bottom; opponents' face-down hands and exposed melds to the left, top,
  and right; a discard pond per player in the middle; wall count and prevailing wind in the center.
- Action bar: rendered straight from `legalActions`, with a countdown ring during claim windows. Keyboard
  shortcuts for speed (e.g. `P` pung, `C` chow, `K` kong, `H` win, `Space` pass).
- Tiles: CSS boxes with labels in v1, swapped for an open-source SVG tile set later.

## Build order

See [roadmap.md](roadmap.md).
