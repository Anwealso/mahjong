import { startServer } from "./app";

const server = await startServer({ port: Number(process.env.PORT ?? 8787) });
console.log(`server listening on http://localhost:${server.port}`);
