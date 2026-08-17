/**
 * sre_exec capability-boundary characterization (Requirement 5).
 *
 * These tests characterize what the *current experiment* sre_exec allow/deny
 * regexes actually permit and reject. They exist so the experiment's report
 * can honestly distinguish an experimental read-only policy from a
 * production capability sandbox.
 *
 * NOTE: these tests exercise the regex validator ONLY (the same logic
 * `sreExec.execute` runs before shelling out). Real execution behavior is
 * covered by the smoke script; this file is deliberately hermetic.
 */

import { describe, test, expect } from "bun:test";
import { DEFAULT_SRE_ALLOWLIST, DEFAULT_SRE_DENYLIST } from "../src/tools/policy.ts";

function evalCmd(cmd: string): "allow" | "deny" | "not-in-allowlist" {
  const trimmed = cmd.trim();
  if (!trimmed) return "deny";
  for (const rx of DEFAULT_SRE_DENYLIST) if (rx.test(trimmed)) return "deny";
  const allowed = DEFAULT_SRE_ALLOWLIST.some((rx) => rx.test(trimmed));
  return allowed ? "allow" : "not-in-allowlist";
}

describe("sre_exec — chaining/mutation negative surface", () => {
  test("plain read-only commands are allowed", () => {
    expect(evalCmd("git log --oneline -5")).toBe("allow");
    expect(evalCmd("cat svc-b/config.yml")).toBe("allow");
    expect(evalCmd("grep -n memory_limit svc-b/config.yml")).toBe("allow");
    expect(evalCmd("ls -la")).toBe("allow");
  });

  test("shell chaining with ; is rejected on the mutating side", () => {
    expect(evalCmd("ls ; rm -rf /")).toBe("deny");
    expect(evalCmd("git log ; git push origin main")).toBe("deny");
    expect(evalCmd("cat file ; sudo whoami")).toBe("deny");
  });

  test("&& / || chaining to a mutating command is rejected", () => {
    expect(evalCmd("git log && git reset --hard HEAD~1")).toBe("deny");
    expect(evalCmd("ls || rm -rf /tmp/x")).toBe("deny");
  });

  test("piping into mutating commands is rejected", () => {
    expect(evalCmd("cat file | sudo tee /etc/hosts")).toBe("deny");
    expect(evalCmd("git log | git rebase -i HEAD~3")).toBe("deny");
  });

  test("backtick command substitution to mutating command is rejected", () => {
    expect(evalCmd("echo `rm -rf /tmp/x`")).toBe("deny");
    expect(evalCmd("echo `sudo id`")).toBe("deny");
  });

  test("subshell mutating command is rejected", () => {
    expect(evalCmd("(sudo id)")).toBe("deny");
    expect(evalCmd("(rm -f a.txt)")).toBe("deny");
  });

  test("stdout redirection to file is rejected", () => {
    expect(evalCmd("ls > /tmp/x")).toBe("deny");
    expect(evalCmd("cat file >> /tmp/log")).toBe("deny");
  });

  test("sudo / su / mount rejected outright", () => {
    expect(evalCmd("sudo whoami")).toBe("deny");
    expect(evalCmd("su root")).toBe("deny");
    expect(evalCmd("mount -o remount,rw /")).toBe("deny");
  });

  test("mutating git commands rejected", () => {
    expect(evalCmd("git push origin main")).toBe("deny");
    expect(evalCmd("git reset --hard HEAD~2")).toBe("deny");
    expect(evalCmd("git commit -am 'x'")).toBe("deny");
    expect(evalCmd("git checkout -b feature")).toBe("deny");
  });

  test("mutating docker commands rejected", () => {
    expect(evalCmd("docker rm -f svc-b")).toBe("deny");
    expect(evalCmd("docker restart svc-a")).toBe("deny");
    expect(evalCmd("docker system prune -f")).toBe("deny");
  });

  test("mutating bd commands rejected (protects sandboxed beads DB)", () => {
    expect(evalCmd("bd close svs-1")).toBe("deny");
    expect(evalCmd("bd update svs-1 -d hijack")).toBe("deny");
    expect(evalCmd("bd note svs-1 hijack")).toBe("deny");
  });

  test("filesystem mutation basics rejected", () => {
    expect(evalCmd("rm file")).toBe("deny");
    expect(evalCmd("mv a b")).toBe("deny");
    expect(evalCmd("chmod +x file")).toBe("deny");
    expect(evalCmd("chown root file")).toBe("deny");
  });

  // ------------------------------------------------------------------
  // Characterized limitations of the experiment-level regex policy.
  // These test cases DOCUMENT current behavior. They are NOT
  // production-grade guarantees. The production capability sandbox is
  // out of scope for this experiment (spec §12; report §5.6).
  // ------------------------------------------------------------------

  test("LIMITATION: $() command substitution can smuggle a non-listed reader through an allowlisted wrapper", () => {
    // The denylist prefixes are `(^|[;&|`(])\s*<mutator>` — the opening `(`
    // of $(...) matches, so a mutating command inside $() is still caught
    // (e.g. `echo $(sudo id)` is denied via the `sudo` rule).
    //
    // The remaining gap: a READ command that is not in the denylist can be
    // hidden inside $() behind an allowlisted wrapper. Nothing on the
    // denylist blocks `cat`, so the following slips through both checks
    // and lets bash substitute the target file's contents as an env-var
    // name inside an allowlisted `printenv` call — effectively a read
    // that bypasses cwd containment.
    expect(evalCmd("printenv $(cat /etc/hostname)")).toBe("allow");
    // Documented in experiment-report.md §5 as an experiment-level
    // limitation, NOT a production capability guarantee.
  });

  test("LIMITATION: path traversal is not restricted by the regex allowlist", () => {
    // cat is allowlisted with `^cat\s+`, so any path (including /etc/passwd
    // or ../../../secret) is permitted. Real cwd sandboxing is delegated
    // to child_process cwd; but a symlink escape or ../ read is not
    // blocked by regex. This is an experiment limitation.
    expect(evalCmd("cat /etc/passwd")).toBe("allow");
    expect(evalCmd("cat ../../../etc/shadow")).toBe("allow");
  });

  test("LIMITATION: environment/secret extraction via allowlisted printenv is possible", () => {
    // printenv is on the allowlist; a hostile agent can read secrets that
    // happen to be in the process env. Experiment relies on the runner
    // scrubbing env before dispatch — not a regex-level guarantee.
    expect(evalCmd("printenv PATH")).toBe("allow");
    expect(evalCmd("env")).toBe("allow");
  });
});
