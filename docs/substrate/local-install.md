# Substrate local install — Core A8 consumer contract (xtrm-6qu.13)

This file is the immutable interface evidence for Core A8 (`xt init` /
`xt doctor` shell-outs). It answers the five consumer questions with exact
paths, names, and commands verified against live `pi` / `claude` CLIs in
fresh temporary HOME dirs. All commands are non-interactive. No npm
publication, no visibility change, no private source leaves the checkout:
diagnostics carry only short status lines (versions, counts, names).

## 0. Source selection: `XTRM_SUBSTRATE_DIR`

The ONLY authorized local install source. It must be an **absolute** path to
a directory whose `package.json` `name` is exactly `@xtrm/substrate`.
`integrations/setup.ts` `resolveSubstrateDir()` enforces this fail-closed
(wrong name, relative path, missing dir, or incomplete layout returns an
error and `planInstall()` emits **zero** commands — failure always precedes
any mutation). Symlinked dirs are canonicalized (`realpath`) before
comparison so registry checks cannot be aliased or evaded.

Trust assumption (auditor O2/O4): setting `XTRM_SUBSTRATE_DIR` trusts that
checkout with code execution — `npm install` runs its lifecycle scripts and
`sb`/extension code runs from it. Point it only at a reviewed checkout, and
re-resolve immediately before executing emitted commands if the checkout
may have changed since planning (plan-time validation does not cover
later mutation).

Environment mapping (auditor O5): `XTRM_SUBSTRATE_DIR` selects the install
*source checkout* (this contract). `SUBSTRATE_DB` (consumed by the Pi
extension and `resolve-substrate.mjs`) selects the runtime *state file*
(canonical default `~/.xtrm/state.db`). The two are independent; neither
sets the other.

Exact layout `xt init` may assume under `$XTRM_SUBSTRATE_DIR`:

```text
package.json                              name == @xtrm/substrate
cli/sb.ts                                 sb entry (shebang + exec bit)
integrations/setup.ts                     plan/check contract (this file's owner)
integrations/pi/extension.ts              Pi extension entry
integrations/pi/handlers.ts               Pi tool implementations
plugin/substrate/.claude-plugin/plugin.json   Claude plugin (name: substrate)
.claude-plugin/marketplace.json           local marketplace (name: substrate)
node_modules/                             present only after npm install (step 1)
```

## 1. `sb` binary provision (fresh machines)

`sb` is TypeScript run on Node ≥ 24 (native type-stripping, no build step),
provisioned on PATH in two steps — both required. A global link alone leaves
runtime deps (uuid et al.) missing; source deps alone leave no PATH binary:

1. `npm --prefix "$XTRM_SUBSTRATE_DIR" ci --ignore-scripts --no-audit --no-fund`
   (deterministic from the lockfile; public registry deps only — the package
   itself is never published; `--ignore-scripts` runs no checkout code)
2. `npm install --global "$XTRM_SUBSTRATE_DIR" --ignore-scripts --no-audit --no-fund`
   (links the checkout globally; installer must have a writable global prefix)
3. `sb --version` (literal PATH binary) must exit 0.

Enrollment check `sb-enrolled` finds `sb` via PATH search, requires its
realpath to equal `$XTRM_SUBSTRATE_DIR/cli/sb.ts` (a foreign `sb` fails),
then runs `sb --version`. Node-direct invocation is not accepted as proof.

## 2. Pi enrollment (canonical local package)

`packages/substrate/package.json` carries the canonical Pi manifest:

```json
{ "keywords": ["pi-package", "pi", "substrate", "xtrm"],
  "pi": { "extensions": ["./integrations/pi/extension.ts"] } }
```

Install form (verified: registers in `~/.pi/agent/settings.json`
`packages`, visible in `pi list`):

```sh
pi install "$XTRM_SUBSTRATE_DIR" --approve
```

Enrollment check `pi-enrolled` reads `~/.pi/agent/settings.json` and
accepts absolute entries equal to the checkout or relative entries that
resolve to it from the settings file's directory. `--approve` keeps the
command non-interactive.

## 3. Claude enrollment (canonical local marketplace)

Marketplace manifest: `$XTRM_SUBSTRATE_DIR/.claude-plugin/marketplace.json`,
`name: "substrate"`, single plugin `substrate` with **relative** source
`./plugin/substrate`. (Delta from the symlink probe: a `./plugins/...`
symlink source installs but trips a strict-validation warning — validation
never follows symlinks — so the canonical source is the direct relative
path, which is strict-clean for both marketplace and plugin.)

```sh
claude plugin marketplace add "$XTRM_SUBSTRATE_DIR" --scope user
claude plugin install substrate@substrate -s user -y --json
claude plugin validate "$XTRM_SUBSTRATE_DIR" --strict --json
claude plugin validate "$XTRM_SUBSTRATE_DIR/plugin/substrate" --strict --json
```

Enrollment checks `claude-marketplace-enrolled` (marketplace `substrate`
registered **and** pointing at the checkout, not elsewhere),
`claude-plugin-enrolled` (exactly `substrate@substrate`: live
`claude plugin list --json` shows the id enabled, else the on-disk registry
carries the exact key **and** the marketplace is bound to this checkout —
installed copies live in a Claude cache dir, so installPath is never
compared; a `substrate@other-marketplace` never satisfies the spec),
and `claude-strict-live` (both strict validations pass live under the
checked HOME). `beads-absent` fails on any Beads remnant across
installed packages/marketplaces, Pi settings extensions + hook commands,
Claude settings hook commands + plugin keys, and installed plugin dir
names.

## 4. `setup.ts` plan/check invocation + JSON stability

```sh
node integrations/setup.ts plan --json [--dir "$XTRM_SUBSTRATE_DIR"]
node integrations/setup.ts check --json [--dir "$XTRM_SUBSTRATE_DIR"]
```

`--dir` overrides the `XTRM_SUBSTRATE_DIR` env; when neither is set, both
verbs fall back to the in-package defaults (the #168 behavior). An
explicit-but-invalid dir fails closed with exit 2 on stderr for both verbs.

Shape stability vs #168 (additive only — old keys verbatim):

- `plan --json`: `{ surfaces: [...] }` **plus** `dir` and `commands`
  (`[{ label, cmd, args }]` — the nine native commands from §1–§3 plus §5
  in run order). Exit 0. On validation failure: stderr error, exit 2, no `commands`.
- `check --json`: `{ ok, claude, pi, naming }` **plus** `dir` and
  `enrollment` (`Check[]`: `sb-enrolled`, `pi-enrolled`,
  `claude-marketplace-enrolled`, `claude-plugin-enrolled`,
  `claude-strict-live`, `beads-absent`). **Overall health is the exit
  code, not the top-level `ok`: `ok` stays source-only for #168
  compatibility, and the exit is 0 only when source checks AND every
  enrollment entry are green (exit 1 otherwise).** Live subprocesses
  observe the checked home (HOME threaded into the child,
  CLAUDE_CONFIG_DIR dropped), so `--dir`/env selection governs
  validation too. `xt doctor` stays model-call-free: Pi load is proven
  once at init (next section), not on every check.

## 5. Pi load verification (load, not just registration)

`pi list`/settings prove enrollment, not load — and a model prompt would
need provider auth/quota/network while its exit code cannot prove which
tools registered. The final plan command is a model-free SDK probe instead
(`integrations/pi-load-check.ts`, run as `node <checkout>/integrations/
pi-load-check.ts --json` under the target HOME): it builds a
`DefaultResourceLoader` against the enrolled agentDir, creates an agent
session with an in-memory `SessionManager` (no turn ever runs), asserts the
exact 8 `substrate_*` tools are registered with zero relevant extension
load errors, then disposes the session. Exit 0/1/2 = loaded / not-loaded /
invalid checkout. `xt doctor` stays free of it: load is proven once at init.

Live offline evidence (this lane, `PI_OFFLINE=1`, no credentials,
fresh HOME): exit 0 with `tools` = `substrate_issue_get,
substrate_issue_search, substrate_issue_claim, substrate_issue_update,
substrate_issue_resume, substrate_journal_append, substrate_journal_
checkpoint, substrate_provenance_trace`, `missing` = [],
`extensionErrors` = []. Empty HOME exits 1 with all 8 missing; a broken
extension exits 1 with the relevant load error recorded.

Programmatic entry points: `resolveSubstrateDir(explicit?, env?)`,
`planInstall(explicit?, env?)` (fail-closed: no `commands` on error),
`planCommands(dir)`, `checkEnrollment(pkgRoot?, home?)`, plus the unchanged
#168 `installPlan()` / `fullCheck()`. Argument order is always
`(pkgRoot, home)` — e.g. `checkClaudePluginEnrolled(pkgRoot, home)`
(single-arg callers from the first revision must add `pkgRoot` first).

## 6. Fresh-machine acceptance (what `xt doctor` proves)

Under a fresh HOME/PATH with `TMPDIR=/var/tmp` (`/tmp` is a 2G tmpfs —
never use it for scratch): deterministic `npm ci` + global link put a PATH
`sb` resolving to the checkout (`sb --version` exits 0), a scratch project
links, Pi lists the package AND a load probe reports all 8 substrate tools,
the Claude marketplace installs exactly `substrate@substrate` with strict
validation and live discovery green, `setup.ts check` reports all enrolled,
and no Beads package/extension/hook/marketplace remnant remains. Negative
probes (wrong package name, missing/relative path, wrong-marketplace
plugin, foreign `sb`, hook residue) fail before any mutation.
