# XTRM CLI Actionable Outcomes and Deterministic Follow-up Contract

**Status:** proposal for independent verification and decomposition
**Date:** 24 July 2026
**Program relationship:** independent from the Specialists modernization roadmap and from `xtrm-wiy5n`; may later be referenced by them
**Primary repository:** `Jaggerxtrm/xtmux`
**Companion repositories:** `xtrm-dev/specialists`, `xtrm-dev/core`
**Working contract name:** `xtrm.command-outcome.v1`

---

## 1. Purpose

The XTRM command-line surfaces are authoritative and broadly reusable, but many successful mutations still leave the caller responsible for reconstructing the next operation from documentation or prompt memory.

The most fragile example is coordination:

```text
message-send
→ inspect the JSON result
→ determine whether a reply is required
→ preserve the message key
→ identify requester and target correctly
→ create or verify a fresh requester-owned monitor
→ remember the exact wait/read command
→ distinguish receipt from fulfilment
```

This is brittle for humans and agents. Harness-specific hooks and extensions currently compensate for part of the sequence, but they depend on output parsing, exact command shape and repeated instructions.

The target is not a chatty CLI. The target is a deterministic mutation contract:

```text
perform mutation
→ state exactly what happened
→ state why it succeeded, failed or degraded
→ return stable identifiers
→ return zero or more exact next actions
```

This program improves the CLI itself before any Claude MCP or Pi-native adapter is built. The adapters described in the companion document must consume this contract rather than recreate command semantics.

---

## 2. Core decision

Every relevant **mutation** in `xtmux`, `sp` and `xt` should emit a structured outcome that contains:

* terminal status;
* stable reason code;
* bounded human summary;
* identifiers produced or affected;
* whether the requested durable state was persisted;
* whether dependent side effects completed;
* exact required or recommended next actions;
* executable argv arrays in JSON;
* human-readable command rendering outside JSON.

Queries remain clean data surfaces. A successful read-only query must not gain a generic “success” banner that breaks Unix composition.

The preferred behavior is:

```text
query
→ clean data / existing human rendering

mutation
→ explicit outcome + reason + next actions

failure
→ explicit reason + remediation + non-zero exit
```

---

## 3. Ponytail constraints

This work follows the project’s Ponytail discipline.

1. Reuse existing command handlers, SQLite operations, obligations and monitor machinery.
2. Do not create a generic workflow engine, command framework or remediation DSL.
3. Do not wrap every command merely for aesthetic consistency.
4. Add the common outcome type only after inventory proves at least two real consumers.
5. Prefer additive JSON fields over a breaking envelope migration.
6. Prefer one formatter/helper in the owning repository over repeated bespoke messages.
7. Do not make a success path depend on parsing prose.
8. Do not add a daemon. Existing durable reconciliation remains the correctness backstop.
9. Leave one focused runnable contract test for every non-trivial outcome branch.
10. Mark deliberate ceilings with a `ponytail:` comment and the condition that would justify expansion.

---

## 4. Current evidence and known boundaries

At the verified snapshot:

* Core is released as `xtrm-tools` 0.11.2.
* xtmux is released as `@jaggerxtrm/xtmux` 0.2.2.
* Specialists is released as `@jaggerxtrm/specialists` 3.21.1, with later source-only work.
* xtmux already owns durable messages, reply obligations, monitors, wakes, exact message retrieval and completed-turn retrieval.
* the local audit requires Pi monitor correctness to become obligation-driven and FYI-safe;
* `message-ack` remains receipt, not fulfilment;
* durable sender-owned obligation reconciliation is the correctness authority when immediate monitor arming misses;
* Claude and Pi currently have separate automation paths around the same xtmux state.

These claims must be revalidated against HEAD before planning. This document does not freeze implementation details observed on 24 July.

---

## 5. Candidate command-outcome contract

This section is a candidate design to test during Phase 1, not a pre-approved implementation.

### 5.1 Status vocabulary

```text
ok
degraded
noop
rejected
failed
```

Interpretation:

* `ok`: requested authoritative mutation and required immediate side effects completed;
* `degraded`: authoritative mutation completed, but a recoverable dependent action did not;
* `noop`: command was valid, but the target state was already satisfied;
* `rejected`: precondition or policy prevented mutation before the authoritative write;
* `failed`: attempted authoritative operation failed or its state is uncertain.

Do not overload existing job or monitor status enums with these command-level statuses.

### 5.2 JSON shape

Preferred additive shape when existing command JSON must remain compatible:

```json
{
  "messageKey": "msg_01J...",
  "obligationId": "obl_01J...",
  "monitorId": "mon_01J...",
  "_outcome": {
    "schema_version": "xtrm.command-outcome.v1",
    "status": "ok",
    "reason_code": "message_persisted_monitor_armed",
    "summary": "Reply-required message persisted and a fresh monitor was armed.",
    "authoritative_mutation": {
      "completed": true,
      "kind": "message.persisted"
    },
    "side_effects": [
      {
        "kind": "reply_obligation.created",
        "status": "ok",
        "id": "obl_01J..."
      },
      {
        "kind": "monitor.armed",
        "status": "ok",
        "id": "mon_01J..."
      }
    ],
    "next_actions": [
      {
        "kind": "wait",
        "required": true,
        "argv": [
          "xtmux",
          "wait-agent",
          "--monitor-id",
          "mon_01J...",
          "--consume",
          "--json"
        ],
        "display": "xtmux wait-agent --monitor-id mon_01J... --consume --json",
        "why": "Wait for the correlated reply obligation to reach a terminal state."
      }
    ]
  }
}
```

Requirements:

* `reason_code` is stable and machine-oriented.
* `summary` is bounded and never carries untrusted message content.
* `argv` is the executable representation.
* `display` is derived from `argv`; it is not the source of truth.
* `next_actions` is empty when nothing follows.
* `required=true` means the original workflow is incomplete without the action.
* no hidden shell chaining is returned.
* no raw prompt, message body, credential or terminal capture enters the outcome.

Phase 1 must determine whether `_outcome` is compatible with every affected JSON contract. If not, recommend the smallest command-specific alternative.

### 5.3 Human rendering

Reply-required success:

```text
OK message_persisted_monitor_armed
Message:    msg_01J...
Target:     $12 / %31
Reply:      required
Obligation: obl_01J...
Monitor:    mon_01J... armed

Next:
  xtmux wait-agent --monitor-id mon_01J... --consume --json
```

FYI success:

```text
OK message_persisted_fyi
Message: msg_01J...
Target:  $12 / %31
Reply:   not required
Monitor: not created

No follow-up action required.
```

Recoverable degraded result:

```text
DEGRADED message_persisted_monitor_not_armed
The message and reply obligation were persisted, but immediate monitor creation failed.

Recovery:
  xtmux obligations list --requester-pane %12 --json
```

Rejected result:

```text
REJECTED target_not_live
No message was persisted because pane %31 is not a live target.
  
Inspect:
  xtmux topology --json
```

### 5.4 Exit codes

Phase 1 must inventory current exit-code contracts before assigning a global mapping.

Preferred default:

* `0`: `ok` or intentional `noop`;
* non-zero: `degraded`, `rejected` or `failed`, unless existing compatibility requires degraded success to remain zero;
* JSON and human mode return the same exit code.

Do not change an established automation-sensitive exit code without a migration plan and fixtures.

---

## 6. Highest-priority vertical slice: xtmux coordination

### 6.1 Desired semantic behavior

For `message-send`:

```text
expects-reply=true
→ persist message
→ create reply obligation
→ arm or verify fresh requester-owned monitor
→ return message_key + obligation_id + monitor_id
→ return exact wait/status/read actions

expects-reply=false
→ persist message
→ create no reply obligation
→ arm no monitor
→ state that no follow-up is required
```

A reply or acknowledgement must not arm a new monitor unless a distinct durable obligation actually exists.

### 6.2 Atomicity target

Phase 1 must determine whether message, obligation and monitor can be created in one SQLite transaction through existing repository seams.

Preferred order:

```text
transaction:
  message
  reply obligation
  monitor, when the current schema/seam permits it
```

Acceptable Ponytail fallback:

```text
message + obligation persisted
→ immediate monitor arm attempted
→ outcome may be degraded
→ existing obligation reconciliation repairs the missing monitor
```

Do not add an outbox or new monitor daemon unless measured loss demonstrates the existing durable reconciliation is insufficient.

### 6.3 Read/action guidance

The outcome should select only actions justified by actual state:

| Result                           | Next action                                           |
| -------------------------------- | ----------------------------------------------------- |
| FYI persisted                    | none                                                  |
| reply-required + monitor armed   | `wait-agent` or monitor status                        |
| reply-required + monitor missing | obligations reconciliation/inspection                 |
| correlated reply persisted       | read exact reply only when requested                  |
| target not live                  | topology/context inspection                           |
| receipt acked                    | no implication that the reply obligation is fulfilled |

### 6.4 Candidate commands in first xtmux wave

Verify and disposition:

```text
message-send
message-reply
message-ack
message-cancel
safe-send-pointer
monitor-agent
wait-agent
message-get
obligations list
```

Not all require new outcomes. Read-only surfaces may need only clearer errors.

---

## 7. Candidate adoption in Specialists and Core

After xtmux proves the contract, evaluate mutation commands with recurring caller mistakes.

### 7.1 Specialists candidates

```text
sp run / future dispatch surface
sp resume
sp stop
sp integration record
sp clean
sp merge / sp epic merge, only if still supported
```

Examples of useful next actions:

* `sp run` returns the exact `sp feed --json` and `sp result --json` commands;
* waiting result returns an exact `sp resume` template;
* integration record returns the exact `sp integration list --job ... --json` verification;
* unsupported/broken merge surfaces return an explicit reason and safe alternative rather than advertising a forbidden path.

Do not force a backgrounding design into this program. This document only standardizes command outcomes.

### 7.2 Core candidates

```text
xt pi / xt claude role or subordinate launch
xt merge
xt update --apply
xt doctor --fix/--apply surfaces where present
```

Examples:

* launch returns session, pane, branch and exact topology/attach command;
* merge returns the integration verification/recording command;
* update returns the exact doctor/smoke command when restart or verification is required.

---

# Phase 1 — Mandatory verification and disposition

## 8. Rule

Phase 1 is evidence-only.

The assigned agent must not:

* implement the proposed schema;
* create final implementation Beads;
* rename commands;
* add adapters;
* change published output;
* assume the command inventory in this document is complete.

A small verification Bead may be used if local process requires every task to be tracked, but it must be explicitly research/audit-only.

## 9. Required code audit

Inspect current HEAD in all three repositories.

### 9.1 xtmux

Trace end to end:

* command registration and dispatch;
* help text;
* human rendering;
* JSON writer;
* message persistence;
* reply-obligation creation;
* monitor creation;
* `wait-agent` and wake consumption;
* Pi result parsers;
* Claude hook parsers;
* existing schema/version contracts;
* shell contract tests;
* all callers of `message-send`, `message-reply`, `safe-send-pointer`, `monitor-agent` and `wait-agent`.

Answer with code references:

1. Does `message-send` itself create the obligation?
2. Where is `expectsReply` preserved or dropped?
3. Is monitor creation callable from the same process/transaction seam?
4. Which commands emit no success output?
5. Which commands mix data and diagnostics on stdout?
6. Which JSON fields are parsed by Core, Specialists, Pi extensions, Claude hooks or external scripts?
7. Which status/exit branches are currently ambiguous?
8. Which commands already print remediation or next actions?
9. What can be deleted after the CLI becomes actionable?

### 9.2 Specialists

Inventory:

* command output helpers and JSON envelopes;
* `run/feed/result/resume/stop/integration` output contracts;
* current synchronous MCP `use_specialist` consumer assumptions;
* help/eval/skill examples that parse or teach exact CLI output;
* source-only versus released behavior.

### 9.3 Core

Inventory:

* parsers of `sp` and `xtmux` JSON;
* launcher output consumed by scripts/tests;
* managed instructions and skills that teach follow-up commands;
* Pi extensions and Claude hooks that infer next actions from command results;
* install/update/doctor output contracts.

## 10. Required command inventory

Produce a machine-readable table with at least:

```text
repository
command
mutation_or_query
human_output
json_output
stdout_contract
stderr_contract
exit_codes
stable_ids_returned
current_next_action
known_consumers
breaking_change_risk
candidate_disposition
```

Candidate disposition:

```text
keep_as_is
clarify_error_only
add_human_outcome
add_json_outcome
make_side_effect_atomic
deprecate_or_hide
delete_stale_consumer
```

## 11. Required live fixtures

Use isolated repositories and tmux servers.

At minimum:

1. reply-required send, successful monitor arm;
2. FYI send, no obligation and no monitor;
3. correlated reply, no new monitor;
4. missing target;
5. message persisted but immediate monitor arm forced to fail;
6. duplicate/retry behavior;
7. stale/terminal monitor;
8. JSON parser compatibility for Pi and Claude;
9. piped query output remains clean;
10. hostile metadata does not appear in commands or summaries.

Capture exact stdout, stderr and exit code.

## 12. Required Phase 1 deliverables

1. `cli-actionable-outcomes-verification.md`
2. `cli-command-inventory.json`
3. `cli-output-compatibility-matrix.csv`
4. one ADR containing:

   * whether `xtrm.command-outcome.v1` is justified;
   * additive `_outcome` versus another minimal shape;
   * atomic monitor disposition;
   * exit-code compatibility;
   * commands accepted, cut or deferred.
5. a proposed dependency map, with no final Bead IDs yet.
6. an explicit list of skill/hook prose that becomes deletable.

The operator reviews this evidence before Phase 2.

---

# Phase 2 — Executable plan and actual Beads

## 13. Entry criteria

Phase 2 starts only after:

* Phase 1 deliverables exist;
* repository owners approve the outcome shape;
* command compatibility hazards are dispositioned;
* the exact owning seam for monitor creation is known;
* current HEAD and package versions are recorded.

## 14. Planning rules

The planning agent must:

1. create a concrete implementation plan with file-level ownership;
2. create actual Beads in each owning repository;
3. return the real Bead IDs;
4. add dependency edges using the installed Beads CLI;
5. attach the verification report/spec reference to every root;
6. avoid a fictitious cross-repository parent-child graph;
7. link companion epics through metadata/external references and `related` semantics where available;
8. create no Jira work unless separately authorized.

The installed Beads version and supported graph/metadata commands must be verified before issuing writes.

## 15. Candidate decomposition to validate

### xtmux epic — primary

Candidate children:

```text
CLI-O1 publish command-outcome contract or minimal equivalent
CLI-O2 make reply-required message-send arm/verify monitor
CLI-O3 add actionable human and JSON outcomes to coordination mutations
CLI-O4 add degraded/recovery paths backed by obligations reconciliation
CLI-O5 update help/README and remove brittle follow-up instructions
CLI-O6 add compatibility, hostile-input and live tmux contracts
```

### Specialists companion epic

Candidate children:

```text
CLI-S1 inventory and adopt outcome contract for selected sp mutations
CLI-S2 make run/resume/result/integration outputs return exact next actions
CLI-S3 repair help/eval/skill examples and remove unsupported paths
CLI-S4 add output parity fixtures and package/release evidence
```

### Core companion epic

Candidate children:

```text
CLI-C1 adopt selected xt/sp outcomes in launcher/update/merge surfaces
CLI-C2 simplify Pi/Claude consumers to use structured next_actions
CLI-C3 delete superseded instruction prose and add packed-install smoke
```

The verification pass may merge, cut or reorder these candidates.

## 16. Acceptance criteria

The program is complete when:

* every selected mutation returns an explicit outcome and reason;
* JSON mode includes executable argv for required next actions;
* human mode renders commands derived from the same structured action;
* queries remain pipe-safe;
* FYI sends never arm monitors;
* reply-required sends do not rely on a second model-authored command;
* immediate monitor failure is observable and recoverable;
* receipt remains distinct from fulfilment;
* duplicate retries are idempotent;
* existing parsers either remain compatible or migrate in the same release window;
* Claude/Pi adapters can consume the CLI without prose parsing;
* help, skills and tests agree with the runtime;
* released package artifacts identify the implemented contract.

---

## 17. Explicit non-goals

* no new scheduler or workflow engine;
* no new notification database;
* no generic daemon;
* no automatic execution of arbitrary CLI-provided commands by humans;
* no success banners on every read-only query;
* no shell-chain strings as the machine contract;
* no implicit authority from message content;
* no forced adoption of MCP or Pi adapters in this program;
* no coupling to the Specialists modernization roadmap.

---

## 18. Sources to verify during Phase 1

Repository evidence:

* `Jaggerxtrm/xtmux` current command, coordination and contract code;
* `xtrm-dev/specialists` current CLI and MCP server;
* `xtrm-dev/core` current launchers, hooks, Pi extensions, skills and parsers;
* `docs/design/audit-reconcile-v0724.md` and its Epic Plan.

External behavior must not be used to redefine CLI authority. The companion adapter document owns harness research.
