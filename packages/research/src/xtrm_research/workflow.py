"""System One workflow runner (XTRM-509).

The pattern under test is not "one state, one question, one score". It is
a control loop:

    state -> ONE System One request carrying a battery of atomic questions
          -> policy code composes the answers into an action
          -> escalation only when the policy says so (budget-gated)
          -> next state -> ... until the episode ends

A :class:`Workflow` subclass supplies the seams (``questions``,
``policy``, ``escalate``, ``next_state``, ``outcome``); the runner owns the
loop, the remote send and the records. Every remote send goes through
``guards.guarded_send``. Every step yields separate events — the answer
(``system_one_call``), the decision (``policy_action``), the escalation
(``escalation``) and, once per episode, the realized ``outcome`` — never
one collapsed record (XTRM-99 §4).

Jev responses are kept in a :class:`ResponseCache` keyed by the request
body, so a re-run or a re-publish replays instead of paying twice; a
cached answer says so (``cached: true``) and keeps its original
``request_id`` and latency.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

from xtrm_research.guards import GuardFailure, guarded_send
from xtrm_research.hashing import compute_content_hash
from xtrm_research.telemetry import usage_record

PRICES_PATH = Path(__file__).parent / "evidence_gate" / "prices.json"


def _key(body: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


class ResponseCache:
    """Append-only JSONL of ``{"key", "response", "latency_ms"}``; the first
    entry for a key wins. Lives beside the run inputs, never in git."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._entries: dict[str, dict[str, Any]] = {}
        if self.path.is_file():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    row = json.loads(line)
                    self._entries.setdefault(row["key"], row)

    def get(self, body: dict[str, Any]) -> dict[str, Any] | None:
        return self._entries.get(_key(body))

    def put(
        self, body: dict[str, Any], response: dict[str, Any], latency_ms: float
    ) -> None:
        row = {"key": _key(body), "response": response, "latency_ms": latency_ms}
        self._entries.setdefault(row["key"], row)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def jev_cost(
    input_tokens: int | None, output_tokens: int | None, model_version: str
) -> dict[str, Any]:
    """Cost from the versioned price table; ``value`` null when the model or
    a token count is missing."""
    prices = json.loads(PRICES_PATH.read_text(encoding="utf-8"))
    entry = prices["entries"].get(model_version)
    if entry is None or input_tokens is None or output_tokens is None:
        return {
            "value": None,
            "currency": "USD",
            "price_table_version": prices["version"],
        }
    value = (
        input_tokens * entry["input_per_mtok"]
        + output_tokens * entry["output_per_mtok"]
    ) / 1e6
    return {
        "value": value,
        "currency": entry["currency"],
        "price_table_version": prices["version"],
    }


class Workflow:
    """One System One control loop. Subclasses override the seams below;
    the defaults describe a single-step episode with no escalation."""

    #: TypeSafe model alias requested; the resolved version is recorded.
    model: str = "jev-latest"

    def __init__(self, cache: ResponseCache) -> None:
        self.cache = cache

    # -- seams ------------------------------------------------------------
    def questions(self, state: dict[str, Any]) -> dict[str, dict[str, Any]]:
        """The atomic question battery for this state (name -> System One
        question body)."""
        raise NotImplementedError

    def state_view(self, state: dict[str, Any]) -> dict[str, Any]:
        """The fields of ``state`` sent to System One (default: all)."""
        return state

    def policy(self, state: dict[str, Any], answers: dict[str, Any]) -> dict[str, Any]:
        """Compose answers into ``{"action": str, "escalate": reason | None,
        ...}``; pure code, no remote call."""
        raise NotImplementedError

    def escalate(
        self, state: dict[str, Any], answers: dict[str, Any], decision: dict[str, Any]
    ) -> dict[str, Any]:
        """Resolve an escalated step (``{"action", "usage", ...}``). The
        default refuses: a workflow that escalates must say how."""
        raise NotImplementedError(
            f"{type(self).__name__} escalated but defines no escalate()"
        )

    def next_state(
        self,
        state: dict[str, Any],
        decision: dict[str, Any],
        escalation: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """The next state, or None when the episode ends (default: one step)."""
        return None

    def outcome(
        self, episode_id: str, trace: list[dict[str, Any]]
    ) -> dict[str, Any] | None:
        """The realized outcome of the episode, from a source other than the
        answers (a label, git, a later event); None when not resolvable."""
        return None

    # -- runner -----------------------------------------------------------
    def ask(
        self, state: dict[str, Any], questions: dict[str, dict[str, Any]]
    ) -> dict[str, Any]:
        """One System One request for the whole battery, through the guard
        seam, replayed from the cache when the same body was asked before."""
        body = {
            "model": self.model,
            "state": self.state_view(state),
            "questions": questions,
        }
        hit = self.cache.get(body)
        if hit is not None:
            return {**hit["response"], "latency_ms": hit["latency_ms"], "cached": True}
        started = time.perf_counter()
        response = guarded_send(body, "typesafe_system_one")
        latency_ms = (time.perf_counter() - started) * 1000.0
        self.cache.put(body, response, latency_ms)
        return {**response, "latency_ms": latency_ms, "cached": False}

    def run_episode(
        self, episode_id: str, state: dict[str, Any], max_steps: int = 32
    ) -> list[dict[str, Any]]:
        """Run one episode; returns its records as ``{"kind", "sample_id",
        "data", "usage"?}`` in order. A guard refusal ends the episode with a
        ``guard_failure`` record instead of an answer."""
        records: list[dict[str, Any]] = []
        step = 0
        current: dict[str, Any] | None = state
        while current is not None and step < max_steps:
            questions = self.questions(current)
            try:
                call = self.ask(current, questions)
            except GuardFailure as exc:
                records.append(
                    _record(
                        "guard_failure", episode_id, {"step": step, "guard": exc.guard}
                    )
                )
                break
            tokens = call.get("usage") or {}
            records.append(
                _record(
                    "system_one_call",
                    episode_id,
                    {
                        "step": step,
                        "request_id": call.get("request_id"),
                        "model": self.model,
                        "model_version": call.get("model"),
                        "state_hash": compute_content_hash(
                            {"state": self.state_view(current)}
                        ),
                        "question_spec_hashes": {
                            name: compute_content_hash({"question": body})
                            for name, body in sorted(questions.items())
                        },
                        "answers": call["answers"],
                        "cached": call["cached"],
                        "cost": jev_cost(
                            tokens.get("input_tokens"),
                            tokens.get("output_tokens"),
                            call.get("model") or "",
                        ),
                    },
                    usage_record(
                        "provider_api",
                        input_tokens=tokens.get("input_tokens"),
                        output_tokens=tokens.get("output_tokens"),
                        request_model=self.model,
                        response_model=call.get("model"),
                        latency_ms=call["latency_ms"],
                        null_reason="not_exposed_by_provider",
                        null_detail="TypeSafe returns no cost; data.cost is priced from the versioned price table",
                    ),
                )
            )
            decision = self.policy(current, call["answers"])
            records.append(
                _record(
                    "policy_action",
                    episode_id,
                    {"step": step, "request_id": call.get("request_id"), **decision},
                )
            )
            escalation = None
            if decision.get("escalate"):
                escalation = self.escalate(current, call["answers"], decision)
                usage = escalation.pop("usage", None)
                records.append(
                    _record(
                        "escalation",
                        episode_id,
                        {
                            "step": step,
                            "request_id": call.get("request_id"),
                            "reason": decision["escalate"],
                            **escalation,
                        },
                        usage,
                    )
                )
            current = self.next_state(current, decision, escalation)
            step += 1
        if current is not None and step >= max_steps:
            records.append(
                _record(
                    "truncated", episode_id, {"steps": step, "max_steps": max_steps}
                )
            )
        outcome = self.outcome(episode_id, records)
        if outcome is not None:
            records.append(_record("outcome", episode_id, outcome))
        return records


def _record(
    kind: str, sample_id: str, data: dict[str, Any], usage: dict[str, Any] | None = None
) -> dict[str, Any]:
    record: dict[str, Any] = {"kind": kind, "sample_id": sample_id, "data": data}
    if usage is not None:
        record["usage"] = usage
    return record
