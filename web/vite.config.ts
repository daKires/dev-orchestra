import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Build vai direto pro dist/web do bridge (servido pelo ui.ts). Em dev, /events e acoes vao pro hub.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  build: { outDir: "../dist/web", emptyOutDir: true, chunkSizeWarningLimit: 800 }, // app local: 1 chunk grande e ok
  server: { proxy: { "/events": "http://127.0.0.1:4123", "/cancel": "http://127.0.0.1:4123" } },
});
