"""Resolving mutable operator-input aliases (e.g. ``jev-latest``, ``main``).

Aliases are resolved once, at manifest-build time, and the result — resolved
or explicitly unresolved with a reason — is recorded in the manifest so a
run's inputs never depend on a mutable pointer after it starts.
"""

from __future__ import annotations

from typing import NamedTuple


class ResolvedAlias(NamedTuple):
    input: str
    resolved: str


class UnresolvedAlias(NamedTuple):
    input: str
    reason: str


_ALIAS_LIKE_NAMES = frozenset({"main", "latest", "HEAD"})
_ALIAS_LIKE_SUFFIXES = ("-latest", ":latest", "@latest")


def is_probable_alias(name: str, alias_resolver: dict[str, str] | None = None) -> bool:
    """Heuristic for "this string names a mutable pointer, not a pinned
    version" — e.g. ``jev-latest``, ``jev@latest``, ``jev:latest``,
    ``main``, ``HEAD``. A name present as a key in ``alias_resolver`` is
    always treated as an alias, regardless of its shape — the resolver
    itself is definitive evidence it's a mutable pointer.
    """
    if alias_resolver and name in alias_resolver:
        return True
    return name in _ALIAS_LIKE_NAMES or name.endswith(_ALIAS_LIKE_SUFFIXES)
