import { strict as assert } from "node:assert"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { clearRepoCache, repoFromCommonDir, repoNameOf } from "../server/repo.ts"

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "ignore" })

test("repoFromCommonDir: parent of .git, bare name without .git, relative resolved against cwd", () => {
  assert.equal(repoFromCommonDir("/w/xtrm", "/w/xtrm/.git"), "xtrm")
  assert.equal(repoFromCommonDir("/w/xtrm", ".git"), "xtrm")
  assert.equal(repoFromCommonDir("/srv/core.git", "."), "core")
  assert.equal(repoFromCommonDir("/w/x/sub", "../.git"), "x")
})

test("repoNameOf: caches per cwd and falls back to the cwd basename outside git", () => {
  clearRepoCache()
  let calls = 0
  const fake = () => { calls += 1; return null }
  assert.equal(repoNameOf("/tmp/not-a-repo", fake), "not-a-repo")
  assert.equal(repoNameOf("/tmp/not-a-repo", fake), "not-a-repo")
  assert.equal(calls, 1)
  assert.equal(repoNameOf("", fake), "")
})

test("repoNameOf: a worktree reports the main checkout's repo, not the worktree directory", () => {
  clearRepoCache()
  const root = realpathSync(mkdtempSync(join(tmpdir(), "repo-name-")))
  try {
    const main = join(root, "specialists")
    mkdirSync(main)
    git(main, "init", "-q")
    writeFileSync(join(main, "a.txt"), "a")
    git(main, "add", ".")
    git(main, "commit", "-q", "-m", "init")
    const worktree = join(root, "wt-xt-claude-feature")
    git(main, "worktree", "add", "-q", worktree, "-b", "feature")
    const nested = join(worktree, "sub")
    mkdirSync(nested)
    assert.equal(repoNameOf(main), "specialists")
    assert.equal(repoNameOf(worktree), "specialists")
    assert.equal(repoNameOf(nested), "specialists")
    const plain = join(root, "plain-dir")
    mkdirSync(plain)
    assert.equal(repoNameOf(plain), "plain-dir")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
