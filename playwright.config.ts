import { defineConfig, devices } from "@playwright/test";

// LiveProbe UI e2e. The webServer builds the UI, copies it next to the server,
// and boots the server on a dedicated port with an isolated DB — no docker /
// testbed / loadgen needed. Specs seed deterministic traces via POST /v1/events.
const PORT = 4399;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // one server, shared seeded state — keep specs serial
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run e2e:serve",
    url: `${BASE_URL}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
