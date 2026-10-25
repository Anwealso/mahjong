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

**Status:** accepted · 2026-10-25 (bots themselves are deferred) · the disconnect autopilot was removed by
[D23](#d23-host-seat-owned-scores-and-handling-dropouts); random bots arrived with [D20](#d20-random-move-bots-from-the-lobby)

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
(`useStore.setState(...)`) with no provider. Components use selectors, so only the parts that changed
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

**Status:** accepted · 2026-10-25 · game length refined by [D22](#d22-open-ended-games-wind-breaks-and-unanimous-continue-votes) (open-ended, not four winds)

- A hand ends at the first win. Only one player can claim a discard ([D15](#d15-claims-are-first-come-first-served)), so there's only ever one winner. A game is
  several hands with running points, dealer rotation, and prevailing-wind rounds (see [rules.md](rules.md)).
- The wall plays to the last tile with nothing held back. When it runs out, the hand is a draw.
- Declared sets are locked. Discarding any remaining hand tile straight after a claim is allowed (no
  ban on swapping a tile straight back out).

**Considered:** one hand = one game (simpler, but the group wants running points); keeping 13–16 tiles back
at the end of the wall.

## D15. Claims are first come, first served

**Status:** accepted · 2026-10-25 · supersedes the claim-priority and head-bump parts of D1 and the
original rules

The first valid claim on a discard takes it. There's no ranking (win > pung/kong > chow), no head bump,
and no multiple winners. The `multipleWinners` setting is gone.

**Why:** simpler to understand and to play: claim it and it's yours.

**Trade-off accepted:** a player on a slower connection is at a slight disadvantage for contested
discards. That's negligible for friends on a call. The server processes messages one at a time, so
there are never ties.

## D16. Players select tiles to form sets; hand order is client-side only

**Status:** accepted · 2026-10-25 · claiming is refined by [D18](#d18-claiming-is-two-steps-claim-the-tile-then-use-it); personal groups by [D19](#d19-personal-groups-are-private-everyone-sees-complete-concealed-set-counts)

- Nothing is formed automatically. Pung, kong, and chow claims (and concealed kongs) carry the exact hand
  tiles the player selected. The engine validates them (in hand, distinct, right kinds) and never picks
  tiles on the player's behalf. `legalActions` lists each option with example tiles so the client knows
  which buttons to enable; any equivalent selection is accepted.
- Players can freely reorder their concealed tiles to group partly formed sets. That order lives only in
  the client (and survives updates by tracking `TileId`s). The server keeps hands sorted and never sees
  the order.

## D17. No discard time limit

**Status:** accepted · 2026-10-25 · **partly superseded** by [D23](#d23-host-seat-owned-scores-and-handling-dropouts): still no
automatic time limit, but after 60 s without a move the host may replace the player with a bot; and there's
no autopilot any more

Players can take as long as they like on their own turn; it's a casual game on a call. Disconnected
players are covered by the autopilot. A generous limit (using the same autopilot) can be added later if
someone keeps wandering off.

## D18. Claiming is two steps: claim the tile, then use it

**Status:** accepted · 2026-10-25

1. In the claim window, anyone who could use the discard may **claim** it (one click on the tile; no tiles
   or set type chosen). The first claim takes it; everyone else only learns that it was claimed.
2. The claimer must then **use** it: win (if it completes their hand) or form a set, choosing the set
   type and tiles if there's more than one option. There's no passing or backing out at this point.

Sets formed from claimed tiles stay locked (see [rules.md](rules.md)). If the claimer disconnects
before using the tile, the autopilot finishes the claim (winning if it can).

**Why:** claiming is a fast reflex (it's first come, first served), and choosing tiles shouldn't slow you
down in a race. Choosing comes after the race is won.

**Engine:** a `claim` action in the window, then a `claimed` phase in which only the claimer acts, with
options `win` / `pung` / `kong` / `chow` (each carrying the selected tiles).

## D19. Personal groups are private; everyone sees complete concealed set counts

**Status:** accepted · 2026-10-25

- Players can group their concealed tiles into "soft" sets and change them freely. These groups are purely
  for the player, stay in their browser (`localStorage`), and are never sent to the server.
- Everyone sees each player's **number of complete concealed sets** (`PublicPlayer.concealedSets`), worked
  out by the server from the best possible grouping, whether or not the player uses groups. Set types,
  pairs, and partial runs are never revealed; they count as loose tiles.

**Why:** seeing everyone's progress is more fun. Computing it on the server means hiding your progress
isn't possible, so there's no incentive to avoid the grouping feature. Not counting pairs or partial
runs means the table sees "one set from winning", never "one tile from winning".

**Considered:** showing the player's own groups to others (rejected: it rewards not using the feature);
also showing pairs and partial runs (rejected: it would reveal when someone is one tile from winning).

## D20. Random-move bots from the lobby

**Status:** accepted · 2026-10-25

A lobby button, **Fill empty seats with bots**, fills every empty seat with a bot that plays random legal
moves (`randomPolicy`, taking wins when offered). It's in every build, not just development: it makes solo
testing easy and lets three friends play. A person taking a bot's seat replaces the bot. Bots act after
1.5 s so the table is followable.

**Protocol:** one new message, `addBots`; lobby members gain `bot: boolean`.

**Considered:** a dev-only button (rejected: a short-handed table is a real use); smarter bots now
(deferred: they're just new policies, milestone 7).

## D21. Table interactions: selection toolbar, grouping, and claiming

**Status:** accepted · 2026-10-25 · refines the personal groups in [D19](#d19-personal-groups-are-private-everyone-sees-complete-concealed-set-counts)

- **Layout:** you at the bottom, the next player on your right, opposite at the top, previous on your
  left; each player's discards in front of them in the centre.
- **Arranging:** drag loose tiles to reorder (`dnd-kit`). **Sort** tidies only the loose tiles.
- **Grouping:** only a **complete set** (pung or chow) of loose tiles can be grouped: select it and press
  `G` or the floating **Group** button. Groups sit to the left of the loose tiles. Ungroup with `G` on the
  selected group or the Ungroup button above it. Discarding or using a grouped tile breaks the group up.
- **Discarding:** select a tile, then press the **Discard** button floating above it, or `Enter`. Never a
  single click, so a misclick can't throw a tile away.
- **Claiming:** the claimable discard glows; click it (in the centre or in its pond) or press `Space`.
- **Using the tile:** with one possible use, its tiles are pre-selected and one click or `Enter`
  confirms. With several, each option is highlighted in its own colour and has a coloured button; click a
  highlighted tile (or the button) to choose. This doesn't contradict [D16](#d16-players-select-tiles-to-form-sets-hand-order-is-client-side-only):
  the client suggests tiles, the player confirms, and the server still never picks tiles itself.
- **Tile art:** CSS placeholders stay ([D12](#d12-placeholder-css-tiles-first)); `Tile.tsx` is the only
  place tiles are drawn, so swapping in an SVG set touches one file.

**Why:** grouping only complete sets keeps groups meaningful (they mirror what the table's
`concealedSets` count shows); a floating toolbar puts the action next to the tiles it applies to; and
keyboard shortcuts keep the first-come claim race fair for keyboard players.

## D22. Open-ended games, wind breaks, and unanimous continue votes

**Status:** accepted · 2026-10-25 · details in [game-flow.md](game-flow.md)

- The first dealer is random (once per game). The dealer keeps the deal after a dealer win or a draw
  (now an optional setting, off by default: see [D24](#d24-the-deal-passes-on-after-every-hand-by-default)).
- Games don't stop after four winds. At the end of every wind everyone returns to a special end-of-wind
  lobby view: the finished wind's big logo, a podium for that wind, and the overall leaderboard.
- Continuing to the next wind needs a **unanimous** vote of the seated people, with no countdown. Anyone
  may **Leave** instead; a bot takes their seat (keeping its score) and they see the celebration screen.
  After 30 s the host may remove anyone who hasn't voted. The game is over when no people remain seated.
- The celebration screen has confetti for 1st and 2nd place and the full scoreboard.
- Between hands: everyone clicks Ready, with a 10 s auto-continue countdown that stops while a seat is
  empty or its player is offline. Anyone may Return to lobby to pause the game; the host resumes it.

**Why:** the group plays for as long as the evening lasts. A natural stopping point every wind, with the
standings in front of everyone, makes "one more wind?" an explicit group decision. Unanimity means nobody
gets dragged into another wind, and leavers are backfilled so the others can keep going.

**Considered:** a fixed game length chosen up front (one, two, or four winds); a majority vote with a
30 s timer; ending when anyone votes to stop.

## D23. Host, seat-owned scores, and handling dropouts

**Status:** accepted · 2026-10-25 · supersedes the autopilot of [D6](#d6-seat-controllers-so-server-side-bots-can-be-added-later)
and partly [D17](#d17-no-discard-time-limit) · details in [game-flow.md](game-flow.md)

- The room creator is the **host**; if they go, the longest-present connected person takes over. The host
  starts and resumes games, removes players, fills seats with bots, and handles dropouts and join requests.
- **Scores belong to seats.** Whoever plays a seat (person or bot) inherits its score.
- **No autopilot.** When someone leaves, disconnects, or makes no move for 60 s on their decision, the
  game waits and the host chooses: replace them with a bot, wait, or cancel the hand and return to the
  lobby (the hand doesn't count; the same dealer redeals).
- A disconnected person gets their seat back automatically on reconnecting, even from a bot. An idle person
  who was replaced can take their seat back. Someone who left gave it up.
- Newcomers mid-game ask to play; when the host approves they replace a random bot at once (tiles and
  score included). In the paused lobby or a wind break they simply pick a bot to replace.

**Why:** the host is on the call and can judge "they're just getting a drink" vs "they've gone", which a
timer can't. Seat-owned scores make swapping people and bots in and out painless.

**Considered:** an autopilot that plays automatically after a timeout (the old behaviour: it hid the problem
and played badly); scores per person (complicated when people swap seats or leave).

## D24. The deal passes on after every hand by default

**Status:** accepted · 2026-10-25 · refines [D22](#d22-open-ended-games-wind-breaks-and-unanimous-continue-votes)

- New **game setting** `dealerKeepsDeal`, **off by default**: the deal passes to the next seat after every
  hand, whatever the result, so every wind is exactly four hands.
- When on, the traditional rule applies: the dealer keeps the deal after a dealer win or a draw.
- The host sets it in the pre-game lobby; it's fixed once the game starts and carries over to the next
  game.

**Why:** random bots almost never win, so with the traditional rule a bot-heavy table draws hand after
hand, the dealer never moves, and winds never end. Fixed-length winds also make the wind-break votes
predictable (every four hands).

**Considered:** keeping the deal only after a dealer win (not a draw); capping consecutive dealer repeats.
