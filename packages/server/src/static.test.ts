import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "./app";

let server: RunningServer;
beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "mahjong-static-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), "<html>app</html>");
  writeFileSync(join(root, "assets", "app-abc123.js"), "console.log(1)");
  server = await startServer({ port: 0, staticDir: root });
});
afterAll(() => server.close());

/** Raw GET, so paths like /../ reach the server unnormalised. */
function get(path: string): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "localhost", port: server.port, path }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("serving the built client", () => {
  it("serves index.html (never cached) and hashed assets (cached forever)", async () => {
    const index = await get("/");
    expect(index).toMatchObject({ status: 200, body: "<html>app</html>" });
    expect(index.headers["cache-control"]).toBe("no-cache");
    const asset = await get("/assets/app-abc123.js");
    expect(asset.headers["content-type"]).toContain("text/javascript");
    expect(asset.headers["cache-control"]).toContain("immutable");
  });

  it("falls back to index.html for app links, but 404s missing files", async () => {
    expect((await get("/some/link")).body).toBe("<html>app</html>");
    expect((await get("/assets/missing.js")).status).toBe(404);
  });

  it("never serves files outside the client directory", async () => {
    expect((await get("/../../package.json")).status).toBe(404);
    expect((await get("/%2e%2e/%2e%2e/package.json")).status).toBe(404);
  });

  it("still answers the health check", async () => {
    expect(JSON.parse((await get("/health")).body)).toMatchObject({ ok: true });
  });
});
