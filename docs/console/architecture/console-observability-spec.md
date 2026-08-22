# Console Observability Spec — external authority pointer

> **Status:** POINTER / NON-NORMATIVE in `xtrm-dev/xtrm` as of 2026-08-22.  
> **Owning repository:** `Jaggerxtrm/console`  
> **Canonical document:** https://github.com/Jaggerxtrm/console/blob/main/docs/architecture/console-observability-spec.md

The former XTRM copy drifted from the deployed Console ownership model. The Console repository now owns the implementation-level observability/read-model specification.

XTRM continues to own the upstream contracts that Console consumes, including `xtrm.forensic.v1`, Prometheus projection policy, ChainRun/runtime semantics, Channels semantics, and evidence identity. Console may materialize/read/project those contracts; it does not become their producer or authority.

Use Git history for the former XTRM copy.