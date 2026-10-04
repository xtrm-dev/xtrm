# XTRM-556 REPORT — service-knowledge hook cost

**PR:** https://github.com/xtrm-dev/xtrm/pull/277
**Report location:** packages/service-knowledge/reports/XTRM-556-REPORT.md
**Branch:** `xt/xtrm-556` → `main`
**Base commit:** `71caa940` (`feat(xtrm-app): Agent half acceptance against a real host (XTRM-601)`)
**Head commit:** `6bcd639e` (round 2, after independent execution review)
**Author of record:** `pi/xtrm-556`

---

## 1. Summary

The two service-knowledge Claude Code hooks cost ~178 ms per tool call, each spawning a
fresh `python3`. They are now registered through a pre-filter that decides in `sh` + `awk`
and `exec`s the real hook only when the payload can actually touch a registered territory.

| hook | out-of-territory before | out-of-territory after | reduction |
|---|---|---|---|
| `skill_activator.py` | 132.14 ms | **19.78 ms** | **−85 %** |
| `drift_detector.py` | 117.57 ms | **22.64 ms** | **−81 %** |

Host-load caveat and the unloaded figures are in §5. Output is byte-identical: **110/110**
golden comparisons, **1200** randomised fuzz comparisons, zero violations.

---

## 2. The constraint that decided the design

The contract suggested an early exit before heavy imports. That cannot reach the budget.
Measured on this host (`nice -n 19`, load ~8):

| measurement | mean |
|---|---|
| `python3 -c pass` | 46.1 ms |
| `python3 -S -c pass` | 14.6 ms |
| `python3 -S -c "import json"` | 31.5 ms |
| `awk` no-op | 2.0 ms |

Interpreter startup plus the `json` import is ~31 ms — already over the 20 ms budget before
any hook logic runs. **Any fix that still spawns `python3` per call inherits that floor**, so
the only way to meet the contract is to not spawn `python3` on the common path. Hence the
awk pre-filter rather than a Python early exit.

This is the same conclusion core#678 reached for the core hooks, reached independently here;
no dispatcher work is duplicated (see §7).

---

## 3. What changed

| file | change |
|---|---|
| `scripts/hook_prefilter.sh` | **new.** `sh` + `awk` pre-filter; ports `match_territory` and the drift path check. |
| `scripts/build_territory_index.py` | **new.** mtime/content-keyed index of registry territory patterns. |
| `scripts/cataloger.py` | refreshes the index once per session (SessionStart), in a silent try/except. |
| `cli/common.py` | registers the pre-filter form for PreToolUse/PostToolUse. |
| `install/settings.json` | packaged hook template matches. |
| `tests/test_hook_prefilter_equivalence.py` | **new.** golden stdout equivalence. |
| `tests/bench_hook_prefilter.py` | **new.** N=50 replay harness (core#678 method). |

Delivered through the package and the normal install/update path. No live
`~/.claude/settings.json` and no installed `.xtrm` copy on the host was modified.

### Design

The pre-filter answers exactly one question — *can this payload touch a registered
territory?* — and exits 0 on a proven no, which is precisely what the hook itself would do
at the end of its `if not match: sys.exit(0)`.

It is **fail-safe by construction**: it may exit 0 *only* when it can prove no territory
matches. Everything else hands the untouched payload to the real hook:

- **Bash payloads** always defer — the activator matches on `command` and owns the `sp`/`bd`
  dispatch and contract-promotion gates.
- **`[...]` character-class patterns** return "undecided" rather than being approximated.
- **Missing, empty, or older-than-registry index** falls through to today's behaviour.
- **No `awk` on the host** falls through.
- **Payload with no path** (Glob/Grep/Task) is a *provable* no-op for both hooks, so it exits
  without spawning: the activator feeds that value only into `if file_path:` so `match` stays
  `None`, and `check-hook` reads `tool_input.file_path` and nothing else.

A stale index costs the hook its fast path, never its correctness.

---

## 4. Output equivalence evidence

`tests/test_hook_prefilter_equivalence.py` runs each payload twice — once through the
unmodified hook (the oracle) and once through the pre-filter — and compares stdout
byte-for-byte.

**Result: `compared: 110   skipped: 0   failures: 0`**

That is 17 payloads × 3 index states (`fresh`, `absent`, `stale`) × 2 hooks, plus 8
malformed/empty-stdin cases. Coverage:

- in-territory: `**` prefix, plain-prefix, and a root-level glob (`*.tsx`)
- out-of-territory inside and **outside** the project root (`/etc/passwd`)
- similar-prefix traps (`packages/core/srcX/a.py` — must not match `packages/core/src/**`)
- Bash: read, mutating (`rm -rf`), and `sp ... --bead` dispatch
- Glob/Grep with `pattern` but no `file_path`
- notebook paths
- character-class patterns (in- and out-of-territory)
- **a drift case** — Edit into registered territory must still emit `[Skill Sync]: ...`
- malformed JSON, empty stdin, `{}`, and `{"tool_name":"Read"}`

**Randomised safety fuzz:** 1200 comparisons over generated payloads and path shapes across
`Read/Write/Edit/Glob/Grep/Bash/NotebookEdit/NotebookRead/Task/MultiEdit` —
**zero** cases where the filter skipped a payload the hook acted on.

**Existing suite:** 83/83 pass.

---

## 5. Measurement

Method follows core#678's N=50 replay (`scripts/hook-bench`), run under `nice -n 19`,
1050 calls per side. One deliberate deviation: before/after are **interleaved on the same
fixture and the same payload loop**, alternating which side runs first each iteration. This
host's load drifts by minutes at a time (observed 8 → 41 during this task), so a sequential
before-then-after pair is not comparable.

### Contended host — load ~28–32 (run at 09:33Z)

| hook | side | out-of-territory mean | out-of-territory min | p95 (all) | drift-edit mean |
|---|---|---|---|---|---|
| `skill_activator.py` | before | 132.14 ms | 62.58 ms | 340.64 ms | 275.88 ms |
| `skill_activator.py` | **after** | **19.78 ms** | **8.20 ms** | 360.25 ms | 284.39 ms |
| `drift_detector.py` | before | 117.57 ms | 50.89 ms | 266.16 ms | 110.82 ms |
| `drift_detector.py` | **after** | **22.64 ms** | **7.94 ms** | 151.93 ms | 131.31 ms |

**This host is abnormally loaded by another tenant.** The "before" figures (132 ms / 118 ms)
are themselves ~1.3–1.5× the 101.3 ms / 76.8 ms that core#678 measured on the Mercury
production host, which confirms the contention rather than a regression in this change.

The **minimum** column is the best available estimator of unloaded cost, because a sample
taken in a scheduler gap is the one least distorted by contention:

- `skill_activator.py`: **62.58 ms → 8.20 ms** (−87 %)
- `drift_detector.py`: **50.89 ms → 7.94 ms** (−84 %)

### Calm host — load ~8 (run at 08:34Z)

| hook | before mean | after mean | before p95 | after p95 |
|---|---|---|---|---|
| `skill_activator.py` | 91.97 ms | **11.99 ms** | 141.15 ms | **18.00 ms** |
| `drift_detector.py` | 65.55 ms | **11.18 ms** | 85.36 ms | **17.60 ms** |

Both inside the 20 ms mean / 40 ms p95 budget. This run predates the two follow-up commits
(the no-path fast path and the `cat`-drain fix), so it is **conservative** for the shipped
code — those changes only remove work from the after side. The minimum column above is from
the final code.

### Honest statement of the budget

- On a normally-loaded host the budget is **met with margin** (11–12 ms mean, 18 ms p95).
- On this host *while another tenant held load ~30*, `skill_activator` lands at 19.78 ms
  (inside) and `drift_detector` at 22.64 ms (marginally outside). The residual is kernel and
  scheduler cost for two small processes, not hook logic — it scales with contention and
  vanishes in the minimum column (8.20 / 7.94 ms).
- The **relative** reduction is stable across every load condition measured: 81–87 %.

### Paths that intentionally still spawn python

`Bash` (~165 ms after, vs ~141 ms before under contention) and in-territory / drift payloads
still run the real hook and pay the pre-filter's ~2 ms on top. This is the deliberate
fail-safe: Bash carries the dispatch and promotion gates, which must never be skipped. Under
contention the Bash delta is within noise; on a calm host it is a bounded ~2 ms.

`Glob`/`Grep` did improve substantially (128 → 21 ms) once the no-path fast path was added.

---

## 6. Two bugs the tests caught

Recorded because both were silent.

1. **`mawk`'s `index()` takes no start offset** (unlike `gawk`). A differential test of the
   awk matcher against Python's `match_territory` across 20 patterns × 22 paths caught it.
   It would have broken on every Debian-family host, including production.

2. **The fall-through paths ran `cat >/dev/null` before `exec python3`.** That drains stdin
   and hands the hook EOF — and the hook treats unreadable input as a silent no-op — turning
   *every* undecided case into a skipped hook. It survived the first version of the golden
   test because every fixture had a fresh index; the test now runs all payloads in all three
   index states, and re-introducing the bug fails it loudly.

A deliberate mutation check confirms the suite has teeth: forcing the filter to always skip
fails with real diffs. (One mutation — loosening the absolute-path root check — is *not*
detectable by stdout comparison, and correctly so: the hook re-validates the root itself and
exits 0 either way. That is a performance change, not a correctness one.)

---

## 7. Coordination with core#678

No dispatcher work is duplicated. core#678's `dispatch.mjs` is a node dispatcher for the
**core** hooks; it does not cover service-knowledge. This change is confined to the
service-knowledge package's own hook registration in `cli/common.py`, which the core
dispatcher does not own. The two compose: if a future change folds service-knowledge into the
core dispatcher, `hook_prefilter.sh` becomes redundant rather than wrong.

The bench reuses core#678's N=50 replay method and its host-safety rules (`nice -n 19`,
never mutate the live settings or hook tree).

---

## 8. Scope compliance

- ✅ Base is freshly fetched `origin/main` (`71caa940`); branch rebased onto it.
- ✅ No `git stash` used.
- ✅ Smallest change meeting the budget: awk pre-filter + mtime-keyed index, as the contract
  suggested. Dispatcher integration was **not** taken and core#678 is not duplicated.
- ✅ Output equivalence proven for in-territory, out-of-territory and drift cases.
- ✅ Measured with the N=50 replay method under `nice -n 19`; mean and p95 reported before
  and after.
- ✅ No edit to `~/.claude/settings.json` or any installed `.xtrm` copy on the host —
  delivered through the package and installer; the vendor/wire path was verified in a scratch
  repo at `/tmp/instrepo`.
- ✅ No heavy work in 20:00–23:00Z. Task ran 08:12–09:35Z, well clear of that window and of
  Mon 07:30–09:30Z. All benchmarks ran `nice -n 19`.
- ✅ PR opened against `main`; **not merged** — an independent execution review gates it.

---

## 9. Verification commands

```bash
cd packages/service-knowledge

# Output equivalence (110 comparisons)
python3 tests/test_hook_prefilter_equivalence.py

# Existing suite
python3 -m pytest src/service_knowledge/dispatch/tests/ tests/ -q

# Cost measurement — always nice, interleaved A/B
nice -n 19 python3 tests/bench_hook_prefilter.py --n 50 --json /tmp/bench.json
```

## 10. Known limitations

- Character-class territory patterns (`[abc]`) force a fall-through to python for the whole
  payload set. Correct, but those repos keep today's cost.
- A registry whose every pattern begins with a wildcard and contains `/` (e.g. `*/src/x`)
  also forces fall-through — full glob semantics are not reimplemented in awk.
- The cataloger's index refresh is wrapped in a silent `try/except`; a persistent failure
  degrades to the pre-fix cost with no signal. Worth a log line if it ever proves common.
- Absolute budget compliance under heavy multi-tenant contention is not guaranteed; see §5.

---

## 11. Round 2 — independent execution review (FAIL at `951f278f`)

The review was correct on all six findings. The uniform root cause: the pre-filter made a
**positive** decision ("no territory") from input it had not verified, so every unverified
input silently skipped hook output — a contract violation.

Fixed at `6bcd639e`. Every finding was first reproduced as a failing test.

| # | Finding | Fix |
|---|---|---|
| 1 | raw-text JSON extraction suppressed escaped / newline-separated / repeated keys | strict `extract()`: key exactly once, plain `"k": "v"`, no escapes; ambiguous ⇒ defer, plus a backslash guard |
| 2 | `//`, unset root, symlinked root, trailing-slash root dropped hits | all defer; trailing slashes stripped to match `pathlib` |
| 3 | fresh mtime with a bad body trusted; freshness mtime-only | sentinel (registry path + byte size + pattern count + end marker); size-keyed freshness; `SERVICE_REGISTRY_PATH` defers |
| 4 | `exec` skipped the EXIT trap, leaving 0664 payload files at a predictable path | temp file removed entirely; payload held in a shell variable |
| 5 | wheel missing `*.sh`; missing pre-filter exited 0 and disabled both hooks | `scripts/*.sh` added; registered command now falls through to python |
| 6 | template timeout 10 → 10000 | restored to 10 |

### One finding only partly reproduced

For #5, building a wheel with the `scripts/*.sh` glob deleted still shipped
`hook_prefilter.sh` — setuptools' `include-package-data` defaults to true and picks up
VCS-tracked files. The glob is still correct to add (it stops the script depending on VCS
tracking), but it was not fixing an observable break on this build config. The **second
half was a real bug**: the registered command exited 0 when the pre-filter was missing,
disabling both hooks including the Write/Edit blocking gate. That is fixed and tested.

Also flagged rather than silently changed: `cli/common.py` carries `timeout: 10000` on
`origin/main` already, which Claude Code reads as seconds (~2.8 h). Left untouched with a
comment, since changing it would alter what `wire_hooks` installs. The template's `10` is
therefore cosmetic for CLI-wired repos. Worth a separate issue.

### A bug the review did not name, found by the widened fuzz

`pathlib` strips a trailing slash and `fnmatch` `*` crosses `/`, so `a/b/x.tsx/` matches
`*.tsx`. The pre-filter kept the slash and missed it. Fixed; three payloads cover it.

### Evidence after the fixes

- Equivalence suite: **110 → 547 comparisons**, all byte-identical stdout
  (25 payloads × 9 index states × 2 hooks, 5 raw payload shapes, 8 malformed-stdin cases,
  plus temp-residue, missing-pre-filter and 5 root-resolution cases).
- Widened fuzz: **8000 comparisons**, 3-service registry with `**`, root globs, `?` globs
  and nested `**` patterns, injecting trailing slashes and `.` / `..` / `//` segments —
  **zero** violations.
- 83 existing package tests pass.

Mutation-checked — each of these makes the suite fail:

| mutation | failures |
|---|---|
| drop the `//` path guard | 4 |
| drop the registry-size freshness check | 4 |
| drop the sentinel / pattern-count check | 5 |
| drop both backslash guards | 2 |
| reintroduce a payload temp file | 1 |
| restore `|| exit 0` on missing pre-filter | 1 |

Two first attempts at mutation testing passed when they should have failed: one was a
malformed mutation that only produced an awk syntax error, and the registry-size case was
uncovered because no payload was simultaneously in the new registry and absent from the
stale index. Both gaps are now closed.

### Cost after the fixes (N=50, core#678 method, `nice -n 19`, interleaved A/B)

| host load | hook | before mean | after mean | before p95 | after p95 |
|---|---|---|---|---|---|
| 12–17 | skill_activator | 99.06 | **16.40** | 135.85 | **27.89** |
| 12–17 | drift_detector | 86.30 | **17.60** | 141.38 | **29.48** |
| 20–26 | skill_activator | 117.55 | **18.17** | 211.09 | **37.99** |
| 20–26 | drift_detector | 74.38 | **15.48** | 110.05 | **24.71** |
| 21–29 | skill_activator | 145.02 | 24.01 | 283.15 | 56.47 |
| 21–29 | drift_detector | 92.81 | **19.54** | 150.34 | 40.78 |

Budget (≤20 ms mean, ≤40 ms p95) is met at load ≤ ~26 and **missed at load 21–29** for
`skill_activator` (24.01 ms, p95 56.47). Reported rather than smoothed: the absolute floor
is ~8.8 ms and the residual is scheduler cost for the shell and awk processes, so the
out-of-territory cost scales with contention even though the hook logic is gone. Needs
confirming on the Mercury production host rather than here.

### Local test command (no PR CI on this package)

```
cd packages/service-knowledge
python3 tests/test_hook_prefilter_equivalence.py            # compared: 547  skipped: 0  failures: 0
python3 -m pytest src/service_knowledge/dispatch/tests/ tests/ -q   # 83 passed in 12.33s
sh -n src/service_knowledge/scripts/hook_prefilter.sh              # syntax ok
```
