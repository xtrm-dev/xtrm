import { execFileSync } from "node:child_process"
import { basename, dirname, isAbsolute, resolve } from "node:path"

/**
 * The repository an agent works in, for the sidebar's metadata line. Agents mostly run in git
 * worktrees, so the cwd basename names the worktree, not the repo. `git rev-parse --git-common-dir`
 * is the same `.git` directory for the main checkout and every worktree; its parent is the repo
 * (xtrm, core, specialists). A bare repository's common dir is the repo itself (`name.git` reads as `name`).
 * Outside a git repository the cwd basename is used. The result is cached per cwd: discovery runs on every poll.
 */
export type GitCommonDir = (cwd: string) => string | null

const gitCommonDir: GitCommonDir = (cwd) => {
  try {
    return execFileSync("git", ["-C", cwd, "rev-parse", "--git-common-dir"], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return null
  }
}

export function repoFromCommonDir(cwd: string, commonDir: string): string {
  const dir = isAbsolute(commonDir) ? commonDir : resolve(cwd, commonDir)
  const name = basename(dir)
  if (name === ".git") return basename(dirname(dir))
  return name.replace(/\.git$/, "") || basename(cwd)
}

const cache = new Map<string, string>()

export function repoNameOf(cwd: string, git: GitCommonDir = gitCommonDir): string {
  if (!cwd) return ""
  const hit = cache.get(cwd)
  if (hit !== undefined) return hit
  const common = git(cwd)
  const name = common ? repoFromCommonDir(cwd, common) : basename(cwd)
  cache.set(cwd, name)
  return name
}

export function clearRepoCache(): void {
  cache.clear()
}
