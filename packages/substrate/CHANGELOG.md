# Changelog

All notable changes to `@jaggerxtrm/substrate` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.2.4] - 2026-11-02

### Added

- Remote store access (XTRM-685, ADR-008). `substrate.remote` (`ssh:<host>`, or `SUBSTRATE_REMOTE`) makes `sb` and the git hooks run on the machine that owns the store, over `ssh`, with no listener and no daemon. `sb remote setup|status|disable` manage it, and `sb doctor` reports the mode, the server version, the round-trip time and what the server's `sb` cannot do. Unset means fully local, exactly as before. `SUBSTRATE_DB` or `--db` always selects the local store. Document arguments (`--contract`, `--file` and similar) travel as a framed stream on stdin; a truncated stream is refused and nothing runs. `--file` is refused for secrets directories, symlinks and files with a second hard link.
- Board rows carry `journalCount`, `pointerCount` and `lastActivityAt`. A journal write does not touch `updatedAt`, so board readers can now see journal activity without a per-issue read.
- Board rows carry `attestationState` and `structurallyValid`, so a board can tell an incomplete contract from an unattested, stale or rejected one.

### Changed

- `openSubstrate` creates the state directory with mode 0700 and the database with mode 0600 (CORE-2381).
- Repository identity: an scp-style origin takes its host from the first `:`, as git does, so `evil.com:path@github.com:acme/app` keys under `evil.com`. A URL whose authority contains `?`, `#`, `\` or a control character is no longer treated as a remote, because it could fold onto another repository's key.

---

## [0.2.3] - 2026-11-02

Released without a changelog entry. Reconstructed from the commits between 0.2.2 and the release.

### Added

- Claude plugin marketplace with version-driven updates (XTRM-640).
- SessionStart XTRM primer from the global `using-xtrm` and `multiplexing` skills (XTRM-637), naming the dispatcher and the Substrate participant (CORE-2390).

### Fixed

- Claude hook output is schema-valid (#256).

---

## [0.2.2] - 2026-09-27

### Summary

A bounded board read model, so listing issues stops costing a query per issue.

`IssueService.listIssues` ran one id query and then hydrated every issue
individually, and `sb issue ready` derived readiness per issue on top of that
(N+1 over N+1). On the live store, `sb issue ready` cost 4.2 s for a 4,204-issue
project and grew linearly with the project.

This release adds `IssueService.queryIssues(query)`, one page of board rows in a
statement count that does not grow with the project: keyset pagination over the
full ordering tuple, SQL-level filters, batched revisions/attestations/blockers/
claims/children, and a level-by-level locator walk. Readiness is derived by the
same pure `deriveReadiness` the per-issue path used, so batched and per-issue
values agree exactly; only the loading changed.

- New: `queryIssues(query)` -> `IssueBoardPage` (`rows`, `nextCursor`, `hasMore`,
  `scanned`, `truncated`) and `queryAllIssues(query)` for callers that must stay
  exhaustive. Board rows carry board fields only: contract text, provenance,
  journal entries and readiness reasons stay behind the single-issue read.
- New: `sb issue query --project <id> [--limit] [--cursor] [--lifecycle]
  [--kind] [--readiness] [--search]`, emitting the page unchanged under `--json`.
- `sb issue list`, `sb issue ready`, MCP `issue_list`/`issue_ready` and the Pi
  issue search read through the projection. Their output is unchanged; `list`
  and `ready` still return every issue by walking pages.
- Root exports: `domain/board.ts` and `domain/readiness.ts` are now exported from
  the package root, which previously did not export the readiness types.

Closure evidence is also durable end to end now. Writing it no longer loses
repeated flags, and reading it no longer requires touching SQLite directly.

### Fixed
- Accumulate repeated closure evidence flags so `--artifact A --artifact B`
  records both instead of silently keeping only B (XTRM-552) ([9747fa0](https://github.com/xtrm-dev/xtrm/commit/9747fa0558c92eb7bc8bd7bd2ab70bfd343fd842))
- Read closure evidence refs back from `sb issue show` and `provenance trace`
  instead of leaving them reachable only by reading SQLite rows (XTRM-554) ([fef8541](https://github.com/xtrm-dev/xtrm/commit/fef8541dce3847da4f7a4b8d1d76305af8268a03))

## [0.2.1] - 2026-09-18

### Summary

0.2.1 is a correctness release on the execution-identity and provenance seam, plus one
schema migration. It adds no feature surface.

The headline change is **migration `v12`**, which drops the `workspace_leases` table. That
workspace writer lease was never invoked: it had no caller in this package, and per-Issue
claims were already the only mutation authority. Workspace exclusion is owned by the
Specialists activation layer. The migration applies automatically when the database is
opened. A client older than this release fails closed against a `v12` database, so upgrade
clients together.

The rest closes identity and provenance defects that were found by inspecting live rows
rather than by tests. Execution identity is canonicalised at the write seam instead of
being trusted from the caller, derived from ambient context when a caller states nothing,
and projected back into reads so stored identity stays queryable. Integration journal
envelopes carry ambient holder/activation identity instead of shadowing it with a
session-only context. Receipts link to the commit that carries their work and to the
journal checkpoint that settles them. Beads import preserves source timestamps and
structures contracts faithfully, and a repair entry point fixes boards that an earlier
import already flattened.

### Added
- Terminal-native sb UX and operation feedback (XTRM-388) ([be6f7b8](https://github.com/xtrm-dev/xtrm/commit/be6f7b8c3f1858054a46a3cb7e1b551fd276eb27))
- Substrate Documentation vNext and source-aligned provider surfaces ([316f385](https://github.com/xtrm-dev/xtrm/commit/316f385d3fda3351532d6993988ce17e7be7cc25))
- One-off Beads repair entry point with dry run and apply (XTRM-407) ([d7d9aaf](https://github.com/xtrm-dev/xtrm/commit/d7d9aafd2322c3721e222a422b32c7d4fbc15ca1))
- Record the settling journal checkpoint on a receipt (XTRM-416) ([8825f9d](https://github.com/xtrm-dev/xtrm/commit/8825f9d5647649864953727e1283079fcc5bdc8f))
- Project stored journal identity into reads (XTRM-410) ([f389755](https://github.com/xtrm-dev/xtrm/commit/f38975520d88ecfb17c0ed21ec1154b5e7962f74))
- Withdraw the workspace writer lease (XTRM-414) ([48452ec](https://github.com/xtrm-dev/xtrm/commit/48452ec6bfe4286e8a50781cb9ede4ae9a9de796))

### Fixed
- Publish JavaScript so an installed copy runs under Node ([ac81158](https://github.com/xtrm-dev/xtrm/commit/ac811589792e275fbeb896b41ee98d389b821b5a))
- Address review FAIL - ship no TypeScript entry, guard publish ([1d98aba](https://github.com/xtrm-dev/xtrm/commit/1d98abab0174297d9955d97648edd65c19fd20aa))
- Make the --out guard real, and stop claiming unverified fixes ([2ad23e7](https://github.com/xtrm-dev/xtrm/commit/2ad23e7f1af9cf0b480c0b11944a985dd3113a9c))
- Sb UX findings from operator acceptance of PR #199 ([f02afea](https://github.com/xtrm-dev/xtrm/commit/f02afeaa239abd5c72ddcda0954d184923725d9f))
- Sb issue create applies the contract SCRUTINY; attest names the ref ([4670e8a](https://github.com/xtrm-dev/xtrm/commit/4670e8abc5e07d724556d46147ef5490b36dbd2e))
- Beads import fidelity - structurable contracts, faithful edge kinds, and a verifier that can fail (XTRM-405) ([a6fb21a](https://github.com/xtrm-dev/xtrm/commit/a6fb21a25ff0194d812d49c06696f74a0d824a40))
- Render the bounded journal view in sb issue show (XTRM-409) ([d6fd32a](https://github.com/xtrm-dev/xtrm/commit/d6fd32acb700ff8ee0cd997cb64dbfe126df99a7))
- Preserve source timestamps on Beads import via an import-shaped seam (XTRM-406) ([0c5debe](https://github.com/xtrm-dev/xtrm/commit/0c5debec1a2cdcf5aa6136f6dd14065f8409e1dc))
- Link receipts to the commit carrying their work (XTRM-415) ([6b9f0e9](https://github.com/xtrm-dev/xtrm/commit/6b9f0e9c059e77f02190aed4248cd8512360dcb6))
- Canonicalise execution identity at the write seam and derive it on append (XTRM-412, XTRM-417) ([200c5fa](https://github.com/xtrm-dev/xtrm/commit/200c5fac6163c140204af0932470008f09528e8b))
- Name the bound actors in the provenance trace human view (XTRM-411) ([1971709](https://github.com/xtrm-dev/xtrm/commit/1971709a61410e7fe8aaa2bd4991ed7363543246))
- Accept the tmux session form in identity canonicalisation (XTRM-412) ([76b8917](https://github.com/xtrm-dev/xtrm/commit/76b891739c059980f49990fc5864c9d8b071d7c2))
- Let journal append derive ambient identity instead of shadowing it (XTRM-417) ([fb34ecf](https://github.com/xtrm-dev/xtrm/commit/fb34ecf91f9ed7a4af4491ec1056ab04529dbe1f))
- Finish the XTRM-414 withdrawal wording (claim.ts header, normalize key comment) ([e2bbb66](https://github.com/xtrm-dev/xtrm/commit/e2bbb66eab307ffc6bdc7a2924e144fcc4595129))
- Remove last live workspace-lease implications (XTRM-414) ([9df45c3](https://github.com/xtrm-dev/xtrm/commit/9df45c3aa3033219472e0cb5d1aa33d3750e280e))
- Carry summarizer usage in the Pi compaction result (XTRM-440) (#217) ([641f30b](https://github.com/xtrm-dev/xtrm/commit/641f30b9186ff43057b34a2a1753a84c864c0b5d))
- Carry ambient identity through integration journal envelopes (XTRM-435) (#221) ([e2c7a39](https://github.com/xtrm-dev/xtrm/commit/e2c7a398e5f947be90a0aad6d8a9fb689a0e049a))
- Close identity and session precedence follow-ups (#222) ([3f3e3cb](https://github.com/xtrm-dev/xtrm/commit/3f3e3cbfbbd03de8fc0926599d6797f4b7eab79f))
- Declare the shipped plugin version so installs can refresh (#235) ([4240bb0](https://github.com/xtrm-dev/xtrm/commit/4240bb0c94e1922ab9c6316f6aa68a1947bf14a1))

### Project maintenance
- Use canonical session ids in the XTRM-410 read tests (XTRM-412) ([e69a4a2](https://github.com/xtrm-dev/xtrm/commit/e69a4a2906de15687b316235b37b44afc0d6ccc3))
- Prove explicit absence on flagless journal append (XTRM-417) ([ac09485](https://github.com/xtrm-dev/xtrm/commit/ac094852fae3ddf37e124eb4a68981013bbb9800))
- Refresh identity and provenance operator guidance (#223) ([986324c](https://github.com/xtrm-dev/xtrm/commit/986324c6294041a14d23059e5bf5bdb72addc2f9))
- Fence the job-identity shape out of the session column (#224) ([bfab245](https://github.com/xtrm-dev/xtrm/commit/bfab24521f3e5cf2e574e9974b7325edae4f9b7d))
