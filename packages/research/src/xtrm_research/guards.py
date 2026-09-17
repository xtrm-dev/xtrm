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

Every ``raise ... from None`` in this module is deliberate: the failure
is always constructed and raised *after* the ``except`` block that caught
the underlying cause has finished, specifically so the underlying
exception never becomes ``__context__`` on the ``GuardFailure`` a caller
sees — a jsonschema or masking exception's own message can otherwise
carry payload text.
"""

from __future__ import annotations

import inspect
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Iterable

from xtrm_research.hashing import compute_content_hash

# ---- credential redaction ----------------------------------------------

#: ``KEY=value`` / ``"token": "value"`` style assignments (MMD-585 carried
#: live R2/AWS credentials in exactly this shape). The value class also
#: accepts a quoted value containing spaces.
SECRET_ASSIGN = re.compile(
    r"(?i)\b([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*)"
    r"(\\?[\"']?\s*[:=]\s*)"
    r"(?:\"[^\"]{8,}\"|'[^']{8,}'|[^\s\"'\\,}]{8,})"
)
#: Bare credential-shaped tokens: hex digests, AWS access key ids,
#: known provider token prefixes (GitHub, Slack, Stripe, Google, npm,
#: GitLab), a JWT, and a long base64-ish blob. The base64 alternative uses
#: lookaround instead of ``\b`` so a token starting or ending with ``+``
#: or ``/`` (neither a word character, so ``\b`` never anchors there) is
#: still caught.
SECRET_BARE = re.compile(
    r"(?:"
    r"\b[A-Fa-f0-9]{32}\b"
    r"|\b[A-Fa-f0-9]{60,}\b"
    r"|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"
    r"|\bgh[pousr]_[A-Za-z0-9]{20,}\b"
    r"|\bgithub_pat_[A-Za-z0-9_]{20,}\b"
    r"|\bxox[baprs]-[A-Za-z0-9-]{10,}\b"
    r"|\bsk_(?:live|test)_[A-Za-z0-9]{10,}\b"
    r"|\bAIza[A-Za-z0-9_-]{30,}\b"
    r"|\bnpm_[A-Za-z0-9]{20,}\b"
    r"|\bglpat-[A-Za-z0-9_-]{15,}\b"
    r"|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"
    r"|(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40,}={0,2}(?![A-Za-z0-9/+])"
    r")"
)
#: ``scheme://user:password@host`` — only the password (group 2) is
#: redacted.
SECRET_URL_CRED = re.compile(r"(?i)([a-z][a-z0-9+.-]*://[^\s:@/]+:)([^\s@/]+)(@)")
#: ``Authorization: Bearer <token>`` / ``Authorization: Basic <token>``.
SECRET_AUTH_HEADER = re.compile(r"(?i)(authorization)\s*:\s*(bearer|basic)\s+\S+")
#: A PEM block, markers included — the whole match is replaced, not just
#: the body between the markers.
SECRET_PEM = re.compile(r"-----BEGIN [^-]+-----.*?-----END [^-]+-----", re.DOTALL)

_REDACTED = "<redacted>"


def redact(text: str) -> str:
    """Replace credential-shaped substrings in one parsed string field
    with ``<redacted>``. Never call this on serialized JSON: redacting a
    JSON string's escaped payload can break its escape sequences (the
    deep_mask fix in the original harness exists because of this)."""
    text = SECRET_PEM.sub(_REDACTED, text)
    text = SECRET_AUTH_HEADER.sub(
        lambda m: f"{m.group(1)}: {m.group(2)} {_REDACTED}", text
    )
    text = SECRET_URL_CRED.sub(lambda m: f"{m.group(1)}{_REDACTED}{m.group(3)}", text)
    text = SECRET_ASSIGN.sub(lambda m: f"{m.group(1)}{m.group(2)}{_REDACTED}", text)
    return SECRET_BARE.sub(_REDACTED, text)


# ---- known-identifier masking -------------------------------------------

#: Board-id-shaped tokens: hyphen-separated, optionally dotted
#: (``t80he.18``), matched case-insensitively — a Substrate ref written
#: as ``XTRM-428`` in human text is as much a known id as ``xtrm-428``.
#: Only tokens present in the caller-supplied ``known_ids`` set are ever
#: replaced — matching the shape alone is not enough, which is what the
#: historical over-broad regex got wrong.
ID_TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9](?:\.\d+)*")
#: Case-insensitive: an all-caps corpus (human-written Substrate refs,
#: SHOUTED headings) must be checkable too.
_PLAIN_WORD = re.compile(r"\b[A-Za-z]{3,}\b")

#: Historical default: at least 98% of plain words must survive masking.
MASK_MIN_SURVIVING_WORD_FRACTION = 0.98


class MaskAbortError(RuntimeError):
    """Masking removed more plain text than the allowed fraction — the
    over-broad-regex defect from XTRM-99 comment 13408. Carries counts
    only, never the text itself."""

    def __init__(self, removed: int, total: int, min_surviving_fraction: float) -> None:
        self.removed = removed
        self.total = total
        super().__init__(
            f"mask removed {removed}/{total} plain words "
            f"(threshold: at least {min_surviving_fraction:.0%} must survive)"
        )


def remember(ids: Iterable[str]) -> frozenset[str]:
    """Build a known-ids set the way the reference harness's
    ``remember()`` did: every full id, plus its bare final-hyphen suffix
    when that suffix contains a digit (e.g. ``585`` from ``mmd-585``), so
    a board that references an issue by its bare numeric suffix is still
    masked."""
    ids = list(ids)
    known = set(ids)
    for i in ids:
        suffix = i.rsplit("-", 1)[-1]
        if re.search(r"\d", suffix):
            known.add(suffix)
    return frozenset(known)


def _apply_id_mask(text: str, known_ids: frozenset[str]) -> str:
    """The id-substitution half of :func:`mask`, isolated so
    :func:`_masked_leaf` can run :func:`check_mask` on a redacted-vs-
    redacted-then-masked pair — measuring masking loss only, never
    redaction loss."""
    known_lower = {k.lower() for k in known_ids}
    return ID_TOKEN.sub(
        lambda m: "<issue>" if m.group(0).lower() in known_lower else m.group(0),
        text,
    )


def mask(text: str, known_ids: frozenset[str]) -> str:
    """Redact credentials, then replace any token that is a
    case-insensitive member of ``known_ids`` with ``<issue>``. An
    id-shaped token not in ``known_ids`` is left as-is."""
    return _apply_id_mask(redact(text), known_ids)


#: Below this many plain words, a survival *fraction* is meaningless (one
#: lost word out of one is 100%, not a defect).
MASK_MIN_WORD_COUNT_FOR_RATIO = 20


def _strip_replacement_tokens(text: str) -> str:
    for token in ("<issue>", _REDACTED):
        text = text.replace(token, " ")
    return text


def check_mask(
    original: str,
    masked: str,
    *,
    min_surviving_fraction: float = MASK_MIN_SURVIVING_WORD_FRACTION,
    min_word_count: int = MASK_MIN_WORD_COUNT_FOR_RATIO,
) -> None:
    """Abort if id-masking removed too much plain text.

    ``original`` must already be the *redacted* baseline (never raw,
    pre-redaction text) — :func:`_masked_leaf` calls this on
    (``redact(text)``, ``_apply_id_mask(redact(text), known_ids)``), so
    only masking loss is measured; redaction replacing a field's only
    word is never mistaken for an over-broad mask.

    Whether the short-field or the ratio rule applies is decided from
    ``original`` *before* replacement tokens are stripped (``floor``
    below) — a field that is mostly the literal text ``<issue>`` or
    ``<redacted>`` (copy-pasted example text, not our own injected
    tokens) is still a large field and must not be exempted from the
    ratio check just because stripping shrinks its *content* word count.
    The actual loss ratio is then computed on the token-stripped text on
    both sides — the tokens themselves must never count as surviving
    *or* original plain words there.

    Below ``min_word_count`` plain words (by the pre-strip floor) the
    survival fraction is meaningless, so the ratio check is skipped; the
    field only aborts if every one of its (post-strip) plain words
    vanished *and* masking (not redaction) is what removed them — the
    "field is nothing but a known id" case, which the G8 large-payload
    regression needs caught regardless of the field's own size.
    """
    floor = len(_PLAIN_WORD.findall(original))
    words = _PLAIN_WORD.findall(_strip_replacement_tokens(original))
    total = len(words)
    if total == 0:
        return
    surviving = _PLAIN_WORD.findall(_strip_replacement_tokens(masked))
    removed = total - len(surviving)
    masking_applied = masked != original
    if floor < min_word_count:
        if removed == total and masking_applied:
            raise MaskAbortError(removed, total, min_surviving_fraction)
        return
    if len(surviving) < min_surviving_fraction * total:
        raise MaskAbortError(removed, total, min_surviving_fraction)


#: Leaf types the guard stage accepts as-is (no traversal needed).
_LEAF_TYPES = (str, int, float, bool, type(None))
#: Container types the guard stage traverses.
_CONTAINER_TYPES = (dict, list, tuple, set, frozenset)


def _check_supported_type(value: Any) -> None:
    """Fail closed on anything that isn't a plain JSON-like leaf or
    container — bytes and arbitrary objects are refused outright rather
    than decoded or stringified, since either could silently carry a
    secret past every string-shaped guard below."""
    if isinstance(value, _LEAF_TYPES) or isinstance(value, _CONTAINER_TYPES):
        return
    raise TypeError(
        f"guard stage cannot process value of type {type(value).__name__!r}; "
        "only str, int, float, bool, None, dict, list, tuple and set are supported"
    )


#: (redacted baseline, masked result) pair for one string leaf — fed to
#: the whole-payload aggregate check after traversal (see
#: :func:`_check_aggregate_mask`).
_MaskedPair = tuple[str, str]


def _masked_leaf_with_pair(
    text: str, known_ids: frozenset[str]
) -> tuple[str, _MaskedPair]:
    redacted = redact(text)
    masked_text = _apply_id_mask(redacted, known_ids)
    check_mask(redacted, masked_text)  # per-leaf check: catches the G8 short-field case
    return masked_text, (redacted, masked_text)


def _mask_key_with_pairs(
    key: Any, known_ids: frozenset[str]
) -> tuple[Any, list[_MaskedPair]]:
    _check_supported_type(key)
    if isinstance(key, str):
        masked_key, pair = _masked_leaf_with_pair(key, known_ids)
        return masked_key, [pair]
    if isinstance(key, _CONTAINER_TYPES):
        raise TypeError("dict keys must be a leaf value, not a container")
    return key, []


# ponytail: deep_mask/check_mask re-copy and re-scan every string on each
# call — O(field_count) regex passes, each producing a fresh copy. Fine
# at typical contract/state sizes; a single ~20MB string takes on the
# order of 6s and several transient copies here. Upgrade path if that
# ever matters: stream masking over chunks instead of building the whole
# masked value in memory at once.
def _deep_mask_with_pairs(
    value: Any, known_ids: frozenset[str]
) -> tuple[Any, list[_MaskedPair]]:
    _check_supported_type(value)
    if isinstance(value, str):
        masked_text, pair = _masked_leaf_with_pair(value, known_ids)
        return masked_text, [pair]
    if isinstance(value, dict):
        out: dict[Any, Any] = {}
        pairs: list[_MaskedPair] = []
        for k, v in value.items():
            masked_key, key_pairs = _mask_key_with_pairs(k, known_ids)
            masked_value, value_pairs = _deep_mask_with_pairs(v, known_ids)
            out[masked_key] = masked_value
            pairs += key_pairs
            pairs += value_pairs
        return out, pairs
    if isinstance(value, list):
        results = [_deep_mask_with_pairs(v, known_ids) for v in value]
        return [r[0] for r in results], [p for r in results for p in r[1]]
    if isinstance(value, tuple):
        results = [_deep_mask_with_pairs(v, known_ids) for v in value]
        return tuple(r[0] for r in results), [p for r in results for p in r[1]]
    if isinstance(value, (set, frozenset)):
        results = [_deep_mask_with_pairs(v, known_ids) for v in value]
        return {r[0] for r in results}, [p for r in results for p in r[1]]
    return value, []


def _check_aggregate_mask(pairs: list[_MaskedPair]) -> None:
    """Whole-payload ratio check over every masked string field (and dict
    key), concatenated. The per-leaf check in :func:`_masked_leaf_with_pair`
    catches one small field replaced entirely by a known id (G8), but
    cannot catch a payload built from many fields that each lose just
    under the per-leaf floor while the payload as a whole loses almost
    everything (H1) — this restores the original whole-corpus check
    alongside the per-leaf one, not instead of it. ``min_word_count=0``
    forces the ratio comparison regardless of the aggregate's own size."""
    if not pairs:
        return
    baseline = "\n".join(p[0] for p in pairs)
    masked = "\n".join(p[1] for p in pairs)
    check_mask(baseline, masked, min_word_count=0)


def deep_mask(value: Any, known_ids: frozenset[str]) -> Any:
    """Recursively redact and mask every string field of a parsed
    JSON-like value — including dict keys, and values nested in tuples
    and sets. Requires a parsed value, never a JSON string. Raises
    :class:`TypeError` (fail closed) on any value of an unsupported
    type, such as ``bytes`` or an arbitrary object — refused rather than
    decoded, since either could carry a secret past every other guard.

    Runs both the per-field and the whole-payload aggregate mask checks
    (see :func:`_check_aggregate_mask`)."""
    guarded, pairs = _deep_mask_with_pairs(value, known_ids)
    _check_aggregate_mask(pairs)
    return guarded


# ---- label-leak exclusion ------------------------------------------------


@dataclass(frozen=True)
class LabelExclusionRule:
    """Which payload fields hold label lists, and which label prefixes
    must never reach the model (e.g. a ``contract:ready`` label hands the
    model the answer it's meant to derive). ``mode="strip"`` (default)
    drops matching labels; ``mode="reject"`` fails the guard instead.
    Field names match case-insensitively, and a field's value may be a
    list of exact labels, a comma/semicolon/whitespace-joined string, or
    a nested structure of either — every shape is scanned and cleaned."""

    fields: tuple[str, ...] = ("labels",)
    excluded_prefixes: tuple[str, ...] = ("contract:",)
    mode: str = "strip"

    def __post_init__(self) -> None:
        if self.mode not in ("strip", "reject"):
            raise ValueError(
                f"LabelExclusionRule.mode must be 'strip' or 'reject', got {self.mode!r}"
            )


def _matches_field(key: Any, rule: LabelExclusionRule) -> bool:
    return isinstance(key, str) and key.lower() in {f.lower() for f in rule.fields}


def _is_excluded_label(token: str, rule: LabelExclusionRule) -> bool:
    return token.startswith(rule.excluded_prefixes)


#: Labels are split on commas, semicolons and whitespace — covers a
#: clean list item, a comma-joined string, and a label token embedded in
#: a longer free-text sentence alike.
def _label_tokens(text: str) -> list[str]:
    return [t for t in re.split(r"[,;\s]+", text) if t]


def _extract_label_tokens(value: Any) -> list[str]:
    """Mirrors :func:`deep_mask`'s type handling (dict/list/tuple/set,
    fail closed on anything else) so a label hidden in a tuple or set
    field is scanned exactly like one in a list (H4)."""
    _check_supported_type(value)
    if isinstance(value, str):
        return _label_tokens(value)
    if isinstance(value, dict):
        return [t for v in value.values() for t in _extract_label_tokens(v)]
    if isinstance(value, (list, tuple, set, frozenset)):
        return [t for item in value for t in _extract_label_tokens(item)]
    return []


def _has_excluded_label(value: Any, rule: LabelExclusionRule) -> bool:
    _check_supported_type(value)
    if isinstance(value, dict):
        for k, v in value.items():
            if _matches_field(k, rule):
                if any(_is_excluded_label(t, rule) for t in _extract_label_tokens(v)):
                    return True
            elif _has_excluded_label(v, rule):
                return True
        return False
    if isinstance(value, (list, tuple, set, frozenset)):
        return any(_has_excluded_label(item, rule) for item in value)
    return False


#: Splits on the same delimiters as :func:`_label_tokens`, but keeps the
#: delimiters themselves so :func:`_strip_label_string` can drop just the
#: excluded tokens and rejoin the rest — never reformatting a field that
#: has nothing to strip (H5).
_LABEL_SPLIT = re.compile(r"([,;\s]+)")


def _strip_label_string(text: str, rule: LabelExclusionRule) -> str:
    if not any(_is_excluded_label(t, rule) for t in _label_tokens(text)):
        return text  # nothing to remove: prose is returned exactly as-is
    parts = _LABEL_SPLIT.split(text)
    kept = [
        part
        for part in parts
        if part
        and not (not _LABEL_SPLIT.fullmatch(part) and _is_excluded_label(part, rule))
    ]
    result = re.sub(r"[ \t]{2,}", " ", "".join(kept))
    return result.strip(" ,;\t")


def _strip_label_value(value: Any, rule: LabelExclusionRule) -> Any:
    """Clean an excluded-field's value regardless of its shape: an exact
    label list, a joined string, a nested list/tuple/set of dicts, or a
    free-text string with a label embedded (kept as prose, see
    :func:`_strip_label_string`). Mirrors :func:`deep_mask`'s type
    handling, including failing closed on an unsupported type."""
    _check_supported_type(value)
    if isinstance(value, str):
        return _strip_label_string(value, rule)
    if isinstance(value, list):
        return [
            _strip_label_value(item, rule)
            for item in value
            if not (isinstance(item, str) and _is_excluded_label(item, rule))
        ]
    if isinstance(value, tuple):
        return tuple(
            _strip_label_value(item, rule)
            for item in value
            if not (isinstance(item, str) and _is_excluded_label(item, rule))
        )
    if isinstance(value, (set, frozenset)):
        return {
            _strip_label_value(item, rule)
            for item in value
            if not (isinstance(item, str) and _is_excluded_label(item, rule))
        }
    if isinstance(value, dict):
        return {k: _strip_label_value(v, rule) for k, v in value.items()}
    return value


def strip_excluded_labels(value: Any, rule: LabelExclusionRule) -> Any:
    """Recursively drop excluded-prefix labels from every field matching
    one of ``rule.fields`` (case-insensitively), in whatever shape that
    field's value takes. Mirrors :func:`deep_mask`'s type handling,
    including failing closed on an unsupported type."""
    _check_supported_type(value)
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if _matches_field(k, rule):
                out[k] = _strip_label_value(v, rule)
            else:
                out[k] = strip_excluded_labels(v, rule)
        return out
    if isinstance(value, list):
        return [strip_excluded_labels(item, rule) for item in value]
    if isinstance(value, tuple):
        return tuple(strip_excluded_labels(item, rule) for item in value)
    if isinstance(value, (set, frozenset)):
        return {strip_excluded_labels(item, rule) for item in value}
    return value


# ---- guard versions -------------------------------------------------------


def redaction_version() -> str:
    """Content hash of the active credential-redaction rule set. Folds
    in the guard functions' own source, not just the regex patterns, so
    a rewritten guard body — same patterns, different behaviour — still
    changes the version."""
    return compute_content_hash(
        {
            "secret_assign": SECRET_ASSIGN.pattern,
            "secret_bare": SECRET_BARE.pattern,
            "secret_url_cred": SECRET_URL_CRED.pattern,
            "secret_auth_header": SECRET_AUTH_HEADER.pattern,
            "secret_pem": SECRET_PEM.pattern,
            "redact_source": inspect.getsource(redact),
        }
    )


def mask_version(label_rule: LabelExclusionRule | None = None) -> str:
    """Content hash of the active id-masking + label-exclusion rule set,
    folding in the guard functions' own source (see
    :func:`redaction_version`)."""
    rule = label_rule or LabelExclusionRule()
    return compute_content_hash(
        {
            "id_token": ID_TOKEN.pattern,
            "min_surviving_word_fraction": MASK_MIN_SURVIVING_WORD_FRACTION,
            "min_word_count_for_ratio": MASK_MIN_WORD_COUNT_FOR_RATIO,
            "label_fields": list(rule.fields),
            "label_excluded_prefixes": list(rule.excluded_prefixes),
            "label_mode": rule.mode,
            "mask_source": inspect.getsource(mask),
            "apply_id_mask_source": inspect.getsource(_apply_id_mask),
            "masked_leaf_source": inspect.getsource(_masked_leaf_with_pair),
            "check_mask_source": inspect.getsource(check_mask),
            "deep_mask_source": inspect.getsource(deep_mask),
            "deep_mask_with_pairs_source": inspect.getsource(_deep_mask_with_pairs),
            "check_aggregate_mask_source": inspect.getsource(_check_aggregate_mask),
            "strip_excluded_labels_source": inspect.getsource(strip_excluded_labels),
            "strip_label_value_source": inspect.getsource(_strip_label_value),
            "has_excluded_label_source": inspect.getsource(_has_excluded_label),
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


def cache_key(
    payload: dict[str, Any],
    guards: dict[str, str],
    known_ids: frozenset[str] = frozenset(),
) -> str:
    """Cache key for a guarded request.

    Hashes the **pre-guard** ``payload`` (never the guarded/masked
    output) together with the active guard rule ``guards`` versions and
    ``known_ids``. Pre-guard so a cache lookup can happen before the
    guard stage runs at all, not after paying its cost. ``guards`` is
    folded in so a changed redaction or mask rule can never be served
    from an entry cached under an earlier rule set. ``known_ids`` is
    folded in explicitly, separately from ``guards`` — two requests with
    different known-id sets can guard to the exact same masked text
    today (neither set's ids happen to appear in this payload) yet must
    not collide, since a later, textually-identical payload could
    contain an id from one set and not the other. Consumed by
    XTRM-432's cache."""
    return compute_content_hash(
        {"payload": payload, "guards": guards, "known_ids": sorted(known_ids)}
    )


# ---- guard failure ----------------------------------------------------------


class GuardFailure(RuntimeError):
    """A guard rejected the payload, or the guard stage raised
    unexpectedly (fail closed). Carries only the failing guard's name and
    non-secret diagnostic details (counts, a schema validator name, a
    JSON path) — never a payload value."""

    def __init__(self, guard: str, reason: str, **counts: Any) -> None:
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
    guard_failure: GuardFailure | None = None
    guarded: dict[str, Any] | None = None
    try:
        guarded = _run_guards(payload, known_ids, rule, schema_kind)
    except GuardFailure as exc:
        guard_failure = exc
    except (
        Exception
    ) as exc:  # fail closed: no guard exception may reach the caller unwrapped
        guard_failure = GuardFailure("guard_stage", f"unexpected {type(exc).__name__}")
    if guard_failure is not None:
        raise guard_failure from None
    assert guarded is not None
    return send(guarded)


def _run_guards(
    payload: dict[str, Any],
    known_ids: frozenset[str],
    rule: LabelExclusionRule,
    schema_kind: str | None,
) -> dict[str, Any]:
    """The label and mask stages share one failure path: an unsupported
    type discovered while scanning for excluded labels gets the same
    ``"type"`` guard name as one discovered while masking, rather than
    the label stage's TypeError falling through to guarded_send's
    generic ``"guard_stage"`` catch-all."""
    failure: GuardFailure | None = None
    guarded: dict[str, Any] | None = None
    try:
        if rule.mode == "reject" and _has_excluded_label(payload, rule):
            raise GuardFailure("labels", "payload contains an excluded label")
        stripped = strip_excluded_labels(payload, rule)
        guarded = deep_mask(stripped, known_ids)
    except GuardFailure as exc:
        failure = exc
    except MaskAbortError as exc:
        failure = GuardFailure("mask", str(exc), removed=exc.removed, total=exc.total)
    except TypeError as exc:
        failure = GuardFailure("type", str(exc))
    if failure is not None:
        raise failure from None
    assert guarded is not None
    if schema_kind is not None:
        _schema_stage(guarded, schema_kind)
    return guarded


def _schema_stage(guarded: dict[str, Any], schema_kind: str) -> None:
    from xtrm_research.schemas import SchemaValidationError, validate

    failure: GuardFailure | None = None
    try:
        validate(schema_kind, guarded)
    except SchemaValidationError as exc:
        cause = exc.__cause__
        failure = GuardFailure(
            "schema",
            "payload failed schema validation",
            validator=getattr(cause, "validator", None),
            json_path=getattr(cause, "json_path", None),
        )
    if failure is not None:
        raise failure from None


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
    """Guard ``payload`` and send it through ``handle``'s run, in two
    separate phases that are never conflated:

    **Guard phase.** On failure — including ``guard_versions()`` itself
    raising — records a ``guard_failure`` event with the failing guard's
    name and counts (no secret values) and marks the run ``invalid``.
    ``send`` is never called.

    **Send phase.** Only entered once the guard phase has passed. A
    ``send`` exception is never mistaken for a guard failure — it is
    recorded as a ``send_failure`` event stating the payload passed the
    guards and reached the backend, the run is marked ``error`` (not
    ``invalid``, which means specifically "the guards rejected this
    payload"), and the original exception is re-raised unchanged (same
    type, same traceback).

    Both phases settle the run through the existing
    :class:`~xtrm_research.runner.RunHandle` API, no new write path
    around its lock, and ``finish()`` always runs even if writing the
    event itself raises.
    """
    rule = label_rule or LabelExclusionRule()
    guard_failure: GuardFailure | None = None
    versions: dict[str, str] = {}
    guarded: dict[str, Any] | None = None
    try:
        versions = guard_versions(label_rule)
        guarded = _run_guards(payload, known_ids, rule, schema_kind)
    except GuardFailure as exc:
        guard_failure = exc
    except Exception as exc:
        guard_failure = GuardFailure("guard_stage", f"unexpected {type(exc).__name__}")

    if guard_failure is not None:
        _settle(
            handle,
            seq,
            "guard_failure",
            {"guard": guard_failure.guard, "counts": guard_failure.counts, **versions},
            state="invalid",
        )
        raise guard_failure from None

    assert guarded is not None
    try:
        result = send(guarded)
    except Exception:
        # the payload passed every guard and reached the backend: this is
        # never a guard failure, and must never be recorded as one (H3).
        _settle(
            handle,
            seq,
            "send_failure",
            {"note": "payload passed the guards and reached the backend", **versions},
            state="error",
        )
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


def _settle(
    handle: Any, seq: int, kind: str, data: dict[str, Any], *, state: str
) -> None:
    try:
        handle.write_event(
            {
                "schema_version": "xtrm-research-event/v1",
                "seq": seq,
                "ts": _now_iso(),
                "kind": kind,
                "data": data,
            }
        )
    finally:
        handle.finish(state)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
