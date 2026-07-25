"""``service-knowledge canary`` — status / enable / disable subcommand tree.

Nested actions:
    service-knowledge canary status
    service-knowledge canary enable [--classes ...] [--yes]
    service-knowledge canary disable
"""

from __future__ import annotations

import argparse
import getpass
import json
import sys

from service_knowledge.canary import disable as disable_mod
from service_knowledge.canary import enable as enable_mod
from service_knowledge.canary import state as state_mod
from service_knowledge.canary import status as status_mod
from service_knowledge.cli.common import resolve_consumer_root


def _print_json(payload: object) -> None:
    print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))


def _cmd_status(args: argparse.Namespace) -> int:
    root = resolve_consumer_root(args.path)
    _print_json(status_mod.snapshot(root))
    return 0


def _cmd_enable(args: argparse.Namespace) -> int:
    root = resolve_consumer_root(args.path)
    classes = [c.strip() for c in (args.classes or "").split(",") if c.strip()]
    if not classes:
        classes = sorted(state_mod.ALLOWED_CLASSES)
    try:
        st = enable_mod.enable(
            root,
            classes,
            enabled_by=args.enabled_by or getpass.getuser() or "unknown",
            assume_yes=args.yes,
        )
    except enable_mod.CanaryEnableError as e:
        print(f"refused: {e}", file=sys.stderr)
        return 3
    _print_json({"result": "enabled", "state": st.to_dict()})
    return 0


def _cmd_disable(args: argparse.Namespace) -> int:
    root = resolve_consumer_root(args.path)
    st = disable_mod.disable(
        root, disabled_by=args.disabled_by or getpass.getuser() or "unknown"
    )
    _print_json({"result": "disabled", "state": st.to_dict()})
    return 0


_DISPATCH = {
    "status": _cmd_status,
    "enable": _cmd_enable,
    "disable": _cmd_disable,
}


def register(subparsers: argparse._SubParsersAction) -> None:
    from service_knowledge.cli._help import EPILOGS_CANARY

    parser = subparsers.add_parser(
        "canary",
        help="Manage the per-repo auto-merge canary policy (status | enable | disable).",
        description="Manage the per-repo auto-merge canary policy.",
        epilog=EPILOGS_CANARY["root"],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--path",
        default=None,
        help="Consumer repo root (default: git toplevel of cwd).",
    )
    nested = parser.add_subparsers(dest="canary_command", metavar="<action>")

    s = nested.add_parser(
        "status",
        help="Show current canary state + metrics + threshold checks.",
        description="Show current canary state + metrics + threshold checks.",
        epilog=EPILOGS_CANARY["status"],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    s.add_argument(
        "--path",
        default=argparse.SUPPRESS,
        help="Consumer repo root (default: git toplevel of cwd).",
    )

    e = nested.add_parser(
        "enable",
        help="Enable canary auto-merge for the listed low-risk claim classes.",
        description="Enable canary auto-merge for the listed low-risk claim classes.",
        epilog=EPILOGS_CANARY["enable"],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    e.add_argument(
        "--path",
        default=argparse.SUPPRESS,
        help="Consumer repo root (default: git toplevel of cwd).",
    )
    e.add_argument(
        "--classes",
        default=None,
        help=f"Comma-separated class list. Default: all allowed ({sorted(state_mod.ALLOWED_CLASSES)}).",
    )
    e.add_argument(
        "--yes",
        action="store_true",
        help="Skip the interactive confirmation (thresholds still enforced).",
    )
    e.add_argument(
        "--enabled-by", default=None, help="Operator id (default: getpass.getuser())."
    )

    d = nested.add_parser(
        "disable",
        help="Disable canary auto-merge. No threshold check.",
        description="Disable canary auto-merge. No threshold check.",
        epilog=EPILOGS_CANARY["disable"],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    d.add_argument(
        "--path",
        default=argparse.SUPPRESS,
        help="Consumer repo root (default: git toplevel of cwd).",
    )
    d.add_argument(
        "--disabled-by", default=None, help="Operator id (default: getpass.getuser())."
    )

    parser.set_defaults(canary_command=None)


def run(args: argparse.Namespace) -> int:
    command = getattr(args, "canary_command", None)
    if not command:
        print(
            "error: canary requires an action: status | enable | disable",
            file=sys.stderr,
        )
        return 2
    return _DISPATCH[command](args)
