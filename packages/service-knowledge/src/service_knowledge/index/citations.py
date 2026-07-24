"""Citation extraction: pull verifiable code/config references out of section text.

A citation is a path (optionally with a ``:line`` or ``:start-end`` range) pointing at the
code or config that backs a claim or section (research §3.2 item 3, §3.3 ``citations``). Only
file-like tokens with a known source extension are treated as citations, which keeps prose
URLs and command flags out of the citation set.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_SOURCE_EXT = r"(?:py|yml|yaml|js|ts|tsx|jsx|go|rs|toml|json|sh|bash|sql|md|cfg|ini|conf|tf|hcl)"

# path/to/file.ext  |  path/to/file.ext:42  |  path/to/file.ext:42-50
_CITATION_RE = re.compile(
    rf"(?<![\w/])((?:[\w.-]+/)*[\w.-]+\.{_SOURCE_EXT})(?::(\d+)(?:-(\d+))?)?"
)


@dataclass(frozen=True)
class Citation:
    path: str
    line_start: int | None
    line_end: int | None


def extract_citations(text: str) -> tuple[Citation, ...]:
    """Distinct citations in ``text`` (deduped, order-preserving)."""
    seen: set[tuple[str, int | None, int | None]] = set()
    out: list[Citation] = []
    for match in _CITATION_RE.finditer(text):
        path = match.group(1)
        start = int(match.group(2)) if match.group(2) else None
        end = int(match.group(3)) if match.group(3) else start
        # A bare filename with no directory and no line is too weak to be a citation.
        if "/" not in path and start is None:
            continue
        key = (path, start, end)
        if key in seen:
            continue
        seen.add(key)
        out.append(Citation(path=path, line_start=start, line_end=end))
    return tuple(out)
