#!/usr/bin/env python3
"""_textio.py — line-ending preserving write helpers.

Every read-modify-write in this package reads text in Python text mode, so universal
newlines turn ``\\r\\n`` into ``\\n`` in memory. Writing that buffer back with
``newline=""`` (or ``write_text``'s default translation) then silently rewrites a CRLF
file as LF. These helpers sniff the *existing target* for ``b"\\r\\n"`` and write the
buffer back with the matching convention, so a CRLF target keeps CRLF and an LF target
stays LF across a real content change.

Vendored copies: this module is package data (``scripts/*.py``) and carries no imports
outside the stdlib, so a vendored script can import it as a sibling after the usual
``sys.path.insert(0, str(Path(__file__).parent))`` line.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

DEFAULT_ENCODING = "utf-8"

CRLF = "\r\n"
LF = "\n"


def detect_newline(path: "str | os.PathLike[str]") -> str:
    """Return the dominant line ending of ``path``: ``"\\r\\n"`` or ``"\\n"``.

    A missing or unreadable target yields ``"\\n"`` (new files are LF, byte-identical to
    the historical behaviour).
    """
    try:
        data = Path(path).read_bytes()
    except OSError:
        return LF
    return CRLF if b"\r\n" in data else LF


def render_for(path: "str | os.PathLike[str]", content: str) -> str:
    """Translate ``content`` line endings to match the existing file at ``path``.

    Any CRLF already inside ``content`` is normalised to LF first, so an already-CRLF
    buffer is never double-translated into ``\\r\\r\\n``. Lone ``\\r`` bytes are left
    untouched.
    """
    newline = detect_newline(path)
    if newline == LF:
        return content
    return content.replace(CRLF, LF).replace(LF, CRLF)


def write_text(
    path: "str | os.PathLike[str]",
    content: str,
    *,
    encoding: str = DEFAULT_ENCODING,
) -> None:
    """Write ``content`` to ``path``, preserving the target's line-ending convention.

    Creates parent directories. No trailing newline is added or removed.
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Sniff BEFORE opening: "w" truncates the target, which would erase the evidence.
    rendered = render_for(target, content)
    with open(target, "w", encoding=encoding, newline="") as handle:
        handle.write(rendered)


def atomic_write(
    path: "str | os.PathLike[str]",
    content: str,
    *,
    encoding: str = DEFAULT_ENCODING,
) -> None:
    """Atomically replace ``path`` with ``content``, preserving its line endings.

    Writes a temp file in the target directory and ``os.replace``s it into place, so a
    reader never observes a partial file. The line-ending sniff runs against the
    *target* (the temp file has no prior content of its own).
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    rendered = render_for(target, content)
    handle = tempfile.NamedTemporaryFile(
        "w", encoding=encoding, newline="", dir=target.parent, delete=False
    )
    try:
        with handle:
            handle.write(rendered)
        os.replace(handle.name, target)
    except BaseException:
        try:
            os.unlink(handle.name)
        except OSError:
            pass
        raise
