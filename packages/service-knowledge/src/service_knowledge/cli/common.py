"""Shared engine for the service-knowledge CLI subcommands.

Stdlib-only. The CLI must NOT depend on xtrm/bd/sp/xt/xtmux being installed; the only
cross-package dependency is vaultctl (declared in pyproject, wired in PR3). Everything
here is idempotent: re-running any operation on an already-current consumer produces no
diff (validated by ``service-knowledge install`` running twice with an empty diff).
"""
from __future__ import annotations

import filecmp
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

from service_knowledge import __version__

# --- consumer-side layout constants -------------------------------------------
SKILLS_ROOT = Path(".xtrm") / "skills"
MACHINERY_REL = SKILLS_ROOT / "default" / "service-knowledge"
CACHE_REL = Path(".xtrm") / "cache" / "service-knowledge.sqlite"
VERSION_REL = MACHINERY_REL / "VERSION"
RESERVED_PACK_NAMES = {"default", "optional", "user", "active", "local-legacy"}

LEGACY_UMBRELLA = "service-skills"
NEW_UMBRELLA = "service-knowledge"

# Subdirs of the package that get vendored into a consumer's machinery dir.
VENDOR_SUBDIRS = ("scripts", "contracts", "skills", "install")

GREEN = "\033[0;32m"
YELLOW = "\033[1;33m"
NC = "\033[0m"


def package_root() -> Path:
    """Absolute path to the installed ``service_knowledge`` package data directory."""
    return Path(__file__).resolve().parent.parent


# --- consumer root resolution -------------------------------------------------
def resolve_consumer_root(path: str | None) -> Path:
    """Resolve the consumer repo root: explicit --path wins, else git toplevel of cwd."""
    if path:
        root = Path(path).expanduser().resolve()
        if not root.is_dir():
            raise NotADirectoryError(f"--path is not a directory: {root}")
        return root
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True, timeout=5,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
        raise RuntimeError("not inside a git repository; pass --path <consumer-root>") from e
    return Path(r.stdout.strip()).resolve()


def repo_name(root: Path) -> str:
    return root.name


# --- byte-preserving copy helper ---------------------------------------------
def _copy_if_changed(src: Path, dst: Path) -> bool:
    """Copy src->dst only when content differs. Returns True if dst was (re)written."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and filecmp.cmp(src, dst, shallow=False):
        return False
    shutil.copy2(src, dst)
    return True


def machinery_dir(root: Path) -> Path:
    return root / MACHINERY_REL


def read_installed_version(root: Path) -> str | None:
    vf = root / VERSION_REL
    try:
        return vf.read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


# --- vendoring ----------------------------------------------------------------
def vendor_machinery(root: Path) -> list[str]:
    """Copy the package's scripts/contracts/skills/install into the consumer's machinery
    dir and stamp a VERSION marker. Returns consumer-relative paths actually written."""
    pkg = package_root()
    dest = machinery_dir(root)
    touched: list[str] = []
    for sub in VENDOR_SUBDIRS:
        src_dir = pkg / sub
        if not src_dir.is_dir():
            continue
        for src in sorted(p for p in src_dir.rglob("*") if p.is_file()):
            if "__pycache__" in src.parts:
                continue
            rel = src.relative_to(src_dir)
            dst = dest / sub / rel
            if _copy_if_changed(src, dst):
                touched.append(str((MACHINERY_REL / sub / rel).as_posix()))
    # VERSION marker (idempotent)
    vf = root / VERSION_REL
    if not vf.exists() or vf.read_text(encoding="utf-8").strip() != __version__:
        vf.parent.mkdir(parents=True, exist_ok=True)
        vf.write_text(__version__ + "\n", encoding="utf-8")
        touched.append(VERSION_REL.as_posix())
    return touched


# --- settings.json hook wiring ------------------------------------------------
def _hook_command(script: str, extra_arg: str = "") -> str:
    """Defensive project-local hook command (no-op if the machinery file is absent)."""
    p = f"$CLAUDE_PROJECT_DIR/{MACHINERY_REL.as_posix()}/scripts/{script}"
    run = f'python3 "$p"' + (f" {extra_arg}" if extra_arg else "")
    return f'sh -c \'p="{p}"; [ -f "$p" ] || exit 0; exec {run}\''


def _is_machinery_hook(entry: dict, script: str) -> bool:
    for h in entry.get("hooks", []):
        if script in h.get("command", ""):
            return True
    return False


_DESIRED_HOOKS = {
    "SessionStart": {"script": "cataloger.py", "extra": "", "matcher": None, "timeout": None},
    "PreToolUse": {
        "script": "skill_activator.py",
        "extra": "",
        "matcher": "Read|Write|Edit|Glob|Grep|Bash|mcp__serena__rename_symbol|mcp__serena__replace_symbol_body|mcp__serena__insert_after_symbol|mcp__serena__insert_before_symbol",
        "timeout": None,
    },
    "PostToolUse": {
        "script": "drift_detector.py",
        "extra": "check-hook",
        "matcher": "Write|Edit|mcp__serena__rename_symbol|mcp__serena__replace_symbol_body|mcp__serena__insert_after_symbol|mcp__serena__insert_before_symbol",
        "timeout": 10,
    },
}


def _build_hook_entry(spec: dict) -> dict:
    hook: dict = {"type": "command", "command": _hook_command(spec["script"], spec["extra"])}
    if spec["timeout"] is not None:
        hook["timeout"] = spec["timeout"]
    entry: dict = {"hooks": [hook]}
    if spec["matcher"]:
        entry["matcher"] = spec["matcher"]
    return entry


def wire_hooks(root: Path) -> list[str]:
    """Ensure .claude/settings.json has canonical service-knowledge hooks for the three
    events, replacing any stale service-skills machinery hook in place. Idempotent."""
    settings_path = root / ".claude" / "settings.json"
    try:
        settings = json.loads(settings_path.read_text(encoding="utf-8")) if settings_path.exists() else {}
    except json.JSONDecodeError:
        settings = {}

    hooks = settings.setdefault("hooks", {})
    changed = False
    for event, spec in _DESIRED_HOOKS.items():
        desired = _build_hook_entry(spec)
        entries = hooks.get(event, [])
        replaced = False
        for i, entry in enumerate(entries):
            if _is_machinery_hook(entry, spec["script"]):
                if entry != desired:
                    entries[i] = desired
                    changed = True
                replaced = True
                break
        if not replaced:
            entries.append(desired)
            changed = True
        hooks[event] = entries

    if not changed:
        return []
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
    return [".claude/settings.json"]


# --- umbrella migration (service-skills -> service-knowledge) -----------------
def _candidate_pack_roots(root: Path) -> list[Path]:
    skills_root = root / SKILLS_ROOT
    return [skills_root, skills_root / "user" / "packs"]


def find_umbrella_packs(root: Path) -> list[tuple[Path, Path]]:
    """Return (pack_dir, umbrella_dir) for each pack carrying a service-skills OR
    service-knowledge umbrella with a registry. New name wins over legacy."""
    out: list[tuple[Path, Path]] = []
    seen: set[Path] = set()
    for packs_root in _candidate_pack_roots(root):
        if not packs_root.exists():
            continue
        for pack in sorted(p for p in packs_root.iterdir() if p.is_dir() and p.name not in RESERVED_PACK_NAMES):
            resolved = pack.resolve()
            if resolved in seen:
                continue
            for name in (NEW_UMBRELLA, LEGACY_UMBRELLA):
                umb = pack / name
                if (umb / "service-registry.json").exists():
                    seen.add(resolved)
                    out.append((pack, umb))
                    break
    return out


def _git_mv_or_rename(src: Path, dst: Path, root: Path) -> None:
    """Prefer ``git mv`` (preserves history inside the consumer repo); fall back to rename."""
    try:
        subprocess.run(
            ["git", "mv", str(src), str(dst)],
            cwd=root, capture_output=True, text=True, check=True, timeout=30,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        shutil.move(str(src), str(dst))


def rewrite_registry_paths(registry_path: Path) -> bool:
    """Rewrite legacy ``service-skills`` path segments to ``service-knowledge`` in every
    string value (skill_path et al). Idempotent. Returns True if the file changed."""
    try:
        raw = registry_path.read_text(encoding="utf-8")
    except OSError:
        return False
    if LEGACY_UMBRELLA not in raw:
        return False
    data = json.loads(raw)

    def _walk(node):
        if isinstance(node, dict):
            return {k: _walk(v) for k, v in node.items()}
        if isinstance(node, list):
            return [_walk(v) for v in node]
        if isinstance(node, str):
            return node.replace(f"/{LEGACY_UMBRELLA}/", f"/{NEW_UMBRELLA}/")
        return node

    new_data = _walk(data)
    new_raw = json.dumps(new_data, indent=2) + "\n"
    if new_raw == raw:
        return False
    registry_path.write_text(new_raw, encoding="utf-8")
    return True


def _run_vendored_script(root: Path, pack_name: str, script: str, args: list[str]) -> subprocess.CompletedProcess:
    script_path = machinery_dir(root) / "scripts" / script
    env = {**os.environ, "XTRM_PACK": pack_name, "CLAUDE_PROJECT_DIR": str(root)}
    return subprocess.run(
        ["python3", str(script_path), *args],
        cwd=root, env=env, capture_output=True, text=True, check=False,
    )


def migrate_umbrellas(root: Path) -> list[str]:
    """One-time hard break: rename each pack's ``service-skills`` umbrella to
    ``service-knowledge``, rewrite registry path refs, regenerate the umbrella with the
    new ``<repo>-service-knowledge`` name. Idempotent. Returns touched relative paths."""
    touched: list[str] = []
    name = repo_name(root)
    for pack, umb in find_umbrella_packs(root):
        if umb.name == LEGACY_UMBRELLA:
            new_umb = pack / NEW_UMBRELLA
            _git_mv_or_rename(umb, new_umb, root)
            touched.append((new_umb).relative_to(root).as_posix() + "/")
            umb = new_umb
        registry = umb / "service-registry.json"
        if rewrite_registry_paths(registry):
            touched.append(registry.relative_to(root).as_posix())
        # Regenerate the umbrella with the new name using the freshly-vendored machinery.
        r = _run_vendored_script(root, pack.name, "umbrella_generator.py", [name])
        if r.returncode == 0 and r.stdout.strip().startswith("generated:"):
            touched.append((umb / "SKILL.md").relative_to(root).as_posix())
    return touched


# --- git hooks + cache --------------------------------------------------------
def install_git_hooks(root: Path) -> list[str]:
    """Delegate to the vendored install-service-knowledge.py --hooks-only (non-blocking
    pre-commit/pre-push/post-merge reminders). Reports ``.githooks`` touched only when a
    hook file actually changed, so idempotent re-runs report zero touches."""
    installer = machinery_dir(root) / "install" / "install-service-knowledge.py"
    if not installer.exists():
        return []
    hook_files = [root / ".githooks" / n for n in ("pre-commit", "pre-push", "post-merge")]
    before = {h: h.read_bytes() for h in hook_files if h.exists()}
    r = subprocess.run(
        ["python3", str(installer), "--hooks-only"],
        cwd=root, capture_output=True, text=True, check=False,
    )
    if r.returncode != 0:
        return []
    after = {h: h.read_bytes() for h in hook_files if h.exists()}
    return [".githooks"] if before != after else []


def ensure_cache(root: Path) -> list[str]:
    """Create the empty FTS5 cache file (PR3 populates the schema). Idempotent."""
    cache = root / CACHE_REL
    if cache.exists():
        return []
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(b"")
    return [CACHE_REL.as_posix()]


def remove_machinery(root: Path) -> list[str]:
    """Remove the vendored machinery dir + cache. Returns touched relative paths."""
    touched: list[str] = []
    mdir = machinery_dir(root)
    if mdir.exists():
        shutil.rmtree(mdir)
        touched.append(MACHINERY_REL.as_posix() + "/")
    cache = root / CACHE_REL
    if cache.exists():
        cache.unlink()
        touched.append(CACHE_REL.as_posix())
    return touched


def ensure_runtime_gitignored(root: Path) -> list[str]:
    """Keep per-invocation telemetry + cache out of git so re-running install produces no
    tracked diff. Adds ``.xtrm/state/service-knowledge/`` to the root .gitignore when not
    already ignored (``.xtrm/cache/`` is usually ignored already). Idempotent."""
    pattern = ".xtrm/state/service-knowledge/"
    probe = root / ".xtrm" / "state" / "service-knowledge" / "install.jsonl"
    try:
        ignored = subprocess.run(
            ["git", "check-ignore", "-q", str(probe)],
            cwd=root, capture_output=True, timeout=5,
        ).returncode == 0
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        ignored = False
    if ignored:
        return []
    gi = root / ".gitignore"
    nl = chr(10)
    existing = gi.read_text(encoding="utf-8") if gi.exists() else ""
    if pattern in existing or any(line.strip() == pattern.strip("/") for line in existing.splitlines()):
        return []
    suffix = "" if (existing == "" or existing.endswith(nl)) else nl
    gi.write_text(existing + suffix + pattern + nl, encoding="utf-8")
    return [".gitignore"]


# --- orchestration ------------------------------------------------------------
def apply(root: Path, event: str) -> tuple[str | None, list[str], float]:
    """Full idempotent apply: vendor machinery, migrate umbrellas, wire hooks, install
    git hooks, ensure cache, emit telemetry. Shared by ``install`` and ``update``."""
    from service_knowledge.cli import telemetry

    t0 = time.monotonic()
    from_version = read_installed_version(root)
    touched: list[str] = []
    touched += vendor_machinery(root)
    touched += migrate_umbrellas(root)
    touched += wire_hooks(root)
    touched += install_git_hooks(root)
    touched += ensure_cache(root)
    touched += ensure_runtime_gitignored(root)
    duration_ms = (time.monotonic() - t0) * 1000.0
    deduped = sorted(set(touched))
    telemetry.emit(
        root, event,
        from_version=from_version, to_version=__version__,
        files_touched=deduped, duration_ms=duration_ms,
    )
    return from_version, deduped, duration_ms


def unwire_hooks(root: Path) -> list[str]:
    """Strip service-knowledge/service-skills machinery hooks from .claude/settings.json.
    Idempotent. Returns ['.claude/settings.json'] when the file changed."""
    settings_path = root / ".claude" / "settings.json"
    if not settings_path.exists():
        return []
    try:
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    hooks = settings.get("hooks", {})
    changed = False
    scripts = ("cataloger.py", "skill_activator.py", "drift_detector.py")
    for event in list(hooks.keys()):
        kept = [e for e in hooks[event] if not any(_is_machinery_hook(e, sc) for sc in scripts)]
        if len(kept) != len(hooks[event]):
            changed = True
        if kept:
            hooks[event] = kept
        else:
            del hooks[event]
    if not changed:
        return []
    settings_path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
    return [".claude/settings.json"]

