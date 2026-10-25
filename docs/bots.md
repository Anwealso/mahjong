# Bots: plan for Easy / Medium / Hard

**Status: proposal (milestone 7).** Nothing here is built yet. Recommended choices are marked ✅; open
questions are at the end. Once agreed, the choices go into [decisions.md](decisions.md).

## Where we are

- Bots are `Policy` functions, `(view: PlayerView, legalActions: Action[]) => Action`, run by a
  `PolicyController` on the server after a delay ([D6](decisions.md#d6-seat-controllers-so-server-side-bots-can-be-added-later)).
  They see exactly what a person in that seat sees, and their moves go through the same validation, so
  they can't cheat.
- The only policy is `randomPolicy`. It almost never wins, so bot-heavy tables mostly draw.

## What makes a Chicken Hand bot good

Every win pays the same (1 point, or 1 from each player on a self-draw), so there's no hand value to chase.
The best strategy is simply:

1. **Win as fast as possible.** Get to a ready hand quickly, with as many winning tiles still live as you can.
2. **Don't hand other people wins.** The discarder pays the whole point, so a tile that lets someone win
   on your discard costs you directly.
3. **Self-draws are worth 3×** (everyone pays), so a slightly slower but concealed hand isn't worse.

That makes this one of the easier mahjong variants to write a strong bot for. The standard tools are:

| Tool | What it is | Cost |
|---|---|---|
| **Shanten** | How many tiles away from ready a hand is (−1 = complete, 0 = ready, 1 = one away, …). Our winning shape is 4 sets + a pair, with locked melds counting as sets. | Microseconds with per-suit lookup tables (like the cached `maxConcealedSets`). |
| **Ukeire** | For a candidate hand, how many *unseen* tiles would reduce its shanten. "Unseen" = 4 copies minus what's visible: your hand, every pond, every meld. | Shanten × 34 kinds per candidate discard, still well under a millisecond. |
| **Danger** | How likely a discard is to let an opponent win. Signals: their **public complete-set count** (our rules show when someone is one set from winning), their locked melds, what they've discarded, and which kinds are already fully visible (a kind whose 4 copies are all visible can't be anyone's wait). | Cheap heuristics. |
| **Monte Carlo lookahead** | Randomly deal the hidden tiles (other hands and the wall) consistently with what you can see, play the next several turns out with a fast policy, and pick the move with the best result over many samples ("determinisation"). | Tens to hundreds of milliseconds per decision; needs a time budget. |
| **Learned policies** | Train a neural network by self-play (as Suphx did for riichi). | Big project and training infrastructure; not worth it for this variant. |

## The three levels

| | **Easy** | **Medium** | **Hard** |
|---|---|---|---|
| **Feels like** | A beginner | A solid casual player | A careful, experienced player |
| **Discards** | Greedy shanten, but often (≈40%) picks a random "reasonable" tile instead of the best, and doesn't count unseen tiles. | Minimum shanten, then maximum ukeire counting unseen tiles. Tie-break: drop isolated honours and terminals first. | Medium, plus **defence**: when an opponent looks close (high set count, several melds, late in the wall), it weighs ukeire against danger and folds (discards safe tiles) when its own hand is far from ready. |
| **Claims** | Always wins when it can. Claims pungs about half the time it could; rarely chows. | Claims when it lowers shanten without wrecking ukeire. Weighs staying concealed for a 3× self-draw. | Medium's rule, but also checks what claiming reveals and whether it skips a dangerous draw. |
| **Lookahead** | None | None | Monte Carlo playouts (Medium as the playout policy) for close calls: whether to claim, and late-hand discards. Capped at ~150 ms. |
| **Kongs** | Always declares | Declares unless it breaks a better shape | Medium, plus avoids the extra exposure when defending |
| **CPU per move** | < 1 ms | < 1 ms | ≤ 150 ms (budgeted) |

Every level **always takes a win** when offered. Passing up a win is legal, but it isn't a sensible
simplification for a bot. (Open question 4.)

Keep **Random** as a hidden fourth level for tests and the arena.

### Reaction time (fairness in the claim race)

Claims are first come, first served, so a bot that claims in 1 ms would beat every person to every tile.
✅ **Bots use human-like delays at every level:** they claim 0.8–2 s after a discard (randomised) and
discard 1–2.5 s into their turn. Difficulty is about decisions, never speed.

## Where the bots run on the server

The server is one Node process on one small shared CPU. The event loop also runs the claim race and the
timers for every room, so a bot that thinks for 150 ms on the main thread delays every other room's
messages by 150 ms.

| Option | How | For | Against |
|---|---|---|---|
| **A. In-process, synchronous** (today) | Policy runs on the main thread | Simplest; fine for Easy and Medium (< 1 ms) | Hard's lookahead would stall other rooms |
| **B. Worker thread for heavy bots** ✅ | `Policy` may return a `Promise`; Easy and Medium stay in-process; Hard runs in **one `worker_threads` worker** that the server starts once. Requests are queued, each with a deadline. | Main loop stays responsive; no new infrastructure; still one machine | A little plumbing (message passing, cancelling stale requests) |
| **C. Separate bot process or service** | Bots connect over WebSocket like players | Fully isolated; could scale separately | A second Fly machine (cost) and more moving parts; overkill |
| **D. Bots in the host's browser** | Host's tab plays the bot seats | Free CPU | Bots die when the host closes the tab or loses Wi-Fi; easy to tamper with |

✅ **Recommended: B.** The existing stale-action check already handles a slow answer safely: if the game
moved on while the bot was thinking, its move is rejected as stale and it simply gets the new snapshot.
The worker also enforces Hard's time budget, so a slow decision falls back to Medium's move.

With a 1.5–2 s human-like delay and a ≤ 150 ms think, Hard bots never look slow. On one shared CPU, a few
rooms of Hard bots is fine; the per-room cap (4 seats) and room limit (100) keep the worst case bounded.

## Code layout ✅

- **New package `packages/bots`**: pure TypeScript, depends only on `@mahjong/engine`.
  - `shanten.ts`, `ukeire.ts`, `visible.ts` (count visible/unseen tiles from a `PlayerView`), `danger.ts`
  - `easy.ts`, `medium.ts`, `hard.ts`, `random.ts`, all the same `Policy` shape
  - `arena.ts`: plays thousands of hands between policies with the engine directly (no server), seeded
- The server imports bots from there; `controllers.ts` gains async policy support and the worker for Hard.
- The engine stays rules-only.

## Choosing bot levels (UX)

- ✅ A room-wide **Bot level** in **Game settings** (default **Medium**), used for "Fill empty seats with
  bots" and for bots that take over from people who drop out.
- ✅ The host can change an individual bot's level in the lobby (a small Easy / Medium / Hard picker on the
  bot's seat card), before the game or while it's paused.
- Bots are named by level: "Easy Bot 2", "Hard Bot 4".

## How we'll know they're good (testing)

- **Unit tests**: shanten and ukeire against hand-worked examples (including locked melds and edge cases
  like honours that can only make pungs).
- **Arena** (`npm run arena`): seeded matches of thousands of hands, reporting win rate, deal-in rate (how
  often a bot's discard lets someone win), draw rate and average hand length per level.
- **CI checks** on a smaller seeded arena: Medium clearly beats Easy, Easy clearly beats Random, Hard
  doesn't lose to Medium and deals in less; Hard stays inside its time budget.
- A bonus: with Medium bots, bot-heavy tables should mostly *finish* hands instead of drawing.

## Build order

1. `packages/bots`: visible-tile counting, shanten, ukeire (+ tests).
2. Easy and Medium policies; the arena; CI checks against Random.
3. Bot level setting, per-bot picker, protocol + lobby UI; replace `randomPolicy` as the default.
4. Async policies + worker thread; Hard (defence first, then Monte Carlo lookahead); arena checks.
5. Docs: decisions, game-flow (levels and delays), architecture.

## Open questions

1. **Levels**: Easy / Medium / Hard as described above? Keep Random as a hidden testing-only level?
2. **Picking levels**: a room-wide default in Game settings plus a per-bot picker for the host?
3. **Reaction time**: same human-like delays at every level, so difficulty never means faster claims?
4. **Wins**: should Easy sometimes *miss* a win (like a distracted beginner), or always take it?
5. **Hard's lookahead**: build defence first and add Monte Carlo after, or go straight for both?
