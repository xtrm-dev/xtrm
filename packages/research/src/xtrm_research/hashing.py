"""Content hashing for versioned definition objects.

The hash covers every field of a definition object except ``content_hash``
itself, so a stored ``content_hash`` can always be re-verified against its
payload.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

_PREFIX = "sha256:"


def compute_content_hash(payload: dict[str, Any]) -> str:
    """Return the ``sha256:<hex>`` content hash of ``payload``.

    ``content_hash`` is excluded from the hashed payload so the function is
    stable whether or not the caller already set it.
    """
    without_hash = {k: v for k, v in payload.items() if k != "content_hash"}
    canonical = json.dumps(without_hash, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"{_PREFIX}{digest}"


def verify_content_hash(payload: dict[str, Any]) -> bool:
    """Return True if ``payload['content_hash']`` matches its own contents."""
    stored = payload.get("content_hash")
    return stored is not None and stored == compute_content_hash(payload)
