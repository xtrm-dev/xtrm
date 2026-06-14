# Cross-doc audit of substrate premortem against the xtrm vault

You are the overthinker. A premortem on `~/dev/xtrm/docs/substrate/substrate_design_it.md` (Bozza rev 12) was just produced (see `synthesis.md` next to this file). It judged the substrate doc in isolation. Several findings flag things as "underspecified" or "missing" that may already be canonically owned by **other** docs in the xtrm vault — and the substrate doc just hasn't absorbed them yet, by design.

`docs/xtrm-MOC.md` literally says so for telemetry forensic:
> "Telemetry forensic specialists-owned → repo `telemetry/forensic-event-contract.md`. Sezione substrate **DOPO**."

And `xtrm.forensic.v1` is **already shipped** in the specialists repo (`~/dev/specialists/src/specialist/forensic-events.ts`, `src/cli/forensic.ts`, `specialist_forensic_events` SQLite table).

**Your job:** for each of the 9 premortem reasons, verify it against the wider xtrm vault and classify it.

## Inputs you must read

Read in this order:

1. `docs/premortem-substrate/synthesis.md` — the consolidated premortem (12KB). The 9 reasons are numbered §1–§9. The user added one comment under §6 (chain coordinator) you must address as a separate sub-question.
2. `docs/xtrm-MOC.md` — Map of Content. Anchors where each topic is canonically owned.
3. The doc tree below — read what is relevant to each reason. You do not need to read all of them. Read selectively, but cite what you read.

| Premortem reason | Likely-relevant xtrm/docs paths |
|---|---|
| §1 Stage 0 = kernel | `docs/state-store-options.md`, `docs/devops/devops-system.md`, `docs/monorepo-migration.md`, `docs/temp_roadmap.md` |
| §2 Design drift | `docs/temp_roadmap.md`, `docs/improvements.md`, `docs/xtrm-MOC.md` §1 (decision ledger) |
| §3 Clean cutover never cuts | `docs/monorepo-migration.md`, `docs/temp_roadmap.md` |
| §4 Total rebuild vs targeted fixes | `docs/improvements.md`, `docs/temp_roadmap.md`, `docs/devops/devops-system.md` |
| §5 Node-coordinator load-bearing | `docs/chains.md`, `docs/specialists/specialists.scheme.md`, `docs/tether.md` |
| §6 Chain coordinator over-specified | `docs/chains.md`, `docs/substrate/chain_templates.md`, `docs/specialists/specialists.scheme.md` |
| §7 Two-tier no v0 (incl. xtrm_forensic_events) | `docs/telemetry/forensic-event-contract.md`, `docs/telemetry/prometheus-projection-contract.md`, `docs/devops/devops-system.md`, `docs/state-store-options.md`, `docs/monorepo-migration.md` |
| §8 Console deferred | `docs/console/console-product-contract.md`, `docs/console/specialists-console-handoff.md`, `docs/devops/agent-observability-pattern.md` |
| §9 Author = implementer | `docs/_meta/vault-workflow.md`, `docs/xtrm-MOC.md`, `docs/improvements.md` |

You may consult others (e.g. `docs/channels/`, `docs/devops/mcp-sidecars-pattern.md`). The specialists code is at `~/dev/specialists/src/specialist/forensic-events.ts` and `~/dev/specialists/src/cli/forensic.ts` if you need to confirm what is shipped.

## Output format — required, machine-friendly

For each of the 9 reasons, produce a section in this exact shape:

```
## §N — <short title>

**Verdict:** ADDRESSED | PARTIALLY_ADDRESSED | STILL_HOLDS | NEW_FINDING

**Evidence:**
- `<doc path>` — <≤25 word summary of what it says about this reason, with quoted phrase if useful>
- `<doc path>` — <…>

**Reasoning:** <2–4 sentences. Explain why the verdict is what it is. If PARTIALLY_ADDRESSED, name the gap precisely. If NEW_FINDING, name what's now visible that wasn't.>

**Revised recommendation:** <The original recommendation from synthesis.md updated in light of the evidence — what should actually be done. If ADDRESSED, the recommendation is "fold the xtrm/docs reference into the substrate doc at <stage>" — be specific.>
```

After all 9 sections, add:

```
## Sub-question: user's note under §6

The user wrote: "does this mean that instead of making the reducer llm/programmatic, we can handover and switch to only coordinator doing that job?"

**Your answer (≤200 words):** <Address it directly. Consider: is collapsing the dual reducer-or-judge framing into "coordinator is always-LLM" actually viable given cost? What about the inverse — "coordinator is always-deterministic, no LLM, judgment moves to a separate adjudicator role"? Which framing matches what xtrm/docs/chains.md and substrate §4.3 actually contemplate?>
```

Then close with:

```
## Roll-up

- Count by verdict: ADDRESSED=X, PARTIALLY_ADDRESSED=X, STILL_HOLDS=X, NEW_FINDING=X
- Top 3 still-real risks after the cross-doc audit, ranked
- Top 3 docs that need to be folded back into substrate_design_it.md (or where substrate.md needs explicit "owned by [[doc]]" links), with §-section anchors
- One sentence on whether meta-finding "Author = implementer, no second eyes" stands or falls in light of the vault evidence (the vault has multiple docs from deliberation sessions; does that count?)
```

## Hard rules

1. Cite real paths. If you would invent a path that doesn't exist on disk, omit it instead. The premortem already burned itself on speculative paths once.
2. Quoted phrases must come from the actual file content — if you can't find an exact quote, paraphrase and label it `(paraphrased)`.
3. Do not re-litigate the premortem. Your job is verification, not redoing the analysis.
4. Be terse. The orchestrator will read every word; padding loses signal. Aim for ~3–5KB total output.
5. The substrate doc is in Italian. Some target docs are too. Read them; don't dodge them.
