import { defineConfig, devices } from "@playwright/test";
import { hostPort } from "./e2e/real-host/harness.ts";

// Real agent host project (XTRM-572): the live Agent half against a real `xt host`, a real Pi session
// in tmux, and the real Claude hook reporter. Local only; see e2e/real-host/harness.ts for what it
// needs and how it stays isolated. Run: npm run test:e2e:real-host
const PORT = Number(process.env.XTRM_REAL_HOST_APP_PORT ?? 5299);

export default defineConfig({
  testDir: "e2e/real-host",
  // Direct mode needs a bridge without a loopback host: playwright.real-host-direct.config.ts.
  testIgnore: "direct-mode.spec.ts",
  outputDir: "e2e/.results/real-host",
  globalSetup: "./e2e/real-host/global-setup.ts",
  workers: 1,
  timeout: 360_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "real-host", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    env: {
      VITE_XTRM_AGENT: "live",
      XTRM_AGENT_HOST_PORT: String(hostPort()),
      VITE_XTRM_GITHUB: "fixture",
      // @issue references resolve against the real Substrate board (XTRM-598), read only: the bridge
      // refuses every write route with XTRM_SUBSTRATE_WRITES=0.
      VITE_XTRM_SUBSTRATE: "live",
      XTRM_SUBSTRATE_WRITES: "0",
      VITE_XTRM_PROGRAM: "fixture",
      VITE_XTRM_RESEARCH: "fixture",
      VITE_XTRM_AGENT_HOST: "live",
      // No saved SSH connection: the bridge reads the loopback host.
      XTRM_AGENT_CONNECTION_FILE: "e2e/.results/real-host-no-connection.json",
    },
  },
});
