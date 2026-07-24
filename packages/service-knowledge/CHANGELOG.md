# Changelog — service-knowledge

All notable changes to the `service-knowledge` package.

## [0.1.0] - 2026-07-24

### Added
- First-class package elevated from the vendored `service-skills` machinery (previously
  shipped into consumer repos via `xt update --apply`). Own CLI, versioning, release
  cadence, and CHANGELOG. **Not** routed through `xt update --apply`.
- CLI `service-knowledge install|update|status|migrate|remove` (stdlib argparse; does not
  depend on xtrm/bd/sp/xt/xtmux).
- Entry point `service-knowledge = service_knowledge.cli:main`; pip-installable.
- All 11 machinery scripts relocated byte-for-byte (bootstrap, cataloger, deep_dive,
  drift_detector, layout_migrator, reconcile, scaffolder, scope, skill_activator,
  skill_migrator, umbrella_generator).
- `contracts/service_skill_contract.json`, reference SKILLs, `install/` machinery, and an
  empty `mcp/` scaffold (PR3 lands the `knowledge_*` tools).
- Per-invocation telemetry (`component=sk-cli`) to `.xtrm/state/service-knowledge/install.jsonl`.
- Declared dependency on `vaultctl>=0.1.0,<0.2` (wired in PR3).

### Changed — BREAKING (one-time hard break)
- **Umbrella name transition: `<repo>-services` → `<repo>-service-knowledge`.** The per-repo
  umbrella skill is renamed and the umbrella subdirectory moves
  `<pack>/service-skills/` → `<pack>/service-knowledge/`. `service-knowledge migrate`
  performs the rename, rewrites registry `skill_path` refs, and regenerates the umbrella.
  The old `<repo>-services` name is **not** recognized after migration.

### Backward compatibility (one release cycle)
- The machinery resolves the per-repo umbrella under **both** `service-knowledge`
  (preferred) and `service-skills` (legacy fallback), so non-migrated repos keep working
  unchanged. The legacy name is dropped next cycle.
