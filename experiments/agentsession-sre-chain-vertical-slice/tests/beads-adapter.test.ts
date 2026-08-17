/**
 * Beads-adapter reconciliation tests (Requirement 1).
 *
 * These run against a real `bd` binary in a per-test temp directory. They
 * assert the NATIVE Epic/parent topology and prove that no step- or
 * chain-closure path requires `bd close --force`.
 *
 * If `bd` is not installed or refuses to init in the temp dir (nested
 * .beads/ ancestor case), the test suite short-circuits with a soft skip —
 * matching the virtual-id fallback the adapter itself uses.
 */

import { describe, test as rawTest, expect, beforeAll } from "bun:test";
// bd init + a run's worth of bd create/dep calls costs ~10-15s on this box —
// give each test a generous budget so we don't SIGTERM bd mid-write.
const test = (name: string, fn: any) => rawTest(name, fn, 45_000);
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { materializeBeads, chainEpicIdOf, closeBead } from "../src/adapters/beads.ts";
import { newResolvedChain } from "../src/chain/topology.ts";
import { initRunDir, loadBeadsMap, paths, type Paths } from "../src/chain/store.ts";
import type { ResolvedChain } from "../src/chain/types.ts";

const pexec = promisify(execFile);

const FP = {
  pi_package: { name: "pi", version: "0" },
  beads_version: "test",
  experiment_source_dir: "/dev/null",
  experiment_source_dirty: false,
  baseline_specialists: [],
};

async function bdAvailable(): Promise<boolean> {
  try {
    await pexec("bd", ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function bdInDb(dbDir: string, args: string[]) {
  return pexec("bd", ["--sandbox", ...args], { cwd: dbDir, maxBuffer: 8 * 1024 * 1024 });
}

async function freshRun(): Promise<{ p: Paths; chain: ResolvedChain; stateDir: string }> {
  // Place the run under /tmp (outside any project's .beads/ ancestor) so
  // `bd init` can nest cleanly.
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "svs-bd-"));
  const chainRunId = "run-t";
  const p = paths(stateDir, chainRunId);
  await initRunDir(p);
  const chain = newResolvedChain({
    chain_id: "chain-t",
    root_bead_id: "op-bd-ext-42",
    fingerprint: FP,
  });
  return { p, chain, stateDir };
}

let BD_OK = false;
beforeAll(async () => {
  BD_OK = await bdAvailable();
});

describe("beads adapter — reconciled topology", () => {
  test("materialize creates one ChainRun Epic + native child step beads with external ref", async () => {
    if (!BD_OK) return;
    const { p, chain } = await freshRun();
    const map = await materializeBeads({
      paths: p,
      chain,
      externalRootRef: "op-bd-ext-42",
      title: `[test] ${chain.chain_id} ChainRun`,
    });
    // Fell back to virtual? then bd could not init here — soft-skip the rest.
    if (map.chain_epic_id.startsWith("vsvs-")) return;

    expect(map.chain_epic_id).toBeTruthy();
    expect(map.external_root_bead_ref).toBe("op-bd-ext-42");
    for (const s of chain.topology) {
      expect(map.step_bead_ids[s.step_id]).toBeTruthy();
    }

    // Epic type is 'epic' (bd show --json returns an array of matching issues).
    const { stdout: epicJson } = await bdInDb(p.beadsDbDir, ["show", map.chain_epic_id, "--json"]);
    const epic = JSON.parse(epicJson)[0];
    expect(epic.issue_type).toBe("epic");

    // Every step is a native child of Epic (bd children --json also returns an array).
    const { stdout: childrenJson } = await bdInDb(p.beadsDbDir, ["children", map.chain_epic_id, "--json"]);
    const kids = JSON.parse(childrenJson);
    const ids = new Set(kids.map((k: any) => k.id));
    for (const s of chain.topology) {
      expect(ids.has(map.step_bead_ids[s.step_id])).toBe(true);
    }
    // And the child bead exposes `parent` = ChainRun Epic id.
    const { stdout: firstChild } = await bdInDb(p.beadsDbDir, ["show", map.step_bead_ids["coordinator-entry"]!, "--json"]);
    expect(JSON.parse(firstChild)[0].parent).toBe(map.chain_epic_id);
  });

  test("no fake dep edge from any step bead back to Epic", async () => {
    if (!BD_OK) return;
    const { p, chain } = await freshRun();
    const map = await materializeBeads({
      paths: p, chain, externalRootRef: "op-bd-ext-42", title: "[test] deps",
    });
    if (map.chain_epic_id.startsWith("vsvs-")) return;

    for (const s of chain.topology) {
      const stepId = map.step_bead_ids[s.step_id]!;
      const { stdout } = await bdInDb(p.beadsDbDir, ["show", stepId, "--json"]);
      const j = JSON.parse(stdout)[0];
      const deps: any[] = j.dependencies ?? [];
      // A parent-child dep to Epic is EXPECTED and correct (native hierarchy).
      // A `blocks` dep to Epic is the FAKE readiness edge we removed.
      for (const d of deps) {
        if (d.id === map.chain_epic_id) {
          expect(d.dependency_type).toBe("parent-child");
        }
      }
    }
  });

  test("real readiness deps present between step beads", async () => {
    if (!BD_OK) return;
    const { p, chain } = await freshRun();
    const map = await materializeBeads({
      paths: p, chain, externalRootRef: "op-bd-ext-42", title: "[test] readiness",
    });
    if (map.chain_epic_id.startsWith("vsvs-")) return;

    // diagnostician blocked-by BOTH explorer and observability
    const diagId = map.step_bead_ids["diagnostician"]!;
    const { stdout } = await bdInDb(p.beadsDbDir, ["show", diagId, "--json"]);
    const j = JSON.parse(stdout)[0];
    const raw: any[] = j.dependencies ?? [];
    const blockerIds = new Set(
      raw.filter((d: any) => d.dependency_type === "blocks").map((d: any) => d.id),
    );
    expect(blockerIds.has(map.step_bead_ids["explorer"]!)).toBe(true);
    expect(blockerIds.has(map.step_bead_ids["observability"]!)).toBe(true);
  });

  test("second materialize is idempotent — same map, no dup Epic or children", async () => {
    if (!BD_OK) return;
    const { p, chain } = await freshRun();
    const first = await materializeBeads({
      paths: p, chain, externalRootRef: "op-bd-ext-42", title: "[test] idem",
    });
    const second = await materializeBeads({
      paths: p, chain, externalRootRef: "op-bd-ext-42", title: "[test] idem",
    });
    expect(second).toEqual(first);
    const persisted = await loadBeadsMap(p);
    expect(persisted).toEqual(first);
  });

  test("child step closes WITHOUT --force once its real blockers are closed", async () => {
    if (!BD_OK) return;
    const { p, chain } = await freshRun();
    const map = await materializeBeads({
      paths: p, chain, externalRootRef: "op-bd-ext-42", title: "[test] noforce",
    });
    if (map.chain_epic_id.startsWith("vsvs-")) return;

    // coordinator-entry has no blockers — should close cleanly.
    await closeBead(p.beadsDbDir, map.step_bead_ids["coordinator-entry"]!, "test — no blockers");

    // explorer's only blocker is coordinator-entry, which just closed.
    await closeBead(p.beadsDbDir, map.step_bead_ids["explorer"]!, "test — blocker satisfied");

    const { stdout } = await bdInDb(p.beadsDbDir, ["show", map.step_bead_ids["explorer"]!, "--json"]);
    const j = JSON.parse(stdout)[0];
    expect(j.status).toBe("closed");
  });

  test("ChainRun Epic closes after all children close", async () => {
    if (!BD_OK) return;
    const { p, chain } = await freshRun();
    const map = await materializeBeads({
      paths: p, chain, externalRootRef: "op-bd-ext-42", title: "[test] epicclose",
    });
    if (map.chain_epic_id.startsWith("vsvs-")) return;

    // Close every child in dependency order.
    const orderedSteps = [
      "coordinator-entry",
      "explorer",
      "observability",
      "diagnostician",
      "reviewer",
      "coordinator-close",
    ];
    for (const stepId of orderedSteps) {
      await closeBead(p.beadsDbDir, map.step_bead_ids[stepId]!, `test — ${stepId} satisfied`);
    }
    await closeBead(p.beadsDbDir, chainEpicIdOf(map), "test — chain terminal");
    const { stdout } = await bdInDb(p.beadsDbDir, ["show", chainEpicIdOf(map), "--json"]);
    const j = JSON.parse(stdout)[0];
    expect(j.status).toBe("closed");
  });
});
