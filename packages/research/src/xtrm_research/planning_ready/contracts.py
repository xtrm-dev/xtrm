"""Deterministic structural checks over Substrate work contracts.

This is a faithful research-side mirror of the incumbent deterministic
validator, ``packages/substrate/src/domain/contract.ts``
``validateContractStructure``: the same seven fields, the same finding codes
and the same message text, so a research run's deterministic channel and
Substrate's own machine reasons are directly comparable. The mirror is
verified against the incumbent in the dataset builder (agreement over every
sampled current revision) and that agreement is recorded as evidence.

Nothing here is a semantic judgment: a fact this module can prove exactly is
never asked of a System One model. The only inputs are the contract revision
itself — never the issue's current state, later revisions, or later
outcomes — so a historical revision is judged on what it said.
"""

from __future__ import annotations

import re
from typing import Any

#: Mirrors PLACEHOLDER_RE in contract.ts.
PLACEHOLDER_RE = re.compile(r"\b(TBD|TODO|XXX|FIXME)\b", re.IGNORECASE)

SCRUTINY_LEVELS = ("LOW", "MEDIUM", "HIGH", "CRITICAL")

REQUIRED_SECTIONS = (
    "problem",
    "success",
    "scope",
    "nonGoals",
    "constraints",
    "validation",
    "output",
)

OPTIONAL_SECTIONS = (
    "libraries",
    "references",
    "telemetry",
    "rollback",
    "dependencies",
)

OWNERSHIP_FIELDS = ("repositories", "paths", "services", "interfaces")


def _non_empty_strings(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) > 0
        and all(isinstance(e, str) and e.strip() != "" for e in value)
    )


def _check_placeholders(
    findings: list[dict[str, str]], field: str, values: list[Any]
) -> None:
    """One finding per field at most, matching the incumbent's early return."""
    for value in values:
        if isinstance(value, str) and PLACEHOLDER_RE.search(value):
            findings.append(
                {
                    "field": field,
                    "code": "placeholder",
                    "message": f"{field} contains an unresolved marker",
                }
            )
            return


def validate_ownership(ownership: Any) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    if ownership is None:
        return out
    if not isinstance(ownership, dict):
        return [
            {
                "field": "ownership",
                "code": "ownership-shape",
                "message": "ownership must be an object",
            }
        ]
    for field in OWNERSHIP_FIELDS:
        value = ownership.get(field)
        if value is None:
            continue
        if not _non_empty_strings(value):
            out.append(
                {
                    "field": f"ownership.{field}",
                    "code": "ownership-shape",
                    "message": f"ownership.{field} must be an array of non-empty strings",
                }
            )
    return out


def validate_context_refs(refs: Any) -> list[dict[str, str]]:
    if refs is None:
        return []
    if not isinstance(refs, list):
        return [
            {
                "field": "contextRefs",
                "code": "context-shape",
                "message": "contextRefs must be an array",
            }
        ]
    out: list[dict[str, str]] = []
    for i, entry in enumerate(refs):
        at = f"contextRefs[{i}]"
        if not isinstance(entry, dict) or not isinstance(entry.get("key"), str) or not entry["key"].strip():
            out.append(
                {
                    "field": at,
                    "code": "context-shape",
                    "message": f"{at} must be an object with a non-empty string key",
                }
            )
            continue
        if "value" not in entry or entry["value"] is None:
            out.append(
                {
                    "field": at,
                    "code": "context-shape",
                    "message": f"{at} must define a value",
                }
            )
        kind = entry.get("kind")
        if kind is not None and (not isinstance(kind, str) or not kind.strip()):
            out.append(
                {
                    "field": at,
                    "code": "context-shape",
                    "message": f"{at}.kind must be a non-empty string when present",
                }
            )
        elif kind in ("journal", "memory"):
            out.append(
                {
                    "field": at,
                    "code": "journal-authority",
                    "message": f'{at} uses kind "{kind}": journal entries are continuity, never planning authority',
                }
            )
    return out


def structural_findings(
    contract: Any,
    scrutiny: Any = None,
    ownership: Any = None,
    context_refs: Any = None,
    lifecycle_state: Any = None,
) -> list[dict[str, str]]:
    """Deterministic structural findings for one contract revision.

    Empty means structurally valid. Never raises on malformed input: a
    malformed contract is a finding, not a crash.
    """
    if not isinstance(contract, dict):
        return [
            {
                "field": "contract",
                "code": "contract-shape",
                "message": "contract must be an object",
            }
        ]
    findings: list[dict[str, str]] = []
    for field in ("problem", "success"):
        value = contract.get(field)
        if not isinstance(value, str) or value.strip() == "":
            findings.append(
                {
                    "field": field,
                    "code": "required-field",
                    "message": f"{field} must be a non-empty string",
                }
            )
    for field in ("scope", "nonGoals", "constraints"):
        if not _non_empty_strings(contract.get(field)):
            findings.append(
                {
                    "field": field,
                    "code": "required-field",
                    "message": f"{field} must be a non-empty array of non-empty strings",
                }
            )
    validation = contract.get("validation")
    if (
        not isinstance(validation, list)
        or len(validation) == 0
        or any(
            not isinstance(e, dict)
            or not isinstance(e.get("check"), str)
            or e["check"].strip() == ""
            for e in validation
        )
    ):
        findings.append(
            {
                "field": "validation",
                "code": "required-field",
                "message": "validation must be a non-empty array of { check: non-empty string }",
            }
        )
    output = contract.get("output")
    if (
        not isinstance(output, list)
        or len(output) == 0
        or any(
            not isinstance(e, dict)
            or not isinstance(e.get("artifact"), str)
            or e["artifact"].strip() == ""
            for e in output
        )
    ):
        findings.append(
            {
                "field": "output",
                "code": "required-field",
                "message": "output must be a non-empty array of { artifact: non-empty string }",
            }
        )
    _check_placeholders(findings, "problem", [contract.get("problem")])
    _check_placeholders(findings, "success", [contract.get("success")])
    for field in ("scope", "nonGoals", "constraints"):
        value = contract.get(field)
        if isinstance(value, list):
            _check_placeholders(findings, field, value)
    if isinstance(validation, list):
        _check_placeholders(
            findings,
            "validation",
            [e.get("check") if isinstance(e, dict) else None for e in validation],
        )
    if isinstance(output, list):
        _check_placeholders(
            findings,
            "output",
            [e.get("artifact") if isinstance(e, dict) else None for e in output],
        )
    if scrutiny not in SCRUTINY_LEVELS:
        findings.append(
            {
                "field": "scrutiny",
                "code": "scrutiny-reference",
                "message": f"scrutiny must be one of {', '.join(SCRUTINY_LEVELS)}",
            }
        )
    findings.extend(validate_ownership(ownership))
    findings.extend(validate_context_refs(context_refs))
    if lifecycle_state is not None and (
        not isinstance(lifecycle_state, str) or lifecycle_state.strip() == ""
    ):
        findings.append(
            {
                "field": "lifecycleState",
                "code": "lifecycle-state",
                "message": "lifecycle state must be a non-empty string",
            }
        )
    return findings


def is_structurally_valid(**kwargs: Any) -> bool:
    return len(structural_findings(**kwargs)) == 0


# --- contract rendering and reference extraction ----------------------------


def _as_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [str(e) for e in value if isinstance(e, str)]
    return []


#: Canonical section labels for rendering: the contract's own names, not a
#: mechanical upper-casing (which would render NONGOALS).
SECTION_LABELS = {
    "problem": "PROBLEM",
    "success": "SUCCESS",
    "scope": "SCOPE",
    "nonGoals": "NON_GOALS",
    "constraints": "CONSTRAINTS",
    "validation": "VALIDATION",
    "output": "OUTPUT",
}


def contract_text(contract: dict[str, Any]) -> str:
    """The contract rendered for System One state: section-labelled prose,
    exactly the seven sections plus any optional section the revision carries.
    The state a question sees is the revision's own text."""
    lines: list[str] = []
    for field in REQUIRED_SECTIONS:
        label = SECTION_LABELS[field]
        value = contract.get(field)
        if field in ("problem", "success"):
            lines.append(f"{label}: {value if isinstance(value, str) else ''}")
        elif field in ("scope", "nonGoals", "constraints"):
            lines.append(f"{label}:")
            lines.extend(f"- {item}" for item in _as_strings(value))
        elif field == "validation":
            lines.append(f"{label}:")
            for entry in value if isinstance(value, list) else []:
                if isinstance(entry, dict):
                    lines.append(f"- {entry.get('check', '')}")
        elif field == "output":
            lines.append(f"{label}:")
            for entry in value if isinstance(value, list) else []:
                if isinstance(entry, dict):
                    lines.append(f"- {entry.get('artifact', '')}")
    for field in OPTIONAL_SECTIONS:
        value = contract.get(field)
        if value:
            lines.append(f"{field.upper()}:")
            lines.extend(f"- {item}" for item in _as_strings(value))
    return "\n".join(lines)
#: A repository path as it appears in contract text: a token with a slash and a
#: file-ish tail, or a bare known directory prefix. Deliberately conservative —
#: a false extraction would be a false deterministic finding.
PATH_RE = re.compile(
    r"(?<![\w/.-])((?:[\w.-]+/)+[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|sh|md|json|yml|yaml|toml|sql))"
)
#: A Substrate issue locator, e.g. XTRM-123, CORE-88.
LOCATOR_RE = re.compile(r"\b([A-Z][A-Z0-9]{1,15}-\d+)\b")


def referenced_paths(contract: dict[str, Any]) -> list[str]:
    """Repository paths named anywhere in the contract, deduplicated in
    first-seen order. Only the sections, never title or provenance."""
    text = contract_text(contract)
    seen: dict[str, None] = {}
    for match in PATH_RE.finditer(text):
        seen.setdefault(match.group(1), None)
    return list(seen)


def referenced_locators(contract: dict[str, Any]) -> list[str]:
    text = contract_text(contract)
    seen: dict[str, None] = {}
    for match in LOCATOR_RE.finditer(text):
        seen.setdefault(match.group(1), None)
    return list(seen)
