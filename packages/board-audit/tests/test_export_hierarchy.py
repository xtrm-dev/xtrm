from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "packages" / "board-audit" / "board-audit"


def run_export(rows: list[dict], *args: str) -> tuple[subprocess.CompletedProcess[str], dict, dict]:
    with tempfile.TemporaryDirectory() as td_raw:
        td = Path(td_raw)
        fake_bin = td / "bin"
        fake_bin.mkdir()
        fixture = td / "fixture.jsonl"
        fixture.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")

        fake_bd = fake_bin / "bd"
        fake_bd.write_text(
            "#!/usr/bin/env python3\n"
            "import pathlib, sys\n"
            f"fixture = pathlib.Path({str(fixture)!r}).read_text(encoding='utf-8')\n"
            "args = sys.argv[1:]\n"
            "if args[:2] == ['export', '--all']:\n"
            "    if '-o' in args:\n"
            "        pathlib.Path(args[args.index('-o') + 1]).write_text(fixture, encoding='utf-8')\n"
            "    else:\n"
            "        sys.stdout.write(fixture)\n"
            "elif args and args[0] == 'version':\n"
            "    print('bd test')\n"
            "else:\n"
            "    raise SystemExit('unexpected fake bd invocation: ' + ' '.join(args))\n",
            encoding="utf-8",
        )
        fake_bd.chmod(0o755)

        tmp_root = td / "tmp"
        tmp_root.mkdir()
        env = os.environ.copy()
        env["PATH"] = f"{fake_bin}:{env['PATH']}"
        env["TMPDIR"] = str(tmp_root)

        proc = subprocess.run(
            [str(SCRIPT), "--export", *args],
            cwd=REPO_ROOT,
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        export_root = tmp_root / f"board-audit-{REPO_ROOT.name}"
        snapshots = sorted(export_root.glob("export-*"))
        if not snapshots:
            return proc, {}, {}
        manifest = json.loads((snapshots[0] / "manifest.json").read_text(encoding="utf-8"))
        package_files = list((snapshots[0] / "work-packages").glob("*.json"))
        package = json.loads(package_files[0].read_text(encoding="utf-8")) if package_files else {}
        return proc, manifest, package


class ExportHierarchyTests(unittest.TestCase):
    def test_epic_export_includes_dotted_id_descendants_without_explicit_edges(self):
        rows = [
            {"id": "xtrm-2zd", "title": "Epic", "status": "open", "priority": 1, "issue_type": "epic"},
            {"id": "xtrm-2zd.1", "title": "Child one", "status": "open", "priority": 1, "issue_type": "task"},
            {"id": "xtrm-2zd.2", "title": "Child two", "status": "open", "priority": 1, "issue_type": "task"},
            {"id": "xtrm-2zd.3", "title": "Child three", "status": "open", "priority": 2, "issue_type": "task"},
        ]

        proc, manifest, package = run_export(rows, "--epic", "xtrm-2zd")

        self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
        self.assertIn("4 selected bead(s)", proc.stdout)
        self.assertEqual(manifest["selection"]["selected_record_count"], 4)
        self.assertEqual(len(manifest["packages"]), 1)
        self.assertEqual(manifest["packages"][0]["issue_count"], 4)
        self.assertEqual(set(package["issues"]), {row["id"] for row in rows})
        self.assertEqual(
            [child["id"] for child in package["hierarchy"]["children"]],
            ["xtrm-2zd.1", "xtrm-2zd.2", "xtrm-2zd.3"],
        )
        self.assertEqual(
            package["diagnostics"]["derived_dotted_parent_links"],
            [
                {"child": "xtrm-2zd.1", "parent": "xtrm-2zd"},
                {"child": "xtrm-2zd.2", "parent": "xtrm-2zd"},
                {"child": "xtrm-2zd.3", "parent": "xtrm-2zd"},
            ],
        )

    def test_dependency_target_uses_depends_on_id_not_edge_row_id(self):
        rows = [
            {"id": "x-root", "title": "Root", "status": "open", "priority": 1, "issue_type": "epic"},
            {
                "id": "x-child",
                "title": "Child",
                "status": "open",
                "priority": 1,
                "issue_type": "task",
                "dependencies": [
                    {
                        "id": "edge-row-uuid-parent",
                        "issue_id": "x-child",
                        "depends_on_id": "x-root",
                        "type": "parent-child",
                    },
                    {
                        "id": "edge-row-uuid-blocks",
                        "issue_id": "x-child",
                        "depends_on_id": "x-blocker",
                        "type": "blocks",
                    },
                ],
            },
            {"id": "x-blocker", "title": "Blocker", "status": "open", "priority": 1, "issue_type": "task"},
        ]

        proc, manifest, package = run_export(rows, "--epic", "x-root")

        self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
        self.assertEqual(manifest["selection"]["selected_record_count"], 2)
        self.assertEqual(set(package["issues"]), {"x-root", "x-child"})
        self.assertEqual([child["id"] for child in package["hierarchy"]["children"]], ["x-child"])
        self.assertEqual(package["relations"][0]["target"], "x-root")
        external = [r for r in package["external_relations"] if r["type"] == "blocks"]
        self.assertEqual(len(external), 1)
        self.assertEqual(external[0]["target"], "x-blocker")
        self.assertNotIn("edge-row-uuid-blocks", json.dumps(package))


if __name__ == "__main__":
    unittest.main()
