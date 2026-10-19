#!/usr/bin/env python3
"""
Standalone service-knowledge git-hook + migration installer (runtime-agnostic fallback).

> NORMAL PATH: ``service-knowledge install`` (the package CLI) vendors the machinery and
> calls this script with ``--hooks-only`` to wire the non-blocking git reminders. You only
> need to run this file directly when the ``service-knowledge`` CLI cannot be installed.

Run from inside your target project directory. Idempotent. It only:
  - installs the non-blocking git pre-commit/pre-push/post-merge doc + staleness reminders
  - (full mode) migrates the pack layout, upgrades per-service SKILL.md, regenerates the
    per-repo ``<repo>-service-knowledge`` umbrella

The Claude SessionStart/PreToolUse/PostToolUse hooks are wired by the CLI into
``.claude/settings.json`` (project-local machinery under ``.xtrm/skills/default/service-knowledge``).
"""

import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()            # .../service-knowledge/install/
GIT_HOOKS  = SCRIPT_DIR / "git-hooks"                   # install/git-hooks/
SCRIPTS    = SCRIPT_DIR.parent / "scripts"             # .../service-knowledge/scripts/ (location-independent)

GREEN  = "\033[0;32m"
YELLOW = "\033[1;33m"
NC     = "\033[0m"

MARKER_DOC        = "# [jaggers] doc-reminder"
MARKER_STALENESS  = "# [jaggers] skill-staleness"
MARKER_DRIFT_SWEEP = "# [jaggers] drift-sweep"
MARKER_CHAIN      = "# [jaggers] chain-githooks"

NEW_UMBRELLA = "service-knowledge"
LEGACY_UMBRELLA = "service-skills"

# B0 hotfix: canonical hook names owned by this installer. Self-check gates on
# post-merge (the drift-sweep reconciliation point); pre-commit/pre-push warn
# but do not fail the install.
_HOOK_NAMES = ("pre-commit", "pre-push", "post-merge")


def get_project_root() -> Path:
    try:
        r = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                           capture_output=True, text=True, check=True, timeout=5)
        return Path(r.stdout.strip())
    except subprocess.CalledProcessError:
        print("Error: not inside a git repository.")
        sys.exit(1)


def _resolve_active_hooks_dir(project_root: Path) -> Path:
    """Resolve the active hooks dir exactly as git would.

    Single source of truth: ``git rev-parse --git-path hooks`` respects
    ``core.hooksPath`` (including absolute overrides) and linked-worktree
    ``.git/worktrees/<n>/hooks`` layouts. Never read ``core.hooksPath``
    directly — that bypasses git's own resolution and drifts from what
    actually fires.
    """
    try:
        resolved = subprocess.check_output(
            ["git", "-C", str(project_root), "rev-parse", "--git-path", "hooks"],
            text=True, timeout=5,
        ).strip()
        if resolved:
            p = Path(resolved)
            return p if p.is_absolute() else project_root / resolved
    except Exception:
        pass
    return project_root / ".git" / "hooks"


def _normalize_legacy_hook_text(content: str) -> tuple[str, bool]:
    """Rewrite ``service-skills`` path segments to ``service-knowledge``.

    Covers the umbrella rename: consumer ``.githooks/*`` files (and old
    chain blocks) that bake the absolute legacy body path become valid
    again. Idempotent — no-op when the legacy name is absent.
    """
    if LEGACY_UMBRELLA not in content:
        return content, False
    return content.replace(LEGACY_UMBRELLA, NEW_UMBRELLA), True


def _ensure_block(content: str, marker: str, desired: str) -> tuple[str, bool]:
    """Ensure exactly one canonical ``marker`` block equals ``desired``.

    Rewrite (never duplicate): a stale block under the same marker is
    replaced in place; duplicate markers collapse to one. Returns
    (new_content, changed).
    """
    desired_block = desired.lstrip("\n")
    if marker not in content:
        # Legacy absolute invocation without our marker (pre-rename installer
        # baked ``.../service-skills/.../post_merge_drift_sweep.py`` guarded by
        # ``[ -f ]``). Strip those stale lines so re-run repairs instead of
        # stacking a second invocation alongside the dead one.
        lines = content.splitlines(keepends=True)
        kept = [ln for ln in lines if "post_merge_drift_sweep.py" not in ln
                and "doc_reminder.py" not in ln
                and "skill_staleness.py" not in ln]
        stripped = "".join(kept)
        changed = stripped != content
        base = stripped if stripped.endswith("\n") or stripped == "" else stripped + "\n"
        return base + desired_block, True
    if desired in content:
        # Collapse accidental duplicates (re-run must not append chains).
        parts = content.split(desired)
        if len(parts) == 2:
            return content, False
        return parts[0] + desired + parts[-1].lstrip("\n"), True
    start = content.index(marker)
    # End our block at the next comment line (any `#...`), not just the next
    # jaggers marker: sibling conventions (`.bd-sync`, beads/dolt custom
    # blocks) must survive a rewrite. Our blocks never contain a `#`-led
    # line, so the next `#` line always starts foreign content.
    end = content.find("\n#", start + len(marker))
    if end < 0:
        return content[:start] + desired_block, True
    tail = content[end:]
    # desired_block ends with "\n" and tail starts with "\n#": join without
    # doubling the blank line separator.
    if desired_block.endswith("\n") and tail.startswith("\n"):
        tail = tail[1:]
    return content[:start] + desired_block + tail, True


def _desired_chain_snippet(hook_name: str) -> str:
    """Runtime-relative chain: resolve the toplevel at fire time.

    Never bakes the install-time absolute ``source_hook`` path — absolute
    chains outlive moves, ephemeral worktrees, and linked-worktree gitdirs.
    """
    return (
        f"\n{MARKER_CHAIN}\n"
        'root="$(git rev-parse --show-toplevel 2>/dev/null)"\n'
        f'if [ -n "$root" ] && [ -x "$root/.githooks/{hook_name}" ]; then\n'
        f'    "$root/.githooks/{hook_name}" "$@"\n'
        "fi\n"
    )


def _self_check(project_root: Path, active_hooks_dir: Path) -> tuple[bool, list[str]]:
    """Post-install self-check: resolve as git would, checksum/execute body.

    Fails (ok=False) when no hook can fire: missing source, missing chain
    in the git-resolved active dir, stale ``service-skills`` survivors, or a
    missing/uncompilable sweep body. Never claims success on failure — the
    caller must not print ``activated`` when ok is False.
    """
    problems: list[str] = []
    details: list[str] = []
    # Active dir, exactly as git resolves it.
    try:
        git_resolved = subprocess.check_output(
            ["git", "-C", str(project_root), "rev-parse", "--git-path", "hooks"],
            text=True, timeout=5,
        ).strip()
        details.append(f"git-path hooks: {git_resolved}")
    except Exception as exc:
        problems.append(f"git rev-parse --git-path hooks failed: {exc}")
        git_resolved = ""
    post_src = project_root / ".githooks" / "post-merge"
    if not post_src.is_file():
        problems.append(f".githooks/post-merge missing: {post_src}")
    else:
        try:
            src_text = post_src.read_text(encoding="utf-8")
        except OSError as exc:
            problems.append(f".githooks/post-merge unreadable: {exc}")
            src_text = ""
        if src_text:
            if MARKER_DRIFT_SWEEP not in src_text:
                problems.append(".githooks/post-merge missing drift-sweep marker")
            if LEGACY_UMBRELLA in src_text:
                problems.append(".githooks/post-merge still references service-skills")
            if "service-knowledge/install/git-hooks/post_merge_drift_sweep.py" not in src_text:
                problems.append(".githooks/post-merge missing renamed sweep body ref")
            if "git rev-parse --show-toplevel" not in src_text:
                problems.append(".githooks/post-merge missing relative runtime resolution")
            r = subprocess.run(["bash", "-n", str(post_src)],
                               capture_output=True, text=True, timeout=5)
            if r.returncode != 0:
                problems.append(f".githooks/post-merge bash -n failed: {r.stderr.strip()[:200]}")
    # Chain in the active (git-resolved) dir — unless it IS the source dir
    # (core.hooksPath=.githooks convention: no chain needed, same file fires).
    try:
        same = post_src.resolve() == (active_hooks_dir / "post-merge").resolve()
    except OSError:
        same = False
    active_post = active_hooks_dir / "post-merge"
    if same:
        details.append("active hooks dir == .githooks (hooksPath convention): chain n/a")
    else:
        if not active_post.is_file():
            problems.append(f"active post-merge missing: {active_post}")
        else:
            try:
                active_text = active_post.read_text(encoding="utf-8")
            except OSError as exc:
                problems.append(f"active post-merge unreadable: {exc}")
                active_text = ""
            if active_text:
                if MARKER_CHAIN not in active_text:
                    problems.append(f"active post-merge missing chain marker ({active_post})")
                if LEGACY_UMBRELLA in active_text:
                    problems.append("active post-merge still references service-skills")
                # Stale absolute chain bakes the install-time source path.
                if '.githooks/post-merge"' in active_text and 'if [ -x "/' in active_text:
                    problems.append("active post-merge chain still bakes an absolute path")
                if ".githooks/post-merge" not in active_text:
                    problems.append("active post-merge chain does not resolve .githooks/post-merge")
                # .bd-sync sibling convention: never clobber the beads chain.
                bd_sync = active_hooks_dir / "post-merge.bd-sync"
                if bd_sync.is_file() and "post-merge.bd-sync" not in active_text:
                    problems.append("active post-merge lost its .bd-sync sibling chaining")
                r = subprocess.run(["bash", "-n", str(active_post)],
                                   capture_output=True, text=True, timeout=5)
                if r.returncode != 0:
                    problems.append(f"active post-merge bash -n failed: {r.stderr.strip()[:200]}")
    # Resolved body: checksum + compile (execute-equivalent without side effects).
    body = (project_root / ".xtrm/skills/default/service-knowledge"
            / "install/git-hooks/post_merge_drift_sweep.py")
    if not body.is_file():
        # Standalone fallback (CLI not vendored yet): package copy must exist.
        if not (GIT_HOOKS / "post_merge_drift_sweep.py").is_file():
            problems.append(f"sweep body missing: {body}")
        else:
            details.append(f"body not yet vendored; package copy present")
    else:
        try:
            import hashlib
            digest = hashlib.sha256(body.read_bytes()).hexdigest()[:12]
            details.append(f"body sha256:{digest} {body.relative_to(project_root)}")
        except OSError as exc:
            problems.append(f"sweep body unreadable: {exc}")
        else:
            r = subprocess.run(["python3", "-m", "py_compile", str(body)],
                               capture_output=True, text=True, timeout=30)
            if r.returncode != 0:
                problems.append(f"sweep body py_compile failed: {r.stderr.strip()[:200]}")
    return (len(problems) == 0, problems + details)


def install_git_hooks(project_root: Path) -> bool:
    """Install + self-check git hooks. Returns True only when a hook can fire."""
    print("\n── Git hooks ───────────────────────────")
    doc_script       = GIT_HOOKS / "doc_reminder.py"
    staleness_script = GIT_HOOKS / "skill_staleness.py"
    drift_script     = GIT_HOOKS / "post_merge_drift_sweep.py"

    pre_commit = project_root / ".githooks" / "pre-commit"
    pre_push   = project_root / ".githooks" / "pre-push"
    post_merge = project_root / ".githooks" / "post-merge"

    for hp in (pre_commit, pre_push, post_merge):
        if not hp.exists():
            hp.parent.mkdir(parents=True, exist_ok=True)
            hp.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
            hp.chmod(0o755)

    # Resolve the checkout at hook runtime. The installer may run from an ephemeral
    # worktree, so absolute install-time paths would outlive their source tree.
    script_rel = {
        doc_script: ".xtrm/skills/default/service-knowledge/install/git-hooks/doc_reminder.py",
        staleness_script: ".xtrm/skills/default/service-knowledge/install/git-hooks/skill_staleness.py",
        drift_script: ".xtrm/skills/default/service-knowledge/install/git-hooks/post_merge_drift_sweep.py",
    }

    def make_snippet(marker: str, script: Path) -> str:
        rel = script_rel[script]
        return (
            f"\n{marker}\n"
            "if command -v python3 &>/dev/null; then\n"
            '    root="$(git rev-parse --show-toplevel 2>/dev/null)"\n'
            f'    if [ -n "$root" ] && [ -f "$root/{rel}" ]; then\n'
            f'        python3 "$root/{rel}" || true\n'
            "    fi\n"
            "fi\n"
        )

    snippets = [
        (pre_commit, MARKER_DOC, make_snippet(MARKER_DOC, doc_script)),
        (pre_push, MARKER_STALENESS, make_snippet(MARKER_STALENESS, staleness_script)),
        (post_merge, MARKER_DRIFT_SWEEP, make_snippet(MARKER_DRIFT_SWEEP, drift_script)),
    ]

    for hook_path, marker, snippet in snippets:
        raw = hook_path.read_text(encoding="utf-8")
        content, legacy_fixed = _normalize_legacy_hook_text(raw)
        new_content, _block_changed = _ensure_block(content, marker, snippet)
        if new_content != raw:
            hook_path.write_text(new_content, encoding="utf-8")
            hook_path.chmod(0o755)
            action = "repaired" if (legacy_fixed or marker in raw) else "installed"
            print(f"{GREEN}  ✓{NC} {action}: {hook_path.relative_to(project_root)}")
        else:
            print(f"{YELLOW}  ○{NC} already installed: {hook_path.name}")

    active_hooks_dir = _resolve_active_hooks_dir(project_root)
    for hooks_dir in {active_hooks_dir}:
        hooks_dir.mkdir(parents=True, exist_ok=True)
        for name, source_hook in (("pre-commit", pre_commit), ("pre-push", pre_push), ("post-merge", post_merge)):
            target_hook = hooks_dir / name
            if not target_hook.exists():
                target_hook.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
            target_hook.chmod(0o755)
            try:
                if target_hook.resolve() == source_hook.resolve():
                    continue
            except OSError:
                pass
            desired = _desired_chain_snippet(name)
            raw_target = target_hook.read_text(encoding="utf-8")
            norm_target, _ = _normalize_legacy_hook_text(raw_target)
            new_target, _chain_changed = _ensure_block(norm_target, MARKER_CHAIN, desired)
            if new_target != raw_target:
                target_hook.write_text(new_target, encoding="utf-8")
                target_hook.chmod(0o755)

    ok, report = _self_check(project_root, active_hooks_dir)
    if ok:
        print(f"{GREEN}  ✓{NC} activated in {active_hooks_dir} (self-check: {'; '.join(report)})")
        return True
    print(f"\033[1;31m  xx hooks self-check FAILED:{NC}", file=sys.stderr)
    for line in report:
        print(f"     - {line}", file=sys.stderr)
    print("     No hook can be trusted to fire; not claiming activation.", file=sys.stderr)
    return False


RESERVED_PACK_NAMES = {"default", "optional", "user", "active", "local-legacy"}


def _pack_roots(project_root: Path) -> list[Path]:
    skills_root = project_root / ".xtrm" / "skills"
    return [skills_root, skills_root / "user" / "packs"]


def _packs_with_registry(project_root: Path) -> list[Path]:
    """Packs that carry a service registry; new umbrella name wins over legacy/v1 shim."""
    out: list[Path] = []
    seen: set[Path] = set()
    for packs_root in _pack_roots(project_root):
        if not packs_root.exists():
            continue
        for pack in sorted(p for p in packs_root.iterdir() if p.is_dir() and p.name not in RESERVED_PACK_NAMES):
            resolved = pack.resolve()
            if resolved in seen:
                continue
            has_registry = (
                (pack / NEW_UMBRELLA / "service-registry.json").exists()
                or (pack / LEGACY_UMBRELLA / "service-registry.json").exists()
                or (pack / "service-registry.json").exists()
            )
            if has_registry:
                seen.add(resolved)
                out.append(pack)
    return out


def _pack_registry(pack: Path) -> Path | None:
    for name in (NEW_UMBRELLA, LEGACY_UMBRELLA):
        candidate = pack / name / "service-registry.json"
        if candidate.exists():
            return candidate
    old = pack / "service-registry.json"
    return old if old.exists() else None


def migrate_existing_skills(project_root: Path) -> None:
    """Upgrade already-installed per-service SKILL.md files to the current canonical
    section set (idempotent, SEMANTIC-preserving)."""
    print("\n── Migrate existing skills ─────────────")
    migrator = SCRIPTS / "skill_migrator.py"
    packs = _packs_with_registry(project_root)
    if not migrator.exists() or not packs:
        print(f"{YELLOW}  ○{NC} nothing to migrate (no registry or migrator)")
        return
    changed = 0
    for pack in packs:
        registry = _pack_registry(pack)
        if registry is None:
            continue
        try:
            services = json.loads(registry.read_text(encoding="utf-8")).get("services", {})
        except json.JSONDecodeError:
            print(f"{YELLOW}  ○{NC} registry malformed in pack '{pack.name}'; skipping")
            continue
        for service_id, info in services.items():
            skill_rel = info.get("skill_path")
            if not skill_rel:
                continue
            skill_md = project_root / skill_rel
            if not skill_md.exists():
                continue
            r = subprocess.run(["python3", str(migrator), str(skill_md)],
                               capture_output=True, text=True, check=False)
            if r.returncode == 0 and r.stdout.strip().startswith("migrated:"):
                changed += 1
                print(f"{GREEN}  ✓{NC} upgraded {service_id} → devops sections")
    if changed == 0:
        print(f"{GREEN}  ✓{NC} all service skills already current")


def generate_umbrellas(project_root: Path) -> None:
    """Generate/refresh the per-repo umbrella SKILL.md (``<repo>-service-knowledge``)."""
    print("\n── Umbrella ────────────────────────────")
    generator = SCRIPTS / "umbrella_generator.py"
    packs = _packs_with_registry(project_root)
    if not generator.exists() or not packs:
        print(f"{YELLOW}  ○{NC} nothing to generate (no generator or packs)")
        return
    repo_name = project_root.name
    wrote = 0
    for pack in packs:
        env = {**os.environ, "XTRM_PACK": pack.name}
        r = subprocess.run(["python3", str(generator), repo_name],
                           cwd=str(project_root), env=env, capture_output=True, text=True, check=False)
        if r.returncode == 0 and r.stdout.strip().startswith("generated:"):
            wrote += 1
            print(f"{GREEN}  ✓{NC} umbrella refreshed for pack '{pack.name}' → {repo_name}-service-knowledge")
    if wrote == 0:
        print(f"{GREEN}  ✓{NC} all umbrellas already current")


def main() -> None:
    project_root = get_project_root()

    if "--hooks-only" in sys.argv[1:]:
        ok = install_git_hooks(project_root)
        if not ok:
            sys.exit(1)
        return

    print(f"Installing into: {project_root}")
    hooks_ok = install_git_hooks(project_root)
    migrate_existing_skills(project_root)
    generate_umbrellas(project_root)
    if not hooks_ok:
        sys.exit(1)
    print(f"\n{GREEN}Done.{NC}")
    print("  Migration applied. For the full, foolproof path use the package CLI:")
    print("      service-knowledge install")


if __name__ == "__main__":
    main()
