# service-knowledge

First-class operational **service-knowledge** package. Gives an agent persistent,
repo-specific operational knowledge about your services — architecture, data flows,
failure modes, runnable health checks, deploy/runbook, and diagnostic scripts — kept in
sync with the code via a GitNexus-aware drift engine.

Elevated from the vendored `service-skills` machinery (previously shipped **into** consumer
repos via `xt update --apply`) to a standalone package with its **own CLI, versioning,
release cadence, and CHANGELOG**. Not routed through `xt update --apply`.

## Install

```bash
pip install service-knowledge
cd <your-service-hosting-repo>
service-knowledge install
```

## CLI

```
service-knowledge install   # vendor + migrate + wire hooks (idempotent)
service-knowledge update    # pull installed package version (no diff if current)
service-knowledge status    # report install state
service-knowledge migrate   # one-time service-skills -> service-knowledge rename
service-knowledge remove    # uninstall machinery + cache + hooks
```

## Package layout

```
src/service_knowledge/
├── cli/         # install · update · status · migrate · remove (stdlib argparse)
├── scripts/     # the 11 machinery scripts (cataloger, drift_detector, skill_activator, …)
├── contracts/   # service_skill_contract.json (SKILL.md section SSOT)
├── skills/      # reference SKILLs (creating, using, updating, routing, system-guide, …)
├── install/     # install-service-knowledge.py + settings.json + git-hooks/
└── mcp/         # scaffold; PR3 lands the knowledge_* MCP tools
```

## Dependencies

Stdlib-only CLI. The only cross-package dependency is **vaultctl** (declared at v0.1.0;
wired in PR3 for vault-backed secrets). The CLI does **not** depend on xtrm/bd/sp/xt/xtmux.

## Status

v0.1.0 — lift-and-shift + rename + CLI scaffolding. The reframe machinery (verifier, FTS5
index, MCP tools, activator upgrade, eval, telemetry backend) lands in PR1–5. See
`docs/research/kb-knowledge-base-svc.md` in the xtrm repo for the full reframe spec.
