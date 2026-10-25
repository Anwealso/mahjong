# Docs

Real-time, browser-based, 4-player **Hong Kong Chicken Hand (雞糊)** mahjong for a group of friends playing
over a voice call. Desktop only for now.

| Doc | What's in it |
|---|---|
| [rules.md](rules.md) | The exact ruleset the engine implements, the configurable variants, and a glossary |
| [game-flow.md](game-flow.md) | Around the hands: host, seats and scores, dealer rotation, winds, ready-up, wind-break votes, dropouts, joining mid-game |
| [architecture.md](architecture.md) | How the system fits together: packages, server-authoritative design, engine state machine, protocol, client |
| [sound.md](sound.md) | Sound design: which sounds play when and for whom, sources and licences, controls, lobby music options |
| [decisions.md](decisions.md) | Decision log: what was chosen, what was considered, and why |
| [roadmap.md](roadmap.md) | Milestones, current status, open questions |
| [development.md](development.md) | Setup, commands, repo layout, coding conventions |
| [deploy.md](deploy.md) | Fly.io setup (one-time steps), deploying, logs, running a production build |

## The project in 30 seconds

- **TypeScript monorepo:** `packages/engine` (pure rules), `server` (Node + ws), `client` (React + Vite +
  Zustand), and `protocol` (zod message schemas).
- **The server is authoritative:** each player only receives what they're allowed to see, plus the moves
  they can legally make.
- **Deterministic engine:** `seed + action log` replays any game.
- **Bots later:** seats are driven by `SeatController`s, so a server-side bot is a new controller, not a
  refactor.
- **Status:** milestones 1–6 are done: full open-ended games in the browser with a host, running seat
  scores, wind breaks, and bots filling in, ready to deploy to Fly.io (Sydney) from GitHub Actions. The
  one-time account setup is in [deploy.md](deploy.md).
