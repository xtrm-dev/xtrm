# Skill drift evidence

Frozen at chain start (03:48:26Z):

    role=chain-coordinator
    skill=/home/dawid/.xtrm/skills/default/sre-triage/SKILL.md
    sha256=87c99ed01314d79ebb6856d38e31680214a83529cc2fbfe83198627271997453

On disk at coordinator-close dispatch (04:36:29Z):

    same path
    sha256=9877c5a24c2c3a3fd7b393f8d2c52dcbc211546c93b7504d1a40c369d30b498e

Runtime response (correct — this is the guard firing as designed):

    FAIL dispatch threw: Specialist skill drift for role=chain-coordinator ...
    Start a new ChainRun/revision instead of mutating cognition in-place.

Cause: a concurrent fork agent was writing per-run reports scaffolding into the
`sre-triage` skill. Not a chain runtime bug. The `--specialist-json required`
mode is contractually obligated to refuse dispatch on cognition drift.
