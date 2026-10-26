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

**Status:** accepted · 2026-10-25 · Fly.io chosen in [D25](#d25-flyio-in-sydney-one-machine-that-stops-when-idle-deploys-from-github-actions)

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
  single click, so a misclick can't throw a tile away. The tile you just drew starts selected, so
  `Enter` alone throws it straight back.
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

## D25. Fly.io in Sydney, one machine that stops when idle, deploys from GitHub Actions

**Status:** accepted · 2026-10-25 · setup steps in [deploy.md](deploy.md)

- **Fly.io**, region **`syd`** (the players are in Australia; low latency matters for first-come claims).
  `shared-cpu-1x`, 256 MB: about $1.94/month running all the time, less because it stops when idle.
- **Exactly one machine.** Rooms live in memory, so a second machine would split players between two
  servers. Deploys use `--ha=false`.
- **Stops when nobody is connected** (`auto_stop_machines`), starts on the next request in about 1–3 s.
  Open WebSockets count as connections, so it never stops mid-game.
- **A deploy or restart ends games in progress.** Before shutting down the server tells everyone it's
  restarting; on reconnect their room is gone and they're told so. Saving rooms across restarts is left
  for game history / replays (milestone 7).
- **GitHub Actions** deploys every push to `main` after typecheck and tests pass; pull requests run the
  tests only.
- The free `*.fly.dev` address; no custom domain yet. The site is open: anyone with the URL can create a
  room.
- **Resilience:** the server pings every socket every 25 s and drops ones that don't answer (so a dropped
  Wi-Fi shows as offline promptly and the host gets the prompt). Rooms nobody has been connected to for
  30 minutes are deleted; disconnected watchers are dropped after 10 minutes. Limits: 100 rooms per
  server, 12 people per room, 5 new rooms per minute per connection.

**Considered:** Railway ($5/month base, simpler deploys, less control over region); always-on (costs more
for no benefit to a group that plays in sessions); saving rooms to a volume so deploys don't end games
(more work, deferred); deploying by hand.

## D26. Sound effects: recorded CC0 clips played from game events; lobby music to be chosen

**Status:** accepted and built (sound effects) · lobby music parked · 2026-10-25 · details in [sound.md](sound.md)

- **Tile sounds are recorded CC0 clips** from Kenney's *Casino Audio* pack. Alerts are soft tones
  synthesised in the browser. Plain Web Audio, no audio library.
- **The client maps the `events` in each `state` message to sounds**, so the server doesn't change. The
  mapping is a pure, unit-tested function.
- **A small set of sounds:** deal, discards (everyone's), your own draw, your turn, a claim ping when *you*
  can claim, pung/chow and kong clacks, win fanfare, draw-hand thud, and a gong plus cheer on the
  celebration screen. The host hears a soft notification for host prompts.
- **Silent on purpose:** other players' draws, countdown ticks, and lobby join/leave.
- **No music during a hand** (you're on a voice call). Lobby music is parked; the options are in
  [sound.md](sound.md#lobby-music).
- **Audio files are committed** (about 110 KB of AAC). Music, if added, would go in Git LFS, outside the
  repo, or be generated in code, so the repo doesn't grow.
- **Controls:** mute button, volume slider and `M`. On by default at about 60%, saved per browser.
- **Accepted trade-off:** through an open mic, the claim ping can tell friends you had a claim.

**Considered:** synthesising every sound (no files, but tile clacks sound plasticky); countdown ticks;
sounds for other players' draws; making the claim alert visual only.


## D27. Easy / Medium / Hard bots with human-like timing; Hard thinks in a worker thread

**Status:** accepted · 2026-10-25 · full plan in [bots.md](bots.md) · replaces random bots as the default ·
**the lookahead and worker thread are superseded** by [D28](#d28-hard-ships-with-defence-only-in-process-no-lookahead-no-worker-thread)

- Three levels built on **shanten** (tiles from ready) and **ukeire** (unseen tiles that improve the hand):
  Easy plays loosely, Medium plays for speed, Hard adds **defence** (danger from opponents' public set
  counts, melds and discards) and then **Monte Carlo lookahead** for close decisions. Random remains as a
  hidden level for tests.
- Every level **always takes a win**, and uses the **same human-like timing** (claims after 0.8–2 s,
  discards after 1–2.5 s), so difficulty never means winning the claim race by being faster.
- A room-wide **Bot level** setting (default Medium) used for new bots and dropout replacements, and a
  per-bot level the host can change in the lobby.
- Bots live in a new pure package, `packages/bots`, with an **arena** that plays seeded matches between
  levels; tests check the levels are ordered (Medium > Easy > Random, Hard ≥ Medium).
- On the server, Easy and Medium decide in-process (well under a millisecond); Hard runs in **one worker
  thread** with a time budget, falling back to Medium's move if it runs out, so it never delays other
  rooms' claim races.

**Why:** in Chicken Hand every win is worth the same, so "fastest safe hand" is the whole strategy, and
shanten/ukeire plus defence capture it cheaply. Equal reaction times keep the first-come claim race fair.

**Considered:** a separate bot service (extra machine and cost), bots in the host's browser (die with the
tab, tamperable), learned policies (big project for little gain here).

## D28. Hard ships with defence only, in-process: no lookahead, no worker thread

**Status:** accepted · 2026-10-26 · amends [D27](#d27-easy--medium--hard-bots-with-human-like-timing-hard-thinks-in-a-worker-thread)

- Measured in the arena (paired: same seat, same deals): the Monte Carlo lookahead scored no better than
  defence alone and cost ~55 ms a decision, so it's **off by default** (kept in `packages/bots` as an
  experiment).
- Without it, every level decides in under a millisecond, so all bots run **in-process**; the planned
  worker thread isn't needed.
- Hard's defence is limited to the two situations where it measurably helped (folding when far from ready
  against someone one set from winning; preferring safe tiles when one from ready). Broader caution made
  Hard lose to Medium.
- Changing the room's bot level changes **every** bot already seated (the per-bot picker then adjusts
  individual bots), which is simpler to understand than "only new bots".

**Why:** keep what the numbers support, and keep the server simple.

## D29. Everyone's hands are shown at the end of a hand, with a host setting to hide them

**Status:** accepted · 2026-10-26

- At the end of every hand the result panel lists each other player's hand face up (locked sets, then the
  concealed tiles), under the winner's formed-up hand. Their seats show them face up too.
- A room setting, **Show everyone's hands** (`revealHands`), **on by default**. The host can change it
  before a game or while paused (it doesn't affect play or scoring, so it needn't be fixed per game).
- With it off, the server **doesn't send** the other hands (the view has `null` for them), rather than the
  client just not drawing them, so nobody can read them from the network traffic. You always see your own
  hand and the winner's.

**Why:** seeing what everyone was holding is half the fun of the post-mortem, but the seats' face-up tiles
were mostly hidden behind the result panel. Some tables prefer the traditional "losers don't show" rule.

**Considered:** a per-player "show my hand" button (extra step every hand), showing them only at the seats
(covered by the panel).

## D30. Hosting only passes to people; the room closes when its last person leaves

**Status:** accepted · 2026-10-26 · amends [D23](#d23-host-seat-owned-scores-and-handling-dropouts) · details in [game-flow.md](game-flow.md#the-host)

- **Leave room** is now a real message (`leaveRoom`): the member is removed from the room, giving up their
  seat as with Leave seat. Before, the client just dropped its socket and the server treated it as a
  disconnect, so the leaver stayed in the room (and kept their seat).
- A leaving host hands over to the longest-present person still in the room, connected ones first. Bots are
  never host.
- If no person is left (only bots, or nobody), the room is **deleted at once** rather than after the 30 min
  idle sweep, so a bots-only table doesn't linger and the code can't be rejoined.
- A plain disconnect still keeps the room for 30 min, so a refresh or dropped Wi-Fi doesn't lose the game.

**Why:** a room with only bots in it has nobody who can run it; keeping it around just holds a room slot.
Counting offline people as "still here" avoids throwing away the game of someone whose Wi-Fi blipped.

**Considered:** deleting the room whenever no *connected* person is left when the host leaves (simpler, but
destroys a game an offline player is about to return to).
