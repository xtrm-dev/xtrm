---
status: current
owner: substrate
last_verified_against: 4d83048bb86d5924b864278ff106640c6046e271
---

# Integrations

Provider surfaces intentionally differ while consuming one authority model.

```mermaid
flowchart TD
  S[Substrate typed services]
  SB[sb CLI]
  PI[Pi extension<br/>8 tools + command/events]
  C[Claude plugin<br/>15 MCP tools + hooks]
  SP[Specialists<br/>NativeActivationHost]

  S --> SB
  S --> PI
  S --> C
  SP -->|WorkItemStore + settlement publication| S
```

Do not force name/count parity between Pi and Claude. Instead require:

- same Issue/Journal/Provenance/Closure semantics,
- same repository/project fail-closed model,
- same canonical database authority,
- same no-fabricated-identity rule,
- provider-specific tool inventories mechanically aligned with provider docs and
  skills.

Specialists consumes Substrate; it does not own another durable work model.
Core/`xt` enrolls repositories and propagates session identity; it does not
derive Project identity independently.
