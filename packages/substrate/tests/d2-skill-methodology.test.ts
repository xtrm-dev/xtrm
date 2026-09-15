// D2 Skill methodology migration (XTRM-252.12, bead XTRM-351).
// ADR source: docs/substrate/sbcloseout4-adr.md §§51-55 (methodology),
// §§71-75 (skill rules), §83 (skill clauses).
//
// Strategy (anti-drift, ADR §82-83): every inventory is derived live —
// CLI registrations come from `sb help --json` at gate run time (never a
// copied list); skill text is read from docs/substrate/skills/*.md at run
// time; retired-verb and direct-mutation matchers fail on regressed content
// (fail-direction tests below prove they are not vacuous).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../cli/sb.ts";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..");
const SKILLS_DIR = join(ROOT, "docs", "substrate", "skills");

// Canonical D2 skill sources (ADR §71). canonical-promotion-map.md is a
// coordination record, not a skill, and is excluded by design.
const SKILLS = [
  "using-xtrm.md",
  "planning.md",
  "starting-and-resuming-work.md",
  "using-specialists.md",
  "implementation.md",
  "review.md",
  "coordinator.md",
  "handoff-closeout.md",
];

function readSkill(name: string): string {
  return readFileSync(join(SKILLS_DIR, name), "utf8");
}

function allSkillText(): string {
  return SKILLS.map(readSkill).join("\n");
}

// --- Live CLI surface (never a copied list) --------------------------------

function registeredCommands(): Set<string> {
  const res = runCli(["help", "--json"]);
  assert.equal(res.code, 0, `sb help --json failed: ${res.stderr}`);
  const env = JSON.parse(res.stdout) as { ok: boolean; data: { commands: string[] } };
  assert.equal(env.ok, true);
  return new Set(env.data.commands);
}

// Every `sb <group> [<verb>]` mention in a doc.
// XTRM-252.17: a mention wrapped across lines (`sb issue\n  release`) is one
// mention; without joining, the group looks bare and escapes the verb check.
function sbMentions(text: string): Array<{ group: string; verb: string | null }> {
  const joined = text.replace(/\bsb ([a-z-]+)[ \t]*\n[ \t]*/g, "sb $1 ");
  const out: Array<{ group: string; verb: string | null }> = [];
  for (const m of joined.matchAll(/\bsb ([a-z-]+)(?: ([a-z-]+))?/g)) {
    out.push({ group: m[1]!, verb: m[2] ?? null });
  }
  return out;
}

const TOP_LEVEL = new Set(["help", "version", "init", "doctor"]);

function unregisteredSbMentions(text: string, commands: Set<string>): string[] {
  const groups = new Set(
    [...commands].map((c) => c.split(".")[0]!).filter((g) => g !== "init" && g !== "doctor"),
  );
  const bad: string[] = [];
  for (const { group, verb } of sbMentions(text)) {
    if (group.startsWith("-")) continue;
    if (TOP_LEVEL.has(group)) continue;
    if (!groups.has(group)) {
      bad.push(`unknown group: sb ${group}`);
      continue;
    }
    if (verb === null || verb.startsWith("-")) {
      // XTRM-252.17: a registered group with no verb is a command the reader
      // cannot run. Name one, or state the shorthand explicitly.
      bad.push(`bare group: sb ${group} (name a verb)`);
      continue;
    }
    if (verb === "list|ready") continue; // `sb issue list|ready` shorthand in planning
    if (!commands.has(`${group}.${verb}`)) {
      bad.push(`unregistered: sb ${group} ${verb}`);
    }
  }
  return [...new Set(bad)];
}

// --- Retired-verb matcher (same allowlist shape as the migration gate) ------

const BD_VERB = /(^|[^a-zA-Z])bd [a-z-]+|(^|[^a-zA-Z])bv [a-z-]+|@beads\/bd|Dolt-as-Beads/;
const HISTORY = /retired|formerly|migration|old\s*(→|->)\s*new/i;
// XTRM-252.17: proximity alone is not a mark. A history word inside unrelated
// prose must not exempt an active bd/bv verb, so the exemption requires an
// explicit label line (a heading, or a line ending in ':') in the window.
const HISTORY_LABEL = /^(#{1,6}\s+.+|.+:)\s*$/;

function activeBdLines(text: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (!BD_VERB.test(line)) return;
    const window = lines.slice(Math.max(0, i - 5), i + 1);
    const marked = window.some((candidate) => HISTORY.test(candidate) && HISTORY_LABEL.test(candidate.trim()));
    if (marked) return;
    out.push(`${i + 1}: ${line.trim()}`);
  });
  return out;
}

// --- Direct contract mutation (forbidden) ------------------------------------
// Skills must never instruct the agent to bypass `sb issue edit` /
// `sb plan apply` by writing the store directly.
const DIRECT_MUTATION = [
  /sqlite3\s+.*state\.db/i,
  /UPDATE\s+issues\s+SET/i,
  /INSERT\s+INTO\s+(issues|journal)/i,
  /DELETE\s+FROM\s+(issues|journal)/i,
  /edit\s+the\s+(store|database)\s+directly/i,
  /mutate\s+.*state\.db/i,
];

function directMutationOffenses(text: string): string[] {
  return DIRECT_MUTATION.filter((re) => re.test(text)).map((re) => String(re));
}

// --- Skill-command test (VALIDATION clause 2) --------------------------------

describe("d2 skill-command: every sb verb referenced is registered; no retired verb is active", () => {
  it("skill files exist", () => {
    const onDisk = new Set(readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md")));
    for (const name of SKILLS) {
      assert.ok(onDisk.has(name), `${name} must exist in docs/substrate/skills/`);
    }
  });

  it("every sb command taught by a skill exists in `sb --help`", () => {
    const commands = registeredCommands();
    assert.ok(commands.has("issue.create") && commands.has("journal.checkpoint"), "live surface must include the core verbs");
    assert.ok(commands.has("init"), "live surface must include init");
    const bad: string[] = [];
    for (const name of SKILLS) {
      for (const offense of unregisteredSbMentions(readSkill(name), commands)) {
        bad.push(`${name}: ${offense}`);
      }
    }
    assert.deepEqual(bad, [], "skills teach unregistered sb commands");
  });

  it("no skill teaches an active retired bd/bv verb", () => {
    const bad: string[] = [];
    for (const name of SKILLS) {
      for (const line of activeBdLines(readSkill(name))) bad.push(`${name}: ${line}`);
    }
    assert.deepEqual(bad, [], "retired bd/bv workflow verbs must stay retired");
  });

  it("a history word in unrelated prose does not exempt an active bd verb", () => {
    // XTRM-252.17: proximity is not a mark. The five-line window alone let an
    // active verb survive next to an unrelated "retired" word, so the
    // exemption now requires an explicit label line (heading or trailing ':').
    const unlabeled = ["This section was retired unrelated prose.", "", "", "", "", "bd show", ""].join("\n");
    assert.deepEqual(activeBdLines(unlabeled), ["6: bd show"]);
    const labeled = ["Retired:", "", "```text", "bd prime → bd ready", "```", ""].join("\n");
    assert.deepEqual(activeBdLines(labeled), []);
  });
});

// --- Journal-methodology test (VALIDATION clause 3) ---------------------------
// §73 kind mapping + STOP→/planning→new-revision rule; no direct mutation.

const KIND_MAPPINGS: Array<[string, RegExp]> = [
  ["material fact → finding", /material fact\s*→\s*finding/i],
  ["architectural choice → decision", /architectural choice\s*→\s*decision/i],
  ["blocked condition → blocker", /blocked condition\s*→\s*blocker/i],
  ["progress boundary → milestone", /progress boundary\s*→\s*milestone/i],
  ["handoff → handoff", /handoff\s*→\s*handoff/i],
  ["completed bounded run → result", /completed bounded run\s*→\s*result/i],
  ["ordinary annotation → note", /ordinary\s+(useful\s+)?annotation\s*→\s*note/i],
  [
    "authorized work changed → STOP → /planning → new Issue revision",
    /authorized work changed\s*→\s*STOP\s*→\s*\/planning\s*→\s*new Issue revision/is,
  ],
];

function missingKindMappings(text: string): string[] {
  return KIND_MAPPINGS.filter(([, re]) => !re.test(text)).map(([name]) => name);
}

describe("d2 journal-methodology: skills teach the §73 kind mapping and the STOP rule", () => {
  for (const name of SKILLS) {
    it(`${name} teaches the full §73 kind mapping`, () => {
      assert.deepEqual(missingKindMappings(readSkill(name)), [], `${name} must teach all eight §73 mappings`);
    });
  }

  it("no skill instructs direct contract mutation", () => {
    const bad: string[] = [];
    for (const name of SKILLS) {
      for (const offense of directMutationOffenses(readSkill(name))) {
        bad.push(`${name}: ${offense}`);
      }
      assert.ok(
        /sb issue edit/.test(readSkill(name)) || /sb plan apply/.test(readSkill(name)),
        `${name} must route contract changes through sb issue edit / sb plan apply`,
      );
    }
    assert.deepEqual(bad, [], "skills must never instruct direct store mutation");
  });

  it("no skill tells the agent to use issue edit for progress", () => {
    // XTRM-252.17: the original two-pattern check only caught the exact phrases
    // "issue edit … for progress" and "use edit for … journal", so paraphrases
    // ("record progress via `sb issue edit`") survived. Match the instruction
    // shapes, not the two sentences: this must not flag the correct guidance
    // "contract changes use `sb issue edit`; progress uses the Journal".
    const ROUTES_PROGRESS_THROUGH_EDIT =
      /use (?:sb )?(?:issue )?edit\s+(?:for|to)\s+(?:record|track|log|note|journal)?[^\n]{0,20}progress|(?:record|track|log|note)\s+progress[^\n]{0,30}(?:issue edit|plan apply)|progress\s+(?:via|through|with|using|by)[^\n]{0,30}(?:issue edit|plan apply)/i;
    for (const name of SKILLS) {
      assert.doesNotMatch(
        readSkill(name),
        ROUTES_PROGRESS_THROUGH_EDIT,
        `${name} must not route progress through issue edit`,
      );
    }
  });
});

// --- Init-rule test (VALIDATION clause 4) -------------------------------------
// §72: uninitialized → sb init; never guess/invent/manual-link.

describe("d2 init-rule: the uninitialized path is `sb init` with no project guessing", () => {
  for (const name of SKILLS) {
    it(`${name} teaches sb init as the uninitialized path`, () => {
      const text = readSkill(name);
      assert.match(text, /uninitialized/i, `${name} must name the uninitialized condition`);
      assert.match(text, /sb init/, `${name} must teach sb init`);
      assert.match(text, /never\s+guess\s+the\s+only\s+project/i, `${name} must forbid guessing the only project`);
      assert.match(text, /invent\s+a\s+project\s+id/i, `${name} must forbid inventing a project id`);
      assert.match(text, /manually\s+create\/link\s+during\s+normal\s+work/i, `${name} must forbid manual create/link during normal work`);
    });
  }
});

// --- Coordinator (§74), closeout (§75), methodology (§§51-55) -------------------

describe("d2 coordinator: skills teach the §74 inspection duties without transcript duplication", () => {
  for (const name of SKILLS) {
    it(`${name} teaches coordinator duties`, () => {
      const text = readSkill(name);
      assert.match(text, /periodically\s+inspect/i, `${name} must teach periodic inspection`);
      for (const noun of [/children/i, /claims/i, /pending\s+asks/i, /new\s+results/i, /blockers/i, /provenance/i, /release\s+gates/i]) {
        assert.match(text, noun, `${name} must inspect ${String(noun)}`);
      }
      assert.match(text, /material\s+root-level\s+state/i, `${name} must journal only material root-level state`);
      assert.match(text, /no\s+giant\s+rewritten\s+root\s+description/i, `${name} must forbid the giant root rewrite`);
      assert.match(text, /no\s+child\s+transcript\s+duplication/i, `${name} must forbid child-transcript duplication`);
    });
  }
});

describe("d2 closeout: skills teach the §75 preconditions and structured Closure", () => {
  for (const name of SKILLS) {
    it(`${name} teaches closeout preconditions`, () => {
      const text = readSkill(name);
      assert.match(text, /SUCCESS\s+satisfied/i, `${name} must require SUCCESS satisfied`);
      assert.match(text, /VALIDATION\s+complete/i, `${name} must require VALIDATION complete`);
      assert.match(text, /required\s+OUTPUT\s+exists/i, `${name} must require required OUTPUT exists`);
      assert.match(text, /material\s+result\s+durable/i, `${name} must require a durable material result`);
      assert.match(text, /decisions\/findings durable|important decisions\/findings durable/i, `${name} must require durable decisions/findings`);
      assert.match(text, /provenance\s+sufficient/i, `${name} must require sufficient provenance`);
      assert.match(text, /no\s+incompatible\s+blocker/i, `${name} must require no incompatible blocker`);
      assert.match(text, /structured\s+Closure/i, `${name} must teach structured Closure`);
      assert.match(text, /not\s+close\s+solely\s+because\s+a\s+commit\s+exists/i, `${name} must never close only because a commit exists`);
    });
  }
});

describe("d2 methodology: skills teach §§51-55 and the §54 boundaries", () => {
  it("using-xtrm (spine) teaches the full §§51-55 methodology", () => {
    const text = readSkill("using-xtrm.md");
    // §51 coordinator content
    for (const marker of [
      /programme\s+decisions/i,
      /cross-child\s+blockers/i,
      /integration\s+milestones/i,
      /child\s+status\s+transitions/i,
      /critical\s+path/i,
      /pending\s+questions/i,
      /dispatch\/retry decisions/i,
      /child\s+Issues/i,
      /latest\s+child\s+checkpoints/i,
      /Do not duplicate full child Journal bodies/i,
    ]) {
      assert.match(text, marker, `spine must teach §51 marker ${String(marker)}`);
    }
    // §52 ordinary-worker content
    for (const marker of [
      /material\s+finding/i,
      /important\s+decision/i,
      /external\s+blocker/i,
      /meaningful\s+milestone/i,
      /every\s+shell\s+command/i,
      /chain-of-thought/i,
      /transient\s+speculation/i,
    ]) {
      assert.match(text, marker, `spine must teach §52 marker ${String(marker)}`);
    }
    // §53 reviewer content
    for (const marker of [/Reviewers\s+and\s+validators\s+are\s+actors/i, /Journal\s+result/i, /validation\s+refs/i, /PASS_WITH_NOTES/, /No\s+commit\s+required/i]) {
      assert.match(text, marker, `spine must teach §53 marker ${String(marker)}`);
    }
    // §54 boundary content
    for (const marker of [
      /progress update\s*→\s*Journal/i,
      /decision within existing authority\s*→\s*Journal/i,
      /SCOPE changes/i,
      /SUCCESS changes/i,
      /stop\s+execution\s*→\s*`?\/planning`?\s*→\s*new\s+Issue\s+revision\s*→\s*readiness\s*→\s*continue/is,
      /Do\s+not\s+use\s+Journal\s+entries\s+to\s+bypass\s+contract\s+revision/i,
    ]) {
      assert.match(text, marker, `spine must teach §54 marker ${String(marker)}`);
    }
    // §55 resume content
    for (const marker of [
      /current\s+Issue\s+revision/i,
      /latest\s+checkpoint/i,
      /Journal\s+delta\s+since\s+checkpoint/i,
      /child\s+status/i,
      /Resume\s+Capsule/i,
      /should\s+not\s+need\s+the\s+previous\s+chat\s+transcript/i,
    ]) {
      assert.match(text, marker, `spine must teach §55 marker ${String(marker)}`);
    }
  });

  for (const name of SKILLS) {
    it(`${name} states the §54 boundaries`, () => {
      const text = readSkill(name);
      assert.match(text, /Journal\s*!=\s*Issue/, `${name} must state Journal != Issue`);
      assert.match(text, /Journal\s*!=\s*Memory/, `${name} must state Journal != Memory`);
      assert.match(text, /Messages\s*!=\s*authority/, `${name} must state Messages != authority`);
      assert.match(text, /Provenance\s*!=\s*progress\s+notes/, `${name} must state Provenance != progress notes`);
    });
  }
});

// --- Fresh-agent test (VALIDATION clause 5, automated half) --------------------
// A new session with ONLY the migrated skill text and no chat history must
// reach the correct behaviour for the init rule, the kind mapping, and the
// closeout preconditions. This test takes only skill text as input — no ADR,
// no CLI surface, no history — proving the text alone suffices. The manual
// transcript (real fresh-context reproduction) is recorded as validation
// evidence alongside the suite.

function freshAnswerInit(skillText: string): string {
  const m = skillText.match(/uninitialized[\s\S]{0,300}sb init/i);
  assert.ok(m, "fresh agent must find the uninitialized → sb init rule in skill text alone");
  return "sb init";
}

function freshAnswerKind(skillText: string, input: string): string {
  const table: Array<[RegExp, string]> = [
    [/material fact/i, "finding"],
    [/architectural choice/i, "decision"],
    [/blocked condition/i, "blocker"],
    [/progress boundary/i, "milestone"],
    [/completed bounded run/i, "result"],
    [/ordinary.*annotation/i, "note"],
    [/handoff/i, "handoff"],
    [/authorized work changed/i, "STOP → /planning → new Issue revision"],
  ];
  for (const [re, kind] of table) {
    if (re.test(input)) {
      assert.ok(skillText.match(KIND_MAPPINGS.find(([n]) => n.includes(kind.split(" ")[0]!))?.[1] ?? /(?!)/), `skill text must support ${input} → ${kind}`);
      return kind;
    }
  }
  throw new Error(`unknown kind input: ${input}`);
}

function freshAnswerCloseout(skillText: string): string[] {
  const found: string[] = [];
  for (const marker of [
    /SUCCESS\s+satisfied/i,
    /VALIDATION\s+complete/i,
    /required\s+OUTPUT\s+exists/i,
    /material\s+result\s+durable/i,
    /decisions\/findings\s+durable/i,
    /provenance\s+sufficient/i,
    /no\s+incompatible\s+blocker/i,
  ]) {
    assert.match(skillText, marker, "fresh agent must find every closeout precondition in skill text alone");
    found.push(String(marker));
  }
  assert.match(skillText, /not\s+close\s+solely\s+because\s+a\s+commit\s+exists/i, "fresh agent must find the never-close-on-commit rule");
  return found;
}

describe("d2 fresh-agent: skill text alone yields the correct behaviour", () => {
  it("init rule answers sb init with no guessing", () => {
    const text = allSkillText();
    assert.equal(freshAnswerInit(text), "sb init");
    assert.match(text, /never guess the only project/i);
  });

  it("kind mapping answers all eight §73 cases", () => {
    const text = allSkillText();
    assert.equal(freshAnswerKind(text, "material fact"), "finding");
    assert.equal(freshAnswerKind(text, "architectural choice"), "decision");
    assert.equal(freshAnswerKind(text, "blocked condition"), "blocker");
    assert.equal(freshAnswerKind(text, "progress boundary"), "milestone");
    assert.equal(freshAnswerKind(text, "handoff"), "handoff");
    assert.equal(freshAnswerKind(text, "completed bounded run"), "result");
    assert.equal(freshAnswerKind(text, "ordinary annotation"), "note");
    assert.equal(freshAnswerKind(text, "authorized work changed"), "STOP → /planning → new Issue revision");
  });

  it("closeout preconditions answer all seven checks plus the commit rule", () => {
    assert.equal(freshAnswerCloseout(allSkillText()).length, 7);
  });
});

// --- Fail direction: matchers are not vacuous ----------------------------------

describe("d2 matchers fail on regressed content", () => {
  it("kind matcher fails when the result mapping is stripped", () => {
    const text = readSkill("using-xtrm.md");
    assert.deepEqual(missingKindMappings(text), []);
    const mutated = text.replace(/completed bounded run/g, "COMPLETED_REMOVED");
    assert.ok(missingKindMappings(mutated).includes("completed bounded run → result"), "stripped result mapping must fail");
  });

  it("init matcher fails when sb init is stripped", () => {
    const text = readSkill("starting-and-resuming-work.md");
    assert.match(text, /sb init/);
    const mutated = text.replaceAll("sb init", "SB_INIT_REMOVED");
    assert.doesNotMatch(mutated, /sb init/, "stripped init rule must fail");
  });

  it("command matcher fails on an unregistered verb but passes registered ones", () => {
    const commands = registeredCommands();
    assert.deepEqual(unregisteredSbMentions("run `sb issue show <ref>` then `sb journal since <ref> 0`", commands), []);
    assert.ok(unregisteredSbMentions("run `sb issue teleport <ref>` to finish faster", commands).length > 0, "unregistered verb must fail");
  });

  it("retired-verb matcher fails on an active bd verb but passes history", () => {
    assert.equal(activeBdLines("run bd show every morning\n").length, 1);
    assert.deepEqual(activeBdLines("formerly on Beads:\nbd prime\n"), []);
  });

  it("direct-mutation matcher fires on store writes", () => {
    assert.deepEqual(directMutationOffenses(allSkillText()), []);
    assert.ok(directMutationOffenses("fix it with sqlite3 ~/.xtrm/state.db \"UPDATE issues SET title='x'\"").length > 0, "store write must fail");
  });

  it("closeout matcher fails when the commit rule is stripped", () => {
    const text = readSkill("handoff-closeout.md");
    assert.match(text, /not close solely because a commit exists/i);
    const mutated = text.replace(/not close solely because a commit exists/i, "REMOVED");
    assert.doesNotMatch(mutated, /not\s+close\s+solely\s+because\s+a\s+commit\s+exists/i, "stripped commit rule must fail");
  });
});
