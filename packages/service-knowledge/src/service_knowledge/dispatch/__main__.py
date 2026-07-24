"""Dispatch CLI — the smallest surface for the promotion gate + bundle attachment.

Usage::

    # Promotion gate (contract:draft -> contract:ready). Reads `bd show` text on stdin.
    bd show <id> | python3 -m service_knowledge.dispatch validate
    # exits 1 on refusal, 0 on allow/advisory; prints the decision JSON.

    # Attach an evidence bundle marker block to a bead body file.
    python3 -m service_knowledge.dispatch attach --body bead.md --paths api-gateway/src/main.py

No bd schema change: the gate is a regex over `bd show` output and the bundle lives in a marker
block in the bead body.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from service_knowledge import index
from service_knowledge.dispatch.evidence import attach_marker
from service_knowledge.dispatch.promotion import validate_promotion


def _load_services(consumer_root: Path) -> dict:
    try:
        import bootstrap  # type: ignore[import-not-found]

        from service_knowledge.index import (
            _compat,  # noqa: F401  (puts scripts/ on sys.path)
        )

        return bootstrap.load_registry(str(consumer_root)).get("services", {})
    except (ImportError, OSError, RuntimeError, ValueError, TypeError, KeyError):
        return {}


def _cmd_validate(args: argparse.Namespace) -> int:
    body = sys.stdin.read() if args.body == "-" else Path(args.body).read_text(encoding="utf-8")
    services = _load_services(Path(args.root))
    decision = validate_promotion(
        body, services, consumer_root=Path(args.root), env=dict(os.environ)
    )
    print(json.dumps(
        {
            "allowed": decision.allowed,
            "decision": decision.decision,
            "reason": decision.reason,
            "touched_services": list(decision.touched_services),
            "matched_services": list(decision.matched_services),
            "evidence_bundle_id": decision.evidence_bundle_id,
        },
        indent=2,
    ))
    return 0 if decision.allowed else 1


def _cmd_attach(args: argparse.Namespace) -> int:
    root = Path(args.root)
    bundle = index.evidence_for_files(root, list(args.paths), limit=args.limit)
    body = Path(args.body).read_text(encoding="utf-8") if args.body != "-" else sys.stdin.read()
    updated = attach_marker(body, bundle)
    if args.body == "-":
        sys.stdout.write(updated)
    else:
        Path(args.body).write_text(updated, encoding="utf-8")
    from service_knowledge.dispatch.evidence import bundle_identity

    bundle_id, _ = bundle_identity(bundle)
    print(f"attached evidence bundle {bundle_id}", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="service_knowledge.dispatch", description=__doc__)
    parser.add_argument("--root", default=".", help="consumer repo root (registry + index)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_validate = sub.add_parser("validate", help="run the contract-promotion gate")
    p_validate.add_argument("--body", default="-", help="bead body file, or '-' for stdin")
    p_validate.set_defaults(func=_cmd_validate)

    p_attach = sub.add_parser("attach", help="attach an evidence bundle marker to a bead body")
    p_attach.add_argument("--body", default="-", help="bead body file, or '-' for stdin")
    p_attach.add_argument("--paths", nargs="+", required=True, help="file paths to build evidence for")
    p_attach.add_argument("--limit", type=int, default=7)
    p_attach.set_defaults(func=_cmd_attach)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
