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


def resolve_aliases(
    requested: dict[str, str], resolver: dict[str, str]
) -> tuple[list[ResolvedAlias], list[UnresolvedAlias]]:
    """Resolve each ``{name: alias}`` in ``requested`` against ``resolver``.

    An alias missing from ``resolver`` is recorded unresolved rather than
    raising, so the manifest can still be written and inspected.
    """
    resolved: list[ResolvedAlias] = []
    unresolved: list[UnresolvedAlias] = []
    for _name, alias in requested.items():
        if alias in resolver:
            resolved.append(ResolvedAlias(input=alias, resolved=resolver[alias]))
        else:
            unresolved.append(
                UnresolvedAlias(input=alias, reason=f"no resolver entry for alias {alias!r}")
            )
    return resolved, unresolved
