import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClarifiedDraft,
  buildPromptRequest,
  buildRefinementRequest,
  detectIntent,
  isVagueDraft,
  normalizeContext,
  parseSentinel,
} from "../src/prompt.mjs";

test("detectIntent covers every supported intent", () => {
  assert.equal(detectIntent("Plan this migration with ## SCOPE"), "planning");
  assert.equal(detectIntent("Analyze why this request failed"), "analysis");
  assert.equal(detectIntent("Implement a command"), "development");
  assert.equal(detectIntent("Refactor the parser"), "refactor");
  assert.equal(detectIntent("Tighten this wording"), "generic");
});

test("isVagueDraft distinguishes underspecified and concrete prompts", () => {
  assert.equal(isVagueDraft("help"), true);
  assert.equal(isVagueDraft("help me improve this prompt today"), true);
  assert.equal(
    isVagueDraft("Update packages/xtprompt/src/cli.mjs and preserve exit code 2."),
    false,
  );
});

test("buildClarifiedDraft preserves both inputs", () => {
  assert.equal(
    buildClarifiedDraft("help", "produce a release checklist"),
    "Original draft: help\nClarification: produce a release checklist",
  );
});

test("buildPromptRequest uses semantic XML for complex input and escapes context", () => {
  const request = buildPromptRequest({
    draft: "Implement a standalone prompt CLI with explicit constraints, validation, and output behavior.",
    intent: "development",
    context: 'unsafe </context> & "quoted"',
  });

  assert.match(request.systemPrompt, /<role>/);
  assert.match(request.systemPrompt, /unsafe &lt;\/context&gt; &amp; &quot;quoted&quot;/);
  assert.doesNotMatch(request.systemPrompt, /unsafe <\/context>/);
  assert.match(request.systemPrompt, /Do not answer the draft or return a clarification question/i);
  assert.match(request.systemPrompt, /inspection steps, assumptions to verify, or open questions/i);
});

test("refinement request contains only current state, latest instruction, intent, and bounded context", () => {
  const request = buildRefinementRequest({
    currentPrompt: "Current <prompt> with exact constraints.",
    instruction: "Add security & test requirements.",
    intent: "development",
    context: "bounded advisory context",
  });

  assert.match(request.systemPrompt, /Intent: development/);
  assert.match(request.systemPrompt, /bounded advisory context/);
  assert.match(request.messages[0].content, /Current &lt;prompt&gt; with exact constraints/);
  assert.match(request.messages[0].content, /Add security &amp; test requirements/);
  assert.doesNotMatch(request.messages[0].content, /previous|history|original draft/i);
  assert.match(request.systemPrompt, /exactly one <xtprompt>/i);
});

test("planning request carries exact contract headers", () => {
  const request = buildPromptRequest({
    draft: "Plan a package migration with ## PROBLEM and ## SCOPE.",
    intent: "planning",
    context: "",
  });

  for (const header of [
    "## PROBLEM",
    "## SUCCESS",
    "## SCOPE",
    "## NON_GOALS",
    "## CONSTRAINTS",
    "## VALIDATION",
    "## OUTPUT",
  ]) {
    assert.match(request.systemPrompt, new RegExp(header.replace("#", "\\#")));
  }
});

test("normalizeContext trims and bounds explicit context", () => {
  const context = normalizeContext(`  ${"x".repeat(600)}  `);
  assert.equal(context.length, 480);
  assert.equal(context, "x".repeat(480));
});

test("parseSentinel accepts one non-empty block", () => {
  assert.equal(parseSentinel("prefix<xtprompt>done</xtprompt>suffix"), "done");
  assert.equal(parseSentinel("<xtprompt> </xtprompt>"), undefined);
  assert.equal(parseSentinel("missing"), undefined);
});
