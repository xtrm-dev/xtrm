# A1 negative-control transcript (XTRM-252.14)

Proves the acceptance suite fails when a check is broken, then restores the tree.
Method: temporarily reintroduce the rejected global-cardinality shortcut inside
`IssueService.resolveProject`, run the suite, observe failure, restore the file byte-for-byte
and re-verify green. No commit, no push, no tag, no branch at any point.

## Patch (temporary, restored afterwards)

File: `packages/substrate/src/service/issue-service.ts`, inserted immediately before the
`// Fail closed … (ADR §§5, 85)` block inside `resolveProject`:

```ts
// TEMPORARY A1 NEGATIVE CONTROL (reintroduced global-cardinality shortcut; restored afterwards).
try {
  const only = (this.db.prepare("SELECT id FROM projects").all() as Array<{ id: string }>);
  if (only.length === 1) return { projectId: only[0]!.id, source: "link" };
} catch { /* ignore for control */ }
```

Environment for every run below (isolated HOME, temp store, mirror CLI only):

```text
HOME=$(mktemp -d) SUBSTRATE_DB=$(mktemp -u) GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
cd /var/tmp/xtrm252-a1-work/packages/substrate
```

## Observed failure with the shortcut present

```text
$ HOME=… SUBSTRATE_DB=… node --test --test-name-pattern="uninitialized repository fails closed" \
    tests/sbcloseout4-acceptance.test.ts
▶ A1 §85 multi-repository isolation (release blocking)
  ✖ uninitialized repository fails closed with sb init guidance and leaks nothing
ℹ tests 1
ℹ pass 0
ℹ fail 1
  AssertionError [ERR_ASSERTION]: uninitialized repo must fail closed
  0 !== 1
```

The uninitialized repository incorrectly resolved to the sole Project (`code 0` instead of
`code 1`) — exactly the wrong-project read ADR §5 forbids. The release-blocking check catches it.

```text
$ HOME=… SUBSTRATE_DB=… node --test --test-name-pattern="no live" \
    tests/sbcloseout4-acceptance.test.ts
▶ A1 negative-control guard: no global-cardinality shortcut
  ✖ resolveProject has no live projects.length===1 inference and no source single
ℹ tests 1
ℹ pass 0
ℹ fail 1
  AssertionError [ERR_ASSERTION]: no live global-cardinality inference
```

The static guard (no live `.length === 1` in `issue-service.ts` outside the documenting
comment) also fails while the shortcut is present.

## Restore and re-verify (observed)

```text
$ cp /tmp/issue-service.ts.a1-backup src/service/issue-service.ts   # byte restore
$ grep -c "TEMPORARY A1 NEGATIVE" src/service/issue-service.ts
0
restore confirmed (0 matches)
$ HOME=… SUBSTRATE_DB=… node --test tests/sbcloseout4-acceptance.test.ts
ℹ tests 19
ℹ pass 19
ℹ fail 0
$ npx tsc --noEmit
EXIT:0
```

The tree is restored; the full A1 suite is green again and typechecking is clean.
No runtime file retains the shortcut; the only lasting artifact of the control is this
transcript plus the permanent guard test
(`A1 negative-control guard` in `tests/sbcloseout4-acceptance.test.ts`), which keeps
failing the build if the shortcut ever returns.
