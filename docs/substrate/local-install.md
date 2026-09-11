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

`sb` is TypeScript run on Node ≥ 24 (native type-stripping, no build step):

1. `npm --prefix "$XTRM_SUBSTRATE_DIR" install --no-audit --no-fund`
   (public registry deps only; the package itself is never published)
2. `node "$XTRM_SUBSTRATE_DIR/cli/sb.ts" --version` must exit 0.

Optional PATH shim: symlink a `sb` on PATH at
`$XTRM_SUBSTRATE_DIR/cli/sb.ts` (shebang `#!/usr/bin/env node`, exec bit
set). Enrollment check `sb-enrolled` runs step 2 and fails with
"node_modules missing" when step 1 was skipped.

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
`claude-plugin-enrolled` (`substrate@<marketplace>` in
`installed_plugins.json`), and `claude-strict-live` (both strict
validations pass live). `beads-absent` fails when any Beads
package/extension/marketplace remnant remains.

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
  (`[{ label, cmd, args }]` — the seven native commands from §1–§3 in run
  order). Exit 0. On validation failure: stderr error, exit 2, no `commands`.
- `check --json`: `{ ok, claude, pi, naming }` **plus** `dir` and
  `enrollment` (`Check[]`: `sb-enrolled`, `pi-enrolled`,
  `claude-marketplace-enrolled`, `claude-plugin-enrolled`,
  `claude-strict-live`, `beads-absent`). Exit 0 only when source checks
  AND enrollment are all green; exit 1 otherwise.

Programmatic entry points: `resolveSubstrateDir(explicit?, env?)`,
`planInstall(explicit?, env?)` (fail-closed: no `commands` on error),
`planCommands(dir)`, `checkEnrollment(pkgRoot?, home?)`, plus the unchanged
#168 `installPlan()` / `fullCheck()`.

## 5. Fresh-machine acceptance (what `xt doctor` proves)

Under a fresh HOME/PATH with `TMPDIR=/var/tmp` (`/tmp` is a 2G tmpfs —
never use it for scratch): `sb --version` exits 0, a scratch project links,
Pi lists/loads the Substrate extension and tools, the Claude marketplace
installs the plugin with strict validation and live discovery green,
`setup.ts check` reports all enrolled, and no Beads
package/extension/hook/marketplace is installed. Negative probes
(wrong package name, missing/relative path) exit before any mutation.
