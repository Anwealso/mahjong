import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startServer } from "./app";
import { DEFAULT_ROOM_OPTIONS } from "./room";

// BOT_DELAY_MS gives bots a fixed, usually quicker, thinking time for trying things out locally
// (e.g. BOT_DELAY_MS=100 npm run dev). Normally they take a human-like time.
const botDelayMs = process.env.BOT_DELAY_MS ? Number(process.env.BOT_DELAY_MS) : undefined;
// The built client, if there is one (production). The bundle lives in packages/server/dist, so this is
// packages/client/dist; CLIENT_DIST overrides it. In development Vite serves the client instead.
const clientDist = process.env.CLIENT_DIST ?? fileURLToPath(new URL("../../client/dist", import.meta.url));
const staticDir = existsSync(clientDist) ? clientDist : undefined;

const server = await startServer({
  port: Number(process.env.PORT ?? 8787),
  room: { ...DEFAULT_ROOM_OPTIONS, botDelayMs },
  staticDir,
});
console.log(`server listening on http://localhost:${server.port}${staticDir ? ` (serving ${staticDir})` : ""}`);

// Deploys and restarts send SIGTERM (SIGINT for Ctrl-C): tell everyone before going.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    console.log(`${signal}: shutting down`);
    await server.close();
    process.exit(0);
  });
}
