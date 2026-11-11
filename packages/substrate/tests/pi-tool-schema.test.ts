// Pi 1.5 tool-argument contract (XTRM-743).
//
// Pi 1.5.0 moved tool-argument validation to @earendil-works/pi-schema and
// pi-ai stopped re-exporting TypeBox ("Tool argument validation runs on
// @earendil-works/pi-schema... TypeBox features outside JSON Schema no longer
// apply"). This test loads the extension the way a plain Node process does —
// no Pi loader aliasing — so an import of `Type` from pi-ai fails here, and it
// validates every registered schema with the validator Pi 1.5 uses.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile } from "@earendil-works/pi-schema";
import registerSubstrate from "../integrations/pi/extension.ts";
import { EXPECTED_SUBSTRATE_TOOLS } from "../integrations/pi-load-check.ts";

interface RegisteredTool {
  name: string;
  parameters: Record<string, unknown>;
}

/** Load the extension factory against a minimal ExtensionAPI surface. */
function registeredTools(): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const pi = {
    registerTool(tool: RegisteredTool) {
      tools.set(tool.name, tool);
    },
    registerCommand() {},
    on() {},
  };
  registerSubstrate(pi as never);
  return tools;
}

/** A minimal valid argument object per tool, keyed by tool name. */
const VALID_ARGS: Record<string, Record<string, unknown>> = {
  substrate_issue_get: { ref: "XTRM-743" },
  substrate_issue_search: { project: "prj_xtrm" },
  substrate_issue_claim: { ref: "XTRM-743", holder: "pi152-xtrm" },
  substrate_issue_update: { ref: "XTRM-743", contract: { PROBLEM: "p" } },
  substrate_journal_append: { ref: "XTRM-743", kind: "note", summary: "text" },
  substrate_journal_checkpoint: { ref: "XTRM-743", headCommit: "714fc4a" },
  substrate_issue_resume: { ref: "XTRM-743" },
  substrate_provenance_trace: { ref: "XTRM-743" },
};

describe("Pi 1.5 tool-argument contract (XTRM-743)", () => {
  it("registers the 8 substrate tools with plain Node module resolution", () => {
    const tools = registeredTools();
    assert.deepEqual([...tools.keys()].sort(), [...EXPECTED_SUBSTRATE_TOOLS].sort());
  });

  it("has a sample argument object for every registered tool", () => {
    for (const name of registeredTools().keys()) {
      assert.ok(VALID_ARGS[name], `add valid arguments for ${name} to VALID_ARGS`);
    }
  });

  it("compiles every tool schema and accepts valid arguments under pi-schema", () => {
    for (const [name, tool] of registeredTools()) {
      const validator = compile(tool.parameters, { coerce: true });
      const result = validator.parse(VALID_ARGS[name]);
      assert.equal(result.ok, true, `${name} rejected valid arguments: ${JSON.stringify(result)}`);
    }
  });

  it("reports missing required fields in pi-schema's message format", () => {
    const tool = registeredTools().get("substrate_issue_get");
    assert.ok(tool);
    const validator = compile(tool.parameters, { coerce: true });
    const result = validator.parse({});
    assert.equal(result.ok, false, "an empty argument object must be rejected");
    if (result.ok) return;
    assert.deepEqual(
      result.errors.map((error) => `- ${error.path.slice(1)}: ${error.message}`),
      ["- ref: missing"],
    );
  });
});
