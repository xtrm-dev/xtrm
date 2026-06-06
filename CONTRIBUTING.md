# Contributing to xtrm

> Closed-source umbrella monorepo. All work happens inside the `xtrm-dev` GitHub organization.
> Members work via branches in this repo — no public forks of private repositories.

This document is the canonical onboarding for anyone added to the org.

---

## 1. Access

You should already have received an email invite to join the `xtrm-dev` organization. After accepting:

- Default org-wide permission is **read** — you can clone every repo but cannot push by default.
- To get **write** access on a repo, you must be added to the relevant team (`core-team`, `console-team`, `specialists-team`, …) or granted as a direct repo collaborator. Ping an owner.
- Roles (most to least permissive): `Admin` > `Maintain` > `Write` > `Triage` > `Read`. Day-to-day contributors get `Write`.

Two-factor authentication is expected on your GitHub account. The org may enforce it at any time without notice.

---

## 2. Local setup

```sh
git clone git@github.com:xtrm-dev/xtrm.git
cd xtrm
```

Prerequisites land per package as the monorepo fills in. As of 0.1.0:

- **git** ≥ 2.40
- **gh** CLI (recommended for PR/issue workflow)
- **Bun** ≥ 1.0 (added when the first package lands; `packages/core` will declare this)
- **pnpm** for workspace management (added together with `packages/`)

If you are working on docs only, no runtime is needed.

### Repo layout

```
xtrm/
├── packages/        # libraries (core, substrate, channels, specialists, …)
├── apps/            # end-user apps (console, …)
├── docs/            # canonical design docs and research (vault history preserved)
└── .github/         # CODEOWNERS, dependabot, PR & issue templates
```

See `README.md` for package ownership.

---

## 3. Branching

**Never push to `main`.** It is protected: PR-only, linear history, no force-push, no deletions.

Create a branch off `main` for every change:

```sh
git checkout main && git pull
git checkout -b <type>/<jira-key>-<slug>
```

Type prefixes:

| Type | Use for |
|---|---|
| `feature/` | new capability |
| `fix/` | bug fix |
| `chore/` | scaffolding, deps, refactor without behavior change |
| `docs/` | docs-only changes |
| `release/` | version bump / cut a tag |

Include the Jira key (`KAN-89`, etc.) in the branch name so the GitHub ↔ Jira integration auto-links the work. Example:

```sh
git checkout -b feature/KAN-89-graft-core
git checkout -b fix/KAN-72-redact-pem-blocks
git checkout -b docs/KAN-87-monorepo-readme
```

One bead / one Jira key per branch. Don't recycle branches across issues.

---

## 4. Commits

We follow a relaxed [Conventional Commits](https://www.conventionalcommits.org/) shape:

```
<type>(<scope>): <subject>

<body — what + why, not how>

<footer — refs, breaking changes>
```

Examples:

```
feat(core): expose StateClient.subscribe(event_type)
fix(specialists): unbreak reviewer when injected_diff has 0 hunks
chore(deps): bump @types/node to 22.x
docs(substrate): clarify §13.3 deployment tiers
```

Types reused from branch names plus `refactor`, `test`, `perf`, `build`, `ci`, `revert`.

Scope should be the package or top-level area (`core`, `substrate`, `console`, `docs/substrate`, `.github`).

Subject is imperative ("expose", "unbreak"), lowercase, no trailing period.

For commits authored with an AI agent, keep the trailer (e.g. `Co-Authored-By: Claude …`) — it survives the squash and helps audit later.

---

## 5. Pull requests

```sh
git push -u origin <your-branch>
gh pr create
```

The PR template prompts for:

- **Summary** — 1–3 sentences
- **Scope** — which packages/apps/docs
- **Bead / Jira link** — `Closes KAN-89` and/or `Closes unitAI-…`
- **Validation** — how you tested
- **Risk** — blast radius, migrations, lockfile bumps

### Review

- 0 reviewers are required by branch protection today (solo phase). As the team grows, this will move to ≥1.
- `CODEOWNERS` requests reviews automatically based on touched paths.
- Use draft PRs while iterating; mark "ready for review" only when CI is green and you've self-reviewed the diff.

### Merging

The repo allows **squash** and **rebase** merges only. **No merge commits.** Linear history is required.

- Default to **Squash & merge** for feature/fix branches — keeps `main` tidy, one logical commit per PR.
- Use **Rebase & merge** only when the branch's commits are individually meaningful and you want to preserve them.
- Auto-merge is enabled — set it when CI is green and you don't want to wait at the keyboard.
- Source branch is deleted automatically after merge.

If your PR's commits drifted from `main` while it was open, click **Update branch** (or rebase locally) before merging.

---

## 6. Issue tracking

Internal work is tracked in **Atlassian Jira**, project `KAN` at https://xtrmxt.atlassian.net.

GitHub issues on `xtrm-dev/*` repos are reserved for:

- Bug reports from external/non-org reporters
- Security advisories (file privately via the security tab, not as an issue)
- Discussion of public surface changes once any package ships

Blank issues are disabled — use the templates.

To link work across the two systems:

- Put the Jira key in branch names, commit subjects, and PR titles → GitHub for Jira app links automatically.
- Cross-reference in the opposite direction by pasting the PR URL into the Jira issue's Development panel.

`bd` (beads) is used inside the `specialists` package for fine-grained execution tracking; if you're working in `packages/specialists/`, follow the bead workflow described in that package's `CLAUDE.md`.

---

## 7. Code review expectations

Whether you're reviewing or being reviewed:

- **Trust but verify.** Read the diff, not just the summary.
- **Block on correctness and security; suggest on style.** Use the `Request changes` button sparingly — most feedback should be `Comment`.
- **Resolve every conversation before merge.** Required by branch protection.
- **Small PRs win.** Anything over ~500 LOC of diff (excluding generated/lockfile changes) is hard to review carefully. Split when you can.
- **CI must be green** before merge. Failing checks are not "flakes" by default — investigate before retrying.

---

## 8. Security

Never commit secrets. Secret scanning + push protection are enabled — pushes containing detected secrets will be rejected at the GitHub edge. If a secret slips through:

1. **Rotate** the secret immediately (don't wait for cleanup).
2. Notify owners via the security advisory channel.
3. Plan history rewrite only after rotation — `git filter-repo` then force-push (admin-only operation; coordinate).

For vulnerabilities found in our code:

- File privately via GitHub Security Advisory (Security tab → Advisories → "Report a vulnerability"). **Do not open a public issue.**
- See `SECURITY.md` for the full policy.

Dependabot alerts and automated security fixes are enabled. Triage incoming alerts within a week; ship fixes promptly for High/Critical.

---

## 9. Releases

Pre-1.0 — releases are per-package. There is no umbrella version on the monorepo itself.

When a package reaches a releasable state, its package-level docs will describe the release dance. For now, no `main` push triggers a release.

---

## 10. House style

- **Default to no comments.** Only add a comment when the *why* is non-obvious (a hidden constraint, a workaround for a specific bug). Don't explain *what* the code does — well-named identifiers already do that.
- **Don't add backwards-compatibility shims** for code you're confident is unused. Delete it.
- **Match scope to ask.** Bug fixes don't need surrounding cleanup. One-shot operations don't need helpers.
- **No premature abstractions.** Three similar lines is better than a wrong shared helper.

---

## 11. Questions

- General onboarding / access: ping an org owner.
- Security: see `SECURITY.md`.
- Architecture: start from `docs/xtrm-MOC.md` (map of content) and `docs/monorepo-migration.md`.
- This document is itself a PR-able artifact — propose improvements via a `docs/` branch.
