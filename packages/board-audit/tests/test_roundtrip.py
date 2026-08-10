from __future__ import annotations

import importlib.machinery
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "board-audit-roundtrip.py"
loader = importlib.machinery.SourceFileLoader("board_audit_roundtrip", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
rt = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(rt)


def issue(
    issue_id: str,
    *,
    title: str = "Task",
    description: str = "base",
    labels: list[str] | None = None,
    dependencies: list[dict] | None = None,
    comments: list[dict] | None = None,
    updated_at: str = "2026-08-10T10:00:00Z",
) -> dict:
    return {
        "id": issue_id,
        "title": title,
        "description": description,
        "status": "open",
        "priority": 2,
        "created_at": "2026-08-01T10:00:00Z",
        "updated_at": updated_at,
        "labels": labels or [],
        "dependencies": dependencies or [],
        "comments": comments or [],
        "metadata": {},
    }


def package() -> dict:
    root = issue(
        "x-1",
        labels=["a", "old"],
        dependencies=[{"issue_id": "x-1", "depends_on_id": "x-2", "type": "blocks"}],
        comments=[{"id": 1, "author": "d", "text": "old"}],
    )
    child = issue("x-2", title="Child")
    return {
        "schema_version": rt.PACKAGE_SCHEMA,
        "root_id": "x-1",
        "content_sha256": "abc",
        "issues": {
            "x-1": {"selection_state": "selected", "source": root},
            "x-2": {"selection_state": "selected", "source": child},
        },
    }


class RoundtripTests(unittest.TestCase):
    def test_prepare_creates_editable_desired_state(self):
        prepared = rt.prepare_package(package())
        self.assertEqual(prepared["desired_issues"]["x-1"]["description"], "base")
        self.assertEqual(prepared["roundtrip"]["schema_version"], rt.ROUNDTRIP_SCHEMA)

    def test_disjoint_current_change_is_preserved(self):
        prepared = rt.prepare_package(package())
        prepared["desired_issues"]["x-1"]["description"] = "desired"
        current = {key: value["source"].copy() for key, value in prepared["issues"].items()}
        current["x-1"] = dict(current["x-1"])
        current["x-1"]["priority"] = 1
        current["x-1"]["updated_at"] = "2026-08-10T11:00:00Z"

        rec = rt.reconcile(prepared, current)

        self.assertTrue(rec["safe"])
        self.assertEqual(rec["merged_issues"]["x-1"]["description"], "desired")
        self.assertEqual(rec["merged_issues"]["x-1"]["priority"], 1)

    def test_same_field_concurrent_edit_conflicts(self):
        prepared = rt.prepare_package(package())
        prepared["desired_issues"]["x-1"]["description"] = "mine"
        current = {key: value["source"].copy() for key, value in prepared["issues"].items()}
        current["x-1"] = dict(current["x-1"])
        current["x-1"]["description"] = "theirs"

        rec = rt.reconcile(prepared, current)

        self.assertFalse(rec["safe"])
        self.assertEqual(rec["conflicts"][0]["field"], "description")

    def test_label_delta_merges_with_unrelated_current_addition(self):
        prepared = rt.prepare_package(package())
        prepared["desired_issues"]["x-1"]["labels"] = ["a", "new"]
        current = {key: value["source"].copy() for key, value in prepared["issues"].items()}
        current["x-1"] = dict(current["x-1"])
        current["x-1"]["labels"] = ["a", "old", "other"]

        rec = rt.reconcile(prepared, current)

        self.assertEqual(rec["merged_issues"]["x-1"]["labels"], ["a", "new", "other"])
        change = next(item for item in rec["changes"] if item["id"] == "x-1")
        self.assertEqual(change["label_remove"], ["old"])

    def test_comments_are_append_only(self):
        prepared = rt.prepare_package(package())
        prepared["desired_issues"]["x-1"]["comments"] = []
        with self.assertRaises(rt.RoundtripError):
            rt.validate_package(prepared)

    def test_compile_emits_dependency_removal_after_import(self):
        prepared = rt.prepare_package(package())
        prepared["desired_issues"]["x-1"]["dependencies"] = []
        with tempfile.TemporaryDirectory() as td_raw:
            td = Path(td_raw)
            package_path = td / "package.json"
            rt.write_json(package_path, prepared)
            current = td / "current.jsonl"
            current.write_text(
                "\n".join(json.dumps(value["source"]) for value in prepared["issues"].values()) + "\n",
                encoding="utf-8",
            )
            out = td / "out"

            rec, plan = rt.compile_plan(package_path, prepared, current, out)

            self.assertTrue(rec["safe"])
            self.assertIn(["bd", "dep", "remove", "x-1", "x-2"], plan["post_import_commands"])
            self.assertTrue((out / "beads-import.jsonl").exists())
            self.assertTrue((out / "apply.sh").exists())

    def test_base_source_tampering_is_rejected(self):
        prepared = rt.prepare_package(package())
        prepared["issues"]["x-1"]["source"]["description"] = "tampered"
        with self.assertRaises(rt.RoundtripError):
            rt.validate_package(prepared)


if __name__ == "__main__":
    unittest.main()
