# Contract fit: service-knowledge and sre-ops (XTRM-503, criterion 8)

Jira XTRM-99 criterion 8 asks the team to validate the System One contract
against one `service-knowledge` workload and one `sre-ops` workload.
Operator constraint §10.4 sets the bar: demonstrate that the contract fits,
or record why it does not. This is a fit check, not a benchmark. The
instances carry no gold labels, and n is too small for a metric with a
useful interval, so no accuracy number is reported here.

## Method

- Runner: `xtrm_research.contract_fit` (committed). Each question spec is
  validated against `question_spec.schema.json`. Each instance is sent
  through `guards.guarded_send` to Jev (`jev-latest`, which resolved to
  `jev-1.13.0`). Each answer is validated against its
  `common.schema.json` `$defs.<type>_answer`.
- A spec runs only on instances whose state carries every field its
  instructions name. Missing fields are counted, never filled in.
- Frozen inputs, outside git (mode 700), because they hold private
  infrastructure commands and incident text:
  `~/.xtrm/research/datasets/contract-fit-v1/`.

  | File | sha256 |
  |---|---|
  | `sk_instances.jsonl` | `e1f91a3d6b1cf9f7848a8fffa9dc670b870c758fd876f27c18a9cef881a58a72` |
  | `sre_instances.jsonl` | `1776a7efd3bb320cbab41e33cad4a5da52dcfd41f1dd714e5e2317b72114f1fd` |
  | `question_specs.json` | `304982982dd2f06cd631675b805ee8da3250b9b4d171035ab610f177d8a94f20` |

  Results: `fit_results.json`, with request ids.
- Instance provenance:
  - service-knowledge: 10 real Bash commands from the mercury/infra Claude
    Code transcripts. Each is joined to its PreToolUse activator telemetry
    event: the command's timestamp falls within -5 s to +1 s of the event,
    and re-running `find_service_for_command()` reproduces the logged
    service.
  - sre-ops: 7 of the 9 runs in the mercury/infra `sre-triage-runs`
    archive. One run was skipped because its lane evidence carries a
    `PASSWORD=` string. One was skipped because it is a synthetic fixture.
  - Any instance whose text matched a credential regex was skipped, not
    redacted.

## Workload 1: service-knowledge, activator Bash routing

The only real service-knowledge judgement that has recorded instances is
Bash command -> service routing in the PreToolUse activator
(`scripts/skill_activator.py:find_service_for_command`). That function picks
the first service, in registry order, whose id appears anywhere in the
command.

FTS5 rerank has no real instances. Telemetry stores only a query hash, and
retrieval events store only a bundle hash. The target index for xtrm is
empty.

- Where System One would sit: between `find_service_for_command()` and
  `retrieve_evidence()`. It would change only which evidence bundle is
  injected.
- Authority: `decide()` keeps the §3.7 block matrix unchanged. System One
  never decides whether a tool call is blocked.

Specs that ran, and the one that could not:

| Spec | Type | Instantiated | Answered | Schema-valid answers |
|---|---|---|---|---|
| `sk.bash_route.mercury-infra` | choice, 18 options | 10/10 | 10/10 | 10/10 |
| `sk.bash_concerns_service` | noul | 0/10 | — | — (state lacks `candidate`) |
| `sk.item_answers_query` | noul | 0/10 | — | — (no FTS5 rerank instances) |

Latency: about 0.6-0.7 s per call; the first call took 1.37 s.

Observed answers: the Jev choice (with its confidence) against the current
deterministic router.

| Instance | Router (first substring match) | Services matching as substrings | Jev choice (confidence) |
|---|---|---|---|
| 000 | prometheus | prometheus | prometheus-mcp (0.86) |
| 017 | prometheus | prometheus, sre-triage-runs | prometheus (0.83) |
| 021 | runners | runners, sre-triage-runs | none (0.77) |
| 023 | node-exporter | node-exporter, prometheus | prometheus-mcp (0.87) |
| 085 | alertmanager | 9 services | none (0.90) |
| 087 | otel-collector | otel-collector, prometheus | prometheus (0.91) |
| 110 | alerting | 5 services | sre-triage-runs (0.90) |
| 116 | prometheus | prometheus, traefik | none (0.76) |
| 125 | alerting | alerting, node-exporter, prometheus | none (0.47) |
| 134 | alerting | alerting, sre-triage-runs | sre-triage-runs (1.00) |

Jev and the router disagree on 9 of 10 instances. No gold label exists, so
neither can be called correct from this table; adjudication belongs to the
operator. What the table does show is that the choice contract carries the
decision end to end, with an 18-way option set and a separate `none`.

Verdict: FITS. The judgement is expressible as one choice question over
real state. The backend answers it in contract shape, and the authority
boundary is unchanged.

Recorded misfits:
1. The option set is per registry. Every registry edit changes the spec's
   `content_hash`, and each repository needs its own spec.
2. Choice is single-valued, but some commands concern several services
   (085). The multi-label variant needs one noul call per candidate plus a
   `candidate` state field that the instances do not carry.
3. The activator hook runs in 1-300 ms today. A remote call of about
   0.65 s on every Bash PreToolUse is a runtime-budget misfit. The contract
   has no `deadline` field (XTRM-99 lists it as an XTRM extension; it is
   not implemented).
4. FTS5 rerank is a ranking over a list. The contract returns independent
   per-item probabilities, so listwise ordering stays in `rank()`.

## Workload 2: sre-ops, incident-state synthesis

The call would sit at the coordinator synthesis step of
`references/incident-response.md`. State is the incident brief plus the
evidence from the parallel read-only lanes. Policy code keeps invariant 7
(missing observability means UNKNOWN), the severity cut points, and the
rule that remediation is a tracked contract. The skill has no mutation
code; its scripts only send Prometheus GET requests.

| Spec | Type | Instantiated | Answered | Schema-valid answers |
|---|---|---|---|---|
| `sre.incident_state` | choice (HEALTHY / DEGRADED / CRITICAL / UNKNOWN) | 7/7 | 6/7 | 6/6 |
| `sre.evidence_sufficient` | noul | 7/7 | 6/7 | 6/6 |
| `sre.severity` | score | 7/7 | 6/7 | 6/6 |
| `sre.single_mechanism` | noul | 7/7 | 6/7 | 6/6 |
| `sre.hypothesis_supported` | noul | 0/7 | — | — (state lacks `hypothesis`) |

One instance (swap-laiz) failed the send guard's redaction-loss check and
was never sent (fail closed).

Observed answers:

| Incident | `incident_state` | P(`evidence_sufficient`) | `severity` | P(`single_mechanism`) | Recorded terminal state |
|---|---|---|---|---|---|
| 308163 (chain, lane evidence) | CRITICAL | 0.95 | 1.99 | 0.75 | escalated |
| v8vh | UNKNOWN | 0.02 | 1.74 | 0.09 | satisfied |
| r2gc | CRITICAL | 0.02 | 1.99 | 0.05 | closed |
| multi | CRITICAL | 0.03 | 1.99 | 0.07 | operator-checkpoint |
| mercury-64 | CRITICAL | 0.03 | 2.00 | 0.06 | — |
| tmpfs-runc (lane evidence) | UNKNOWN | 0.45 | 1.96 | 0.47 | — |

The finding that matters for the contract: on three incidents Jev answered
`incident_state = CRITICAL` while it put P(`evidence_sufficient`) at about
0.02. The 4-way choice mixes an epistemic state (UNKNOWN) with an ordinal
severity scale, so a backend can report high severity on evidence it
itself judges insufficient.

The split form fits the contract and keeps the authority where it belongs:
`evidence_sufficient` (noul) plus `severity` (score), with policy code
mapping `evidence_sufficient < tau` to UNKNOWN.

Verdict: FITS, in the split form. The single 4-way choice form is recorded
as a misfit.

Recorded misfits:
1. UNKNOWN is not a severity level. Use the split form, as above.
2. Lanes return at different times, but the contract is a stateless
   `system_one(state, questions)`. Each re-judgement is a new full-state
   call with no delta.
3. Lane evidence runs to 6-12 KB per incident. Deterministic
   pre-summarisation of raw lane output is needed, and it sits outside the
   contract.
4. Metrics and timelines enter only as text. The contract has no numeric or
   quantile answer type (XTRM-99 open question 13).
5. Proposing hypotheses is generation. The contract can only score a given
   hypothesis (`sre.hypothesis_supported`), and the instances do not carry
   one.
6. The instances are post-hoc narratives (4 of 7 carry only the brief).
   They can demonstrate fit, but not measure accuracy.

## Conclusion for criterion 8

The contract fits both workloads, for the decisions shown, with authority
unchanged. The misfits above are recorded.

No implementation child is opened from this check. §10.4 permits children
only where a benchmark shows value, and neither workload has labelled data
here. The routing disagreement (9 of 10) and the UNKNOWN/severity split are
inputs to XTRM-505.
