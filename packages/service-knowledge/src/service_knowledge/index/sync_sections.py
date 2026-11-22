"""Age of the "Sync to <sha> (<date>, ...)" sections that service skills accumulate.

A service skill grows one section per reconciliation. Only the newest says what is true now,
and the index used to return an old one next to the current one with nothing to tell them
apart. These helpers read the ref and the date from a section heading, so a hit can carry them
and so an older section can be marked as a candidate for being superseded.

Heading forms seen in real packs::

    ## Sync to stable e1dd24121 (2026-11-06, after promotion P5)
    ## 2026-08-17 updates (WS-008.31 — sync to 9756947)

Nothing here edits a pack. The mark is advisory: a hit whose section date is older than the
newest sync section of the same service is a *candidate*, because an older section can still
hold the only description of a part of the service.
"""
from __future__ import annotations

import re
from typing import Any

_SYNC_REF = re.compile(r"\bsync\s+to\s+(?:[A-Za-z][\w./-]*\s+)?([0-9a-f]{7,40})\b", re.IGNORECASE)
_DATE_IN_PARENS = re.compile(r"\((\d{4}-\d{2}-\d{2})\b")
_DATE_LEADING = re.compile(r"^\W*(\d{4}-\d{2}-\d{2})\b")


def parse_sync_heading(heading: str) -> tuple[str, str] | None:
    """Return ``(sync_ref, date)`` for a sync heading, else ``None`` (needs both)."""
    ref = _SYNC_REF.search(heading or "")
    date = _DATE_IN_PARENS.search(heading or "") or _DATE_LEADING.search(heading or "")
    if not ref or not date:
        return None
    return ref.group(1).lower(), date.group(1)


def parse_section_path(section_path: str) -> tuple[str, str] | None:
    """Return the sync ref and date of the deepest sync heading in a ``"H1 / H2"`` breadcrumb."""
    for segment in reversed((section_path or "").split(" / ")):
        parsed = parse_sync_heading(segment)
        if parsed:
            return parsed
    return None


def newest_sync_date(conn: Any, service_id: str) -> str | None:
    """Newest sync-section date among the indexed rows of ``service_id`` (ISO dates sort as text)."""
    if not service_id:
        return None
    rows = conn.execute(
        "SELECT DISTINCT section_path FROM sk_items WHERE service_id=? AND section_path!=''",
        (service_id,),
    ).fetchall()
    dates = [p[1] for p in (parse_section_path(row[0]) for row in rows) if p]
    return max(dates) if dates else None


def section_fields(section_path: str, newest: str | None) -> dict[str, Any]:
    """The three fields a hit carries about the section it came from."""
    parsed = parse_section_path(section_path)
    if not parsed:
        return {"section_sync_ref": None, "section_date": None, "superseded_candidate": False}
    ref, date = parsed
    return {
        "section_sync_ref": ref,
        "section_date": date,
        "superseded_candidate": bool(newest and date < newest),
    }
