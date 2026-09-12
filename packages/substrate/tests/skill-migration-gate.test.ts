import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { runCli, SCHEMA_VERSION } from "../cli/sb.ts";
import { contract } from "./helpers.ts";

// Mechanical conformance for SKILL-MIGRATION-GATE
// (docs/substrate/skill-migration-gate.md, bead xtrm-6qu.4).
//
// Static part: every applicable gate check G1-G16 maps to literal markers
// that must appear in the normative migration reference. Per-skill applicability is
// taken from the gate doc ("Per-skill applicability") plus the A5 directive:
// using-xtrm carries all 16; planning carries G1/G2/G8/G9/G13-G16 mandatory
// with the rest by reference; starting-and-resuming-work carries
// G1-G4/G6-G7/G13-G16 mandatory with the rest by reference;
// using-specialists (§34) carries all 16; implementation (§35) and review
// (§36) carry their mandatory checks directly with the rest by explicit
// statement or reference. All 16 hold on all six skills after the owner
// revisions, so no it.todo GAPs remain.
//
// Verb currency: the xtrm-6qu.1 lifecycle surfaces are landed and must be
// taught as current truth — `sb issue note --kind
// note|finding|decision|blocker|milestone|handoff`, `sb issue state` plus
// the close/reopen/defer/cancel/archive aliases, metadata `sb issue edit
// --title/--priority` vs execution-bearing `--contract/--ownership/
// --context-refs/--scrutiny`, and `sb issue relate/unrelate`. Any leftover
// "pending/unmerged" fencing of these landed verbs fails as stale.
//
// Live part: the using-xtrm transcript and the planning check/apply flow
// run against scratch databases through runCli, the same --db/--json
// pattern as tests/cli-smoke.test.ts. Every asserted verb is grounded in
// packages/substrate/cli/sb.ts on this branch: issue note (typed append,
// no revision bump), issue edit metadata vs execution-bearing, issue
// state plus lifecycle aliases, relate/unrelate round-trip.

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..");

function readDoc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const USING = "docs/substrate/skills/using-xtrm.md";
const PLANNING = "docs/substrate/skills/planning.md";
const STARTING = "docs/substrate/skills/starting-and-resuming-work.md";
// A5 normative migration references (bead xtrm-6qu.5, ADR §§34-36 + §§13-20).
const SPEC = "docs/substrate/skills/using-specialists.md";
const IMPL = "docs/substrate/skills/implementation.md";
const REVIEW = "docs/substrate/skills/review.md";
const GATE = "docs/substrate/skill-migration-gate.md";

// --- G16 matcher -----------------------------------------------------------
// Active-workflow bd/bv verbs fail; lines inside history-marked context
// (gate G16 allowlist: "retired", "formerly", "migration", plus the doc's
// own "old -> new" retired-model heading) pass.
const BD_VERB = /(^|[^a-zA-Z])bd [a-z-]+|(^|[^a-zA-Z])bv [a-z-]+|@beads\/bd|Dolt-as-Beads/;
const HISTORY = /retired|formerly|migration|old\s*(→|->)\s*new/i;

function activeBdLines(text: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (!BD_VERB.test(line)) return;
    const ctx = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
    if (HISTORY.test(ctx)) return;
    out.push(`${i + 1}: ${line.trim()}`);
  });
  return out;
}

// --- Landed-surfaces check ---------------------------------------------------
// The xtrm-6qu.1 verbs below are landed: each skill must teach the ones it
// uses as current truth, and no doc may keep them wrapped in
// pending/unmerged fencing. `sb issue create --title/--priority` and plain
// `sb journal` mechanics were never pending and never match either matcher.
const LANDED_VERB = /sb issue (note|state|relate|unrelate)\b|sb issue (close|reopen|defer|cancel|archive)\b|issue edit[^\n`]*--(title|priority|contract|ownership|context-refs|scrutiny)/;
// Narrow by design: ordinary "pending work / pending asks" prose must never
// match. Only the old-posture fencing phrases count as stale marks.
const STALE_MARK = /unmerged|do not use until merged|do not teach as current|pending surfaces/i;

function stalePendingOffenses(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(LANDED_VERB.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const ctx = text.slice(Math.max(0, m.index - 400), m.index + m[0].length + 400);
    if (!STALE_MARK.test(ctx)) continue;
    out.push(`line ~${text.slice(0, m.index).split("\n").length}: ${m[0]}`);
  }
  return out;
}

// Per-doc landed expectations, grounded in what each doc actually teaches:
// the gate states the canonical set; using-xtrm (spine) teaches all of it;
// planning teaches note/close/edit/relate; starting teaches note/state/close;
// using-specialists (§34 dispatch) teaches note/state/close/release;
// implementation (§35 execution) teaches note/edit-classification/relate plus
// state/close/release; review (§36) teaches note reads plus state/close/release.
function landedPatternsFor(rel: string): RegExp[] {
  if (rel === GATE) {
    return [
      /sb issue\s+note/,
      /--kind note\\\|finding\\\|decision\\\|blocker\\\|milestone\\\|handoff/,
      /sb journal append/,
      /sb issue\s+state/,
      /close\\\|reopen\\\|defer\\\|cancel\\\|archive/,
      /metadata vs execution-bearing/,
    ];
  }
  if (rel === USING) {
    return [
      /sb issue\s+note/,
      /sb issue\s+state/,
      /close\s*\|\s*reopen\s*\|\s*defer\s*\|\s*cancel\s*\|\s*archive/,
      /issue edit[^\n]*--title/,
      /issue edit[^\n]*--priority/,
      /--contract/,
      /--ownership/,
      /--context-refs/,
      /--scrutiny/,
      /relate/,
      /unrelate/,
    ];
  }
  if (rel === PLANNING) {
    return [
      /sb issue\s+note/,
      /sb issue\s+close/,
      /sb issue\s+release/,
      /issue edit[^\n]*--title/,
      /--contract/,
      /--ownership/,
      /--context-refs/,
      /--scrutiny/,
      /relate/,
      /unrelate/,
    ];
  }
  if (rel === STARTING) {
    return [
      /sb issue\s+note/,
      /--kind handoff/,
      /sb issue\s+state/,
      /sb issue\s+close/,
      /sb issue\s+release/,
    ];
  }
  if (rel === SPEC) {
    return [
      /sb issue\s+note/,
      /--kind handoff/,
      /sb issue\s+state/,
      /sb issue\s+close/,
      /sb issue\s+release/,
    ];
  }
  if (rel === IMPL) {
    return [
      /sb issue\s+note/,
      /--kind handoff/,
      /sb issue\s+state/,
      /sb issue\s+close/,
      /sb issue\s+release/,
      /issue edit[^\n]*--title/,
      /--contract/,
      /--ownership/,
      /--context-refs/,
      /--scrutiny/,
      /relate/,
      /unrelate/,
    ];
  }
  if (rel === REVIEW) {
    return [
      /sb issue\s+note/,
      /--kind finding/,
      /sb issue\s+state/,
      /sb issue\s+close/,
      /sb issue\s+release/,
    ];
  }
  assert.fail(`no landed expectations for ${rel}`);
}

function missingLanded(rel: string): string[] {
  const text = readDoc(rel);
  return landedPatternsFor(rel)
    .filter((re) => !re.test(text))
    .map((re) => String(re));
}

interface Check {
  id: string;
  patterns: RegExp[];
  absent?: RegExp[];
}

function missingMarkers(text: string, check: Check): string[] {
  const missing = check.patterns.filter((re) => !re.test(text)).map((re) => String(re));
  for (const re of check.absent ?? []) {
    if (re.test(text)) missing.push(`must-be-absent: ${String(re)}`);
  }
  return missing;
}

// --- Marker tables (one entry per applicable gate check) -------------------

function needCheck(checks: Check[], id: string): Check {
  const found = checks.find((c) => c.id === id);
  assert.ok(found, `check table must define ${id}`);
  return found;
}

const USING_CHECKS: Check[] = [
  { id: "G1", patterns: [/PROBLEM/, /SUCCESS/, /SCOPE/, /NON_GOALS/, /CONSTRAINTS/, /VALIDATION/, /OUTPUT/, /SCRUTINY/, /executable contract/, /revision/i] },
  { id: "G2", patterns: [/sb issue validate/, /sb issue attest/, /--outcome ready/] },
  { id: "G3", patterns: [/sb issue claim/, /--holder/, /sb issue release/, /atomic lease/, /not an assignee/] },
  { id: "G4", patterns: [/sb issue\s+note/, /sb journal append/, /sb journal checkpoint/, /sb journal since/, /never\s+bump\s+the Issue revision/] },
  {
    id: "G5",
    patterns: [/finding \(observation/, /decision\s*\(choice \+ reason\)/, /blocker \(external dependency\)/, /milestone\s*\(progress\s+boundary\)/, /handoff \(continuation\)/, /checkpoint and compaction kinds/, /Do not journal every shell\s+command/],
  },
  // Checkpoint at durable boundaries with mechanical-first intent.
  { id: "G6", patterns: [/sb journal checkpoint/, /mechanical/, /durable\s+boundaries/i] },
  { id: "G7", patterns: [/sb issue resume/, /Resume Capsule/, /sb journal since/, /never the full history/] },
  { id: "G8", patterns: [/repair via `\/planning`/, /Never smuggle/] },
  { id: "G9", patterns: [/Journal != Issue/] },
  { id: "G10", patterns: [/Journal != Memory/] },
  { id: "G11", patterns: [/Messages coordinate/, /never silently change the contract/] },
  { id: "G12", patterns: [/worker summary != provenance/, /sb provenance dispatch/, /sb provenance trace/] },
  { id: "G13", patterns: [/bounded\s+Journal handoff entry/, /blockers, pending work, and provenance refs/] },
  { id: "G14", patterns: [/sb issue\s+state/, /close\s*\|\s*reopen\s*\|\s*defer\s*\|\s*cancel\s*\|\s*archive/, /sb issue\s+release/, /release the claim/] },
  { id: "G15", patterns: [/without previous chat history/] },
  { id: "G16", patterns: [] },
];

const PLANNING_CHECKS: Check[] = [
  { id: "G1", patterns: [/PROBLEM/, /SUCCESS/, /SCOPE/, /NON_GOALS/, /CONSTRAINTS/, /VALIDATION/, /OUTPUT/, /SCRUTINY/, /seven-field contracts/, /revision/] },
  { id: "G2", patterns: [/sb issue validate/, /sb issue attest/, /--outcome ready/] },
  // By reference via the worker lifecycle: ownership/context.
  { id: "G3", patterns: [/ownership/] },
  // Continuity by reference (doctrine lives in using-xtrm): the planning
  // continuity section teaches `sb issue note`, checkpoint-before-apply,
  // and plan apply.
  { id: "G4", patterns: [/sb issue\s+note/, /checkpoint before/, /sb plan apply/] },
  { id: "G5", patterns: [/findings, decisions, and/, /doctrine lives in using-xtrm/] },
  { id: "G6", patterns: [/checkpoint before/, /sb plan apply/] },
  { id: "G7", patterns: [/sb issue resume/, /sb journal since/] },
  { id: "G8", patterns: [/execution pauses/, /Issue revision/, /new readiness attestation/, /Never patch missing scope/] },
  // G9-class statement: journal/message content cannot carry authority.
  { id: "G9", patterns: [/handoff note/, /authorization had not changed/] },
  { id: "G10", patterns: [/Journal != Memory/] },
  // By reference: channel messages named as non-authority carriers.
  { id: "G11", patterns: [/channel message/] },
  { id: "G12", patterns: [/planning provenance/, /recorded, not summarized/] },
  // Handoff and close of planning work (mandatory).
  { id: "G13", patterns: [/bounded Journal handoff entry/, /records the plan/, /restarts from `sb issue resume`/] },
  { id: "G14", patterns: [/sb issue\s+close/, /sb issue\s+release/, /validate, checkpoint/] },
  { id: "G15", patterns: [/without previous chat history/] },
  { id: "G16", patterns: [] },
];

// All planning checks now hold after the owner revision; the matrix
// excuses nothing further.
const PLANNING_GAPS: Array<{ id: string; gap: string }> = [];

const STARTING_CHECKS: Check[] = [
  // Consumer-level G1: revision-as-authority (seven-field enumeration lives
  // in planning/using-xtrm per this skill's own "does not own" section).
  { id: "G1", patterns: [/executable authority/, /exact Issue revision/, /readiness/] },
  // "re-attest" carries the attestation doctrine by reference.
  { id: "G2", patterns: [/sb issue validate/, /attest/] },
  { id: "G3", patterns: [/sb issue claim/, /--holder/], absent: [/assignee/] },
  { id: "G4", patterns: [/sb issue\s+note/, /sb journal since/, /sb journal checkpoint/, /--kind handoff/] },
  // By reference: journal kinds owned by using-xtrm.
  { id: "G5", patterns: [/journal kinds/] },
  { id: "G6", patterns: [/mechanical checkpoint first/, /sb journal checkpoint/] },
  { id: "G7", patterns: [/sb issue resume/, /Resume Capsule/, /sb journal since/, /Never dump the full\s+history/] },
  // By reference: authority change -> stop -> revise -> re-attest -> resume.
  { id: "G8", patterns: [/authority change/, /stop → revise → re-attest → resume/] },
  // By reference: handoff entries never move authority ("The Issue stays…").
  { id: "G9", patterns: [/Issue stays the executable authority/] },
  // Step 6: takeover entries are continuity, never reusable truth.
  { id: "G10", patterns: [/Journal != Memory/] },
  // By reference: coordination happens off-contract; durable state decides.
  { id: "G11", patterns: [/durable Substrate state wins/] },
  // By reference: capsule is a derived projection; summaries are not truth.
  { id: "G12", patterns: [/provenance state/, /derived, never a source of truth/] },
  { id: "G13", patterns: [/bounded Journal/, /handoff\/checkpoint entry/, /provenance\s+refs/, /restarts from `sb issue resume`/] },
  // Step 6 closes through the landed lifecycle surface (state + close alias).
  { id: "G14", patterns: [/sb issue\s+state/, /sb issue\s+close/, /sb issue\s+release/] },
  { id: "G15", patterns: [/without previous chat history/] },
  { id: "G16", patterns: [] },
];

// Starting checks all hold after the owner revision (step 6 covers G10
// by reference and G14 mandatory); the matrix excuses nothing further.
const STARTING_GAPS: Array<{ id: string; gap: string }> = [];

// --- Static conformance ----------------------------------------------------

describe("skill-migration-gate: gate doc defines all 16 checks", () => {
  it("names G1-G16 with a Verify column", () => {
    const gate = readDoc(GATE);
    for (let n = 1; n <= 16; n++) {
      assert.match(gate, new RegExp(`\\| G${n} \\|`), `gate doc must define G${n}`);
    }
    assert.match(gate, /Per-skill applicability/);
    assert.match(gate, /sb journal append/, "G4 row must teach the landed journal-append verb");
    assert.match(gate, /sb issue note/, "G4 row must teach the landed note verb");
    assert.match(gate, /--kind note\\\|finding\\\|decision\\\|blocker\\\|milestone\\\|handoff/, "G4 row must enumerate the landed note kinds");
    assert.match(gate, /sb issue state/, "G14 row must teach the landed state verb");
    assert.match(gate, /close\\\|reopen\\\|defer\\\|cancel\\\|archive/, "G14 row must teach the lifecycle aliases");
    assert.deepEqual(stalePendingOffenses(gate), [], "gate must carry no stale pending fencing of landed verbs");
  });
});

function staticSuite(skillName: string, rel: string, checks: Check[], gaps: Array<{ id: string; gap: string }>) {
  describe(`skill-migration-gate static: ${skillName}`, () => {
    for (const check of checks) {
      it(`${check.id} markers present`, () => {
        const text = readDoc(rel);
        if (check.id === "G16") {
          assert.deepEqual(activeBdLines(text), [], "active bd/bv workflow verbs must be absent (history-marked lines allowed)");
          return;
        }
        assert.deepEqual(missingMarkers(text, check), [], `${check.id} doctrine markers missing`);
      });
    }
    for (const gap of gaps) {
      it.todo(`${gap.id} GAP: ${gap.gap}`);
    }
    it("landed surfaces taught as current truth", () => {
      assert.deepEqual(missingLanded(rel), [], "landed verbs (note/state/edit-classification/relate) must be taught as current");
    });
    it("no stale pending fencing of landed verbs", () => {
      assert.deepEqual(
        stalePendingOffenses(readDoc(rel)),
        [],
        "landed verbs (issue note/state, edit flags, relate/unrelate, state aliases) must never sit inside pending-marked notes",
      );
    });
  });
}

staticSuite("using-xtrm (all 16)", USING, USING_CHECKS, []);
staticSuite("planning (mandatory + by-reference)", PLANNING, PLANNING_CHECKS, PLANNING_GAPS);
staticSuite("starting-and-resuming-work (mandatory + by-reference)", STARTING, STARTING_CHECKS, STARTING_GAPS);

// --- A5 marker tables (bead xtrm-6qu.5; ADR §§34-36 over §§13-20) --------------
// using-specialists (§34) carries all 16: it is the dispatch spine for
// specialist work. implementation (§35) and review (§36) carry their
// mandatory checks directly and hold the rest by explicit statement or
// reference to the owning reference (no forked doctrine).

const SPEC_CHECKS: Check[] = [
  { id: "G1", patterns: [/PROBLEM/, /SUCCESS/, /SCOPE/, /NON_GOALS/, /CONSTRAINTS/, /VALIDATION/, /OUTPUT/, /SCRUTINY/, /executable/, /exact revision/] },
  { id: "G2", patterns: [/sb issue validate/, /sb issue attest/, /--outcome ready/] },
  { id: "G3", patterns: [/sb issue claim/, /--holder/, /sb issue release/, /atomic lease/, /not an assignee/] },
  { id: "G4", patterns: [/sb issue\s+note/, /sb journal append/, /sb journal checkpoint/, /sb journal since/, /never bump the Issue revision/] },
  { id: "G5", patterns: [/finding \(observation\)/, /choice \+ reason/, /blocker \(external/, /progress boundary/, /handoff \(continuation\)/, /ordinary annotation/, /Do not journal every shell command/] },
  { id: "G6", patterns: [/sb journal checkpoint/, /mechanical/, /durable/] },
  { id: "G7", patterns: [/sb issue resume/, /Resume Capsule/, /sb journal since/, /never from chat/] },
  { id: "G8", patterns: [/stop →/, /\/planning/, /new readiness attestation/, /Never smuggle/] },
  { id: "G9", patterns: [/Journal != Issue/] },
  { id: "G10", patterns: [/Journal != Memory/] },
  { id: "G11", patterns: [/Messages != authority/, /never silently change the contract/] },
  { id: "G12", patterns: [/sb provenance dispatch/, /sb provenance trace/, /Provenance != progress/] },
  { id: "G13", patterns: [/Issue stays authority/, /provenance refs/, /next worker uses the/] },
  { id: "G14", patterns: [/sb issue\s+state/, /close\s*\|\s*reopen\s*\|\s*defer\s*\|\s*cancel\s*\|\s*archive/, /sb issue\s+release/] },
  { id: "G15", patterns: [/without previous chat history/] },
  { id: "G16", patterns: [] },
];

const IMPL_CHECKS: Check[] = [
  { id: "G1", patterns: [/PROBLEM/, /SUCCESS/, /SCOPE/, /NON_GOALS/, /CONSTRAINTS/, /VALIDATION/, /OUTPUT/, /SCRUTINY/, /executable contract/, /exact revision/] },
  { id: "G2", patterns: [/sb issue validate/, /sb issue attest/, /--outcome ready/, /re-validated/] },
  { id: "G3", patterns: [/sb issue claim/, /--holder/, /sb issue release/, /writer lease/, /not an assignee/] },
  { id: "G4", patterns: [/sb issue\s+note/, /sb journal append/, /sb journal checkpoint/, /sb journal since/, /sb journal show/, /sb journal render/] },
  { id: "G5", patterns: [/→ Journal finding/, /→ Journal decision/, /→ Journal blocker/, /→ Journal milestone/, /→ Journal handoff/, /→ Journal note/, /Do not journal every shell command/] },
  { id: "G6", patterns: [/sb journal checkpoint/, /mechanical checkpoint/, /mechanical state first/] },
  { id: "G7", patterns: [/sb issue resume/, /Resume Capsule/, /sb journal since/] },
  { id: "G8", patterns: [/execution pauses/, /Issue revision/, /new readiness attestation/, /Never silently put the new scope/] },
  { id: "G9", patterns: [/Journal != Issue/] },
  { id: "G10", patterns: [/Journal != Memory/] },
  { id: "G11", patterns: [/Messages != authority/, /never silently/] },
  { id: "G12", patterns: [/sb provenance dispatch/, /sb provenance trace/, /Provenance != progress/] },
  { id: "G13", patterns: [/Issue stays authority/, /provenance refs/, /restarts/] },
  { id: "G14", patterns: [/sb issue\s+state/, /close\|reopen\|defer\|cancel\|archive/, /sb issue\s+release/] },
  { id: "G15", patterns: [/without previous chat history/] },
  { id: "G16", patterns: [] },
];

const REVIEW_CHECKS: Check[] = [
  { id: "G1", patterns: [/PROBLEM/, /SUCCESS/, /SCOPE/, /NON_GOALS/, /CONSTRAINTS/, /VALIDATION/, /OUTPUT/, /SCRUTINY/, /executable contract/, /exact revision/] },
  { id: "G2", patterns: [/sb issue validate/, /sb issue attest/, /readiness attestation/] },
  { id: "G3", patterns: [/sb issue claim/, /sb issue release/, /atomic lease, not an assignee/] },
  { id: "G4", patterns: [/sb issue\s+note/, /sb journal since/, /sb journal show/, /never bump the revision/] },
  // Kind meanings owned by the implementation reference; the reviewer
  // consumes findings/decisions and never redefines them.
  { id: "G5", patterns: [/Kind meanings/, /finding\/decision\/blocker\/milestone\/handoff\/note/, /do not journal every shell/] },
  { id: "G6", patterns: [/mechanical checkpoint first/, /sb journal checkpoint/] },
  { id: "G7", patterns: [/sb issue resume/, /Resume Capsule/, /sb journal since/] },
  { id: "G8", patterns: [/planning\/revision cycle/, /new readiness attestation/, /SCOPE, SUCCESS,/] },
  { id: "G9", patterns: [/does not silently mutate/, /Journal != Issue/] },
  { id: "G10", patterns: [/Journal != Memory/] },
  { id: "G11", patterns: [/Messages != authority/, /never silently/] },
  { id: "G12", patterns: [/sb provenance trace/, /Provenance != progress/] },
  { id: "G13", patterns: [/Issue stays authority/, /provenance refs/, /restarts from/, /sb issue resume/] },
  { id: "G14", patterns: [/sb issue\s+state/, /close\|reopen\|defer\|cancel\|archive/, /sb issue\s+release/] },
  { id: "G15", patterns: [/without previous chat history/] },
  { id: "G16", patterns: [] },
];

const A5_GAPS: Array<{ id: string; gap: string }> = [];

staticSuite("using-specialists §34 (all 16)", SPEC, SPEC_CHECKS, A5_GAPS);
staticSuite("implementation §35 (mandatory + by-statement)", IMPL, IMPL_CHECKS, A5_GAPS);
staticSuite("review §36 (mandatory + by-reference)", REVIEW, REVIEW_CHECKS, A5_GAPS);

// --- Fail direction: matchers are not vacuous ------------------------------

describe("skill-migration-gate matchers fail on regressed content", () => {
  it("G1 fails when the contract block is stripped from using-xtrm", () => {
    const text = readDoc(USING);
    const g1 = needCheck(USING_CHECKS, "G1");
    assert.deepEqual(missingMarkers(text, g1), []);
    const mutated = text.replace(/PROBLEM/g, "").replace(/executable contract/g, "");
    assert.ok(missingMarkers(mutated, g1).length > 0, "stripped doc must fail G1");
  });
  it("G2 fails when attestation wording is stripped from planning", () => {
    const text = readDoc(PLANNING);
    const g2 = needCheck(PLANNING_CHECKS, "G2");
    assert.deepEqual(missingMarkers(text, g2), []);
    const mutated = text.replace(/sb issue attest/g, "");
    assert.ok(missingMarkers(mutated, g2).length > 0, "stripped doc must fail G2");
  });
  it("G7 fails when the capsule wording is stripped from starting-and-resuming-work", () => {
    const text = readDoc(STARTING);
    const g7 = needCheck(STARTING_CHECKS, "G7");
    assert.deepEqual(missingMarkers(text, g7), []);
    const mutated = text.replace(/Resume Capsule/g, "").replace(/sb journal since/g, "");
    assert.ok(missingMarkers(mutated, g7).length > 0, "stripped doc must fail G7");
  });
  it("G16 fails on an active bd verb but passes the retired-model block", () => {
    assert.deepEqual(activeBdLines(readDoc(STARTING)), [], "retired block must be allowlisted");
    assert.equal(activeBdLines("run bd show every morning\n").length, 1, "unmarked active bd verb must fail");
    assert.deepEqual(activeBdLines("formerly on Beads:\nbd prime\n"), [], "formerly-marked history must pass");
  });
  it("landed-surface matcher fails when teaching is stripped", () => {
    for (const rel of [GATE, USING, PLANNING, STARTING]) {
      assert.deepEqual(missingLanded(rel), [], `${rel} landed surfaces must all be present`);
    }
    const mutated = readDoc(USING).replace(/sb issue note/g, "").replace(/sb issue state/g, "");
    const missing = landedPatternsFor(USING).filter((re) => !re.test(mutated)).map((re) => String(re));
    assert.ok(missing.length > 0, "stripped doc must fail the landed-surface matcher");
    assert.deepEqual(
      landedPatternsFor(PLANNING).filter((re) => !re.test(readDoc(PLANNING).replace(/unrelate/g, ""))).map((re) => String(re)),
      ["/unrelate/"],
      "stripping unrelate from planning must fail exactly its marker",
    );
  });
  it("stale-pending matcher fires on the old pending-marked wording", () => {
    for (const rel of [GATE, USING, PLANNING, STARTING]) {
      assert.deepEqual(stalePendingOffenses(readDoc(rel)), [], `${rel} must carry no stale pending fencing`);
    }
    assert.equal(
      stalePendingOffenses("close with `sb issue state <ref> done` when finished\n").length,
      0,
      "current-truth teaching must pass the stale matcher",
    );
    assert.equal(
      stalePendingOffenses("Pending, unmerged via xtrm-6qu.1: `sb issue state <ref> done`\n").length,
      1,
      "old pending-marked `sb issue state` wording must fail as stale",
    );
    assert.equal(
      stalePendingOffenses("`sb issue note <ref> --kind finding` (Pending — do not use until merged)\n").length,
      1,
      "old pending-marked `sb issue note` wording must fail as stale",
    );
    assert.equal(
      stalePendingOffenses("edit titles with `sb issue edit <ref> --title New` (unmerged)\n").length,
      1,
      "old pending-marked metadata edit wording must fail as stale",
    );
  });
});

// --- Live evidence (scratch databases via runCli) ---------------------------

function setupDb(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "sb-gate-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_gate", prefix: "GATE", name: "gate" });
  db.close();
  return { dir, dbPath };
}

function cli(dbPath: string, argv: string[]): { code: number; data: any } {
  const res = runCli(["--db", dbPath, "--json", ...argv]);
  assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
  const env = JSON.parse(res.stdout) as { schema: string; command: string; ok: boolean; data: any };
  assert.equal(env.schema, SCHEMA_VERSION);
  assert.equal(env.ok, true);
  return { code: res.code, data: env.data };
}

// Mutating verbs are project-scoped (ADR §5): every mutation names prj_gate.
const PROJECT_ARGS = ["--project", "prj_gate"];
function mut(dbPath: string, argv: string[]): { code: number; data: any } {
  return cli(dbPath, [...argv, ...PROJECT_ARGS]);
}

function contractFile(dir: string, name: string, overrides: Record<string, unknown> = {}): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify({ ...contract(), ...overrides }));
  return p;
}

describe("skill-migration-gate live: using-xtrm transcript", () => {
  it("create -> metadata edit (no bump) -> contract edit (bump, readiness reset) -> note (no bump) -> validate -> attest -> claim -> resume -> checkpoint -> state round-trip -> relate/unrelate -> close -> release", () => {
    const { dir, dbPath } = setupDb();
    const c1 = contractFile(dir, "c1.json", { problem: "Gate problem", success: "Gate success" });

    const created = cli(dbPath, ["issue", "create", "--project", "prj_gate", "--title", "Gate", "--kind", "task", "--contract", c1, "--scrutiny", "LOW"]).data;
    assert.equal(created.revision, 1);

    // Metadata edit: no revision, readiness untouched.
    const meta = mut(dbPath, ["issue", "edit", created.humanRef, "--title", "Gate renamed", "--priority", "2"]).data;
    assert.equal(meta.revision, 1);
    assert.equal(meta.revisionCreated, false);

    // Execution-bearing edit: new revision, readiness invalidated.
    const c2 = contractFile(dir, "c2.json", { problem: "Gate problem v2", success: "Gate success" });
    const edited = mut(dbPath, ["issue", "edit", created.humanRef, "--contract", c2]).data;
    assert.equal(edited.revision, 2);
    assert.equal(edited.revisionCreated, true);

    // Convenience note: append-only continuity, no revision bump.
    const noted = mut(dbPath, ["issue", "note", created.humanRef, "takeover observation", "--kind", "finding"]).data;
    assert.equal(noted.kind, "finding");
    assert.equal(noted.issueRevision, 2);
    assert.equal(cli(dbPath, ["issue", "show", created.humanRef]).data.revision, 2);

    // Readiness: invalidated by the contract edit, restored by attestation,
    // retained across a later metadata edit.
    const before = cli(dbPath, ["issue", "validate", created.humanRef]).data;
    assert.equal(before.revision, 2);
    assert.equal(before.attestationCurrent, false);
    const attested = mut(dbPath, ["issue", "attest", created.humanRef, "--outcome", "ready", "--policy", "default", "--attested-by", "gate"]).data;
    assert.equal(attested.outcome, "ready");
    assert.equal(cli(dbPath, ["issue", "validate", created.humanRef]).data.dispatchable, true);
    const meta2 = mut(dbPath, ["issue", "edit", created.humanRef, "--title", "Gate renamed again"]).data;
    assert.equal(meta2.revision, 2);
    assert.equal(meta2.revisionCreated, false);
    const retained = cli(dbPath, ["issue", "validate", created.humanRef]).data;
    assert.equal(retained.dispatchable, true);
    assert.equal(retained.attestationCurrent, true);

    // Claim -> resume capsule renders the executed revision.
    const claimed = mut(dbPath, ["issue", "claim", created.humanRef, "--holder", "gate-holder"]).data;
    assert.equal(claimed.holder, "gate-holder");
    const capsule = cli(dbPath, ["issue", "resume", created.humanRef]).data;
    assert.equal(capsule.humanRef, "GATE-1");
    assert.equal(capsule.revision, 2);

    // Durable checkpoint, then the lifecycle round-trip: defer -> open ->
    // (close/reopen/state aliases all land on lifecycleState).
    const checkpoint = mut(dbPath, ["journal", "checkpoint", created.humanRef]).data;
    assert.equal(checkpoint.kind, "checkpoint");
    assert.equal(mut(dbPath, ["issue", "defer", created.humanRef]).data.lifecycleState, "deferred");
    assert.equal(mut(dbPath, ["issue", "state", created.humanRef, "open"]).data.lifecycleState, "open");

    // Graph round-trip on a second issue: relate then unrelate.
    const second = cli(dbPath, ["issue", "create", "--project", "prj_gate", "--title", "Gate two", "--kind", "task", "--contract", c1, "--scrutiny", "LOW"]).data;
    assert.equal(second.humanRef, "GATE-2");
    const related = mut(dbPath, ["issue", "relate", "--from", created.humanRef, "--to", second.humanRef, "--kind", "blocks"]).data;
    assert.equal(related.kind, "blocks");
    const unrelated = mut(dbPath, ["issue", "unrelate", "--from", created.humanRef, "--to", second.humanRef, "--kind", "blocks"]).data;
    assert.equal(unrelated.kind, "blocks");

    // Close via the lifecycle alias, then release.
    const closed = mut(dbPath, ["issue", "close", created.humanRef]).data;
    assert.equal(closed.lifecycleState, "done");
    assert.equal(mut(dbPath, ["issue", "state", created.humanRef, "open"]).data.lifecycleState, "open");
    assert.equal(mut(dbPath, ["issue", "state", created.humanRef, "done"]).data.lifecycleState, "done");
    assert.equal(mut(dbPath, ["issue", "release", created.humanRef, "--holder", "gate-holder"]).data.released, true);

    // Journal delta stays readable after close (continuity survives).
    const delta = cli(dbPath, ["journal", "since", created.humanRef, "0"]).data;
    assert.ok(delta.entries.length >= 2, "finding note + checkpoint entries visible via since");
  });
});

describe("skill-migration-gate live: planning check/apply", () => {
  it("plan check rejects a cyclic draft and apply refuses it", () => {
    const { dir, dbPath } = setupDb();
    const planPath = join(dir, "cyclic.json");
    writeFileSync(planPath, JSON.stringify({
      planKey: "gate-cyclic",
      issues: [
        { key: "a", projectId: "prj_gate", title: "A", kind: "task", contract: contract(), scrutiny: "LOW" },
        { key: "b", projectId: "prj_gate", title: "B", kind: "task", contract: contract(), scrutiny: "LOW" },
      ],
      edges: [
        { fromKey: "a", toKey: "b", kind: "blocks" },
        { fromKey: "b", toKey: "a", kind: "blocks" },
      ],
    }));
    const check = mut(dbPath, ["plan", "check", "--file", planPath]).data;
    assert.equal(check.ok, false);
    assert.ok(check.blockCycles.length > 0, "cycle must be reported");
    const refused = runCli(["--db", dbPath, "--json", "plan", "apply", "--file", planPath, "--project", "prj_gate"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stdout, /cycle/i);
  });

  it("plan check/apply accepts a minimal valid draft, then the created issue attests", () => {
    const { dir, dbPath } = setupDb();
    const planPath = join(dir, "valid.json");
    writeFileSync(planPath, JSON.stringify({
      planKey: "gate-valid",
      issues: [
        { key: "a", projectId: "prj_gate", title: "Planned A", kind: "task", contract: contract(), scrutiny: "LOW" },
      ],
      edges: [],
    }));
    assert.equal(mut(dbPath, ["plan", "check", "--file", planPath]).data.ok, true);
    const applied = mut(dbPath, ["plan", "apply", "--file", planPath]).data;
    assert.equal(applied.applied, true);
    assert.equal(applied.issues.length, 1);
    const list = cli(dbPath, ["issue", "list", "--project", "prj_gate"]).data as Array<{ humanRef: string }>;
    assert.equal(list.length, 1);
    const first = list[0];
    assert.ok(first, "planned issue must be listed");
    const ref = first.humanRef;
    assert.equal(cli(dbPath, ["issue", "validate", ref]).data.dispatchable, false, "planned issue needs attestation before dispatch");
    assert.equal(mut(dbPath, ["issue", "attest", ref, "--outcome", "ready", "--policy", "default", "--attested-by", "gate"]).data.outcome, "ready");
    assert.equal(cli(dbPath, ["issue", "validate", ref]).data.dispatchable, true);
  });
});
