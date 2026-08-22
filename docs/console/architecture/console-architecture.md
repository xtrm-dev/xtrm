# Console Architecture — external authority pointer

> **Status:** POINTER / NON-NORMATIVE in `xtrm-dev/xtrm` as of 2026-08-22.  
> **Owning repository:** `Jaggerxtrm/console`  
> **Canonical document:** https://github.com/Jaggerxtrm/console/blob/main/docs/architecture/console-architecture.md

The former XTRM copy is retired because it described the bridge-era `apps/gitboard` hosting model after Console had moved to `apps/console` as the production host/runtime. Keeping two editable architecture copies created a direct authority conflict (runtime canonicalization finding C-3).

Cross-domain XTRM invariants still apply: Console is a read/control projection over upstream authorities; it must not become ChainRun, Channels, Beads, Git, telemetry, or scheduler authority. See `docs/runtime/README.md` and the native runtime PRD.

Use Git history for the former XTRM-hosted copy; do not update this pointer with Console implementation details.