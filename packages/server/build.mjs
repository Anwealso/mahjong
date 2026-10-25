// Bundles the server (and the engine/protocol packages it imports as TypeScript source) into one file,
// so production runs plain `node dist/server.mjs` with no TypeScript tooling.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist/server.mjs",
  // Optional native speed-ups for ws; it works without them.
  external: ["bufferutil", "utf-8-validate"],
  // ws is CommonJS and calls require(); give the ESM bundle one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});
