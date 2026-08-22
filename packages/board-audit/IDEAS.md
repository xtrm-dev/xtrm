# 210926 - SEPARATE PERMANENT WORKTREES FOR BOARD AUDIT
instead of piping a board audit with an ad-hoc pr, ad hoc worktree each time, like now, what if instead it would get a permanent one with a branch, like board-audit-export-do-not-cancel, it could even be an empty one with just board audit assets, where a push is triggered on given events like pushes or prs on other branches? This way lots of machinery gets eliminated likely. 
Beads do not care if there are any files in the tree as the command bd worktree create gives a permanent access to the base dolt db server instead.
Problem is, the server connection that remains open in this case, if it does, could give any problems?

STATUS: IMPLEMENTED (2026-08-22). Shipped as `board-audit-export-wt`
(permanent orphan worktrees under ~/.cache/xtrm/board-audit/export-
worktrees/<slug>, artifact branch board-audit-export-do-not-cancel per repo,
flock serialization, raw-beads.jsonl byte-compare no-op detection, retention
keep-3) and `board-audit-fanout` (loops all ~/projects/mercury repos with
.beads/ + origin), fired by systemd user timer board-audit-fanout.timer
every 15 min. All 12 mercury repos publish through it. Beads trail:
xtrm-cv3 (prototype), xtrm-957 (fanout + timer), both closed. The open
server-connection concern did not materialize: bd access goes through git
common-directory discovery per invocation, not a long-lived connection.