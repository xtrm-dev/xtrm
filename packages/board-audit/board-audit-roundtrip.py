#!/usr/bin/env python3
"""board-audit-roundtrip — safe Beads work-package edit/reconcile/apply tool.

Consumes xtrm.board-audit.work-package.v1 files produced by board-audit --export.
The package's issues.<id>.source records are immutable base state. `prepare` adds
`desired_issues`, which is the only area an editor/LLM should modify.

The compiler performs a three-way merge: base (export), current local Beads,
and desired. It refuses overlapping conflicts, compiles a canonical Beads JSONL
upsert plus explicit post-import removals, and can apply/verify the result.
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
from typing import Any

PACKAGE_SCHEMA = "xtrm.board-audit.work-package.v1"
ROUNDTRIP_SCHEMA = "xtrm.board-audit.roundtrip.v1"
PLAN_SCHEMA = "xtrm.board-audit.apply-plan.v1"

PROTECTED_EXISTING_FIELDS = {
    "id",
    "created_at",
    "created",
    "created_by",
    "updated_at",
    "updated",
    "closed_at",
    "started_at",
}
AUX_FIELDS = {"labels", "dependencies", "deps", "relations", "comments"}
MISSING = object()


class RoundtripError(RuntimeError):
    pass


def utcnow() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def canonical_bytes(obj: Any) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha256_obj(obj: Any) -> str:
    return hashlib.sha256(canonical_bytes(obj)).hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RoundtripError(f"cannot read JSON {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise RoundtripError("work package must be a JSON object")
    return data


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read_export_rows(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, list):
        return [r for r in parsed if isinstance(r, dict) and r.get("id")]
    if isinstance(parsed, dict):
        for key in ("issues", "beads", "records"):
            if isinstance(parsed.get(key), list):
                return [r for r in parsed[key] if isinstance(r, dict) and r.get("id")]
        if parsed.get("id"):
            return [parsed]
    rows: list[dict[str, Any]] = []
    for line_no, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise RoundtripError(f"invalid JSONL line {line_no}: {exc}") from exc
        if isinstance(row, dict) and row.get("_schema"):
            continue
        if isinstance(row, dict) and row.get("id"):
            rows.append(row)
    return rows


def source_issues(pkg: dict[str, Any]) -> dict[str, dict[str, Any]]:
    issues = pkg.get("issues")
    if not isinstance(issues, dict):
        raise RoundtripError("package issues must be an object")
    out: dict[str, dict[str, Any]] = {}
    for key, wrapper in issues.items():
        if not isinstance(wrapper, dict) or not isinstance(wrapper.get("source"), dict):
            raise RoundtripError(f"issues.{key}.source must be an object")
        row = wrapper["source"]
        rid = str(row.get("id") or key)
        if rid != str(key):
            raise RoundtripError(f"issues.{key}.source.id is {rid!r}; IDs must agree")
        out[rid] = row
    return out


def selected_ids(pkg: dict[str, Any]) -> set[str]:
    out = set()
    for key, wrapper in (pkg.get("issues") or {}).items():
        if isinstance(wrapper, dict) and wrapper.get("selection_state") != "context-only":
            out.add(str(key))
    return out


def prepare_package(pkg: dict[str, Any]) -> dict[str, Any]:
    if pkg.get("schema_version") != PACKAGE_SCHEMA:
        raise RoundtripError(f"unsupported package schema {pkg.get('schema_version')!r}")
    base = source_issues(pkg)
    selected = selected_ids(pkg)
    out = copy.deepcopy(pkg)
    if "desired_issues" not in out:
        out["desired_issues"] = {rid: copy.deepcopy(base[rid]) for rid in sorted(selected)}
    out.setdefault("roundtrip", {})
    out["roundtrip"].update(
        {
            "schema_version": ROUNDTRIP_SCHEMA,
            "prepared_at": out["roundtrip"].get("prepared_at") or utcnow(),
            "base_package_sha256": out.get("content_sha256") or sha256_obj(pkg),
            "base_record_sha256": {rid: sha256_obj(base[rid]) for rid in sorted(base)},
            "edit_contract": "modify desired_issues only; issues.*.source is immutable base state",
        }
    )
    return out


def desired_issues(pkg: dict[str, Any]) -> dict[str, dict[str, Any]]:
    raw = pkg.get("desired_issues")
    if not isinstance(raw, dict):
        raise RoundtripError("package is not prepared: missing desired_issues; run prepare first")
    out: dict[str, dict[str, Any]] = {}
    for key, row in raw.items():
        if not isinstance(row, dict):
            raise RoundtripError(f"desired_issues.{key} must be an object")
        rid = str(row.get("id") or key)
        if rid != str(key):
            raise RoundtripError(f"desired_issues.{key}.id is {rid!r}; IDs must agree")
        row = copy.deepcopy(row)
        row["id"] = rid
        out[rid] = row
    return out


def comment_key(comment: Any) -> str:
    if isinstance(comment, dict):
        text = comment.get("text", comment.get("body", comment.get("comment")))
        if text is not None:
            return "content:" + sha256_obj({"author": comment.get("author"), "text": text})
        for key in ("id", "comment_id"):
            if comment.get(key) is not None:
                return f"id:{comment[key]}"
        return "obj:" + sha256_obj(comment)
    return "value:" + sha256_obj(comment)


def validate_comment_append_only(base: Any, desired: Any, rid: str) -> None:
    b = base if isinstance(base, list) else []
    d = desired if isinstance(desired, list) else []
    bkeys = [comment_key(x) for x in b]
    dkeys = [comment_key(x) for x in d]
    if len(dkeys) < len(bkeys) or dkeys[: len(bkeys)] != bkeys:
        raise RoundtripError(f"{rid}: comments are append-only; existing comments may not be edited/reordered/removed")


def validate_package(pkg: dict[str, Any], *, allow_context_edit: bool = False) -> list[str]:
    if pkg.get("schema_version") != PACKAGE_SCHEMA:
        raise RoundtripError(f"unsupported package schema {pkg.get('schema_version')!r}")
    base = source_issues(pkg)
    desired = desired_issues(pkg)
    selected = selected_ids(pkg)
    warnings: list[str] = []

    rt = pkg.get("roundtrip")
    if not isinstance(rt, dict) or rt.get("schema_version") != ROUNDTRIP_SCHEMA:
        raise RoundtripError("missing/unsupported roundtrip metadata; run prepare first")
    recorded = rt.get("base_record_sha256")
    if not isinstance(recorded, dict):
        raise RoundtripError("roundtrip.base_record_sha256 is missing")
    tampered = [rid for rid, row in base.items() if recorded.get(rid) != sha256_obj(row)]
    if tampered:
        raise RoundtripError("immutable base source records were modified: " + ", ".join(sorted(tampered)))

    missing = selected - desired.keys()
    if missing:
        raise RoundtripError("desired_issues may not delete existing selected beads; close/supersede instead: " + ", ".join(sorted(missing)))

    context = set(base) - selected
    edited_context = context & desired.keys()
    if edited_context and not allow_context_edit:
        raise RoundtripError("context-only ancestors are read-only by default: " + ", ".join(sorted(edited_context)))

    for rid, row in desired.items():
        if rid not in base:
            if not str(row.get("title") or "").strip():
                raise RoundtripError(f"new bead {rid} requires title")
            continue
        b = base[rid]
        for field in PROTECTED_EXISTING_FIELDS:
            if field == "id":
                continue
            if row.get(field, MISSING) != b.get(field, MISSING):
                raise RoundtripError(f"{rid}: protected provenance field {field!r} was edited")
        validate_comment_append_only(b.get("comments"), row.get("comments"), rid)

    package_ids = set(base) | set(desired)
    for rid, row in desired.items():
        for rel in relation_map(rid, row):
            if rel[1] not in package_ids:
                warnings.append(f"{rid}: relation target {rel[1]} is outside this package; current-board validation will resolve it")
    return warnings


def dep_target(dep: Any) -> str | None:
    if isinstance(dep, str):
        return dep
    if not isinstance(dep, dict):
        return None
    for key in ("depends_on_id", "depends_on_issue_id", "target_id", "target", "bead_id", "id"):
        val = dep.get(key)
        if isinstance(val, str) and val:
            return val
    return None


def dep_type(dep: Any, default: str = "blocks") -> str:
    if isinstance(dep, dict):
        return str(dep.get("type") or dep.get("dependency_type") or dep.get("relation_type") or default)
    return default


def relation_map(rid: str, row: dict[str, Any]) -> dict[tuple[str, str, str], Any]:
    out: dict[tuple[str, str, str], Any] = {}
    for field in ("dependencies", "deps", "relations"):
        vals = row.get(field)
        if not isinstance(vals, list):
            continue
        for dep in vals:
            target = dep_target(dep)
            if target:
                key = (rid, target, dep_type(dep))
                out[key] = copy.deepcopy(dep)
    return out


def val(x: Any) -> Any:
    return "<missing>" if x is MISSING else x


def merge_metadata(base: Any, desired: Any, current: Any, rid: str, conflicts: list[dict[str, Any]]) -> Any:
    if not all(isinstance(x, dict) for x in (base, desired, current)):
        if desired != base and current != base and desired != current:
            conflicts.append({"id": rid, "field": "metadata", "base": base, "current": current, "desired": desired})
        return copy.deepcopy(desired if desired != base else current)
    result = copy.deepcopy(current)
    keys = set(base) | set(desired) | set(current)
    for key in keys:
        b, d, c = base.get(key, MISSING), desired.get(key, MISSING), current.get(key, MISSING)
        user_changed, current_changed = d != b, c != b
        if user_changed and current_changed and d != c:
            conflicts.append({"id": rid, "field": f"metadata.{key}", "base": val(b), "current": val(c), "desired": val(d)})
            continue
        if user_changed:
            if d is MISSING:
                result.pop(key, None)
            else:
                result[key] = copy.deepcopy(d)
    return result


def merge_labels(base: Any, desired: Any, current: Any) -> tuple[list[Any], list[str], list[str]]:
    b = {str(x) for x in (base if isinstance(base, list) else [])}
    d = {str(x) for x in (desired if isinstance(desired, list) else [])}
    c = {str(x) for x in (current if isinstance(current, list) else [])}
    add, remove = d - b, b - d
    result = (c - remove) | add
    return sorted(result), sorted(add), sorted(remove)


def merge_comments(base: Any, desired: Any, current: Any) -> tuple[list[Any], list[Any]]:
    b = base if isinstance(base, list) else []
    d = desired if isinstance(desired, list) else []
    c = current if isinstance(current, list) else []
    base_keys = {comment_key(x) for x in b}
    current_keys = {comment_key(x) for x in c}
    additions = [copy.deepcopy(x) for x in d if comment_key(x) not in base_keys]
    result = copy.deepcopy(c)
    for item in additions:
        if comment_key(item) not in current_keys:
            result.append(item)
            current_keys.add(comment_key(item))
    return result, additions


def merge_dependencies(rid: str, base: dict[str, Any], desired: dict[str, Any], current: dict[str, Any]) -> tuple[list[Any], set[tuple[str, str, str]], set[tuple[str, str, str]], set[tuple[str, str, str]]]:
    bm, dm, cm = relation_map(rid, base), relation_map(rid, desired), relation_map(rid, current)
    b, d, c = set(bm), set(dm), set(cm)
    user_add, user_remove = d - b, b - d
    result_keys = (c - user_remove) | user_add
    merged: list[Any] = []
    for key in sorted(result_keys):
        raw = dm.get(key) or cm.get(key) or bm.get(key)
        if isinstance(raw, dict):
            merged.append(copy.deepcopy(raw))
        else:
            merged.append({"issue_id": rid, "depends_on_id": key[1], "type": key[2]})
    return merged, user_add, user_remove, result_keys


def merge_issue(base: dict[str, Any], desired: dict[str, Any], current: dict[str, Any], rid: str) -> tuple[dict[str, Any], dict[str, Any]]:
    conflicts: list[dict[str, Any]] = []
    result = copy.deepcopy(current)
    user_changed_fields: list[str] = []
    current_changed_fields: list[str] = []

    all_fields = set(base) | set(desired) | set(current)
    special = AUX_FIELDS | {"metadata"}
    for field in sorted(all_fields - special - PROTECTED_EXISTING_FIELDS):
        b, d, c = base.get(field, MISSING), desired.get(field, MISSING), current.get(field, MISSING)
        user_changed, current_changed = d != b, c != b
        if user_changed:
            user_changed_fields.append(field)
        if current_changed:
            current_changed_fields.append(field)
        if user_changed and current_changed and d != c:
            conflicts.append({"id": rid, "field": field, "base": val(b), "current": val(c), "desired": val(d)})
            continue
        if user_changed:
            if d is MISSING:
                result.pop(field, None)
            else:
                result[field] = copy.deepcopy(d)

    result["metadata"] = merge_metadata(base.get("metadata", {}), desired.get("metadata", {}), current.get("metadata", {}), rid, conflicts)
    labels, label_add, label_remove = merge_labels(base.get("labels"), desired.get("labels"), current.get("labels"))
    if "labels" in base or "labels" in desired or "labels" in current:
        result["labels"] = labels
    comments, comment_add = merge_comments(base.get("comments"), desired.get("comments"), current.get("comments"))
    if "comments" in base or "comments" in desired or "comments" in current:
        result["comments"] = comments

    dependencies, dep_add, dep_remove, dep_result = merge_dependencies(rid, base, desired, current)
    if any(k in base or k in desired or k in current for k in ("dependencies", "deps", "relations")):
        result["dependencies"] = dependencies
        result.pop("deps", None)
        result.pop("relations", None)

    result["id"] = rid
    for field in ("created_at", "created", "created_by"):
        if field in current:
            result[field] = copy.deepcopy(current[field])
        elif field in base:
            result[field] = copy.deepcopy(base[field])

    change = {
        "id": rid,
        "user_changed_fields": user_changed_fields,
        "current_changed_fields": current_changed_fields,
        "label_add": label_add,
        "label_remove": label_remove,
        "dependency_add": [list(x) for x in sorted(dep_add)],
        "dependency_remove": [list(x) for x in sorted(dep_remove)],
        "dependency_result": [list(x) for x in sorted(dep_result)],
        "comment_append_count": len(comment_add),
        "conflicts": conflicts,
        "changed": desired != base,
    }
    return result, change


def acquire_current_jsonl() -> tuple[Path, tempfile.TemporaryDirectory[str]]:
    if shutil.which("bd") is None:
        raise RoundtripError("bd is not on PATH; pass --current-jsonl for offline reconciliation")
    td = tempfile.TemporaryDirectory(prefix="board-audit-roundtrip-")
    path = Path(td.name) / "current.jsonl"
    proc = subprocess.run(["bd", "export", "--all", "-o", str(path)], text=True, capture_output=True)
    if proc.returncode != 0 or not path.exists():
        proc = subprocess.run(["bd", "export", "--all"], text=True, capture_output=True)
        if proc.returncode != 0:
            td.cleanup()
            raise RoundtripError(f"bd export --all failed: {proc.stderr.strip() or proc.stdout.strip()}")
        path.write_text(proc.stdout, encoding="utf-8")
    return path, td


def current_map(path: Path) -> dict[str, dict[str, Any]]:
    return {str(r["id"]): r for r in read_export_rows(path) if r.get("id") is not None}


def reconcile(pkg: dict[str, Any], current: dict[str, dict[str, Any]], *, allow_context_edit: bool = False) -> dict[str, Any]:
    warnings = validate_package(pkg, allow_context_edit=allow_context_edit)
    base = source_issues(pkg)
    desired = desired_issues(pkg)
    merged: dict[str, dict[str, Any]] = {}
    changes: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []

    for rid in sorted(desired):
        d = desired[rid]
        if rid not in base:
            row = copy.deepcopy(d)
            row["id"] = rid
            merged[rid] = row
            changes.append({"id": rid, "changed": True, "new": True, "user_changed_fields": sorted(row), "conflicts": []})
            continue
        if rid not in current:
            conflict = {"id": rid, "field": "<issue>", "base": "present", "current": "missing", "desired": "present"}
            conflicts.append(conflict)
            changes.append({"id": rid, "changed": d != base[rid], "new": False, "conflicts": [conflict]})
            continue
        row, change = merge_issue(base[rid], d, current[rid], rid)
        merged[rid] = row
        changes.append(change)
        conflicts.extend(change["conflicts"])

    known = set(current) | set(desired)
    for rid, row in desired.items():
        for rel in relation_map(rid, row):
            if rel[1] not in known:
                conflicts.append({"id": rid, "field": "dependencies", "base": None, "current": "target missing", "desired": list(rel)})

    return {
        "schema_version": "xtrm.board-audit.reconciliation.v1",
        "generated_at": utcnow(),
        "root_id": pkg.get("root_id"),
        "warnings": sorted(set(warnings)),
        "changes": changes,
        "conflicts": conflicts,
        "merged_issues": merged,
        "safe": not conflicts,
    }


def ensure_updated_at(row: dict[str, Any], *, is_new: bool) -> dict[str, Any]:
    out = copy.deepcopy(row)
    if is_new:
        return out
    stamp = utcnow()
    if "updated_at" in out or "updated" not in out:
        out["updated_at"] = stamp
        out.pop("updated", None)
    else:
        out["updated"] = stamp
    return out


def post_commands(rec: dict[str, Any]) -> list[list[str]]:
    commands: list[list[str]] = []
    for change in rec["changes"]:
        if not change.get("changed") or change.get("new"):
            continue
        rid = change["id"]
        for label in change.get("label_remove", []):
            commands.append(["bd", "update", rid, "--remove-label", label])

        removed = {tuple(x) for x in change.get("dependency_remove", [])}
        result = {tuple(x) for x in change.get("dependency_result", [])}
        pairs = {(s, t) for s, t, _ in removed}
        for source, target in sorted(pairs):
            commands.append(["bd", "dep", "remove", source, target])
            for s, t, typ in sorted(x for x in result if x[0] == source and x[1] == target):
                commands.append(["bd", "dep", "add", s, t, "--type", typ])
    return commands


def compile_plan(pkg_path: Path, pkg: dict[str, Any], current_path: Path, out_dir: Path, *, allow_context_edit: bool = False) -> tuple[dict[str, Any], dict[str, Any]]:
    cur = current_map(current_path)
    rec = reconcile(pkg, cur, allow_context_edit=allow_context_edit)
    out_dir.mkdir(parents=True, exist_ok=True)
    if not rec["safe"]:
        write_json(out_dir / "changes.json", rec)
        raise RoundtripError(f"three-way reconciliation found {len(rec['conflicts'])} conflict(s); see {out_dir / 'changes.json'}")

    base = source_issues(pkg)
    changed_ids = [c["id"] for c in rec["changes"] if c.get("changed")]
    records = [ensure_updated_at(rec["merged_issues"][rid], is_new=rid not in base) for rid in changed_ids]

    import_path = out_dir / "beads-import.jsonl"
    with import_path.open("w", encoding="utf-8") as f:
        for row in records:
            f.write(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")

    commands = post_commands(rec)
    plan = {
        "schema_version": PLAN_SCHEMA,
        "generated_at": utcnow(),
        "package": str(pkg_path),
        "base_package_sha256": (pkg.get("roundtrip") or {}).get("base_package_sha256"),
        "current_snapshot_sha256": hashlib.sha256(current_path.read_bytes()).hexdigest(),
        "import_file": "beads-import.jsonl",
        "changed_ids": changed_ids,
        "post_import_commands": commands,
        "conflict_count": 0,
        "verified_against_current": True,
    }
    write_json(out_dir / "changes.json", rec)
    write_json(out_dir / "apply-plan.json", plan)

    apply_sh = out_dir / "apply.sh"
    lines = [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'HERE="$(cd "$(dirname "$0")" && pwd)"',
        'echo "== Beads import dry-run =="',
        'bd import "$HERE/beads-import.jsonl" --dry-run --json',
        'if [ "${1:-}" != "--execute" ]; then',
        '  echo "dry-run only; pass --execute to mutate" >&2',
        "  exit 0",
        "fi",
        'bd import "$HERE/beads-import.jsonl" --json',
    ]
    for cmd in commands:
        lines.append(shlex.join(cmd))
    lines.extend(["bd dep cycles", 'echo "apply complete; run board-audit-roundtrip verify on the package"'])
    apply_sh.write_text("\n".join(lines) + "\n", encoding="utf-8")
    apply_sh.chmod(0o755)
    return rec, plan


def intent_fields(base: dict[str, Any] | None, desired: dict[str, Any]) -> set[str]:
    if base is None:
        return set(desired)
    return {k for k in set(base) | set(desired) if base.get(k, MISSING) != desired.get(k, MISSING)} - PROTECTED_EXISTING_FIELDS


def verify_intent(pkg: dict[str, Any], actual: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    base = source_issues(pkg)
    desired = desired_issues(pkg)
    failures: list[dict[str, Any]] = []
    for rid, d in desired.items():
        a = actual.get(rid)
        if a is None:
            failures.append({"id": rid, "field": "<issue>", "expected": "present", "actual": "missing"})
            continue
        b = base.get(rid)
        for field in sorted(intent_fields(b, d)):
            if field in {"dependencies", "deps", "relations"}:
                dset, aset = set(relation_map(rid, d)), set(relation_map(rid, a))
                bset = set(relation_map(rid, b or {}))
                for rel in dset - bset:
                    if rel not in aset:
                        failures.append({"id": rid, "field": "dependencies", "expected": list(rel), "actual": "missing"})
                for rel in bset - dset:
                    if rel in aset:
                        failures.append({"id": rid, "field": "dependencies", "expected": f"removed {list(rel)}", "actual": "present"})
            elif field == "labels":
                bset = set((b or {}).get("labels") or [])
                dset = set(d.get("labels") or [])
                aset = set(a.get("labels") or [])
                if not (dset - bset) <= aset or (bset - dset) & aset:
                    failures.append({"id": rid, "field": "labels", "expected_delta": {"add": sorted(dset-bset), "remove": sorted(bset-dset)}, "actual": sorted(aset)})
            elif field == "comments":
                bkeys = {comment_key(x) for x in ((b or {}).get("comments") or [])}
                dadd = {comment_key(x) for x in (d.get("comments") or [])} - bkeys
                akeys = {comment_key(x) for x in (a.get("comments") or [])}
                if not dadd <= akeys:
                    failures.append({"id": rid, "field": "comments", "expected_appended": sorted(dadd), "actual": sorted(akeys)})
            elif a.get(field, MISSING) != d.get(field, MISSING):
                failures.append({"id": rid, "field": field, "expected": val(d.get(field, MISSING)), "actual": val(a.get(field, MISSING))})
    return failures


def resolve_current_path(arg: str | None) -> tuple[Path, tempfile.TemporaryDirectory[str] | None]:
    if arg:
        return Path(arg), None
    return acquire_current_jsonl()


def cmd_prepare(args: argparse.Namespace) -> int:
    src = Path(args.package)
    pkg = prepare_package(load_json(src))
    out = Path(args.output) if args.output else src.with_name(src.stem + ".editable.json")
    write_json(out, pkg)
    print(out)
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    pkg = load_json(Path(args.package))
    warnings = validate_package(pkg, allow_context_edit=args.allow_context_edit)
    result: dict[str, Any] = {"valid": True, "warnings": warnings}
    temp = None
    if args.current_jsonl is not None or not args.offline:
        current_path, temp = resolve_current_path(args.current_jsonl)
        rec = reconcile(pkg, current_map(current_path), allow_context_edit=args.allow_context_edit)
        result["reconciliation"] = {k: v for k, v in rec.items() if k != "merged_issues"}
        result["valid"] = rec["safe"]
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    if temp:
        temp.cleanup()
    return 0 if result["valid"] else 3


def cmd_diff(args: argparse.Namespace) -> int:
    pkg = load_json(Path(args.package))
    current_path, temp = resolve_current_path(args.current_jsonl)
    rec = reconcile(pkg, current_map(current_path), allow_context_edit=args.allow_context_edit)
    print(json.dumps({k: v for k, v in rec.items() if k != "merged_issues"}, ensure_ascii=False, indent=2, sort_keys=True))
    if temp:
        temp.cleanup()
    return 0 if rec["safe"] else 3


def cmd_compile(args: argparse.Namespace) -> int:
    pkg_path = Path(args.package)
    pkg = load_json(pkg_path)
    current_path, temp = resolve_current_path(args.current_jsonl)
    out_dir = Path(args.output_dir) if args.output_dir else pkg_path.with_name(pkg_path.stem + ".roundtrip")
    rec, plan = compile_plan(pkg_path, pkg, current_path, out_dir, allow_context_edit=args.allow_context_edit)
    print(json.dumps({"output_dir": str(out_dir), "changed_ids": plan["changed_ids"], "post_import_commands": len(plan["post_import_commands"]), "safe": rec["safe"]}, indent=2))
    if temp:
        temp.cleanup()
    return 0


def run_checked(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(cmd, text=True, capture_output=True)
    if proc.returncode != 0:
        raise RoundtripError(f"command failed ({proc.returncode}): {shlex.join(cmd)}\n{proc.stderr.strip() or proc.stdout.strip()}")
    return proc


def cmd_apply(args: argparse.Namespace) -> int:
    if shutil.which("bd") is None:
        raise RoundtripError("bd is required for apply")
    pkg_path = Path(args.package)
    pkg = load_json(pkg_path)
    with tempfile.TemporaryDirectory(prefix="board-audit-apply-") as td:
        current_path, current_temp = resolve_current_path(args.current_jsonl)
        out_dir = Path(td) / "compiled"
        _, plan = compile_plan(pkg_path, pkg, current_path, out_dir, allow_context_edit=args.allow_context_edit)
        if current_temp:
            current_temp.cleanup()
        import_path = out_dir / plan["import_file"]
        dry = run_checked(["bd", "import", str(import_path), "--dry-run", "--json"])
        print(dry.stdout.strip())
        if not args.execute:
            print("dry-run only; re-run with --execute to mutate", file=sys.stderr)
            return 0
        run_checked(["bd", "import", str(import_path), "--json"])
        for cmd in plan["post_import_commands"]:
            run_checked(list(cmd))
        run_checked(["bd", "dep", "cycles"])

        post_path, post_temp = acquire_current_jsonl()
        failures = verify_intent(pkg, current_map(post_path))
        post_temp.cleanup()
        if failures:
            print(json.dumps({"verified": False, "failures": failures}, ensure_ascii=False, indent=2), file=sys.stderr)
            return 4
        print(json.dumps({"verified": True, "changed_ids": plan["changed_ids"]}, indent=2))
        return 0


def cmd_verify(args: argparse.Namespace) -> int:
    pkg = load_json(Path(args.package))
    current_path, temp = resolve_current_path(args.current_jsonl)
    failures = verify_intent(pkg, current_map(current_path))
    if temp:
        temp.cleanup()
    print(json.dumps({"verified": not failures, "failures": failures}, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if not failures else 4


def add_current_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--current-jsonl", help="use this bd export --all snapshot instead of acquiring the local board")
    p.add_argument("--allow-context-edit", action="store_true", help="allow edits to context-only ancestor records")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="board-audit-roundtrip", description="Safely reconcile edited board-audit work packages back into Beads")
    sub = p.add_subparsers(dest="command", required=True)

    q = sub.add_parser("prepare", help="add desired_issues editable state to an exported work package")
    q.add_argument("package")
    q.add_argument("-o", "--output")
    q.set_defaults(func=cmd_prepare)

    q = sub.add_parser("validate", help="validate editable package and optionally reconcile against current Beads")
    q.add_argument("package")
    q.add_argument("--offline", action="store_true", help="schema/edit-contract validation only; do not acquire current board")
    add_current_args(q)
    q.set_defaults(func=cmd_validate)

    q = sub.add_parser("diff", help="show three-way base/current/desired reconciliation")
    q.add_argument("package")
    add_current_args(q)
    q.set_defaults(func=cmd_diff)

    for name in ("compile-import", "compile-apply"):
        q = sub.add_parser(name, help="compile Beads JSONL + explicit post-import mutation plan")
        q.add_argument("package")
        q.add_argument("-o", "--output-dir")
        add_current_args(q)
        q.set_defaults(func=cmd_compile)

    q = sub.add_parser("apply", help="dry-run, optionally execute, then verify an edited package")
    q.add_argument("package")
    q.add_argument("--execute", action="store_true", help="perform mutations; without this flag apply is dry-run only")
    add_current_args(q)
    q.set_defaults(func=cmd_apply)

    q = sub.add_parser("verify", help="verify current Beads satisfies the package's user-intended delta")
    q.add_argument("package")
    add_current_args(q)
    q.set_defaults(func=cmd_verify)
    return p


def main(argv: list[str] | None = None) -> int:
    try:
        args = build_parser().parse_args(argv)
        return int(args.func(args))
    except RoundtripError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
