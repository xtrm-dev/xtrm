# service-knowledge canary policy

Status: **ratified · v0.7.0 (mechanism only; canary NOT enabled)**
Owner: operator (jaggerxtrm)
Bead of record: `xtrm-56flm.7`

## 1. Purpose

PR2 shipped a 6-tier gate lattice: even a `PASS` verdict opens a normal PR — no auto-merge on day one. PR5a shipped the empirical measurement substrate (verifier FP/FN, retrieval precision/recall, stale-claim escape rate, activator consumption, token cost).

This document decides **which subset of `PASS` verdicts may ever be auto-merged**, under **which measured conditions**, and via **which override paths**. It is not a switch. `v0.7.0` ships the mechanism; the switch itself (`service-knowledge canary enable`) refuses until the thresholds below are met AND the operator confirms explicitly. **Package version `v1.0.0` is reserved for the moment the operator authorises the enable.**

## 2. Claim classes — what MAY ever be auto-merged

Auto-merge is a per-claim-class privilege, not a global one. A `PASS` verdict on a diff that contains any non-allowed claim class falls back to normal PR review — always, forever, regardless of canary state.

### 2.1 Allowed (low-risk) classes

| Canary class    | Backing verifier `ClaimType`(s)        | Rationale                                         |
| --------------- | -------------------------------------- | ------------------------------------------------- |
| `path`          | (surface path assertions)              | Structural, deterministic, easily re-verified.    |
| `symbol`        | `SYMBOL_NAME`                          | Name exists / does not; grep-verifiable.          |
| `literal`       | `QUOTED_LITERAL`                       | Exact-substring match against source.             |
| `env-var`       | `ENVIRONMENT_CONSTANT`                 | Constant present in env manifest / compose file.  |
| `image`         | `COMPOSE_RESOURCE` (`image:` variants) | Image reference present in compose.               |
| `config-value`  | `CONFIG_VALUE`                         | Literal value match in named config file.         |

### 2.2 Forbidden (never auto-merged in this rollout)

- `causal` — a claim that X causes Y (research §5.1 flags high FP risk).
- `procedure` — multi-step operator procedures; wrong order = wrong behaviour, not visible from any single line.
- `security-posture` — auth, secrets, TLS, sandbox boundary claims.
- `complete-set-critical` — closed-set claims whose completeness is load-bearing (e.g. "these are the only 3 endpoints").

Any diff touching one of the forbidden classes falls back to normal PR review. This restriction is unconditional and is enforced regardless of the enabled-classes list passed to `canary enable`.

## 3. Threshold ratification for the enable moment

The `enable` CLI refuses unless **all** of the following are met at the moment of invocation:

| Threshold                          | Value       |
| ---------------------------------- | ----------- |
| Observation window                 | ≥ 30 days   |
| Verifier runs in window            | ≥ 200       |
| Verifier false-positive rate       | < 0.02      |
| Verifier false-negative rate       | < 0.05      |
| Operator sign-off (explicit)       | required    |

The FP / FN rates are measured on the golden set + PR5a eval corpus (`service_knowledge.eval`). Missing / short corpus is treated as **failing** — no thresholds met, canary refuses to enable.

Sign-off is interactive: the CLI prints the current metric snapshot and the exact class list about to be enabled, then requires the operator to type the confirmation phrase. `--yes` short-circuits the prompt for CI but does **not** short-circuit any threshold check.

## 4. Fail-closed semantics

- The state file (`.xtrm/state/service-knowledge/canary.json`) is per-repo and gitignored.
- If the file is missing → canary is **off**.
- If the file is unreadable, malformed JSON, or fails schema validation → canary is **off** and a `component=canary, event=fail_closed` line is appended to `.xtrm/state/service-knowledge/canary.jsonl`.
- If the file says enabled but the enabled-classes list is empty → canary is **off**.
- Any single claim in the diff that is not in the enabled-classes list → auto-merge suppressed for the whole diff, normal PR path taken.
- Verdict other than `PASS` (including `PASS_WITH_ADVISORIES`, `CONFLICT`, `UNKNOWN`, `EVIDENCE_RACE`) → auto-merge suppressed.

Never fail open on a canary check.

## 5. Override paths

- **Disable at any time**: `service-knowledge canary disable`. No threshold check; state flips to off; event logged.
- **Bypass on a specific run**: set `SERVICE_KNOWLEDGE_CANARY=off` in the environment for that reconcile invocation.
- **Force a specific class list on enable**: `service-knowledge canary enable --classes symbol,literal` — the operator narrows the set. Never widens beyond the allowed list in §2.1.
- **Operator veto in review**: even after a diff is auto-merged, a follow-up revert is a first-class operator action and does **not** require disabling the canary.

## 6. Audit trail

Every `enable` and `disable` action appends one JSON line to `.xtrm/state/service-knowledge/canary.jsonl`:

```
{ "timestamp": "...", "component": "canary", "event": "enable" | "disable" | "fail_closed",
  "classes": [...], "enabled_by": "...", "thresholds_at_enable_time": {...}, "git_commit": "..." }
```

The state file and log are both per-repo, both gitignored (they carry runtime, not source-of-truth, data).

## 7. Reserved version

`v1.0.0` of the `service-knowledge` package is reserved for the release that **enables** the canary in a production consumer repo. That release is a separate, operator-authorised action. Nothing about `v0.7.0` flips a switch by itself.
