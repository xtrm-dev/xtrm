"""Multi-step System One showcase: code-locator beam routing (XTRM-512).

Question: given a task as it was written BEFORE the work (the first
revision of a Substrate issue contract), can a System One control loop
walk a repository tree and find the files the change actually modified?

    task + repository root
      -> ONE Jev request: one Choice per beam node ("which entry of this
         directory holds the files that change?")
      -> code keeps the best ``width`` directories by path probability
         (geometric mean of the step probabilities), files become leaves
      -> next state = the new beam ... until no directory is left
      -> ranked leaves; outcome = the files git says the change modified

Ground truth is deterministic (git), no LLM label anywhere. Baselines are
deterministic and free: ``lexical`` (idf-weighted overlap of task words
and path words) and ``hot-files`` (files most often modified before the
change's base commit).

    python -m xtrm_research.code_locator build    --out DATASET_DIR
    python -m xtrm_research.code_locator run      --dataset DATASET_DIR --cache CACHE
    python -m xtrm_research.code_locator evaluate --dataset DATASET_DIR --cache CACHE --out RESULT
    python -m xtrm_research.code_locator publish  --dataset DATASET_DIR --cache CACHE --result RESULT
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sqlite3
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from xtrm_research.code_state import git_read
from xtrm_research.evidence_gate import stats
from xtrm_research.workflow import ResponseCache, Workflow

#: Repositories and the project prefixes their commit subjects cite.
REPOS: dict[str, dict[str, str]] = {
    "xtrm": {"path": "~/dev/xtrm", "branch": "main", "prefix": "XTRM"},
    "specialists": {
        "path": "~/dev/specialists",
        "branch": "master",
        "prefix": "SPECIALISTS",
    },
}
STATE_DB = "~/.xtrm/state.db"

#: Bookkeeping files a change touches regardless of its subject; they are
#: not "where the work is" and are dropped from the truth set.
BOOKKEEPING = re.compile(
    r"(^|/)(CHANGELOG[^/]*|[^/]*\.lock|package-lock\.json|bun\.lockb?)$|^\.(beads|xtrm)/"
)

#: Path-like tokens are removed from the task text, so a contract that
#: names its files cannot be matched trivially by either arm.
PATH_TOKEN = re.compile(
    r"`?[\w.@~-]*(?:/[\w.@~-]+)+/?`?|`?\b[\w-]+\.(?:py|ts|tsx|js|mjs|cjs|md|json|jsonl|toml|ya?ml|rs|go|sh|sql|css|html)\b`?"
)
WIDTH = 3
MAX_DEPTH = 10
MAX_CHOICE = 255
TOP_K = (1, 5, 10)
SEED = 20260918


# --- dataset -----------------------------------------------------------------


def strip_paths(text: str) -> str:
    return PATH_TOKEN.sub("[path]", text)


def contract_text(db: sqlite3.Connection, ref: str) -> str | None:
    """PROBLEM and SUCCESS of the issue's FIRST revision, the task as
    written before the work; an inline "SCOPE:" tail is cut."""
    prefix, number = ref.rsplit("-", 1)
    row = db.execute(
        "select r.contract_json from issues i join projects p on p.id = i.project_id"
        " join issue_revisions r on r.issue_id = i.id"
        " where p.prefix = ? and i.human_number = ? order by r.revision limit 1",
        (prefix, int(number)),
    ).fetchone()
    if row is None:
        return None
    contract = json.loads(row[0])
    problem = (contract.get("problem") or "").split("SCOPE:")[0].strip()
    success = contract.get("success") or ""
    if isinstance(success, list):
        success = "\n".join(str(s) for s in success)
    text = f"{problem}\n\n{success}".strip()
    return text or None


def refs_of(repo: Path, branch: str, prefix: str) -> dict[str, list[str]]:
    """Issue ref -> its commits on ``branch``, oldest first (no merges)."""
    out: dict[str, list[str]] = {}
    log = git_read(repo, "log", "--no-merges", "--reverse", "--format=%H %s", branch)
    for line in log.splitlines():
        sha, _, subject = line.partition(" ")
        for ref in dict.fromkeys(re.findall(rf"\b{prefix}-\d+\b", subject)):
            out.setdefault(ref, []).append(sha)
    return out


def tree(repo: Path, commit: str) -> list[str]:
    return git_read(repo, "ls-tree", "-r", "--name-only", commit).splitlines()


def truth_files(repo: Path, shas: list[str], base_files: set[str]) -> list[str]:
    """Files the change modified that existed at the base commit, minus
    bookkeeping."""
    touched: set[str] = set()
    for sha in shas:
        for line in git_read(
            repo, "diff-tree", "--no-commit-id", "--name-status", "-r", sha
        ).splitlines():
            status, _, path = line.partition("\t")
            if status.startswith("M"):
                touched.add(path)
    return sorted(p for p in touched if p in base_files and not BOOKKEEPING.search(p))


def build(out_dir: Path) -> dict[str, Any]:
    db = sqlite3.connect(f"file:{Path(STATE_DB).expanduser()}?mode=ro", uri=True)
    items = []
    for name, spec in REPOS.items():
        repo = Path(spec["path"]).expanduser()
        for ref, shas in refs_of(repo, spec["branch"], spec["prefix"]).items():
            text = contract_text(db, ref)
            if not text:
                continue
            base = git_read(repo, "rev-parse", f"{shas[0]}^").strip()
            files = set(tree(repo, base))
            truth = truth_files(repo, shas, files)
            if not truth:
                continue
            items.append(
                {
                    "item_id": f"{name}:{ref}",
                    "repo": name,
                    "ref": ref,
                    "base": base,
                    "base_tree": git_read(
                        repo, "rev-parse", f"{base}^{{tree}}"
                    ).strip(),
                    "commits": shas,
                    "task": strip_paths(text),
                    "truth": truth,
                    "n_files_at_base": len(files),
                }
            )
    out_dir.mkdir(parents=True, exist_ok=True)
    body = "".join(json.dumps(i, sort_keys=True) + "\n" for i in items)
    (out_dir / "items.jsonl").write_text(body, encoding="utf-8")
    manifest = {
        "dataset_id": "code-locator",
        "version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "items_file": "items.jsonl",
        "items_sha256": "sha256:" + hashlib.sha256(body.encode("utf-8")).hexdigest(),
        "n_items": len(items),
        "by_repo": dict(Counter(i["repo"] for i in items)),
        "selection": "every issue ref cited in a non-merge commit subject on the repo's main branch whose Substrate contract has a first revision and whose commits modified at least one pre-existing non-bookkeeping file",
        "task_text": "first-revision PROBLEM + SUCCESS, inline SCOPE tail cut, path-like tokens replaced by [path]",
        "truth": "files with status M in the ref's commits that exist at the base commit (parent of the first commit), minus bookkeeping",
        "bookkeeping_rule": BOOKKEEPING.pattern,
        "path_token_rule": PATH_TOKEN.pattern,
        "repos": REPOS,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=1, sort_keys=True) + "\n", encoding="utf-8"
    )
    return manifest


def load(out_dir: Path) -> list[dict[str, Any]]:
    manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    body = (out_dir / manifest["items_file"]).read_text(encoding="utf-8")
    if (
        "sha256:" + hashlib.sha256(body.encode("utf-8")).hexdigest()
        != manifest["items_sha256"]
    ):
        raise ValueError(f"{out_dir}: items do not match the frozen manifest hash")
    return [json.loads(line) for line in body.splitlines() if line]


# --- baselines ---------------------------------------------------------------

_STOP = frozenset(
    "the and for with that this from into when then than are was were not but all any its has have should must can will does done each only also more most such same other which what where who how why use used using per via one two new add fix test tests file files code".split()
)


def words(text: str) -> list[str]:
    spaced = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    return [
        w
        for w in re.split(r"[^a-z0-9]+", spaced.lower())
        if len(w) >= 3 and w not in _STOP
    ]


def lexical_rank(task: str, files: list[str]) -> list[str]:
    tokens = {f: set(words(f)) for f in files}
    df = Counter(w for ws in tokens.values() for w in ws)
    query = set(words(task))
    n = len(files)
    score = {
        f: sum(math.log(n / df[w]) for w in ws & query) for f, ws in tokens.items()
    }
    return sorted(files, key=lambda f: (-score[f], len(f), f))


def hot_rank(repo: Path, base: str, files: list[str]) -> list[str]:
    counts = Counter(
        p
        for p in git_read(
            repo, "log", "--no-merges", "--format=", "--name-only", base
        ).splitlines()
        if p
    )
    return sorted(files, key=lambda f: (-counts.get(f, 0), len(f), f))


# --- the System One beam -----------------------------------------------------


def children(files: list[str], directory: str) -> dict[str, str]:
    """Immediate entries of ``directory`` ('' is the root): name -> kind;
    directory names end with '/'."""
    prefix = directory
    out: dict[str, str] = {}
    for f in files:
        if not f.startswith(prefix):
            continue
        head, sep, _ = f[len(prefix) :].partition("/")
        out[head + sep] = "directory" if sep else "file"
    return dict(sorted(out.items()))


class BeamWorkflow(Workflow):
    """One task per episode. State: the task and the beam of directory
    paths with their log path probability; the repository tree and the
    accumulated leaves live on the workflow, keyed by item id, and are
    never sent."""

    model = "jev-latest"

    def __init__(
        self,
        cache: ResponseCache,
        trees: dict[str, list[str]],
        truth: dict[str, list[str]],
        width: int = WIDTH,
    ) -> None:
        super().__init__(cache)
        self.trees, self.truth, self.width = trees, truth, width
        self.leaves: dict[str, dict[str, float]] = {}
        self.truncated: dict[str, int] = {}
        self._lock = threading.Lock()

    def _entries(self, state: dict[str, Any], path: str) -> dict[str, str]:
        entries = children(self.trees[state["item_id"]], path)
        if len(entries) > MAX_CHOICE:
            ranked = lexical_rank(state["task"], list(entries))[:MAX_CHOICE]
            with self._lock:
                self.truncated[state["item_id"]] = (
                    self.truncated.get(state["item_id"], 0) + 1
                )
            entries = {k: entries[k] for k in sorted(ranked)}
        return entries

    def questions(self, state: dict[str, Any]) -> dict[str, dict[str, Any]]:
        out = {}
        for n, node in enumerate(state["beam"]):
            entries = self._entries(state, node["path"])
            if len(entries) < 2:
                continue  # a single entry is decided by code, not asked
            where = f"`{node['path']}`" if node["path"] else "the repository root"
            out[f"step_{n}"] = {
                "type": "choice",
                "instructions": f"A developer must carry out `task`. Which entry of {where} contains the files that this work changes? Choose the most likely entry.",
                "criteria": entries,
            }
        return out

    def state_view(self, state: dict[str, Any]) -> dict[str, Any]:
        return {"task": state["task"]}

    def ask(
        self, state: dict[str, Any], questions: dict[str, dict[str, Any]]
    ) -> dict[str, Any]:
        if not questions:  # every beam node had one entry: no request needed
            return {
                "answers": {},
                "request_id": None,
                "model": None,
                "usage": {},
                "latency_ms": 0.0,
                "cached": True,
            }
        return super().ask(state, questions)

    def policy(self, state: dict[str, Any], answers: dict[str, Any]) -> dict[str, Any]:
        # (log p, asked, path): ``asked`` counts only the steps System One
        # answered; a forced single-entry step adds log(1) = 0 and does not
        # count, so it cannot inflate the geometric-mean path probability.
        expansions: list[tuple[float, int, str]] = []
        for n, node in enumerate(state["beam"]):
            entries = self._entries(state, node["path"])
            answer = answers.get(f"step_{n}")
            probs = (
                answer["probabilities"] if answer else {name: 1.0 for name in entries}
            )
            for name, p in probs.items():
                expansions.append(
                    (
                        node["logp"] + math.log(max(p, 1e-9)),
                        node.get("asked", 0) + (1 if answer else 0),
                        node["path"] + name,
                    )
                )
        item = state["item_id"]
        with self._lock:
            leaves = self.leaves.setdefault(item, {})
            for logp, depth, path in expansions:
                if not path.endswith("/"):
                    leaves[path] = max(leaves.get(path, -math.inf), logp / max(depth, 1))
        dirs = sorted(
            (e for e in expansions if e[2].endswith("/")), key=lambda e: -e[0] / max(e[1], 1)
        )[: self.width]
        return {
            "action": "expand",
            "escalate": None,
            "beam": [{"path": p, "logp": lp, "asked": d} for lp, d, p in dirs],
            "beam_geometric_p": [math.exp(lp / max(d, 1)) for lp, d, _ in dirs],
            "leaves_so_far": len(leaves),
        }

    def next_state(
        self,
        state: dict[str, Any],
        decision: dict[str, Any],
        escalation: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        if not decision["beam"] or state["depth"] + 1 >= MAX_DEPTH:
            return None
        return {**state, "beam": decision["beam"], "depth": state["depth"] + 1}

    def ranking(self, item_id: str) -> list[str]:
        leaves = self.leaves.get(item_id, {})
        return sorted(leaves, key=lambda f: (-leaves[f], f))

    def outcome(
        self, episode_id: str, trace: list[dict[str, Any]]
    ) -> dict[str, Any] | None:
        ranked = self.ranking(episode_id)
        truth = self.truth[episode_id]
        return {
            "resolved": {"truth": truth},
            "resolver": "git: files modified by the change",
            "ranked_top10": ranked[:10],
            **hits(ranked, truth),
        }


def hits(ranked: list[str], truth: list[str]) -> dict[str, float]:
    t = set(truth)
    out = {f"hit@{k}": float(any(f in t for f in ranked[:k])) for k in TOP_K}
    out["recall@10"] = sum(1 for f in ranked[:10] if f in t) / len(t)
    first = next((i for i, f in enumerate(ranked) if f in t), None)
    out["mrr"] = 0.0 if first is None else 1.0 / (first + 1)
    return out


def start_state(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "item_id": item["item_id"],
        "task": item["task"],
        "beam": [{"path": "", "logp": 0.0, "asked": 0}],
        "depth": 0,
    }


def run_all(
    items: list[dict[str, Any]], cache: ResponseCache, workers: int = 4
) -> tuple[BeamWorkflow, dict[str, list[dict[str, Any]]]]:
    trees = {
        i["item_id"]: tree(Path(REPOS[i["repo"]]["path"]).expanduser(), i["base"])
        for i in items
    }
    wf = BeamWorkflow(cache, trees, {i["item_id"]: i["truth"] for i in items})
    records: dict[str, list[dict[str, Any]]] = {}

    def one(item: dict[str, Any]) -> None:
        records[item["item_id"]] = wf.run_episode(
            item["item_id"], start_state(item), max_steps=MAX_DEPTH
        )

    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(one, items))
    return wf, records


# --- evaluation --------------------------------------------------------------

ARMS = ("jev-beam", "lexical", "hot-files")
METRICS = ("hit@1", "hit@5", "hit@10", "recall@10", "mrr")


def per_item(
    items: list[dict[str, Any]],
    wf: BeamWorkflow,
    records: dict[str, list[dict[str, Any]]],
) -> dict[str, dict[str, dict[str, float]]]:
    out: dict[str, dict[str, dict[str, float]]] = {a: {} for a in ARMS}
    for item in items:
        iid = item["item_id"]
        repo = Path(REPOS[item["repo"]]["path"]).expanduser()
        files = wf.trees[iid]
        out["jev-beam"][iid] = hits(wf.ranking(iid), item["truth"])
        out["lexical"][iid] = hits(lexical_rank(item["task"], files), item["truth"])
        out["hot-files"][iid] = hits(hot_rank(repo, item["base"], files), item["truth"])
        calls = [r for r in records[iid] if r["kind"] == "system_one_call"]
        out["jev-beam"][iid].update(
            {
                "requests": float(sum(1 for r in calls if r["data"]["request_id"])),
                "questions": float(sum(len(r["data"]["answers"]) for r in calls)),
                "input_tokens": float(
                    sum(
                        (r.get("usage") or {}).get("gen_ai.usage.input_tokens") or 0
                        for r in calls
                    )
                ),
                "cost_usd": sum((r["data"]["cost"]["value"] or 0.0) for r in calls),
                "latency_ms": sum(
                    (r.get("usage") or {}).get("latency_ms") or 0.0 for r in calls
                ),
            }
        )
    return out


#: Exploratory, chosen AFTER the primary result showed the hot-files prior
#: beating the beam: (a) code fuses the beam's ranking with the prior by
#: reciprocal rank (k = 60), no new request; (b) every arm re-scored on the
#: non-Markdown truth files only (tasks with none are skipped).
EXPLORATORY_ARMS = ("fusion", "jev-beam-code", "lexical-code", "hot-files-code")
RRF_K = 60


def fuse(a: list[str], b: list[str], k: int = RRF_K) -> list[str]:
    score: dict[str, float] = {}
    for ranked in (a, b):
        for r, f in enumerate(ranked):
            score[f] = score.get(f, 0.0) + 1.0 / (k + r + 1)
    return sorted(score, key=lambda f: (-score[f], f))


def exploratory(items: list[dict[str, Any]], wf: BeamWorkflow, table: dict[str, dict[str, dict[str, float]]]) -> None:
    for arm in EXPLORATORY_ARMS:
        table[arm] = {}
    for item in items:
        iid = item["item_id"]
        repo = Path(REPOS[item["repo"]]["path"]).expanduser()
        files = wf.trees[iid]
        beam, hot, lex = wf.ranking(iid), hot_rank(repo, item["base"], files), lexical_rank(item["task"], files)
        table["fusion"][iid] = hits(fuse(beam, hot), item["truth"])
        code = [f for f in item["truth"] if not f.endswith(".md")]
        if code:
            table["jev-beam-code"][iid] = hits(beam, code)
            table["lexical-code"][iid] = hits(lex, code)
            table["hot-files-code"][iid] = hits(hot, code)


def evaluate(
    items: list[dict[str, Any]],
    table: dict[str, dict[str, dict[str, float]]],
    n_resamples: int = stats.N_RESAMPLES,
) -> dict[str, Any]:
    ids = [i["item_id"] for i in items]
    resamples = stats.resample_indices(len(ids), n_resamples, SEED)

    def mean(arm: str, name: str, idx: list[int]) -> float | None:
        vals = [table[arm][ids[n]][name] for n in idx if name in table[arm].get(ids[n], {})]
        return sum(vals) / len(vals) if vals else None

    metrics: dict[str, Any] = {}
    deltas: dict[str, Any] = {}
    everything = list(range(len(ids)))
    extra = ("requests", "questions", "input_tokens", "cost_usd", "latency_ms")
    for arm in ARMS:
        for name in METRICS + (extra if arm == "jev-beam" else ()):
            metrics[f"{arm}|{name}"] = stats.interval(
                mean(arm, name, everything),
                [mean(arm, name, r) for r in resamples],
                len(ids),
            )
    for arm in EXPLORATORY_ARMS:
        if arm in table:
            for name in METRICS:
                metrics[f"{arm}|{name}"] = stats.interval(mean(arm, name, everything), [mean(arm, name, r) for r in resamples], len(ids))
    pairs = [("jev-beam", "lexical"), ("jev-beam", "hot-files")]
    if "fusion" in table:
        pairs += [("fusion", "hot-files"), ("fusion", "jev-beam"), ("jev-beam-code", "hot-files-code"), ("jev-beam-code", "lexical-code")]
    for arm, ref in pairs:
        for name in METRICS:

            def diff(idx: list[int]) -> float | None:
                both = [n for n in idx if ids[n] in table[arm] and ids[n] in table[ref]]
                a, b = mean(arm, name, both), mean(ref, name, both)
                return None if a is None or b is None else a - b

            deltas[f"{arm}-minus-{ref}|{name}"] = stats.interval(
                diff(everything), [diff(r) for r in resamples], len(ids)
            )
    by_repo = {
        repo: {
            f"{arm}|{name}": mean(
                arm, name, [n for n, i in enumerate(items) if i["repo"] == repo]
            )
            for arm in ARMS
            for name in METRICS
        }
        for repo in REPOS
    }
    return {
        "metrics": metrics,
        "paired_deltas": deltas,
        "by_repo_point": by_repo,
        "n_items": len(ids),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("build", "run", "evaluate", "publish"))
    parser.add_argument("--dataset", "--out-dataset", dest="dataset", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--result", type=Path)
    parser.add_argument("--root", type=Path)
    parser.add_argument("--registry", type=Path)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--resamples", type=int, default=stats.N_RESAMPLES)
    args = parser.parse_args()
    if args.command == "build":
        print(
            json.dumps(
                {
                    k: v
                    for k, v in build(args.out).items()
                    if k in ("n_items", "by_repo", "items_sha256")
                }
            )
        )
        return
    items = load(args.dataset)
    cache = ResponseCache(args.cache)
    before = len(cache._entries)
    wf, records = run_all(items, cache, args.workers)
    new = len(cache._entries) - before
    if args.command == "run":
        print(
            json.dumps(
                {
                    "items": len(items),
                    "new_requests": new,
                    "truncated_choices": sum(wf.truncated.values()),
                }
            )
        )
        return
    table = per_item(items, wf, records)
    exploratory(items, wf, table)
    if args.command == "evaluate":
        result = evaluate(items, table, args.resamples)
        result.update(
            uncached_requests=new,
            truncated_choices=wf.truncated,
            width=WIDTH,
            max_depth=MAX_DEPTH,
            per_item=table,
        )
        args.out.write_text(
            json.dumps(result, indent=1, sort_keys=True) + "\n", encoding="utf-8"
        )
        print(
            json.dumps(
                {"n_items": len(items), "uncached_requests": new, "out": str(args.out)}
            )
        )
        return
    from xtrm_research import publish_locator

    publish_locator.publish_all(args, items, wf, records, table)


if __name__ == "__main__":
    main()
