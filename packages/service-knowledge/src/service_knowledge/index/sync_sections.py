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

import datetime
import re
from typing import Any

# A sync heading says "sync" and carries a date. The ref is optional: real packs also write
# "Stable sync <sha> (<date>...)" and "Sync to master (<date>...)" (no sha). When present, the ref
# is a lowercase hex sha with at least one digit (so words such as "defaced" never match) and not
# an 8-digit date such as 20261106.
_SYNC_WORD = re.compile(r"(?i)\bsync\b")
_SYNC_REF = re.compile(r"(?i:\bsync(?:\s+to)?)\s+(?:[A-Za-z][\w./-]*\s+)?((?=[0-9a-f]*\d)[0-9a-f]{7,40})\b")
_DATE_IN_PARENS = re.compile(r"\((\d{4}-\d{2}-\d{2})\b")
_DATE_LEADING = re.compile(r"^\W*(\d{4}-\d{2}-\d{2})\b")


def parse_sync_heading(heading: str) -> tuple[str | None, str] | None:
    """Return ``(sync_ref or None, date)`` for a sync heading, else ``None``.

    A heading needs the word "sync" and a date. The date is what orders sections, so a heading
    without a sha still counts; its ref is ``None``.
    """
    text = heading or ""
    date = _DATE_IN_PARENS.search(text) or _DATE_LEADING.search(text)
    if not date or not _SYNC_WORD.search(text):
        return None
    ref = _SYNC_REF.search(text)
    if ref and re.fullmatch(r"\d{8}", ref.group(1)):
        ref = None
    return (ref.group(1) if ref else None), date.group(1)


def parse_section_path(section_path: str) -> tuple[str | None, str] | None:
    """Return ``(ref or None, date)`` of the deepest sync heading in a ``"H1 / H2"`` breadcrumb."""
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
    # A future date is a typo or a bad clock, and one of them would mark every real section older.
    today = datetime.date.today().isoformat()
    dates = [p[1] for p in (parse_section_path(row[0]) for row in rows) if p and p[1] <= today]
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
