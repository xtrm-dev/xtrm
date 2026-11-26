// CORE-2801: the SHIPPED entry (cli/sb-ux.ts runUxCli, the declared bin) keeps the owning
// pane's @agent_issue in step. A domain-level test cannot catch a hook on the wrong entry.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { runUxCli } from "../cli/sb-ux.ts";
import { contract, tempDir } from "./helpers.ts";

describe("runUxCli drives the pane sync", () => {
  it("claim, release, claim, state done; and a close by another holder", async () => {
    const dir = tempDir("sb-pane-");
    const dbPath = join(dir, "state.db");
    const db = openSubstrate(dbPath);
    new IssueService(db).createProject({ id: "prj_demo", prefix: "DEMO", name: "pane" });
    db.close();
    const socket = join(dir, "tmux.sock");
    const tmux = (...a: string[]) => spawnSync("tmux", ["-S", socket, "-f", "/dev/null", ...a], { encoding: "utf8" });
    const sb = async (...a: string[]) => {
      const res = await runUxCli(["--db", dbPath, "--json", "--project", "prj_demo", ...a]);
      assert.equal(res.code, 0, `sb ${a.join(" ")}: ${res.stderr || res.stdout}`);
      return JSON.parse(res.stdout) as { data: { humanRef?: string } };
    };
    const cpath = join(dir, "c.json");
    writeFileSync(cpath, JSON.stringify(contract()));
    const saved = { ...process.env };
    try {
      assert.equal(tmux("new-session", "-d", "-s", "p", "sleep 120").status, 0);
      const pane = tmux("list-panes", "-a", "-F", "#{pane_id}").stdout.trim().split("\n")[0] as string;
      tmux("set-option", "-p", "-t", pane, "@agent_holder", "w1");
      const a = (await sb("issue", "create", "--title", "A", "--kind", "task", "--contract", cpath, "--scrutiny", "LOW")).data.humanRef as string;
      const b = (await sb("issue", "create", "--title", "B", "--kind", "task", "--contract", cpath, "--scrutiny", "LOW")).data.humanRef as string;
      const c = (await sb("issue", "create", "--title", "C", "--kind", "task", "--contract", cpath, "--scrutiny", "LOW")).data.humanRef as string;
      const d = (await sb("issue", "create", "--title", "D", "--kind", "task", "--contract", cpath, "--scrutiny", "LOW")).data.humanRef as string;
      for (const r of [a, b, c, d]) await sb("issue", "attest", r, "--outcome", "ready", "--policy", "default", "--attested-by", "t");
      Object.assign(process.env, { TMUX: `${socket},0,0`, TMUX_PANE: pane, SUBSTRATE_HOLDER: "w1", XDG_STATE_HOME: join(dir, "state") });
      const held = () => tmux("show-options", "-p", "-t", pane, "-qv", "@agent_issue").stdout.trim();
      await sb("issue", "claim", a);
      assert.equal(held(), a);
      await sb("issue", "release", a);
      assert.equal(held(), "");
      await sb("issue", "claim", b);
      assert.equal(held(), b);
      // The lead (another holder, another pane) closes the worker's Issue.
      Object.assign(process.env, { SUBSTRATE_HOLDER: "lead", TMUX_PANE: "%99" });
      await sb("issue", "state", b, "done");
      assert.equal(held(), "", "a terminal state by another holder unsets the worker pane");
      // `archive` and an upper-case state target end the hold too.
      Object.assign(process.env, { SUBSTRATE_HOLDER: "w1", TMUX_PANE: pane });
      await sb("issue", "claim", c);
      assert.equal(held(), c);
      await sb("issue", "archive", c);
      assert.equal(held(), "", "archive unsets the pane");
      await sb("issue", "claim", d);
      assert.equal(held(), d);
      await sb("issue", "state", d, "DONE");
      assert.equal(held(), "", "an upper-case terminal state unsets the pane");
    } finally {
      for (const k of ["TMUX", "TMUX_PANE", "SUBSTRATE_HOLDER", "XDG_STATE_HOME"]) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
      tmux("kill-server");
    }
  });
});
