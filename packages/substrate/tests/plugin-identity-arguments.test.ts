// The remote MCP server takes its identity from the caller's wire values only
// (XTRM-722). These tests measure the step that applies them, because that is
// where a server login shell could otherwise decide the claim holder: the ssh
// command starts the script on the store-owning machine, and `--identity` is the
// only legitimate source.
//
// The counterpart tests for the forwarded CLI live in remote-transport.test.ts,
// and the CLI/MCP/Pi resolution itself in claim-holder-default.test.ts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveClaimHolder } from "../src/domain/claim.ts";

const CONFIG_URL = new URL("../plugin/substrate/scripts/remote-config.mjs", import.meta.url).href;
const { applyIdentityArguments } = (await import(CONFIG_URL)) as {
  applyIdentityArguments: (argv?: string[]) => { holder: string | null; parsed: boolean };
};

const KEYS = ["SUBSTRATE_HOLDER", "XTRM_SESSION_ID", "SUBSTRATE_ACTIVATION_ID"] as const;

// The server process this models inherited a full identity from its login
// shell. Every case starts there, so "absent on the wire" has something to leak.
const SERVER_ENV = {
  SUBSTRATE_HOLDER: "server-holder",
  XTRM_SESSION_ID: "server-session",
  SUBSTRATE_ACTIVATION_ID: "server-activation",
};

function withServerEnv<T>(identity: Record<string, string>, fn: () => T): T {
  const prior = KEYS.map((key) => process.env[key]);
  Object.assign(process.env, SERVER_ENV);
  try {
    applyIdentityArguments(["--identity", JSON.stringify(identity), "--workspace", "/srv/checkout"]);
    return fn();
  } finally {
    KEYS.forEach((key, i) => {
      if (prior[i] === undefined) delete process.env[key];
      else process.env[key] = prior[i];
    });
  }
}

describe("the remote MCP server applies only the caller's identity (XTRM-722)", () => {
  it("(a) strips the inherited holder, so a client with none fails closed", () => {
    withServerEnv({ SUBSTRATE_HOLDER: "" }, () => {
      for (const key of KEYS) assert.equal(process.env[key], undefined, `${key} must not survive from the server's own environment`);
      assert.throws(
        () => resolveClaimHolder(undefined),
        /claim holder is required: pass the holder explicitly .*SUBSTRATE_HOLDER/s,
        "the claim refuses with the same message as the local path",
      );
    });
  });

  it("(b) applies the caller's holder over the server's own", () => {
    withServerEnv({ SUBSTRATE_HOLDER: "client-holder" }, () => {
      assert.equal(process.env["SUBSTRATE_HOLDER"], "client-holder");
      assert.equal(resolveClaimHolder(undefined).holder, "client-holder");
      assert.equal(resolveClaimHolder(undefined).source, "env");
    });
  });

  it("(c) still lets the explicit flag win over the applied environment", () => {
    withServerEnv({ SUBSTRATE_HOLDER: "client-holder" }, () => {
      const resolution = resolveClaimHolder("flag-holder");
      assert.equal(resolution.holder, "flag-holder");
      assert.equal(resolution.source, "flag");
    });
  });
});
