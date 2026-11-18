import { describe, expect, it } from "vitest";
import type { ProjectHealth } from "../adapters/status-board/types.ts";
import { freshness } from "./ProjectShell.tsx";

const health = (overrides: Partial<ProjectHealth> = {}): ProjectHealth => ({
  configured: true,
  reason: null,
  lastSyncOkAt: new Date(Date.now() - 4 * 60_000).toISOString(),
  driftCount: 0,
  unitActive: true,
  unitActiveReason: null,
  timerUnit: "status-board.timer",
  scheduleActive: true,
  scheduleActiveReason: null,
  runInProgress: false,
  runInProgressReason: null,
  stale: false,
  checkedAt: new Date().toISOString(),
  ...overrides,
});

describe("Project header freshness (§4)", () => {
  it("waits instead of guessing while the health read is in flight", () => {
    expect(freshness(null)).toBe("checking sync");
  });

  it("names the unbound repository rather than a sync time", () => {
    expect(freshness(health({ configured: false, reason: "repo_not_bound", lastSyncOkAt: null }))).toBe("not integrated");
  });

  it("is quiet about an in-flight run", () => {
    expect(freshness(health({ runInProgress: true, stale: true }))).toBe("syncing now");
  });

  it("says never synced when the bridge recorded no success", () => {
    expect(freshness(health({ lastSyncOkAt: null }))).toBe("never synced");
  });

  it("marks an unverified unit as unverified, never as down", () => {
    const value = freshness(health({ unitActive: null, unitActiveReason: "non_user_session" }));
    expect(value).toMatch(/^synced .+ · sync unverified$/);
  });

  it("reports the last successful sync in ordinary terms", () => {
    expect(freshness(health())).toMatch(/^synced \d+m ago$/);
  });
});
