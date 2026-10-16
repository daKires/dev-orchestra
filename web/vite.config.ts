import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Build vai direto pro dist/web do bridge (servido pelo ui.ts). Em dev, /events e acoes vao pro hub.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  build: { outDir: "../dist/web", emptyOutDir: true, chunkSizeWarningLimit: 800 }, // app local: 1 chunk grande e ok
  server: {
    // S1: com changeOrigin o proxy reescreve o Host pra 127.0.0.1:4123; sem isso o hub (host check)
    // responde 403 ao dev server.
    proxy: {
      "/events": { target: "http://127.0.0.1:4123", changeOrigin: true },
      "/cancel": { target: "http://127.0.0.1:4123", changeOrigin: true },
      "/canvas": { target: "http://127.0.0.1:4123", changeOrigin: true },
      "/agentes": { target: "http://127.0.0.1:4123", changeOrigin: true },
    },
  },
});
