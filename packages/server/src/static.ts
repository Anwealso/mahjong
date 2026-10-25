import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Serves the built client from `root`. Vite puts hashed files under `/assets/`, so those can be cached
 * forever; `index.html` never is. Unknown paths without a file extension get `index.html`, so reloading a
 * deep link still loads the app. Returns false if it didn't handle the request.
 */
export function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  } catch {
    return false;
  }
  const file = normalize(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) return false; // no escaping the root with ../

  let target = existsSync(file) && statSync(file).isFile() ? file : null;
  if (!target && extname(path) === "") target = join(root, "index.html");
  if (!target || !existsSync(target)) return false;

  const immutable = path.startsWith("/assets/");
  res.writeHead(200, {
    "content-type": TYPES[extname(target)] ?? "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(target).pipe(res);
  return true;
}
