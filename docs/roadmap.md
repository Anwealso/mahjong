# Roadmap

Milestones in build order. Each one should end with passing tests and something runnable.

| # | Milestone | Status |
|---|---|---|
| 1 | Engine core | ✅ Done |
| 2 | Engine: hand state machine | ✅ Done |
| 3 | Server + protocol | ✅ Done |
| 4 | Client table UI | ⏭ Next |
| 5 | Full game (multiple hands) | — |
| 6 | Resilience + deploy | — |
| 7 | Later / nice-to-haves | — |

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
  disconnected players) or `randomPolicy`. Future bots are new policies.
- Claim timer, `stateVersion` check against stale actions, session tokens and reconnecting.
- **Integration test:** 4 random players play full hands over real WebSockets.
- Not yet: dealer rotation and running scores (milestone 5). Every hand is currently dealt with seat 0 as
  dealer.

## 4. Client table UI

- Zustand store and WebSocket connection module (`client/src/net/`).
- Screens: Join → Lobby → Table.
- Table: your hand, opponents' melds and face-down hands, discard ponds, wall count, prevailing wind.
- Drag to reorder your hand (client-side only); select tiles, then declare pung, kong, or chow.
- Action bar built from `legalActions`, claim countdown, keyboard shortcuts.

## 5. Full game

- Dealer rotation, prevailing-wind rounds, running scores, end-of-hand and end-of-game summaries.

## 6. Resilience + deploy

- Reconnect with a session token; autopilot while someone's disconnected.
- Clean up abandoned rooms.
- Production build: the server serves the built client. Deploy to Fly.io or Railway ([D8](decisions.md#d8-hosting-one-service-serving-the-client-and-the-websocket-on-the-same-origin)).

## 7. Later

- Real server-side bots ([D6](decisions.md#d6-seat-controllers-so-server-side-bots-can-be-added-later)).
- SVG tile art, sounds, animations, chat.
- Game history and replays (persist `seed + action log` to SQLite).
- Optional faan scoring, flowers, and other `RuleConfig` variants.
- Mobile layout.

## Open questions

- **Hosting:** Fly.io or Railway (decide at milestone 6).
