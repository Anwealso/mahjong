# Decision log

Short records of significant choices: what we picked, what else we considered, and why. Add new entries at
the bottom. To change a decision, mark the old entry **Superseded** and link to the new one rather than
deleting it.

---

## D1. Variant: Hong Kong Chicken Hand, flat payment, no flowers

**Status:** accepted · 2026-10-25

The group plays casual Cantonese mahjong. Chicken Hand (雞糊) means any 4 sets + pair wins with no minimum
score. That keeps the rules engine small, so most of the effort goes into turn and claim flow instead of
scoring. We play without flowers, and the discarder doesn't pay double.

**Considered:** Riichi (far more complex scoring), Chinese Official / MCR, Taiwanese 16-tile, and American
(the NMJL hand card is copyrighted and changes every year).

**Consequences:** scoring is a separate module behind a small interface, so faan scoring or flowers could
be added later. Rule variations are `RuleConfig` settings rather than code changes. See [rules.md](rules.md).

## D2. Real-time play, desktop only

**Status:** accepted · 2026-10-25

Friends play at the same time, usually on a voice call, so we need sub-second updates and server-side
timers for claim windows. Desktop screens only for now: mahjong hands are wide (14+ tiles plus melds), and
a phone layout would be a separate design project.

**Considered:** turn-based play over hours or days (that would mean an ordinary web API plus notifications
instead of WebSockets).

## D3. TypeScript monorepo with a pure, deterministic rules engine

**Status:** accepted · 2026-10-25

npm workspaces: `engine`, `protocol` (planned), `server`, `client`. The engine has no I/O, no clock, and no
randomness except a seeded PRNG. A game is fully determined by `seed + action log`.

**Why:** the engine can be unit-tested without a browser or server, shared by server and client, and
replayed for debugging. It's also exactly the interface a bot needs.

**Considered:** putting the rules inside the server (harder to test and couples rules to networking);
a different language for the server (loses the shared types).

## D4. Server-authoritative with per-seat projected views

**Status:** accepted · 2026-10-25

The full game state (every hand, the wall order) never leaves the server. After every change, each seat
gets a `PlayerView` with only what that player may see, plus its `legalActions`. The client renders those
and never decides legality itself.

**Why:** mahjong is a hidden-information game. If the browser received the full state, anyone could read
other hands in DevTools. Having the server send legal actions also means client and server can't disagree
about the rules.

**Considered:** peer-to-peer or client-side logic (trivially cheatable); the client computing legal moves
with the shared engine (possible, but risks the client and server drifting apart).

## D5. Full snapshots on every update, not diffs

**Status:** accepted · 2026-10-25

Each update carries the seat's whole `PlayerView` (a few KB) plus a short list of events for animation.

**Why:** reconnecting is just "send the latest snapshot". There are no patch-ordering bugs, and bandwidth
is irrelevant at 4 players.

**Considered:** sending diffs or patches (less data, but more failure modes).

## D6. Seat controllers, so server-side bots can be added later

**Status:** accepted · 2026-10-25 (bots themselves are deferred)

The `Room` talks to a `SeatController` per seat, never to sockets directly. Humans, the disconnect
autopilot, and future bots are all controllers. Bots get the same `PlayerView` as humans (so they can't
cheat) and submit actions through the same validation path.

**Why:** the user wants bots eventually, not now. This makes adding them a new class rather than a
refactor. A tiny autopilot (pass claims, discard what you drew) handles disconnects in v1 and exercises
the controller interface from day one.

## D7. Node + `ws`, single process, in-memory rooms

**Status:** accepted · 2026-10-25

**Why:** friends-scale load. It's the easiest setup to run, debug, and understand locally. Rooms are just
objects in a `Map`.

**Considered:**
- **Colyseus**: a full game-server framework with rooms and state sync built in. Its automatic state sync
  works against our per-seat views, and it adds a framework to learn.
- **PartyKit / Cloudflare Durable Objects**: a natural "one room = one object" model and practically
  free. Local development and debugging are less straightforward. It's still a good fallback if hosting
  costs or ops become annoying.
- **Socket.IO**: adds rooms and reconnection helpers we'd mostly reimplement anyway for seat sessions.

**Consequences:** a server restart loses in-progress games. That's acceptable for v1. Persisting
`seed + action log` (D3) to SQLite would fix it cheaply later.

## D8. Hosting: one service serving the client and the WebSocket on the same origin

**Status:** proposed · 2026-10-25 (decided at milestone 6)

Fly.io or Railway, about $0–5/month. Same origin means no CORS, and the client always connects to `/ws`.
In development, Vite proxies `/ws` to the server on `:8787`.

## D9. Client state: Zustand

**Status:** accepted · 2026-10-25

The client stores very little: connection status, lobby info, and the latest server snapshot (replaced
wholesale on each update). Local UI details like the selected tile stay in `useState`.

**Why Zustand:** the WebSocket lives outside the React tree and can write straight to the store
(`useGame.setState(...)`) with no provider. Components use selectors, so only the parts that changed
re-render (e.g. the claim countdown ticking doesn't re-render your hand). It's about 1 KB with no
boilerplate.

**Considered:**

| Option | Why not |
|---|---|
| `useReducer` + Context | Viable, but the socket has to live inside a provider component (awkward with StrictMode double-mounts and reconnects), and every consumer re-renders on every change |
| `useSyncExternalStore` + hand-written store | Also viable, with no dependency, but it's basically writing a small Zustand ourselves |
| Redux Toolkit | Too much; its strengths are for complex client-side state changes, and our state arrives finished from the server |
| Jotai | Suits many independent pieces of state; ours is one snapshot |
| MobX | Built around editing data in place; doesn't fit whole-snapshot replacement |
| TanStack Query | Built for request/response fetching, not data pushed over a WebSocket |
| XState | Nice for connection states, but the game logic lives on the server |

**Consequences:** all socket and store code lives in one module (`client/src/net/`), so swapping
libraries later only touches that module.

## D10. Claim window: at most 5 seconds, closes early

**Status:** accepted · 2026-10-25

The window lasts at most 5 seconds and closes as soon as every player who *could* claim has answered.
Players with no legal claim pass instantly.

**Why:** there's no point waiting once everyone eligible has answered.

**Trade-off accepted:** a long pause tells the table that someone has a claim option. A
`fixedClaimWindow` setting could always wait out the full timer if that ever bothers anyone.

## D11. No accounts in v1

**Status:** accepted · 2026-10-25

Players join by room code and nickname. A random `sessionToken` in `localStorage` lets a player reclaim
their seat after reconnecting. Accounts, game history, and stats can come later.

## D12. Placeholder CSS tiles first

**Status:** accepted · 2026-10-25

Tiles are styled boxes with characters and labels, so gameplay work isn't blocked on art. An open-source
SVG tile set comes later (check its license before adding it).

## D13. No kong payments; passing up a win is allowed

**Status:** accepted · 2026-10-25

- **No kong payments.** A kong is just a set, which keeps scoring flat.
- **Passing up a win is allowed** on both discards and self-draws, with no penalty and no restriction on
  later wins. Wins are never automatic, so players have to stay engaged.

## D14. Game structure: several hands with running points; the wall plays to the last tile

**Status:** accepted · 2026-10-25

- A hand ends at the first win. Head bump means there's only ever one winner (by default). A game is
  several hands with running points, dealer rotation, and prevailing-wind rounds (see [rules.md](rules.md)).
- The wall plays to the last tile with nothing held back. When it runs out, the hand is a draw.
- Declared sets are locked. Discarding any remaining hand tile straight after a claim is allowed (no
  ban on swapping a tile straight back out).

**Considered:** one hand = one game (simpler, but the group wants running points); keeping 13–16 tiles back
at the end of the wall.
