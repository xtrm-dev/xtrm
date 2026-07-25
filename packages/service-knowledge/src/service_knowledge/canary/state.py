"""Canary state file: read / write / classify.

Schema: ``{enabled: bool, classes: [str], enabled_at: iso_ts, enabled_by: str}``.
Location: ``<consumer>/.xtrm/state/service-knowledge/canary.json`` (per-repo,
gitignored). Missing / unreadable / malformed → treated as disabled (fail-closed).

The class taxonomy is the policy taxonomy from
``docs/devops/service-knowledge-canary.md`` §2, not the verifier's `ClaimType`
enum directly. ``class_for_claim_type()`` bridges the two.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

# Policy classes (docs/devops/service-knowledge-canary.md §2.1 / §2.2).
ALLOWED_CLASSES: frozenset[str] = frozenset({
    "path", "symbol", "literal", "env-var", "image", "config-value",
})
FORBIDDEN_CLASSES: frozenset[str] = frozenset({
    "causal", "procedure", "security-posture", "complete-set-critical",
})

# Bridge verifier ClaimType.value -> canary class name.
# Unknown / unmapped types fall through to a sentinel that is never in
# ALLOWED_CLASSES, so fail-closed is the default.
CLAIM_TYPE_TO_CLASS: dict[str, str] = {
    "quoted_literal": "literal",
    "environment_constant": "env-var",
    "symbol_name": "symbol",
    "config_value": "config-value",
    "compose_resource": "image",
    "procedure_claim": "procedure",
    "causal_claim": "causal",
    # set_claim, citation_claim, metric_*, runtime_claim, external_claim,
    # metric_label_set, metric_family: intentionally not mapped → not auto-merged.
}


def state_dir(consumer_root: Path) -> Path:
    return consumer_root / ".xtrm" / "state" / "service-knowledge"


def state_file_path(consumer_root: Path) -> Path:
    return state_dir(consumer_root) / "canary.json"


def log_path(consumer_root: Path) -> Path:
    return state_dir(consumer_root) / "canary.jsonl"


@dataclass(frozen=True)
class CanaryState:
    """Runtime canary status. ``enabled`` is authoritative: any doubt yields
    ``CanaryState(enabled=False, classes=frozenset())``."""

    enabled: bool = False
    classes: frozenset[str] = field(default_factory=frozenset)
    enabled_at: str = ""
    enabled_by: str = ""

    @property
    def is_active(self) -> bool:
        return bool(self.enabled and self.classes)

    def to_dict(self) -> dict:
        return {
            "enabled": self.enabled,
            "classes": sorted(self.classes),
            "enabled_at": self.enabled_at,
            "enabled_by": self.enabled_by,
        }


DISABLED = CanaryState()


def read_state(consumer_root: Path) -> CanaryState:
    """Fail-closed read. Any error / doubt → DISABLED. Never raises."""
    path = state_file_path(consumer_root)
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, FileNotFoundError):
        return DISABLED
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        _append_log(consumer_root, {"event": "fail_closed", "reason": "json_decode_error"})
        return DISABLED
    if not isinstance(data, dict):
        _append_log(consumer_root, {"event": "fail_closed", "reason": "not_object"})
        return DISABLED
    enabled = bool(data.get("enabled", False))
    raw_classes = data.get("classes", [])
    if not isinstance(raw_classes, list) or not all(isinstance(c, str) for c in raw_classes):
        _append_log(consumer_root, {"event": "fail_closed", "reason": "invalid_classes"})
        return DISABLED
    # Intersect the operator's declared list with the policy allow-list.
    # Anything outside the allow-list is silently dropped — narrow enable is safe;
    # widening the allow-list requires editing this module + the policy doc.
    safe_classes = frozenset(c for c in raw_classes if c in ALLOWED_CLASSES)
    if enabled and not safe_classes:
        _append_log(consumer_root, {"event": "fail_closed", "reason": "no_allowed_classes"})
        return DISABLED
    enabled_at = data.get("enabled_at", "") or ""
    enabled_by = data.get("enabled_by", "") or ""
    if not isinstance(enabled_at, str) or not isinstance(enabled_by, str):
        _append_log(consumer_root, {"event": "fail_closed", "reason": "invalid_meta"})
        return DISABLED
    return CanaryState(
        enabled=enabled,
        classes=safe_classes,
        enabled_at=enabled_at,
        enabled_by=enabled_by,
    )


def write_state(consumer_root: Path, state: CanaryState) -> Path:
    """Atomic-ish write (parent mkdir + write). Returns the file path."""
    path = state_file_path(consumer_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state.to_dict(), indent=2) + "\n", encoding="utf-8")
    return path


def append_log(
    consumer_root: Path,
    event: str,
    *,
    classes: list[str] | None = None,
    enabled_by: str = "",
    thresholds: dict | None = None,
    git_commit: str = "",
) -> dict:
    """Append one canary audit line. Never raises into the caller."""
    return _append_log(
        consumer_root,
        {
            "event": event,
            "classes": sorted(classes or []),
            "enabled_by": enabled_by,
            "thresholds_at_enable_time": thresholds or {},
            "git_commit": git_commit,
        },
    )


def _append_log(consumer_root: Path, extra: dict) -> dict:
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "component": "canary",
        **extra,
    }
    try:
        path = log_path(consumer_root)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, separators=(",", ":")) + "\n")
    except OSError:
        pass
    return record


def class_for_claim_type(claim_type_value: str) -> str:
    """Bridge verifier ``ClaimType.value`` -> canary class name.

    Unknown / unmapped types yield a sentinel that never belongs to
    ALLOWED_CLASSES, so the reconcile canary check treats them as non-eligible
    (fail-closed)."""
    return CLAIM_TYPE_TO_CLASS.get(claim_type_value, f"unmapped:{claim_type_value}")


def is_diff_class_eligible(claim_type_values: list[str], enabled: frozenset[str]) -> tuple[bool, str]:
    """Return ``(eligible, reason)`` for the whole diff.

    Eligible only when every claim maps to a class inside ``enabled`` AND
    ``enabled`` is a non-empty subset of ALLOWED_CLASSES. Any forbidden or
    unmapped class rejects the whole diff."""
    if not enabled:
        return False, "no_enabled_classes"
    if not enabled.issubset(ALLOWED_CLASSES):
        return False, "enabled_class_outside_allow_list"
    for value in claim_type_values:
        cls = class_for_claim_type(value)
        if cls in FORBIDDEN_CLASSES:
            return False, f"forbidden_class:{cls}"
        if cls not in enabled:
            return False, f"non_enabled_class:{cls}"
    return True, "ok"
