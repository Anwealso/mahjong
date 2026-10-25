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
- `PolicyController` runs a strategy function (a `Policy`) in the same process: today the random-move
  bots, later smarter ones. It receives the same `PlayerView` as a human, so a bot can't cheat by looking
  at hidden tiles, and its actions go through the same validation path.
- A seated person who's offline has no controller: their decisions wait until they return or the host
  hands the seat to a bot ([D23](decisions.md#d23-host-seat-owned-scores-and-handling-dropouts)).

Swapping a seat between a person and a bot is just replacing its controller.

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
| `claimWindow` | each other seat that could use the tile | `claim` (first one takes it), `pass`. For an added kong (only when `robbingKong` is on), only seats that could win may claim |
| `claimed` | the claimer only | `win`, `pung(tiles)`, `kong(tiles)`, `chow(tiles)`: whichever apply. No pass |
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

Claim resolution is **first come, first served** ([D15](decisions.md#d15-claims-are-first-come-first-served))
and **two-step** ([D18](decisions.md#d18-claiming-is-two-steps-claim-the-tile-then-use-it)): the first
`claim` takes the tile and closes the window. The claimer then uses it in the `claimed` phase. Pung,
kong, chow, and concealed kong actions carry the exact hand tiles the player selected.

Views include each player's `concealedSets`: the most complete sets the server can find in their
concealed tiles (`maxConcealedSets` in `win.ts`). That's all anyone learns about another player's hidden
hand ([D19](decisions.md#d19-personal-groups-are-private-everyone-sees-complete-concealed-set-counts)).

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

- **Room**: a 4-letter code, members, a **host**, 4 seats, the **game settings** (`GameSettings`, set by
  the host before a game and copied into it), the **game** (engine `GameState`: dealer,
  prevailing wind, running seat scores, hand history), the current `HandState`, a `stateVersion`, timers,
  and a controller per seat. Every change goes through the room one message at a time, which is what makes
  claims first come, first served.
- **Room phases** (sent to everyone in the `lobby` message): `lobby` (no game) → `hand` → `handOver`
  (ready-up, 10 s countdown) or `windBreak` (unanimous continue vote) → … ; `paused` (game held in the
  lobby, from "Return to lobby" or a cancelled hand); `gameOver` (nobody left seated at a wind break). The
  rules for each are in [game-flow.md](game-flow.md).
- **Members**: anyone in the room. Seated members play; others watch from the lobby and can ask to play.
  The room creator hosts; hosting passes to the longest-present connected person if the host goes.
- **Seats**: scores belong to seats. A bot is a member with `bot: true`. When a bot replaces someone who
  disconnected or went idle, the seat is **reserved** for them: they take it back automatically on
  reconnecting (disconnected) or with a click (idle).
- **Seat issues**: during `hand`/`handOver` a seat is `empty` (its player left), `offline`, or `idle` (no
  move for 60 s on their decision). The host is prompted; the ready countdown stops while any seat has an
  issue. There's no autopilot: an absent player's decision just waits.
- **Stale-action protection**: every action quotes the `stateVersion` it was made against, and mismatches
  are rejected with `staleState`. For example, clicking "Pung" just after someone else claimed gets
  rejected instead of being applied to the wrong state. The version goes up on every visible change,
  **except a pass inside a claim window**. A pass is only sent back to the player who passed, so one
  player passing never makes another player's pending claim stale.
- **Timers**: the claim timer (5 s, remembers the version it belongs to, then `closeClaimWindow`), the
  idle timer (60 s on the deciding seat), the ready countdown (10 s between hands), and the wind-break
  removal delay (30 s). State messages include `claimMsLeft`; lobby messages include `readyMsLeft` and
  `voteRemoveMsLeft`.
- **Seat controllers**: `HumanController` forwards updates to a connection. `PolicyController` runs a
  `Policy` (a function from view + legal actions to an action) in-process after a short delay.
  `randomPolicy` plays the bots; future bots are just smarter policies.
- **Bots**: the host's `addBots` fills every empty seat with a bot member (never connected, named "Bot N")
  that plays `randomPolicy` after `botDelayMs` (1.5 s; `BOT_DELAY_MS` overrides it locally). Bots also
  take over from people who leave or are replaced. A person taking a bot's seat removes the bot.
- **Sessions & reconnect**: `welcome` gives each member a random `sessionToken`, which the client keeps in
  `localStorage`. Joining again with that token reclaims the same member and seat (from the bot keeping it,
  if the host had replaced them) and a fresh snapshot is sent. If the same member connects twice (say, two tabs), the newer
  connection wins.
- **Lifecycle**: every minute, rooms with nobody connected and no activity for 30 minutes are deleted, and
  watchers who disconnected more than 10 minutes ago are dropped from the rest (seated people and anyone a
  bot is keeping a seat for stay). A restart loses in-progress games ([D25](decisions.md#d25-flyio-in-sydney-one-machine-that-stops-when-idle-deploys-from-github-actions)): on SIGTERM/SIGINT the
  server sends everyone `serverRestarting` before closing. Persisting `seed + action log` would make games
  recoverable later.
- **Heartbeat**: every 25 s the server pings each socket and terminates any that didn't answer the
  previous ping, so a dropped connection becomes "offline" (and prompts the host) within a minute.
- **Limits**: incoming messages are capped at 16 KB and validated with zod before anything else touches
  them. At most 100 rooms (`serverFull`), 12 people per room (`roomFull`; reconnecting members always get
  back in), and 5 new rooms per minute per connection (`rateLimited`).
- **Production**: `npm run build` builds the client (Vite) and bundles the server, with the engine and
  protocol sources, into one `packages/server/dist/server.mjs` (esbuild). That process serves the client
  from `packages/client/dist` (`static.ts`: hashed `/assets/*` cached forever, `index.html` never cached,
  app links fall back to `index.html`, nothing outside the directory), `/health`, and `/ws`. Deployment:
  [deploy.md](deploy.md).

### Protocol

Defined in `packages/protocol/src/index.ts`. The zod schema for `Action` is checked at compile time to be
identical to the engine's `Action` type.

Client → server (all validated):

```ts
{ t: "createRoom", name }                           // create a room, join it, and host it
{ t: "join", room, name, sessionToken? }            // join, or rejoin as the same member with a token
{ t: "takeSeat", seat } | { t: "leaveSeat" }        // rules depend on the room phase (game-flow.md)
{ t: "requestSeat" }                                // watcher, mid-game: ask the host to play
{ t: "ready" } | { t: "returnToLobby" }             // between hands
{ t: "voteContinue" }                               // at a wind break (leaving = leaveSeat)
{ t: "action", action: Action, stateVersion }
// host only:
{ t: "addBots" } | { t: "removeMember", memberId } | { t: "replaceWithBot", seat } | { t: "cancelHand" }
{ t: "answerRequest", memberId, approve } | { t: "startGame" } | { t: "resumeGame" } | { t: "newGame" }
{ t: "updateSettings", settings: Partial<GameSettings> }   // before a game only
```

Server → client:

```ts
{ t: "welcome", room, memberId, sessionToken }
{ t: "lobby", room, hostId, phase, members: { id, name, seat, connected, bot }[], seats,
  seatInfo: { issue, reservedFor, ready, voted }[], settings: GameSettings, game: GameState | null,
  readyMsLeft, voteRemoveMsLeft, requests: { id, name }[] }
{ t: "state", stateVersion, view: PlayerView, legalActions: Action[], events: GameEvent[], claimMsLeft }
{ t: "error", code, message }   // badMessage | noSuchRoom | notInRoom | seatTaken | handInProgress |
                                // notEnoughPlayers | notSeated | staleState | illegalAction | notHost |
                                // notAllowed | serverFull | roomFull | rateLimited
{ t: "serverRestarting" }       // sent to everyone just before the server shuts down
```

### Server tests

- `room.test.ts`: the room with fake connections and stacked walls: the host and lobby rules, bots,
  per-seat views, stale actions, the claim timer, dropouts (waiting, replacing, reclaiming, cancelling),
  join requests, readying up and the countdown, pausing, wind breaks, and the end of the game.
- `server.test.ts`: real sockets: a health check, malformed messages, and four random players playing
  five full hands. Any error other than `staleState` fails the test.

## Client design

Code: `packages/client/src`. Rendering only; every rule decision comes from the server's `legalActions`.

- **`net/`**: `socket.ts` (one WebSocket to `/ws`, reconnecting with backoff) and `store.ts` (Zustand:
  connection status, session, lobby, latest snapshot, notices). The session (`room`, `memberId`,
  `sessionToken`) is kept in `localStorage`, so a refresh rejoins the same seat; the room code also goes in
  the URL hash (`/#ABCD`) so the link can be shared. A `staleState` error shows "Too late: someone else got
  there first".
- **Screens** follow the room phase (`App.tsx`): **Join** → **Lobby** (before a game, while paused, and for
  watchers during a game) → **Table** (seated, during `hand`/`handOver`) → **Wind break** (after the last
  hand's result) → **Celebration** (game over, or after leaving at a wind break). `net/room.ts` derives
  "me / my seat / am I host / names" from the lobby message.
- **Table extras for milestone 5**: running seat scores next to names, "Round N · 東", the end-of-hand
  panel (payments, totals, ready marks, countdown, Ready / Return to lobby), host prompts for seat issues
  and join requests (`table/HostPrompts.tsx`), and a Leave table button.
- **Table layout**: rotated so you're at the bottom; the next player (in turn order) is on your right,
  opposite across the top, previous on your left. Each player's discards sit in front of them in the
  centre, with the latest discard outlined. The centre shows the prevailing wind, the wall count, and the
  tile on offer during a claim window.
- **Opponents**: locked sets face up, then `concealedSets` face-down groups of three, then the remaining
  tiles face down and loose. At the end of the hand every hand is shown face up.
- **Your hand** (`table/MyHand.tsx`, logic in `hand/arrangement.ts`): locked sets on the far left, then
  your private groups, then loose tiles. Loose tiles can be dragged into any order (`dnd-kit`); **Sort**
  (`S`) tidies only the loose tiles. Only a complete set of loose tiles can be grouped. Order and groups
  are stored by `TileId` in `localStorage` per room and member; tiles that leave the hand drop out, a
  group that loses a tile breaks up, and new tiles are added at the end (the drawn tile is set slightly
  apart).
- **Selecting**: click tiles to select them; a **toolbar floats above the selection** with what you can
  do with it: **Discard** (`Enter`), **Group** / **Ungroup** (`G`), **Kong** (four of a kind, `K`), **Add
  to kong** (`K`). Each group also shows an Ungroup button on hover.
- **Claiming**: the claimable discard glows in its pond and in the centre, with a countdown ring from
  `claimMsLeft`. Click it or press `Space` to claim; `Esc` passes.
- **Using a claimed tile** (`hand/claimOptions.ts`): if there's only one way to use it, its tiles are
  pre-selected and one click (or `Enter`) confirms. With several, each set option gets its own colour:
  its candidate tiles are outlined in that colour and the action bar shows a button per option. Clicking
  a tile chooses an option that uses it (clicking a tile shared by several options cycles through them),
  and the floating button confirms. `P` / `C` / `K` choose pung / chow / kong options, `H` wins. Tiles
  are picked from loose tiles before grouped ones. The server only ever receives the tiles you confirmed.
- **Action bar**: a status line plus buttons built from `legalActions` (claim, pass, win, set options).
- **Sound** (`sound/`, details in [sound.md](sound.md)): when a `state` message arrives, the store passes
  its `events` to `soundsFor` (pure, unit tested), which picks the sounds; `player.ts` plays them with Web
  Audio. Recorded clips are in `public/sounds/`; alerts and fanfares are synthesised. The celebration
  screen and host prompts play their own sounds. Mute and volume live in the settings menu (gear, top left, `SettingsMenu.tsx`); `M` mutes anywhere.
- **Tiles**: `Tile.tsx` draws every tile (CSS boxes with labels for now, in three sizes), so an SVG tile
  set can replace it in one place.

## Build order

See [roadmap.md](roadmap.md).
