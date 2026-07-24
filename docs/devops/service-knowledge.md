# service-knowledge

First-class operational **service-knowledge** package — per-service expert skill packages
kept in sync with code via a GitNexus-aware drift engine. Elevated from the vendored
`service-skills` machinery to a standalone package with its own CLI, versioning, release
cadence, and CHANGELOG. **Not** routed through `xt update --apply`.

- **Package:** `~/dev/xtrm/packages/service-knowledge` (v0.4.0)
- **Reframe spec:** [`docs/research/kb-knowledge-base-svc.md`](../research/kb-knowledge-base-svc.md)
- **CHANGELOG:** `~/dev/xtrm/packages/service-knowledge/CHANGELOG.md`
- **Index & MCP retrieval:** [`service-knowledge-index.md`](./service-knowledge-index.md) (PR3)
- **Verifier write gate:** [`service-knowledge-verifier-gate.md`](./service-knowledge-verifier-gate.md) (PR2)

## Install / update / status

```bash
pip install service-knowledge            # or: pip install -e ~/dev/xtrm/packages/service-knowledge

cd <your-service-hosting-repo>
service-knowledge install                # vendor + migrate + wire hooks (idempotent)
service-knowledge update                 # pull installed package version (no diff if current)
service-knowledge status                 # report install state
service-knowledge migrate                # one-time service-skills -> service-knowledge rename
service-knowledge remove                 # uninstall machinery + cache + hooks
```

## What `install` does

- Vendors the machinery into `.xtrm/skills/default/service-knowledge/`.
- Migrates any legacy `service-skills` umbrella to `service-knowledge` (rewrites registry
  `skill_path` refs; regenerates the `<repo>-service-knowledge` umbrella — one-time hard break
  from `<repo>-services`).
- Wires Claude SessionStart (cataloger) / PreToolUse (activator) / PostToolUse (drift) hooks
  into `.claude/settings.json`, pointing at the project-local machinery.
- Creates `.xtrm/cache/service-knowledge.sqlite`; PR3 (v0.3.0) populates the FTS5 schema —
  run `service-knowledge index build` to fill it (see the index doc).
- Emits per-invocation telemetry (`component=sk-cli`) to
  `.xtrm/state/service-knowledge/install.jsonl`.

## Backward compatibility (one release cycle)

The machinery resolves the per-repo umbrella under **both** `service-knowledge` (preferred)
and `service-skills` (legacy fallback), so non-migrated repos keep working unchanged. The
legacy name is dropped next cycle.

## Rollout

- **Wave-1 (PoC):** mercury-infra (this PR).
- **Wave-2:** the other 6 mercury service-host repos adopt on operator trigger post-merge —
  each is a 5-minute `service-knowledge install` + smoke.
- `~/dev/core`, `~/dev/specialists`, `~/dev/xtrm`, `~/dev/xtmux`, `~/dev/vaultctl` are
  **tooling** repos, not service hosts — they are NOT consumers.

## Roadmap

v0.1.0 was lift-and-shift + rename + CLI scaffolding. **v0.3.0 (PR3)** adds the per-repo FTS5
evidence index + three read-only `knowledge_*` MCP tools + the cataloger reframe — see
[`service-knowledge-index.md`](./service-knowledge-index.md). The verifier (PR1/PR2), activator
upgrade (PR4) and eval/telemetry backend (PR5) land in their own PRs.
