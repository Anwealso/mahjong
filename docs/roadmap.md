# Roadmap

Milestones in build order. Each one should end with passing tests and something runnable.

| # | Milestone | Status |
|---|---|---|
| 1 | Engine core | ✅ Done |
| 2 | Engine: hand state machine | ✅ Done |
| 3 | Server + protocol | ✅ Done |
| 4 | Client table UI | ✅ Done |
| 5 | Full game (multiple hands) | ✅ Done |
| 6 | Resilience + deploy | ✅ Done (awaiting first deploy) |
| 7 | Later / nice-to-haves | ⏭ Next |

## 1. Engine core ✅

- Tile model (`TileId` 0–135, `TileKind` 0–33), notation parser and formatter, display names.
- Seeded PRNG (`mulberry32`) and Fisher–Yates shuffle; `buildWall(seed)`.
- Win detection (`decompose`, `isWinningHand`, including the optional special hands) and `waitingKinds`.
- A client "engine playground" page for poking at hands in the browser.

## 2. Engine: hand state machine ✅

- `GameState`, `Action`, `GameEvent`, and `PlayerView` types.
- Deal; draw; discard; first-come claim window; chow, pung, and all three kong types with
  replacement draws; self-drawn win; draw hand when the wall runs out.
- `legalActions(state, seat)`, `applyAction(...)`, `closeClaimWindow(state)`, `projectView(state, seat)`.
- Chicken Hand flat payment (`scoreHand`).
- **Property test:** thousands of random legal-action playouts never throw, always account for all 136
  tiles, and never show a seat another seat's concealed tiles in its view.

## 3. Server + protocol ✅

- `packages/protocol`: zod schemas and types for every message.
- Room registry, 4-letter room codes, lobby, choosing seats, starting a game.
- `SeatController` interface; `HumanController`, plus `PolicyController` running `autopilotPolicy` (for
  disconnected players; removed in milestone 5) or `randomPolicy`. Future bots are new policies.
- Claim timer, `stateVersion` check against stale actions, session tokens and reconnecting.
- **Integration test:** 4 random players play full hands over real WebSockets.
- Not yet: dealer rotation and running scores (milestone 5). Every hand is currently dealt with seat 0 as
  dealer.

## 4. Client table UI ✅

- Zustand store and WebSocket connection module (`client/src/net/`), rejoining after a refresh.
- Screens: Join → Lobby → Table. "Fill empty seats with bots" in the lobby (random-move bots, [D20](decisions.md#d20-random-move-bots-from-the-lobby)).
- Table: your hand, opponents' melds and face-down hands, discard ponds, wall count, prevailing wind.
- Drag to reorder your hand; private groups of complete sets on the left, saved in `localStorage`
  ([D21](decisions.md#d21-table-interactions-selection-toolbar-grouping-and-claiming)).
- Click the discard (or press Space) to claim it, then choose how to use it: pre-selected when there's
  one way, colour-coded options when there are several.
- Opponents shown with locked sets face up and their complete concealed sets face down.
- Floating toolbar above the selection, action bar built from `legalActions`, claim countdown, keyboard
  shortcuts.
- End-of-hand panel with the result, payments and every hand revealed.
- Not yet: animations, sounds, SVG tiles (milestone 7); dealer rotation and running scores (milestone 5).

## 5. Full game ✅

Specified in [game-flow.md](game-flow.md) ([D22](decisions.md#d22-open-ended-games-wind-breaks-and-unanimous-continue-votes), [D23](decisions.md#d23-host-seat-owned-scores-and-handling-dropouts)).

- Engine `GameState`: random first dealer, dealer rotation, prevailing winds (open-ended), running seat
  scores, hand history.
- A host who starts, pauses/resumes, removes people, fills seats with bots, and handles dropouts and join
  requests. No autopilot.
- Ready-up between hands with a 10 s countdown; Return to lobby to pause.
- Wind break: podium for the wind, leaderboard, unanimous vote to continue, leavers replaced by bots.
- Celebration screen with confetti for 1st and 2nd.

## 6. Resilience + deploy ✅

[D25](decisions.md#d25-flyio-in-sydney-one-machine-that-stops-when-idle-deploys-from-github-actions), setup in [deploy.md](deploy.md).

- Reconnecting with a session token (milestones 3 and 5); a heartbeat that notices dropped connections.
- Cleanup: empty rooms after 30 minutes, disconnected watchers after 10. Limits on rooms, people per room,
  and room creation.
- "The server is restarting" before a shutdown, and a clear message when a room was lost.
- Production build: the server serves the built client. Dockerfile and `fly.toml` (Sydney, one machine
  that stops when idle). GitHub Actions tests pull requests and deploys `main`.
- **Remaining (you):** the one-time Fly.io and GitHub setup in [deploy.md](deploy.md), then the first
  deploy.

## 7. Later

- ✅ Smarter bots: Easy / Medium / Hard ([bots.md](bots.md), [D26](decisions.md#d26-easy--medium--hard-bots-with-human-like-timing-hard-thinks-in-a-worker-thread), [D27](decisions.md#d27-hard-ships-with-defence-only-in-process-no-lookahead-no-worker-thread)).
- SVG tile art, sounds, animations, chat.
- ✅ Sound effects ([sound.md](sound.md), [D26](decisions.md#d26-sound-effects-recorded-cc0-clips-played-from-game-events-lobby-music-to-be-chosen)). Lobby music parked.
- SVG tile art, animations, chat.
- Game history and replays (persist `seed + action log` to SQLite).
- Optional faan scoring, flowers, and other `RuleConfig` variants.
- Mobile layout.

## Open questions

- None right now. (Hosting: Fly.io, decided in [D25](decisions.md#d25-flyio-in-sydney-one-machine-that-stops-when-idle-deploys-from-github-actions).)
