"""Pure-function output rendering for `mcpq` subcommands.

Each helper returns a string; the CLI layer writes it to stdout. Keeping
these pure makes them trivially testable (Phase D) and lets the human /
json split live entirely in the CLI dispatcher.
"""

from __future__ import annotations

import json
from typing import Any, Iterable, Mapping, Sequence

# Width budget for the tool list. Tool names are short; titles can be
# long. We truncate titles to keep each line under ~120 cols.
_LIST_NAME_COL = 32
_LIST_TITLE_COL = 80


def render_tool_list(tools: Sequence[Mapping[str, Any]]) -> str:
    """One tool per line, sorted by name. Uses `title` or short description."""
    rows: list[tuple[str, str]] = []
    for tool in tools:
        name = str(tool.get("name", ""))
        title = str(tool.get("title") or tool.get("description") or "").strip()
        if title:
            title = title.splitlines()[0].strip()
        rows.append((name, title))
    rows.sort(key=lambda r: r[0])
    if not rows:
        return "(no tools returned)"
    out: list[str] = []
    for name, title in rows:
        if not title:
            out.append(name)
        elif len(name) >= _LIST_NAME_COL:
            out.append(f"{name}  {title[:_LIST_TITLE_COL]}")
        else:
            out.append(f"{name.ljust(_LIST_NAME_COL)}{title[:_LIST_TITLE_COL]}")
    return "\n".join(out)


def render_schema(tool: Mapping[str, Any]) -> str:
    """Name, title, description, then `Args:` block (one field per line)."""
    name = str(tool.get("name", ""))
    title = str(tool.get("title") or "").strip()
    description = str(tool.get("description") or "").strip()
    schema = tool.get("inputSchema") or {}
    required = set(schema.get("required") or []) if isinstance(schema, Mapping) else set()
    properties = schema.get("properties") if isinstance(schema, Mapping) else None

    lines: list[str] = []
    lines.append(f"Name: {name}")
    if title and title != name:
        lines.append(f"Title: {title}")
    if description:
        lines.append("Description:")
        for chunk in description.splitlines() or [description]:
            lines.append(f"  {chunk}")
    if not isinstance(properties, Mapping) or not properties:
        lines.append("Args: (none)")
        return "\n".join(lines)
    lines.append("Args:")
    for field_name, field_schema in properties.items():
        lines.append(_render_field(field_name, field_schema, field_name in required))
    return "\n".join(lines)


def _render_field(name: str, schema: Any, is_required: bool) -> str:
    if not isinstance(schema, Mapping):
        type_label = _type_label(schema)
        flag = "required" if is_required else "optional"
        return f"  {name}  {type_label}  {flag}"

    type_label = _type_label(schema)
    flag = "required" if is_required else "optional"
    default = schema.get("default", _SENTINEL)
    description = str(schema.get("description") or "").strip()

    parts: list[str] = [f"  {name}", type_label, flag]
    if default is not _SENTINEL:
        parts.append(f"default={json.dumps(default, separators=(',', ':'))}")
    line = "  ".join(parts)
    if description:
        line = f"{line}  {description}"
    return line


_SENTINEL = object()


def _type_label(schema: Any) -> str:
    """Render a JSON-Schema type node as a short human string."""
    if not isinstance(schema, Mapping):
        return type(schema).__name__
    if "enum" in schema and isinstance(schema["enum"], list):
        values = ", ".join(json.dumps(v) for v in schema["enum"])
        return f"enum[{values}]"
    if "const" in schema:
        return f"const={json.dumps(schema['const'])}"
    if "oneOf" in schema and isinstance(schema["oneOf"], list):
        return "oneOf[" + ", ".join(_type_label(opt) for opt in schema["oneOf"]) + "]"
    if "anyOf" in schema and isinstance(schema["anyOf"], list):
        return "anyOf[" + ", ".join(_type_label(opt) for opt in schema["anyOf"]) + "]"
    if "allOf" in schema and isinstance(schema["allOf"], list):
        return "allOf[" + ", ".join(_type_label(opt) for opt in schema["allOf"]) + "]"
    if "items" in schema:
        inner = _type_label(schema["items"])
        return f"array<{inner}>"
    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        return "|".join(str(t) for t in schema_type)
    if isinstance(schema_type, str):
        if schema_type == "object" and "properties" in schema:
            return "object"
        return schema_type
    if "properties" in schema or "additionalProperties" in schema:
        return "object"
    return "any"


def render_call_result(result: Mapping[str, Any]) -> str:
    """Render a `tools/call` result envelope for human consumption.

    If the envelope contains a single ``content: [{type: "text", text: "..."}]``
    block AND the text is valid JSON, prefer the pretty-printed JSON;
    otherwise pretty-print the whole envelope. If multiple text blocks
    exist, join their texts with a blank line.
    """
    content = result.get("content")
    is_error = bool(result.get("isError", False))
    if isinstance(content, list) and content and all(
        isinstance(item, Mapping) and item.get("type") == "text" for item in content
    ):
        texts = [str(item.get("text", "")) for item in content]
        joined = "\n\n".join(texts)
        if len(texts) == 1:
            return _try_pretty_json(joined) or joined
        return joined
    return json.dumps(result, indent=2, ensure_ascii=False)


def _try_pretty_json(text: str) -> str | None:
    stripped = text.lstrip()
    if not stripped or stripped[0] not in "{[":
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return json.dumps(parsed, indent=2, ensure_ascii=False)
