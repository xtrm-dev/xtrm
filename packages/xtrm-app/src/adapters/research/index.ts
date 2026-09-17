import { fixtureResearch } from "./fixture.ts";
import { liveResearch } from "./live.ts";
import type { DataSource } from "../types.ts";

export type * from "./types.ts";

/**
 * Source selection is configuration, never a component decision (§9.3), matching
 * `adaptersFromEnv` in ../index.tsx. Not wired into the global `Adapters` shape yet —
 * that lands with the Research destination and chart-data verb (later slices).
 */
export function researchAdapterFromEnv(env: Record<string, string | undefined> = import.meta.env) {
  const source: DataSource = env.VITE_XTRM_RESEARCH === "fixture" ? "fixture" : "live";
  return source === "live" ? liveResearch : fixtureResearch;
}
