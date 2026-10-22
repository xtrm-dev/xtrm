// Acceptance D27-D28 (PRD §49D, Phase 7 bead xtrm-7wc.8) + compact
// round-trip lifecycle evidence in a scratch project.
// Verified Claude properties (PRD §54, https://code.claude.com/docs/en/hooks):
// PreCompact supports command/HTTP/MCP-tool hooks, not prompt/agent hooks;
// PostCompact exposes the compact summary; SessionStart source=compact can
// inject additionalContext. hooks.json must reflect exactly that.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ResumeService } from "../src/service/resume-service.ts";
import { contract } from "./helpers.ts";
import { handlePreCompact } from "../integrations/claude-code/precompact.ts";
import { handlePostCompact } from "../integrations/claude-code/postcompact.ts";
import { handleSessionStart } from "../integrations/claude-code/session-start.ts";
import { collectGitContext } from "../integrations/claude-code/git-provenance.ts";
import { summarizeMechanical } from "../integrations/claude-code/semantic-service.ts";

function scratch(): { dir: string; dbPath: string; issueId: string; humanRef: string } {
  const dir = mkdtempSync(join(tmpdir(), "substrate-claude-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  const issue = svc.createIssue({
    projectId: "prj_xtrm",
    title: "claude work",
    kind: "task",
    contract: contract({ problem: "Claude problem", success: "Claude success" }),
    scrutiny: "LOW",
    authoredBy: "tester",
  });
  const humanRef = issue.humanRef;
  const issueId = issue.id;
  db.close();
  return { dir, dbPath, issueId, humanRef };
}

describe("D27: PreCompact writes checkpoint without unsupported agent-hook semantics", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => {
    rmSync(s.dir, { recursive: true, force: true });
  });

  it("writes a mechanical-first compaction checkpoint with semantic enrichment", async () => {
    const transcript = join(s.dir, "transcript.txt");
    writeFileSync(transcript, "did scaffold\nwiring resumability now\n");
    const res = await handlePreCompact({ session_id: "sess-1", transcript_path: transcript, cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
    assert.equal(res.continue, true);
    assert.equal(res.degraded, false);
    assert.ok(res.entryId, "checkpoint entry recorded");
    const db = openSubstrate(s.dbPath);
    try {
      const journal = new JournalService(db, new IssueService(db));
      const latest = journal.latestCheckpoint(s.issueId);
      assert.equal(latest?.id, res.entryId);
      assert.equal(latest?.kind, "compaction");
      assert.ok(latest?.mechanical, "mechanical state durable");
      assert.ok(latest?.semantic, "bounded semantic summary attached");
    } finally {
      db.close();
    }
  });

  it("never blocks compaction: unknown issue and missing ref still continue", async () => {
    const missing = await handlePreCompact({ cwd: s.dir, issueRef: "XTRM-999", dbPath: s.dbPath });
    assert.equal(missing.continue, true);
    assert.equal(missing.entryId, null);
    const noRef = await handlePreCompact({ cwd: s.dir, dbPath: s.dbPath });
    assert.equal(noRef.continue, true);
    assert.equal(noRef.entryId, null);
  });

  it("hook config uses command hooks only (no agent/prompt semantics on PreCompact)", () => {
    const raw = readFileSync(join(import.meta.dirname, "..", "integrations", "claude-code", "hooks.json"), "utf8");
    const cfg = JSON.parse(raw) as { hooks: Record<string, Array<{ hooks?: Array<{ type?: string; command?: string }> }>> };
    const commands: string[] = [];
    for (const group of Object.values(cfg.hooks)) {
      for (const entry of group) {
        for (const h of entry.hooks ?? []) {
          assert.equal(h.type, "command", "every hook entry is a command adapter (agent/prompt unsupported on PreCompact)");
          if (h.command) commands.push(h.command);
        }
      }
    }
    assert.ok(cfg.hooks["PreCompact"] && cfg.hooks["PostCompact"] && cfg.hooks["SessionStart"], "all three lifecycle events wired");
    assert.ok(commands.length >= 3, "each lifecycle event has a command adapter");
    assert.ok(commands.every((c) => !c.includes(".xtrm/hooks")), "must not reference absent .xtrm/hooks scripts (P0 census)");
  });
});

describe("D28: SessionStart(source=compact) receives the current Resume Capsule", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => {
    rmSync(s.dir, { recursive: true, force: true });
  });

  it("injects the capsule naming the current contract + checkpoint; other sources stay silent", async () => {
    const pre = await handlePreCompact({ session_id: "sess-7", cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
    assert.ok(pre.entryId);
    const injected = handleSessionStart({ source: "compact", cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
    assert.ok(injected.additionalContext, "compact source injects context");
    assert.match(injected.additionalContext as string, /XTRM-1/);
    assert.match(injected.additionalContext as string, /LATEST CHECKPOINT/);
    assert.match(injected.additionalContext as string, /Claude success/);
    const quiet = handleSessionStart({ source: "startup", cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
    assert.equal(quiet.additionalContext, null);
  });
});

describe("compact round-trip lifecycle evidence (scratch project)", () => {
  it("precompact → postcompact audit → session-start resume restores contract + checkpoint", async () => {
    const s = scratch();
    try {
      const pre = await handlePreCompact({ session_id: "round-1", cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
      assert.ok(pre.entryId);
      const post = handlePostCompact({ session_id: "round-1", summary: "Claude compact summary: scaffold done, wiring next", cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
      assert.equal(post.ok, true);
      assert.ok(post.entryId, "PostCompact audit reference recorded");
      const injected = handleSessionStart({ source: "compact", cwd: s.dir, issueRef: s.humanRef, dbPath: s.dbPath });
      const text = injected.additionalContext as string;
      assert.ok(text);
      assert.match(text, /CHANGES SINCE CHECKPOINT/);
      assert.match(text, /1 journal entries/, "post-compact finding visible as delta since the checkpoint");
      const db = openSubstrate(s.dbPath);
      try {
        const svc = new IssueService(db);
        const journal = new JournalService(db, svc);
        const resume = new ResumeService(db, svc, journal);
        const capsule = resume.buildCapsule(s.issueId);
        assert.equal(capsule.revision, 1);
        assert.equal(capsule.latestCheckpoint?.kind, "compaction");
        assert.equal(capsule.delta.entries.length, 1);
        assert.equal(capsule.delta.entries[0]?.kind, "finding");
      } finally {
        db.close();
      }
    } finally {
      rmSync(s.dir, { recursive: true, force: true });
    }
  });
});

describe("MCP server calls the library directly (exec sb forbidden)", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => {
    rmSync(s.dir, { recursive: true, force: true });
  });

  it("no adapter shells out to sb", () => {
    const dir = join(import.meta.dirname, "..", "integrations", "claude-code");
    const stripComments = (src: string): string =>
      src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const f of ["mcp-server.ts", "precompact.ts", "postcompact.ts", "session-start.ts", "semantic-service.ts", "runtime.ts"]) {
      const src = stripComments(readFileSync(join(dir, f), "utf8"));
      assert.ok(!/child_process/.test(src), `${f} must not spawn processes`);
      assert.ok(!/\b(execFileSync|execSync|spawnSync|spawn|exec)\s*\(/.test(src), `${f} must not exec subprocesses`);
      assert.ok(!/["']sb[\s"']/.test(src), `${f} must not reference the sb CLI`);
    }
    // XTRM-674: tool behaviour lives in the shared core, called by both adapters.
    const core = stripComments(readFileSync(join(dir, "..", "tool-core.ts"), "utf8"));
    assert.ok(!/child_process/.test(core) && !/["']sb[\s"']/.test(core), "tool-core.ts must not spawn or reference the sb CLI");
    const mcp = stripComments(readFileSync(join(dir, "mcp-server.ts"), "utf8"));
    assert.ok(/openHandles/.test(mcp), "MCP server opens the typed service (library-direct)");
    assert.ok(/runTool\(/.test(mcp) && /h\.(svc|journal|resume)/.test(core), "MCP tools call the service handles through the shared core, never a subprocess");
  });
});

describe("git provenance + semantic bounds", () => {
  it("collectGitContext is total on non-repos; semantic output is bounded", () => {
    const dir = mkdtempSync(join(tmpdir(), "substrate-git-"));
    try {
      const ctx = collectGitContext(dir);
      assert.equal(ctx.workspace, dir);
      assert.deepEqual(ctx.changedFiles, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const big = "x".repeat(20000);
    const sem = summarizeMechanical(
      { issueId: "iss_x", issueRevision: 3, contractHash: "ab".repeat(32), collectedAt: Date.now(), pendingAsks: ["q"], pendingBlockers: ["b"] },
      big,
    );
    assert.ok(sem.summary.length <= 2001, `summary bounded (got ${sem.summary.length})`);
    assert.ok((sem.current ?? "").length <= 500, "current bounded");
  });
});
