# arena-top

Top models from **Arena AI** (formerly LMSYS Chatbot Arena) leaderboards, from the
terminal.

Arena AI publishes no public API. `arena-top` reads the daily JSON snapshots
maintained at [oolong-tea-2026/arena-ai-leaderboards](https://github.com/oolong-tea-2026/arena-ai-leaderboards)
(GitHub Actions, daily, 10 leaderboards, 300+ models). Stdlib only — Python 3.10+,
no third-party deps.

## Install

```bash
pip install -e packages/arena-top
arena-top --help
```

## Usage

```bash
arena-top                  # top 10 of the code leaderboard
arena-top code 20          # top 20 code
arena-top text             # top 10 text (general)
arena-top vision 5         # top 5 vision
arena-top --list           # list categories
arena-top code --json      # raw JSON (pipe into jq/etc.)
arena-top text --snapshot 2026-07-01   # historical snapshot
```

## Categories

`text` · `code` · `vision` · `document` · `search` · `image-edit` ·
`image-to-video` · `text-to-image` · `text-to-video` · `video-edit`

## Data source

Each snapshot is `{ meta, models[] }` where every model has
`rank, model, vendor, license, score, ci, votes`. The latest snapshot is resolved
via `data/latest.json` → `data/<YYYY-MM-DD>/<category>.json`. Upstream updates
daily; no local caching, so you always see the current board.

## Reference data

`data/commandcode-model-catalog.json` — snapshot of Command Code's model catalog
(scraped from `commandcode.ai/models/*` streamed loader data, 2026-08-18): 57 models
with per-model `category` (premium/opensource), `inputCost`/`outputCost`/cache rates
($/M tokens), `minPlanName`/`blockedPlanLevels` plan gating, context windows, and
benchmark scores. Useful for planning which models are usable/affordable on a given
Command Code plan (e.g. GOAT = opensource only). Refresh with the same scraping
approach when models change.

## License

MIT
