---
status: current
owner: substrate
last_verified_against: 4d83048bb86d5924b864278ff106640c6046e271
---

# Workflow

## 1. Initialize the repository

```bash
sb init
```

This binds the Git repository to its Substrate Project. Worktrees share the same
repository identity.

## 2. Find or plan work

```bash
sb issue list
sb issue show XTRM-123
```

A READY Issue revision is the executable contract. If the contract is
insufficient, revise through planning and re-attest readiness before execution.

## 3. Claim

```bash
sb issue claim XTRM-123 --holder coordinator
```

Claims answer **who owns it**, not **what happened**.

## 4. Execute and Journal

Record durable high-signal execution facts:

```bash
sb issue note XTRM-123 "SDK drops the field" --kind finding
sb issue note XTRM-123 "Use the typed service" --kind decision
sb journal checkpoint XTRM-123
```

A bounded participant outcome is `kind=result`; do not substitute a progress
note or contract edit.

If authorized work changes, stop and create a new Issue revision rather than
smuggling scope into prompts or Journal prose.

## 5. Bind provenance

Execution bindings and WorkReceipts connect the exact Issue revision/hash to
sessions/activations and artifacts. `sb provenance trace` shows the forward
spine; session/activation/commit/receipt/PR queries provide reverse lookup.

## 6. Validate and close

```bash
sb issue close XTRM-123 \
  --outcome completed \
  --reason "Implementation and validation complete" \
  --result <journal-result-ref> \
  --receipt <receipt-ref>
```

Closure records **why** terminal state is justified. A Git commit message is not
a close reason.

## 7. Resume later

```bash
sb issue resume XTRM-123
```

Resume from Issue + checkpoint + Journal delta + claim/blockers/provenance, not
from old chat history.
