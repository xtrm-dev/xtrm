// CORE-2801: claim, release and close keep the owning pane's @agent_issue in step.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePaneSyncRequest, syncPaneIssue, type TmuxRunner } from "../src/domain/pane-issue-sync.ts";

describe("parsePaneSyncRequest", () => {
  it("reads verb, ref and holder", () => {
    assert.deepEqual(parsePaneSyncRequest(["issue", "claim", "CORE-1", "--holder", "w1"]), { effect: "claim", ref: "CORE-1", holder: "w1" });
    assert.deepEqual(parsePaneSyncRequest(["--json", "issue", "release", "CORE-2", "--holder", "w2"]), { effect: "end", ref: "CORE-2", holder: "w2" });
    assert.deepEqual(parsePaneSyncRequest(["issue", "close", "--json", "CORE-3", "--outcome", "completed", "--reason", "done"]), { effect: "end", ref: "CORE-3", holder: null });
    assert.deepEqual(parsePaneSyncRequest(["issue", "state", "CORE-5", "done"]), { effect: "end", ref: "CORE-5", holder: null });
    assert.deepEqual(parsePaneSyncRequest(["issue", "state", "CORE-5", "cancelled"])?.effect, "end");
    assert.equal(parsePaneSyncRequest(["issue", "state", "CORE-5", "archived"])?.effect, "end");
    assert.equal(parsePaneSyncRequest(["issue", "state", "CORE-5", "open"]), null);
    assert.equal(parsePaneSyncRequest(["issue", "close", "--outcome", "completed", "--reason", "r", "CORE-4"])?.ref, "CORE-4");
  });
  it("reads --holder=<who> only as the flag form sb itself parses", () => {
    assert.equal(parsePaneSyncRequest(["issue", "claim", "CORE-6", "--holder", "w3"])?.holder, "w3");
    assert.equal(parsePaneSyncRequest(["issue", "claim", "CORE-6", "--holder=w3"])?.holder ?? null, null);
  });
  it("ignores every other command", () => {
    assert.equal(parsePaneSyncRequest(["issue", "show", "CORE-1"]), null);
    assert.equal(parsePaneSyncRequest(["journal", "append", "CORE-1"]), null);
    assert.equal(parsePaneSyncRequest(["issue", "claim"]), null);
    assert.equal(parsePaneSyncRequest(["issue", "claim", "bad ref;rm"]), null);
  });
});

function fakeTmux(panes: Record<string, Record<string, string>>): { run: TmuxRunner; ops: string[] } {
  const ops: string[] = [];
  const run: TmuxRunner = (args) => {
    if (args[0] === "list-panes") return { status: 0, stdout: Object.entries(panes).map(([id, o]) => `${id}\t${o["@agent_issue"] ?? ""}`).join("\n") + "\n" };
    const pane = args[args.indexOf("-t") + 1] as string;
    if (args[0] === "show-options") return { status: 0, stdout: `${panes[pane]?.[args[args.length - 1] as string] ?? ""}\n` };
    if (args[0] === "set-option") {
      if (args.includes("-u")) { delete panes[pane]?.[args[args.length - 1] as string]; ops.push(`unset ${pane}`); }
      else { (panes[pane] ??= {})[args[args.length - 2] as string] = args[args.length - 1] as string; ops.push(`set ${pane} ${args[args.length - 1]}`); }
      return { status: 0, stdout: "" };
    }
    return { status: 1, stdout: "" };
  };
  return { run, ops };
}
const ENV = { TMUX: "/tmp/x,1,0", TMUX_PANE: "%3", SUBSTRATE_HOLDER: "w1" };

describe("syncPaneIssue", () => {
  it("claim sets the owning pane's issue", () => {
    const t = fakeTmux({ "%3": { "@agent_holder": "w1" } });
    assert.equal(syncPaneIssue(["issue", "claim", "CORE-1"], { env: ENV, tmux: t.run }), "updated");
    assert.deepEqual(t.ops, ["set %3 CORE-1"]);
  });
  it("never claims into a pane owned by another holder (in-process specialist)", () => {
    const t = fakeTmux({ "%3": { "@agent_holder": "w1" } });
    assert.equal(syncPaneIssue(["issue", "claim", "CORE-1"], { env: { ...ENV, SUBSTRATE_HOLDER: "sp-executor-abc12345" }, tmux: t.run }), "skipped");
    assert.equal(syncPaneIssue(["issue", "claim", "CORE-1", "--holder", "someone-else"], { env: ENV, tmux: t.run }), "skipped");
    assert.deepEqual(t.ops, []);
  });
  it("skips a claim in a pane with no owner and outside tmux", () => {
    const t = fakeTmux({ "%3": {} });
    assert.equal(syncPaneIssue(["issue", "claim", "CORE-1"], { env: ENV, tmux: t.run }), "skipped");
    const lines: string[] = [];
    assert.equal(syncPaneIssue(["issue", "claim", "CORE-1"], { env: { SUBSTRATE_HOLDER: "w1" }, tmux: t.run, log: (l) => lines.push(l) }), "skipped");
    assert.ok(lines.join("\n").includes("TMUX unset"), "an out-of-scope skip is logged");
    assert.deepEqual(t.ops, []);
  });
  it("close, release and a terminal state unset every pane that holds the ref, whoever ran them", () => {
    const panes = { "%3": { "@agent_holder": "lead" }, "%4": { "@agent_holder": "w9", "@agent_issue": "CORE-1" }, "%5": { "@agent_holder": "w8", "@agent_issue": "CORE-2" }, "%6": { "@agent_issue": "core-1" } };
    const t = fakeTmux(panes);
    assert.equal(syncPaneIssue(["issue", "close", "CORE-1", "--outcome", "completed", "--reason", "r"], { env: ENV, tmux: t.run }), "updated");
    assert.deepEqual(t.ops, ["unset %4", "unset %6"]);
    assert.equal(syncPaneIssue(["issue", "state", "CORE-2", "done"], { env: ENV, tmux: t.run }), "updated");
    assert.equal(panes["%5"]["@agent_issue"], undefined);
    assert.equal(syncPaneIssue(["issue", "release", "CORE-7"], { env: ENV, tmux: t.run }), "skipped");
  });
  it("logs and never throws when tmux fails", () => {
    const lines: string[] = [];
    const broken: TmuxRunner = () => { throw new Error("tmux exploded"); };
    assert.equal(syncPaneIssue(["issue", "claim", "CORE-1"], { env: ENV, tmux: broken, log: (l) => lines.push(l) }), "failed");
    assert.ok(lines.join("\n").includes("tmux exploded"));
    const unreadable: TmuxRunner = () => ({ status: 1, stdout: "" });
    assert.equal(syncPaneIssue(["issue", "claim", "CORE-1"], { env: ENV, tmux: unreadable, log: (l) => lines.push(l) }), "failed");
    assert.equal(syncPaneIssue(["issue", "close", "CORE-1"], { env: ENV, tmux: unreadable, log: (l) => lines.push(l) }), "failed");
  });
});

describe("pane sync end to end on a private tmux socket", () => {
  it("claim A, release, claim B, close B", () => {
    const dir = mkdtempSync(join(tmpdir(), "pane-sync-"));
    const socket = join(dir, "tmux.sock");
    const tmux = (...args: string[]) => spawnSync("tmux", ["-S", socket, "-f", "/dev/null", ...args], { encoding: "utf8" });
    try {
      assert.equal(tmux("new-session", "-d", "-s", "e2e", "sleep 120").status, 0);
      const pane = tmux("list-panes", "-a", "-F", "#{pane_id}").stdout.trim().split("\n")[0] as string;
      tmux("set-option", "-p", "-t", pane, "@agent_holder", "w1");
      // A second pane with another owner must never change.
      tmux("split-window", "-d", "-t", pane, "sleep 120");
      const other = tmux("list-panes", "-a", "-F", "#{pane_id}").stdout.trim().split("\n").find((p) => p !== pane) as string;
      tmux("set-option", "-p", "-t", other, "@agent_holder", "w2");
      tmux("set-option", "-p", "-t", other, "@agent_issue", "KEEP-1");
      // The sync reaches tmux through $TMUX, as it does inside a real pane.
      const env = { TMUX: `${socket},0,0`, TMUX_PANE: pane, SUBSTRATE_HOLDER: "w1" };
      const prior = { ...process.env };
      Object.assign(process.env, env);
      const issue = () => tmux("show-options", "-p", "-t", pane, "-qv", "@agent_issue").stdout.trim();
      try {
        assert.equal(syncPaneIssue(["issue", "claim", "CORE-A"]), "updated");
        assert.equal(issue(), "CORE-A");
        assert.equal(syncPaneIssue(["issue", "release", "CORE-A"]), "updated");
        assert.equal(issue(), "");
        assert.equal(syncPaneIssue(["issue", "claim", "CORE-B"]), "updated");
        assert.equal(issue(), "CORE-B");
        assert.equal(syncPaneIssue(["issue", "close", "CORE-B", "--outcome", "completed", "--reason", "r"]), "updated");
        assert.equal(issue(), "");
        assert.equal(tmux("show-options", "-p", "-t", other, "-qv", "@agent_issue").stdout.trim(), "KEEP-1");
      } finally {
        for (const key of Object.keys(env)) if (key in prior) process.env[key] = prior[key]; else delete process.env[key];
      }
    } finally {
      tmux("kill-server");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
