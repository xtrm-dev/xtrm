/**
 * finalize.ts bundle-writer tests.
 *
 * Verifies the sre-triage-runs bundle shape against the mercury/infra seed
 * contract (INDEXING-DECISION.md): deterministic file list, chain-report.v1
 * schema key, gotchas.jsonl line shape, and both terminal states covered.
 */

import { test, expect, describe } from "bun:test";
import * as path from "node:path";
import * as os from "node:os";
import * as fsp from "node:fs/promises";
import { paths, initRunDir, saveRunState, saveResolvedChain } from "../src/chain/store.ts";
import { newResolvedChain } from "../src/chain/topology.ts";
import { initialRunState } from "../src/chain/reducer.ts";
import { appendJsonl } from "../src/util/fs.ts";
import { writeSreTriageBundle, terminalStateOf, utcCompact } from "../src/chain/finalize.ts";
import type { EvidenceEnvelope } from "../src/chain/types.ts";

function makeEvidence(step: string, kind: string, id: string, summary: string): EvidenceEnvelope {
  return {
    evidence_id: id,
    chain_id: "chain-sre-test",
    producer_participant_id: `chain-sre-test::${step}`,
    producer_role: (step === "coordinator-entry" || step === "coordinator-close"
      ? "chain-coordinator"
      : step) as any,
    step_id: step,
    execution_id: "exec-test",
    kind: kind as any,
    summary,
    schema_version: 1,
    body_ref: `${id}.json`,
    created_at: "2026-08-19T01:00:00Z",
    scope_refs: [],
  };
}

async function buildRun(tmp: string, terminalStatus: string): Promise<{ p: any; runState: any }> {
  const stateDir = path.join(tmp, "state");
  const chainRunId = "run-sre-test1";
  const p = paths(stateDir, chainRunId);
  await initRunDir(p);
  const chain = newResolvedChain({
    root_bead_id: "test-root",
    fingerprint: {
      pi_package: { name: "test", version: "0" },
      beads_version: "test",
      experiment_source_dir: path.resolve("."),
      experiment_source_dirty: false,
      baseline_specialists: [],
    },
  });
  await saveResolvedChain(p, chain);
  const run = initialRunState(chain, chainRunId);
  run.status = terminalStatus;
  run.reviewer_verdict = terminalStatus === "closed_pass" ? "PASS" : undefined;
  // Mark all steps satisfied for a closed run.
  for (const st of Object.values(run.steps)) st.status = "satisfied";
  await saveRunState(p, run);

  const evs = [
    makeEvidence("coordinator-entry", "coordinator.decision", "ev-coordinato-test1", "ENTRY: baseline opened"),
    makeEvidence("explorer", "topology.map", "ev-topology-m-test1", "EXPLORER: 6 containers mapped"),
  ];
  await appendJsonl(p.evidenceIndex, evs[0]);
  await appendJsonl(p.evidenceIndex, evs[1]);
  await fsp.writeFile(
    path.join(p.evidenceDir, "ev-coordinato-test1.json"),
    JSON.stringify({ phase: "entry", incident_restatement: "baseline", next_actions: ["check alerts"] }),
    "utf8",
  );
  await fsp.writeFile(path.join(p.evidenceDir, "ev-topology-m-test1.json"), JSON.stringify({ hosts: ["h1"] }), "utf8");
  await fsp.writeFile(p.messagesJsonl, JSON.stringify({ id: 1, kind: "work.turn" }) + "\n", "utf8");
  await fsp.writeFile(p.forensicsEvents, JSON.stringify({ kind: "step.start" }) + "\n", "utf8");
  return { p, runState: run };
}

describe("terminalStateOf", () => {
  test("closed_* maps to satisfied", () => {
    expect(terminalStateOf("closed_pass")).toBe("satisfied");
    expect(terminalStateOf("closed_fail")).toBe("satisfied");
    expect(terminalStateOf("closed_inconclusive")).toBe("satisfied");
  });
  test("escalated maps to escalated", () => {
    expect(terminalStateOf("escalated")).toBe("escalated");
  });
  test("non-terminal states map to null", () => {
    expect(terminalStateOf("running")).toBeNull();
    expect(terminalStateOf("blocked")).toBeNull();
    expect(terminalStateOf("initialized")).toBeNull();
  });
});

describe("utcCompact", () => {
  test("formats ISO to compact UTC", () => {
    expect(utcCompact("2026-08-19T01:53:44Z")).toBe("20260819T015344Z");
    expect(utcCompact("2026-08-19T01:53:44.123Z")).toBe("20260819T015344Z");
  });
});

describe("writeSreTriageBundle", () => {
  test("writes all 6 file groups for a satisfied run with schema key", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "finalize-"));
    try {
      const { p, runState } = await buildRun(tmp, "closed_pass");
      const facts: any[] = [];
      const res = await writeSreTriageBundle({
        paths: p,
        runState,
        targetRepo: path.join(tmp, "target"),
        terminalState: "satisfied",
        chainId: "chain-sre-test",
        chainRunId: "run-sre-test1",
        onFact: (f) => facts.push(f),
      });
      expect(res).not.toBeNull();
      expect(res!.files_written).toContain("chain-report.v1.json");
      expect(res!.files_written).toContain("report.md");
      expect(res!.files_written).toContain("gotchas.jsonl");
      expect(res!.files_written).toContain("forensics.jsonl");
      expect(res!.files_written).toContain("messages.jsonl");
      expect(res!.files_written.some((f) => f.startsWith("evidence/"))).toBeTrue();
      expect(fsStat(path.join(res!.bundle_path, "chain-report.v1.json"))).toBeTrue();

      const report = JSON.parse(await fsp.readFile(path.join(res!.bundle_path, "chain-report.v1.json"), "utf8"));
      expect(report.schema).toBe("chain-report.v1");
      expect(Array.isArray(report.next_actions)).toBeTrue();
      expect(report.terminal_state).toBe("satisfied");

      // gotchas.jsonl line shape
      const gotchas = (await fsp.readFile(path.join(res!.bundle_path, "gotchas.jsonl"), "utf8")).trim().split("\n").filter(Boolean);
      expect(gotchas.length).toBeGreaterThan(0);
      for (const line of gotchas) {
        const g = JSON.parse(line);
        expect(g).toHaveProperty("kind");
        expect(g).toHaveProperty("resource");
        expect(g).toHaveProperty("symptom");
        expect(g).toHaveProperty("evidence_ref");
        expect(g).toHaveProperty("fix_applied");
        expect(g).toHaveProperty("worked");
        expect(g).toHaveProperty("prior_run_refs");
      }

      // forensics + messages copied
      expect(await fsp.readFile(path.join(res!.bundle_path, "forensics.jsonl"), "utf8")).toContain("step.start");
      expect(await fsp.readFile(path.join(res!.bundle_path, "messages.jsonl"), "utf8")).toContain("work.turn");

      // sre-triage.bundle.written fact with all fields
      const bw = facts.find((f) => f.kind === "sre-triage.bundle.written");
      expect(bw).toBeDefined();
      expect(bw.meta.chain_id).toBe("chain-sre-test");
      expect(bw.meta.chain_run_id).toBe("run-sre-test1");
      expect(bw.meta.bundle_path).toBe(res!.bundle_path);
      expect(bw.meta.terminal_state).toBe("satisfied");
      expect(Array.isArray(bw.meta.files_written)).toBeTrue();
      expect(typeof bw.meta.bytes_written).toBe("number");
      expect(typeof bw.meta.elapsed_ms).toBe("number");
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  test("writes a bundle for an escalated run", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "finalize-"));
    try {
      const { p, runState } = await buildRun(tmp, "escalated");
      const facts: any[] = [];
      const res = await writeSreTriageBundle({
        paths: p,
        runState,
        targetRepo: path.join(tmp, "target"),
        terminalState: "escalated",
        chainId: "chain-sre-test",
        chainRunId: "run-sre-test1",
        onFact: (f) => facts.push(f),
      });
      expect(res).not.toBeNull();
      const report = JSON.parse(await fsp.readFile(path.join(res!.bundle_path, "chain-report.v1.json"), "utf8"));
      expect(report.schema).toBe("chain-report.v1");
      expect(report.terminal_state).toBe("escalated");
      expect(facts.some((f) => f.kind === "sre-triage.bundle.written")).toBeTrue();
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  test("missing messages file emits fact.warning and does not throw", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "finalize-"));
    try {
      const { p, runState } = await buildRun(tmp, "closed_pass");
      await fsp.rm(p.messagesJsonl, { force: true });
      const facts: any[] = [];
      const res = await writeSreTriageBundle({
        paths: p,
        runState,
        targetRepo: path.join(tmp, "target"),
        terminalState: "satisfied",
        chainId: "chain-sre-test",
        chainRunId: "run-sre-test1",
        onFact: (f) => facts.push(f),
      });
      expect(res).toBeNull();
      expect(facts.some((f) => f.kind === "fact.warning")).toBeTrue();
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});

function fsStat(p: string): boolean {
  try {
    const s = require("node:fs").statSync(p);
    return s.isFile();
  } catch {
    return false;
  }
}
