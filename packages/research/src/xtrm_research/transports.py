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
