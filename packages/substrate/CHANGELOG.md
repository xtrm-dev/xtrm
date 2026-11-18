# Changelog

All notable changes to `@jaggerxtrm/substrate` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [0.4.0] - 2026-11-18

### Operator notes
- **Migration 17 (`dispatcher-identity`) is forward-only for older clients.** `sb` 0.3.3 and earlier refuse a store at migration 17 (`fail-closed: unknown migration version 17 in database`). Upgrade every `sb` that opens the store before the first 0.4.0 binary opens it.
- **Rollback is the pre-upgrade backup.** Before the first 0.4.0 `sb` opens the canonical store, take a consistent copy (`VACUUM INTO '<backup>.db'` on a read-only connection) and record its path and size. To roll back, stop every `sb` user, restore that file as the store, and reinstall `sb` 0.3.3. Bindings written after the upgrade are not in the backup. Do not delete migration rows or edit the ledger by hand.

### Added
- Bounded external-binding read and Jira bind verb (XTRM-814) (#418) ([a7920ab](https://github.com/xtrm-dev/xtrm/commit/a7920ab953618c87954b8d0e1bdff906d07385a5))
- Dispatcher participant and session on the provenance dispatch binding (XTRM-839) ([98e92cc](https://github.com/xtrm-dev/xtrm/commit/98e92ccc96c345c98f5c6d191f83493db51dec10))

### Fixed
- Journal paging header never claims an unproven capability (XTRM-798) (#399) ([4eab32a](https://github.com/xtrm-dev/xtrm/commit/4eab32a9e63735f61fbd77652c0b6a9e49577d32))
- Normalise prose validation/output on create/edit (XTRM-786) (#398) ([ac45004](https://github.com/xtrm-dev/xtrm/commit/ac4500466e7cfbb7b92bbd7c134c5fc06181eb03))
- Correct the sqlite neutral-import rationale comment (XTRM-789) (#401) ([ed4fe5a](https://github.com/xtrm-dev/xtrm/commit/ed4fe5a517d7e4092190c17bae0e33bb4d66e17d))
- Render journal evidence from what the row holds (XTRM-420) (#404) ([b84e8ec](https://github.com/xtrm-dev/xtrm/commit/b84e8ec996cd6158acfdc56c956b55ace1b5b0aa))
- Degrade per row at the row→entry seam (ADR-009) (#410) ([7b7afd3](https://github.com/xtrm-dev/xtrm/commit/7b7afd38b679532748c59773a5e6ace3304027f6))
- Human journal show renders result evidence; test and cache hygiene (XTRM-832) (#415) ([8da35e7](https://github.com/xtrm-dev/xtrm/commit/8da35e75bf60c2256e6a109d6f774f64c363e901))
- Store a result envelope from a file as fields, not as escaped JSON (XTRM-835) (#416) ([59984f5](https://github.com/xtrm-dev/xtrm/commit/59984f53eecffed35a110f060f9920686d99d217))

### Other changes
- Teach the sb routine (XTRM-799) (#400) ([aa2b607](https://github.com/xtrm-dev/xtrm/commit/aa2b607df54ccb8f318234e39341e61176cadc3b))

### Performance

### Project maintenance
- Strip only the node:sqlite startup warning on Node 25 (XTRM-824) (#406) ([018e46a](https://github.com/xtrm-dev/xtrm/commit/018e46a672b64a6e196ed26faae6c01ec19e5669))

## [0.3.3] - 2026-11-13

### Added
- P1 domain + SQLite kernel (xtrm-7wc.2) (#123) ([ef51f05](https://github.com/xtrm-dev/xtrm/commit/ef51f05a220809d2c21461ea1c609dcebc9fb7c0))
- P10 GitHub/Jira projections + sync model (xtrm-7wc.11) (#124) ([16ba555](https://github.com/xtrm-dev/xtrm/commit/16ba555c5ffcd25d79b146072e0a886a1323eb87))
- P2 readiness + atomic planning (xtrm-7wc.3) (#125) ([0c725d9](https://github.com/xtrm-dev/xtrm/commit/0c725d94c8e1b71622ef27e7b21605db25a6cb81))
- P3 claims + workspace leases (xtrm-7wc.4) (#126) ([5085ac2](https://github.com/xtrm-dev/xtrm/commit/5085ac265172586598dd2b15f2667c594e123685))
- P4 sb CLI vertical over typed service (xtrm-7wc.5) (#127) ([284c0d8](https://github.com/xtrm-dev/xtrm/commit/284c0d86ba729a0ee27c2e2079080a0e66702725))
- P5 journal + resume capsules (xtrm-7wc.6) (#128) ([037691b](https://github.com/xtrm-dev/xtrm/commit/037691ba443a47201faa6e9259582305fdb65d3b))
- P7 Claude native integration (xtrm-7wc.8) (#129) ([3030450](https://github.com/xtrm-dev/xtrm/commit/30304505f71f50aa1cca1792d34368c440e075f3))
- P6 Pi native integration (xtrm-7wc.7) (#131) ([91a285c](https://github.com/xtrm-dev/xtrm/commit/91a285cab3739b7762ffaa2332b6967ac2c92200))
- P8 provenance + git adapters + bundles (xtrm-7wc.9) (#132) ([c1e4cba](https://github.com/xtrm-dev/xtrm/commit/c1e4cbafe91aa848899983d9d8faa51148a1d46b))
- P9 Specialists gate + WorkItemStore seam (xtrm-7wc.10) (#133) ([46d028f](https://github.com/xtrm-dev/xtrm/commit/46d028fa2a78cf0246599bb39fe84e39585881c4))
- P11 Beads migration + instruction cutover (xtrm-7wc.12) (#134) ([0e180fc](https://github.com/xtrm-dev/xtrm/commit/0e180fc21beaff0d685c5eefa486635abcbc8f52))
- Issue attest + project create CLI verbs (xtrm-7wc.5.1) (#137) ([4faf26e](https://github.com/xtrm-dev/xtrm/commit/4faf26e0889993121a04b7692abdc95cbd40e513))
- Machine ID in JSON issue summaries (xtrm-7wc.5.2) (#139) ([eaa31e0](https://github.com/xtrm-dev/xtrm/commit/eaa31e05d40df6e4006e9637f5b3b46d720ffc4c))
- Journal show returns entry bodies (xtrm-7wc.6.2) (#140) ([27615ca](https://github.com/xtrm-dev/xtrm/commit/27615caf72de17319e7f447b82fbadd86008c170))
- Cwd-aware project resolution (xtrm-7wc.5.6) (#146) ([a1824ff](https://github.com/xtrm-dev/xtrm/commit/a1824ff84e3b706b3a92e88c431da2f2c824033d))
- One state.db authority (xtrm-iip.2) (#148) ([b8fefc1](https://github.com/xtrm-dev/xtrm/commit/b8fefc1873a6c3da361c268cc044ac5da0f79da9))
- MCP server on SDK v2, strict 2026-07-28 (xtrm-iip.3) (#149) ([eade9c3](https://github.com/xtrm-dev/xtrm/commit/eade9c3602b7a9bdd57231c550de9547446476d9))
- Full MCP tool surface (xtrm-iip.4) (#150) ([2acac0b](https://github.com/xtrm-dev/xtrm/commit/2acac0b6065670183490524c644bd1a4d16d7651))
- Claude native plugin packaging (xtrm-iip.1) (#152) ([cef47a3](https://github.com/xtrm-dev/xtrm/commit/cef47a385d3197fe7495d1f74ae10c1c8f72fa16))
- Native wake/event shims (xtrm-iip.6) (#153) ([2ea27f9](https://github.com/xtrm-dev/xtrm/commit/2ea27f9f5188ebe3980d271390c001c17185fb93))
- SessionStart warns on unmet MCP precondition (xtrm-iip.11) (#156) ([634730f](https://github.com/xtrm-dev/xtrm/commit/634730fd28f3074f2d9e7162b595c7868bb46eb8))
- Converge issue-ref env names (xtrm-iip.9) (#158) ([4563812](https://github.com/xtrm-dev/xtrm/commit/4563812f397ae16001b474d775a39dbdec5c90c9))
- Issue show returns the contract body (xtrm-7wc.5.9) (#161) ([984b7e6](https://github.com/xtrm-dev/xtrm/commit/984b7e6239795315e42fc27473fa6e110dfcf28d))
- Add help, version, and doctor surfaces (xtrm-6qu.2) (#163) ([858204d](https://github.com/xtrm-dev/xtrm/commit/858204dcfe3382be84de303e9a350aa16b432758))
- Add journal and lifecycle CLI surfaces (xtrm-6qu.1) (#164) ([6bfc87b](https://github.com/xtrm-dev/xtrm/commit/6bfc87bf278a9276bfd1877c9d351065dbede217))
- Replace Beads hooks with native gates (xtrm-6qu.6) (#168) ([e91ba4c](https://github.com/xtrm-dev/xtrm/commit/e91ba4ce2ce440cc69586b625319193808dc8d6e))
- Local private install + native enrollment contract (xtrm-6qu.13) (#174) ([30a8116](https://github.com/xtrm-dev/xtrm/commit/30a811618c8b6ec7a4add787936f1d83237c3d61))
- One-way Beads import receipts v3 with verifier verdict (xtrm-6qu.9.1) ([43715b9](https://github.com/xtrm-dev/xtrm/commit/43715b9b2a902ef8ca39b9eb9d4851f59cacdeb2))
- Repository identity and binding kernel (XTRM-252.1) ([18da9ff](https://github.com/xtrm-dev/xtrm/commit/18da9ff3467ed23221bf7954649475527fb0bab6))
- Sb init and fail-closed repository-relative resolution (XTRM-252.2) ([e631d8c](https://github.com/xtrm-dev/xtrm/commit/e631d8ceb4ca8888eae5218c0658332c4fd40dbb))
- Journal result kind, bounded payload, latest/timeline reads and capsule results (XTRM-252.5) ([0737d6c](https://github.com/xtrm-dev/xtrm/commit/0737d6c1f24e3981ce943fbdbb214586f08fd337))
- Version journal result payloads (XTRM-339) ([b19baac](https://github.com/xtrm-dev/xtrm/commit/b19baaced9bbd4530b2f3fc871bc80c7c2060343))
- Shared versioned ExecutionContext and automatic enrichment (XTRM-252.6) ([3dcefd5](https://github.com/xtrm-dev/xtrm/commit/3dcefd5134e8946d570aa9d7f648a9c25c2372a3))
- First-class Closure with outcomes, reopen and failure history (XTRM-252.7) ([700c4d1](https://github.com/xtrm-dev/xtrm/commit/700c4d122085a1c99a3d1baf8c09eb74de2a853e))
- Provenance queries, projection policy and inbound external input (XTRM-252.9) ([c400049](https://github.com/xtrm-dev/xtrm/commit/c40004911ee0a25abb846fdddb584c45dc0962e2))
- Hook and stop-gate continuity against Journal and Closure (XTRM-252.13) ([f014468](https://github.com/xtrm-dev/xtrm/commit/f0144685f667d85a21f3dc163d1514f46a40181c))
- Finalize MCP, CLI help and docstring instruction surfaces (XTRM-252.10) ([efef2b3](https://github.com/xtrm-dev/xtrm/commit/efef2b3c1ea5d3c7bfb9812894fe9050f4336ab8))
- Bounded board read model — listing and readiness without a query per issue (XTRM-393) (#247) ([5e1895b](https://github.com/xtrm-dev/xtrm/commit/5e1895bd2048303f64635b43be4caaa31d806c5c))
- SessionStart XTRM primer from the global using-xtrm and multiplexing skills (XTRM-637) (#287) ([506b62f](https://github.com/xtrm-dev/xtrm/commit/506b62f3473259b622ae429633d5d9f51e70ad7d))
- GitHub marketplace for the Claude plugin with version-driven updates (XTRM-640) (#288) ([16c1d9f](https://github.com/xtrm-dev/xtrm/commit/16c1d9f1c43c14422ff1f0bd7015f844bc81a872))
- Primer names the dispatcher and the Substrate participant (CORE-2390) (#289) ([80516e9](https://github.com/xtrm-dev/xtrm/commit/80516e9f55716d1037aaae8912bb7b12acc47977))
- Full-height sidebar, flat main viewport, Issues table with journal activity (XTRM-686) (#305) ([ac7f344](https://github.com/xtrm-dev/xtrm/commit/ac7f34442c0257f9618b60566647e6484c5fb578))
- Remote store access over ssh for the CLI and git hooks (XTRM-685) (#307) ([2d33ec7](https://github.com/xtrm-dev/xtrm/commit/2d33ec76bc78e73fe67e393e4a0d70eefb41371e))
- The Pi tools reach the store through the typed service (XTRM-691) (#322) ([8ff21b7](https://github.com/xtrm-dev/xtrm/commit/8ff21b7e4f3f1570880769c4c53fc7a284df3c30))
- The Claude plugin picks its store at launch (XTRM-692) (#325) ([7ce172b](https://github.com/xtrm-dev/xtrm/commit/7ce172b2cece5cc300348120136075b717f6baa2))
- Append issue trailers without a receipt (XTRM-684) (#380) ([a0165d2](https://github.com/xtrm-dev/xtrm/commit/a0165d2b5df7a8c1ce7eb5d4ba4dd5319f23ae54))
- Generate CHANGELOG via git-cliff preversion hook (XTRM-748) (#385) ([fd0ab6a](https://github.com/xtrm-dev/xtrm/commit/fd0ab6afc590900cb529f0dfebc88ecac87bab82))
- Sb journal feed, paged project-wide journal read (XTRM-764) (#390) ([dd8ccf7](https://github.com/xtrm-dev/xtrm/commit/dd8ccf7cf1efa27ecd67febbe8e31485a848b121))
- Publish the full PR field set from primaryPrFor (XTRM-767) (#392) ([a9d55cc](https://github.com/xtrm-dev/xtrm/commit/a9d55cc80fbaac31ac157426fde71c404eebf448))

### Fixed
- RenderCapsule emits semantic SUMMARY (xtrm-7wc.6.1) (#130) ([69fb51b](https://github.com/xtrm-dev/xtrm/commit/69fb51bad5308ca5db5c1d2823d22e52b760ded3))
- Annotate Pi extension callbacks (xtrm-qvt) (#135) ([62b36f7](https://github.com/xtrm-dev/xtrm/commit/62b36f7a9349f4bbce227684a540a982e57b24f0))
- Human tree renderer walks children (xtrm-7wc.5.3) (#138) ([5d80368](https://github.com/xtrm-dev/xtrm/commit/5d80368bd54bd6fff7d7d81a41c6c51d87f738dc))
- Fail closed on unknown CLI flags (xtrm-7wc.5.4) (#142) ([7595083](https://github.com/xtrm-dev/xtrm/commit/759508340f3ddecbbc56a9a3b539b727d418731b))
- Validate MCP tool name before opening handles (xtrm-7wc.8.1) (#143) ([13f9275](https://github.com/xtrm-dev/xtrm/commit/13f92758a048a7595ed59301ad6aeb52a273d1cf))
- Linked sb bin enters main (xtrm-7wc.5.5) (#144) ([9046357](https://github.com/xtrm-dev/xtrm/commit/9046357aa95da1c3fbce41182e7717bd5d73210f))
- Empty human list prints a marker (xtrm-7wc.5.7) (#147) ([96b0c2a](https://github.com/xtrm-dev/xtrm/commit/96b0c2a03c77a5b3931fe689b78cd97c607c32c9))
- Drop redundant hooks declaration (xtrm-iip.10) (#155) ([eba4b2b](https://github.com/xtrm-dev/xtrm/commit/eba4b2b2105544e3189fa94898fd8fbd0562d2d9))
- Declare monitors + namespace the skill gate (xtrm-iip.12) (#157) ([b3bac3c](https://github.com/xtrm-dev/xtrm/commit/b3bac3cddf179929c94a7caea25087f9b4e5cd04))
- Matcher-free precondition entry + equality (xtrm-iip.14) (#160) ([a47793c](https://github.com/xtrm-dev/xtrm/commit/a47793cbad9d3ca9a61610cee3143476a3916ee5))
- Support Bun and Node SQLite runtimes (xtrm-6qu.7.4) (#172) ([f8b2ebf](https://github.com/xtrm-dev/xtrm/commit/f8b2ebf470b8c46120dd992660e3aaeb691262dd))
- Give @jaggerxtrm/substrate an entry point (#183) ([cd682f6](https://github.com/xtrm-dev/xtrm/commit/cd682f65ede2174a3eeb4c3a3732d64a19fa7795))
- Resolve by repository, faithful Beads import, release 0.1.2 (#184) ([fe2b5a0](https://github.com/xtrm-dev/xtrm/commit/fe2b5a0fa58ba0fa749e92e46c54e852362f53fb))
- Flush piped stdout before exit and tolerate EPIPE (XTRM-331) ([f6f8dbf](https://github.com/xtrm-dev/xtrm/commit/f6f8dbfa1e7c910e49573f32ed8e3508977ac0f3))
- Scope MCP journal writes and refresh resolver comments (XTRM-252.2) ([01e776f](https://github.com/xtrm-dev/xtrm/commit/01e776fd6d7cb607cf853965a8c06ccabf656047))
- Drain every entrypoint write before exit (XTRM-335) ([01f43cf](https://github.com/xtrm-dev/xtrm/commit/01f43cf0c526810b551864a3677b3b7b37c075ed))
- Persist the reopen actor instead of dropping it (XTRM-252.7 review) ([1953670](https://github.com/xtrm-dev/xtrm/commit/195367040d3e6eda6829ca2c201f0b5a1760c067))
- Refuse untrusted inbound content at the projection boundary (XTRM-252.9 review) ([df90d32](https://github.com/xtrm-dev/xtrm/commit/df90d323a7784411080bb1b6ac4253a24b7806b8))
- Closure-ready must require settled receipts; surface a failed stop checkpoint (XTRM-252.13 review) ([13f2090](https://github.com/xtrm-dev/xtrm/commit/13f20907ecfe2c80eed3026cf4df67e603bb9c9f))
- Dedupe journal_checkpoint label, unstick HELP_TOP journal summary, pin close usage line ([c345db8](https://github.com/xtrm-dev/xtrm/commit/c345db8a098136d74531c9db7140fb8a4d467a64))
- Sb init adopts the Project a checkout link names and never overwrites it ([62f83fb](https://github.com/xtrm-dev/xtrm/commit/62f83fba64ad1722bdb78fe3efd48e33dc6f114e))
- Accumulate repeated closure evidence flags (XTRM-552) (#249) ([9747fa0](https://github.com/xtrm-dev/xtrm/commit/9747fa0558c92eb7bc8bd7bd2ab70bfd343fd842))
- Read closure evidence refs back from issue show and provenance trace (XTRM-554) (#254) ([fef8541](https://github.com/xtrm-dev/xtrm/commit/fef8541dce3847da4f7a4b8d1d76305af8268a03))
- Emit schema-valid Claude hook output (#256) ([ecfc251](https://github.com/xtrm-dev/xtrm/commit/ecfc251d128b003927adf2121ee7e543a8f35ffa))
- OpenSubstrate creates the state dir 0700 and the DB 0600 (CORE-2381) (#304) ([e8459a8](https://github.com/xtrm-dev/xtrm/commit/e8459a8a375ab4341171260ccf895eac487a1ac8))
- Clear the inspector rail, compact table, Substrate status chips (XTRM-687) (#306) ([63639fa](https://github.com/xtrm-dev/xtrm/commit/63639fae224a0c8b29c69566d4655db2e11b09fe))
- Name the operation in an oversized-answer refusal (XTRM-690) (#319) ([2eb879e](https://github.com/xtrm-dev/xtrm/commit/2eb879e2502dcf0e260d5e1fab89d02a34a35168))
- Forward --summary-file as an uploaded file (XTRM-751) (#367) ([c19500c](https://github.com/xtrm-dev/xtrm/commit/c19500c17f2d5eeb6e96ec37bc741c57e4d1be8a))
- Name the allocate step in the no_receipt refusal (XTRM-645) (#378) ([22b7fce](https://github.com/xtrm-dev/xtrm/commit/22b7fce8fa4a6490ee13e8849667fd704c43fe84))
- List sync in sb links usage (XTRM-756) (#379) ([42efc10](https://github.com/xtrm-dev/xtrm/commit/42efc10ac624acca10a4b16c325f7b18d9bd9246))
- Mirror run= identity line in xtrm primer (XTRM-746) (#384) ([01ae1e6](https://github.com/xtrm-dev/xtrm/commit/01ae1e63ee4aa82a69d519f7970049608a75a494))
- Name allocate as missing step in no_receipt (XTRM-750) (#383) ([fe9a75a](https://github.com/xtrm-dev/xtrm/commit/fe9a75a941a53a9e0a04ea1ec3ccb9f8ffb89fad))
- Ship hooks/ in the published package (XTRM-768) (#393) ([ba29022](https://github.com/xtrm-dev/xtrm/commit/ba2902205d205dab76fb6c2d2b3e294fef82238a))

### Other changes
- [A7-auth] Fence claimed dispatch by holder + activation (xtrm-6qu.7.2) (#171) ([948e27a](https://github.com/xtrm-dev/xtrm/commit/948e27aac4c31d93fc39e3e0c9f578bb1a77c53e))
- R3 project administration surfaces (sbcloseout4 §18) ([02e43d2](https://github.com/xtrm-dev/xtrm/commit/02e43d235bb47d7ce2bf0ce0b4165c8957d12c3e))
- Align packages/ pi consumers with pi 0.85→1.0.0 (deps + host-provided fix) and redesign xtprompt (#262) ([fd01a31](https://github.com/xtrm-dev/xtrm/commit/fd01a311199609275b92b7582cb598c5f7c144a1))
- Sb serve --stdio: a typed service over ssh for in-process consumers (XTRM-690) (#309) ([264468e](https://github.com/xtrm-dev/xtrm/commit/264468e2c59f5ffbc63bcd85855b8482c04c8b13))
- Journal paging: newest-first read with a backwards cursor (XTRM-641) (#374) ([57de7aa](https://github.com/xtrm-dev/xtrm/commit/57de7aa15d7139f3a8b435214ef99bbccdbd3829))

### Performance

### Project maintenance
- PRD 12.3 claim branch + derivation test (xtrm-7wc.3.1) (#136) ([a34ac68](https://github.com/xtrm-dev/xtrm/commit/a34ac6837f450c90352bd8849f51090bba9d675d))
- Discovery-asymmetry note + .12 test rename (xtrm-iip.13) (#159) ([9bbbc2c](https://github.com/xtrm-dev/xtrm/commit/9bbbc2c5ae0b34e8ad3b96fbd0df2307643f1cf7))
- Canonical operator README + stale-doc sweep (xtrm-6qu.3) (#169) ([8c12d47](https://github.com/xtrm-dev/xtrm/commit/8c12d470a6a66fd1dac65ceb112c482b7995874d))
- Core workflow skills migration + skill-migration-gate (xtrm-6qu.4) ([14d169f](https://github.com/xtrm-dev/xtrm/commit/14d169f2275756bcb2fa45b66b03247d51b2dcb0))
- Specialist and review skills migration + gate extension (xtrm-6qu.5) ([77b32ae](https://github.com/xtrm-dev/xtrm/commit/77b32ae1f4ec87efef984a0dde23c835ed57e577))
- A10 acceptance + §57 final report (xtrm-6qu.10) ([9263f91](https://github.com/xtrm-dev/xtrm/commit/9263f917c232db266f27468f558861f86a5e5cb0))
- Rename @xtrm/substrate to @jaggerxtrm/substrate (#182) ([ca36465](https://github.com/xtrm-dev/xtrm/commit/ca36465690df81e25d8751f293479757cfbd0d15))
- Operator documentation hierarchy and anti-drift gate (XTRM-252.11) ([2758c52](https://github.com/xtrm-dev/xtrm/commit/2758c529f5e00676731ffc6cbe44ed6d8c105f1d))
- Name migrations 008-009 in the live-store snapshot suite (XTRM-252.5) ([7f71d83](https://github.com/xtrm-dev/xtrm/commit/7f71d834dc69b6dc05fe3742635451d0c2823b39))
- Make the capsule no-leak assertion a detector (XTRM-252.5) ([5c01167](https://github.com/xtrm-dev/xtrm/commit/5c011672dd8237bed2194aa4d2f8cf51998a41be))
- Decouple repository discovery from CLI (XTRM-337) ([260283b](https://github.com/xtrm-dev/xtrm/commit/260283b7c8fa6cc1850b4a123c6713d642300ce1))
- Pin edit-not-for-progress and close-outcome CLI help (XTRM-252.10 review fix) ([7dfde0c](https://github.com/xtrm-dev/xtrm/commit/7dfde0cfa4abd24f93ecf92ec28be364114da383))
- Migrate canonical skills to Substrate methodology (XTRM-252.12) ([47093d4](https://github.com/xtrm-dev/xtrm/commit/47093d47650248b37ef6c078fa9c37c540b87af4))
- Sbcloseout4 terminal acceptance and closeout (XTRM-252.14) ([e35d596](https://github.com/xtrm-dev/xtrm/commit/e35d596453e24221f3edf4f00829af108d01d8f1))
- Narrow the retired-verb window, tighten three d2 leniency spots, restate close flags, dedupe §73 ([d51e546](https://github.com/xtrm-dev/xtrm/commit/d51e54654a2e399c985acc12da9bea35ba4f5e9f))
- Harden the five A1 acceptance assertions and regenerate the receipts ([082be98](https://github.com/xtrm-dev/xtrm/commit/082be988b79e26da693ed1c20cc402b4f8dcd0c5))
- 0.2.5 — the typed service ships (XTRM-690) (#320) ([8709e0e](https://github.com/xtrm-dev/xtrm/commit/8709e0e53e85e2cb2e3571134dbbea3a7ef2107b))
- PR-open sync upserts pull_requests state (XTRM-754) (#382) ([55e160a](https://github.com/xtrm-dev/xtrm/commit/55e160ac3ad6f2d9ac73c32244a1e1f0f78aec12))

## [0.3.2] - 2026-11-12

### Added
- `sb journal show <ref> --tail <n>` returns the newest window of full bodies, and `--before <seq> --limit <n>` pages backwards from a cursor, so a journal larger than one page is fully reachable (XTRM-641).
- `journal.listEntries` accepts `before`; `journal show` accepts `--tail` and `--before`. Both are additive: `--limit` keeps its ascending meaning.

### Fixed
- `sb journal show` no longer silently drops the newest entries when a journal exceeds the limit. The truncation was an ascending `LIMIT`, which kept the oldest rows.

---

## [0.3.1] - 2026-11-11

### Fixed
- Delivery-close wording and links check help (CORE-2623 follow-up) (#365) ([d80b9cf](https://github.com/xtrm-dev/xtrm/commit/d80b9cf5cd375cd5828f95e40c0d20a894ce9e04))
- Typebox is a peer dependency the pi host supplies (XTRM-749) ([3cd06dc](https://github.com/xtrm-dev/xtrm/commit/3cd06dc6acde716b6b249982d20cf95b75a53d0e))
- Links check --json exits like text mode (XTRM-749) ([7bf758e](https://github.com/xtrm-dev/xtrm/commit/7bf758e6e4d01952efb4c884716301b562d7b7ae))
- Links help matches the code it describes (XTRM-749) ([43041ad](https://github.com/xtrm-dev/xtrm/commit/43041adeac7ad67509eab7c2f940d6c2083ff4ad))

### Project maintenance
- Links, close gate, holder default, journal limits (CORE-2623) (#364) ([a96ee0b](https://github.com/xtrm-dev/xtrm/commit/a96ee0b4a82f7ce6a37105e1ca8139628a7e5b50))

---

## [0.3.0] - 2026-11-11

> **Breaking.** `authority.remove` requires the owning `specialist` (XTRM-700, #330): an unnamed removal is refused with `bad_request` and a foreign one with `conflict`, so a service-protocol client must send it and a host that does not fails loudly on `stop()`.

### Added
- Claim and release default the holder to SUBSTRATE_HOLDER (XTRM-722) (#336) ([08e9ee9](https://github.com/xtrm-dev/xtrm/commit/08e9ee998604b2bbbdbb2a576be17eaeb73e7762))
- Issue-to-PR links — schema, read model, dry-run scan (XTRM-726) (#340) ([a7618c0](https://github.com/xtrm-dev/xtrm/commit/a7618c09592dbfc1d68c7b0a0603f5f73fcf55c3))
- PR-link writers — T1, mentions, T2 evidence, findings (XTRM-727) (#344) ([f5aee0d](https://github.com/xtrm-dev/xtrm/commit/f5aee0d288409adfa56c3fd9f8684d641d50a280))
- One journal summary limit and entry quality at the write seam (XTRM-724 A1) (#338) ([b38296d](https://github.com/xtrm-dev/xtrm/commit/b38296d1299dec9f6289e5ad00c8c4c5c1eebeef))
- One-shot PR reconciler with conditional reads (XTRM-728) (#345) ([5eeeb9b](https://github.com/xtrm-dev/xtrm/commit/5eeeb9b7de591b153763fb5b9cfc954a55285530))
- Deterministic advisory catalogue (XTRM-724 A2) (#346) ([4300683](https://github.com/xtrm-dev/xtrm/commit/4300683926f47f49c19ece25ad96e38030d24726))
- Strict CLI surface, issue renew and help groups (XTRM-738) (#348) ([a200e56](https://github.com/xtrm-dev/xtrm/commit/a200e565cdbe008f33433af3ffd5830aaaeab09d))
- Close gate joins T1/T2 and links check shows verdicts (XTRM-729) (#347) ([50e21f0](https://github.com/xtrm-dev/xtrm/commit/50e21f02abd71eb7159a39b4ad622b7c95106cdc))
- PR block, link timeline and board column (XTRM-730) (#353) ([6cbf97a](https://github.com/xtrm-dev/xtrm/commit/6cbf97a4885991369bc4da840ca84f000a2eb4dc))

### Fixed
- The Pi gate fails closed when the remote store is unreachable (XTRM-712) (#328) ([eae827d](https://github.com/xtrm-dev/xtrm/commit/eae827d8a8eaecbae9424e1ca19fd8a36844b0ea))
- Refuse the stale local store when a remote is configured (XTRM-693) (#329) ([7f5ff35](https://github.com/xtrm-dev/xtrm/commit/7f5ff355537d312708403fab9d02bfe5135192ca))
- Authority.remove requires the owning specialist (XTRM-700) (#330) ([7afbf79](https://github.com/xtrm-dev/xtrm/commit/7afbf79e383ff3be7cda90b944b190fea9583105))
- Read every XTRM-Issue trailer, not only the last (XTRM-734) (#341) ([f7135b7](https://github.com/xtrm-dev/xtrm/commit/f7135b714bbe2506239def9cd6d27dd15b94df17))
- Parse URL-form remotes in repositoryKey (XTRM-733) (#343) ([46dd2d0](https://github.com/xtrm-dev/xtrm/commit/46dd2d0bea481cda05526942cc513884f45dae10))
- A list failure names the verb the operator typed (XTRM-740) (#352) ([c745a72](https://github.com/xtrm-dev/xtrm/commit/c745a720925f84e7446bdb5bb161da5b3c8b3ccd))
- Browse dispatch and the list rewrite use one command notion (XTRM-741) (#354) ([3f76ca3](https://github.com/xtrm-dev/xtrm/commit/3f76ca38fcbd9d357a1cb9fad76c7bba7f4e9392))
- Align pi-dependent packages with pi 1.5.2 (XTRM-743) (#358) ([420f57f](https://github.com/xtrm-dev/xtrm/commit/420f57fd5a8fafe7296ccea46badc6837c2a6d59))

### Other changes
- The Pi journal tool carries the entry text (#339) ([4701efb](https://github.com/xtrm-dev/xtrm/commit/4701efbb9b52b2e69edb3a3513e595a61dea19f7))

### Performance
- One store connection per Pi session (XTRM-711) (#327) ([c375d1b](https://github.com/xtrm-dev/xtrm/commit/c375d1b5995d196196373df91ebe0ea0cdce00d9))

### Project maintenance
- README describes what actually landed (XTRM-739) (#351) ([8ab3a7d](https://github.com/xtrm-dev/xtrm/commit/8ab3a7d834397da208f7ac14993f13c5ccaed690))
- The rewrite examples use values that reach the rewrite (XTRM-741) (#355) ([7b214aa](https://github.com/xtrm-dev/xtrm/commit/7b214aae06b96e4dd6ca38771f684dc76b2bfeaa))
- Register temp dirs and remove them after the suite (CORE-2612) (#356) ([714fc4a](https://github.com/xtrm-dev/xtrm/commit/714fc4ab1d0440e9917d1a184af874c5646e56f3))

---

## [0.2.6] - 2026-11-06

### Added

- The Pi tools reach the store through the typed service (XTRM-691). Every Pi tool call and every edit/write gate goes through one call surface — the in-process service for a local store, the ssh service for a server-owned one — instead of separate paths over the database. A configured remote that cannot be reached fails closed with a transport code (`connection_lost`, `not_installed`, `protocol_mismatch`, `peer_noise`, `spawn_failed`) rather than quietly using the local store; an unset `substrate.remote` behaves exactly as before.

- The Claude plugin chooses its store at launch (XTRM-692, ADR-008). `.mcp.json` is unchanged: the entry it already names reads `substrate.remote` and either runs the local MCP server or the same script on the store-owning machine over ssh, with MCP proxied over the pipe. The hooks — SessionStart, PreCompact, PostCompact, stop gate, edit gate — follow the same decision, one short-lived forward per event. The far side announces itself with a handshake carrying its package version before any frame is forwarded, so a login-shell banner cannot corrupt the stream; anything printed before it is discarded, bounded and reported. Identity — holder, session, activation — travels as one quoted JSON argument and is applied before the server module loads, so a remote write records the caller's participant, and a checkpoint records the caller's workspace rather than the far side's checkout. The script is located in the installed package there, so the checkout only resolves the repository; a package that does not ship it is reported as `not_installed`.

  **Version equality is strict.** The plugin and the server must run the same version: a mismatch fails with `version_mismatch` naming both, by design. Upgrade the server's `sb` and the plugin together. A half-upgraded pair refuses to serve rather than recording rows against a contract it does not know.

### Fixed

- The Claude edit gate fails closed when a configured remote is unreachable: it blocks and names the transport code instead of allowing an edit with no claim check.
- A handshake line that is not JSON fails with `protocol_mismatch` rather than a stack trace, and a far side that cannot parse the identity argument says so in its handshake instead of serving with no participant.
- Every far-side argument is quoted once, so a JSON identity survives the remote shell with its quotes and spaces intact.

---

## [0.2.5] - 2026-11-06

### Added

- `sb serve --stdio`, the typed service for in-process consumers (XTRM-690, ADR-008 item 2). Newline-delimited JSON frames on stdout: `hello` first (protocol number, version, sorted capability list), then 60 named operations over issue, gate, store, journal, provenance, resume and authority. Structured operations only — no SQL, exec or query-expression verb, every argument validated, unknown operations refused by name. `authority.record`, `authority.remove` and `authority.list` are the only operations that name the `activations` table, with the columns the shipped specialists SessionStart reader already reads. The client (`createServiceClient`, `spawnLink`, `openSshService`) speaks the same protocol over a child process — `ssh -T … sb serve --stdio` for a server-owned store — and `createLocalService` runs the identical operation table in-process, so a consumer stays local when `substrate.remote` is unset. A server that does not speak the protocol is named as such, not reported as a timeout — and each transport failure has its own code (`not_installed`, `spawn_failed`, `connection_lost`, `protocol_mismatch`, `peer_noise`). When `substrate.remote` is set, a consumer fails closed and never substitutes the local store; local behaviour applies only when it is unset. `authority.list` with `{"activeOnly": true}` runs the SessionStart reader's own query so a remote client sees the rows that reader sees, and the authority states are exactly the ten the specialists host writes, read from its own union in a test. Identity travels in the operation arguments, resolved from the client's environment, so a remote write is attributed to the same actor as a local one. `journal.enrichEntry` refuses anything except a checkpoint with no semantic layer; `issue.appendEvent` accepts only the event a client has a reason to raise. A transport end is reported once, a requested timeout below the remaining budget wins, and a line that never ends is dropped and reported instead of buffered.

  Rollout order: release this package, upgrade the store-owning machine's `sb`, then land consumers. A consumer never falls back to the local store when the handshake fails — it fails closed with the code that names the failure (`not_installed`, `protocol_mismatch`, `peer_noise`, `spawn_failed`, `connection_lost`), because a silent fallback writes to a store the operator did not choose.

### Fixed

- The service protocol decodes complete frames instead of each read: a multibyte character split across a read boundary is no longer replaced by U+FFFD in a successful answer.
- A frame above the 8 MiB limit is refused and discarded instead of buffered and rescanned.
- Async operations are awaited, so `journal.checkpoint` reports its real result and a rejection cannot end a server holding the store.
- `authority.*` validates identifiers and the host's ten states, refuses a stamp far in the future, refuses to re-attribute a row to another specialist, and accepts `settled` -> `running`, which the host writes when it wakes a settled activation for another turn.
- `journal.enrichEntry` is exposed, and refuses anything but a checkpoint or compaction with no semantic layer: the precondition is part of the write, so two callers racing on one entry produce exactly one winner.
- Numeric arguments are bounded; identity in a service session comes from the frame, never from the server's environment.
- `localOrRemote()` reads the remote configuration, not only `SUBSTRATE_REMOTE`, and fails closed when a configured remote is unusable.

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
