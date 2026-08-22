# xtrm-cn8.6 — Exact local patch contract for large canonical files

> **Status:** REQUIRED BEFORE MERGE of the `xtrm-cn8.6` XTRM reconciliation PR.  
> **Reason:** the web GitHub mutation surface available to the external coordinator can replace complete files but cannot apply bounded hunks; `channels.md` (~74 KB) and `substrate_design_it.md` (~300 KB) must not be serialized/reconstructed wholesale merely to change two small canonical sections.
>
> This file is a handoff/evidence artifact, **not a substitute canon**. Delete it in the same commit that applies the two edits below, or mark it completed and archive it in the reconciliation evidence directory.

## 1. Channels §5.3 — absorb runtime failure and incident kinds

File:

```text
docs/channels/channels.md
```

Anchor: `### 5.3 Message Kinds (families + discriminated union)`.

The canonical family list remains:

```text
work.*
control.*
system.*
runtime.*
```

`chain.incident.*` is a domain wake/event namespace tied to deterministic-recovery exhaustion; it does not create a second transport family or allow body-text authority.

Immediately after the current row:

```text
| runtime | `runtime.delivery_failed` | runtime | `{target, reason}` | coordinator |
```

add the following canonical rows:

```text
| runtime | `runtime.participant_died` | runtime | `{participant_id, job_id?, reason, refs?}` | reducer/runtime; coordinator only after recovery exhaustion |
| runtime | `runtime.gate_unresponsive` | runtime | `{participant_id, gate_kind?, timeout_ms?, refs?}` | reducer/runtime; coordinator only after recovery exhaustion |
| runtime | `runtime.worktree_diverged` | runtime | `{worktree?, base_ref?, reason, refs?}` | reducer/runtime |
| runtime | `runtime.evidence_ref_broken` | runtime | `{evidence_ref, reason}` | reducer/runtime |
| runtime | `runtime.pulse_delivery_failed` | runtime | `{pulse_ref?, reason, attempts?}` | reducer/runtime |
| runtime | `runtime.budget_exhausted_mid_step` | runtime | `{budget_kind, used?, limit?, participant_id?}` | reducer/runtime |
| runtime | `runtime.recursion_cap` | runtime | `{loop_kind?, count?, hard_cap?, refs?}` | reducer/runtime |
| chain | `chain.incident.opened` | runtime / authorized coordinator boundary | `{incident_kind, summary, refs, recovery_exhausted: true}` | chain coordinator |
| chain | `chain.incident.resolved` | chain coordinator / runtime | `{incident_ref, outcome, refs?}` | affected action targets / audit |
```

Then add this normative paragraph after the runtime error/rejection paragraph:

```text
**Runtime failures and chain incidents.** `runtime.*` records bounded mechanical failures observed during one ChainRun/Container execution. Deterministic classes are first consumed by the runtime reducer/recovery policy; they do not wake the chain coordinator merely because the notice exists. When deterministic recovery is exhausted, or the failure requires semantic/operator judgment, the effect layer emits one idempotency-keyed `chain.incident.opened`. The coordinator consumes that explicit incident, not every mechanical failure. Resolution emits `chain.incident.resolved`. Neither message body may grant authority, mutate ResolvedChain topology, or bypass the scheduler. This absorbs the failure-kind inventory previously present only in `channels_plain_it.md` §7 and aligns with Substrate §4.3 incident handling and the native runtime recovery ADR.
```

Validation:

```bash
grep -n 'runtime.participant_died\|chain.incident.opened' docs/channels/channels.md
```

Both must occur under/adjacent to §5.3, not only in explanatory companion docs.

## 2. Substrate IT §7.1 — correct active subscription cursor terminology

File:

```text
docs/substrate/substrate_design_it.md
```

Current stale text in §7.1:

```text
La active subscription è una row in channel_subscriptions (channel_id, participant_key, last_seq_seen, paused) che lega questo job specifico a questo channel specifico con un cursore.
```

Replace with:

```text
La active subscription è una row in `channel_subscriptions` (`channel_id`, `participant_key`, `last_seen_id`, `paused`) che lega questo participant a questo channel con un cursore. Il cursore autorevole è `channel_messages.id`, monotonicamente allocato da SQLite; `seq` è soltanto l'ordinale di display per-canale. L3 `participant_id`/`participant_key` possiede il cursore e il runtime risolve separatamente l'attivazione L4 corrente (`job_id`).
```

This aligns with `docs/channels/channels.md` §5.1 and preserves participant identity across activation replacement.

## 3. Substrate IT §13.4 — remove the obsolete two-ID `seq + msg_id` model

Current stale paragraph:

```text
**dominio channels** — `channel_messages`, `channel_subscriptions` (messaggi tipizzati secondo channels.md). Ogni messaggio porta **due identificatori**: un `seq` locale al canale (`INTEGER AUTOINCREMENT`, l’ordinamento + cursore per cursor-through-N) **e** un hash `msg_id` globalmente unico (stile Slack/Discord, es. `msg_a1b2c3…`). Il `seq` ha senso solo all’interno del suo canale; il `msg_id` è l’handle globale stabile usato per riferirsi a un messaggio dall’esterno — da un altro canale, dalle evidenze di un issue, da un journal del coordinatore (§5.9), dalla provenance. Servono entrambi: `seq` per ordine/cursore, `msg_id` per identità/riferimento.
```

Replace with:

```text
**dominio channels** — `channels`, `channel_messages`, `channel_subscriptions` (messaggi tipizzati secondo `channels.md`). Il record messaggio ha un `id INTEGER PRIMARY KEY AUTOINCREMENT` globale alla tabella, allocato da SQLite: questo è l'identificatore/cursore autorevole per ordering, read/ack, replay e riferimenti durevoli. `seq` è un ordinale per-canale allocato da `channels.next_seq` nella stessa transazione e serve soltanto alla leggibilità/display (`sp tail`); la correttezza non dipende da `seq`. `channel_subscriptions.last_seen_id` conserva l'ultimo `channel_messages.id` processato con successo. Non esiste un secondo `msg_id` hash necessario al modello canonico: evidence, journal, forensics e altri container possono riferire il message `id` insieme al suo `channel_id`/container provenance secondo il contratto Channels.
```

Validation:

```bash
grep -n 'last_seq_seen\|msg_a1b2c3\|seq.*cursore' docs/substrate/substrate_design_it.md
```

No stale normative occurrence may remain in §7.1 or §13.4. Historical/revision commentary may retain old terms only when explicitly identified as historical.

## 4. Independent review

Because `substrate_design_it.md` itself requires an independent reviewer for architectural revisions after rev12, this correction must receive a fresh non-author documentation review even though it is a semantic consistency repair rather than a new entity/lifecycle proposal.

Reviewer must verify:

1. the edit only aligns Substrate's Channels recap to the already-canonical Channels cursor model;
2. no Substrate lifecycle, Stage-0, daemon or storage migration is promoted;
3. `participant_id` remains stable L3 and `job_id` activation L4;
4. `seq` remains available as display ordinal only;
5. no new message-authority rule is introduced by the Channels §5.3 inventory.

## 5. Completion

After these hunks are applied and reviewed:

- remove/mark-complete this patch contract;
- run Markdown/link checks and targeted grep;
- update the `xtrm-cn8.6` PR body with the commit SHA;
- merge the XTRM PR;
- close local Bead `xtrm-cn8.6` only after its Core companion PR is also landed.