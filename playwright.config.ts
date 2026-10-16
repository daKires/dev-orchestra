// E2E do dashboard (npm run e2e): hub de teste na 4199 com fixture isolada (test/e2e/hub.mjs).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  workers: 1,               // as specs dividem o mesmo hub/fixture e rodam em ordem (1-, 2-, ...)
  fullyParallel: false,
  timeout: 30_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:4199", viewport: { width: 1600, height: 1000 }, screenshot: "on" },
  webServer: { command: "node test/e2e/hub.mjs", url: "http://127.0.0.1:4199", reuseExistingServer: false, timeout: 30_000 },
});
