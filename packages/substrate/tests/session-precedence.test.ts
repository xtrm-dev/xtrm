import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { runUxCli } from "../cli/sb-ux.ts";
import { contract } from "./helpers.ts";

const uuid = "01a0ac95-0000-4000-8000-0000000000ab";
const cases = [
  { name: "different", ambient: "$7", explicit: "$9", expected: "$9", warning: true },
  { name: "same tmux", ambient: "$7", explicit: "$7", expected: "$7", warning: false },
  { name: "same UUID", ambient: uuid, explicit: uuid, expected: uuid, warning: false },
  { name: "uppercase UUID", ambient: uuid, explicit: uuid.toUpperCase(), expected: uuid, warning: false },
  { name: "ambient only", ambient: "$7", explicit: undefined, expected: "$7", warning: false },
  { name: "explicit only", ambient: undefined, explicit: "$9", expected: "$9", warning: false },
];

for (const command of [["journal", "append"], ["journal", "checkpoint"], ["provenance", "dispatch"]]) {
  for (const json of [false, true]) {
    for (const c of cases) {
      test(`XTRM-450 ${command.join(" ")} ${json ? "JSON" : "human"}: ${c.name}`, async () => {
        const keys = ["SUBSTRATE_PROJECT", "XTRM_SESSION_ID", "XTRM_SESSION_NAME", "SUBSTRATE_HOLDER", "SUBSTRATE_ACTIVATION_ID"];
        const saved = new Map(keys.map((key) => [key, process.env[key]]));
        const dir = mkdtempSync(join(tmpdir(), "session-precedence-"));
        const dbPath = join(dir, "state.db");
        const db = openSubstrate(dbPath);
        try {
          for (const key of keys) delete process.env[key];
          if (c.ambient !== undefined) process.env.XTRM_SESSION_ID = c.ambient;
          const svc = new IssueService(db);
          svc.createProject({ id: "prj_test", prefix: "TEST", name: "test" });
          const issue = svc.createIssue({ projectId: "prj_test", title: "precedence", kind: "task", contract: contract(), scrutiny: "LOW", authoredBy: "tester" });
          svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
          svc.claimIssue(issue.id, "tester");
          const args = ["--db", dbPath, "--project", "prj_test", ...command, issue.id];
          if (json) args.push("--json");
          if (command[1] === "append") args.push("--kind", "note");
          if (command[1] === "dispatch") args.push("--workspace", dir, "--participant", "tester");
          if (c.explicit !== undefined) args.push("--session", c.explicit);
          const result = await runUxCli(args);
          assert.equal(result.code, 0, result.stderr || result.stdout);
          if (json) assert.equal(JSON.parse(result.stdout).ok, true);
          if (c.warning) {
            assert.equal(result.stderr, 'warning: --session "$9" overrides XTRM_SESSION_ID "$7"\n');
          } else {
            assert.equal(result.stderr, "");
          }
          const records = command[0] === "journal"
            ? new JournalService(db, svc).timeline(issue.id)
            : new ProvenanceService(db, svc).listBindings(issue.id);
          assert.equal(records.length, 1);
          assert.equal(records[0]!.sessionId, c.expected);
        } finally {
          db.close();
          rmSync(dir, { recursive: true, force: true });
          for (const [key, value] of saved) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      });
    }
  }
}
