# pq1_3 — coordinator declared observability UNAVAILABLE from scratchpad mirror

## ROOT_CAUSE
The SRE chain ran against a `/tmp/...` mirror of the mercury infra repo whose
ancestor chain contains no `.mcpq.json`. `mcpq` walks up from `cwd` with
ceiling `$HOME`, so bare `mcpq` from the mirror errored before it could
contact the sidecars. The shared `sre-triage` skill only documents the
"sidecars unreachable" failure mode, so the coordinator (which follows the
skill literally) mistook the config-not-found error for observability being
down and returned `UNAVAILABLE`. The observability-analyst had learned the
`--config` workaround out-of-band, which is why the two specialists
disagreed.

## FIX_SUMMARY
Add one paragraph to the shared `sre-triage` SKILL.md, right before the
existing "Fallback when mcpq is unreachable" note, that names this failure
mode explicitly and gives the exact workaround
(`mcpq --config <target-infra>/.mcpq.json <subcommand>`) with a mercury
example. Editing the shared skill fixes both specialists in one place — the
coordinator and the observability-analyst both route through it — so no
per-specialist prompt changes are needed. Note: this edit invalidates any
frozen SHA256 fingerprints captured on `sre-triage` at chain start; future
chain runs will recapture on the updated content.

## FILES_TOUCHED
- `/home/dawid/.xtrm/skills/default/sre-triage/SKILL.md` (insert 9 lines
  after existing "Container -> repo attribution ..." paragraph, before
  "Fallback when mcpq is unreachable")

## TEST_PLAN
1. Apply the patch: `patch -p1 -d / < pq1_3.patch` (dry-run confirmed clean).
2. Re-run the smoke against the mirror at
   `/tmp/claude-1000/-home-dawid-dev-xtrm/a27124c7-.../scratchpad/mercury-infra-mirror`.
   Coordinator should now attempt `mcpq --config /home/dawid/projects/mercury/.mcpq.json ...`
   after the initial bare-`mcpq` failure and NOT return `UNAVAILABLE`.
3. Confirm both `sre-coordinator` and `sre-observability-forensics`
   specialists produce matching observability sections (no PARTIAL from the
   reviewer for the coordinator/observability mismatch on this axis).
4. Manual sanity check outside the chain:
   `cd /tmp && mcpq servers` -> expected to error (no ancestor .mcpq.json).
   `cd /tmp && mcpq --config /home/dawid/projects/mercury/.mcpq.json servers` -> lists sidecars.
5. Expect fingerprint mismatch on any run that captured a pre-fix
   `sre-triage` SHA256; that is the intended invalidation.
