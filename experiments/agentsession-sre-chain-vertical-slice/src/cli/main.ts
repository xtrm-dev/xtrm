#!/usr/bin/env bun
/**
 * Vertical-slice entry point.
 */

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { parseArgs, helpText } from "./args.ts";
import { initRunDir, loadResolvedChain, paths, saveDesignInputs, saveResolvedChain, saveRunState } from "../chain/store.ts";
import { newResolvedChain } from "../chain/topology.ts";
import { initialRunState } from "../chain/reducer.ts";
import { materializeBeads, versionInfo } from "../adapters/beads.ts";
import { runToCompletion } from "../chain/scheduler.ts";
import { createLogger, defaultRender } from "../util/logger.ts";
import { nowIso, shortId } from "../util/ids.ts";
import { sha256File } from "../util/fs.ts";
import type { DesignInputsFingerprint } from "../chain/types.ts";

function readJsonSyncSafe<T>(p: string): T | null {
  try {
    return JSON.parse(fsSync.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

async function fingerprint(args: {
  targetRepo: string;
  rootBeadRef?: string;
}): Promise<DesignInputsFingerprint> {
  // Resolve installed pi package version from require.resolve; fall back to node_modules scan.
  const piPkgJsonPath = ["/home/dawid/dev/xtmux/node_modules/@earendil-works/pi-coding-agent/package.json"].find(
    fsSync.existsSync,
  );
  const piPkg = piPkgJsonPath ? readJsonSyncSafe<{ name: string; version: string }>(piPkgJsonPath) : null;
  const bd = await versionInfo();

  const baselineDir = "/home/dawid/projects/mercury/infra/.specialists/user";
  const baseline: DesignInputsFingerprint["baseline_specialists"] = [];
  for (const name of ["sre-coordinator", "sre-host-forensics", "sre-observability-forensics", "sre-change-forensics"]) {
    const p = `${baselineDir}/${name}.specialist.json`;
    if (fsSync.existsSync(p)) {
      const st = fsSync.statSync(p);
      baseline.push({ path: p, sha256: sha256File(p), size: st.size });
    }
  }

  return {
    produced_at: nowIso(),
    target_repo_path: path.resolve(args.targetRepo),
    root_bead_id: args.rootBeadRef ?? "",
    pi_package: {
      name: piPkg?.name ?? "@earendil-works/pi-coding-agent",
      version: piPkg?.version ?? "unknown",
      resolved_from: piPkgJsonPath ?? "not-found",
    },
    beads: { version: bd.beads_version },
    experiment: {
      source_dir: path.resolve(new URL("../..", import.meta.url).pathname),
    },
    baseline_specialists: baseline,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(helpText());
    return;
  }

  const stateDir = path.resolve(args.stateDir);
  await fs.mkdir(stateDir, { recursive: true });

  const chainRunId = args.resume ?? `run-${shortId("sre", 5)}`;
  const p = paths(stateDir, chainRunId);
  await initRunDir(p);

  const logger = createLogger({
    forensicsPath: p.forensicsEvents,
    ndjsonMode: args.json,
    humanRender: defaultRender,
  });
  const onFact = (f: any) => void logger.fact(f);

  if (args.resume) {
    const existing = await loadResolvedChain(p);
    if (!existing) {
      process.stderr.write(`resume: no resolved chain at ${p.resolvedChain}\n`);
      process.exit(2);
    }
    logger.human(`resuming chain_run_id=${chainRunId} chain_id=${existing.chain_id}`);
    // Run state is already persisted; the scheduler will re-derive readiness from evidence.
    if (args.reallyRunAgents) {
      await runToCompletion(
        {
          paths: p,
          chain: existing,
          channelId: `chain:${existing.chain_id}`,
          targetRepo: args.repo ?? process.cwd(),
          onFact,
        },
        "",
      );
    } else {
      logger.human("--no-agents: skipping dispatch");
    }
    return;
  }

  const targetRepo = args.repo ?? path.resolve(new URL("../../fixtures/tiny-repo", import.meta.url).pathname);
  if (!fsSync.existsSync(targetRepo)) {
    process.stderr.write(`target repo not found: ${targetRepo}\n`);
    process.exit(2);
  }

  const fp = await fingerprint({ targetRepo, rootBeadRef: args.rootBead });
  await saveDesignInputs(p, fp);

  const chain = newResolvedChain({
    chain_id: args.chainId,
    root_bead_id: "", // filled after materialization
    fingerprint: {
      pi_package: { name: fp.pi_package.name, version: fp.pi_package.version },
      beads_version: fp.beads.version,
      experiment_source_dir: fp.experiment.source_dir,
      experiment_source_dirty: false,
      baseline_specialists: fp.baseline_specialists.map((b) => ({ path: b.path, sha256: b.sha256 })),
    },
  });

  const beadsMap = await materializeBeads({
    paths: p,
    chain,
    externalRootRef: args.rootBead,
    title: `[${chain.chain_id}] SRE vertical-slice — ${args.incidentBrief.slice(0, 60) || "ambient"}`,
  });
  const chainWithRoot = { ...chain, root_bead_id: beadsMap.root_bead_id };
  await saveResolvedChain(p, chainWithRoot);

  const run = initialRunState(chainWithRoot, chainRunId);
  await saveRunState(p, run);

  logger.human("");
  logger.human(`chain_run_id=${chainRunId}`);
  logger.human(`chain_id=${chainWithRoot.chain_id}`);
  logger.human(`root_bead_id=${beadsMap.root_bead_id}`);
  logger.human(`target_repo=${targetRepo}`);
  logger.human(`state_dir=${p.root}`);
  logger.human(`pi=${fp.pi_package.name}@${fp.pi_package.version}  beads=${fp.beads.version}`);
  logger.human(`baseline_specialists=${fp.baseline_specialists.length} sha256-fingerprinted`);
  logger.human("");
  logger.human("Topology (frozen):");
  for (const s of chainWithRoot.topology) {
    logger.human(`  ${s.step_id.padEnd(22)} role=${s.role.padEnd(22)} class=${s.class.padEnd(11)} needs=[${s.needs.join(",")}]`);
  }
  logger.human("");

  if (args.dryRun) {
    logger.human("--dry-run: plan materialized. Not dispatching. To run:");
    logger.human(`  bun run src/cli/main.ts --repo ${targetRepo} --state-dir ${stateDir} --resume ${chainRunId}`);
    return;
  }

  if (!args.reallyRunAgents) {
    logger.human("--no-agents: skipping dispatch (topology-only walk).");
    return;
  }

  await runToCompletion(
    {
      paths: p,
      chain: chainWithRoot,
      channelId: `chain:${chainWithRoot.chain_id}`,
      targetRepo,
      onFact,
    },
    args.incidentBrief,
  );

  logger.human("");
  logger.human("=== FINAL CHAIN STATE ===");
  logger.human(`See: ${p.projectionsDir}/chain-progress.json`);
  logger.human(`Evidence: ${p.evidenceIndex}`);
  logger.human(`Messages: ${p.messagesJsonl}`);
  logger.human(`Forensics: ${p.forensicsEvents}`);
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e?.stack ?? e}\n`);
  process.exit(1);
});
