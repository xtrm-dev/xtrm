"""Concrete remote transports (XTRM-483).

The package's only remote-send seam is ``guards.guarded_send`` /
``guards.send_through_run``. This module is the one place a provider SDK
is imported and the one place a concrete send function lives; a backend
*names* the transport it wants (``JevBackend.TRANSPORT``) and the seam
resolves the name through ``guards._resolve_transport`` before calling the
function below. Nothing in this module may be called except through those
two functions, and no module other than ``guards.py`` may import this one
(both enforced structurally by ``tests/test_guards.py`` and
``tests/test_jev.py``).

Every transport is a plain module-level function with a concrete
annotated signature and no ``Callable`` parameter, so the package-wide AST
rule holds unchanged.

``typesafe-sdk`` is an optional dependency (``xtrm-research[jev]``). It is
imported inside a function body, never at module scope: the package and
its full suite import and pass with the SDK absent, which is how CI runs.
"""

from __future__ import annotations

from typing import Any

#: Distribution name of the optional TypeSafe SDK.
_TYPESAFE_DISTRIBUTION = "typesafe-sdk"


def typesafe_system_one(payload: dict[str, Any]) -> dict[str, Any]:
    """Send one guarded System One request to TypeSafe/Jev.

    ``payload`` is the guarded request body — ``model``, ``state`` and
    ``questions`` (the neutral ``{"type", "instructions", "criteria"}``
    dicts ``TypeSafeClient.system_one`` accepts directly). Returns a
    JSON-shaped response: ``model``, ``sdk_version``, ``usage`` and one
    ``answers`` entry per question, each tagged with its own ``type``.

    The SDK resolves the API key from ``TYPESAFE_API_KEY``; this function
    never reads, logs or returns it.
    """
    from typesafe_sdk import TypeSafeClient

    with TypeSafeClient(model=payload["model"]) as client:
        response = client.system_one(
            state=payload["state"], questions=payload["questions"]
        )
    return {
        "model": response.model,
        "request_id": response.request_id,
        "sdk_version": _sdk_version(),
        "usage": {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
        },
        "answers": {
            name: _answer_fields(answer) for name, answer in response.answers.items()
        },
    }


def _sdk_version() -> str:
    """The installed ``typesafe-sdk`` version, recorded on the call event."""
    from importlib.metadata import version

    return version(_TYPESAFE_DISTRIBUTION)


def _answer_fields(answer: Any) -> dict[str, Any]:
    """Flatten one SDK answer object to a plain dict tagged by its type.

    A Noul answer carries only ``noul`` — never a ``confidence``, which
    the SDK does not expose for it either. Score legend and probability
    keys are the integer level numbers the SDK returns, stringified so the
    answer is valid JSON.
    """
    from typesafe_sdk import ChoiceAnswer, NoulAnswer, ScoreAnswer

    if isinstance(answer, NoulAnswer):
        return {"type": "noul", "noul": answer.noul}
    if isinstance(answer, ChoiceAnswer):
        return {
            "type": "choice",
            "choice": answer.choice,
            "probabilities": dict(answer.probabilities),
            "confidence": answer.confidence,
        }
    if isinstance(answer, ScoreAnswer):
        return {
            "type": "score",
            "score": answer.score,
            "legend": {str(level): label for level, label in answer.legend.items()},
            "probabilities": {
                str(level): probability
                for level, probability in answer.probabilities.items()
            },
            "confidence": answer.confidence,
        }
    raise ValueError(f"unrecognized TypeSafe answer type {type(answer).__name__!r}")


def ddgs_text(payload: dict[str, Any]) -> dict[str, Any]:
    """Run one guarded web query through DDGS text metasearch (XTRM-493).

    The same tool Specialists researcher jobs used (``ddgs text``); the
    Evidence Gate dataset replays their queries once at freeze time.
    ``payload`` is ``{"query", "max_results"}``; returns ``{"results":
    [{"title", "href", "body"}], "ddgs_version"}``.
    """
    from importlib.metadata import version

    from ddgs import DDGS
    from ddgs.exceptions import DDGSException

    try:
        results = DDGS().text(payload["query"], max_results=payload["max_results"])
    except DDGSException as exc:
        # An empty result set is an outcome, not a failure; anything else
        # still raises.
        if "No results found" not in str(exc):
            raise
        results = []
    return {"results": list(results or []), "ddgs_version": version("ddgs")}


#: Wall-clock limit for one CLI model call.
_CLI_TIMEOUT_S = 600


def _run_cli(argv: list[str]) -> str:
    """Run one model CLI in an empty temporary directory, so no project
    instruction file (AGENTS.md, CLAUDE.md) is loaded into the call."""
    import subprocess
    import tempfile

    with tempfile.TemporaryDirectory() as cwd:
        done = subprocess.run(
            argv,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=_CLI_TIMEOUT_S,
            check=False,
        )
    return done.stdout


def _prompt_of(payload: dict[str, Any]) -> str:
    """The user prompt, composed HERE — after the guard stage — from the
    payload's parsed ``input`` fields: ``prompt_template.format(**input)``
    when a template is given, else ``input`` as JSON. Composing before the
    guard would let redaction match across field boundaries and JSON
    escapes (evidence-gate XTRM-494 finding)."""
    import json

    if "prompt_template" in payload:
        return payload["prompt_template"].format(**payload["input"])
    return json.dumps(payload["input"], ensure_ascii=False)


#: Everything pi would otherwise add to a call: tools, session file,
#: extensions (they inject system-prompt text), skills, prompt templates,
#: AGENTS.md/CLAUDE.md context files, themes, project-local files. Measured
#: 2026-09-18: a ~20-token prompt cost 3478 input tokens without these and
#: 1809 with them (the rest is pi/provider scaffolding no flag removes).
PI_ISOLATION_FLAGS = (
    "--no-tools",
    "--no-session",
    "-ne",
    "-ns",
    "-np",
    "-nc",
    "--no-themes",
    "-na",
)


#: Environment variable naming the models a research batch may call,
#: comma-separated. Unset means no restriction. It is operator policy, not
#: package policy: an operator on a tight budget sets it (e.g. to
#: "commandcode/meta/muse-spark-1.3-contributor,commandcode/deepseek/deepseek-v4.1-flash,commandcode/gpt-5.6-luna");
#: the claude transport counts as the model id it is asked for.
ALLOWED_MODELS_ENV = "XTRM_RESEARCH_ALLOWED_MODELS"


#: Per-user .env the allowlist is also read from (the process environment
#: wins over it). Lives beside the research runs, never in the repository.
RESEARCH_DOTENV = "~/.xtrm/research/.env"


def _dotenv_value(key: str) -> str | None:
    """``KEY=value`` from :data:`RESEARCH_DOTENV`; ``#`` comments, blank
    lines, an optional ``export`` prefix and surrounding quotes allowed."""
    from pathlib import Path

    path = Path(RESEARCH_DOTENV).expanduser()
    if not path.is_file():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip().removeprefix("export ").strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if name.strip() == key:
            return value.strip().strip("'\"")
    return None


def _check_allowed(model: str) -> None:
    import os

    raw = os.environ.get(ALLOWED_MODELS_ENV)
    if raw is None:
        raw = _dotenv_value(ALLOWED_MODELS_ENV)
    if raw is None:
        return
    allowed = {m.strip() for m in raw.split(",") if m.strip()}
    if model not in allowed:
        raise DisallowedModelError(f"{model!r} is not in ${ALLOWED_MODELS_ENV}")


class DisallowedModelError(RuntimeError):
    """A transport was asked for a model the operator has not allowed."""


#: Why a generative (non-System-One) model may be called at all (XTRM-508).
#: A payload without one of these in ``reason`` never starts a process.
BUDGET_REASONS = frozenset(
    {"uncertainty_band", "adjudication", "generative_output", "operator_approval"}
)

#: Budget settings, read like the allowlist (process env wins over
#: :data:`RESEARCH_DOTENV`). The scope names one ledger; unset means no
#: generative call is allowed at all, so every paid batch is an explicit
#: operator act. Raising the caps above the defaults IS operator approval.
BUDGET_SCOPE_ENV = "XTRM_RESEARCH_BUDGET_SCOPE"
BUDGET_MAX_CALLS_ENV = "XTRM_RESEARCH_BUDGET_MAX_CALLS"
BUDGET_MAX_COST_ENV = "XTRM_RESEARCH_BUDGET_MAX_COST_USD"
BUDGET_DEFAULT_MAX_CALLS = 20
BUDGET_DEFAULT_MAX_COST_USD = 1.00
BUDGET_DIR = "~/.xtrm/research/budget"


class BudgetError(RuntimeError):
    """A generative call was refused by the budget policy (hard failure)."""


def _setting(key: str) -> str | None:
    import os

    value = os.environ.get(key)
    return value if value is not None else _dotenv_value(key)


def _reserve(payload: dict[str, Any]) -> tuple[str, str]:
    """Check the reason and the scope's ledger, then append a reservation,
    all under one file lock; raise :class:`BudgetError` before any process
    starts. Returns (ledger path, reservation id) for :func:`_settle`.

    ponytail: the cost cap is checked against settled calls only, so
    concurrent in-flight calls can overshoot it by at most (workers - 1)
    calls; the call cap is exact because reservations count."""
    import fcntl
    import json
    import uuid
    from pathlib import Path

    reason = payload.get("reason")
    if reason not in BUDGET_REASONS:
        raise BudgetError(f"reason {reason!r} is not one of {sorted(BUDGET_REASONS)}")
    scope = _setting(BUDGET_SCOPE_ENV)
    if (
        not scope
        or not scope.replace("-", "").replace("_", "").replace(".", "").isalnum()
    ):
        raise BudgetError(
            f"${BUDGET_SCOPE_ENV} is unset or not a plain name; no generative call is allowed"
        )
    max_calls = int(_setting(BUDGET_MAX_CALLS_ENV) or BUDGET_DEFAULT_MAX_CALLS)
    max_cost = float(_setting(BUDGET_MAX_COST_ENV) or BUDGET_DEFAULT_MAX_COST_USD)
    path = Path(BUDGET_DIR).expanduser() / f"{scope}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    rid = uuid.uuid4().hex
    with path.open("a+", encoding="utf-8") as ledger:
        fcntl.flock(ledger, fcntl.LOCK_EX)
        ledger.seek(0)
        rows = [json.loads(line) for line in ledger if line.strip()]
        calls = sum(1 for r in rows if r["kind"] == "reserve")
        costs = [r["cost_usd"] for r in rows if r["kind"] == "settle"]
        if calls >= max_calls:
            raise BudgetError(
                f"scope {scope!r}: {calls} calls reached max_calls={max_calls}"
            )
        if any(c is None for c in costs):
            raise BudgetError(
                f"scope {scope!r}: an earlier call reported no cost; budget is exhausted (fail closed)"
            )
        if sum(costs) >= max_cost:
            raise BudgetError(
                f"scope {scope!r}: spent ${sum(costs):.4f} reached max_cost_usd={max_cost}"
            )
        ledger.write(
            json.dumps(
                {
                    "kind": "reserve",
                    "id": rid,
                    "model": payload["model"],
                    "reason": reason,
                }
            )
            + "\n"
        )
    return str(path), rid


def _run_paid(argv: list[str], ledger: str, rid: str) -> str:
    """:func:`_run_cli` for a reserved call; a call that dies (timeout, OS
    error) settles as unpriced, which exhausts the scope (fail closed)."""
    try:
        return _run_cli(argv)
    except BaseException:
        _settle(ledger, rid, None)
        raise


def _settle(ledger_path: str, rid: str, cost_usd: float | None) -> None:
    import fcntl
    import json

    with open(ledger_path, "a", encoding="utf-8") as ledger:
        fcntl.flock(ledger, fcntl.LOCK_EX)
        ledger.write(
            json.dumps({"kind": "settle", "id": rid, "cost_usd": cost_usd}) + "\n"
        )


def pi_complete(payload: dict[str, Any]) -> dict[str, Any]:
    """One tool-less, session-less completion through the ``pi`` CLI
    (XTRM-494 reference labelers). ``payload``: ``model`` (provider/id),
    ``system``, ``prompt``. Returns the final assistant text, the provider's
    usage and cost as pi reports them, and any provider error verbatim."""
    import json

    _check_allowed(payload["model"])
    ledger, rid = _reserve(payload)
    out = _run_paid(
        [
            "pi",
            "-p",
            *PI_ISOLATION_FLAGS,
            "--model",
            payload["model"],
            "--system-prompt",
            payload["system"],
            "--mode",
            "json",
            _prompt_of(payload),
        ],
        ledger,
        rid,
    )
    end = None
    for line in out.splitlines():
        if line.startswith('{"type":"agent_end"'):
            end = json.loads(line)
    if end is None:
        _settle(ledger, rid, None)
        return {"text": None, "error": "no agent_end event in pi output", "usage": None}
    message = end["messages"][-1]
    usage = message.get("usage") or {}
    _settle(ledger, rid, (usage.get("cost") or {}).get("total"))
    return {
        "text": "".join(
            block.get("text", "")
            for block in message.get("content", [])
            if block.get("type") == "text"
        ),
        "provider": message.get("provider"),
        "model": message.get("model"),
        "stop_reason": message.get("stopReason"),
        "error": message.get("errorMessage"),
        "usage": {
            "input_tokens": usage.get("input"),
            "output_tokens": usage.get("output"),
            "cached_input_tokens": usage.get("cacheRead"),
            "cost_usd": (usage.get("cost") or {}).get("total"),
        },
    }


def claude_classify(payload: dict[str, Any]) -> dict[str, Any]:
    """One structured classification through the ``claude`` CLI (XTRM-497,
    the frontier arm). ``payload``: ``model``, ``effort``, ``system``,
    ``prompt_template``, ``input``, ``json_schema``. Tools, settings sources, MCP servers and slash commands
    are all disabled. Returns the schema-validated ``structured_output``,
    the pinned model's own usage entry (the CLI also bills an internal
    auxiliary model, reported separately), the CLI's list-basis cost and
    its timings."""
    _check_allowed(payload["model"])
    import json

    ledger, rid = _reserve(payload)
    out = _run_paid(
        [
            "claude",
            "-p",
            "--model",
            payload["model"],
            "--effort",
            payload["effort"],
            "--setting-sources",
            "",
            "--strict-mcp-config",
            "--tools",
            "",
            "--disable-slash-commands",
            "--system-prompt",
            payload["system"],
            "--output-format",
            "json",
            "--json-schema",
            json.dumps(payload["json_schema"]),
            _prompt_of(payload),
        ],
        ledger,
        rid,
    )
    try:
        result = json.loads(out)
    except json.JSONDecodeError:
        _settle(ledger, rid, None)
        return {"structured_output": None, "error": "claude CLI output was not JSON"}
    _settle(ledger, rid, result.get("total_cost_usd"))
    model_usage = result.get("modelUsage") or {}
    pinned = model_usage.get(payload["model"]) or {}
    return {
        "structured_output": result.get("structured_output"),
        "error": result.get("result") if result.get("is_error") else None,
        "model_usage": pinned,
        "auxiliary_usage": {
            k: v for k, v in model_usage.items() if k != payload["model"]
        },
        "total_cost_usd": result.get("total_cost_usd"),
        "duration_ms": result.get("duration_ms"),
        "duration_api_ms": result.get("duration_api_ms"),
    }
