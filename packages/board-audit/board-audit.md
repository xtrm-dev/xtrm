# board-audit — mini operational manual

**Location:** `~/bin/board-audit` (symlinked to `~/.local/bin/board-audit`).
**Purpose:** Export the local `bd` board + relevant merged PRs into a single ChatGPT-web-friendly bundle for periodic board audits (silent-ship detection, dependency rewiring, stale-tone sweeps, description criticism, existing-lib reuse suggestions, etc.).
**Origin:** Extracted from the 2026-07-22 infra ChatGPT audit workstream (see closed beads `infra-1evu`, `infra-koe2`, `infra-bkr7`, `infra-0chg`).

---

## Run

```bash
cd <any-mercury-repo>       # must be a git working tree with bd + gh set up
board-audit
```

Takes ~2 min on a ~200-PR repo. Overwrites the bundle on re-run.

## Output

Single file to attach to ChatGPT web:

```
/tmp/board-audit-<repo>/audit-bundle-YYYYMMDD.md
```

Intermediate files kept alongside (useful if you want to iterate on the prompt without re-exporting data):

```
/tmp/board-audit-<repo>/
├── audit-bundle-YYYYMMDD.md   ← attach THIS
├── audit-prompt.md            ← prompt only (edit + re-bundle if refining)
├── beads.jsonl                ← all non-closed beads
├── prs.md                     ← per-PR markdown (full body + all commits)
└── current-state.md           ← bd stats snapshot
```

## What ends up in the bundle

1. **Prompt** — 6-bucket classification (A live / B silently shipped / C superseded / D stale / E blocked-in-fact / F ambiguous) + 13 additional passes:
   1. Description criticism (ponytail + YAGNI)
   2. Dependency rewiring (orphans, cycles, priority inversions)
   3. Codebase drift verification
   4. Metric-emission verification (via Prometheus MCP)
   5. Jira ↔ bd cross-check
   6. Sister-repo relocation candidates
   7. Silent supersedes
   8. Zombie epics
   9. Stale-tone sweep
   10. Follow-ups gap
   11. Duplicate / adjacent detection
   12. Hard validation / no-regression check
   13. Existing-library / helper reuse suggestions
2. **beads.jsonl** — every non-closed bead with full fields
3. **prs.md** — merged PRs since `min(bead.created) - 7d`, each with:
   - Number, title, mergedAt, author, URL
   - Files changed with +/- line counts
   - **Full body** (not truncated)
   - **All commits** with short SHA + headline

## Auto-window (why the PR count varies)

The PR window is scoped to the oldest open bead's creation date minus a 7-day buffer. If the oldest bead is 75 days old you get ~75 days of PRs; if the board is fresh you get 90 days as a fallback. This guarantees the silent-ship detection window is complete without wasting API calls on PRs older than any open bead.

## Overrides

Rarely needed:

```bash
BOARD_AUDIT_PR_SINCE=2026-01-01 board-audit    # explicit start date
BOARD_AUDIT_PR_LIMIT=1000 board-audit          # raise the 500-PR safety cap
```

## Using the output on ChatGPT web

1. Open a ChatGPT web session with browsing + tool use (Pro tier).
2. Attach the single bundle file.
3. Type: **"run the audit"**.
4. Wait ~15–25 minutes for it to work through all 6 buckets + 13 passes.
5. Paste the resulting audit back to whichever coordinator agent will execute the recommendations.

The prompt tells ChatGPT to use its GitHub, Jira, and web-search tools to verify claims (PR state, file existence, metric emission, Jira sync). If a bead can't be verified, it goes into bucket F rather than being closed by inference.

## What to do with the audit result

Feed it back to a Claude/pi session in the repo with:

> "here is a ChatGPT audit of the board — execute the mechanical B/C/D/E findings in a batch, surface only genuinely-operator decisions at the end"

The 2026-07-22 infra run reduced the open board from 108 → 68 beads (−37%) in a single session with this pattern.

## Pitfalls / gotchas

- **Zsh PATH:** if `board-audit` isn't found, `~/bin` isn't on your interactive PATH. The install symlinks to `~/.local/bin` which is normally on PATH; if not, `hash -r` after installing.
- **Cardinality trap:** `gh pr list --json commits` collapses above ~50 PRs. The script side-steps by doing a cheap-list first then a per-PR `gh pr view` loop.
- **Bundle size:** ~600K for 200 PRs. ChatGPT web handles it. If you hit an upload limit, drop `BOARD_AUDIT_PR_LIMIT` or narrow `PR_SINCE`.
- **Empty board:** falls back to 90d-ago PR window.
- **gh auth expired:** the PR loop will spam warnings; re-auth with `gh auth login`.

## Iterating on the prompt

The prompt lives inline in the script inside a `<<'PROMPT_EOF'` heredoc. Edit `~/bin/board-audit` directly. Placeholders substituted at emit time:

- `%REPO%` — GitHub owner/name
- `%DATE%` — today
- `%BEAD_COUNT%` — non-closed bead count
- `%PR_LIMIT%` — safety cap
- `%PR_SINCE%` — auto-computed start date

## Related memories

- `board-audit-tool` (bd remember key) — feature-level notes on this tool
- `feedback_no_premature_readiness_claims` — audit ships defaults, operator ratifies
- `feedback_coordinator_acts_doesnt_ask` — execute B/C/D mechanically, surface only genuine decisions

---

*Filename note: this folder is `zettlekasten/` on disk; canonical German spelling is **Zettelkasten** (Zettel = slip, Kasten = box). Fix at rename-time only — no reason to touch it now.*
