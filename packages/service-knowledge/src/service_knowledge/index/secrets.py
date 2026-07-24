"""Secret scrubbing applied at ingestion time (constraint: never index secret VALUES).

Environment-variable NAMES are indexed; their VALUES are not. ``.env`` files are skipped
entirely. The patterns mirror gitleaks' default high-signal rules so a planted AWS key, a
``redis://:password@host`` URL, or a private-key block never reaches the FTS index. The
scrubber returns redacted text plus the *kinds* of secrets found — never the values.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

REDACTION = "[REDACTED-SECRET]"

# Files skipped wholesale at ingestion — values here are configuration secrets by convention.
SKIP_FILE_PATTERNS = (
    re.compile(r"(^|/)\.env$"),
    re.compile(r"(^|/)\.env\..+$"),
    re.compile(r"(^|/)secrets?\.(ya?ml|json|toml)$", re.IGNORECASE),
    re.compile(r"\.pem$"),
    re.compile(r"\.key$"),
    re.compile(r"id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$"),
)

# Credentialed URL: scheme://[user]:password@host  (user may be empty, e.g. redis://:pw@host).
_URL_CREDENTIAL = re.compile(r"\b[a-z][a-z0-9+.\-]*://[^:/\s\"']*:[^@\s\"']+@[^\s\"']+", re.IGNORECASE)

# (kind, compiled regex whose group(0) is the secret-bearing span to redact).
_SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("aws_access_key_id", re.compile(r"\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b")),
    ("aws_secret_access_key", re.compile(r"(?i)aws[_\-]?secret[_\-]?access[_\-]?key[\s\"']*[=:][\s\"']*[A-Za-z0-9/+=]{40}")),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,255}\b")),
    ("slack_token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("slack_webhook", re.compile(r"https://hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+")),
    ("discord_webhook", re.compile(
        r"https://discord(?:app)?\.com/api/webhooks/[0-9]+/[A-Za-z0-9._-]+"
    )),
    ("generic_webhook_assignment", re.compile(
        r"(?i)(?P<prefix>\b(?:[A-Za-z_][A-Za-z0-9_]*_)?WEBHOOK_URL\s*[:=]\s*)"
        r"(?P<quote>[\"']?)(?P<value>[^\"'\s,;]+)(?P<suffix>[\"']?)"
    )),
    ("private_key_block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
    ("url_credential", _URL_CREDENTIAL),
    # generic high-entropy key assignments:  api_key = "....",  token: '....',  password = "...."
    ("generic_secret_assignment", re.compile(
        r"(?i)\b(?:api[_\-]?key|apikey|secret|token|password|passwd|pwd|access[_\-]?key|auth[_\-]?token)"
        r"[\s\"']*[=:][\s\"']+[^\"'\s]{8,}[\s\"']*"
    )),
)


@dataclass(frozen=True)
class ScrubResult:
    text: str
    kinds: tuple[str, ...]


def should_skip_file(rel_path: str) -> bool:
    return any(pattern.search(rel_path) for pattern in SKIP_FILE_PATTERNS)


def scrub(text: str) -> ScrubResult:
    """Redact every secret-bearing span in ``text``; return redacted text + detected kinds."""
    found: list[str] = []
    redacted = text
    for kind, pattern in _SECRET_PATTERNS:
        if pattern.search(redacted):
            found.append(kind)
            redacted = pattern.sub(_redact_match, redacted)
    return ScrubResult(text=redacted, kinds=tuple(sorted(set(found))))


def _redact_match(match: re.Match[str]) -> str:
    groups = match.groupdict()
    prefix = groups.get("prefix")
    if prefix is None:
        return REDACTION
    return f'{prefix}{groups["quote"]}{REDACTION}{groups["suffix"]}'
