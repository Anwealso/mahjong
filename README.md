# mahjong
Play Mahjong in the browser: real-time, 4-player Hong Kong Chicken Hand (雞糊) for friends.

Project docs live in [docs/](docs/README.md): rules, architecture, decision log, roadmap, and dev guide.

## Development

```sh
npm install
npm run dev        # server on :8787, client on http://localhost:5173 (proxies /ws to the server)
npm test           # vitest, all packages
npm run typecheck
```
