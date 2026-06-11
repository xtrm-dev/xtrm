"""Typed-arg parser for the `mcpq call --arg key[:type]=value` syntax.

The MCP streamable-http `tools/call` payload is a JSON-RPC `arguments`
object. Typed values let the user avoid quoting complex shapes at the
shell. Supported type suffixes:

* (omitted)  -> str
* ``int``    -> ``int(value)``
* ``float``  -> ``float(value)``
* ``bool``   -> ``True`` / ``False`` (case-insensitive; also accepts
               ``1``/``0``, ``yes``/``no``)
* ``json``   -> ``json.loads(value)`` (caller is responsible for quoting
               valid JSON on the command line)
"""

from __future__ import annotations

import json
from typing import Any

_BOOL_TRUE = {"true", "1", "yes", "y", "on"}
_BOOL_FALSE = {"false", "0", "no", "n", "off"}


def parse_args(items: list[str]) -> dict[str, Any]:
    """Parse a list of ``--arg`` strings into a typed arguments dict.

    Each item is ``NAME=VALUE`` or ``NAME:TYPE=VALUE``. Duplicate ``NAME``
    entries override the previous value (last write wins). Raises
    ``ValueError`` with a clear message on any malformed item or
    type-conversion failure.
    """
    out: dict[str, Any] = {}
    for item in items:
        if not isinstance(item, str):
            raise ValueError(
                f"invalid --arg value: expected string, got {type(item).__name__}"
            )
        name, sep, value = item.partition("=")
        if not sep or not name:
            raise ValueError(
                f"invalid --arg {item!r}: expected NAME[:TYPE]=VALUE "
                f"(missing '=' before value or empty name)"
            )
        if ":" in name:
            key, _, type_name = name.partition(":")
            if not key or not type_name:
                raise ValueError(
                    f"invalid --arg {item!r}: empty key or empty type "
                    f"(expected NAME:TYPE=VALUE)"
                )
        else:
            key = name
            type_name = ""
        out[key] = _coerce(key, type_name, value)
    return out


def _coerce(key: str, type_name: str, value: str) -> Any:
    if type_name == "":
        return value
    if type_name == "str":
        return value
    if type_name == "int":
        try:
            return int(value)
        except ValueError as exc:
            raise ValueError(
                f"invalid value for arg {key!r} as int: {exc}"
            ) from exc
    if type_name == "float":
        try:
            return float(value)
        except ValueError as exc:
            raise ValueError(
                f"invalid value for arg {key!r} as float: {exc}"
            ) from exc
    if type_name == "bool":
        lowered = value.strip().lower()
        if lowered in _BOOL_TRUE:
            return True
        if lowered in _BOOL_FALSE:
            return False
        raise ValueError(
            f"invalid value for arg {key!r} as bool: {value!r} "
            f"(expected true/false/1/0/yes/no, case-insensitive)"
        )
    if type_name == "json":
        try:
            return json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"invalid value for arg {key!r} as json: {exc.msg} "
                f"(line {exc.lineno} col {exc.colno})"
            ) from exc
    raise ValueError(
        f"invalid value for arg {key!r}: unknown type {type_name!r} "
        f"(expected str, int, float, bool, or json)"
    )
