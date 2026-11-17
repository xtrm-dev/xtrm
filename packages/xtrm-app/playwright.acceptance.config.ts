import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { hostPort } from "./e2e/real-host/harness.ts";

// Agent half acceptance against a real agent host (XTRM-601): PRD §36.11 criteria 1-14 and the Agent
// items of §31, one named test per criterion (e2e/acceptance). Run it with
// scripts/real-host-acceptance.sh, which installs the released host into a temp prefix and sets the
// isolated HOME, ports and SUBSTRATE_DB; see e2e/real-host/harness.ts for the host-side isolation.
//
// Two app servers share one host: `acceptance` reads the host on loopback; `acceptance-remote` has no
// loopback host and reaches it only through the direct-mode front with a paired device token, the way
// a remote host is reached (§35.5). Neither server is ever reused (a stale Vite on the port would test
// another tree).
const PORT = Number(process.env.XTRM_REAL_HOST_APP_PORT ?? 5297);
const REMOTE_PORT = Number(process.env.XTRM_REAL_HOST_APP_PORT2 ?? PORT + 1);
process.env.XTRM_REAL_HOST_DEVICE_DIR ??= mkdtempSync(join(tmpdir(), "xtrm-601-device-"));
const DEVICE_DIR = process.env.XTRM_REAL_HOST_DEVICE_DIR;

const app = (port: number, env: Record<string, string>) => ({
  command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
  url: `http://127.0.0.1:${port}`,
  reuseExistingServer: false,
  env: { VITE_XTRM_AGENT: "live", VITE_XTRM_AGENT_HOST: "live", VITE_XTRM_GITHUB: "fixture", VITE_XTRM_RESEARCH: "fixture", ...env },
});
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

export default defineConfig({
  testDir: "e2e/acceptance",
  outputDir: "e2e/.results/acceptance",
  globalSetup: "./e2e/real-host/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 600_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["json", { outputFile: "e2e/.results/acceptance-report.json" }]],
  use: { viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
  projects: [
    { name: "acceptance", testIgnore: "remote.spec.ts", use: { ...desktop, baseURL: `http://127.0.0.1:${PORT}` } },
    // Listed after the loopback project and run by the same single worker. Not a `dependencies` edge:
    // one failing loopback criterion must not skip this one.
    { name: "acceptance-remote", testMatch: "remote.spec.ts", use: { ...desktop, baseURL: `http://127.0.0.1:${REMOTE_PORT}` } },
  ],
  webServer: [
    app(PORT, {
      XTRM_AGENT_HOST_PORT: String(hostPort()),
      // @issue references resolve against the real board, read only (the bridge refuses writes).
      VITE_XTRM_SUBSTRATE: "live",
      XTRM_SUBSTRATE_WRITES: "0",
      XTRM_AGENT_CONNECTION_FILE: join(DEVICE_DIR, "loopback-no-connection.json"),
    }),
    app(REMOTE_PORT, {
      VITE_XTRM_SUBSTRATE: "fixture",
      XTRM_AGENT_HOST_INFO: join(DEVICE_DIR, "no-agent-host.json"),
      XTRM_AGENT_DEVICE_FILE: join(DEVICE_DIR, "app", "agent-host-device.json"),
      XTRM_AGENT_CONNECTION_FILE: join(DEVICE_DIR, "remote-no-connection.json"),
    }),
  ],
});
