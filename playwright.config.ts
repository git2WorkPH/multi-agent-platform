import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:5197",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/e2e/stack.ts",
    url: "http://127.0.0.1:5197",
    timeout: 45_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
});
