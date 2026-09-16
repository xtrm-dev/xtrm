import type { ProgramAdapter } from "../types.ts";
import { mapProgramme, type WireProgrammeResponse } from "./live.ts";

// Development fixture in the wire shape, so the fixture exercises the same mapper as live.
// Content is illustrative. `metadata.executable_refs` is a proposed field (see live.ts).

const rec = (id: string, title: string, status: string, refs: string[], jira: string[] = []) => ({
  id,
  title,
  status,
  path: `programme/${id.toLowerCase()}.md`,
  updated_at: "2026-09-16T12:00:00Z",
  jira_refs: jira,
  metadata: { executable_refs: refs },
});

export const fixtureProgrammeResponse: WireProgrammeResponse = {
  freshness: "fresh",
  source_health: {},
  snapshot: {
    generated_at: "2026-09-16T16:40:00Z",
    programme: { repository: "mercuryintelligence/program", branch: "master", short_sha: "159e3b5" },
    now: { title: "Console v2 base shell before the Agent/Frames tranche", evidence_cutoff: "2026-09-16" },
    workstreams: [
      rec("WS-003", "XTRM Console v2", "active", ["XTRM-300", "XTRM-303"], ["ISSUE-140"]),
      rec("WS-004", "Substrate read models", "active", ["XTRM-304", "XTRM-305"]),
      rec("WS-007", "Agent/Frames runtime", "planned", ["XTRM-310"]),
    ],
    assignments: [
      rec("ASG-021", "Executable shell vertical", "in_flight", ["XTRM-300"], ["ISSUE-140"]),
      rec("ASG-022", "Batched readiness listing", "proposed", ["XTRM-304"]),
    ],
    decisions: [
      rec("DEC-011", "Supernova is the visual benchmark", "accepted", []),
      rec("DEC-012", "Frame belongs to exactly one AgentSession", "accepted", ["XTRM-310"]),
      rec("DEC-013", "Substrate reads only through the typed service", "accepted", ["XTRM-305"]),
    ],
    activity: [
      { sha: "159e3b5", date: "2026-09-16", subject: "state: WS-003 shell vertical in flight", url: "https://github.com/mercuryintelligence/program/commit/159e3b5" },
      { sha: "a41c0de", date: "2026-09-15", subject: "decision: DEC-013 typed-service boundary", url: "https://github.com/mercuryintelligence/program/commit/a41c0de" },
    ],
  },
};

export const fixtureProgram: ProgramAdapter = {
  source: "fixture",
  async snapshot() {
    return mapProgramme(fixtureProgrammeResponse);
  },
};
