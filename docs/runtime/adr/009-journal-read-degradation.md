# ADR-009 — A journal read degrades per row, never per issue

> Status: PROPOSED 2026-11-17 · decision recorded in **XTRM-826** · implementation gated on acceptance, **XTRM-827**
> Date: 2026-11-17 · Issues: **XTRM-826** (this decision), **XTRM-827** (implementation, depends on XTRM-826), **XTRM-420** (the render defect that exposed it)
> Scope: what `JournalService` does when one persisted entry cannot be validated while the rest of the issue's journal is readable.
> Evidence: symbols, not line numbers — `JournalService.listEntries` and its `.map((r) => this.toEntry(r))`, `toEntry`'s result-payload throw, and `validateResultPayload` with its field and summary rules, in `packages/substrate/src/service/journal-service.ts` and `packages/substrate/src/domain/journal.ts`. No line number is quoted in this record: they drift with every refactor — the result-payload throw moved twice in a day while this decision was being written — so grep the symbol. Measurement on the canonical store, 2026-11-17, below.

## Context

Every journal read validates every row. `listEntries` selects the rows for one issue and maps each through `toEntry`, and `toEntry` fails closed on an invalid payload — a result with a key outside `RESULT_FIELDS`, an empty or whitespace `summary`, an over-long field, or an unparsable `result_json` (all in `packages/substrate/src/service/journal-service.ts`, validating through `validateResultPayload` in `packages/substrate/src/domain/journal.ts`):

```ts
if (problems.length > 0) throw new Error(`fail-closed: invalid result payload on ${r["id"]}: ${problems[0]}`);
```

Fail-closed is the right policy at the **write** seam: an invalid payload must never enter the store. It has an undecided consequence at the **read** seam, because the throw escapes both read seams (`listEntries` and `timeline`) rather than skipping the row. One unreadable entry therefore takes the whole issue's history with it — `sb journal show <ref>`, `journal tail`, and the console journal panel all degrade from one bad line to an error state for the entire issue.

This is not hypothetical equipment. Rows can reach the store without passing the write seam:

| Path | How it produces a row the validator would reject |
|---|---|
| `sb import beads` | rehydrates rows from an external store whose schema predates, or differs from, the current result payload rules |
| manual `sqlite3` edit | no validation at all |
| interrupted write | a partially written `result_json` |

The class was measured before deciding. On the canonical store (`node:sqlite`, `readOnly: true`, `issue_journal` joined to `issues` and `projects`, validated in JS against `validateResultPayload`'s own rules rather than `json_extract`):

| Check | Rows | Issues |
|---|---|---|
| result payloads scanned | 6,563 | — |
| empty / whitespace / missing / over-long `summary` | 0 | 0 |
| keys outside `RESULT_FIELDS` | 0 | 0 |
| unparsable `result_json` | 0 | — |

**That is "no evidence of the class today", not "the class is closed".** The class is closed for new writes by the validator; it is not closed for writers that bypass it. The decision below therefore governs future data, not a present defect, and no bug is filed while the count is zero.


## Where the code is, without a line number

The three functions this record names live in two files and have all moved at least once while this decision was being written — the result-payload throw alone moved within a day, because a guard commit inserted lines above it. Cite them by symbol:

| Symbol | File |
|---|---|
| `JournalService.listEntries`, and the `.map((r) => this.toEntry(r))` inside it | `packages/substrate/src/service/journal-service.ts` |
| `JournalService.toEntry` — the `fail-closed: invalid result payload` throw | `packages/substrate/src/service/journal-service.ts` |
| `validateResultPayload` and `RESULT_FIELDS` | `packages/substrate/src/domain/journal.ts` |

If a future change makes a symbol unfindable, that is the finding: the policy in this record referenced a function that no longer exists, and the record needs an amendment rather than a corrected offset.

## Options

| # | Read behaviour | One bad row costs | Verdict |
|---|---|---|---|
| 1 | fail the whole read (today) | every row of that issue, in three surfaces | rejected |
| 2 | skip the row silently | nothing visible; history looks complete while a row is missing | rejected — XTRM-420 repeated at a coarser grain |
| 3 | degrade per row with an explicit marker | one line; the rest renders; the marker names the entry and the failure | **adopted** |

## Decision (proposed)

1. **Writes stay fail-closed.** `validateResultPayload`, the write seam and every current writer are unchanged. The decision does not soften what may enter the store.
2. **Reads degrade per row.** An entry that fails validation renders as an explicit marker on that entry's line and does not stop the read:

   ```
   jrn_01a1e8f9-6c85-74d9-b045-a252107191c7 unreadable: result.summary must be a non-empty string
   ```

   The marker carries the entry id and the validator's own message. It is never a summary, never an empty value, and never a status pill.
3. **Every reader of a journal window inherits it, and there are two seams.** `listEntries` serves `journal show` (oldest-first page), the resume capsule's journal section and the console journal panel; `timeline` serves `journal show --tail <ref>` (newest window). Both seams must degrade, because a fix applied to `listEntries` alone leaves `journal show --tail` failing closed on the row the decision says it renders as a marker. The degradation is implemented once per seam, at the service, and tested on both.

### Marker contract

| Property | Rule | Reason |
|---|---|---|
| identifies the entry | `jrn_…` id or sequence, always | an unreadable row the reader cannot name cannot be repaired |
| quotes the validator | the first `problems[]` string, verbatim | the same text a write would have refused, so the cause is diagnosable without the store |
| is not mistakable for content | prefixed `unreadable:`, no truncation badge, no summary-shaped fallback | the XTRM-420 lesson: a plausible label where evidence is missing is worse than an error |
| does not abort siblings | the remaining rows of that issue render in order | the journal is the continuity record; deleting a history to protect one row removes the evidence it exists to hold |
| is counted | the read reports how many entries degraded | a silent partial history is the failure mode being avoided |

## Rejected alternative

**Read-side fail-closed**, on the ground that a partial history must never look complete, is defensible and is why option 1 survived as a candidate. It was rejected because the guarantee it buys — "if you see the history, all of it is valid" — is bought with the failure it is meant to prevent: the reader sees no history at all, on every surface, for an issue whose other 47 rows are perfectly readable. A visible marker with a count preserves the stronger property in practice: every reader knows exactly how much of the record is trustworthy and which entry is not.

## Consequences

- A legacy or imported bad row becomes a visible, named defect on one line rather than an unreadable issue.
- `toEntry` keeps its throw; the degradation lives in the list path, so a single-entry read still fails closed. That asymmetry is deliberate: asking for one entry and receiving a marker would hide a broken row behind a successful-looking call.
- The console panel no longer needs a whole-issue error state for a per-row condition, which removes a class of "journal is broken" reports that are really "row jrn_… is broken".
- No migration, no schema change, no write-path change.

## Open questions

- Whether the degraded count belongs in the resume capsule header or only in the caller's rendering. Deferred to XTRM-827, which owns both surfaces.
- Whether a repair path should exist (rewrite a valid payload for a known-bad row). Out of scope here; it would need its own decision because it edits history.

## References

- XTRM-826 — this decision, with the measurement and the trigger set.
- XTRM-827 — implementation, depends on XTRM-826; must not be implemented before the decision is accepted.
- XTRM-420 — the render defect (`RESULT:` label without evidence) that made the missing-versus-empty distinction load-bearing.
- `packages/substrate/docs/journal-and-resume.md` — the journal's contract for readers.
