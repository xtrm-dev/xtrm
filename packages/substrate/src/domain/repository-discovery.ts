// Repository discovery (moved verbatim from cli/sb.ts, XTRM-337).
//
// Shared non-presentation module: both cli/sb.ts and
// integrations/claude-code/mcp-server.ts import discoverGitRoot and
// discoverRepository from here, so the MCP server process no longer loads
// the CLI module graph. No logic edits: git-common-dir root resolution,
// the --show-toplevel fallback for git older than 2.31, the null result
// outside a Git checkout, and the derived repositoryKey are byte-for-byte
// identical to the CLI originals.

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { deriveBaseBranch, deriveRepositoryIdentity, type RepositoryIdentity } from "./repository.ts";

// cwd-aware resolution (bead xtrm-7wc.5.6): the CLI discovers the git root
// (presentation edge); the git-root->project mapping read stays in the
// service so resolution is live every invocation. Non-git cwd yields null
// and the service falls through to the repository binding, then the checkout
// link, then fail closed with the 'sb init' guidance (ADR sbcloseout4 §§4-5).
//
// Repository, not worktree (ADR sbcloseout4 §7): a git worktree has its own
// toplevel but shares the repository's git directory, so keying on
// --show-toplevel gives every worktree a different identity and misses the
// repository's link row. --git-common-dir is shared by all worktrees of a
// repository; its parent is the primary checkout root, so worktrees resolve
// to the same project as their repository. Falls back to --show-toplevel on
// git < 2.31 (no --path-format), which degrades to the previous behaviour.
function gitOut(args: string[]): string | null {
  try {
    const out = execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const trimmed = out.trim();
    return trimmed === "" ? null : trimmed;
  } catch {
    return null;
  }
}

export function discoverGitRoot(): string | null {
  const commonDir = gitOut(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (commonDir !== null) return dirname(commonDir);
  return gitOut(["rev-parse", "--show-toplevel"]);
}

export interface RepositoryDiscovery {
  gitRoot: string | null;
  identity: RepositoryIdentity | null;
  identityError: string | null;
  baseBranch: string | null;
}

// `git remote -v` rows: "origin\t<url> (fetch)". Same name+url seen as both
// fetch and push is one remote.
function parseRemotes(text: string | null): Array<{ name: string; url: string }> {
  if (text === null) return [];
  const remotes: Array<{ name: string; url: string }> = [];
  for (const line of text.split("\n")) {
    const m = /^(\S+)\t(\S+)\s+\((?:fetch|push)\)$/.exec(line.trim());
    if (!m) continue;
    const remote = { name: m[1]!, url: m[2]! };
    if (!remotes.some((r) => r.name === remote.name && r.url === remote.url)) remotes.push(remote);
  }
  return remotes;
}

// Repository discovery (ADR §§6-10). discoverGitRoot stays the worktree-aware
// common-root read; this sibling adds the identity evidence (remotes ->
// deriveRepositoryIdentity) and the base-branch evidence. Every Git read fails
// soft: a non-repository cwd, absent remote HEAD or ambiguous remotes yield
// nulls and the caller fails closed rather than inventing identity (ADR §98).
// `git rev-parse --abbrev-ref HEAD` is read because ADR §10 names the current
// branch as evidence the operator can see; deriveBaseBranch deliberately never
// uses it as a base, so a feature branch / detached HEAD cannot become one.
export function discoverRepository(): RepositoryDiscovery {
  const gitRoot = discoverGitRoot();
  const remotes = parseRemotes(gitOut(["remote", "-v"]));
  let identity: RepositoryIdentity | null = null;
  let identityError: string | null = null;
  try {
    identity = deriveRepositoryIdentity({ commonRoot: gitRoot, remotes });
  } catch (err) {
    identityError = err instanceof Error ? err.message : String(err);
  }
  const branches = gitOut(["branch", "--format=%(refname:short)"]);
  return {
    gitRoot,
    identity,
    identityError,
    baseBranch: deriveBaseBranch({
      remoteHead: gitOut(["symbolic-ref", "refs/remotes/origin/HEAD"]),
      configuredDefault: gitOut(["config", "init.defaultBranch"]),
      currentBranch: gitOut(["rev-parse", "--abbrev-ref", "HEAD"]),
      localBranches: branches === null ? [] : branches.split("\n"),
    }),
  };
}
