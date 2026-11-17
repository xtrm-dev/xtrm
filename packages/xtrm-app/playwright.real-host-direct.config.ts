import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Direct mode against a real host (XTRM-600): the same isolated host as playwright.real-host.config.ts
// (started with --direct behind a local front that adds X-Forwarded-For), but the bridge has no
// loopback host, so the app reaches the host only through the front with a paired device token.
// Run: npm run test:e2e:real-host:direct
const PORT = Number(process.env.XTRM_REAL_HOST_APP_PORT ?? 5298);

// The device token lives in a temp dir for the run only; global teardown removes it. Workers load this
// config again and inherit the variable, so the dir is made once.
process.env.XTRM_REAL_HOST_DEVICE_DIR ??= mkdtempSync(join(tmpdir(), "xtrm-600-device-"));
const DEVICE_FILE = join(process.env.XTRM_REAL_HOST_DEVICE_DIR, "app", "agent-host-device.json");

export default defineConfig({
  testDir: "e2e/real-host",
  testMatch: "direct-mode.spec.ts",
  outputDir: "e2e/.results/real-host-direct",
  globalSetup: "./e2e/real-host/global-setup.ts",
  workers: 1,
  timeout: 360_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "real-host-direct", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    env: {
      VITE_XTRM_AGENT: "live",
      VITE_XTRM_AGENT_HOST: "live",
      // No loopback host: an info file that does not exist, and no XTRM_AGENT_HOST_PORT.
      XTRM_AGENT_HOST_INFO: join(process.env.XTRM_REAL_HOST_DEVICE_DIR, "no-agent-host.json"),
      XTRM_AGENT_DEVICE_FILE: DEVICE_FILE,
      XTRM_AGENT_CONNECTION_FILE: join(process.env.XTRM_REAL_HOST_DEVICE_DIR, "no-connection.json"),
      VITE_XTRM_GITHUB: "fixture",
      VITE_XTRM_SUBSTRATE: "fixture",
      
      VITE_XTRM_JIRA: "fixture", VITE_XTRM_RESEARCH: "fixture",
    },
  },
});
