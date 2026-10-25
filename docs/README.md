# Docs

Real-time, browser-based, 4-player **Hong Kong Chicken Hand (雞糊)** mahjong for a group of friends playing
over a voice call. Desktop only for now.

| Doc | What's in it |
|---|---|
| [rules.md](rules.md) | The exact ruleset the engine implements, the configurable variants, and a glossary |
| [architecture.md](architecture.md) | How the system fits together: packages, server-authoritative design, engine state machine, protocol, client |
| [decisions.md](decisions.md) | Decision log: what was chosen, what was considered, and why |
| [roadmap.md](roadmap.md) | Milestones, current status, open questions |
| [development.md](development.md) | Setup, commands, repo layout, coding conventions |

## The project in 30 seconds

- **TypeScript monorepo:** `packages/engine` (pure rules), `server` (Node + ws), `client` (React + Vite +
  Zustand). `protocol` (zod message schemas) comes at milestone 3.
- **The server is authoritative:** each player only receives what they're allowed to see, plus the moves
  they can legally make.
- **Deterministic engine:** `seed + action log` replays any game.
- **Bots later:** seats are driven by `SeatController`s, so a server-side bot is a new controller, not a
  refactor.
- **Status:** milestone 1 (engine core) is done. Next up is the hand state machine.
