# Value decision (XTRM-505, criteria 10 and 11)

Criterion 10: open implementation children only where a benchmark shows
measurable value.

Criterion 11: record a Mercury follow-up separately, if one is useful.

## What was measured

The Evidence Gate alone does not decide value. The operator stated this on
2026-09-18, and the decision rests on three experiments, not one:

| Experiment | Pattern | Result (95% CI) | Doc |
|---|---|---|---|
| Evidence Gate, six arms | holistic classifier | Jev AUC minus DeepSeek −0.099 [−0.142, −0.058] | `evidence-gate-results.md` §2 |
| Evidence Gate cascade | atomic battery, code composition, selective escalation | precision minus DeepSeek-all +0.007 [−0.005, 0.023]; recall −0.027 [−0.053, −0.007]; LLM calls −38.7%; USD −0.188 [−0.255, −0.129] per 1000 candidates | `evidence-gate-results.md` §3 |
| Code-locator beam | multi-step control loop, git-graded | hit@1 minus lexical +0.101 [0.014, 0.203]; minus the free hot-files prior −0.304 [−0.420, −0.188] | `code-locator.md` |

## Criterion 10: MET, as a decision. No implementation child is opened.

- **No runtime or production implementation child is justified by the
  evidence.** No tested System One workflow meets the current path on the
  gate's first priority (recall) while removing a material cost. In the
  multi-step control loop, a free deterministic prior beats the System One
  design outright.
- **The absolute saving is small.** The cascade's saving (38.7% fewer
  DeepSeek calls, USD 0.19 per 1000 candidates) comes with a recall loss.
  At XTRM's search volume it does not pay for a runtime package, so the
  `packages/system-one` runtime (`contract-map.md` §3.2) is **not
  created**. The contract map already states that condition: no production
  caller means no runtime package.
- **The decision is scoped.** It covers the two patterns tested. The
  paradigm the operator cares about has not been tested on the workloads
  where it would matter: hundreds of atomic judgments per run inside
  agent, review, context and SRE control loops. That work is research, not
  implementation. It is filed as the follow-up epic **XTRM-513**, with
  draft children:

  | Issue | Showcase |
  |---|---|
  | XTRM-514 | agent and tool control over historical sessions |
  | XTRM-515 | PR review as an atomic policy-check battery with selective reviewer escalation |
  | XTRM-516 | context lifecycle admission and retention |
  | XTRM-517 | service-knowledge hierarchical routing with the deterministic prior in the state |
  | XTRM-518 | SRE repeated state estimation |
  | XTRM-519 | pre-registered replication of the cascade band on a new sample |

- **The epic carries the harness rules proven here:**
  - the XTRM-508 budget policy: frontier and generative calls need a
    reason, and a cap violation is a hard failure;
  - outcome-first reference construction, with no full-set frontier
    labelling;
  - pre-registration;
  - app-visible evidence through `xtrm_research.publish`.

## Criterion 11: REJECTED. No Mercury follow-up is recorded.

A Mercury follow-up would be useful only if a System One workflow had shown
value that transfers to Mercury's decisions. A trading-style loop, in which
Jev chooses and code owns price, order type and risk, is the analogy the
operator raised. None was shown.

**Reopen condition:** a positive, pre-registered result in XTRM-514 (agent
control) or XTRM-518 (SRE state estimation). Those are the two patterns
closest to a Mercury control loop. Reopening is recorded in XTRM-513, not
here.

## What remains true after this decision

- Jev stays the research System One backend (`jev-verdict.md`).
- The research harness, which XTRM-513 reuses, is complete and tested:
  - the budget policy (XTRM-508);
  - the workflow runner and publisher (XTRM-509);
  - app-visible runs (XTRM-510, XTRM-511, XTRM-512).
- Deterministic authority is unchanged (`authority-audit.md`).
