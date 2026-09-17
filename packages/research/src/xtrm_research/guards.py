"""Mandatory pre-send guard stage (XTRM-428).

The original research harness ran these checks as an optional, one-off
script (Jira XTRM-99 comment 13408) and got two defects past it: an
over-broad identifier-masking regex that replaced most of a state's plain
text with ``<issue>`` and silently invalidated three runs, and a
credential-bearing issue (MMD-585) sent whole to a remote model because
redaction ran on serialized JSON and broke escape sequences.

:func:`guarded_send` is the package's only remote-send seam: nothing else
in ``xtrm_research`` performs or exposes a network call
(``tests/test_guards.py`` enforces this structurally). Every guard
operates on parsed values, never on serialized JSON, and the whole stage
fails closed — any exception raised anywhere inside it aborts the send.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from xtrm_research.hashing import compute_content_hash

# ---- credential redaction ----------------------------------------------

#: ``KEY=value`` / ``"token": "value"`` style assignments (MMD-585 carried
#: live R2/AWS credentials in exactly this shape).
SECRET_ASSIGN = re.compile(
    r"(?i)\b([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*)"
    r"(\\?[\"']?\s*[:=]\s*\\?[\"']?)([^\s\"'\\,}]{8,})"
)
#: Bare credential-shaped tokens: hex digests, AWS access key ids, long
#: base64-ish blobs.
SECRET_BARE = re.compile(
    r"\b(?:[A-Fa-f0-9]{32}|[A-Fa-f0-9]{60,}|(?:AKIA|ASIA)[A-Z0-9]{16}|[A-Za-z0-9/+]{40,}={0,2})\b"
)

_REDACTED = "<redacted>"


def redact(text: str) -> str:
    """Replace credential-shaped substrings in one parsed string field
    with ``<redacted>``. Never call this on serialized JSON: redacting a
    JSON string's escaped payload can break its escape sequences (the
    deep_mask fix in the original harness exists because of this)."""
    text = SECRET_ASSIGN.sub(lambda m: f"{m.group(1)}{m.group(2)}{_REDACTED}", text)
    return SECRET_BARE.sub(_REDACTED, text)


# ---- known-identifier masking -------------------------------------------

#: Board-id-shaped tokens: lowercase, hyphen-separated, optionally
#: dotted (``t80he.18``). Only tokens present in the caller-supplied
#: ``known_ids`` set are ever replaced — matching the shape alone is not
#: enough, which is what the historical over-broad regex got wrong.
ID_TOKEN = re.compile(r"[a-z0-9][a-z0-9-]*[a-z0-9](?:\.\d+)*")
_PLAIN_WORD = re.compile(r"\b[a-z]{3,}\b")

#: Historical default: at least 98% of plain words must survive masking.
MASK_MIN_SURVIVING_WORD_FRACTION = 0.98


class MaskAbortError(RuntimeError):
    """Masking removed more plain text than the allowed fraction — the
    over-broad-regex defect from XTRM-99 comment 13408. Carries counts
    only, never the text itself."""


def mask(text: str, known_ids: frozenset[str]) -> str:
    """Redact credentials, then replace any token that is a member of
    ``known_ids`` with ``<issue>``. An id-shaped token not in
    ``known_ids`` is left as-is."""
    redacted = redact(text)
    return ID_TOKEN.sub(
        lambda m: "<issue>" if m.group(0) in known_ids else m.group(0), redacted
    )


def check_mask(
    original: str,
    masked: str,
    *,
    min_surviving_fraction: float = MASK_MIN_SURVIVING_WORD_FRACTION,
) -> None:
    """Abort if ``masked`` has fewer than ``min_surviving_fraction`` of
    ``original``'s plain words. Independent of how ``masked`` was
    produced, so a test can reproduce the historical over-broad regex
    directly and assert this catches it."""
    words = _PLAIN_WORD.findall(original)
    if not words:
        return
    surviving = _PLAIN_WORD.findall(masked.replace("<issue>", " "))
    if len(surviving) < min_surviving_fraction * len(words):
        removed = len(words) - len(surviving)
        raise MaskAbortError(
            f"mask removed {removed}/{len(words)} plain words "
            f"(threshold: at least {min_surviving_fraction:.0%} must survive)"
        )


def deep_mask(value: Any, known_ids: frozenset[str]) -> Any:
    """Recursively redact and mask every string field of a parsed
    JSON-like value. Requires a parsed value, never a JSON string."""
    if isinstance(value, str):
        return mask(value, known_ids)
    if isinstance(value, list):
        return [deep_mask(v, known_ids) for v in value]
    if isinstance(value, dict):
        return {k: deep_mask(v, known_ids) for k, v in value.items()}
    return value


def _collect_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [s for item in value for s in _collect_strings(item)]
    if isinstance(value, dict):
        return [s for item in value.values() for s in _collect_strings(item)]
    return []


# ---- label-leak exclusion ------------------------------------------------


@dataclass(frozen=True)
class LabelExclusionRule:
    """Which payload fields hold label lists, and which label prefixes
    must never reach the model (e.g. a ``contract:ready`` label hands the
    model the answer it's meant to derive). ``mode="strip"`` (default)
    drops matching labels; ``mode="reject"`` fails the guard instead."""

    fields: tuple[str, ...] = ("labels",)
    excluded_prefixes: tuple[str, ...] = ("contract:",)
    mode: str = "strip"

    def __post_init__(self) -> None:
        if self.mode not in ("strip", "reject"):
            raise ValueError(
                f"LabelExclusionRule.mode must be 'strip' or 'reject', got {self.mode!r}"
            )


def _is_excluded_label(label: Any, rule: LabelExclusionRule) -> bool:
    return isinstance(label, str) and label.startswith(rule.excluded_prefixes)


def _has_excluded_label(value: Any, rule: LabelExclusionRule) -> bool:
    if isinstance(value, dict):
        for k, v in value.items():
            if k in rule.fields and isinstance(v, list):
                if any(_is_excluded_label(label, rule) for label in v):
                    return True
            elif _has_excluded_label(v, rule):
                return True
        return False
    if isinstance(value, list):
        return any(_has_excluded_label(item, rule) for item in value)
    return False


def strip_excluded_labels(value: Any, rule: LabelExclusionRule) -> Any:
    """Recursively drop excluded-prefix labels from every list found
    under one of ``rule.fields``."""
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if k in rule.fields and isinstance(v, list):
                out[k] = [label for label in v if not _is_excluded_label(label, rule)]
            else:
                out[k] = strip_excluded_labels(v, rule)
        return out
    if isinstance(value, list):
        return [strip_excluded_labels(item, rule) for item in value]
    return value


# ---- guard versions -------------------------------------------------------


def redaction_version() -> str:
    """Content hash of the active credential-redaction rule set."""
    return compute_content_hash(
        {"secret_assign": SECRET_ASSIGN.pattern, "secret_bare": SECRET_BARE.pattern}
    )


def mask_version(label_rule: LabelExclusionRule | None = None) -> str:
    """Content hash of the active id-masking + label-exclusion rule set."""
    rule = label_rule or LabelExclusionRule()
    return compute_content_hash(
        {
            "id_token": ID_TOKEN.pattern,
            "min_surviving_word_fraction": MASK_MIN_SURVIVING_WORD_FRACTION,
            "label_fields": list(rule.fields),
            "label_excluded_prefixes": list(rule.excluded_prefixes),
            "label_mode": rule.mode,
        }
    )


def guard_versions(label_rule: LabelExclusionRule | None = None) -> dict[str, str]:
    """The ``manifest.guards`` block: content-hash versions of every
    active guard rule set. Never hand-set — a changed rule always
    produces a different version."""
    return {
        "mask_version": mask_version(label_rule),
        "redaction_version": redaction_version(),
    }


# ---- cache key -------------------------------------------------------------


def cache_key(payload: dict[str, Any], guards: dict[str, str]) -> str:
    """Cache key for a guarded request: folds the active guard rule
    versions into the key, so a changed redaction or mask rule can never
    be served from an entry cached under an earlier rule set. Consumed by
    XTRM-432's cache."""
    return compute_content_hash({"payload": payload, "guards": guards})


# ---- guard failure ----------------------------------------------------------


class GuardFailure(RuntimeError):
    """A guard rejected the payload, or the guard stage raised
    unexpectedly (fail closed). Carries only the failing guard's name and
    non-secret counts — never a payload value."""

    def __init__(self, guard: str, reason: str, **counts: int) -> None:
        self.guard = guard
        self.counts = counts
        message = f"guard {guard!r} failed: {reason}"
        if counts:
            message += f" ({counts})"
        super().__init__(message)


# ---- the one remote-send seam ----------------------------------------------


def guarded_send(
    payload: dict[str, Any],
    send: Callable[[dict[str, Any]], Any],
    *,
    known_ids: frozenset[str] = frozenset(),
    label_rule: LabelExclusionRule | None = None,
    schema_kind: str | None = None,
) -> Any:
    """Run every guard against ``payload``; only on success, call
    ``send(payload)`` with the guarded payload and return its result.

    This is the package's only remote-send seam. Fails closed: a guard
    rejection or any unexpected exception inside the guard stage raises
    :class:`GuardFailure` and ``send`` is never called.
    """
    rule = label_rule or LabelExclusionRule()
    try:
        guarded = _run_guards(payload, known_ids, rule, schema_kind)
    except GuardFailure:
        raise
    except (
        Exception
    ) as exc:  # fail closed: no guard exception may reach the caller unwrapped
        raise GuardFailure("guard_stage", f"unexpected {type(exc).__name__}") from exc
    return send(guarded)


def _run_guards(
    payload: dict[str, Any],
    known_ids: frozenset[str],
    rule: LabelExclusionRule,
    schema_kind: str | None,
) -> dict[str, Any]:
    if rule.mode == "reject" and _has_excluded_label(payload, rule):
        raise GuardFailure("labels", "payload contains an excluded label")
    stripped = strip_excluded_labels(payload, rule)

    guarded = deep_mask(stripped, known_ids)
    try:
        check_mask(
            "\n".join(_collect_strings(stripped)), "\n".join(_collect_strings(guarded))
        )
    except MaskAbortError as exc:
        raise GuardFailure("mask", str(exc)) from exc

    if schema_kind is not None:
        from xtrm_research.schemas import SchemaValidationError, validate

        try:
            validate(schema_kind, guarded)
        except SchemaValidationError as exc:
            raise GuardFailure(
                "schema", f"payload failed {schema_kind!r} validation"
            ) from exc

    return guarded


# ---- runner integration -----------------------------------------------------


def send_through_run(
    handle: Any,
    seq: int,
    payload: dict[str, Any],
    send: Callable[[dict[str, Any]], Any],
    *,
    known_ids: frozenset[str] = frozenset(),
    label_rule: LabelExclusionRule | None = None,
    schema_kind: str | None = None,
) -> Any:
    """Guard ``payload`` and send it through ``handle``'s run.

    On success, records a ``guard_pass`` event carrying the guard
    versions. On :class:`GuardFailure`, records a ``guard_failure`` event
    with the failing guard's name and counts (no secret values), marks
    the run ``invalid`` through the existing :class:`~xtrm_research.runner.RunHandle`
    API — no new write path around its lock — and re-raises. ``send`` is
    never called before the guard stage has passed.
    """
    versions = guard_versions(label_rule)
    try:
        result = guarded_send(
            payload,
            send,
            known_ids=known_ids,
            label_rule=label_rule,
            schema_kind=schema_kind,
        )
    except GuardFailure as exc:
        handle.write_event(
            {
                "schema_version": "xtrm-research-event/v1",
                "seq": seq,
                "ts": _now_iso(),
                "kind": "guard_failure",
                "data": {"guard": exc.guard, "counts": exc.counts, **versions},
            }
        )
        handle.finish("invalid")
        raise
    handle.write_event(
        {
            "schema_version": "xtrm-research-event/v1",
            "seq": seq,
            "ts": _now_iso(),
            "kind": "guard_pass",
            "data": versions,
        }
    )
    return result


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
