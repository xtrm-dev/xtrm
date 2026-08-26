/**
 * Identity & mutation-provenance slice tests (xtrm-c4z).
 *
 * Mercury actor ids appear here as FIXTURES ONLY — the contracts under test
 * are project-neutral and contain zero project-specific constants.
 */

import { describe, test, expect } from "bun:test";
import {
  PRINCIPAL_SET_SCHEMA_VERSION,
  ACTOR_SCHEMA_VERSION,
  EXECUTION_SCHEMA_VERSION,
  ProvenanceEnvelopeSchema,
  type Actor,
  type PrincipalSet,
} from "../src/identity/schemas.ts";
import {
  assembleProvenance,
  bindPlatformResult,
  computeEnvelopeHash,
  findCallerIdentityKeys,
  MutationPayloadSchema,
  sealEnvelope,
} from "../src/identity/context.ts";
import {
  compactAttributionLine,
  githubTrailers,
  jiraCommentProjection,
  renderAuthorityRef,
} from "../src/identity/projection.ts";
import {
  containsSecretMaterial,
  legacyUnattributedEnvelope,
  validateMutation,
} from "../src/identity/validation.ts";

// ---------------------------------------------------------------- fixtures

const sha = (s: string) =>
  `sha256:${Array.from(new Bun.CryptoHasher("sha256").update(s).digest("hex")).join("")}`;

const PRINCIPAL_SET: PrincipalSet = {
  schema_version: PRINCIPAL_SET_SCHEMA_VERSION,
  principal_set_id: "xtrm-web",
  kind: "shared_web_connector",
  bindings: [
    { system: "github", principal_type: "user", immutable_account_id: null, display_name: "XTRM Web" },
    { system: "jira", principal_type: "user", immutable_account_id: null, display_name: "XTRM Web" },
  ],
  shared_by: ["environment == web"],
  credential_storage: "external_connector",
};

function makeActor(actorId: string): Actor {
  return {
    schema_version: ACTOR_SCHEMA_VERSION,
    actor_id: actorId,
    actor_kind: "coordinator",
    parent_actor_id: null,
    policy_profile: `${actorId}-policy`,
    allowed_principal_sets: ["xtrm-web"],
    authority_source: "programme-agent-contract",
  };
}

const EXEC_BASE = {
  schema_version: EXECUTION_SCHEMA_VERSION,
  execution_id: "exec-test-0001",
  attempt: 1,
  actor_id: "mercury/program-coordinator-web",
  principal_set_id: "xtrm-web",
  assignment_id: "OPS-TEST",
  assignment_version: 3,
  participant_id: "test-participant",
  parent_execution_id: null,
  runtime_session_id: "session-redacted",
  generation: 1,
  authority_ref: "jira:ISSUE-T:comment:123",
  policy_digest: sha("policy"),
  toolchain_digest: sha("toolchain"),
};

function ctxFor(actor: Actor, overrides: Record<string, unknown> = {}) {
  return { actor, principal_set: PRINCIPAL_SET, execution: { ...EXEC_BASE, ...overrides } };
}

const PAYLOAD = {
  content: "hello provenance world",
  target: { kind: "jira_comment", issue: "ISSUE-T" },
};

const CFG = () => ({
  registry: {
    "mercury/program-coordinator-web": makeActor("mercury/program-coordinator-web"),
    "mercury/hive-research-web": makeActor("mercury/hive-research-web"),
  },
  principalSets: { "xtrm-web": PRINCIPAL_SET },
});

function jiraBinding() {
  return { system: "jira" as const, principal_type: "user" as const, immutable_account_id: null, display_name: "XTRM Web" };
}

function assembledEnv() {
  const env = assembleProvenance(
    ctxFor(makeActor("mercury/program-coordinator-web")),
    PAYLOAD,
    { authorship_mode: "xtrm_web_direct", binding: jiraBinding() },
  );
  return env;
}

// ------------------------------------------------------------------ tests

describe("principal-set / actor cardinality", () => {
  test("two distinct web actors share one xtrm-web principal set", () => {
    const a1 = assembleProvenance(ctxFor(makeActor("mercury/program-coordinator-web")), PAYLOAD, {
      authorship_mode: "xtrm_web_direct",
      binding: jiraBinding(),
    });
    const a2 = assembleProvenance(ctxFor(makeActor("mercury/hive-research-web"), { execution_id: "exec-test-0002" }), PAYLOAD, {
      authorship_mode: "xtrm_web_direct",
      binding: jiraBinding(),
    });
    expect(a1.principal_set_id).toBe("xtrm-web");
    expect(a2.principal_set_id).toBe("xtrm-web");
    expect(a1.actor_id).not.toBe(a2.actor_id);
    for (const e of [a1, a2]) expect(ProvenanceEnvelopeSchema.safeParse(e).success).toBe(true);
  });

  test("actor outside allowed_principal_sets fails closed at assembly", () => {
    const outsider: Actor = { ...makeActor("other/rogue-web"), allowed_principal_sets: ["some-other-set"] };
    expect(() =>
      assembleProvenance(ctxFor(outsider), PAYLOAD, {
        authorship_mode: "xtrm_web_direct",
        binding: jiraBinding(),
      }),
    ).toThrow(/principal_set_not_allowed/);
  });
});

describe("trusted runtime context boundary", () => {
  test("caller cannot smuggle identity fields into the payload", () => {
    const smuggled = { ...PAYLOAD, actor_id: "mercury/hive-research-web", receipt_id: "xpr-fake" };
    expect(findCallerIdentityKeys(smuggled).sort()).toEqual(["actor_id", "receipt_id"]);
    expect(() => MutationPayloadSchema.parse(smuggled)).toThrow();
    expect(() =>
      assembleProvenance(ctxFor(makeActor("mercury/program-coordinator-web")), smuggled, {
        authorship_mode: "xtrm_web_direct",
        binding: jiraBinding(),
      }),
    ).toThrow(/caller_identity_assertion/);
  });

  test("impersonation via payload edit fails validation against registry", () => {
    const env = assembledEnv();
    // attacker edits the envelope's actor field without recomputing integrity
    const tampered = { ...env, actor_id: "mercury/hive-research-web" } as typeof env;
    const res = validateMutation(tampered, CFG());
    expect(res.ok).toBe(false);
    expect(res.failures.map((f) => f.code)).toContain("envelope_hash_mismatch");
  });

  test("model/provider identity never appears anywhere in the contracts", () => {
    const env = assembledEnv();
    const rendered = JSON.stringify(env) + compactAttributionLine(env) + githubTrailers(env).join("\n");
    expect(rendered.includes("model")).toBe(false);
    expect(rendered.toLowerCase().includes("provider")).toBe(false);
  });
});

describe("authorship modes and attribution honesty", () => {
  test("human_direct and xtrm_web_direct remain distinguishable", () => {
    const human = assembleProvenance(ctxFor(makeActor("mercury/program-coordinator-web")), PAYLOAD, {
      authorship_mode: "human_direct",
      binding: jiraBinding(),
    });
    const web = assembledEnv();
    expect(human.authorship_mode).toBe("human_direct");
    expect(web.authorship_mode).toBe("xtrm_web_direct");
    expect(human.authorship_mode).not.toBe(web.authorship_mode);
  });

  test("unsigned envelope cannot claim xtrm_attested", () => {
    const unsigned = { ...assembledEnv(), attribution_strength: "xtrm_attested" as const };
    const parsed = ProvenanceEnvelopeSchema.safeParse(unsigned);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => /xtrm_attested requires signer/.test(i.message))).toBe(true);
    }
  });

  test("legacy history stays legacy_unattributed — never a guessed actor", () => {
    const legacy = legacyUnattributedEnvelope({
      cursor: "jira-comment-999",
      principal_set_id: "xtrm-web",
      principal_binding: jiraBinding(),
      assignment_id: "OPS-TEST",
      assignment_version: 1,
      participant_id: "unknown-pre-xtrm",
      authority_ref: "jira:ISSUE-T:comment:999",
      target_kind: "jira_comment",
      content_sha256: sha("old comment body"),
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const parsed = ProvenanceEnvelopeSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    expect(legacy.actor_id).toBeNull();
    expect(legacy.attribution_strength).toBe("unattributed");
    // guessing an actor onto a legacy envelope is structurally invalid
    const guessed = { ...legacy, actor_id: "mercury/program-coordinator-web" };
    expect(ProvenanceEnvelopeSchema.safeParse(guessed).success).toBe(false);
    // and it validates cleanly (no further checks possible)
    expect(validateMutation(legacy, CFG()).ok).toBe(true);
  });
});

describe("retry semantics", () => {
  test("retry mints a new attempt; participant identity is stable", () => {
    const first = assembleProvenance(
      ctxFor(makeActor("mercury/program-coordinator-web"), { execution_id: "exec-a", attempt: 1 }),
      PAYLOAD,
      { authorship_mode: "xtrm_web_direct", binding: jiraBinding() },
    );
    const retried = assembleProvenance(
      ctxFor(makeActor("mercury/program-coordinator-web"), {
        execution_id: "exec-b",
        attempt: 2,
        parent_execution_id: "exec-a",
      }),
      PAYLOAD,
      { authorship_mode: "xtrm_web_direct", binding: jiraBinding() },
    );
    expect(retried.execution_id).not.toBe(first.execution_id);
    expect(first.participant_id).toBe(retried.participant_id);
    expect(retried.parent_execution_id).toBe("exec-a");
  });
});

describe("content and platform-result binding", () => {
  test("tampered content fails validation", () => {
    const env = assembledEnv();
    const res = validateMutation(env, CFG(), { content: "tampered!" });
    expect(res.ok).toBe(false);
    expect(res.failures.map((f) => f.code)).toContain("content_hash_mismatch");
    const good = validateMutation(env, CFG(), { content: PAYLOAD.content });
    expect(good.ok).toBe(true);
  });

  test("platform result binds external id; conflicting rebind fails closed", () => {
    let env = assembledEnv();
    expect(env.target.external_id).toBeNull();
    env = bindPlatformResult(env, { system: "jira", external_id: "cmt-777" });
    expect(env.target.external_id).toBe("cmt-777");
    expect(ProvenanceEnvelopeSchema.safeParse(env).success).toBe(true);
    // uncertain side effect observed twice with different ids -> reconcile, not retry
    expect(() => bindPlatformResult(env, { system: "jira", external_id: "cmt-888" })).toThrow(/rebind_conflict/);
  });

  test("binding through the wrong platform system fails closed", () => {
    const env = assembledEnv();
    expect(() => bindPlatformResult(env, { system: "github", external_id: "r1" })).toThrow(/binding_system_mismatch/);
  });

  test("assignment version mismatch fails closed", () => {
    const env = assembledEnv();
    const res = validateMutation(env, { ...CFG(), expected: { assignment_version: 4 } });
    expect(res.failures.map((f) => f.code)).toContain("assignment_mismatch");
  });
});

describe("projection rendering", () => {
  const env = assembledEnv();

  test("compact line names actor, execution and authority", () => {
    const line = compactAttributionLine(env);
    expect(line).toMatch(/^XTRM actor: mercury\/program-coordinator-web · execution: exec-test-0001 · authority: ISSUE-T#123$/);
  });

  test("authority ref renderer handles github refs and passes unknown shapes through", () => {
    expect(renderAuthorityRef("github:o/r:comment:42")).toBe("o/r#42");
    expect(renderAuthorityRef("weird-ref")).toBe("weird-ref");
  });

  test("github trailers carry the full attribution set", () => {
    const trailers = githubTrailers(env);
    expect(trailers).toEqual([
      "XTRM-Actor: mercury/program-coordinator-web",
      "XTRM-Principal-Set: xtrm-web",
      "XTRM-Execution: exec-test-0001",
      "XTRM-Assignment: OPS-TEST@3",
      "XTRM-Authority: jira:ISSUE-T:comment:123",
      `XTRM-Receipt: ${env.receipt_id}`,
    ]);
    expect(githubTrailers({ ...env, authorship_mode: "legacy_unattributed" } as typeof env)).toEqual([
      "XTRM-Provenance: legacy_unattributed",
    ]);
  });

  test("jira projection: property path attests, fallback path downgrades honestly", () => {
    const withProp = jiraCommentProjection(env, "visible text", { propertiesSupported: true });
    expect(withProp.property?.name).toBe("xtrm.provenance");
    expect(withProp.classification).toBe("self_attested_web"); // unsigned envelope
    expect(withProp.body.startsWith(compactAttributionLine(env))).toBe(true);

    const withoutProp = jiraCommentProjection(env, "visible text", { propertiesSupported: false });
    expect(withoutProp.property).toBeUndefined();
    expect(withoutProp.classification).toBe("self_attested_web");
    expect(withoutProp.body).toContain(`receipt=${env.receipt_id}`);
  });
});

describe("secret hygiene", () => {
  test("envelope of normal content contains no secret material", () => {
    const env = assembledEnv();
    expect(containsSecretMaterial(env)).toBe(false);
  });

  test("secret-bearing payload content is detected by the hygiene scan", () => {
    const SECRET = "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    const leaked = assembleProvenance(
      ctxFor(makeActor("mercury/program-coordinator-web")),
      { ...PAYLOAD, content: SECRET },
      { authorship_mode: "xtrm_web_direct", binding: jiraBinding() },
    );
    // the envelope itself carries only the content HASH — raw secret absent
    expect(containsSecretMaterial(leaked)).toBe(false);
    expect(JSON.stringify(leaked).includes("ghp_")).toBe(false);
    // publishing secret-bearing observed content fails closed
    expect(containsSecretMaterial(leaked, { content: SECRET })).toBe(true);
    const res = validateMutation(leaked, CFG(), { content: SECRET });
    expect(res.failures.map((f) => f.code)).toContain("secret_material_detected");
  });

  test("rendered projections leak no secret when content is clean", () => {
    const proj = jiraCommentProjection(assembledEnv(), "clean visible", { propertiesSupported: false });
    expect(proj.body + JSON.stringify(proj)).not.toMatch(/gh[pousr]_|ATATT|Bearer\s/);
  });
});

describe("review findings — integrity coverage (M1)", () => {
  test("swapping the signature trips envelope_hash_mismatch", () => {
    const env = assembledEnv();
    const swapped = {
      ...env,
      integrity: { ...env.integrity, signature: "sig-swapped" },
    };
    const res = validateMutation(swapped, CFG());
    expect(res.ok).toBe(false);
    expect(res.failures.map((f) => f.code)).toContain("envelope_hash_mismatch");
  });

  test("hash differs when signer/signature differ", () => {
    const env = assembledEnv();
    const a = computeEnvelopeHash({ ...env, integrity: { ...env.integrity, signature: "one" } });
    const b = computeEnvelopeHash({ ...env, integrity: { ...env.integrity, signature: "two" } });
    expect(a).not.toBe(b);
  });
});

describe("review findings — attribution honesty (M2)", () => {
  test("legacy envelope projects as unattributed on both jira paths", () => {
    const legacy = legacyUnattributedEnvelope({
      cursor: "jira-comment-1000",
      principal_set_id: "xtrm-web",
      principal_binding: jiraBinding(),
      assignment_id: "OPS-TEST",
      assignment_version: 1,
      participant_id: "unknown-pre-xtrm",
      authority_ref: "jira:ISSUE-T:comment:1000",
      target_kind: "jira_comment",
      content_sha256: sha("old body"),
      created_at: "2026-01-02T00:00:00.000Z",
    });
    expect(compactAttributionLine(legacy)).toMatch(/^XTRM provenance: legacy_unattributed/);
    const withProp = jiraCommentProjection(legacy, "v", { propertiesSupported: true });
    expect(withProp.classification).toBe("unattributed");
    const withoutProp = jiraCommentProjection(legacy, "v", { propertiesSupported: false });
    expect(withoutProp.classification).toBe("unattributed");
  });

  test("signed xtrm_attested envelope downgrades honestly on fallback path only", () => {
    const signed = sealEnvelope({
      ...assembledEnv(),
      attribution_strength: "xtrm_attested",
      integrity: { envelope_sha256: "", signer: "xtrm-attest", signature: "sig" },
    } as never);
    expect(signed.attribution_strength).toBe("xtrm_attested");
    const propPath = jiraCommentProjection(signed, "v", { propertiesSupported: true });
    expect(propPath.classification).toBe("xtrm_attested");
    const fallback = jiraCommentProjection(signed, "v", { propertiesSupported: false });
    expect(fallback.classification).toBe("self_attested_web");
  });
});

describe("review findings — re-seal laundering path (M3)", () => {
  test("bindPlatformResult refuses a forged envelope whose hash does not verify", () => {
    const env = assembledEnv();
    const forged = { ...env, execution_id: "exec-forged", assignment_id: "FORGED" } as typeof env;
    expect(() => bindPlatformResult(forged, { system: "jira", external_id: "cmt-1" })).toThrow(
      /envelope_hash_mismatch/,
    );
  });

  test("sealEnvelope refuses to re-seal a tampered already-sealed envelope", () => {
    const env = assembledEnv();
    const tampered = { ...env, actor_id: "mercury/hive-research-web" } as typeof env;
    expect(() => sealEnvelope(tampered)).toThrow(/envelope_hash_mismatch/);
  });
});

describe("review findings — validation coverage gaps", () => {
  test("assignment_id mismatch fails closed", () => {
    const res = validateMutation(assembledEnv(), { ...CFG(), expected: { assignment_id: "OPS-OTHER" } });
    expect(res.failures.map((f) => f.code)).toContain("assignment_mismatch");
  });

  test("binding account mismatch fails closed when both ids are present and differ", () => {
    const env = {
      ...assembledEnv(),
      principal_binding: { ...jiraBinding(), immutable_account_id: "acct-ENVELOPE" },
    } as ReturnType<typeof assembledEnv>;
    // recompute integrity for the mutated binding so ONLY the config disagrees
    const resealed = sealEnvelope({ ...env, integrity: { ...env.integrity, envelope_sha256: "" } } as never);
    const cfgWithAccounts = {
      registry: CFG().registry,
      principalSets: {
        "xtrm-web": {
          ...PRINCIPAL_SET,
          bindings: [{ ...jiraBinding(), immutable_account_id: "acct-REAL" }],
        },
      },
    };
    const res = validateMutation(resealed, cfgWithAccounts);
    expect(res.ok).toBe(false);
    expect(res.failures.map((f) => f.code)).toContain("binding_account_mismatch");
  });

  test("cutoverComplete rejects null account-id bindings post-cutover", () => {
    const env = assembledEnv(); // binding.immutable_account_id = null
    const postCutoverCfg = {
      registry: CFG().registry,
      principalSets: {
        "xtrm-web": {
          ...PRINCIPAL_SET,
          bindings: [{ ...jiraBinding(), immutable_account_id: "acct-REAL" }],
        },
      },
      cutoverComplete: true,
    };
    const res = validateMutation(env, postCutoverCfg);
    expect(res.failures.map((f) => f.code)).toContain("binding_account_mismatch");
    // pre-cutover config without the flag stays tolerant (migration window)
    expect(validateMutation(env, CFG()).ok).toBe(true);
  });

  test("cutoverComplete also flags trusted config that still carries null ids", () => {
    const env = assembledEnv(); // envelope binding account id = null
    const staleConfigCutover = {
      ...CFG(),
      cutoverComplete: true,
    };
    const res = validateMutation(env, staleConfigCutover);
    expect(res.ok).toBe(false);
    expect(res.failures.map((f) => f.code)).toContain("binding_account_mismatch");
  });

  test("unknown principal set fails closed", () => {
    const env = assembledEnv();
    const res = validateMutation(env, { registry: CFG().registry, principalSets: {} });
    expect(res.failures.map((f) => f.code)).toContain("principal_set_unknown");
  });

  test("blank authority_ref fails closed even when hash is consistent", () => {
    const env = assembledEnv();
    const blank = {
      ...env,
      authority_ref: " ",
      integrity: { ...env.integrity, envelope_sha256: "" },
    } as typeof env;
    blank.integrity.envelope_sha256 = computeEnvelopeHash(blank);
    const res = validateMutation(blank, CFG());
    expect(res.ok).toBe(false);
    expect(res.failures.map((f) => f.code)).toContain("authority_ref_missing");
  });

  test("assembly rejects legacy authorship mode outright", () => {
    expect(() =>
      assembleProvenance(ctxFor(makeActor("mercury/program-coordinator-web")), PAYLOAD, {
        authorship_mode: "legacy_unattributed" as never,
        binding: jiraBinding(),
      }),
    ).toThrow(/legacy_unattributed_not_assemblable/);
  });

  test("fine-grained PATs and bare token= are detected by hygiene scan", () => {
    const patEnv = assembleProvenance(
      ctxFor(makeActor("mercury/program-coordinator-web")),
      { ...PAYLOAD, content: "github_pat_11AAAAAAA01234567890_abcdefghijklmnopqrstuvwxyz1234567890" },
      { authorship_mode: "xtrm_web_direct", binding: jiraBinding() },
    );
    expect(validateMutation(patEnv, CFG(), { content: "github_pat_11AAAAAAA01234567890_abcdefghijklmnopqrstuvwxyz1234567890" })
      .failures.map((f) => f.code))
      .toContain("secret_material_detected");

    const tokEnv = assembleProvenance(
      ctxFor(makeActor("mercury/program-coordinator-web")),
      { ...PAYLOAD, content: "token=abcdef123456" },
      { authorship_mode: "xtrm_web_direct", binding: jiraBinding() },
    );
    expect(
      validateMutation(tokEnv, CFG(), { content: "token=abcdef123456" }).failures
        .map((f) => f.code),
    ).toContain("secret_material_detected");
  });

  test("receipt ids carry >=64 bits of entropy", () => {
    const env = assembledEnv();
    expect(env.receipt_id).toMatch(/^xpr-[0-9a-f]{16}$/);
  });
});
