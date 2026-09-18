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
            argv, cwd=cwd, capture_output=True, text=True, timeout=_CLI_TIMEOUT_S, check=False
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


def pi_complete(payload: dict[str, Any]) -> dict[str, Any]:
    """One tool-less, session-less completion through the ``pi`` CLI
    (XTRM-494 reference labelers). ``payload``: ``model`` (provider/id),
    ``system``, ``prompt``. Returns the final assistant text, the provider's
    usage and cost as pi reports them, and any provider error verbatim."""
    import json

    out = _run_cli(
        ["pi", "-p", "--no-tools", "--no-session", "--model", payload["model"],
         "--system-prompt", payload["system"], "--mode", "json", _prompt_of(payload)]
    )
    end = None
    for line in out.splitlines():
        if line.startswith('{"type":"agent_end"'):
            end = json.loads(line)
    if end is None:
        return {"text": None, "error": "no agent_end event in pi output", "usage": None}
    message = end["messages"][-1]
    usage = message.get("usage") or {}
    return {
        "text": "".join(
            block.get("text", "") for block in message.get("content", []) if block.get("type") == "text"
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
    import json

    out = _run_cli(
        ["claude", "-p", "--model", payload["model"], "--effort", payload["effort"], "--setting-sources", "",
         "--strict-mcp-config", "--tools", "", "--disable-slash-commands",
         "--system-prompt", payload["system"], "--output-format", "json",
         "--json-schema", json.dumps(payload["json_schema"]), _prompt_of(payload)]
    )
    try:
        result = json.loads(out)
    except json.JSONDecodeError:
        return {"structured_output": None, "error": "claude CLI output was not JSON"}
    model_usage = result.get("modelUsage") or {}
    pinned = model_usage.get(payload["model"]) or {}
    return {
        "structured_output": result.get("structured_output"),
        "error": result.get("result") if result.get("is_error") else None,
        "model_usage": pinned,
        "auxiliary_usage": {k: v for k, v in model_usage.items() if k != payload["model"]},
        "total_cost_usd": result.get("total_cost_usd"),
        "duration_ms": result.get("duration_ms"),
        "duration_api_ms": result.get("duration_api_ms"),
    }
