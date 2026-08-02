# KAN-127 — XT Codex Execution Note

**Status:** current sequencing companion  
**Last reconciled:** 2026-08-02, Europe/Rome  
**Jira mirror:** `KAN-127`  
**Authoritative executable graph:** repository-local Beads epic `xtrm-ozknq` and companion roots  
**Programme mapping:** `A1.5 — XT Codex parity` in `xtrm-current-execution-plan.md`

## 1. Role of this note

KAN-127 is the existing portfolio mirror for XT Codex runtime integration. It replaces the provisional “create XT Codex runtime integration if not already mirrored” action in the Jira reconciliation plan.

This note corrects the provisional Track A–G ordering in KAN-127. It does not replace the detailed product decisions in that issue, the Beads contracts, repository code, or the programme-wide deterministic interface gates.

The initiative is a harness/runtime integration lane. It is not part of the chain compiler, `ResolvedChain`, `specialists.execution.v1`, or the deterministic chain reducer. It consumes those systems later where useful; it does not wait for them to exist before capability audit and bounded prototyping.

## 2. Accepted product decisions

The following KAN-127 decisions remain authoritative unless repository evidence invalidates them:

- behavioral parity with `xt claude`, not mechanical asset parity;
- a distinct `codex` runtime descriptor, never a Claude/Pi alias or an `openai-codex/...` model spelling;
- Core owns interactive launch, worktree, installation and managed configuration;
- xtmux owns pane/session identity, lifecycle, messages, obligations, monitors and wakes;
- Specialists owns Specialist role/job/result semantics;
- Beads owns task contracts and acceptance; Git owns integration truth;
- no Codex-native subagent system in the managed XTRM profile;
- managed YOLO default and explicit `--no-yolo` safety profile;
- hook trust must never be bypassed by the managed profile;
- `AGENTS.md`, `.agents/skills` and `$skill-name` are the Codex-facing instruction/skill surfaces;
- adapters consume authoritative CLI outcomes and exact argv actions; they do not create private state;
- one worktree owner per operation;
- Pi-only extensible workflows remain outside Codex parity.

## 3. Corrections to the Jira description

### 3.1 MCP and plugin packaging are not parity prerequisites

Minimum parity requires managed configuration ownership and proof that XTRM does not damage unowned Codex configuration. It does not require installing an XTRM MCP bundle or selecting a plugin packaging strategy.

Required before parity release:

- deterministic `.codex` ownership, status, repair and uninstall behavior;
- explicit preservation of unowned configuration;
- a structured record of the selected safety profile;
- proof that hook trust remains enabled.

Follow-up unless a measured operator outcome requires it:

- Codex plugin bundle;
- managed MCP server distribution;
- browser/apps/connectors;
- goals;
- review and structured-exec products.

A zero-server audited environment must not be turned into an MCP rollout requirement by implication.

### 3.2 Serena cleanup is a bounded companion lane

Serena must remain absent from Claude/Codex parity behavior. Cleanup that directly conflicts with runtime declarations, managed permissions, hooks, policies, install/update behavior or active documentation is a prerequisite for the affected slice.

Historical cleanup, broad test deletion and unrelated Pi/Specialists `pi-serena-tools` decisions are not allowed to hold the first Codex vertical slice or `GATE-IFACE` hostage.

### 3.3 xtmux work extends adapters, not authority

xtmux already owns durable messages, obligations, monitors, wakes, runtime identity and existing Codex lifecycle observation. KAN-127 must add or correct Codex-specific event adapters, payload fixtures, turn capture and recovery integration over those state machines.

It must not introduce:

- a Codex-specific message store;
- a Codex-specific monitor/wake registry;
- a second session identity;
- a second lifecycle authority;
- a Codex-specific scheduler.

### 3.4 Dated versions are evidence, not live authority

The Codex and Claude versions recorded in KAN-127 are dated audit inputs. Every implementation pickup must record:

- installed version;
- executable path/source;
- relevant configuration roots;
- repository heads and release cuts;
- payload fixtures captured from that exact version.

Version drift triggers a focused compatibility recheck, not an automatic redesign.

### 3.5 Design inputs must be directly resolvable

A web agent cannot treat `~/dev/xtrm/docs/shared/...` as a durable reference. Beads descriptions and Jira comments must link the owning repository and path, and should pin the reviewed commit where a decision depends on exact text.

## 4. Corrected executable phases

### K0 — freshness, authority and existing-graph reconciliation

**Owners:** Core coordinator plus repository-local Beads coordinators.

1. Read `xtrm-ozknq` and evidence children `.1`, `.2`, `.3`.
2. Refresh Core, Specialists and xtmux heads, releases and relevant open work.
3. Record the exact installed Codex and Claude versions and configuration roots.
4. Reconcile existing Beads before creating children.
5. Replace provisional Jira-only assumptions with Git/Beads evidence.

**Exit:** one accepted ownership map, one dated capability ledger, no duplicate executable graph.

### K1 — characterization and contract boundary

**Primary owner:** Core.  
**Companions:** xtmux and Specialists read-only audits.

1. Characterize released `xt claude` and `xt pi` launcher behavior before shared refactoring.
2. Capture real Codex lifecycle and hook payload fixtures for the installed version.
3. Define the separate runtime descriptor boundary.
4. Define safety-profile, thread/session identity, readiness, failure cleanup and worktree-ownership contracts.
5. Inventory current human/JSON output, stdout/stderr and exit-code seams.
6. Identify the smallest shared command-outcome contract needed by all three harnesses.

**Exit:** approved compatibility ADR and load-bearing fixtures. No public production `xt codex` claim.

### K2 — deterministic outcome spine

**Owner:** Core contract owner.  
**Programme dependency:** consume and complete the generic launcher contract established by `I1.4`; do not make production Codex a prerequisite of `I1.4` or `GATE-IFACE`.

`I1.4` and `GATE-IFACE` are proven by released Pi/Claude behavior, the generic launcher/outcome schema and the affected public-command fixtures. KAN-127 then binds Codex to that stable contract. This separation prevents a circular gate in which `xt codex` would have to be production-ready before the gate that authorizes production harness adapters.

Define the additive launch outcome required by Codex and existing harnesses. It must carry, where applicable:

```text
schema/version
status and stable reason code
runtime and runtime version
thread/session identity
pane/session identity
worktree and branch
readiness
selected safety profile
persistence/mutation result
side effects
exact attach/resume/repair/end argv actions
```

Rules:

- no prose parsing;
- hostile-input and redaction behavior is explicit;
- retries/replays are idempotent;
- an outcome never fabricates an authoritative mutation;
- the schema is shared only when Claude, Pi and Codex would otherwise duplicate non-trivial validation.

A contract-only Core release may be required before sibling repositories consume a packaged schema. The programme `GATE-IFACE` can be reviewed and passed independently of completion of the experimental K3 Codex slices.

### K3 — parallel first vertical slices

A stable K2 candidate unlocks three repository-owned implementation roots in parallel. They may be developed and tested before the programme gate, but remain experimental until `GATE-IFACE` has passed.

#### K3-Core — experimental interactive launcher

Implement the smallest usable, non-promoted `xt codex` slice:

- distinct runtime descriptor;
- worktree/branch creation;
- prompt, role, bead, model and skill argument resolution;
- YOLO and `--no-yolo` profiles;
- exact thread persistence/resume;
- readiness and topology metadata;
- deterministic cleanup on failed launch;
- structured launch outcome.

This slice may be exercised behind an experimental/branch-local surface. It is not a released compatibility promise before `GATE-IFACE`.

#### K3-xtmux — Codex runtime adapter

Implement only evidence-backed gaps:

- verified start/running/done/off/degraded transitions;
- stable turn capture from Codex payloads;
- Codex participation in existing message, obligation, monitor, wake and recovery flows;
- installer ownership and legacy-entry reconciliation;
- EVAL-01 Codex fixtures.

#### K3-Specialists — native Codex role surface

Implement:

- a distinct Codex render/launcher surface;
- `$skill-name` role semantics;
- role/view/render/help/model validation;
- fixtures proving separation from Pi-backed `openai-codex/...` model execution.

Direct Codex exec as a Specialist backend remains optional.

**Exit:** each repository has one reviewable vertical slice and explicit companion dependencies. No repository pretends to own another repository’s Beads leaves.

### K4 — lifecycle, managed distribution and policy completion

After the K3 contracts stabilize:

- Core: attach/resume, end, worktree list/status/doctor/cleanup, update/migrate/reset and package smoke;
- Core: `.agents/skills`, managed `AGENTS` blocks and minimal `.codex` profile ownership;
- xtmux: restart recovery, correlated replies, inbox reminder behavior and terminal cleanup through existing domains;
- Specialists: complete role invocation and result retrieval parity;
- policy/hook adapters: only payload-verified operator outcomes required for the parity release;
- owner-aware repair/uninstall for tagged entries while preserving unowned configuration.

Policy review, Serena conflict cleanup and live legacy-hook reconciliation can run in parallel where they do not change the contracts under implementation.

### K5 — Codex parity promotion after `GATE-IFACE`

Production promotion requires both:

1. the programme-wide `GATE-IFACE` has already passed for the generic harness-facing outcome contracts; and
2. the Codex-specific K3/K4 parity matrix passes against those stable contracts.

Required evidence:

- approved command-outcome and launcher contracts;
- Claude/Pi regression fixtures remain green;
- Core, Specialists and xtmux Codex fixtures agree on identity and lifecycle;
- exact resume uses the persisted Codex thread;
- YOLO/`--no-yolo` argv and recorded profile are correct;
- hook trust cannot be bypassed through managed configuration;
- install, update, drift repair and uninstall preserve unowned content;
- messages, obligations, waits, replies and end flow use existing authorities;
- failed launch and failed resume leave no false ready session or leaked worktree ownership;
- packed/global install smoke passes against compatible repository versions.

Passing K5 authorizes a production-supported `xt codex`. It does not authorize chain automation, coordinator authority or Pi workflow integration.

### K6 — ordered release wave

Preferred release order:

1. **Core contract-only release**, only if siblings require a newly packaged shared schema or fixture contract.
2. **xtmux and Specialists compatibility releases**, independently releasable and backward-compatible with the current Core line.
3. **Core launcher/integration release** pinned to or tested against the compatible sibling versions.
4. **Coordinated released-trio smoke** and current operator documentation refresh.

A repository must not release a public dependency on an unpublished sibling surface.

### K7 — optional follow-ups

After parity release and measured need:

- Codex plugin packaging;
- managed MCP bundle;
- review/structured-exec products;
- browser/apps/connectors/goals;
- direct Codex Specialist backend;
- expanded quality, memory and debug policy adapters;
- additional native capabilities that preserve the one-authority model.

## 5. Dependency graph

```text
K0
→ K1
→ K2
├── K3-Core
├── K3-xtmux
└── K3-Specialists

programme I1.4
→ programme GATE-IFACE

K3-Core + K3-xtmux + K3-Specialists
→ K4

programme GATE-IFACE + K4
→ K5 Codex parity promotion
→ K6
→ K7 optional
```

Parallel companion work after K1:

```text
bounded Serena conflict cleanup
owner-aware legacy hook reconciliation
policy truth audit
Codex payload fixture expansion
release-smoke harness preparation
```

None of those companions may silently redefine the K2 contracts.

## 6. Mapping to the programme plan

| Programme node | KAN-127 / Beads responsibility |
|---|---|
| `I1.4` | released Pi/Claude and generic Core launcher outcome contract that Codex consumes; it does not require production `xt codex` |
| `GATE-IFACE` | external prerequisite for production Codex promotion; it does not depend on production `xt codex` |
| `A1.1` | exact installed-version and capability verification |
| `A1.5` | XT Codex parity implementation and release evidence |
| `P1` | not part of KAN-127; later product surfaces consume released outcomes |
| `C1/D1/E1` | not prerequisites for first Codex parity; separate deterministic orchestration programme |

## 7. Required Beads rewrite

The web/local coordinator must revise `xtrm-ozknq` so that:

- K0–K2 are explicit predecessors rather than prose assumptions;
- K3 uses three repository-owned roots connected by companion relations;
- K4 children name exact prerequisites and release boundaries;
- the programme `GATE-IFACE` is represented as an external prerequisite, not as a child that depends on production Codex;
- K5 is a real blocked Codex-promotion gate with fixtures, not a generic final-test task;
- K6 records the cross-repository release order;
- K7 children remain non-claimable placeholders until parity is released;
- every child states owner repository, validation, negative proof and release boundary;
- no Jira child list mirrors repository-local Beads leaves.

## 8. Jira report-back

The completion comment on KAN-127 must include:

- final K0–K7 phase order;
- created/updated Beads IDs by repository;
- critical path and parallel companion lanes;
- selected shared-contract owner;
- cross-repository release order;
- unresolved operator decisions;
- immutable Git/PR evidence for the accepted graph.
