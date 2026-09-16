import { createContext, useContext, type ReactNode } from "react";
import { fixtureGithub } from "./github/fixture.ts";
import { liveGithub } from "./github/live.ts";
import { fixtureProgram } from "./program/fixture.ts";
import { liveProgram } from "./program/live.ts";
import { fixtureSubstrate } from "./substrate/fixture.ts";
import { liveSubstrate } from "./substrate/live.ts";
import type { Adapters, DataSource } from "./types.ts";

export type * from "./types.ts";

/**
 * Source selection is configuration, never a component decision (§9.3).
 * Defaults: GitHub live (Console v1 backend), Substrate live (sb CLI bridge),
 * Program fixture (the backend's programme route is disabled by deployment policy).
 */
export function adaptersFromEnv(env: Record<string, string | undefined> = import.meta.env): Adapters {
  const pick = (key: string, fallback: DataSource): DataSource => (env[key] === "live" || env[key] === "fixture" ? env[key] : fallback);
  return {
    github: pick("VITE_XTRM_GITHUB", "live") === "live" ? liveGithub : fixtureGithub,
    substrate: pick("VITE_XTRM_SUBSTRATE", "live") === "live" ? liveSubstrate : fixtureSubstrate,
    program: pick("VITE_XTRM_PROGRAM", "fixture") === "live" ? liveProgram : fixtureProgram,
  };
}

export const fixtureAdapters: Adapters = { github: fixtureGithub, substrate: fixtureSubstrate, program: fixtureProgram };

const AdaptersContext = createContext<Adapters | null>(null);

export function AdaptersProvider({ adapters, children }: { adapters: Adapters; children: ReactNode }) {
  return <AdaptersContext.Provider value={adapters}>{children}</AdaptersContext.Provider>;
}

export function useAdapters(): Adapters {
  const value = useContext(AdaptersContext);
  if (!value) throw new Error("useAdapters outside AdaptersProvider");
  return value;
}
