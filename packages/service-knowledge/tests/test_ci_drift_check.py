"""B5 — CI committed-drift gate: dirty blocks, clean passes, seconds-budgeted.

Covers the task VALIDATION without touching hooks or FTS5 caches:

* dirty PR (committed territory change past last_sync_ref) -> exit 1,
* umbrella/registry mismatch (registry service without umbrella row, missing
  skill_path) -> exit 1,
* clean PR (synced + convergent umbrella) -> exit 0,
* no registry (non-service repo) -> exit 0,
* whole gate finishes in seconds (budget enforced by the script itself).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "src" / "service_knowledge" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from ci_drift_check import main as ci_main  # type: ignore[import-not-found]  # noqa: E402
from drift_detector import scan_drift  # type: ignore[import-not-found]  # noqa: E402


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def _head(repo: Path) -> str:
    r = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                       check=True, capture_output=True, text=True)
    return r.stdout.strip()


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _make_repo(root: Path, name: str = "repo") -> tuple[Path, Path]:
    """Git repo with one umbrella pack, one service, a convergent umbrella, no drift."""
    repo = root / name
    umb = repo / ".xtrm" / "skills" / "acme" / "service-knowledge"
    svc = umb / "services" / "db"
    svc.mkdir(parents=True)
    (svc / "SKILL.md").write_text("# DB\n", encoding="utf-8")
    (repo / "db").mkdir(parents=True)
    (repo / "db" / "schema.sql").write_text("CREATE TABLE t (id int);\n", encoding="utf-8")
    registry = {
        "version": "1.0",
        "pack": "acme",
        "services": {
            "db": {
                "name": "db",
                "description": "Primary database.",
                "skill_path": ".xtrm/skills/acme/service-knowledge/services/db/SKILL.md",
                "territory": ["db/**"],
            },
        },
    }
    (umb / "service-registry.json").write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    _git(["init", "-q"], repo)
    _git(["config", "user.email", "test@test"], repo)
    _git(["config", "user.name", "test"], repo)
    # Convergent umbrella: render from the registry so the table matches.
    from umbrella_generator import generate_umbrella  # type: ignore[import-not-found]

    (umb / "SKILL.md").write_text(generate_umbrella(registry, repo.name, None, {}), encoding="utf-8")
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "init"], repo)
    # Stamp a verified sync at HEAD (working-tree stamp, uncommitted): the
    # registry/umbrella paths are outside the db/** territory, so the
    # uncommitted stamp files themselves never count as drift. This mirrors
    # drift_detector.update_sync_time without an extra commit round-trip.
    data = json.loads((umb / "service-registry.json").read_text(encoding="utf-8"))
    data["services"]["db"]["last_sync"] = _now_iso()
    data["services"]["db"]["last_sync_ref"] = _head(repo)
    (umb / "service-registry.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    existing = (umb / "SKILL.md").read_text(encoding="utf-8")
    (umb / "SKILL.md").write_text(generate_umbrella(data, repo.name, existing, {}), encoding="utf-8")
    return repo, umb / "service-registry.json"


def test_clean_repo_passes_in_seconds(tmp_path: Path, capsys) -> None:
    repo, _ = _make_repo(tmp_path, "clean")
    t0 = time.monotonic()
    rc = ci_main(["--path", str(repo), "--budget-seconds", "60"])
    dt = time.monotonic() - t0
    assert rc == 0
    assert dt < 60, f"seconds budget blown: {dt:.1f}s"
    out = capsys.readouterr().out
    assert "clean" in out.lower()


def test_dirty_repo_blocks(tmp_path: Path) -> None:
    repo, _ = _make_repo(tmp_path, "dirty")
    (repo / "db" / "schema.sql").write_text("CREATE TABLE t (id int, name text);\n", encoding="utf-8")
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "add column without reconcile"], repo)
    rc = ci_main(["--path", str(repo), "--budget-seconds", "60"])
    assert rc == 1  # blocks merge


def test_umbrella_mismatch_blocks(tmp_path: Path) -> None:
    repo, reg_path = _make_repo(tmp_path, "mismatch")
    # Registry gains a service but the umbrella is not regenerated.
    data = json.loads(reg_path.read_text(encoding="utf-8"))
    data["services"]["queue"] = {
        "name": "queue",
        "description": "Job queue.",
        "skill_path": ".xtrm/skills/acme/service-knowledge/services/db/SKILL.md",
        "territory": ["queue/**"],
    }
    reg_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "add service without umbrella regen"], repo)
    rc = ci_main(["--path", str(repo), "--budget-seconds", "60"])
    assert rc == 1  # stale umbrella blocks merge


def test_missing_skill_path_blocks(tmp_path: Path) -> None:
    repo, reg_path = _make_repo(tmp_path, "missing-skill")
    data = json.loads(reg_path.read_text(encoding="utf-8"))
    data["services"]["db"]["skill_path"] = ".xtrm/skills/acme/service-knowledge/services/gone/SKILL.md"
    reg_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "break skill_path"], repo)
    rc = ci_main(["--path", str(repo), "--budget-seconds", "60"])
    assert rc == 1


def test_no_registry_is_clean(tmp_path: Path) -> None:
    repo = tmp_path / "plain"
    repo.mkdir()
    _git(["init", "-q"], repo)
    _git(["config", "user.email", "test@test"], repo)
    _git(["config", "user.name", "test"], repo)
    (repo / "README.md").write_text("# plain\n", encoding="utf-8")
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "init"], repo)
    assert ci_main(["--path", str(repo), "--budget-seconds", "60"]) == 0


def _write_convergent_registry(repo: Path, reg_path: Path, data: dict) -> None:
    from umbrella_generator import generate_umbrella  # type: ignore[import-not-found]

    reg_path.write_text(json.dumps(data), encoding="utf-8")
    reg_path.with_name("SKILL.md").write_text(
        generate_umbrella(data, repo.name, None, {}), encoding="utf-8",
    )


@pytest.mark.parametrize("change", ["delete", "rename-within", "rename-out", "rename-in"])
def test_committed_deleted_and_renamed_paths_block(tmp_path: Path, change: str) -> None:
    repo, reg_path = _make_repo(tmp_path)
    source = repo / "db/schema.sql"
    destination = repo / "db/renamed.sql"
    if change == "rename-in":
        original = repo / "schema.sql"
        source.rename(original)
        _git(["add", "--", "db/schema.sql", "schema.sql"], repo)
        _git(["commit", "-qm", "move outside territory before sync"], repo)
        data = json.loads(reg_path.read_text(encoding="utf-8"))
        data["services"]["db"]["last_sync_ref"] = _head(repo)
        _write_convergent_registry(repo, reg_path, data)
        original.rename(source)
        expected = {"db/schema.sql"}
    elif change == "delete":
        source.unlink()
        expected = {"db/schema.sql"}
    else:
        if change == "rename-out":
            destination = repo / "schema.sql"
        source.rename(destination)
        expected = {"db/schema.sql"}
        if change == "rename-within":
            expected.add("db/renamed.sql")
    _git(["add", "--all", "--", "db", "schema.sql"] if change in {"rename-out", "rename-in"}
         else ["add", "--all", "--", "db"], repo)
    _git(["commit", "-qm", change], repo)
    drifted = scan_drift(str(repo), use_gitnexus=False)
    assert {item["file_path"] for item in drifted} == expected
    assert all(item["reason"] == "ref-range" for item in drifted)
    assert ci_main(["--path", str(repo)]) == 1


@pytest.mark.parametrize("sync_ref", [None, "0" * 40, "initial"])
@pytest.mark.parametrize("pattern", ["db/**", "db/"])
@pytest.mark.parametrize("file_path", ["db/schema.sql", "db/nested/schema.sql"])
def test_directory_territory_fallback_finds_files(
    tmp_path: Path, sync_ref: str | None, pattern: str, file_path: str,
) -> None:
    repo, reg_path = _make_repo(tmp_path)
    source = repo / file_path
    if file_path != "db/schema.sql":
        source.parent.mkdir()
        (repo / "db/schema.sql").rename(source)
        _git(["add", "--all", "--", "db"], repo)
        _git(["commit", "-qm", "nested source"], repo)
    data = json.loads(reg_path.read_text(encoding="utf-8"))
    service = data["services"]["db"]
    service["territory"] = [pattern]
    service["last_sync"] = "2000-01-01T00:00:00Z"
    service.pop("last_sync_ref", None)
    if sync_ref == "initial":
        service.pop("last_sync")
    elif sync_ref:
        service["last_sync_ref"] = sync_ref
    _write_convergent_registry(repo, reg_path, data)
    (repo / ".gitignore").write_text("db/cache/\n", encoding="utf-8")
    artifact = repo / "db/cache/generated.sql"
    artifact.parent.mkdir()
    artifact.write_text("generated\n", encoding="utf-8")
    os.utime(source, (978307200, 978307200))
    if sync_ref != "initial":
        with pytest.raises(RuntimeError, match="history.*db"):
            scan_drift(str(repo), use_gitnexus=False)
        assert ci_main(["--path", str(repo)]) != 0
        return
    drifted = scan_drift(str(repo), use_gitnexus=False)
    assert [(item["file_path"], item["reason"]) for item in drifted] == [
        (file_path, "initial-sync-needed"),
    ]
    assert ci_main(["--path", str(repo)]) == 1


@pytest.mark.parametrize("sync_ref", ["valid", None, "0" * 40])
def test_gitignored_artifacts_do_not_create_drift(tmp_path: Path, sync_ref: str | None) -> None:
    repo, reg_path = _make_repo(tmp_path)
    (repo / ".gitignore").write_text("db/cache/\n", encoding="utf-8")
    _git(["add", "--", ".gitignore"], repo)
    _git(["commit", "-qm", "ignore generated artifacts"], repo)
    artifact = repo / "db/cache/generated.sql"
    artifact.parent.mkdir()
    artifact.write_text("generated\n", encoding="utf-8")
    data = json.loads(reg_path.read_text(encoding="utf-8"))
    service = data["services"]["db"]
    service["last_sync"] = "2000-01-01T00:00:00Z"
    service.pop("last_sync_ref", None)
    if sync_ref:
        service["last_sync_ref"] = _head(repo) if sync_ref == "valid" else sync_ref
    _write_convergent_registry(repo, reg_path, data)
    os.utime(repo / "db/schema.sql", (1, 1))
    if sync_ref != "valid":
        with pytest.raises(RuntimeError, match="history.*db"):
            scan_drift(str(repo), use_gitnexus=False)
        assert ci_main(["--path", str(repo)]) != 0
        return
    assert scan_drift(str(repo), use_gitnexus=False) == []
    assert ci_main(["--path", str(repo)]) == 0


def test_directory_territory_working_tree_fallback(tmp_path: Path, monkeypatch) -> None:
    repo, reg_path = _make_repo(tmp_path)
    data = json.loads(reg_path.read_text(encoding="utf-8"))
    data["services"]["db"]["last_sync"] = "2000-01-01T00:00:00Z"
    _write_convergent_registry(repo, reg_path, data)
    (repo / "db/schema.sql").write_text("ALTER TABLE t ADD COLUMN name text;\n", encoding="utf-8")
    run_subprocess = subprocess.run

    def fail_working_tree_diff(command, **kwargs):
        if command == ["git", "-C", str(repo), "diff", "--name-only", "HEAD"]:
            return subprocess.CompletedProcess(command, 1, stdout="", stderr="git failure")
        return run_subprocess(command, **kwargs)

    monkeypatch.setattr(subprocess, "run", fail_working_tree_diff)
    drifted = scan_drift(str(repo), use_gitnexus=False)
    assert [(item["file_path"], item["reason"]) for item in drifted] == [
        ("db/schema.sql", "mtime-heuristic"),
    ]
    assert ci_main(["--path", str(repo)]) == 1


def _assert_unknown_history_blocks(repo: Path, capsys) -> None:
    capsys.readouterr()
    # scan_drift must refuse outright: a returned list (e.g. an mtime guess) is the regression.
    with pytest.raises(RuntimeError, match="history") as raised:
        scan_drift(str(repo), use_gitnexus=False)
    assert "db" in str(raised.value)
    assert ci_main(["--path", str(repo)]) != 0
    output = capsys.readouterr()
    assert "clean" not in output.out.lower()
    assert "db" in output.out + output.err


@pytest.mark.parametrize("sync_ref", [None, "0" * 40], ids=["missing-ref", "invalid-ref"])
@pytest.mark.parametrize("state", ["old-survivor", "deleted-territory", "ignored-newer"])
def test_unknown_history_never_trusts_mtimes(
    tmp_path: Path, capsys, sync_ref: str | None, state: str,
) -> None:
    repo, reg_path = _make_repo(tmp_path)
    source = repo / "db/schema.sql"
    if state == "deleted-territory":
        source.unlink()
        _git(["add", "--all", "--", "db"], repo)
        _git(["commit", "-qm", "delete last territory file"], repo)
        assert not any((repo / "db").rglob("*"))
    else:
        os.utime(source, (1, 1))
    if state == "ignored-newer":
        (repo / ".gitignore").write_text("db/cache/\n", encoding="utf-8")
        _git(["add", "--", ".gitignore"], repo)
        _git(["commit", "-qm", "ignore generated artifacts"], repo)
        artifact = repo / "db/cache/generated.sql"
        artifact.parent.mkdir()
        artifact.write_text("generated\n", encoding="utf-8")
        os.utime(artifact, (4102444800, 4102444800))
    data = json.loads(reg_path.read_text(encoding="utf-8"))
    service = data["services"]["db"]
    service["last_sync"] = "2000-01-01T00:00:00Z"
    service.pop("last_sync_ref", None)
    if sync_ref is not None:
        service["last_sync_ref"] = sync_ref
    _write_convergent_registry(repo, reg_path, data)
    _assert_unknown_history_blocks(repo, capsys)


def test_unknown_history_failed_required_diff_blocks(
    tmp_path: Path, monkeypatch, capsys,
) -> None:
    repo, reg_path = _make_repo(tmp_path)
    os.utime(repo / "db/schema.sql", (1, 1))
    ref = json.loads(reg_path.read_text(encoding="utf-8"))["services"]["db"]["last_sync_ref"]
    run_subprocess = subprocess.run
    failures: list[list[str]] = []

    def fail_required_diff(command, **kwargs):
        if command[:4] == ["git", "-C", str(repo), "diff"] and f"{ref}..HEAD" in command:
            failures.append(command)
            return subprocess.CompletedProcess(command, 1, stdout="", stderr="history unavailable")
        return run_subprocess(command, **kwargs)

    monkeypatch.setattr(subprocess, "run", fail_required_diff)
    _assert_unknown_history_blocks(repo, capsys)
    assert len(failures) >= 2, "scan and CI must both attempt required history"


def test_unknown_history_error_names_every_affected_service(tmp_path: Path) -> None:
    """One refusal lists all unverifiable services, not just the first (#334 finding 2)."""
    repo, reg_path = _make_repo(tmp_path)
    data = json.loads(reg_path.read_text(encoding="utf-8"))
    for sid in ("db", "cache"):
        data["services"][sid] = {**data["services"]["db"], "name": sid}
        data["services"][sid]["last_sync"] = "2000-01-01T00:00:00Z"
        data["services"][sid].pop("last_sync_ref", None)
    _write_convergent_registry(repo, reg_path, data)
    with pytest.raises(RuntimeError) as exc:
        scan_drift(str(repo), use_gitnexus=False)
    assert "2 service(s)" in str(exc.value)
    assert "'db'" in str(exc.value) and "'cache'" in str(exc.value)
    assert "drift_detector.py sync" in str(exc.value)


def test_reconcile_handles_a_committed_deletion(tmp_path: Path, monkeypatch) -> None:
    """A deleted territory file is reported as drift, so reconcile must be able to process it
    (it used to die with FileNotFoundError and leave CI red with no way out)."""
    import reconcile as reconcile_mod  # type: ignore[import-not-found]

    repo, _ = _make_repo(tmp_path)
    (repo / "db/schema.sql").unlink()
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "drop schema"], repo)
    assert [d["file_path"] for d in scan_drift(str(repo), use_gitnexus=False)] == ["db/schema.sql"]

    prompts: list[str] = []

    def fake_llm(prompt: str, api_key: str):  # noqa: ARG001
        prompts.append(prompt)
        return reconcile_mod.LlmResult(content="# DB\n", tokens=1)

    monkeypatch.chdir(repo)
    monkeypatch.setattr(reconcile_mod, "call_nano_gpt", fake_llm)
    result = reconcile_mod.reconcile(reconcile_mod.ReconcileOptions(True, None, "k", None))

    assert result["failed"] == []
    assert result["reconciled_count"] == 1
    assert "no longer exists at HEAD" in prompts[0]


def test_scan_cli_reports_unknown_history_without_a_traceback(tmp_path: Path, monkeypatch, capsys) -> None:
    import drift_detector  # type: ignore[import-not-found]

    repo, reg_path = _make_repo(tmp_path)
    data = json.loads(reg_path.read_text(encoding="utf-8"))
    data["services"]["db"]["last_sync"] = "2000-01-01T00:00:00Z"
    data["services"]["db"].pop("last_sync_ref", None)
    _write_convergent_registry(repo, reg_path, data)
    monkeypatch.chdir(repo)
    monkeypatch.setattr(sys, "argv", ["drift_detector.py", "scan"])
    with pytest.raises(SystemExit) as raised:
        drift_detector.main()
    assert raised.value.code == 2
    err = capsys.readouterr().err
    assert "cannot determine drift" in err and "'db'" in err


def _drifted_skill_repo(tmp_path: Path):
    """Repo whose `db` SKILL (frontmatter, SEMANTIC block, contract headings) is behind a source change."""
    fixture = Path(__file__).resolve().parent.parent / "src/service_knowledge/scripts/verifier/tests/fixtures/alertmanager/current.md"
    skill_text = fixture.read_text(encoding="utf-8").replace("source/**", "db/**").replace("alertmanager", "db").replace("Alertmanager", "DB")
    skill_text = skill_text.replace("## Failure Modes", "<!-- SEMANTIC_START -->\nOperator note: never drop the replica first.\n<!-- SEMANTIC_END -->\n\n## Failure Modes")

    repo, reg_path = _make_repo(tmp_path)
    skill = repo / ".xtrm/skills/acme/service-knowledge/services/db/SKILL.md"
    skill.write_text(skill_text, encoding="utf-8")
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "skill body"], repo)
    data = json.loads(reg_path.read_text(encoding="utf-8"))
    data["services"]["db"]["last_sync_ref"] = _head(repo)
    reg_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    (repo / "db" / "schema.sql").write_text("CREATE TABLE t (id int, note text);\n", encoding="utf-8")
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "schema change"], repo)
    assert [d["file_path"] for d in scan_drift(str(repo), use_gitnexus=False)] == ["db/schema.sql"]
    return repo, reg_path, skill, skill_text


def test_real_reconcile_rewrites_the_skill_stamps_the_ref_and_clears_drift(tmp_path: Path, monkeypatch) -> None:
    """Non-dry-run end to end: a valid SKILL goes through the real gate and atomic write; only the LLM call is faked."""
    import reconcile as reconcile_mod  # type: ignore[import-not-found]

    repo, reg_path, skill, skill_text = _drifted_skill_repo(tmp_path)
    updated = skill_text.replace("The entrypoint templates its config with sed at boot.",
                                 "The entrypoint templates its config with sed at boot. Table `t` carries a `note` column.")
    assert updated != skill_text
    monkeypatch.chdir(repo)
    monkeypatch.setattr(reconcile_mod, "call_nano_gpt", lambda prompt, key: reconcile_mod.LlmResult(content=updated, tokens=7))

    result = reconcile_mod.reconcile(reconcile_mod.ReconcileOptions(False, None, "k", None))

    assert result["failed"] == [], result
    assert result["status"] == "success" and result["reconciled_count"] == 1
    assert skill.read_text(encoding="utf-8") == updated  # the real gate accepted it and the write landed
    assert json.loads(reg_path.read_text(encoding="utf-8"))["services"]["db"]["last_sync_ref"] == _head(repo)
    assert scan_drift(str(repo), use_gitnexus=False) == []


def test_real_reconcile_reports_why_the_gate_refused_a_destructive_rewrite(tmp_path: Path, monkeypatch) -> None:
    """The operator-visible reconcile result names the removed curated text, not only a count."""
    import reconcile as reconcile_mod  # type: ignore[import-not-found]

    repo, reg_path, skill, skill_text = _drifted_skill_repo(tmp_path)
    kept, in_semantic, in_front = [], False, False
    for i, line in enumerate(skill_text.splitlines()):
        if line.strip() == "---":
            in_front = not in_front if i == 0 or in_front else in_front
            kept.append(line)
            continue
        in_semantic = in_semantic or "SEMANTIC_START" in line
        if in_front or in_semantic or line.startswith("#") or not line.strip():
            kept.append(line)
        in_semantic = in_semantic and "SEMANTIC_END" not in line
    destructive = "\n".join(kept) + "\n"
    assert len(destructive) < len(skill_text) * 0.7
    original = skill.read_bytes()
    monkeypatch.chdir(repo)
    monkeypatch.setattr(reconcile_mod, "call_nano_gpt", lambda prompt, key: reconcile_mod.LlmResult(content=destructive, tokens=7))

    result = reconcile_mod.reconcile(reconcile_mod.ReconcileOptions(False, None, "k", None))

    assert result["status"] == "partial" and skill.read_bytes() == original
    assert "curated_text_removed_excessive" in result["failed"][0]["error"], result["failed"]
    codes = " ".join(result["gates"][0]["structural_issues"])
    assert "curated_text_removed_excessive" in codes, result["gates"]
