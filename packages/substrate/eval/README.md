# Recall R1b evaluation (CORE-2603)

Pre-registered measurement of the Substrate recall index on questions an agent
would type. The contract is Substrate Issue CORE-2603 (revision 4); this
directory holds the case-author workflow it names, and `scripts/recall-r1b-*.ts`
holds the tooling that samples, filters, measures and proves the run.

## What is measured

Exactly 40 cases, hand-accepted by the coordinator in seeded sampler order. Each
case is one journal row (the target) and one question written by an agent that
has not read the row. Two arms run once over the same set:

| arm | what it is |
| --- | --- |
| L | the frozen local ranker in `src/recall/query.ts` over the FTS5 index |
| J | arm L's 50-candidate pool reranked by one Jev Noul per (question, candidate), arm L order as tie-break, fail-open to arm L on any error, timeout or missing key |

Bars: hit@5 >= 34/40 and hit@10 >= 38/40 for each arm. Arm L's hit@50 is arm
J's ceiling. Both results are reported whatever they show; nothing is retuned.

## Case authoring

`recall-case-author.workflow.json` is an AgentRun v2 workflow. For each target it
asks a model for one question, asks the host judge (Jev) two property questions,
and gates the result in code (zero copied three-word runs against the entry).

The coordinator hand-reviews every surviving case (the entry answers the
question; an agent who has not read the entry could ask it). Jev's probabilities
are shadow data only: calibration failed (CORE-2603 seq 5), so the judge decides
nothing. Authoring runs in batches of at most 30 targets until 40 cases are
accepted or 120 targets are spent.

In-session `/agentrun run` refuses code nodes, so the workflow runs through the
trusted CLI runner, with a config that names the model and wires the judge:

```bash
# config.mjs
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createJevRunner } from "@parcha/agentrun-jev";
const runtime = await ModelRuntime.create();
export default { model: runtime.getModel("commandcode", "deepseek/deepseek-v4.1-flash"), modelRuntime: runtime, tools: [], maxTurns: 10, maxSubmissions: 5 };
export const deps = { runJudge: createJevRunner({ maxAttempts: 2, timeoutMs: 8000 }) };

node node_modules/@parcha/agentrun-pi/dist/cli.js run --config ./config.mjs \
  recall-case-author.workflow.json input.json > authored.json
```

## Tooling

Run from `packages/substrate`. The index and the case files live under
`~/.cache/recall-design/r1b/`; the source store is opened read-only and the
index is built on a copy.

```bash
node scripts/recall-r1b-cli.ts check                     # workflow/question/hash drift
node scripts/recall-r1b-cli.ts build --db <copy> --index <index> --rebuild
node scripts/recall-r1b-cli.ts sample --freeze-at <ms> --seed <sha256> --pool <n>
node scripts/recall-r1b-cli.ts casefile --targets <t.json> --authored <a.json> --select 40
node scripts/recall-r1b-cli.ts overlap --casefile <c.json> --freeze-at <ms>
node scripts/recall-r1b-cli.ts measure --casefile <c.json> --now <ms> --request-log <jsonl>
node scripts/recall-r1b-cli.ts failopen --casefile <c.json> --now <ms>
node scripts/recall-r1b-cli.ts scan --request-log <jsonl>
node scripts/recall-r1b-cli.ts calib --pairs <p.json> --labels <l.json>
```

`sample` orders eligible rows by `sha256(seed + "\n" + ref#seq)`, applies at
most 3 cases per ref and a 40% project cap, and writes the target pool.
`casefile` applies the mechanical checks (zero copied trigrams, every question
token with index document frequency > 3), computes the copy sets under the
answer rule, and selects the first 40 accepted cases in seeded order with the
contract's 50% project-share cap.

`measure` runs both arms once and reports hit@1/5/10/50, MRR, Wilson 95%
intervals, per-case top 10, arm J fail-open count, per-query and per-call
latency p50/p95, hits that came through a copy, and the mean lowest-df question
token. `failopen` proves the four fail-open paths against stub transports and a
missing key. `scan` proves the index and the logged Jev requests carry no
secrets and that every logged request is index text.

`build` uses the indexer's own `buildRecallIndex`; run the heavy steps under
`nice` and a memory cap.
