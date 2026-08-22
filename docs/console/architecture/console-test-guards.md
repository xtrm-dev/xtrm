# Console Test Guards — external authority pointer

> **Status:** POINTER / NON-NORMATIVE in `xtrm-dev/xtrm` as of 2026-08-22.  
> **Owning repository:** `Jaggerxtrm/console`  
> **Canonical document:** https://github.com/Jaggerxtrm/console/blob/main/docs/architecture/console-test-guards.md

Console-owned implementation guards live with the application they protect. XTRM owns upstream runtime/telemetry invariants and may require Console compatibility fixtures, but must not maintain a second editable copy of the Console test-guard contract.

Use Git history for the former XTRM copy.