import { startServer } from "./app";
import { DEFAULT_ROOM_OPTIONS } from "./room";

// BOT_DELAY_MS speeds bots up for trying things out locally (e.g. BOT_DELAY_MS=100 npm run dev).
const botDelayMs = Number(process.env.BOT_DELAY_MS ?? DEFAULT_ROOM_OPTIONS.botDelayMs);
const server = await startServer({ port: Number(process.env.PORT ?? 8787), room: { ...DEFAULT_ROOM_OPTIONS, botDelayMs } });
console.log(`server listening on http://localhost:${server.port}`);
