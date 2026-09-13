# Substrate repository identity — operator reference

Covers ADR §70. Normal use stays simple; internals are sketched at the
end for operators who hit an edge.

## The normal story

One global database holds many Projects. One Git repository is normally
one Project. You run one command once:

```bash
cd <repository>
sb init
```

After that, `sb issue list`, `sb issue ready`, `sb issue create`, notes,
journal, and provenance all operate on this repository automatically —
no project flags, no IDs.

## One global state.db, many Projects

The canonical store is `~/.xtrm/state.db` (override: `--db PATH`, else
`$SUBSTRATE_DB`). Many repositories and many Projects share it. Global
storage does not imply global context: every repository-scoped operation
resolves the current Git repository to its own Project, or fails closed.

## One normal Project per Git repository

Main checkout, feature worktree, Specialist worktree, detached worktree,
second local clone — all one logical repository, therefore one Project
when repository identity can be established. A worktree never creates
another Project; a moved checkout never creates another Project.

## `sb init`

Atomic and idempotent: discover Git repository → resolve the Git common
root → derive repository identity → detect the base branch → derive/find
the Project → bind repository to Project → register the local checkout
alias → verify → ready. A second run reports `idempotent: true` and
changes nothing. It is a typed service operation, not CLI recursion into
`project create` + `project link`.

## Worktree inheritance

Resolution keys on the Git common root (`git rev-parse
--git-common-dir`), shared by every worktree of a repository — not the
per-worktree toplevel. Initialize once at repository level; all worktrees
resolve the same Project with no repeated initialization.

## Clone recognition

Two local clones of the same canonical remote repository resolve to the
same repository identity and the same Project. No duplicate Issue
namespace.

## Remote normalization

Equivalent remote forms normalize to one repository key:

```text
git@github.com:xtrm-dev/specialists.git
https://github.com/xtrm-dev/specialists.git
ssh://git@github.com/xtrm-dev/specialists.git
→ github.com/xtrm-dev/specialists
```

Transport differences, optional `.git`, and credentials/tokens normalize
away deterministically. Authenticated URLs are never persisted with
secrets intact.

## Base branch detection

`sb init` detects the repository base branch during binding. No prompt,
no flag in the normal path.

## Local-no-remote behavior

No remote provider is required. A local Git repository with no remote
gets a deterministic local identity derived from the Git common
repository. Limitation: a path-derived identity cannot recognize a
second clone made elsewhere as the same repository — add a canonical
remote when clone recognition matters.

## Advanced overrides (reference)

Resolution order: explicit per-command `--project` → explicit
`SUBSTRATE_PROJECT` environment → initialized repository identity → fail
closed. There is deliberately no "only one project in the database, use
it" shortcut. An override grants effective context only: `sb doctor`
still reports the repository itself uninitialized, and `xt init` still
initializes rather than accepting the override as a binding.

## Collision handling (reference)

Two different repositories that normalize to the same key (e.g.
`org-a/service` vs `org-b/service` sharing a basename) get different
deterministic Projects — host-qualified keys, no random suffix, no
accidental sharing. Initializing into a store that already holds the
Project adopts it: no duplicate, Issue refs unchanged, Journal and
provenance preserved. Low-level `sb project create|link|unlink` exists
for administration; normal work never needs it.

## Diagnostics

```bash
sb doctor [--db PATH] [--json]
```

Reports store health, the repository key, whether this repository is
initialized, the bound Project, and the effective override (informational
only — it never flips health). Exit 0 healthy, 1 otherwise.
