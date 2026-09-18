"""Run one Evidence Gate arm over every frozen item (XTRM-495..497, 499).

    python -m xtrm_research.evidence_gate.arms --arm qwen --dataset DIR --out DIR

Predictions append to ``<out>/<arm>.jsonl``; a rerun skips items already
answered, so an interrupted arm resumes rather than re-paying calls. Every
arm reads the same frozen items (the dataset hash is checked on load and
recorded in ``<out>/<arm>.meta.json``).
"""

from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from xtrm_research.code_state import capture_code_state
from xtrm_research.evidence_gate import dataset as d
from xtrm_research.evidence_gate.labels import QUESTIONS

ARMS = ("embedding", "qwen", "jev", "frontier", "llm")


def _done(path: Path) -> set[str]:
    if not path.exists():
        return set()
    rows = [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]
    return {r["item_id"] for r in rows if r.get("status", "answered") == "answered"}


def _loadavg() -> str | None:
    """Host load while the arm ran: local-arm latency is only comparable
    between runs under similar load."""
    try:
        return Path("/proc/loadavg").read_text(encoding="utf-8").strip()
    except OSError:
        return None


def run(
    arm: str,
    dataset_dir: Path,
    out: Path,
    workers: int,
    threads: int = 2,
    shard: tuple[int, int] = (0, 1),
) -> dict[str, Any]:
    items = d.load_items(dataset_dir)
    out.mkdir(parents=True, exist_ok=True)
    out.chmod(0o700)
    path = out / f"{arm}.jsonl"
    done = _done(path)
    # shard i/n takes items at positions i, i+n, ...: n processes cover the
    # set exactly once and append whole lines to the same file
    todo = [
        item
        for n, item in enumerate(items)
        if n % shard[1] == shard[0] and item["item_id"] not in done
    ]
    started = datetime.now(timezone.utc).isoformat()
    meta: dict[str, Any] = {
        "arm": arm,
        "started_at": started,
        "n_todo": len(todo),
        "shard": list(shard),
        "loadavg_at_start": _loadavg(),
    }
    if arm in ("embedding", "qwen"):
        from xtrm_research.evidence_gate import local

        scorer = (
            local.EmbeddingScorer(threads=threads)
            if arm == "embedding"
            else local.QwenRerankerScorer(threads=threads)
        )
        meta["model_revision"] = scorer.revision
        with path.open("a", encoding="utf-8") as handle:
            for item in todo:
                row = {**local.predict(scorer, item, QUESTIONS), "status": "answered"}
                handle.write(json.dumps(row, sort_keys=True) + "\n")
                handle.flush()
    else:
        from xtrm_research.evidence_gate import frontier

        predict = {
            "jev": frontier.jev_predict,
            "frontier": frontier.frontier_predict,
            "llm": frontier.llm_predict,
        }[arm]
        meta["model"] = {
            "jev": frontier.JEV_MODEL,
            "frontier": frontier.FRONTIER_MODEL,
            "llm": frontier.LLM_MODEL,
        }[arm]
        if arm == "frontier":
            meta["effort"] = frontier.FRONTIER_EFFORT
        with (
            ThreadPoolExecutor(max_workers=workers) as pool,
            path.open("a", encoding="utf-8") as handle,
        ):
            for row in pool.map(predict, todo):
                handle.write(json.dumps(row, sort_keys=True) + "\n")
                handle.flush()
    manifest = json.loads((dataset_dir / "manifest.json").read_text(encoding="utf-8"))
    meta.update(
        finished_at=datetime.now(timezone.utc).isoformat(),
        loadavg_at_finish=_loadavg(),
        dataset_items_sha256=manifest["items_sha256"],
        n_items=len(items),
        n_answered=len(_done(path)),
        workers=workers,
        torch_threads=threads if arm in ("qwen", "embedding") else None,
        code_state=capture_code_state(Path(__file__).resolve().parents[3]),
    )
    runs = []
    meta_path = out / f"{arm}.meta.json"
    if meta_path.exists():
        runs = json.loads(meta_path.read_text(encoding="utf-8"))["invocations"]
    meta_path.write_text(
        json.dumps({"invocations": [*runs, meta]}, indent=1, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return meta


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--arm", choices=ARMS, required=True)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=4)
    #: Under host contention fewer torch threads is faster (XTRM-496: 3.1 s
    #: per pass at 2 threads vs ~30 s at 12 with load ~70).
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument(
        "--shard", default="0/1", help="i/n: this process scores items i, i+n, ..."
    )
    args = parser.parse_args()
    meta = run(
        args.arm,
        args.dataset.expanduser(),
        args.out.expanduser(),
        args.workers,
        args.threads,
        tuple(int(x) for x in args.shard.split("/")),
    )
    print(json.dumps({k: meta[k] for k in ("arm", "n_items", "n_answered")}))


if __name__ == "__main__":
    main()
