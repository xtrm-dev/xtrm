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
  const dbFile = path.join(dbDir, "beads.db");
  // Explicit --db to prevent bd from walking up and hitting a parent repo's beads DB.
  const finalArgs = ["--db", dbFile, "--sandbox", ...args];
  const env = { ...process.env, BEADS_DB: dbFile };
  const { stdout, stderr } = await pexec("bd", finalArgs, { env, cwd: dbDir, maxBuffer: 8 * 1024 * 1024 });
  return { stdout, stderr };
}

/** Initialise the per-run beads DB (idempotent). */
async function ensureBeadsInit(dbDir: string): Promise<void> {
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  const dbFile = path.join(dbDir, "beads.db");
  if (fs.existsSync(dbFile)) return;
  // bd auto-inits on first write; use `bd status` to trigger the DB creation.
  try {
    await bd(["status"], dbDir);
  } catch {
    // ignore — first-write path below will create if needed
  }
}

/** Materialize root + step beads per spec §4. Returns the mapping. */
export async function materializeBeads(args: {
  paths: Paths;
  chain: ResolvedChain;
  externalRootRef?: string; // operator-supplied root-bead-id in the real project's DB
  title: string;
}): Promise<BeadsMap> {
  const existing = await loadBeadsMap(args.paths);
  if (existing) return existing;

  await ensureBeadsInit(args.paths.beadsDbDir);

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
  await bd(["note", beadId, "-m", note], dbDir).catch(() => {});
}

/** Close a bead — coordinator-close step marks the root closed. */
export async function closeBead(dbDir: string, beadId: string, reason?: string): Promise<void> {
  const args = ["close", beadId];
  if (reason) args.push("-m", reason);
  await bd(args, dbDir).catch(() => {});
}

/** Report bd + pi package versions for fingerprinting. */
export async function versionInfo(): Promise<{ beads_version: string }> {
  const { stdout } = await pexec("bd", ["--version"], { maxBuffer: 1024 * 64 }).catch(() => ({ stdout: "" } as any));
  return { beads_version: (stdout || "").trim() };
}
