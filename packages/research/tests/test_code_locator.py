"""Code-locator beam routing, the multi-step System One showcase (XTRM-512)."""

from __future__ import annotations

import json
import sqlite3

import pytest

from xtrm_research import code_locator as cl
from xtrm_research import transports
from xtrm_research.workflow import ResponseCache

TREE = [
    "README.md",
    "docs/guide.md",
    "packages/app/src/main.ts",
    "packages/app/src/util.ts",
    "packages/app/README.md",
    "packages/research/src/xtrm_research/guards.py",
    "packages/research/src/xtrm_research/transports.py",
    "packages/research/tests/test_guards.py",
]


def test_paths_are_stripped_from_the_task():
    text = "Fix `packages/research/src/guards.py` and guards.py, see docs/a/b; keep XTRM_ENV and openBoundary()."
    out = cl.strip_paths(text)
    assert "packages/" not in out and "guards.py" not in out and "docs/a/b" not in out
    assert "XTRM_ENV" in out and "openBoundary()" in out


def test_children_lists_immediate_entries_with_kinds():
    assert cl.children(TREE, "") == {
        "README.md": "file",
        "docs/": "directory",
        "packages/": "directory",
    }
    assert cl.children(TREE, "packages/app/") == {
        "README.md": "file",
        "src/": "directory",
    }


def test_lexical_rank_weights_rare_path_words():
    ranked = cl.lexical_rank("the guards redaction stage", TREE)
    assert ranked[0].endswith("guards.py")


def test_hits_and_mrr():
    ranked = ["a", "b", "c"]
    h = cl.hits(ranked, ["c", "z"])
    assert h["hit@1"] == 0.0 and h["hit@5"] == 1.0 and h["mrr"] == pytest.approx(1 / 3)
    assert h["recall@10"] == 0.5


def test_contract_text_reads_the_first_revision_and_cuts_scope(tmp_path):
    db = sqlite3.connect(tmp_path / "s.db")
    db.executescript(
        "create table projects(id, prefix); create table issues(id, project_id, human_number);"
        "create table issue_revisions(issue_id, revision, contract_json);"
        "insert into projects values ('p1','XTRM'),('p2','OTHER');"
        "insert into issues values ('i1','p1',7),('i2','p2',7);"
    )
    db.execute(
        "insert into issue_revisions values ('i1', 2, ?)",
        (json.dumps({"problem": "later"}),),
    )
    db.execute(
        "insert into issue_revisions values ('i1', 1, ?)",
        (json.dumps({"problem": "first. SCOPE: packages/x", "success": ["a", "b"]}),),
    )
    db.execute(
        "insert into issue_revisions values ('i2', 1, ?)",
        (json.dumps({"problem": "wrong project"}),),
    )
    assert cl.contract_text(db, "XTRM-7") == "first.\n\na\nb"
    assert cl.contract_text(db, "XTRM-8") is None


@pytest.fixture
def jev(monkeypatch):
    """Fake Jev: prefers entries on the path to research/src guards.py."""
    sent = []
    good = ("packages/", "research/", "src/", "xtrm_research/", "guards.py")

    def fake(payload):
        sent.append(payload)
        answers = {}
        for name, q in payload["questions"].items():
            opts = list(q["criteria"])
            weights = {o: (10.0 if o in good else 1.0) for o in opts}
            total = sum(weights.values())
            probs = {o: w / total for o, w in weights.items()}
            answers[name] = {
                "type": "choice",
                "choice": max(probs, key=probs.get),
                "probabilities": probs,
                "confidence": max(probs.values()),
            }
        return {
            "model": "jev-1.13.0",
            "request_id": f"r{len(sent)}",
            "usage": {"input_tokens": 800, "output_tokens": 20},
            "answers": answers,
        }

    monkeypatch.setattr(transports, "typesafe_system_one", fake)
    return sent


def _wf(tmp_path, width=2):
    return cl.BeamWorkflow(
        ResponseCache(tmp_path / "c.jsonl"),
        {"t1": TREE},
        {"t1": ["packages/research/src/xtrm_research/guards.py"]},
        width,
    )


def test_the_beam_walks_the_tree_one_request_per_step(jev, tmp_path):
    wf = _wf(tmp_path)
    state = {
        "item_id": "t1",
        "task": "harden the redaction stage",
        "beam": [{"path": "", "logp": 0.0, "asked": 0}],
        "depth": 0,
    }
    records = wf.run_episode("t1", state, max_steps=cl.MAX_DEPTH)
    calls = [r for r in records if r["kind"] == "system_one_call"]
    assert len(jev) == len([c for c in calls if c["data"]["request_id"]])
    assert all(
        set(p["state"]) == {"task"} for p in jev
    )  # the tree is never in the state
    assert all(
        len(p["questions"]) <= 2 for p in jev
    )  # one Choice per beam node, width 2
    first = jev[0]["questions"]["step_0"]["criteria"]
    assert first == {
        "README.md": "file",
        "docs/": "directory",
        "packages/": "directory",
    }
    outcome = records[-1]
    assert outcome["kind"] == "outcome" and outcome["data"]["hit@1"] == 1.0
    assert (
        outcome["data"]["ranked_top10"][0]
        == "packages/research/src/xtrm_research/guards.py"
    )
    decisions = [r["data"] for r in records if r["kind"] == "policy_action"]
    assert all(len(d["beam"]) <= 2 for d in decisions)


def test_a_single_entry_directory_is_decided_by_code_not_asked(jev, tmp_path):
    wf = _wf(tmp_path)
    state = {
        "item_id": "t1",
        "task": "x",
        "beam": [{"path": "docs/", "logp": 0.0, "asked": 1}],
        "depth": 1,
    }
    assert wf.questions(state) == {}
    decision = wf.policy(state, {})
    assert wf.leaves["t1"]["docs/guide.md"] == pytest.approx(
        0.0
    )  # p = 1 over two steps
    assert decision["beam"] == []


def test_over_255_entries_are_truncated_by_lexical_rank_and_counted(jev, tmp_path):
    big = [f"d/f{n}.py" for n in range(300)] + ["d/redaction_stage.py"]
    wf = cl.BeamWorkflow(ResponseCache(tmp_path / "c.jsonl"), {"t": big}, {"t": []})
    q = wf.questions(
        {
            "item_id": "t",
            "task": "redaction stage",
            "beam": [{"path": "d/", "logp": 0.0, "asked": 1}],
        }
    )
    assert (
        len(q["step_0"]["criteria"]) == cl.MAX_CHOICE
        and "redaction_stage.py" in q["step_0"]["criteria"]
    )
    assert wf.truncated["t"] == 1


def test_a_forced_single_entry_step_does_not_inflate_the_path_score(jev, tmp_path):
    tree = ["apps/.gitkeep", "packages/a.ts", "packages/b.ts", "README.md"]
    wf = cl.BeamWorkflow(ResponseCache(tmp_path / "c.jsonl"), {"t": tree}, {"t": ["packages/a.ts"]}, 3)
    root = {"item_id": "t", "task": "x", "beam": [{"path": "", "logp": 0.0, "asked": 0}], "depth": 0}
    probs = {"apps/": 0.3, "packages/": 0.6, "README.md": 0.1}
    wf.policy(root, {"step_0": {"probabilities": probs}})
    wf.policy({**root, "beam": [{"path": "apps/", "logp": __import__("math").log(0.3), "asked": 1}]}, {})
    wf.policy({**root, "beam": [{"path": "packages/", "logp": __import__("math").log(0.6), "asked": 1}]}, {"step_0": {"probabilities": {"a.ts": 0.9, "b.ts": 0.1}}})
    ranked = wf.ranking("t")
    assert ranked.index("packages/a.ts") < ranked.index("apps/.gitkeep")
    assert wf.leaves["t"]["apps/.gitkeep"] == pytest.approx(__import__("math").log(0.3))


def test_published_metrics_keep_exploratory_separate():
    from xtrm_research import publish_locator as pl

    m = {"value": 0.2, "ci95": [0.1, 0.3], "method": "boot"}
    result = {
        "n_items": 69,
        "metrics": {"jev-beam|hit@1": m, "fusion|hit@1": m, "lexical|hit@1": m, "jev-beam|cost_usd": {"value": 0.00026, "ci95": [0.00024, 0.00028], "method": "boot"}},
        "paired_deltas": {"jev-beam-minus-hot-files|hit@1": m, "fusion-minus-hot-files|hit@1": m},
    }
    out = pl._metrics(result, "jev-beam")
    assert set(out) == {"hit@1", "cost_usd", "exploratory.fusion.hit@1", "hit@1.minus_hot_files", "exploratory.fusion.hit@1.minus_hot_files"}
    assert out["exploratory.fusion.hit@1"]["method"].endswith("exploratory")
    assert set(pl._metrics(result, "lexical")) == {"hit@1"}
    assert "0.000260 [0.000240, 0.000280]" in pl._fmt(out["cost_usd"])


@pytest.mark.parametrize("verb", ["commit", "checkout", "reset", "push", "stash", "config"])
def test_git_read_refuses_every_writing_verb(verb):
    from xtrm_research.code_state import git_read

    with pytest.raises(ValueError):
        git_read(".", verb)
