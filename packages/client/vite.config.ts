import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Same-origin in dev and prod: the client always connects to /ws.
    proxy: { "/ws": { target: "ws://localhost:8787", ws: true } },
  },
});
