/**
 * Beads adapter — wraps the installed `bd` CLI.
 *
 * The experiment uses its OWN sandboxed beads DB under
 *   <state-dir>/<chain-run-id>/beads/beads.db
 * so it never contaminates real project beads. The operator-supplied root-bead-id
 * is stored as an EXTERNAL_REF field on our internal root bead — this keeps
 * traceability without requiring cross-database dependencies (which bd doesn't
 * support across DB files anyway).
 *
 * Materialization is idempotent: rerunning produces the same beads-map because
 * we serialize the mapping to disk and reuse it. We only call `bd create` on the
 * first materialization; subsequent runs return the persisted mapping.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import type { BeadsMap, ResolvedChain } from "../chain/types.ts";
import { loadBeadsMap, saveBeadsMap, type Paths } from "../chain/store.ts";

const pexec = promisify(execFile);

async function bd(args: string[], dbDir: string): Promise<{ stdout: string; stderr: string }> {
  // Use --sandbox to prevent Dolt auto-push. cwd is the isolated dir with its own .beads/,
  // so bd's auto-discovery picks up our sandboxed DB before walking to a parent repo.
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

/** Materialize root + step beads per spec §4. Returns the mapping.
 *
 * If bd init cannot create an isolated DB (e.g. an ancestor .beads/ makes bd
 * refuse to nest), we fall back to VIRTUAL step ids so the experiment can
 * still walk the topology. This is documented as a spec-§4 gap in
 * experiment-report.md.
 */
export async function materializeBeads(args: {
  paths: Paths;
  chain: ResolvedChain;
  externalRootRef?: string; // operator-supplied root-bead-id in the real project's DB
  title: string;
}): Promise<BeadsMap> {
  const existing = await loadBeadsMap(args.paths);
  if (existing) return existing;

  try {
    await ensureBeadsInit(args.paths.beadsDbDir);
  } catch (e: any) {
    // Nested-ancestor case (bd refuses to init inside a tree that already has .beads/).
    // Fall back to virtual ids — the experiment persists its own beads-map.json, and
    // the operator-supplied externalRootRef stays in the design-inputs fingerprint.
    const virtualStep: Record<string, string> = {};
    for (const s of args.chain.topology) {
      virtualStep[s.step_id] = `vsvs-${args.chain.chain_id}-${s.step_id}`;
    }
    const map: BeadsMap = {
      root_bead_id: args.externalRootRef ?? `vsvs-${args.chain.chain_id}-root`,
      step_bead_ids: virtualStep,
    };
    await saveBeadsMap(args.paths, map);
    // Surface the fallback for visibility.
    process.stderr.write(
      `[beads-adapter] bd init unavailable in ${args.paths.beadsDbDir} (${(e?.message ?? e).toString().split("\n")[0]}); using VIRTUAL step ids.\n`,
    );
    return map;
  }

  // Create root bead.
  const rootTitle = args.title;
  const rootOut = await bd(
    ["q", rootTitle],
    args.paths.beadsDbDir,
  );
  const rootId = rootOut.stdout.trim().split("\n").pop()!.trim();
  if (!/^[a-z0-9-]+$/i.test(rootId)) {
    throw new Error(`unexpected root bead id from bd q: ${JSON.stringify(rootOut.stdout)}`);
  }
  // Add description tying to external ref + chain id
  const desc = [
    `chain_id: ${args.chain.chain_id}`,
    args.externalRootRef ? `external_root_bead_ref: ${args.externalRootRef}` : "",
    "role: chain root (SRE vertical-slice experiment)",
  ]
    .filter(Boolean)
    .join("\n");
  await bd(["update", rootId, "-d", desc], args.paths.beadsDbDir);

  // Create one step bead per topology step.
  const step_bead_ids: Record<string, string> = {};
  for (const s of args.chain.topology) {
    const stepTitle = `[${args.chain.chain_id}] ${s.step_id} (${s.role})`;
    const out = await bd(["q", stepTitle], args.paths.beadsDbDir);
    const id = out.stdout.trim().split("\n").pop()!.trim();
    step_bead_ids[s.step_id] = id;
    // Parent link
    await bd(["dep", "add", id, rootId], args.paths.beadsDbDir).catch(() => {});
  }

  // Add blocks edges based on `needs` (child A blocks child B if B needs A).
  for (const s of args.chain.topology) {
    for (const needId of s.needs) {
      const blocker = step_bead_ids[needId];
      const blocked = step_bead_ids[s.step_id];
      if (!blocker || !blocked) continue;
      await bd(["dep", "add", blocked, blocker], args.paths.beadsDbDir).catch(() => {});
    }
  }

  const map: BeadsMap = { root_bead_id: rootId, step_bead_ids };
  await saveBeadsMap(args.paths, map);
  return map;
}

/** Append a note to a bead — used for evidence pointers per spec §11. */
export async function noteBead(dbDir: string, beadId: string, note: string): Promise<void> {
  // bd note <id> takes note text POSITIONALLY (no -m flag).
  await bd(["note", beadId, note], dbDir).catch((e: any) => {
    process.stderr.write(`[beads] noteBead ${beadId} failed: ${e?.message ?? e}\n`);
  });
}

/** Close a bead — --force because the runtime's step-satisfaction is authoritative
 *  and outranks bd's blocking check (child beads are blocked-by root in our dep graph
 *  so bd would refuse to close them out of order without --force). */
export async function closeBead(dbDir: string, beadId: string, reason?: string): Promise<void> {
  const args = ["close", beadId, "--force"];
  if (reason) args.push("--reason", reason);
  await bd(args, dbDir).catch((e: any) => {
    process.stderr.write(`[beads] closeBead ${beadId} failed: ${e?.message ?? e}\n`);
  });
}

/** Report bd + pi package versions for fingerprinting. */
export async function versionInfo(): Promise<{ beads_version: string }> {
  const { stdout } = await pexec("bd", ["--version"], { maxBuffer: 1024 * 64 }).catch(() => ({ stdout: "" } as any));
  return { beads_version: (stdout || "").trim() };
}
