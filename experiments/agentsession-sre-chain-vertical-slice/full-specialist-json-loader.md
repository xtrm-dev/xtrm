# Full Specialist JSON loader / compiler — native AgentSession experiment

Status: experimental implementation for the AgentSession SRE vertical slice.

## Why this exists

PR #68 proved that public Pi `AgentSession` APIs are a sufficient hosting boundary for an XTRM-owned chain runtime. PR #70 then exposed the important inverse boundary: Specialist cognition is valuable, but workflow control must not remain inside a Specialist prompt. The existing `sre-coordinator` can author its own `sp` fan-out/poll loop; a silently failed child can therefore strand the coordinator. XTRM's reducer/scheduler must own scheduling, retries, stall/recovery and completion authority.

The goal here is therefore **full Specialist JSON ingestion without full legacy-runner authority**.

```text
Specialists authoring / effective spec
        ↓
lossless Zod validation
        ↓
SpecialistActivationProfile
        ↓
frozen source/effective-spec digest
        ↓
XTRM authority adaptation
        ↓
direct Pi AgentSession
```

## Verified upstream contract

The implementation was based on the current `xtrm-dev/specialists` runtime, especially:

- `src/specialist/schema.ts`
- `src/specialist/loader.ts`
- `src/specialist/task-prompt.ts`
- `src/specialist/mandatory-rules.ts`
- `src/specialist/runner.ts`
- `src/specialist/supervisor.ts`
- `src/lib.ts`

The stable `@jaggerxtrm/specialists/lib` entry point exports `SpecialistLoader`. Its `get(name)` returns the effective merged spec after the upstream package/global/repo resolution contract. **That is the preferred production source.** The local `.specialists/user` resolver implemented in this experiment exists so the bounded vertical slice can run without taking a new package dependency; it is not intended to become a competing canonical merge implementation.

Production composition should converge toward:

```ts
const upstream = new SpecialistLoader({ projectDir: targetRepo });
const profile = await compileFromEffectiveResolver(
  upstream,
  { resolver: "@jaggerxtrm/specialists/lib:SpecialistLoader", specialist_name: name },
  { targetRepo },
);
```

Upstream owns authoring-layer resolution. XTRM owns the runtime compiler and authority policy.

## Schema philosophy

`src/specialists/schema.ts` deliberately follows the current Specialist JSON shape, including metadata, execution, prompts, skills/scripts, capabilities, validation, stall detection, mandatory rules, permission tiers, output/bead settings and output-schema metadata.

The Zod objects use `.passthrough()` so a newer Specialist field is retained rather than silently erased. The loader additionally retains the raw JSON object and SHA-256 source fingerprint.

A valid JSON document does **not** imply that every field is executable by this harness. Compilation emits a feature matrix with one of:

- `native` — directly represented by the native AgentSession harness;
- `adapted` — represented, but XTRM changes the authority mechanism;
- `deferred` — retained and reported, but not executed yet;
- `rejected` — incompatible with this read-only SRE runtime.

This is intentionally stricter than a permissive compatibility loader.

## Authority boundary

A Specialist contributes cognition and declared runtime requirements. It does not gain workflow authority from its prompt.

XTRM continues to own:

- frozen chain topology;
- dispatch/readiness;
- retries and recovery;
- stall/lifecycle decisions;
- Channels routing and authority;
- evidence persistence;
- Beads ChainRun Epic and step reconciliation;
- step satisfaction;
- terminalization.

Pi owns the model session.

The Specialist owns domain cognition: system doctrine, model preferences, skill knowledge, probe/query libraries and output expectations.

`system_prompt_mode: "replace"` is therefore scoped to the Specialist cognition layer. It can never replace Pi's host/tool kernel or the XTRM authority doctrine.

## Skills

Declared `skills.paths` are resolved by the host. Folder paths resolve to `SKILL.md`; content is size-bounded, read, SHA-256 fingerprinted and injected as host-resolved cognition.

This improves on relying on model-authored `/skill:*` commands:

- missing skills fail closed by default;
- exact skill content is part of activation provenance;
- a skill can live outside the target repo while being explicitly marked as such;
- skill loading does not depend on a slash-command side effect.

Some real SRE skills (notably orchestration-oriented material such as `using-specialists`) contain instructions that belong to the legacy runtime. The final XTRM authority overlay supersedes those instructions. A later production compiler should classify cognition-only vs orchestration-only skill sections more granularly rather than blindly copying orchestration behavior.

## Scripts

`skills.scripts` are fully parsed and normalized, including the runner's legacy `path` spelling, but are **not automatically executed** by this bridge.

Arbitrary pre/post shell is host execution authority, not cognition. Production support requires an explicit registered preflight/effect capability with command identity, timeout, output bounds, evidence capture and policy. The real `sre-coordinator` quick-triage pre-script is therefore retained but currently `deferred`.

## Mandatory rules

Inline mandatory rules can be injected deterministically today.

Canonical/default/template rule sets are retained but currently `deferred` because correct behavior requires Specialists' canonical asset resolver and token-budget semantics. Missing template sets must never degrade silently. The preferred production route is to consume the already-effective upstream Specialist resolution and a shared mandatory-rule compiler, not fork those assets into XTRM.

## Capabilities

`permission_required`, permission tiers, `required_tools` and `external_commands` are retained in the compiled profile. They do not automatically enable Pi built-ins.

The SRE vertical slice keeps `noTools: "builtin"`; write-capable `MEDIUM/HIGH` profiles and non-`never` auto-commit are rejected. LOW SRE access must be satisfied through governed host tools (`sre_exec`, evidence, Channels) and an eventual structured capability resolver.

The current `sre_exec` regex boundary remains experiment-grade and does not yet provide complete parity with every shell idiom contained in the real SRE probe libraries.

## Output contracts

`prompt.output_schema`, `execution.expected_output_keys`, response/output types and legacy `output_file` are retained.

The legacy result file is a projection, never chain authority. Native step satisfaction continues to require valid governed evidence. A subsequent hardening pass should compile JSON Schema / expected keys into the evidence/result validator rather than treating assistant terminal text as authoritative.

## Frozen cognition and resume

With `--specialist-json auto|required`, a new run writes:

```text
chain/specialist-bindings.json
```

For each mapped role it freezes Specialist name, version, source path and SHA-256. On every activation/resume the source is reloaded and the binding is checked. Drift fails closed:

```text
changed Specialist JSON
  != mutate current ChainRun

changed Specialist JSON
  => new chain revision / new ChainRun
```

This extends immutable topology to the cognition definition used by that topology.

## Current SRE mapping

For the Mercury SRE vertical slice:

```text
chain-coordinator       -> sre-coordinator
explorer                -> sre-host-forensics
observability-analyst   -> sre-observability-forensics
sre-diagnostician       -> sre-change-forensics + XTRM synthesis overlay
reviewer                -> XTRM-native reviewer gate
```

The reviewer remains native because the current SRE Specialist set has no independent reviewer analogue.

The diagnostician mapping is deliberately not 1:1: change-forensics supplies the change-correlation probe library, while the XTRM role overlay requires synthesis across both upstream advisor evidence sets.

## CLI

Existing behavior remains the default:

```bash
bun run src/cli/main.ts --repo <repo> ...
```

Use the full JSON path explicitly:

```bash
bun run src/cli/main.ts \
  --repo /home/dawid/projects/mercury/infra \
  --specialist-json required \
  --incident "..."
```

Inspect one compiled Specialist without dispatching a model:

```bash
bun run scripts/inspect-specialist.ts \
  --repo /home/dawid/projects/mercury/infra \
  --name sre-host-forensics
```

## Remaining work before calling this full runtime fusion

The loader/compiler boundary is intentionally ahead of the effect surface. Still required for production-grade full fusion:

1. Compose from upstream `@jaggerxtrm/specialists/lib` `SpecialistLoader#get()` by default rather than the experiment-local direct-file resolver.
2. Shared canonical mandatory-rule/template-set resolver + budget compiler.
3. Registered/structured pre/post script execution instead of arbitrary shell.
4. Capability resolver proving every `required_tools`/`external_commands` requirement against the actual host tool contract.
5. Structured read-only SRE execution primitives with better coverage than regex + `bash -lc`.
6. Compile `output_schema` / `expected_output_keys` into authoritative evidence validation.
7. Enforce execution timeout/stall semantics in the XTRM runtime rather than relying on prompt behavior.
8. Live Mercury infra smoke using the real JSON bindings, with exact consumed/deferred feature report.

These are runtime-fusion tasks. They do not reopen the AgentSession hosting decision.
