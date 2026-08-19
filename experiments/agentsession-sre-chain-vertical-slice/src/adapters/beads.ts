/**
 * Beads adapter — wraps the installed `bd` CLI.
 *
 * The experiment uses its OWN sandboxed beads DB under
 *   <state-dir>/<chain-run-id>/beads/beads.db
 * so it never contaminates real project beads. The operator-supplied external
 * root-bead-id is stored as an `--external-ref` on the ChainRun Epic — this
 * keeps provenance without any cross-DB dependency (bd does not support
 * cross-DB deps anyway).
 *
 * Beads topology materialized per run:
 *
 *   ChainRun Epic  (bd type=epic, --external-ref=<external_root_bead_ref>)
 *     ├── coordinator-entry     (bd type=task, --parent=<epic>)
 *     ├── explorer              (bd type=task, --parent=<epic>)
 *     ├── observability         (bd type=task, --parent=<epic>)
 *     ├── diagnostician         (bd type=task, --parent=<epic>)
 *     ├── reviewer              (bd type=task, --parent=<epic>)
 *     └── coordinator-close     (bd type=task, --parent=<epic>)
 *
 * Real execution-readiness dependencies (`blocked-by`) are added between
 * step beads ONLY, following ResolvedChain.topology[].needs. There is NO
 * fake dep edge from any step bead to the Epic — that was what forced
 * `bd close --force` in the pre-reconciliation adapter.
 *
 * Materialization is idempotent: beads-map.json persists the mapping;
 * subsequent calls short-circuit on `loadBeadsMap`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import type { BeadsMap, ResolvedChain } from "../chain/types.ts";
import { loadBeadsMap, saveBeadsMap, type Paths } from "../chain/store.ts";

const pexec = promisify(execFile);

async function bd(args: string[], dbDir: string): Promise<{ stdout: string; stderr: string }> {
  // --sandbox prevents Dolt auto-push. cwd is the isolated dir with its own
  // .beads/, so bd's auto-discovery picks up our sandboxed DB before walking
  // to a parent repo's .beads/.
  const finalArgs = ["--sandbox", ...args];
  const { stdout, stderr } = await pexec("bd", finalArgs, { cwd: dbDir, maxBuffer: 8 * 1024 * 1024 });
  return { stdout, stderr };
}

/** Initialise the per-run beads DB (idempotent). */
async function ensureBeadsInit(dbDir: string): Promise<void> {
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  if (fs.existsSync(path.join(dbDir, ".beads"))) return;
  try {
    await pexec("bd", ["init", "--non-interactive", "--prefix", "svs"], {
      cwd: dbDir,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
    });
  } catch (e: any) {
    const stderr = String(e?.stderr ?? "");
    const stdout = String(e?.stdout ?? "");
    if (!/already|initialized/i.test(stderr + stdout)) {
      throw new Error(`bd init failed in ${dbDir}: ${e?.message}\nstderr=${stderr}\nstdout=${stdout}`);
    }
  }
  if (!fs.existsSync(path.join(dbDir, ".beads"))) {
    throw new Error(`bd init did not create .beads in ${dbDir}`);
  }
}

function normalizedBeadId(raw: string): string {
  const id = raw.trim().split("\n").pop()!.trim();
  if (!/^[a-z0-9]+-[a-z0-9.]+$/i.test(id)) {
    throw new Error(`unexpected bead id from bd: ${JSON.stringify(raw)}`);
  }
  return id;
}

/** Materialize ChainRun Epic + native child step beads per spec §4.
 *
 * If bd init cannot create an isolated DB (nested .beads/ ancestor blocks it),
 * we fall back to VIRTUAL step ids so the experiment can still walk the
 * topology. This fallback is documented in the experiment report.
 */
export async function materializeBeads(args: {
  paths: Paths;
  chain: ResolvedChain;
  externalRootRef?: string;
  title: string;
}): Promise<BeadsMap> {
  const existing = await loadBeadsMap(args.paths);
  if (existing) return existing;

  try {
    await ensureBeadsInit(args.paths.beadsDbDir);
  } catch (e: any) {
    const virtualStep: Record<string, string> = {};
    for (const s of args.chain.topology) {
      virtualStep[s.step_id] = `vsvs-${args.chain.chain_id}-${s.step_id}`;
    }
    const map: BeadsMap = {
      chain_epic_id: `vsvs-${args.chain.chain_id}-epic`,
      step_bead_ids: virtualStep,
      external_root_bead_ref: args.externalRootRef,
    };
    await saveBeadsMap(args.paths, map);
    process.stderr.write(
      `[beads-adapter] bd init unavailable in ${args.paths.beadsDbDir} (${(e?.message ?? e).toString().split("\n")[0]}); using VIRTUAL step ids.\n`,
    );
    return map;
  }

  // 1) ChainRun Epic (native bd epic type; external ref if supplied).
  const epicArgs = ["q", args.title, "-t", "epic"];
  const epicOut = await bd(epicArgs, args.paths.beadsDbDir);
  const chainEpicId = normalizedBeadId(epicOut.stdout);
  {
    const desc = [
      `chain_id: ${args.chain.chain_id}`,
      args.externalRootRef ? `external_root_bead_ref: ${args.externalRootRef}` : "",
      "role: ChainRun Epic (SRE vertical-slice experiment)",
    ]
      .filter(Boolean)
      .join("\n");
    const updateArgs = ["update", chainEpicId, "-d", desc];
    if (args.externalRootRef) {
      // Native provenance reference — never used as a blocking parent.
      // bd `update` accepts --external-ref alongside description.
      updateArgs.push("--external-ref", args.externalRootRef);
    }
    await bd(updateArgs, args.paths.beadsDbDir).catch((e: any) => {
      process.stderr.write(`[beads-adapter] epic update failed (non-fatal): ${e?.message ?? e}\n`);
    });
  }

  // 2) Native child step beads (bd q --parent=<epic>). NO fake dep edge to Epic.
  const step_bead_ids: Record<string, string> = {};
  for (const s of args.chain.topology) {
    const stepTitle = `[${args.chain.chain_id}] ${s.step_id} (${s.role})`;
    const out = await bd(
      ["q", stepTitle, "--parent", chainEpicId, "-t", "task"],
      args.paths.beadsDbDir,
    );
    step_bead_ids[s.step_id] = normalizedBeadId(out.stdout);
  }

  // 3) Real readiness deps: step-to-step blocked-by only.
  for (const s of args.chain.topology) {
    for (const needId of s.needs) {
      const blocker = step_bead_ids[needId];
      const blocked = step_bead_ids[s.step_id];
      if (!blocker || !blocked) continue;
      await bd(["dep", "add", blocked, blocker], args.paths.beadsDbDir).catch((e: any) => {
        process.stderr.write(`[beads-adapter] dep add ${blocked}<-${blocker} failed: ${e?.message ?? e}\n`);
      });
    }
  }

  const map: BeadsMap = {
    chain_epic_id: chainEpicId,
    step_bead_ids,
    external_root_bead_ref: args.externalRootRef,
  };
  await saveBeadsMap(args.paths, map);
  return map;
}

/** Backwards-compat reader: return the parent bead id regardless of which
 * field name a persisted beads-map.json uses. */
export function chainEpicIdOf(map: BeadsMap): string {
  return map.chain_epic_id ?? map.root_bead_id!;
}

/** Append a note to a bead — used for evidence pointers per spec §11. */
export async function noteBead(dbDir: string, beadId: string, note: string): Promise<void> {
  // Virtual-mode ids (bd init refused): no real DB exists, so bd note would always fail.
  if (beadId.startsWith("vsvs-")) return;
  // bd note <id> takes note text POSITIONALLY (no -m flag).
  await bd(["note", beadId, note], dbDir).catch((e: any) => {
    process.stderr.write(`[beads] noteBead ${beadId} failed: ${e?.message ?? e}\n`);
  });
}

/** Close a bead. NO `--force`: native Epic/parent topology means children can
 * close as soon as their real readiness deps satisfy, and the Epic closes
 * after all children — bd's own blocking check is now correct. If a close
 * fails, surface it so a real disagreement between runtime and bd is not
 * hidden. */
export async function closeBead(dbDir: string, beadId: string, reason?: string): Promise<void> {
  // Virtual-mode ids (bd init refused): no real DB exists, so bd close would always fail.
  if (beadId.startsWith("vsvs-")) return;
  const args = ["close", beadId];
  if (reason) args.push("--reason", reason);
  await bd(args, dbDir).catch((e: any) => {
    process.stderr.write(`[beads] closeBead ${beadId} failed: ${e?.message ?? e}\n`);
    throw e;
  });
}

/** Report bd + pi package versions for fingerprinting. */
export async function versionInfo(): Promise<{ beads_version: string }> {
  const { stdout } = await pexec("bd", ["--version"], { maxBuffer: 1024 * 64 }).catch(() => ({ stdout: "" } as any));
  return { beads_version: (stdout || "").trim() };
}
