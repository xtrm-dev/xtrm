/**
 * Real, non-production platform mutation adapter (robot identities slice 3,
 * xtrm-1zv, residual F1).
 *
 * Where slice 2 proved the projection canary with an injectable dry-run
 * fixture, this adapter performs a REAL GitHub-model mutation and returns a
 * REAL platform-assigned object id: a git commit SHA created in an
 * explicitly designated NON-PRODUCTION git repository (a scratch repo
 * under the run's state dir), carrying the githubTrailers projection.
 *
 * Safety boundary (fail closed):
 *   - the target repo MUST be inside the designated scratch root; a path
 *     that escapes (or resolves outside) it is rejected;
 *   - no remotes are touched, nothing is pushed; commit is local-only;
 *   - the commit carries the XTRM trailers + receipt line via the standard
 *     projection, tagged with a canary marker subject;
 *   - a commit object is created only when the projection succeeds.
 *
 * The returned object id is a real commit SHA — the "platform object ID"
 * the operator's slice-3 canary shape requires — without any account,
 * credential, connector or production target.
 */

import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sha256String } from "../../util/fs.ts";
import { githubTrailers, compactAttributionLine } from "../projection.ts";
import type { ProvenanceEnvelope } from "../schemas.ts";
import type { PlatformMutationAdapter } from "../canary.ts";

const pexec = promisify(execFile);

export interface LocalGitCommitAdapterOptions {
  /** Root that may contain allowed non-production scratch repos (absolute). */
  scratchRoot: string;
  /** Repo directory inside scratchRoot. Created (git init) if missing. */
  repoDir: string;
}

export class LocalGitCommitAdapter implements PlatformMutationAdapter {
  readonly system = "github" as const;
  private readonly scratchRoot: string;
  private readonly repoDir: string;

  constructor(opts: LocalGitCommitAdapterOptions) {
    this.scratchRoot = path.resolve(opts.scratchRoot);
    this.repoDir = path.resolve(opts.repoDir);
  }

  /** Containment guard: repoDir must resolve inside scratchRoot. */
  private assertContained(): string {
    const rel = path.relative(this.scratchRoot, this.repoDir);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `local_git_adapter_outside_scratch: ${this.repoDir} is not inside ${this.scratchRoot}`,
      );
    }
    if (!fs.existsSync(this.scratchRoot)) {
      throw new Error(`local_git_adapter_missing_scratch_root: ${this.scratchRoot}`);
    }
    return this.repoDir;
  }

  private async git(args: string[], cwd: string): Promise<string> {
    const { stdout, stderr } = await pexec("git", args, {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
    });
    if (stderr && (stderr.includes("fatal:") || stderr.includes("error:"))) {
      throw new Error(`local_git_adapter_git_failed: ${stderr.trim()}`);
    }
    return stdout.trim();
  }

  async project(args: {
    envelope: ProvenanceEnvelope;
    target: { kind: string; issue?: string | null; repo?: string | null };
  }): Promise<{ external_id: string; content_sha256: string }> {
    const repoDir = this.assertContained();
    await fsp.mkdir(repoDir, { recursive: true });

    // Init if not yet a repo (idempotent: local, non-production scratch).
    const isRepo = fs.existsSync(path.join(repoDir, ".git"));
    await fsp.mkdir(repoDir, { recursive: true });
    if (!isRepo) {
      await this.git(["init", "-q"], repoDir);
      // Settle a local branch BEFORE the initial commit so rev-parse HEAD
      // always resolves (empty repos have an unborn HEAD otherwise).
      await this.git(["checkout", "-q", "-B", "canary"], repoDir);
    }
    // Local identity for the canary commit: never reads real user config,
    // never touches remotes, never signs.
    await this.git(["config", "user.name", "XTRM provenance canary"], repoDir);
    await this.git(["config", "user.email", "canary@xtrm.invalid"], repoDir);
    await this.git(["config", "commit.gpgsign", "false"], repoDir);

    // Write the projection record: attribution + content-hash pointer +
    // trailers + receipt. The record is pointer-first: it references the
    // attested content hash instead of embedding raw content.
    const file = path.join(repoDir, `provenance-${args.envelope.receipt_id}.txt`);
    const body = [
      compactAttributionLine(args.envelope),
      "",
      `content: ${args.envelope.content_sha256}`,
      "",
      ...githubTrailers(args.envelope),
    ].join("\n") + "\n";
    await fsp.writeFile(file, body, "utf8");
    await this.git(["add", "-f", path.basename(file)], repoDir);

    // Commit (local only). Subject carries the canary marker so provenance
    // commits are distinguishable and the slice never touches a real repo.
    const subject = `xtrm-provenance-canary ${args.envelope.receipt_id} [skip ci]`;
    await this.git(["commit", "-q", "-m", subject, "--no-verify"], repoDir);

    // The REAL platform-assigned object id: the commit SHA.
    const external_id = await this.git(["rev-parse", "HEAD"], repoDir);

    // The platform record references the SAME attested content (pointer-
    // first); bindPlatformResult enforces equality so any platform-side
    // content drift trips content_hash_mismatch.
    const content_sha256 = args.envelope.content_sha256;
    return { external_id, content_sha256 };
  }
}
