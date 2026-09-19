# Sanitized run snapshot

Source: `/home/dawid/.xtrm/research/runs`

Every string value in every copied file is redacted with `xtrm_research.guards.redact`, the same rule
that decides what may be sent to a model — including local absolute paths in the manifest and status.
Structure, keys and numbers are unchanged, so the copy is still readable by `xtrm-research` and by
xtrm-app. Each written row is re-checked after redaction and the copy fails closed otherwise.

Runs: 8. Redacted values: 5950.

This directory is shareable. It is **not** the evidence of record: the original run directory under
the runs root is, and it stays outside git because it holds private board text.
