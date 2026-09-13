# Substrate operator workflow

Normal path from a fresh checkout to closed work (ADR §103). Advanced
detail lives in the sibling pages; this page is the complete normal story.

```bash
git clone <repo>
cd <repo>
sb init

sb issue list
sb issue ready
sb issue show <ref>
sb issue claim <ref> --holder <who>
# ... do the work, journal as you go ...
sb issue attest <ref> --outcome ready --policy <p> --attested-by <who>
sb provenance dispatch <ref>
sb issue close <ref>
sb issue release <ref> --holder <who>
```

## 1. Initialize once per repository

```bash
sb init
```

`sb init` discovers the Git common root (worktree-aware), derives the
repository identity, detects the base branch, creates or adopts the
deterministic Project, binds the repository, and verifies. It is atomic
and idempotent: a second run reports `idempotent: true`. No project
metadata is ever needed (see
[`repository-identity.md`](./repository-identity.md)).

Worktrees inherit the repository identity. An uninitialized repository
fails closed with `run sb init` — it never sees another Project's Issues.

## 2. Find dispatchable work

```bash
sb issue list        # everything in this repository's Project
sb issue ready       # dispatchable only
sb issue show <ref>  # contract + current revision
sb issue validate <ref>  # readiness: state, attestation currency, blockers
```

A ref is a machine ID, durable reference, locator, historical locator, or
alias. Never implement from a title + description issue: repair the
contract first (new Issue revision + fresh attestation).

## 3. Claim before executing

```bash
sb issue claim <ref> --holder <who>
```

Exactly one live claim per Issue. Attestation authorizes one contract
revision: `--contract` / `--ownership` / `--context-refs` / `--scrutiny`
edits create a new revision and invalidate attestation; `--title` /
`--priority` are metadata and do not.

## 4. Journal continuity, not authority

```bash
sb issue note <ref> "material fact" --kind finding
sb journal checkpoint <ref>   # durable boundaries
sb journal since <ref> <cursor>
sb issue resume <ref>         # bounded capsule for the next worker
```

Journal records progress; it never changes the contract. Full doctrine:
[`journal.md`](./journal.md).

## 5. Prove execution, then close

```bash
sb provenance dispatch <ref>  # bind execution -> Issue
sb provenance trace <ref>     # verify the lineage
sb issue close <ref>          # lifecycle -> done, with a close reason
sb issue release <ref> --holder <who>
```

Do not close because a commit exists: SUCCESS satisfied, VALIDATION
complete, OUTPUT present, result + key decisions durable, provenance
sufficient, no incompatible blocker. Full doctrine:
[`provenance.md`](./provenance.md).

## 6. Full command surface

Every group and verb, with flags: [`cli.md`](./cli.md).
Repository identity, overrides, collisions:
[`repository-identity.md`](./repository-identity.md).

## Methodologies by role

- Coordinator: inspect children, claims, pending asks, new results,
  blockers, provenance; journal only material root-level state.
- Ordinary worker: claim → journal findings/decisions → checkpoint at
  durable boundaries → handoff; resume from the capsule, never from chat.
- Reviewer/validator: read `sb issue show`, journal deltas, and the
  provenance trace; verify SUCCESS/VALIDATION before sign-off.

Issue versus Journal boundary: the Issue revision is the executable
authority; the Journal is the durable narrative. Messages coordinate;
they never silently change the contract.
