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
  protocol/  zod schemas + TS types for every client↔server message
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
     ▲  │  │ concealed/added kong      │ first claim takes it                        │
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

Claim resolution is **first come, first served** ([D15](decisions.md#d15-claims-are-first-come-first-served)):
the first valid claim takes the tile and closes the window immediately. Pung, kong, chow, and concealed
kong actions carry the exact hand tiles the player selected ([D16](decisions.md#d16-players-select-tiles-to-form-sets-hand-order-is-client-side-only)).

### Scoring

`scoreWin(winners, selfDraw, payer) → payments[4]` in `engine/src/scoring.ts`: the flat Chicken Hand
payment from [rules.md](rules.md). It's isolated so faan scoring can replace it later.

### Tests

- `hand.test.ts`: one scenario per rule, built with `stackWall` (first-come claims, tile selection, chow only from the
  left, all kong types, robbing, locked sets, passing up a win, end of wall, validation, views).
- `playout.test.ts`: 800 random hands (default rules and every option on). After every move it checks
  that every tile is in exactly one place, hand sizes are right, the game never gets stuck, payments sum
  to 0, and no player's view contains another player's concealed tiles or the wall.

## Server design

Code: `packages/server/src`. `app.ts` (HTTP + WebSocket wiring), `registry.ts` (rooms by code),
`room.ts` (one table), `controllers.ts` (who plays each seat).

- **Room**: a 4-letter code, members, 4 seats, the current `HandState`, a `stateVersion`, the claim timer,
  and a controller per seat. Every change goes through the room one message at a time, which is what
  makes claims first come, first served.
- **Members**: anyone in the room. Seated members play; others just see the lobby (spectating could come
  later). Seats can't change during a hand. A hand starts when all four seats are filled and someone
  sends `startHand`.
- **Stale-action protection**: every action quotes the `stateVersion` it was made against, and mismatches
  are rejected with `staleState`. For example, clicking "Pung" just after someone else claimed gets
  rejected instead of being applied to the wrong state. The version goes up on every visible change,
  **except a pass inside a claim window**. A pass is only sent back to the player who passed, so one
  player passing never makes another player's pending claim stale.
- **Claim timer**: when a claim window opens, the room starts a 5-second timer that remembers the version
  it belongs to. If the window is still open when it fires, the room calls `closeClaimWindow`. State
  messages include `claimMsLeft` for the countdown.
- **Seat controllers**: `HumanController` forwards updates to a connection. `PolicyController` runs a
  `Policy` (a function from view + legal actions to an action) in-process after a short delay.
  `autopilotPolicy` (pass on claims, discard the drawn tile) covers disconnected players; `randomPolicy`
  is there for testing; future bots are just smarter policies.
- **Sessions & reconnect**: `welcome` gives each member a random `sessionToken`, which the client keeps in
  `localStorage`. Joining again with that token reclaims the same member and seat: the autopilot hands
  back control and a fresh snapshot is sent. If the same member connects twice (say, two tabs), the newer
  connection wins.
- **Lifecycle**: rooms with nobody connected and no activity for 30 minutes are swept away every minute.
  A server restart loses in-progress games in v1. Persisting `seed + action log` to SQLite would make them
  recoverable later.
- **Limits**: incoming messages are capped at 16 KB and validated with zod before anything else touches
  them.

### Protocol

Defined in `packages/protocol/src/index.ts`. The zod schema for `Action` is checked at compile time to be
identical to the engine's `Action` type.

Client → server (all validated):

```ts
{ t: "createRoom", name }                           // create a room and join it
{ t: "join", room, name, sessionToken? }            // join, or rejoin as the same member with a token
{ t: "takeSeat", seat: 0|1|2|3 } | { t: "leaveSeat" }
{ t: "startHand" }                                  // needs 4 seated players and no hand in progress
{ t: "action", action: Action, stateVersion }
```

Server → client:

```ts
{ t: "welcome", room, memberId, sessionToken }
{ t: "lobby", room, members: { id, name, seat, connected }[], seats, handInProgress }
{ t: "state", stateVersion, view: PlayerView, legalActions: Action[], events: GameEvent[], claimMsLeft }
{ t: "error", code, message }   // badMessage | noSuchRoom | notInRoom | seatTaken | handInProgress |
                                // notEnoughPlayers | notSeated | staleState | illegalAction
```

### Server tests

- `room.test.ts`: the room with fake connections and stacked walls (lobby rules, per-seat views, stale
  actions, a pass not making other claims stale, the claim timer, the autopilot, reconnecting).
- `server.test.ts`: real sockets: a health check, malformed messages, and four random players playing
  five full hands. Any error other than `staleState` fails the test.

## Client design

- Zustand store holding `{ connection, lobby, latest snapshot }`, plus one WebSocket hook that reconnects
  automatically.
- Screens: **Join** (room code + nickname) → **Lobby** (pick a seat, start) → **Table**.
- Table layout: your hand along the bottom; opponents' face-down hands and exposed melds to the left, top,
  and right; a discard pond per player in the middle; wall count and prevailing wind in the center.
- **Your hand is yours to arrange:** drag tiles into any order to group partly formed sets. The order is
  kept client-side by `TileId`. New tiles are added at the end, and the order is never sent to the server.
- **Select, then declare:** to claim a pung, kong, or chow (or declare a concealed kong), select the tiles in
  your hand, then press the button. The action carries exactly those tiles. Nothing is formed automatically.
- Action bar: rendered straight from `legalActions`, with a countdown ring during claim windows. Keyboard
  shortcuts for speed (e.g. `P` pung, `C` chow, `K` kong, `H` win, `Space` pass).
- Tiles: CSS boxes with labels in v1, swapped for an open-source SVG tile set later.

## Build order

See [roadmap.md](roadmap.md).
