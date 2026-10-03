import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { startRealHost, stopRealHost, log } from "./harness.ts";

/** Starts the isolated host; the returned function is Playwright's teardown and runs even when tests fail. */
export default async function globalSetup() {
  const dir = resolve(".receipts", "real-host");
  mkdirSync(dir, { recursive: true });
  const runLog = join(dir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const state = await startRealHost(runLog);
  process.env.XTRM_REAL_HOST_STATE = JSON.stringify(state);
  return () => {
    log(state, "teardown");
    stopRealHost(state);
    // Direct mode: the bridge's device token file (playwright.real-host-direct.config.ts).
    const deviceDir = process.env.XTRM_REAL_HOST_DEVICE_DIR;
    if (deviceDir) {
      rmSync(deviceDir, { recursive: true, force: true });
      log(state, `removed ${deviceDir} (device token included)`);
    }
  };
}
